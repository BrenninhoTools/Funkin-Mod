/* Unit tests for the Lua -> HScript translator (output is idiomatic V-Slice HScript, see js/psych-lua.js). */
const assert = require('assert');
const { C } = require('./helpers');

const tr = (src, opts) => C.psychLua.translate(src, opts || {});
const text = (part) => part.fieldsText + '\n' + part.functionsText;
const has = (part, re, msg) => assert(re.test(text(part)), (msg || 'expected ' + re) + '\n--- output ---\n' + text(part));
const lacks = (part, re, msg) => assert(!re.test(text(part)), (msg || 'unexpected ' + re) + '\n--- output ---\n' + text(part));

async function run(t) {
  // parser
  assert.throws(() => C.lua.parse('x = = 2'), /Lua syntax error/);
  assert.throws(() => C.lua.parse('function f( end'), /Lua syntax error/);
  assert.strictEqual(C.lua.parse('-- only a comment').body.length, 0);

  // chunk locals become fields assigned in luaMain(); arrays are 1-based in Lua, 0-based here
  let p = tr('local t = {1, 2, 3}\nfunction f() return t[1] + #t end');
  has(p, /var t;/);
  has(p, /t = \[1, 2, 3\];/);
  has(p, /return t\[0\] \+ t\.length;/);
  assert.strictEqual(p.mainFn, 'luaMain');

  // objects vs arrays are decided by how the table is used
  p = tr('local o = {}\no.name = "x"\nlocal a = {}\ntable.insert(a, 5)');
  has(p, /o = \{\};/);
  has(p, /a = \[\];/);
  has(p, /a\.push\(5\)/);
  p = tr('local cfg = {speed = 2, name = "n"}');
  has(p, /cfg = \{speed: 2, name: "n"\};/);

  // truthiness and and/or are inlined, no helper functions needed
  p = tr('function f(x) if x then return 1 end\nif not x and x ~= 2 then return 2 end end');
  has(p, /if \(x != null && x != false\)/);
  has(p, /if \(!\(x != null && x != false\) && \(x != 2\)\)/);
  p = tr('function f(a, b) return a and b or 5 end');
  has(p, /return \(a != null && a != false\) \? b : 5;/, 'cond and x or y -> ternary');
  p = tr('function f(a) return a or 7 end');
  has(p, /return \(a != null && a != false\) \? a : 7;/);
  lacks(p, /__t\(|lua_/);

  // string concatenation
  p = tr('function f(n) return "a" .. n .. 1 .. "b" end');
  has(p, /return "a" \+ Std\.string\(n\) \+ "1" \+ "b";/);

  // loops: plain ranges where possible, counters otherwise
  p = tr('function f() for i = 10, 1, -1 do print(i) end for i = 1, 5 do print(i) end end');
  has(p, /while \(__i\d+ >= __lim\d+\)/);
  has(p, /__i\d+ \+= __stp\d+;/);
  has(p, /for \(i in 1\.\.\.6\)/);
  p = tr('function f(t) for k, v in pairs(t) do print(k, v) end for _, x in ipairs(t) do print(x) end end');
  has(p, /for \(v in t\)/);
  has(p, /for \(x in t\)/);
  p = tr('function f() local i = 0 repeat i = i + 1 until i >= 3 while i > 0 do i = i - 1 end end');
  has(p, /while \(true\)[\s\S]*if \(i >= 3\) break;/);
  has(p, /while \(i > 0\)/);

  // scoping: locals stay local, chunk-level names become fields (no per-script prefixes)
  p = tr('local top = 1\nglobalVar = 2\nfunction f() local a = 3 a = a + top globalVar = globalVar + 1 end');
  has(p, /var top;/);
  has(p, /var globalVar;/);
  has(p, /var a = 3;/);
  has(p, /a = a \+ top;/);
  has(p, /globalVar = globalVar \+ 1;/);

  // reserved words as local names
  p = tr('function f() local var, new = 1, 2 return var + new end');
  has(p, /var var_ = 1;/);
  has(p, /var new_ = 2;/);

  // Psych callbacks are renamed luaXxx and recorded; helper functions keep their name
  p = tr('function onBeatHit() end function onTimerCompleted(tag, loops, left) end function helper(a, b) return function(c) return a + c end end');
  assert.deepStrictEqual([...p.callbacks.keys()].sort(), ['onBeatHit', 'onTimerCompleted']);
  assert.strictEqual(p.callbacks.get('onBeatHit').fn, 'luaOnBeatHit');
  has(p, /function luaOnBeatHit\(\)/);
  has(p, /function luaOnTimerCompleted\(tag, loops, left\)/);
  has(p, /function helper\(a, b\)/);
  has(p, /return function\(c\)/);

  // Psych API is lowered to direct V-Slice calls; unknown API is reported
  p = tr('function f() makeLuaSprite("a", "img", 1, 2) setProperty("a.x", 5) shinyUnknownThing(1) local m = math.floor(3.7) + string.upper("x"):len() end');
  has(p, /spr_a = FunkinSprite\.create\(1, 2, "img"\);/);
  has(p, /spr_a\.x = 5;/);
  assert.deepStrictEqual([...p.unsupported], [['shinyUnknownThing', 1]]);
  has(p, /__unsupported\("shinyUnknownThing"\)/);
  has(p, /Math\.floor\(3\.7\)/);
  assert(p.helpers.has('__unsupported'));

  // method calls on strings
  p = tr('function f(s) return s:sub(2, 3) end');
  has(p, /return s\.substr\(1, 2\);/);

  // swap assignment, multiple returns warn
  p = tr('function f(a, b) a, b = b, a return 1, 2 end');
  has(p, /var __t\d+ = b;[\s\S]*a = __t\d+;/);
  assert(p.warnings.some((w) => /multiple return values/.test(w)));

  // static-stage skipping
  p = tr('function onCreate() makeLuaSprite("bg", "x", 0, 0) addLuaSprite("bg", false) doTweenX("t", "bg", 5, 1, "linear") end', {
    skipCall: (fn, tag) => ['makeLuaSprite', 'addLuaSprite'].includes(fn) && tag === 'bg',
  });
  lacks(p, /FunkinSprite/);
  has(p, /FlxTween\.tween\(spr_bg, \{x: 5\}, 1, \{ease: FlxEase\.linear\}\);/);
  assert.strictEqual(p.skippedStatic, 2);

  // unsupported callbacks warn
  p = tr('function onKeyPress(k) end');
  assert(p.warnings.some((w) => /onKeyPress/.test(w)));

  // string escapes survive
  p = tr(String.raw`local s = "say \"hi\"\n\tdone"`);
  has(p, /"say \\"hi\\"\\n\\tdone"/);

  // The generated classes never use the calls the game's script sandbox blocks (see tests/lint.js).
  const all = C.scriptGen.buildModule({ className: 'T', moduleId: 'T', part: tr('function onCreate() makeLuaSprite("a","b",0,0) addLuaSprite("a",true) doTweenAlpha("t","a",0,1,"linear") runTimer("x",1) end function onEvent(n,a,b) setProperty("a.x", getProperty("b.y")) end'), source: 'x', guard: null });
  const bad = require('./lint').lint(all);
  assert.deepStrictEqual(bad, [], 'lint problems: ' + bad.join(', '));
  const hx = require('./helpers').checkHScript([{ name: 'unit.hxc', text: all }]);
  if (hx && !hx.error) hx.results.forEach((r) => assert(r.ok, 'HScript parse error: ' + r.line));
  t.note('Lua translator checks passed' + (hx && !hx.error ? '; sample module parses with the Polymod parser' : ''));
}

module.exports = { run };
