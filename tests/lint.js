/* Identifier lint for generated .hxc files: every free identifier must be declared (field, method, parameter,
 * local, import) or be a known HScript/Haxe global. Catches missing compat helpers and rewrite mistakes that a
 * pure syntax check cannot see. It is a heuristic, not a type checker. */
const { C } = require('./helpers');

const KEYWORDS = new Set(['var', 'final', 'function', 'class', 'extends', 'override', 'public', 'private', 'static', 'inline', 'import', 'using', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'in', 'try', 'catch', 'throw', 'new', 'null', 'true', 'false', 'this', 'super', 'cast', 'untyped', 'is', 'typedef', 'enum', 'abstract', 'interface', 'implements', 'dynamic', 'package']);
const GLOBALS = new Set(['noteKind', 'Std', 'Math', 'Reflect', 'Type', 'StringTools', 'Date', 'Array', 'String', 'Bool', 'Int', 'Float', 'Void', 'Dynamic', 'Map', 'trace', 'haxe']);

function lint(text) {
  const toks = C.codenameHx.tokenize(text).filter((t) => t.k !== 'ws' && t.k !== 'comment');
  const declared = new Set();
  // pass 1: declarations
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k !== 'id') continue;
    if ((t.t === 'var' || t.t === 'final' || t.t === 'class') && toks[i + 1] && toks[i + 1].k === 'id') declared.add(toks[i + 1].t);
    if (t.t === 'function') {
      let j = i + 1;
      if (toks[j] && toks[j].k === 'id') { declared.add(toks[j].t); j++; }
      if (toks[j] && toks[j].t === '(') {
        let depth = 0;
        for (; j < toks.length; j++) {
          if (toks[j].t === '(') depth++;
          else if (toks[j].t === ')') { depth--; if (depth === 0) break; }
          else if (depth === 1 && toks[j].k === 'id' && (toks[j - 1].t === '(' || toks[j - 1].t === ',' || toks[j - 1].t === '?')) declared.add(toks[j].t);
        }
      }
    }
    if (t.t === 'for' && toks[i + 1] && toks[i + 1].t === '(' && toks[i + 2] && toks[i + 2].k === 'id') {
      declared.add(toks[i + 2].t);
      if (toks[i + 3] && toks[i + 3].t === '=' && toks[i + 5] && toks[i + 5].k === 'id') declared.add(toks[i + 5].t);
    }
    if (t.t === 'catch' && toks[i + 1] && toks[i + 1].t === '(' && toks[i + 2] && toks[i + 2].k === 'id') declared.add(toks[i + 2].t);
    if (t.t === 'import') {
      let j = i + 1;
      const segs = [];
      while (toks[j] && toks[j].t !== ';') { if (toks[j].k === 'id') segs.push(toks[j].t); j++; }
      segs.filter((s) => /^[A-Z]/.test(s)).forEach((s) => declared.add(s));
    }
  }
  // pass 2: uses
  const problems = new Set();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.k !== 'id' || KEYWORDS.has(t.t) || GLOBALS.has(t.t) || declared.has(t.t)) continue;
    const prev = toks[i - 1];
    const next = toks[i + 1];
    if (prev && prev.t === '.') continue; // member access
    if (prev && prev.t === ':' && toks[i - 2] && (toks[i - 2].k === 'id' || toks[i - 2].t === ')')) continue; // type annotation
    if (prev && (prev.t === '{' || prev.t === ',') && next && next.t === ':') continue; // object-literal key
    if (prev && prev.t === '?' && next && (next.t === ',' || next.t === ')' || next.t === ':')) { /* ?optionalParam handled in declarations */ }
    if (prev && prev.t === 'import') continue;
    if (prev && prev.k === 'id' && (prev.t === 'import' || prev.t === 'package')) continue;
    // import path segments
    let j = i;
    while (j > 0 && (toks[j - 1].t === '.' || toks[j - 1].k === 'id')) j--;
    if (toks[j - 1] && toks[j - 1].t === 'import' || (toks[j] && toks[j].t === 'import')) continue;
    problems.add(t.t);
  }
  // Calls the game's script sandbox blacklists or does not provide (funkin.util.ReflectUtil / PolymodHandler).
  const stripped = text.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/\/\/[^\n]*/g, '');
  for (const re of [/\bType\.typeof\b/, /\bType\.getClass\b/, /\bReflect\.deleteField\b/]) {
    const m = re.exec(stripped);
    if (m) problems.add('blocked-api:' + m[0]);
  }
  return [...problems];
}

module.exports = { lint };
