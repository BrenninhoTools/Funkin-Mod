/* Unit tests for the Lua -> HScript translator. */
const assert = require('assert');
const { C } = require('./helpers');

const tr = (src, opts) => C.psychLua.translate(src, Object.assign({ prefix: 'p_' }, opts || {}));
const has = (part, re, msg) => assert(re.test(part.members), (msg || 'expected ' + re) + '\n--- output ---\n' + part.members);

async function run(t) {
  // parser
  assert.throws(() => C.lua.parse('x = = 2'), /Lua syntax error/);
  assert.throws(() => C.lua.parse('function f( end'), /Lua syntax error/);
  assert.strictEqual(C.lua.parse('-- only a comment').body.length, 0);

  // tables, indexing, length (1-based arrays)
  let p = tr('local t = {1, 2, 3}\nfunction f() return t[1] + #t end');
  has(p, /p_t = \[1, 2, 3\];/);
  has(p, /return \(lua_idx\(p_t, 1\) \+ lua_len\(p_t\)\);/);
  assert(p.used.has('lua_idx') && p.used.has('lua_len'));

  // objects vs arrays
  p = tr('local o = {}\no.name = "x"\nlocal a = {}\ntable.insert(a, 5)');
  has(p, /p_o = \{\};/);
  has(p, /p_a = \{\};/);
  has(p, /lua_tinsert\(p_a, 5\)/);
  p = tr('local cfg = {speed = 2, name = "n"}');
  has(p, /\{speed: 2, name: "n"\}/);

  // truthiness / and-or
  p = tr('function f(x) if x then return 1 end\nif not x and x ~= 2 then return 2 end end');
  has(p, /if \(__t\(x\)\) \{/);
  has(p, /if \(\(!__t\(x\) && \(x != 2\)\)\) \{/);
  p = tr('function f(a, b) return a and b or 5 end');
  has(p, /return \(__t\(a\) \? b : 5\);/, 'cond and x or y -> ternary');
  p = tr('function f(a) return a or 7 end');
  has(p, /lua_or\(a, 7\)/);

  // string concatenation
  p = tr('function f(n) return "a" .. n .. 1 .. "b" end');
  has(p, /\("a" \+ lua_str\(n\) \+ "1" \+ "b"\)/);

  // loops
  p = tr('function f() for i = 10, 1, -1 do print(i) end end');
  has(p, /while \(__i\d+ >= __lim\d+\)/);
  has(p, /__i\d+ \+= __stp\d+;/);
  p = tr('function f(t) for k, v in pairs(t) do print(k, v) end for _, x in ipairs(t) do print(x) end end');
  has(p, /lua_pairs\(t\)/);
  has(p, /lua_ipairs\(t\)/);
  p = tr('function f() local i = 0 repeat i = i + 1 until i >= 3 while i > 0 do i = i - 1 end end');
  has(p, /while \(true\) \{[\s\S]*if \(\(i >= 3\)\) \{ break; \}/);

  // scoping: locals stay local, globals get the script prefix, chunk locals become fields
  p = tr('local top = 1\nglobalVar = 2\nfunction f() local a = 3 a = a + top globalVar = globalVar + 1 end');
  has(p, /var p_top;/);
  has(p, /var p_globalVar;/);
  has(p, /var a = 3;/);
  has(p, /a = \(a \+ p_top\);/);
  has(p, /p_globalVar = \(p_globalVar \+ 1\);/);

  // reserved words as local names
  p = tr('function f() local var, new = 1, 2 return var + new end');
  has(p, /var var_ = 1;/);
  has(p, /var new_ = 2;/);

  // functions: all parameters optional, closures, callbacks recorded
  p = tr('function onBeatHit() end function onTimerCompleted(tag, loops, left) end function helper(a, b) return function(c) return a + c end end');
  assert.deepStrictEqual([...p.callbacks.keys()].sort(), ['onBeatHit', 'onTimerCompleted']);
  has(p, /function p_helper\(\?a, \?b\)/);
  has(p, /return function\(\?c\) \{/);

  // Psych API / unsupported API / stdlib
  p = tr('function f() makeLuaSprite("a", "img", 1, 2) setProperty("a.x", 5) shinyUnknownThing(1) local m = math.floor(3.7) + string.upper("x"):len() end');
  assert(p.used.has('makeLuaSprite') && p.used.has('setProperty'));
  assert.deepStrictEqual([...p.unsupported], [['shinyUnknownThing', 1]]);
  has(p, /__unsupported\("shinyUnknownThing"\)/);
  has(p, /Math\.floor\(3\.7\)/);

  // method calls on strings
  p = tr('function f(s) return s:sub(2, 3) end');
  has(p, /lua_sub\(s, 2, 3\)/);

  // swap assignment, multiple returns warn
  p = tr('function f(a, b) a, b = b, a return 1, 2 end');
  has(p, /var __t\d+ = b;[\s\S]*a = __t\d+;/);
  assert(p.warnings.some((w) => /multiple return values/.test(w)));

  // static-stage skipping
  p = tr('function onCreate() makeLuaSprite("bg", "x", 0, 0) addLuaSprite("bg", false) doTweenX("t", "bg", 5, 1, "linear") end', {
    skipCall: (fn, tag) => ['makeLuaSprite', 'addLuaSprite'].includes(fn) && tag === 'bg',
  });
  assert(!/makeLuaSprite/.test(p.members));
  has(p, /doTweenX\("t", "bg", 5, 1, "linear"\)/);
  assert.strictEqual(p.skippedStatic, 2);

  // unsupported callbacks warn
  p = tr('function onKeyPress(k) end');
  assert(p.warnings.some((w) => /onKeyPress/.test(w)));

  // string escapes survive
  p = tr('local s = "say \\"hi\\"\\n\\tdone"');
  has(p, /"say \\"hi\\"\\n\\tdone"/);
  // Every shim function, compiled together, must only reference things that exist (catches missing deps).
  const all = C.psychShim.collect(Object.keys(C.psychShim.SHIM));
  const NL = '\n';
  const globals = Object.entries(C.PSYCH_GLOBALS).map(([k, v]) => '  var ' + k + ' = ' + v + ';').join(NL);
  const hooks = ['onTweenCompleted', 'onTimerCompleted', 'onEvent'].map((n) => '  function __hook_' + n + '(a, b, c) {}').join(NL);
  const klass = [...all.imports].map((i) => 'import ' + C.PSYCH_IMPORTS[i] + ';').join(NL) + NL + 'class AllShim {' + NL + globals + NL + C.psychShim.BASE + NL + all.code + NL + hooks + NL + '}' + NL;
  const bad = require('./lint').lint(klass);
  assert.deepStrictEqual(bad, [], 'shim references undeclared names: ' + bad.join(', '));
  require('fs').writeFileSync(require('path').join(require('os').tmpdir(), 'fnfconv-allshim.hxc'), klass);
  const hx = require('./helpers').checkHScript([{ name: 'all-shim.hxc', text: klass }]);
  if (hx && !hx.error) hx.results.forEach((r) => assert(r.ok, 'HScript parse error in the shim: ' + r.line));
  t.note('Lua translator checks passed; whole shim (' + Object.keys(C.psychShim.SHIM).length + ' functions) lints' + (hx && !hx.error ? ' and parses' : ''));
}

module.exports = { run };
