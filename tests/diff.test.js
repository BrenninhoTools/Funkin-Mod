/* Optional semantic tests: translated Lua is executed in the real hscript interpreter and compared with
 *  (1) real Lua (fengari) for pure language semantics, and (2) mocks of the V-Slice API for the Psych API shim.
 * Needs: Haxe, the hscript library sources and `npm i fengari` (see tests/hscript/README.md). Skipped otherwise. */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { C } = require('./helpers');

function tryRequire(name) {
  try {
    return require(name);
  } catch (e) {
    return null;
  }
}

function build(lua, prefix, withRefresh) {
  const part = C.psychLua.translate(lua, { prefix });
  const shim = C.psychShim.collect(part.used);
  const globals = Object.entries(C.PSYCH_GLOBALS).map(([k, v]) => '  var ' + k + ' = ' + v + ';').join('\n');
  const hooks = ['onTweenCompleted', 'onTimerCompleted', 'onEvent']
    .map((n) => '  function __hook_' + n + '(?a, ?b, ?c) { ' + (part.callbacks.has(n) ? prefix + n + '(a, b, c);' : '') + ' }')
    .join('\n');
  return globals + '\n' + C.psychShim.BASE + '\n' + shim.code + '\n' + hooks + '\n' + part.members + '\n' + prefix + '__main();\n' + (withRefresh ? 'lua_refresh();\n' : '') + prefix + 'main();\n';
}

const { JSZip } = require('./helpers');

/** Turns a generated `class X extends Y { ... }` into flat script code (fields become globals, methods become functions). */
function classToScript(src) {
  let s = src.replace(/^import .*;$/gm, '');
  s = s.replace(/^class \w+ extends \w+ \{$/m, '');
  s = s.replace(/^  function new\(\) \{\n[\s\S]*?\n  \}\n/m, '');
  s = s.replace(/^\s*super\.\w+\(\w+\);\s*$/gm, '');
  s = s.replace(/\boverride /g, '');
  return s.replace(/\}\s*$/, '');
}

function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  return a === b;
}

function runLua(fengari, src) {
  const { lua, lauxlib, lualib, to_luastring } = fengari;
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  if (lauxlib.luaL_loadstring(L, to_luastring(src + '\nreturn main()')) !== 0) return { ok: false, error: lua.lua_tojsstring(L, -1) };
  if (lua.lua_pcall(L, 0, 1, 0) !== 0) return { ok: false, error: lua.lua_tojsstring(L, -1) };
  const t = lua.lua_type(L, -1);
  if (t === lua.LUA_TNUMBER) return { ok: true, value: lua.lua_tonumber(L, -1) };
  if (t === lua.LUA_TSTRING) return { ok: true, value: lua.lua_tojsstring(L, -1) };
  if (t === lua.LUA_TBOOLEAN) return { ok: true, value: !!lua.lua_toboolean(L, -1) };
  return { ok: true, value: null };
}

async function run(t) {
  const haxe = process.env.HAXE_BIN;
  const hs = process.env.HX_HSCRIPT_CP;
  const fengari = tryRequire('fengari');
  if (!haxe || !hs) return t.note('semantic tests skipped (set HAXE_BIN and HX_HSCRIPT_CP, see tests/hscript/README.md)');

  const langCases = require('./diff/cases.js');
  const apiCases = require('./diff/api-cases.js');
  const all = [
    ...langCases.map((c) => ({ kind: 'lang', name: c.name, lua: c.lua, code: build(c.lua, 'p_', false) })),
    ...apiCases.map((c) => ({ kind: 'api', name: c.name, lua: c.lua, expect: c, code: build(c.lua, 'p_', true) })),
  ];
  // Converted Codename scripts: generated classes turned into plain script code, then driven with mock V-Slice events.
  const cnCases = require('./diff/cn-cases.js');
  const cnMod = require('./codename.test.js');
  const cnZip = cnMod.buildFakeMod();
  const cnRes = await C.convertMod(cnZip, C.detectMods(cnZip, 'x.zip')[0], { JSZip });
  for (const c of cnCases) {
    const text = await cnRes.zip.file('cn-mod/' + c.file).async('string');
    all.push({ kind: 'cn', name: 'codename: ' + c.name, expect: c, code: (c.prelude || '') + '\n' + classToScript(text) + '\n' + c.driver });
  }
  const psCases = require('./diff/ps-cases.js');
  const psMod = require('./psych.test.js');
  const psZip = psMod.buildFakeMod();
  const psRes = await C.convertMod(psZip, C.detectMods(psZip, 'x.zip')[0], { JSZip });
  for (const c of psCases) {
    const text = await psRes.zip.file('cool-mod/' + c.file).async('string');
    all.push({ kind: 'ps', name: 'psych classes: ' + c.name, expect: c, code: (c.prelude || '') + '\n' + classToScript(text) + '\n' + c.driver });
  }
  const payload = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fnfconv-diff-')), 'cases.json');
  fs.writeFileSync(payload, JSON.stringify(all.map((c) => ({ name: c.name, code: c.code }))));

  const env = Object.assign({}, process.env);
  const r = spawnSync(haxe, ['-cp', hs, '-cp', path.join(__dirname, 'diff'), '--run', 'HxRun', payload], { encoding: 'utf8', env, cwd: path.join(__dirname, 'diff'), maxBuffer: 64 * 1024 * 1024 });
  assert(r.stdout, 'haxe failed: ' + (r.stderr || r.error));
  const results = JSON.parse(r.stdout.trim().split('\n').pop());

  const bad = [];
  all.forEach((c, i) => {
    const got = results[i];
    if (!got.ok) return bad.push(c.name + ': HScript error ' + got.error + ' (mock calls so far: ' + JSON.stringify(got.log) + ')');
    if (c.kind === 'lang') {
      if (!fengari) return;
      const ref = runLua(fengari, c.lua);
      if (!ref.ok) return bad.push(c.name + ': reference Lua failed: ' + ref.error);
      const same = typeof ref.value === 'number' && typeof got.value === 'number' ? Math.abs(ref.value - got.value) < 1e-9 : ref.value === got.value;
      if (!same) bad.push(c.name + ': real Lua gives ' + JSON.stringify(ref.value) + ', translation gives ' + JSON.stringify(got.value));
    } else {
      const e = c.expect;
      const same = sameValue(e.value, got.value);
      if (!same) bad.push(c.name + ': expected value ' + JSON.stringify(e.value) + ', got ' + JSON.stringify(got.value));
      if (e.log && JSON.stringify(e.log) !== JSON.stringify(got.log)) bad.push(c.name + ': expected log ' + JSON.stringify(e.log) + ', got ' + JSON.stringify(got.log));
      for (const line of e.logIncludes || []) if (!got.log.includes(line)) bad.push(c.name + ': expected the log to include ' + JSON.stringify(line) + ', got ' + JSON.stringify(got.log));
    }
  });
  assert.deepStrictEqual(bad, [], '\n' + bad.join('\n'));
  t.note(langCases.length + ' language cases ' + (fengari ? 'match real Lua (fengari)' : 'run (install fengari to compare with real Lua)') + '; ' + apiCases.length + ' Psych API cases, ' + psCases.length + ' converted Psych classes and ' + cnCases.length + ' converted Codename scripts run correctly against mocks');
}

module.exports = { run };
