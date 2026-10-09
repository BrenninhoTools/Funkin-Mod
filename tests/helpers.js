/* Shared test helpers: module loading, tiny fixtures, and the optional HScript syntax check. */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const JSZip = require(path.join(__dirname, '..', 'js', 'vendor', 'jszip.min.js'));
['util', 'xml', 'lua', 'psych-shim', 'psych-lua', 'script-gen', 'songs', 'characters', 'stages', 'weeks', 'psych-scripts', 'codename', 'codename-hx', 'converter'].forEach((f) =>
  require(path.join(__dirname, '..', 'js', f + '.js'))
);
const C = globalThis.FNFConv;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const OGG = Buffer.from('OggS-fake');

async function readJson(zip, p) {
  const f = zip.file(p);
  if (!f) throw new Error('missing file in the output: ' + p);
  return JSON.parse(await f.async('string'));
}
async function readText(zip, p) {
  const f = zip.file(p);
  if (!f) throw new Error('missing file in the output: ' + p);
  return f.async('string');
}

/**
 * Parses every .hxc of a converted mod with the real V-Slice (Polymod) HScript parser, when Haxe is available.
 * Environment: HAXE_BIN (haxe executable), HAXE_STD_PATH (its std folder), HX_PARSER_CP (folder with the Polymod
 * parser sources, see tests/hscript/README.md). Returns null when the tools are not configured.
 */
function checkHScript(files) {
  const bin = process.env.HAXE_BIN;
  const cp = process.env.HX_PARSER_CP;
  if (!bin || !cp || !files.length) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fnfconv-hx-'));
  const paths = files.map((f, i) => {
    const p = path.join(dir, i + '-' + path.basename(f.name));
    fs.writeFileSync(p, f.text);
    return p;
  });
  const env = Object.assign({}, process.env);
  if (process.env.HAXE_STD_PATH) env.HAXE_STD_PATH = process.env.HAXE_STD_PATH;
  const r = spawnSync(bin, ['-cp', cp, '-cp', path.join(__dirname, 'hscript'), '--run', 'Check', ...paths], { encoding: 'utf8', env, cwd: path.join(__dirname, 'hscript') });
  const results = (r.stdout || '').split(/\r?\n/).filter(Boolean).map((line) => {
    const m = /^(OK|ERR)\s+(.*)$/.exec(line);
    if (!m) return { ok: false, line };
    const idx = parseInt(path.basename(m[2]).split('-')[0], 10);
    return { ok: m[1] === 'OK', name: files[idx] ? files[idx].name : m[2], line };
  });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.error || (!results.length && r.status !== 0)) return { error: (r.stderr || '') + (r.error ? String(r.error) : ''), results: [] };
  return { results };
}

/** Collects the .hxc files of a converted zip. */
async function collectHxc(zip, prefix) {
  const out = [];
  for (const name of Object.keys(zip.files)) {
    if (name.startsWith(prefix) && /\.hxc$/.test(name)) out.push({ name, text: await zip.file(name).async('string') });
  }
  return out;
}

module.exports = { JSZip, C, PNG, OGG, readJson, readText, checkHScript, collectHxc };
