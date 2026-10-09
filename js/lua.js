/*
 * Lua 5.1-ish parser (lexer + recursive descent) producing a small AST.
 * Only used to translate Psych Engine Lua scripts to HScript; it never executes anything.
 *
 * AST statements ({t: 'Local' | 'Assign' | 'CallStat' | 'Do' | 'While' | 'Repeat' | 'If' | 'NumFor' | 'GenFor' |
 *                  'Function' | 'Return' | 'Break' | 'Goto' | 'Label'})
 * AST expressions ({t: 'Nil' | 'True' | 'False' | 'Num' | 'Str' | 'Vararg' | 'Func' | 'Table' | 'Bin' | 'Un' |
 *                   'Name' | 'Index' | 'Call' | 'Method' | 'Paren'})
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  class LuaError extends Error {
    constructor(msg, line) {
      super('Lua syntax error' + (line ? ' (line ' + line + ')' : '') + ': ' + msg);
      this.line = line;
    }
  }

  const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
  const OPS3 = ['...'];
  const OPS2 = ['..', '==', '~=', '<=', '>=', '<<', '>>', '//', '::'];

  /* ------------------------------------------------------------------ */
  /* Lexer                                                               */
  /* ------------------------------------------------------------------ */
  function tokenize(src) {
    const toks = [];
    let i = 0;
    let line = 1;
    const n = src.length;

    function longBracket(start) {
      // src[start] === '['; returns {level, bodyStart} or null
      let j = start + 1;
      let level = 0;
      while (src[j] === '=') {
        level++;
        j++;
      }
      if (src[j] !== '[') return null;
      return { level, bodyStart: j + 1 };
    }
    function readLong(level, bodyStart) {
      const close = ']' + '='.repeat(level) + ']';
      const end = src.indexOf(close, bodyStart);
      if (end < 0) throw new LuaError('unfinished long string/comment', line);
      let body = src.slice(bodyStart, end);
      for (const ch of body) if (ch === '\n') line++;
      if (body[0] === '\r' && body[1] === '\n') body = body.slice(2);
      else if (body[0] === '\n') body = body.slice(1);
      i = end + close.length;
      return body;
    }

    while (i < n) {
      const c = src[i];
      if (c === '\n') { line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
      if (c === '#' && i === 0 && src[1] === '!') { while (i < n && src[i] !== '\n') i++; continue; }

      // comments
      if (c === '-' && src[i + 1] === '-') {
        if (src[i + 2] === '[') {
          const lb = longBracket(i + 2);
          if (lb) { readLong(lb.level, lb.bodyStart); continue; }
        }
        while (i < n && src[i] !== '\n') i++;
        continue;
      }

      // long strings
      if (c === '[') {
        const lb = longBracket(i);
        if (lb) {
          const startLine = line;
          const body = readLong(lb.level, lb.bodyStart);
          toks.push({ k: 'str', v: body, line: startLine });
          continue;
        }
      }

      // strings
      if (c === '"' || c === "'") {
        const q = c;
        let s = '';
        i++;
        for (;;) {
          if (i >= n) throw new LuaError('unfinished string', line);
          const ch = src[i];
          if (ch === q) { i++; break; }
          if (ch === '\n') throw new LuaError('unfinished string', line);
          if (ch === '\\') {
            i++;
            const e = src[i];
            const map = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'", '\n': '\n' };
            if (e in map) { s += map[e]; if (e === '\n') line++; i++; }
            else if (e === 'x') { s += String.fromCharCode(parseInt(src.substr(i + 1, 2), 16)); i += 3; }
            else if (e === 'z') { i++; while (/\s/.test(src[i] || '')) { if (src[i] === '\n') line++; i++; } }
            else if (/[0-9]/.test(e)) {
              let d = '';
              while (d.length < 3 && /[0-9]/.test(src[i] || '')) d += src[i++];
              s += String.fromCharCode(parseInt(d, 10));
            } else { s += e; i++; }
            continue;
          }
          s += ch;
          i++;
        }
        toks.push({ k: 'str', v: s, line });
        continue;
      }

      // numbers
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        let j = i;
        if (c === '0' && /[xX]/.test(src[i + 1] || '')) {
          j += 2;
          while (/[0-9a-fA-F.]/.test(src[j] || '')) j++;
          toks.push({ k: 'num', v: parseInt(src.slice(i, j), 16), raw: src.slice(i, j), line });
        } else {
          while (/[0-9]/.test(src[j] || '')) j++;
          if (src[j] === '.' && src[j + 1] !== '.') { j++; while (/[0-9]/.test(src[j] || '')) j++; }
          if (/[eE]/.test(src[j] || '')) {
            let k = j + 1;
            if (src[k] === '+' || src[k] === '-') k++;
            if (/[0-9]/.test(src[k] || '')) { j = k; while (/[0-9]/.test(src[j] || '')) j++; }
          }
          toks.push({ k: 'num', v: parseFloat(src.slice(i, j)), raw: src.slice(i, j), line });
        }
        i = j;
        continue;
      }

      // names / keywords
      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1;
        while (/[A-Za-z0-9_]/.test(src[j] || '')) j++;
        const w = src.slice(i, j);
        toks.push(KEYWORDS.has(w) ? { k: 'kw', v: w, line } : { k: 'name', v: w, line });
        i = j;
        continue;
      }

      // operators
      const s3 = src.substr(i, 3);
      if (OPS3.includes(s3)) { toks.push({ k: 'op', v: s3, line }); i += 3; continue; }
      const s2 = src.substr(i, 2);
      if (OPS2.includes(s2)) { toks.push({ k: 'op', v: s2, line }); i += 2; continue; }
      if ('+-*/%^#&~|<>=(){}[];:,.'.includes(c)) { toks.push({ k: 'op', v: c, line }); i++; continue; }
      throw new LuaError('unexpected character "' + c + '"', line);
    }
    toks.push({ k: 'eof', v: '<eof>', line });
    return toks;
  }

  /* ------------------------------------------------------------------ */
  /* Parser                                                              */
  /* ------------------------------------------------------------------ */
  const BIN_PRI = {
    or: [1, 1], and: [2, 2],
    '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3],
    '|': [4, 4], '~': [5, 5], '&': [6, 6], '<<': [7, 7], '>>': [7, 7],
    '..': [9, 8], '+': [10, 10], '-': [10, 10],
    '*': [11, 11], '/': [11, 11], '//': [11, 11], '%': [11, 11],
    '^': [14, 13],
  };
  const UNARY_PRI = 12;

  function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const isOp = (v) => toks[p].k === 'op' && toks[p].v === v;
    const isKw = (v) => toks[p].k === 'kw' && toks[p].v === v;
    function acceptOp(v) { if (isOp(v)) { p++; return true; } return false; }
    function acceptKw(v) { if (isKw(v)) { p++; return true; } return false; }
    function expectOp(v) { if (!acceptOp(v)) throw new LuaError('"' + v + '" expected near "' + toks[p].v + '"', toks[p].line); }
    function expectKw(v) { if (!acceptKw(v)) throw new LuaError('"' + v + '" expected near "' + toks[p].v + '"', toks[p].line); }
    function expectName() {
      if (toks[p].k !== 'name') throw new LuaError('name expected near "' + toks[p].v + '"', toks[p].line);
      return toks[p++].v;
    }

    function blockEnd() {
      const t = peek();
      return t.k === 'eof' || (t.k === 'kw' && (t.v === 'end' || t.v === 'else' || t.v === 'elseif' || t.v === 'until'));
    }

    function parseBlock() {
      const body = [];
      while (!blockEnd()) {
        if (isKw('return')) {
          const line = next().line;
          let exprs = [];
          if (!blockEnd() && !isOp(';')) exprs = parseExprList();
          acceptOp(';');
          body.push({ t: 'Return', exprs, line });
          break;
        }
        const st = parseStatement();
        if (st) body.push(st);
      }
      return body;
    }

    function parseStatement() {
      const tk = peek();
      const line = tk.line;
      if (acceptOp(';')) return null;
      if (tk.k === 'op' && tk.v === '::') {
        next();
        const name = expectName();
        expectOp('::');
        return { t: 'Label', name, line };
      }
      if (tk.k === 'kw') {
        switch (tk.v) {
          case 'if': return parseIf();
          case 'while': {
            next();
            const cond = parseExpr();
            expectKw('do');
            const body = parseBlock();
            expectKw('end');
            return { t: 'While', cond, body, line };
          }
          case 'do': {
            next();
            const body = parseBlock();
            expectKw('end');
            return { t: 'Do', body, line };
          }
          case 'for': return parseFor();
          case 'repeat': {
            next();
            const body = parseBlock();
            expectKw('until');
            const cond = parseExpr();
            return { t: 'Repeat', body, cond, line };
          }
          case 'function': {
            next();
            // funcname: Name {'.' Name} [':' Name]
            const path = [expectName()];
            let method = false;
            while (isOp('.')) { next(); path.push(expectName()); }
            if (isOp(':')) { next(); path.push(expectName()); method = true; }
            const fn = parseFuncBody(method, line);
            return { t: 'Function', path, method, isLocal: false, fn, line };
          }
          case 'local': {
            next();
            if (acceptKw('function')) {
              const name = expectName();
              const fn = parseFuncBody(false, line);
              return { t: 'Function', path: [name], method: false, isLocal: true, fn, line };
            }
            const names = [expectName()];
            while (acceptOp(',')) names.push(expectName());
            // attribs <const>/<close> (5.4) are ignored
            if (isOp('<') && toks[p + 1].k === 'name' && toks[p + 2] && toks[p + 2].v === '>') { p += 3; }
            let exprs = [];
            if (acceptOp('=')) exprs = parseExprList();
            return { t: 'Local', names, exprs, line };
          }
          case 'return': break; // handled in parseBlock
          case 'break': next(); return { t: 'Break', line };
          case 'goto': { next(); const name = expectName(); return { t: 'Goto', name, line }; }
          default: break;
        }
      }
      // exprstat: call or assignment
      const e = parseSuffixedExpr();
      if (isOp('=') || isOp(',')) {
        const targets = [e];
        while (acceptOp(',')) targets.push(parseSuffixedExpr());
        expectOp('=');
        const exprs = parseExprList();
        for (const t of targets) if (t.t !== 'Name' && t.t !== 'Index') throw new LuaError('cannot assign to this expression', line);
        return { t: 'Assign', targets, exprs, line };
      }
      if (e.t !== 'Call' && e.t !== 'Method') throw new LuaError('syntax error near "' + peek().v + '"', line);
      return { t: 'CallStat', expr: e, line };
    }

    function parseIf() {
      const line = next().line; // 'if'
      const clauses = [];
      let cond = parseExpr();
      expectKw('then');
      clauses.push({ cond, body: parseBlock() });
      let orelse = null;
      for (;;) {
        if (acceptKw('elseif')) {
          cond = parseExpr();
          expectKw('then');
          clauses.push({ cond, body: parseBlock() });
        } else if (acceptKw('else')) {
          orelse = parseBlock();
          expectKw('end');
          break;
        } else {
          expectKw('end');
          break;
        }
      }
      return { t: 'If', clauses, orelse, line };
    }

    function parseFor() {
      const line = next().line; // 'for'
      const n1 = expectName();
      if (isOp('=')) {
        next();
        const start = parseExpr();
        expectOp(',');
        const limit = parseExpr();
        let step = null;
        if (acceptOp(',')) step = parseExpr();
        expectKw('do');
        const body = parseBlock();
        expectKw('end');
        return { t: 'NumFor', name: n1, start, limit, step, body, line };
      }
      const names = [n1];
      while (acceptOp(',')) names.push(expectName());
      expectKw('in');
      const exprs = parseExprList();
      expectKw('do');
      const body = parseBlock();
      expectKw('end');
      return { t: 'GenFor', names, exprs, body, line };
    }

    function parseFuncBody(isMethod, line) {
      expectOp('(');
      const params = isMethod ? ['self'] : [];
      let vararg = false;
      if (!isOp(')')) {
        do {
          if (isOp('...')) { next(); vararg = true; break; }
          params.push(expectName());
        } while (acceptOp(','));
      }
      expectOp(')');
      const body = parseBlock();
      expectKw('end');
      return { params, vararg, body, line };
    }

    function parseExprList() {
      const list = [parseExpr()];
      while (acceptOp(',')) list.push(parseExpr());
      return list;
    }

    function parsePrimaryExpr() {
      const tk = peek();
      if (tk.k === 'name') { next(); return { t: 'Name', name: tk.v, line: tk.line }; }
      if (isOp('(')) {
        next();
        const e = parseExpr();
        expectOp(')');
        return { t: 'Paren', e, line: tk.line };
      }
      throw new LuaError('unexpected symbol near "' + tk.v + '"', tk.line);
    }

    function parseSuffixedExpr() {
      let e = parsePrimaryExpr();
      for (;;) {
        const tk = peek();
        if (tk.k === 'op') {
          if (tk.v === '.') { next(); e = { t: 'Index', obj: e, key: { t: 'Str', v: expectName() }, dot: true, line: tk.line }; continue; }
          if (tk.v === '[') { next(); const k = parseExpr(); expectOp(']'); e = { t: 'Index', obj: e, key: k, dot: false, line: tk.line }; continue; }
          if (tk.v === ':') { next(); const name = expectName(); const args = parseCallArgs(); e = { t: 'Method', obj: e, name, args, line: tk.line }; continue; }
          if (tk.v === '(' || tk.v === '{') { const args = parseCallArgs(); e = { t: 'Call', fn: e, args, line: tk.line }; continue; }
        } else if (tk.k === 'str') { const args = parseCallArgs(); e = { t: 'Call', fn: e, args, line: tk.line }; continue; }
        return e;
      }
    }

    function parseCallArgs() {
      const tk = peek();
      if (tk.k === 'str') { next(); return [{ t: 'Str', v: tk.v }]; }
      if (isOp('{')) return [parseTable()];
      expectOp('(');
      let args = [];
      if (!isOp(')')) args = parseExprList();
      expectOp(')');
      return args;
    }

    function parseTable() {
      const line = peek().line;
      expectOp('{');
      const items = []; // {kind:'pos'|'named'|'keyed', key?, value}
      while (!isOp('}')) {
        if (isOp('[')) {
          next();
          const key = parseExpr();
          expectOp(']');
          expectOp('=');
          items.push({ kind: 'keyed', key, value: parseExpr() });
        } else if (peek().k === 'name' && toks[p + 1].k === 'op' && toks[p + 1].v === '=') {
          const key = next().v;
          next();
          items.push({ kind: 'named', key, value: parseExpr() });
        } else {
          items.push({ kind: 'pos', value: parseExpr() });
        }
        if (!acceptOp(',') && !acceptOp(';')) break;
      }
      expectOp('}');
      return { t: 'Table', items, line };
    }

    function parseSimpleExpr() {
      const tk = peek();
      switch (tk.k) {
        case 'num': next(); return { t: 'Num', v: tk.v, raw: tk.raw, line: tk.line };
        case 'str': next(); return { t: 'Str', v: tk.v, line: tk.line };
        case 'kw':
          if (tk.v === 'nil') { next(); return { t: 'Nil' }; }
          if (tk.v === 'true') { next(); return { t: 'True' }; }
          if (tk.v === 'false') { next(); return { t: 'False' }; }
          if (tk.v === 'function') { next(); return { t: 'Func', fn: parseFuncBody(false, tk.line), line: tk.line }; }
          break;
        case 'op':
          if (tk.v === '...') { next(); return { t: 'Vararg', line: tk.line }; }
          if (tk.v === '{') return parseTable();
          break;
        default: break;
      }
      return parseSuffixedExpr();
    }

    function parseSubExpr(limit) {
      let left;
      const tk = peek();
      if ((tk.k === 'kw' && tk.v === 'not') || (tk.k === 'op' && (tk.v === '-' || tk.v === '#' || tk.v === '~'))) {
        next();
        const operand = parseSubExpr(UNARY_PRI);
        left = { t: 'Un', op: tk.v, e: operand, line: tk.line };
      } else left = parseSimpleExpr();
      for (;;) {
        const op = peek();
        const key = op.k === 'op' || op.k === 'kw' ? op.v : null;
        const pri = key && BIN_PRI[key];
        if (!pri || pri[0] <= limit) break;
        next();
        const right = parseSubExpr(pri[1]);
        left = { t: 'Bin', op: key, l: left, r: right, line: op.line };
      }
      return left;
    }

    function parseExpr() { return parseSubExpr(0); }

    const body = parseBlock();
    if (peek().k !== 'eof') throw new LuaError('"<eof>" expected near "' + peek().v + '"', peek().line);
    return { t: 'Chunk', body };
  }

  C.lua = { parse, tokenize, LuaError };
})(typeof window !== 'undefined' ? window : globalThis);
