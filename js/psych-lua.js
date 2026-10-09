/*
 * Lua AST -> HScript translator for Psych Engine scripts.
 *
 * The result is a set of *class members* (fields + methods) that script-gen.js drops into a V-Slice
 * Song / Module / Stage / SongEvent class. Every user function and global gets a per-script prefix
 * so several scripts can live in one class.
 *
 * Semantics that are approximated (documented in the report):
 *  - Lua tables become HScript arrays (1-based indexing is preserved by lua_idx/lua_setidx) or objects.
 *  - Truthiness: only nil/false are falsy in Lua; conditions are wrapped with __t() unless obviously boolean.
 *  - Lua string patterns are not supported (plain-text find/gsub/match/gmatch only).
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  const RESERVED = new Set(['var', 'function', 'class', 'new', 'this', 'null', 'true', 'false', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'import', 'package', 'in', 'is', 'cast', 'try', 'catch', 'throw', 'untyped', 'static', 'public', 'private', 'override', 'final', 'inline', 'extends', 'implements', 'enum', 'typedef', 'interface', 'abstract', 'using', 'macro', 'extern', 'dynamic', 'super', 'trace', 'Std', 'Math', 'Reflect', 'Type', 'String', 'Array', 'StringTools', 'FlxG', 'FlxTween', 'FlxEase', 'FlxTimer', 'FlxColor', 'FlxSprite', 'FlxText', 'PlayState', 'Conductor', 'Paths', 'event']);

  /** Psych callbacks we map to V-Slice events (see script-gen.js for the mapping). */
  const KNOWN_CALLBACKS = new Set([
    'onCreate', 'onCreatePost', 'onUpdate', 'onUpdatePost', 'onBeatHit', 'onStepHit', 'onSectionHit', 'onSongStart', 'onEndSong',
    'onStartCountdown', 'onCountdownStarted', 'onCountdownTick', 'goodNoteHit', 'opponentNoteHit', 'noteMiss', 'noteMissPress',
    'onEvent', 'onGameOver', 'onPause', 'onResume', 'onSpawnNote', 'onTimerCompleted', 'onTweenCompleted', 'onDestroy',
  ]);
  /** Psych callbacks that exist but have no V-Slice equivalent here. */
  const UNSUPPORTED_CALLBACKS = new Set([
    'onKeyPress', 'onKeyRelease', 'onKeyPressPre', 'onKeyReleasePre', 'onGhostTap', 'onUpdateScore', 'preUpdateScore',
    'onRecalculateRating', 'onNextDialogue', 'onSkipDialogue', 'onEventPushed', 'eventEarlyTrigger', 'goodNoteHitPre',
    'opponentNoteHitPre', 'onMoveCamera', 'onSoundFinished', 'onCustomSubstateCreate', 'onCustomSubstateUpdate', 'onCustomSubstateDestroy',
  ]);

  const STD_FN = {
    print: 'lua_print', tostring: 'lua_tostring', tonumber: 'lua_tonumber', type: 'lua_type', select: 'lua_select',
    unpack: 'lua_unpack', pcall: 'lua_pcall', error: 'lua_error', assert: 'lua_assert',
  };

  /** math.* / string.* / table.* / os.* templates: [expr builder, shim deps] */
  const LIB = {
    'math.floor': (a) => `Math.floor(${a[0]})`,
    'math.ceil': (a) => `Math.ceil(${a[0]})`,
    'math.abs': (a) => `Math.abs(${a[0]})`,
    'math.sqrt': (a) => `Math.sqrt(${a[0]})`,
    'math.sin': (a) => `Math.sin(${a[0]})`,
    'math.cos': (a) => `Math.cos(${a[0]})`,
    'math.tan': (a) => `Math.tan(${a[0]})`,
    'math.asin': (a) => `Math.asin(${a[0]})`,
    'math.acos': (a) => `Math.acos(${a[0]})`,
    'math.atan': (a) => `Math.atan(${a[0]})`,
    'math.atan2': (a) => `Math.atan2(${a[0]}, ${a[1]})`,
    'math.exp': (a) => `Math.exp(${a[0]})`,
    'math.log': (a) => `Math.log(${a[0]})`,
    'math.pow': (a) => `Math.pow(${a[0]}, ${a[1]})`,
    'math.max': (a) => (a.length === 2 ? `Math.max(${a[0]}, ${a[1]})` : `lua_max(${a.join(', ')})`),
    'math.min': (a) => (a.length === 2 ? `Math.min(${a[0]}, ${a[1]})` : `lua_min(${a.join(', ')})`),
    'math.random': (a) => `lua_random(${a.join(', ')})`,
    'math.randomseed': () => 'null',
    'math.rad': (a) => `lua_rad(${a[0]})`,
    'math.deg': (a) => `lua_deg(${a[0]})`,
    'math.fmod': (a) => `lua_fmod(${a[0]}, ${a[1]})`,
    'string.sub': (a) => `lua_sub(${a.join(', ')})`,
    'string.len': (a) => `lua_len(${a[0]})`,
    'string.upper': (a) => `Std.string(${a[0]}).toUpperCase()`,
    'string.lower': (a) => `Std.string(${a[0]}).toLowerCase()`,
    'string.rep': (a) => `lua_rep(${a[0]}, ${a[1]})`,
    'string.format': (a) => `lua_format(${a[0]}, [${a.slice(1).join(', ')}])`,
    'string.find': (a) => `lua_find(${a.join(', ')})`,
    'string.gsub': (a) => `lua_gsub(${a.join(', ')})`,
    'string.match': (a) => `lua_match(${a.join(', ')})`,
    'string.gmatch': (a) => `lua_gmatch(${a.join(', ')})`,
    'string.reverse': (a) => `lua_unsupportedStringReverse(${a[0]})`,
    'table.insert': (a) => `lua_tinsert(${a.join(', ')})`,
    'table.remove': (a) => `lua_tremove(${a.join(', ')})`,
    'table.concat': (a) => `lua_tconcat(${a.join(', ')})`,
    'table.sort': (a) => `lua_tsort(${a.join(', ')})`,
    'table.unpack': (a) => `lua_unpack(${a[0]})`,
    'os.time': () => 'lua_ostime()',
    'os.clock': () => 'lua_osclock()',
    'os.date': () => "''",
  };
  const LIB_SHIM = {
    'math.max': 'lua_max', 'math.min': 'lua_min', 'math.random': 'lua_random', 'math.rad': 'lua_rad', 'math.deg': 'lua_deg', 'math.fmod': 'lua_fmod',
    'string.sub': 'lua_sub', 'string.len': 'lua_len', 'string.rep': 'lua_rep', 'string.format': 'lua_format', 'string.find': 'lua_find',
    'string.gsub': 'lua_gsub', 'string.match': 'lua_match', 'string.gmatch': 'lua_gmatch',
    'table.insert': 'lua_tinsert', 'table.remove': 'lua_tremove', 'table.concat': 'lua_tconcat', 'table.sort': 'lua_tsort', 'table.unpack': 'lua_unpack',
    'os.time': 'lua_ostime', 'os.clock': 'lua_osclock',
  };
  const LIB_CONST = { 'math.pi': 'Math.PI', 'math.huge': 'Math.POSITIVE_INFINITY' };
  const STRING_METHODS = new Set(['sub', 'len', 'upper', 'lower', 'rep', 'format', 'find', 'gsub', 'match', 'gmatch']);

  function hsString(s) {
    let out = '"';
    for (const ch of String(s)) {
      const c = ch.codePointAt(0);
      if (ch === '\\') out += '\\\\';
      else if (ch === '"') out += '\\"';
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (c < 32) out += '\\x' + c.toString(16).padStart(2, '0');
      else out += ch;
    }
    return out + '"';
  }

  function hsNumber(v) {
    if (Number.isInteger(v) && Math.abs(v) < 2147483648) return String(v);
    if (!Number.isFinite(v)) return v > 0 ? 'Math.POSITIVE_INFINITY' : 'Math.NEGATIVE_INFINITY';
    const s = String(v);
    return /[.eE]/.test(s) ? s : s + '.0';
  }

  const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const isCmp = (op) => ['==', '~=', '<', '>', '<=', '>='].includes(op);

  class Translator {
    constructor(ast, opts) {
      this.ast = ast;
      this.opts = opts || {};
      this.prefix = this.opts.prefix || 's0_';
      this.used = new Set(); // shim names needed
      this.unsupported = new Map(); // name -> count
      this.warnings = [];
      this.callbacks = new Map(); // psych callback name -> {params}
      this.fields = new Set(); // prefixed script globals
      this.chunkFns = new Map(); // lua name -> params
      this.chunkVars = new Set(); // chunk-level locals
      this.assignedGlobals = new Set();
      this.objTables = new Set();
      this.scopes = []; // function-level scopes: array of Map(lua -> hs)
      this.tmp = 0;
      this.depthFn = 0;
      this.skipped = 0;
    }

    warn(msg) { this.warnings.push(msg); }
    unsup(name) { this.unsupported.set(name, (this.unsupported.get(name) || 0) + 1); }
    need(name) { this.used.add(name); }
    uid(p) { return '__' + p + (++this.tmp); }

    /* ---------------- pre-pass ---------------- */
    prepass() {
      for (const st of this.ast.body) {
        if (st.t === 'Function' && st.path.length === 1) this.chunkFns.set(st.path[0], st.fn.params);
        if (st.t === 'Local') st.names.forEach((n) => this.chunkVars.add(n));
      }
      // Deep walk of the whole AST: collect assigned globals and tables used with string keys (-> objects).
      const walk = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (n.t === 'Assign') {
          for (const tg of n.targets) {
            if (tg.t === 'Name') this.assignedGlobals.add(tg.name);
            if (tg.t === 'Index' && tg.obj.t === 'Name' && tg.key.t === 'Str') this.objTables.add(tg.obj.name);
          }
        }
        for (const k of Object.keys(n)) walk(n[k]);
      };
      walk(this.ast.body);
    }

    /* ---------------- names ---------------- */
    safeLocal(n) { return RESERVED.has(n) ? n + '_' : n; }
    declare(n) {
      const hs = this.safeLocal(n);
      this.scopes[this.scopes.length - 1].set(n, hs);
      return hs;
    }
    lookupLocal(n) {
      for (let i = this.scopes.length - 1; i >= 0; i--) if (this.scopes[i].has(n)) return this.scopes[i].get(n);
      return null;
    }
    globalName(n) {
      if (!this.chunkFns.has(n)) this.fields.add(this.prefix + n);
      return this.prefix + n;
    }

    /** Value read of a bare name. */
    readName(n) {
      const l = this.lookupLocal(n);
      if (l) return l;
      if (this.chunkFns.has(n) || this.chunkVars.has(n)) return this.globalName(n);
      if (C.PSYCH_GLOBALS && Object.prototype.hasOwnProperty.call(C.PSYCH_GLOBALS, n) && !this.assignedGlobals.has(n)) return n;
      if (C.psychShim.has(n) && !this.assignedGlobals.has(n)) { this.need(n); return n; }
      return this.globalName(n);
    }

    /** Assignment target name. */
    writeName(n) {
      const l = this.lookupLocal(n);
      if (l) return l;
      return this.globalName(n);
    }

    /* ---------------- expressions ---------------- */
    isPure(e) {
      return ['Nil', 'True', 'False', 'Num', 'Str', 'Name'].includes(e.t) || (e.t === 'Index' && this.isPure(e.obj) && (e.key.t === 'Str' || e.key.t === 'Num'));
    }

    isBoolean(e) {
      if (e.t === 'True' || e.t === 'False') return true;
      if (e.t === 'Bin' && (isCmp(e.op))) return true;
      if (e.t === 'Un' && e.op === 'not') return true;
      if (e.t === 'Bin' && (e.op === 'and' || e.op === 'or')) return this.isBoolean(e.l) && this.isBoolean(e.r);
      if (e.t === 'Paren') return this.isBoolean(e.e);
      return false;
    }

    cond(e) {
      switch (e.t) {
        case 'True': return 'true';
        case 'False': case 'Nil': return 'false';
        case 'Paren': return '(' + this.cond(e.e) + ')';
        case 'Un':
          if (e.op === 'not') return '!' + this.wrap(this.cond(e.e), e.e);
          break;
        case 'Bin':
          if (e.op === 'and') return '(' + this.cond(e.l) + ' && ' + this.cond(e.r) + ')';
          if (e.op === 'or') return '(' + this.cond(e.l) + ' || ' + this.cond(e.r) + ')';
          if (isCmp(e.op)) return this.expr(e);
          break;
        default: break;
      }
      return '__t(' + this.expr(e) + ')';
    }
    wrap(s, e) { return e.t === 'Bin' || e.t === 'Paren' ? (s.startsWith('(') ? s : '(' + s + ')') : s; }

    args(list) { return list.map((a) => this.expr(a)); }

    concatParts(e, out) {
      if (e.t === 'Bin' && e.op === '..') { this.concatParts(e.l, out); this.concatParts(e.r, out); } else out.push(e);
    }

    expr(e) {
      switch (e.t) {
        case 'Nil': return 'null';
        case 'True': return 'true';
        case 'False': return 'false';
        case 'Num': return hsNumber(e.v);
        case 'Str': return hsString(e.v);
        case 'Vararg': this.warn('line ' + (e.line || '?') + ': varargs (...) are not supported, using an empty list'); return '[]';
        case 'Paren': return '(' + this.expr(e.e) + ')';
        case 'Name': return this.readName(e.name);
        case 'Func': return this.anonFunction(e.fn);
        case 'Table': return this.table(e);
        case 'Un': {
          if (e.op === 'not') return '!' + this.wrap(this.cond(e.e), e.e);
          if (e.op === '#') { this.need('lua_len'); return 'lua_len(' + this.expr(e.e) + ')'; }
          if (e.op === '-') return '-' + this.wrap(this.expr(e.e), e.e);
          return '~' + this.wrap(this.expr(e.e), e.e);
        }
        case 'Bin': return this.binary(e);
        case 'Index': return this.index(e);
        case 'Call': return this.call(e);
        case 'Method': return this.methodCall(e);
        default: throw new Error('Unhandled expression ' + e.t);
      }
    }

    binary(e) {
      const op = e.op;
      if (op === 'and' || op === 'or') {
        // `c and x or y` -> ternary
        if (op === 'or' && e.l.t === 'Bin' && e.l.op === 'and') {
          return '(' + this.cond(e.l.l) + ' ? ' + this.expr(e.l.r) + ' : ' + this.expr(e.r) + ')';
        }
        if (this.isBoolean(e.l) && this.isBoolean(e.r)) return '(' + this.cond(e.l) + (op === 'and' ? ' && ' : ' || ') + this.cond(e.r) + ')';
        const fn = op === 'and' ? 'lua_and' : 'lua_or';
        if (this.isPure(e.r)) { this.need(fn); return fn + '(' + this.expr(e.l) + ', ' + this.expr(e.r) + ')'; }
        this.need(fn + 'f');
        return fn + 'f(' + this.expr(e.l) + ', function() { return ' + this.expr(e.r) + '; })';
      }
      if (op === '..') {
        const parts = [];
        this.concatParts(e, parts);
        this.need('lua_str');
        const out = parts.map((p) => (p.t === 'Str' ? hsString(p.v) : p.t === 'Num' ? hsString(String(p.v)) : 'lua_str(' + this.expr(p) + ')'));
        if (parts[0].t !== 'Str' && parts[0].t !== 'Num') return '(' + out.join(' + ') + ')';
        return '(' + out.join(' + ') + ')';
      }
      const l = this.wrap(this.expr(e.l), e.l);
      const r = this.wrap(this.expr(e.r), e.r);
      switch (op) {
        case '~=': return '(' + l + ' != ' + r + ')';
        case '==': return '(' + l + ' == ' + r + ')';
        case '^': return 'Math.pow(' + this.expr(e.l) + ', ' + this.expr(e.r) + ')';
        case '//': return 'Math.floor(' + l + ' / ' + r + ')';
        case '%': this.need('lua_mod'); return 'lua_mod(' + this.expr(e.l) + ', ' + this.expr(e.r) + ')';
        case '~': return '(' + l + ' ^ ' + r + ')';
        default: return '(' + l + ' ' + op + ' ' + r + ')';
      }
    }

    index(e) {
      // library constants (math.pi, math.huge)
      if (e.obj.t === 'Name' && e.key.t === 'Str' && !this.lookupLocal(e.obj.name)) {
        const k = e.obj.name + '.' + e.key.v;
        if (LIB_CONST[k]) return LIB_CONST[k];
      }
      if (e.key.t === 'Str' && IDENT.test(e.key.v) && !RESERVED.has(e.key.v)) return this.wrapObj(e.obj) + '.' + e.key.v;
      this.need('lua_idx');
      return 'lua_idx(' + this.expr(e.obj) + ', ' + this.expr(e.key) + ')';
    }
    wrapObj(o) {
      const s = this.expr(o);
      return o.t === 'Name' || o.t === 'Index' || o.t === 'Call' || o.t === 'Paren' || o.t === 'Method' ? s : '(' + s + ')';
    }

    table(e) {
      if (!e.items.length) return '{}'; // hybrid table: object with an optional __arr array part
      const allPos = e.items.every((i) => i.kind === 'pos');
      if (allPos) return '[' + e.items.map((i) => this.expr(i.value)).join(', ') + ']';
      const allStr = e.items.every((i) => i.kind === 'named' || (i.kind === 'keyed' && i.key.t === 'Str' && IDENT.test(i.key.v)));
      if (allStr) {
        return '{' + e.items.map((i) => (i.kind === 'named' ? i.key : i.key.v) + ': ' + this.expr(i.value)).join(', ') + '}';
      }
      // Mixed or numeric keys: build at runtime.
      this.need('lua_mk');
      let n = 0;
      const pairs = e.items.map((i) => {
        if (i.kind === 'pos') return '[' + ++n + ', ' + this.expr(i.value) + ']';
        if (i.kind === 'named') return '[' + hsString(i.key) + ', ' + this.expr(i.value) + ']';
        return '[' + this.expr(i.key) + ', ' + this.expr(i.value) + ']';
      });
      return 'lua_mk([' + pairs.join(', ') + '])';
    }

    anonFunction(fn) {
      const lines = this.functionBody(fn, 1);
      const params = fn.params.map((p) => '?' + this.safeLocal(p)).join(', ');
      return 'function(' + params + ') {\n' + lines.join('\n') + '\n' + this.indentStr(this.depthFn) + '}';
    }

    indentStr(n) { return '  '.repeat(n + 1); }

    /* ---------------- calls ---------------- */
    libKey(e) {
      if (e.t === 'Index' && e.obj.t === 'Name' && e.key.t === 'Str' && !this.lookupLocal(e.obj.name) && !this.chunkVars.has(e.obj.name)) return e.obj.name + '.' + e.key.v;
      return null;
    }

    call(e) {
      const fn = e.fn;
      const lk = this.libKey(fn);
      if (lk) {
        if (LIB[lk]) {
          if (LIB_SHIM[lk]) this.need(LIB_SHIM[lk]);
          if (lk === 'string.format' || lk === 'string.gsub') this.need('lua_str');
          if (lk === 'math.max' && e.args.length !== 2) this.need('lua_max');
          if (lk === 'math.min' && e.args.length !== 2) this.need('lua_min');
          return LIB[lk](this.args(e.args));
        }
        if (/^(io|os|debug|coroutine|package)\./.test(lk) || /^string\./.test(lk) || /^table\./.test(lk) || /^math\./.test(lk)) {
          this.unsup(lk);
          return '__unsupported(' + hsString(lk) + ')';
        }
      }
      if (fn.t === 'Name') {
        const name = fn.name;
        const local = this.lookupLocal(name);
        if (local) return local + '(' + this.args(e.args).join(', ') + ')';
        if (this.chunkFns.has(name) || this.chunkVars.has(name) || this.assignedGlobals.has(name)) {
          return this.globalName(name) + '(' + this.args(e.args).join(', ') + ')';
        }
        if (STD_FN[name]) {
          this.need(STD_FN[name]);
          return STD_FN[name] + '(' + this.args(e.args).join(', ') + ')';
        }
        if (C.psychShim.has(name)) {
          this.need(name);
          return name + '(' + this.args(e.args).join(', ') + ')';
        }
        this.unsup(name);
        return '__unsupported(' + hsString(name) + ')';
      }
      return this.wrapObj(fn) + '(' + this.args(e.args).join(', ') + ')';
    }

    methodCall(e) {
      if (STRING_METHODS.has(e.name)) {
        const key = 'string.' + e.name;
        if (LIB[key]) {
          if (LIB_SHIM[key]) this.need(LIB_SHIM[key]);
          if (key === 'string.format') this.need('lua_str');
          return LIB[key]([this.expr(e.obj), ...this.args(e.args)]);
        }
      }
      return this.wrapObj(e.obj) + '.' + e.name + '(' + this.args(e.args).join(', ') + ')';
    }

    /* ---------------- statements ---------------- */
    block(body, depth) {
      const lines = [];
      for (const st of body) this.stmt(st, depth, lines);
      return lines;
    }

    pad(depth) { return '  '.repeat(depth + 1); }

    withScope(fn) {
      this.scopes.push(new Map());
      const r = fn();
      this.scopes.pop();
      return r;
    }

    functionBody(fn, depth) {
      return this.withScope(() => {
        fn.params.forEach((p) => this.declare(p));
        const saved = this.depthFn;
        this.depthFn = depth;
        const lines = this.block(fn.body, depth + 1);
        this.depthFn = saved;
        return lines;
      });
    }

    shouldSkip(st) {
      const skip = this.opts.skipCall;
      if (!skip || st.t !== 'CallStat' || st.expr.t !== 'Call' || st.expr.fn.t !== 'Name') return false;
      const first = st.expr.args[0];
      return skip(st.expr.fn.name, first && first.t === 'Str' ? first.v : null, this.top);
    }

    stmt(st, depth, out) {
      const p = this.pad(depth);
      switch (st.t) {
        case 'Local': {
          // declare after evaluating the right-hand side (Lua scoping)
          const vals = st.exprs.map((x) => this.expr(x));
          st.names.forEach((n, i) => {
            const v = vals[i] !== undefined ? vals[i] : 'null';
            if (this.scopes.length === 0) {
              out.push(p + this.globalName(n) + ' = ' + (st.exprs[i] && st.exprs[i].t === 'Table' && !st.exprs[i].items.length && this.objTables.has(n) ? '{}' : v) + ';');
            } else {
              const hs = this.declare(n);
              const init = st.exprs[i] && st.exprs[i].t === 'Table' && !st.exprs[i].items.length && this.objTables.has(n) ? '{}' : v;
              out.push(p + 'var ' + hs + ' = ' + init + ';');
            }
          });
          break;
        }
        case 'Assign': {
          if (st.targets.length === 1 && st.exprs.length >= 1) {
            out.push(p + this.assignTo(st.targets[0], st.exprs[0]) + ';');
            break;
          }
          const tmps = st.exprs.map((x) => {
            const t = this.uid('t');
            out.push(p + 'var ' + t + ' = ' + this.expr(x) + ';');
            return t;
          });
          st.targets.forEach((tg, i) => out.push(p + this.assignRaw(tg, tmps[i] !== undefined ? tmps[i] : 'null') + ';'));
          break;
        }
        case 'CallStat':
          if (this.shouldSkip(st)) { this.skipped++; break; }
          out.push(p + this.expr(st.expr) + ';');
          break;
        case 'Do':
          out.push(p + '{');
          this.withScope(() => out.push(...this.block(st.body, depth + 1)));
          out.push(p + '}');
          break;
        case 'While':
          out.push(p + 'while (' + this.cond(st.cond) + ') {');
          this.withScope(() => out.push(...this.block(st.body, depth + 1)));
          out.push(p + '}');
          break;
        case 'Repeat':
          out.push(p + 'while (true) {');
          this.withScope(() => {
            out.push(...this.block(st.body, depth + 1));
            out.push(this.pad(depth + 1) + 'if (' + this.cond(st.cond) + ') { break; }');
          });
          out.push(p + '}');
          break;
        case 'If': {
          st.clauses.forEach((c, i) => {
            out.push(p + (i === 0 ? 'if (' : '} else if (') + this.cond(c.cond) + ') {');
            this.withScope(() => out.push(...this.block(c.body, depth + 1)));
          });
          if (st.orelse) {
            out.push(p + '} else {');
            this.withScope(() => out.push(...this.block(st.orelse, depth + 1)));
          }
          out.push(p + '}');
          break;
        }
        case 'NumFor': {
          const i = this.uid('i');
          const lim = this.uid('lim');
          const stp = this.uid('stp');
          out.push(p + '{');
          const q = this.pad(depth + 1);
          out.push(q + 'var ' + i + ' = ' + this.expr(st.start) + ';');
          out.push(q + 'var ' + lim + ' = ' + this.expr(st.limit) + ';');
          const positive = !st.step || (st.step.t === 'Num' && st.step.v > 0);
          if (st.step) out.push(q + 'var ' + stp + ' = ' + this.expr(st.step) + ';');
          const test = positive ? i + ' <= ' + lim : st.step.t === 'Num' || (st.step.t === 'Un' && st.step.e.t === 'Num') ? i + ' >= ' + lim : '(' + stp + ' > 0 ? ' + i + ' <= ' + lim + ' : ' + i + ' >= ' + lim + ')';
          out.push(q + 'while (' + test + ') {');
          this.withScope(() => {
            const hs = this.declare(st.name);
            out.push(this.pad(depth + 2) + 'var ' + hs + ' = ' + i + ';');
            out.push(...this.block(st.body, depth + 2));
            out.push(this.pad(depth + 2) + i + ' += ' + (st.step ? stp : '1') + ';');
          });
          out.push(q + '}');
          out.push(p + '}');
          break;
        }
        case 'GenFor': {
          const e0 = st.exprs[0];
          let iter;
          if (e0 && e0.t === 'Call' && e0.fn.t === 'Name' && (e0.fn.name === 'pairs' || e0.fn.name === 'ipairs') && e0.args.length === 1 && !this.lookupLocal(e0.fn.name)) {
            const fn = e0.fn.name === 'pairs' ? 'lua_pairs' : 'lua_ipairs';
            this.need(fn);
            iter = fn + '(' + this.expr(e0.args[0]) + ')';
          } else if (e0 && e0.t === 'Call' && this.libKey(e0.fn) === 'string.gmatch') {
            this.need('lua_gmatch');
            iter = this.expr(e0);
          } else {
            this.need('lua_pairs');
            this.warn('line ' + st.line + ': generic for-loop iterator is not pairs/ipairs; treated as pairs()');
            iter = 'lua_pairs(' + this.expr(e0) + ')';
          }
          const pv = this.uid('p');
          out.push(p + 'for (' + pv + ' in ' + iter + ') {');
          this.withScope(() => {
            const gmatch = this.libKey(e0 && e0.fn) === 'string.gmatch';
            st.names.forEach((n, idx) => {
              const hs = this.declare(n);
              out.push(this.pad(depth + 1) + 'var ' + hs + ' = ' + (gmatch ? pv : pv + '[' + idx + ']') + ';');
            });
            out.push(...this.block(st.body, depth + 1));
          });
          out.push(p + '}');
          break;
        }
        case 'Function': this.functionStmt(st, depth, out); break;
        case 'Return': {
          if (!st.exprs.length) out.push(p + 'return;');
          else {
            if (st.exprs.length > 1) this.warn('line ' + st.line + ': multiple return values are not supported; returning the first');
            out.push(p + 'return ' + this.expr(st.exprs[0]) + ';');
          }
          break;
        }
        case 'Break': out.push(p + 'break;'); break;
        case 'Goto': case 'Label': this.warn('line ' + st.line + ': goto/labels are not supported'); break;
        default: throw new Error('Unhandled statement ' + st.t);
      }
    }

    assignRaw(target, valueStr) {
      if (target.t === 'Name') return this.writeName(target.name) + ' = ' + valueStr;
      // Index
      if (target.key.t === 'Str' && IDENT.test(target.key.v) && !RESERVED.has(target.key.v)) return this.wrapObj(target.obj) + '.' + target.key.v + ' = ' + valueStr;
      this.need('lua_setidx');
      return 'lua_setidx(' + this.expr(target.obj) + ', ' + this.expr(target.key) + ', ' + valueStr + ')';
    }
    assignTo(target, valueExpr) {
      let v = this.expr(valueExpr);
      if (target.t === 'Name' && valueExpr.t === 'Table' && !valueExpr.items.length && this.objTables.has(target.name)) v = '{}';
      return this.assignRaw(target, v);
    }

    functionStmt(st, depth, out) {
      const p = this.pad(depth);
      const isChunk = this.scopes.length === 0;
      if (st.path.length === 1 && isChunk) {
        const name = st.path[0];
        const hs = this.prefix + name;
        if (KNOWN_CALLBACKS.has(name)) this.callbacks.set(name, { params: st.fn.params });
        else if (UNSUPPORTED_CALLBACKS.has(name)) this.warn('callback "' + name + '" has no V-Slice equivalent and will never run');
        const params = st.fn.params.map((x) => '?' + this.safeLocal(x)).join(', ');
        const body = this.functionBody(st.fn, 0);
        out.push('  function ' + hs + '(' + params + ') {');
        out.push(...body);
        out.push('  }');
        return;
      }
      // Local function inside another function: closure assigned to a local variable.
      if (st.path.length === 1) {
        const hs = this.declare(st.path[0]);
        out.push(p + 'var ' + hs + ' = null;');
        out.push(p + hs + ' = ' + this.anonFunction(st.fn) + ';');
        return;
      }
      // function a.b.c() / a:b() -> assign closure to a table field
      const target = { t: 'Name', name: st.path[0] };
      let obj = target;
      for (let i = 1; i < st.path.length - 1; i++) obj = { t: 'Index', obj, key: { t: 'Str', v: st.path[i] }, dot: true };
      const last = { t: 'Index', obj, key: { t: 'Str', v: st.path[st.path.length - 1] }, dot: true };
      out.push(p + this.assignRaw(last, this.anonFunction(st.fn)) + ';');
    }

    /* ---------------- top level ---------------- */
    run() {
      this.prepass();
      const fnLines = [];
      const mainLines = [];
      for (const st of this.ast.body) {
        if (st.t === 'Function' && st.path.length === 1) {
          this.top = st.path[0];
          this.functionStmt(st, 0, fnLines);
        } else {
          this.top = '__main';
          this.stmt(st, 0, mainLines);
        }
      }
      const out = [];
      for (const f of [...this.fields].sort()) out.push('  var ' + f + ';');
      this.mainCount = mainLines.length;
      out.push('  function ' + this.prefix + '__main() {');
      out.push(...mainLines);
      out.push('  }');
      out.push(...fnLines);
      return out.join('\n');
    }
  }

  /**
   * @param {string} source Lua source
   * @param {{prefix?:string, skipCall?:function(string,string):boolean}} opts
   */
  function translate(source, opts) {
    const ast = C.lua.parse(source);
    const t = new Translator(ast, opts);
    const members = t.run();
    return {
      members,
      callbacks: t.callbacks,
      used: t.used,
      unsupported: t.unsupported,
      warnings: t.warnings,
      fields: t.fields,
      skippedStatic: t.skipped,
      prefix: t.prefix,
      mainFn: t.prefix + '__main',
      hasMainStatements: t.mainCount > 0,
    };
  }

  C.psychLua = { translate, KNOWN_CALLBACKS, UNSUPPORTED_CALLBACKS, hsString, hsNumber };
})(typeof window !== 'undefined' ? window : globalThis);
