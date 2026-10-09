/*
 * Codename Engine HScript (.hx) -> V-Slice HScript (.hxc) classes.
 *
 * Codename scripts are flat files: top-level `var`s, `function`s and loose statements, run with PlayState as
 * their parent object. V-Slice scripts are classes. The transformer therefore:
 *   1. splits the file into imports / fields / functions / statements with a small Haxe tokenizer,
 *   2. wraps them in a class (Module for global/song scripts, Stage, SongEvent, NoteKind),
 *   3. renames lifecycle callbacks (create, update, beatHit, onPlayerHit...) to `__cn_*` and dispatches them from the
 *      matching V-Slice events,
 *   4. rewrites the most common Codename globals/APIs (health, Conductor.*, camGame, boyfriend, add()...),
 *   5. reports whatever it could not translate.
 *
 * This is a best-effort port: the generated files are meant to be a working starting point, not a guarantee.
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  /* ------------------------------------------------------------------ */
  /* Tokenizer                                                           */
  /* ------------------------------------------------------------------ */
  const ID_START = /[A-Za-z_$]/;
  const ID_PART = /[A-Za-z0-9_$]/;

  function tokenize(src) {
    const toks = [];
    let i = 0;
    const n = src.length;

    function readString(q) {
      // returns end index (exclusive) of a string starting at i (src[i] === q)
      let j = i + 1;
      while (j < n) {
        const c = src[j];
        if (c === '\\') { j += 2; continue; }
        if (c === q) return j + 1;
        if (q === "'" && c === '$' && src[j + 1] === '{') {
          // interpolation: skip balanced braces, honouring nested strings
          let depth = 1;
          j += 2;
          while (j < n && depth > 0) {
            const d = src[j];
            if (d === '{') depth++;
            else if (d === '}') depth--;
            else if (d === '"' || d === "'") {
              const save = i;
              i = j;
              j = readString(d);
              i = save;
              continue;
            }
            j++;
          }
          continue;
        }
        j++;
      }
      return n;
    }

    while (i < n) {
      const c = src[i];
      if (/\s/.test(c)) {
        let j = i + 1;
        while (j < n && /\s/.test(src[j])) j++;
        toks.push({ k: 'ws', t: src.slice(i, j) });
        i = j;
      } else if (c === '/' && src[i + 1] === '/') {
        let j = i;
        while (j < n && src[j] !== '\n') j++;
        toks.push({ k: 'comment', t: src.slice(i, j) });
        i = j;
      } else if (c === '/' && src[i + 1] === '*') {
        const j = src.indexOf('*/', i + 2);
        const end = j < 0 ? n : j + 2;
        toks.push({ k: 'comment', t: src.slice(i, end) });
        i = end;
      } else if (c === '"' || c === "'") {
        const end = readString(c);
        toks.push({ k: 'str', t: src.slice(i, end) });
        i = end;
      } else if (c === '~' && src[i + 1] === '/') {
        let j = i + 2;
        while (j < n && src[j] !== '/') j += src[j] === '\\' ? 2 : 1;
        j++;
        while (j < n && /[a-z]/.test(src[j])) j++;
        toks.push({ k: 'str', t: src.slice(i, j) });
        i = j;
      } else if (ID_START.test(c)) {
        let j = i + 1;
        while (j < n && ID_PART.test(src[j])) j++;
        toks.push({ k: 'id', t: src.slice(i, j) });
        i = j;
      } else if (/[0-9]/.test(c)) {
        let j = i + 1;
        while (j < n && /[0-9a-fA-FxX._]/.test(src[j]) && !(src[j] === '.' && src[j + 1] === '.')) j++;
        toks.push({ k: 'num', t: src.slice(i, j) });
        i = j;
      } else {
        toks.push({ k: 'p', t: c });
        i++;
      }
    }
    return toks;
  }

  const isTrivia = (t) => t.k === 'ws' || t.k === 'comment';
  const OPEN = { '(': ')', '[': ']', '{': '}' };

  /** Index just after the matching close of the opener at toks[i]. */
  function skipBalanced(toks, i) {
    const open = toks[i].t;
    const close = OPEN[open];
    let depth = 0;
    for (let j = i; j < toks.length; j++) {
      const t = toks[j];
      if (t.k !== 'p') continue;
      if (t.t === open) depth++;
      else if (t.t === close) {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    return toks.length;
  }

  function nextSig(toks, i) {
    while (i < toks.length && isTrivia(toks[i])) i++;
    return i;
  }

  /** End index (exclusive) of the statement starting at toks[i]. */
  function statementEnd(toks, i) {
    i = nextSig(toks, i);
    const t = toks[i];
    if (!t) return i;
    if (t.k === 'p' && t.t === '{') return skipBalanced(toks, i);
    if (t.k === 'id' && (t.t === 'if' || t.t === 'for' || t.t === 'while' || t.t === 'switch')) {
      let j = nextSig(toks, i + 1);
      if (toks[j] && toks[j].t === '(') j = skipBalanced(toks, j);
      if (t.t === 'switch') {
        j = nextSig(toks, j);
        return toks[j] && toks[j].t === '{' ? skipBalanced(toks, j) : j;
      }
      j = statementEnd(toks, j);
      if (t.t === 'if') {
        const k = nextSig(toks, j);
        if (toks[k] && toks[k].k === 'id' && toks[k].t === 'else') return statementEnd(toks, k + 1);
      }
      return j;
    }
    if (t.k === 'id' && t.t === 'try') {
      let j = statementEnd(toks, i + 1);
      for (;;) {
        const k = nextSig(toks, j);
        if (toks[k] && toks[k].k === 'id' && toks[k].t === 'catch') {
          let m = nextSig(toks, k + 1);
          if (toks[m] && toks[m].t === '(') m = skipBalanced(toks, m);
          j = statementEnd(toks, m);
        } else break;
      }
      return j;
    }
    // expression statement: up to the next ';' at depth 0
    let j = i;
    while (j < toks.length) {
      const x = toks[j];
      if (x.k === 'p') {
        if (x.t === ';') return j + 1;
        if (OPEN[x.t]) { j = skipBalanced(toks, j); continue; }
      }
      j++;
    }
    return j;
  }

  const join = (toks, a, b) => toks.slice(a, b).map((x) => x.t).join('');

  /* ------------------------------------------------------------------ */
  /* Splitting a Codename script                                         */
  /* ------------------------------------------------------------------ */
  const MODS = new Set(['public', 'private', 'static', 'inline', 'override', 'dynamic', 'final', 'extern']);

  function splitScript(src) {
    const toks = tokenize(src);
    const items = [];
    let i = 0;
    while (i < toks.length) {
      i = nextSig(toks, i);
      if (i >= toks.length) break;
      const t = toks[i];
      if (t.k === 'id' && (t.t === 'import' || t.t === 'using')) {
        let j = i;
        while (j < toks.length && !(toks[j].k === 'p' && toks[j].t === ';')) j++;
        items.push({ kind: 'import', text: join(toks, i, j) });
        i = j + 1;
        continue;
      }
      // modifiers
      let j = i;
      const mods = [];
      while (toks[j] && toks[j].k === 'id' && MODS.has(toks[j].t) && toks[nextSig(toks, j + 1)] && toks[nextSig(toks, j + 1)].k === 'id') {
        mods.push(toks[j].t);
        j = nextSig(toks, j + 1);
      }
      const kw = toks[j];
      if (kw && kw.k === 'id' && (kw.t === 'var' || (kw.t === 'final' && toks[nextSig(toks, j + 1)] && toks[nextSig(toks, j + 1)].t !== '('))) {
        // field(s)
        let k = nextSig(toks, j + 1);
        const nameTok = toks[k];
        const nameIdx = k;
        k++;
        // optional ": Type"
        let typeText = '';
        let m = nextSig(toks, k);
        if (toks[m] && toks[m].t === ':') {
          let e = m + 1;
          let depth = 0;
          while (e < toks.length) {
            const x = toks[e];
            if (x.k === 'p') {
              if (x.t === '<' || x.t === '(') depth++;
              else if (x.t === '>' || x.t === ')') depth--;
              else if ((x.t === '=' || x.t === ';' || x.t === ',') && depth <= 0) break;
            }
            e++;
          }
          typeText = join(toks, m, e).trim();
          m = nextSig(toks, e);
        }
        let initText = null;
        let end;
        if (toks[m] && toks[m].t === '=') {
          let e = m + 1;
          while (e < toks.length) {
            const x = toks[e];
            if (x.k === 'p') {
              if (x.t === ';') break;
              if (OPEN[x.t]) { e = skipBalanced(toks, e); continue; }
            }
            e++;
          }
          initText = join(toks, m + 1, e).trim();
          end = e + 1;
        } else {
          let e = m;
          while (e < toks.length && !(toks[e].k === 'p' && toks[e].t === ';')) e++;
          end = e + 1;
        }
        items.push({ kind: 'var', name: nameTok.t, mods, type: typeText, init: initText });
        i = end;
        continue;
      }
      if (kw && kw.k === 'id' && kw.t === 'function') {
        let k = nextSig(toks, j + 1);
        if (toks[k] && toks[k].k === 'id') {
          const name = toks[k].t;
          k = nextSig(toks, k + 1);
          let params = '()';
          if (toks[k] && toks[k].t === '(') {
            const e = skipBalanced(toks, k);
            params = join(toks, k, e);
            k = e;
          }
          // optional return type
          let m = nextSig(toks, k);
          if (toks[m] && toks[m].t === ':') {
            let e = m + 1;
            let depth = 0;
            while (e < toks.length) {
              const x = toks[e];
              if (x.k === 'p') {
                if (x.t === '<') depth++;
                else if (x.t === '>') depth--;
                else if ((x.t === '{' || x.t === ';') && depth <= 0) break;
              }
              e++;
            }
            k = e;
          }
          const bodyStart = nextSig(toks, k);
          const bodyEnd = statementEnd(toks, bodyStart);
          const body = join(toks, bodyStart, bodyEnd).trim();
          items.push({ kind: 'fn', name, params, body, mods });
          i = bodyEnd;
          continue;
        }
      }
      // loose statement
      const end = statementEnd(toks, i);
      items.push({ kind: 'stmt', text: join(toks, i, Math.max(end, i + 1)).trim() });
      i = Math.max(end, i + 1);
    }
    return items;
  }

  /* ------------------------------------------------------------------ */
  /* Identifier rewriting                                                */
  /* ------------------------------------------------------------------ */
  const REWRITE = {
    health: 'PlayState.instance.health',
    songScore: 'PlayState.instance.songScore',
    camFollow: 'PlayState.instance.cameraFollowPoint',
    defaultCamZoom: 'PlayState.instance.currentCameraZoom',
    curBeatFloat: 'Conductor.instance.currentBeatTime',
    curStepFloat: 'Conductor.instance.currentStepTime',
    curBeat: 'Conductor.instance.currentBeat',
    curStep: 'Conductor.instance.currentStep',
    curMeasure: 'Conductor.instance.currentMeasure',
    inst: 'FlxG.sound.music',
    vocals: 'PlayState.instance.vocals',
    generatedMusic: 'PlayState.instance.generatedMusic',
  };
  const CONDUCTOR_MAP = {
    songPosition: 'songPosition', bpm: 'bpm', crochet: 'beatLengthMs', stepCrochet: 'stepLengthMs', curBeat: 'currentBeat',
    curStep: 'currentStep', curMeasure: 'currentMeasure', curBeatFloat: 'currentBeatTime', curStepFloat: 'currentStepTime',
    beatsPerMeasure: 'beatsPerMeasure',
  };
  const PATH_MAP = { 'Paths.getFrames': 'Paths.getSparrowAtlas', 'Paths.getSparrowAtlas': 'Paths.getSparrowAtlas' };
  const UNSUPPORTED_API = ['Options', 'CoolUtil', 'importScript', 'CustomShader', 'HudCamera', 'MusicBeatState', 'ModState', 'PauseSubState', 'GameOverSubstate', 'Alphabet', 'WindowUtils', 'NdllUtil', 'Flags', 'Logs', 'PlayState.SONG', 'strumLines.members', 'FunkinText', 'Note', 'Strum', 'EventManager'];

  /** Class imports that map directly to V-Slice. Anything else under funkin.* is dropped with a warning. */
  const IMPORT_MAP = {
    'funkin.game.PlayState': 'funkin.play.PlayState',
    'funkin.backend.assets.Paths': 'funkin.Paths',
    'funkin.backend.system.Conductor': 'funkin.Conductor',
    'funkin.backend.FunkinSprite': 'funkin.graphics.FunkinSprite',
    'funkin.game.Character': 'funkin.play.character.BaseCharacter',
  };

  function collectDeclared(toks) {
    const declared = new Set();
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.k !== 'id') continue;
      if (t.t === 'var' || t.t === 'final') {
        const j = nextSig(toks, i + 1);
        if (toks[j] && toks[j].k === 'id') declared.add(toks[j].t);
      } else if (t.t === 'function') {
        let j = nextSig(toks, i + 1);
        if (toks[j] && toks[j].k === 'id') j = nextSig(toks, j + 1);
        if (toks[j] && toks[j].t === '(') {
          const e = skipBalanced(toks, j);
          for (let k = j + 1; k < e; k++) if (toks[k].k === 'id' && (toks[k - 1].t === '(' || toks[k - 1].t === ',' || toks[k - 1].t === '?' || (toks[k - 1].k === 'ws' && (toks[k - 2].t === ',' || toks[k - 2].t === '(' || toks[k - 2].t === '?')))) declared.add(toks[k].t);
        }
      } else if (t.t === 'for' || t.t === 'catch') {
        const j = nextSig(toks, i + 1);
        if (toks[j] && toks[j].t === '(') {
          const k = nextSig(toks, j + 1);
          if (toks[k] && toks[k].k === 'id') declared.add(toks[k].t);
          // for (key => value in map)
          const l = nextSig(toks, k + 1);
          if (toks[l] && toks[l].t === '=') {
            const m = nextSig(toks, l + 2);
            if (toks[m] && toks[m].k === 'id') declared.add(toks[m].t);
          }
        }
      }
    }
    return declared;
  }

  /** Rewrites Codename globals in a code fragment. Returns the new text and records usage in `found`. */
  function rewrite(code, declared, found) {
    const toks = tokenize(code);
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.k !== 'id') { out.push(t.t); continue; }
      // previous significant token
      let p = i - 1;
      while (p >= 0 && isTrivia(toks[p])) p--;
      const afterDot = p >= 0 && toks[p].t === '.';
      if (afterDot) { out.push(t.t); continue; }

      const n1 = nextSig(toks, i + 1);
      // Conductor.<prop>
      if (t.t === 'Conductor' && toks[n1] && toks[n1].t === '.') {
        const n2 = nextSig(toks, n1 + 1);
        if (toks[n2] && toks[n2].k === 'id' && toks[n2].t !== 'instance' && CONDUCTOR_MAP[toks[n2].t]) {
          out.push('Conductor.instance.' + CONDUCTOR_MAP[toks[n2].t]);
          i = n2;
          continue;
        }
      }
      // Paths.getFrames -> Paths.getSparrowAtlas
      if (t.t === 'Paths' && toks[n1] && toks[n1].t === '.') {
        const n2 = nextSig(toks, n1 + 1);
        if (toks[n2] && PATH_MAP['Paths.' + toks[n2].t]) {
          out.push(PATH_MAP['Paths.' + toks[n2].t]);
          i = n2;
          continue;
        }
      }
      // PlayState.SONG etc. are reported, not rewritten
      if (UNSUPPORTED_API.includes(t.t) && !declared.has(t.t)) found.add(t.t);
      if (t.t === 'PlayState' && toks[n1] && toks[n1].t === '.') {
        const n2 = nextSig(toks, n1 + 1);
        if (toks[n2] && toks[n2].t === 'SONG') found.add('PlayState.SONG');
      }
      if (REWRITE[t.t] && !declared.has(t.t)) {
        out.push(REWRITE[t.t]);
        continue;
      }
      out.push(t.t);
    }
    return out.join('');
  }

  /* ------------------------------------------------------------------ */
  /* Callback mapping                                                    */
  /* ------------------------------------------------------------------ */
  const CALLBACKS = new Set([
    'create', 'postCreate', 'update', 'postUpdate', 'beatHit', 'stepHit', 'measureHit', 'destroy',
    'onSongStart', 'onSongEnd', 'onGameOver', 'onStartCountdown', 'onCountdown', 'onNoteHit', 'onPlayerHit', 'onDadHit', 'onPlayerMiss', 'onEvent', 'onPostEvent',
  ]);
  const UNSUPPORTED_CALLBACKS = new Set([
    'draw', 'postDraw', 'onNoteCreation', 'onPostNoteCreation', 'onStrumCreation', 'onPostStrumCreation', 'onCameraMove', 'onRatingsShown',
    'onSubstateOpen', 'onSubstateClose', 'onPostSubstateOpen', 'onPostSubstateClose', 'onFocusGained', 'onFocusLost', 'onPostCountdown', 'onInputUpdate',
    'onPreGenerateStrums', 'onPostGenerateStrums', 'onGamePause', 'onGameOverStart', 'onGameOverUpdate', 'onGameOverEnd', 'onStrumCreate',
    'onDance', 'onTryDance', 'onPlayAnim', 'onPlaySingAnim', 'onGetCamPos', 'onCharacterXMLParsed', 'onStageXMLParsed', 'onCharacterNodeParsed', 'onStageNodeParsed',
    'onDiscordPresenceUpdate', 'onPreStateSwitch', 'onPostStateSwitch', 'onResizeGame', 'preStateSwitch', 'postStateSwitch', 'onPlayerShot',
  ]);

  /** Per-script analysis result. */
  function analyze(src, label) {
    const toks = tokenize(src);
    const declared = collectDeclared(toks);
    const items = splitScript(src);
    const found = new Set();
    const fields = [];
    const fnDefs = [];
    const main = [];
    const imports = [];
    const warnings = [];
    const callbacks = new Map();

    for (const it of items) {
      if (it.kind === 'import') {
        const m = /^(?:import|using)\s+([\w.]+)/.exec(it.text);
        const path = m ? m[1] : '';
        const mapped = IMPORT_MAP[path];
        if (/^using\b/.test(it.text)) { imports.push(null); continue; }
        if (mapped) imports.push('import ' + mapped + ';');
        else if (/^(flixel|haxe|openfl|lime|funkin\.(play|graphics|audio|Paths|Conductor|util|ui|data|modding))\./.test(path) || /^[A-Z]/.test(path)) imports.push('import ' + path + ';');
        else {
          warnings.push('import "' + path + '" was dropped (Codename-only class)');
          found.add(path.split('.').pop());
        }
      } else if (it.kind === 'var') {
        fields.push({ name: it.name, type: it.type, mods: it.mods });
        if (it.init !== null) main.push(it.name + ' = ' + rewrite(it.init, declared, found) + ';');
      } else if (it.kind === 'fn') {
        const rewritten = rewrite(it.body, declared, found);
        const isCb = CALLBACKS.has(it.name);
        if (isCb) callbacks.set(it.name, { params: it.params });
        else if (UNSUPPORTED_CALLBACKS.has(it.name)) warnings.push('callback "' + it.name + '" has no V-Slice equivalent and will never run');
        const unsupportedCb = UNSUPPORTED_CALLBACKS.has(it.name);
        fnDefs.push({ name: isCb ? '__cn_' + it.name : unsupportedCb ? '__cn_unsupported_' + it.name : it.name, params: it.params, body: rewritten, original: it.name });
      } else {
        main.push(rewrite(it.text, declared, found));
      }
    }
    return { fields, fnDefs, main, imports: imports.filter(Boolean), warnings, callbacks, found, label };
  }

  /* ------------------------------------------------------------------ */
  /* Class emission                                                      */
  /* ------------------------------------------------------------------ */
  const q = (s) => C.psychLua.hsString(s);

  const BASE_IMPORTS = [
    'flixel.FlxG', 'flixel.FlxSprite', 'flixel.text.FlxText', 'flixel.tweens.FlxEase', 'flixel.tweens.FlxTween', 'flixel.util.FlxColor', 'flixel.util.FlxTimer',
    'funkin.Conductor', 'funkin.Paths', 'funkin.audio.FunkinSound', 'funkin.graphics.FunkinSprite', 'funkin.play.PlayState',
  ];

  function prelude(opts) {
    const stageVars = (opts.stageSprites || []).map((n) => '  var ' + n + ';').join('\n');
    return (
      '  var boyfriend; var dad; var gf; var stage; var camGame; var camHUD; var iconP1; var iconP2;\n' +
      '  var strumLines; var playerStrums; var cpuStrums;\n' + stageVars + '\n\n' +
      '  function add(o) { PlayState.instance.add(o); return o; }\n' +
      '  function insert(i, o) { PlayState.instance.add(o); return o; }\n' +
      '  function remove(o) { PlayState.instance.remove(o); return o; }\n\n' +
      '  // Binds the Codename-style globals to the running V-Slice PlayState.\n' +
      '  function __cnBind() {\n' +
      '    var ps = PlayState.instance;\n    if (ps == null) return;\n' +
      '    camGame = ps.camGame; camHUD = ps.camHUD; iconP1 = ps.iconP1; iconP2 = ps.iconP2;\n' +
      '    if (ps.currentStage != null) {\n' +
      '      boyfriend = ps.currentStage.getBoyfriend(); dad = ps.currentStage.getDad(); gf = ps.currentStage.getGirlfriend();\n' +
      '      stage = ps.currentStage;\n' +
      (opts.stageSprites || []).map((n) => '      ' + n + ' = ps.currentStage.getNamedProp(' + q(n) + ');').join('\n') + '\n' +
      '    }\n' +
      '    var opp = {characters: [dad], cpu: true, notes: ps.opponentStrumline.notes, members: [ps.opponentStrumline.getByIndex(0), ps.opponentStrumline.getByIndex(1), ps.opponentStrumline.getByIndex(2), ps.opponentStrumline.getByIndex(3)]};\n' +
      '    var ply = {characters: [boyfriend], cpu: false, notes: ps.playerStrumline.notes, members: [ps.playerStrumline.getByIndex(0), ps.playerStrumline.getByIndex(1), ps.playerStrumline.getByIndex(2), ps.playerStrumline.getByIndex(3)]};\n' +
      '    strumLines = {members: [opp, ply]};\n    cpuStrums = opp; playerStrums = ply;\n' +
      '  }\n\n' +
      '  // Builds a Codename-style note event from a V-Slice note event.\n' +
      '  function __cnNoteEvent(event, isPlayer) {\n' +
      '    var nd = event.note.noteData;\n' +
      '    var e = {note: event.note, character: isPlayer ? boyfriend : dad, direction: nd.data % 4, noteType: nd.kind == null ? \'\' : nd.kind,\n' +
      '      healthGain: event.healthChange, rating: event.judgement, score: event.score, cancelled: false, strumLine: isPlayer ? playerStrums : cpuStrums};\n' +
      '    e.cancel = function() { e.cancelled = true; };\n' +
      '    e.preventAnim = function() { };\n' +
      '    return e;\n' +
      '  }'
    );
  }

  function classHeader(label, sources) {
    return (
      '// Auto-generated by fnf-mod-converter (' + label + ').\n// Source: ' + sources.join(', ') + '\n' +
      '// Codename Engine HScript -> V-Slice HScript. Best-effort translation: review before shipping.\n'
    );
  }

  function importBlock(parts, extra) {
    const set = new Set(BASE_IMPORTS.map((p) => 'import ' + p + ';'));
    (extra || []).forEach((e) => set.add('import ' + e + ';'));
    parts.forEach((p) => p.imports.forEach((i) => set.add(i)));
    return [...set].sort().join('\n');
  }

  function membersOf(a) {
    const fields = a.fields.map((f) => '  var ' + f.name + (f.type ? f.type : '') + ';').join('\n');
    const main = '  function __cn_main() {\n' + a.main.map((s) => '    ' + s.replace(/\n/g, '\n    ')).join('\n') + '\n  }';
    const fns = a.fnDefs.map((f) => '  function ' + f.name + f.params + ' ' + (f.body.startsWith('{') ? f.body : '{ ' + f.body + ' }')).join('\n\n');
    return fields + '\n\n' + main + '\n\n' + fns;
  }

  const has = (a, name) => a.callbacks.has(name);
  const callCb = (a, name, args) => '    __cn_' + name + '(' + args + ');';

  /** Event overrides shared by Module and Stage. */
  function dispatchers(a, o) {
    const sup = (m) => (o.callSuper ? '    super.' + m + '(event);\n' : '');
    const guard = o.guard ? '    if (!__ensure()) return;\n' : '';
    const methods = [];
    const add = (method, sig, lines) => {
      if (!lines.length) return;
      methods.push('  override function ' + method + '(' + sig + '):Void {\n' + sup(method) + guard + '    __cnBind();\n' + lines.join('\n') + '\n  }');
    };

    const upd = [];
    if (has(a, 'update')) upd.push(callCb(a, 'update', 'event.elapsed'));
    if (has(a, 'postUpdate')) upd.push(callCb(a, 'postUpdate', 'event.elapsed'));
    add('onUpdate', 'event:UpdateScriptEvent', upd);

    const beat = [];
    if (has(a, 'beatHit')) beat.push(callCb(a, 'beatHit', 'event.beat'));
    if (has(a, 'measureHit')) {
      beat.push('    var __bpm = Std.int(Conductor.instance.beatsPerMeasure);');
      beat.push('    if (__bpm > 0 && event.beat % __bpm == 0) {');
      beat.push('  ' + callCb(a, 'measureHit', 'Std.int(event.beat / __bpm)'));
      beat.push('    }');
    }
    add('onBeatHit', 'event:SongTimeScriptEvent', beat);
    add('onStepHit', 'event:SongTimeScriptEvent', has(a, 'stepHit') ? [callCb(a, 'stepHit', 'event.step')] : []);
    add('onSongStart', 'event:ScriptEvent', has(a, 'onSongStart') ? [callCb(a, 'onSongStart', 'event')] : []);
    add('onSongEnd', 'event:ScriptEvent', has(a, 'onSongEnd') ? [callCb(a, 'onSongEnd', 'event')] : []);
    add('onGameOver', 'event:ScriptEvent', has(a, 'onGameOver') ? [callCb(a, 'onGameOver', 'event')] : []);
    if (!o.skipCountdownStart && !o.stageHook) add('onCountdownStart', 'event:CountdownScriptEvent', has(a, 'onStartCountdown') ? [callCb(a, 'onStartCountdown', 'event')] : []);
    {
      const l = [];
      if (has(a, 'onCountdown')) {
        l.push("    var __tk = Std.string(event.step);");
        l.push("    var __n = __tk == 'THREE' ? 0 : (__tk == 'TWO' ? 1 : (__tk == 'ONE' ? 2 : (__tk == 'GO' ? 3 : -1)));");
        l.push('    if (__n >= 0) {');
        l.push('      var __ce = {swagCounter: __n, cancelled: false, cancel: function() { }, soundPath: null, spritePath: null, scale: 1, antialiasing: true};');
        l.push('  ' + callCb(a, 'onCountdown', '__ce'));
        l.push('    }');
      }
      add('onCountdownStep', 'event:CountdownScriptEvent', l);
    }
    {
      const l = [];
      const hasN = has(a, 'onNoteHit');
      const hasP = has(a, 'onPlayerHit');
      const hasD = has(a, 'onDadHit');
      if (hasN || hasP || hasD) {
        l.push('    var __isPlayer = event.note.noteData.getStrumlineIndex() == 0;');
        l.push('    var __e = __cnNoteEvent(event, __isPlayer);');
        if (hasN) l.push(callCb(a, 'onNoteHit', '__e'));
        if (hasP) l.push('    if (__isPlayer) { __cn_onPlayerHit(__e); }');
        if (hasD) l.push('    if (!__isPlayer) { __cn_onDadHit(__e); }');
        l.push('    event.healthChange = __e.healthGain;');
        l.push('    if (__e.cancelled) { event.cancel(); }');
      }
      add('onNoteHit', 'event:HitNoteScriptEvent', l);
    }
    {
      const l = [];
      if (has(a, 'onPlayerMiss')) {
        l.push('    if (event.note.noteData.getStrumlineIndex() == 0) {');
        l.push('      var __e = __cnNoteEvent(event, true);');
        l.push('  ' + callCb(a, 'onPlayerMiss', '__e'));
        l.push('    }');
      }
      add('onNoteMiss', 'event:NoteScriptEvent', l);
    }
    {
      const l = [];
      if (has(a, 'onEvent') || has(a, 'onPostEvent')) {
        l.push('    var __v = event.eventData.value;');
        l.push("    if (__v != null && Reflect.isObject(__v) && Reflect.hasField(__v, 'params')) {");
        l.push('      var __ee = {event: {name: event.eventData.eventKind, params: Reflect.field(__v, \'params\'), time: event.eventData.time}, cancelled: false, cancel: function() { }};');
        if (has(a, 'onEvent')) l.push('  ' + callCb(a, 'onEvent', '__ee'));
        if (has(a, 'onPostEvent')) l.push('  ' + callCb(a, 'onPostEvent', '__ee'));
        l.push('    }');
      }
      add('onSongEvent', 'event:SongEventScriptEvent', l);
    }
    return methods.join('\n\n');
  }

  const initCalls = (a) => {
    const l = ['    __cn_main();'];
    if (has(a, 'create')) l.push('    __cn_create();');
    if (has(a, 'postCreate')) l.push('    __cn_postCreate();');
    return l.join('\n');
  };

  /** Stage scripts run postCreate at the first countdown (characters exist by then). */
  function postHook(a) {
    if (!has(a, 'postCreate') && !has(a, 'onStartCountdown')) return '';
    return (
      '  override function onCountdownStart(event:CountdownScriptEvent):Void {\n    super.onCountdownStart(event);\n    __cnBind();\n' +
      (has(a, 'postCreate') ? '    if (!__posted) {\n      __posted = true;\n      __cn_postCreate();\n    }\n' : '') +
      (has(a, 'onStartCountdown') ? '    __cn_onStartCountdown(event);\n' : '') +
      '  }\n\n'
    );
  }

  /** Module guarded by song ids (or global when songIds is empty). */
  function buildModule({ className, moduleId, a, sources, songIds }) {
    const filter = songIds && songIds.length
      ? "    var __sid = ps.currentSong == null ? '' : ps.currentSong.id;\n    if (" + songIds.map((s) => '__sid != ' + q(s)).join(' && ') + ') return false;\n'
      : '';
    const destroy = has(a, 'destroy') ? '  override function onDestroy(event:ScriptEvent):Void {\n    if (__ps != null) { __cn_destroy(); }\n  }\n\n' : '';
    const ensure =
      '  var __ps = null;\n' +
      '  function __ensure() {\n    var ps = PlayState.instance;\n    if (ps == null) { __ps = null; return false; }\n' + filter +
      '    if (__ps != ps) {\n      if (ps.currentStage == null) return false;\n      __ps = ps;\n      __cnBind();\n' + initCalls(a).replace(/^/gm, '  ') + '\n    }\n    return true;\n  }';
    return (
      classHeader('Codename script "' + moduleId + '"', sources) + importBlock([a]) + '\n\n' +
      'class ' + className + ' extends Module {\n' +
      '  function new() {\n    super(' + q(moduleId) + ', 1000, {state: PlayState});\n  }\n\n' +
      prelude({}) + '\n\n' + membersOf(a) + '\n\n' + ensure + '\n\n' + destroy + dispatchers(a, { callSuper: false, guard: true }) + '\n}\n'
    ).replace('import flixel.FlxG;', 'import flixel.FlxG;\nimport funkin.modding.module.Module;');
  }

  /** class X extends Stage for data/stages/<id>.hx. */
  function buildStage({ className, stageId, a, sources, stageSprites }) {
    const mainOnly = ['    __cn_main();'].concat(has(a, 'create') ? ['    __cn_create();'] : []).join('\n');
    const create =
      '  var __posted = false;\n  override function onCreate(event:ScriptEvent):Void {\n    super.onCreate(event);\n    __posted = false;\n    __cnBind();\n' + mainOnly + '\n  }';
    return (
      classHeader('Codename stage script "' + stageId + '"', sources) + importBlock([a], ['funkin.play.stage.Stage']) + '\n\n' +
      'class ' + className + ' extends Stage {\n' +
      '  function new() {\n    super(' + q(stageId) + ');\n  }\n\n' +
      prelude({ stageSprites: (stageSprites || []).filter((n) => !a.fields.some((f) => f.name === n)) }).replace(/  function add\(o\)[^\n]*\n  function insert[^\n]*\n  function remove[^\n]*\n\n/, '') + '\n\n' +
      membersOf(a) + '\n\n' + create + '\n\n' + postHook(a) + dispatchers(a, { callSuper: true, guard: false, skipCountdownStart: true }) + '\n}\n'
    );
  }

  /** class X extends SongEvent for data/events/<name>.hx. */
  function buildEvent({ className, eventName, a, sources }) {
    const handle =
      '  var __ps = null;\n' +
      '  override function handleEvent(data:SongEventData):Void {\n' +
      '    var ps = PlayState.instance;\n    if (ps == null) return;\n' +
      '    if (__ps != ps) {\n      __ps = ps;\n      __cnBind();\n      __cn_main();\n' + (has(a, 'create') ? '      __cn_create();\n' : '') + (has(a, 'postCreate') ? '      __cn_postCreate();\n' : '') + '    }\n' +
      '    __cnBind();\n' +
      "    var __params = data.value == null ? [] : Reflect.field(data.value, 'params');\n" +
      '    var __e = {event: {name: ' + q(eventName) + ', params: __params, time: data.time}, cancelled: false, cancel: function() { }};\n' +
      (has(a, 'onEvent') ? '    __cn_onEvent(__e);\n' : '') + (has(a, 'onPostEvent') ? '    __cn_onPostEvent(__e);\n' : '') +
      '  }';
    return (
      classHeader('Codename custom event "' + eventName + '"', sources) + importBlock([a], ['funkin.play.event.SongEvent', 'funkin.data.song.SongData.SongEventData']) + '\n\n' +
      'class ' + className + ' extends SongEvent {\n' +
      '  function new() {\n    super(' + q(eventName) + ');\n  }\n\n' +
      prelude({}) + '\n\n' + membersOf(a) + '\n\n' + handle + '\n}\n'
    );
  }

  /** class X extends NoteKind for data/notes/<name>.hx. */
  function buildNoteKind({ className, kindId, a, sources }) {
    const boot =
      '  var __ps = null;\n  function __boot() {\n    var ps = PlayState.instance;\n    if (ps == null || __ps == ps) return;\n    __ps = ps;\n    __cnBind();\n' + initCalls(a) + '\n  }';
    const sides = [];
    if (has(a, 'onNoteHit') || has(a, 'onPlayerHit') || has(a, 'onDadHit')) {
      sides.push(
        '  override function onNoteHit(event:HitNoteScriptEvent):Void {\n    super.onNoteHit(event);\n    __boot();\n    __cnBind();\n' +
          '    var __isPlayer = event.note.noteData.getStrumlineIndex() == 0;\n    var __e = __cnNoteEvent(event, __isPlayer);\n' +
          (has(a, 'onNoteHit') ? '  ' + callCb(a, 'onNoteHit', '__e') + '\n' : '') +
          (has(a, 'onPlayerHit') ? '    if (__isPlayer) { __cn_onPlayerHit(__e); }\n' : '') +
          (has(a, 'onDadHit') ? '    if (!__isPlayer) { __cn_onDadHit(__e); }\n' : '') +
          '    event.healthChange = __e.healthGain;\n    if (__e.cancelled) { event.cancel(); }\n  }'
      );
    }
    if (has(a, 'onPlayerMiss')) {
      sides.push('  override function onNoteMiss(event:NoteScriptEvent):Void {\n    super.onNoteMiss(event);\n    __boot();\n    __cnBind();\n    __cn_onPlayerMiss(__cnNoteEvent(event, true));\n  }');
    }
    return (
      classHeader('Codename note type "' + kindId + '"', sources) + importBlock([a], ['funkin.play.notes.notekind.NoteKind']) + '\n\n' +
      'class ' + className + ' extends NoteKind {\n' +
      '  function new() {\n    super(' + q(kindId) + ', ' + q(kindId) + ');\n  }\n\n' +
      prelude({}) + '\n\n' + membersOf(a) + '\n\n' + boot + '\n\n' + sides.join('\n\n') + '\n}\n'
    );
  }

  /* ------------------------------------------------------------------ */
  /* Orchestration for a whole mod                                       */
  /* ------------------------------------------------------------------ */
  function fileId(p) {
    return C.stripExt(C.baseName(p));
  }

  async function prepare(ctx) {
    const { fs, report } = ctx;
    const plan = { global: [], songs: new Map(), stages: new Map(), events: [], kinds: [], handled: new Set() };
    let passAll = false;
    const passNames = new Set();

    const run = async (path) => {
      let src;
      try {
        src = await fs.text(path);
      } catch (e) {
        report.error(e.message);
        return null;
      }
      try {
        const a = analyze(src, path);
        plan.handled.add(path);
        a.warnings.forEach((w) => report.warn(path + ': ' + w));
        if (a.found.size) report.warn(path + ': uses Codename-only API that was not translated: ' + [...a.found].join(', '));
        return a;
      } catch (e) {
        report.error(path + ': ' + e.message + ' (script not converted)');
        return null;
      }
    };

    for (const p of fs.paths) {
      if (!/\.(hx|hscript)$/i.test(p)) continue;
      const lower = p.toLowerCase();
      const parts = lower.split('/');
      const raw = p.split('/');
      if (parts[0] === 'songs' && parts.length >= 4 && parts[2] === 'scripts') {
        const a = await run(p);
        if (a) {
          const folder = raw[1];
          if (!plan.songs.has(folder)) plan.songs.set(folder, []);
          plan.songs.get(folder).push({ path: p, a });
          if (a.callbacks.has('onEvent') || a.callbacks.has('onPostEvent')) passAll = true;
        }
      } else if (parts[0] === 'songs' && parts.length === 3) {
        report.skip('Song cutscene/dialogue scripts', p);
      } else if (parts[0] === 'songs' && parts.length === 2) {
        const a = await run(p);
        if (a) plan.global.push({ path: p, a });
      } else if (parts[0] === 'data' && parts[1] === 'scripts') {
        const a = await run(p);
        if (a) { plan.global.push({ path: p, a }); if (a.callbacks.has('onEvent')) passAll = true; }
      } else if (parts[0] === 'data' && parts[1] === 'charts' && parts.length === 3) {
        const a = await run(p);
        if (a) plan.global.push({ path: p, a });
      } else if (parts[0] === 'data' && parts[1] === 'stages' && parts.length === 3) {
        const a = await run(p);
        if (a) plan.stages.set(fileId(p), { path: p, a });
      } else if (parts[0] === 'data' && parts[1] === 'events' && parts.length === 3) {
        const a = await run(p);
        if (a) {
          plan.events.push({ path: p, name: fileId(p), a });
          passNames.add(fileId(p));
        }
      } else if (parts[0] === 'data' && parts[1] === 'notes' && parts.length === 3) {
        const a = await run(p);
        if (a) plan.kinds.push({ path: p, name: fileId(p), a });
      } else if (parts[0] === 'data' && parts[1] === 'characters') {
        report.skip('Character scripts', p);
      } else if (parts[0] === 'data' && (parts[1] === 'states' || parts[1] === 'dialogue')) {
        report.skip('State/dialogue scripts', p);
      } else if (parts[0] === 'data' && parts.length === 2) {
        report.skip('Other scripts', p);
      } else {
        report.skip('Other scripts', p);
      }
    }
    for (const p of fs.paths) if (/\.lua$/i.test(p)) report.skip('Lua scripts (not supported by Codename)', p);

    ctx.scriptPlan = plan;
    ctx.passEvents = { all: passAll, names: passNames };
    return plan;
  }

  function emit(ctx, songInfos) {
    const { out, report, modId } = ctx;
    const plan = ctx.scriptPlan;
    if (!plan) return;
    const base = C.pascal(modId);
    let count = 0;
    const put = (path, text) => {
      out.text(path, text);
      count++;
    };

    plan.global.forEach(({ path, a }) => {
      const id = C.slugId(path.replace(/\.(hx|hscript)$/i, '').replace(/\//g, '-'));
      put('scripts/global/' + id + '.hxc', buildModule({ className: base + C.pascal(id) + 'Script', moduleId: modId + '-' + id, a, sources: [path], songIds: [] }));
    });

    for (const [folder, items] of plan.songs) {
      const songId = C.formatToSongPath(folder);
      if (!songInfos.some((s) => s.id === songId)) {
        report.warn('Scripts in songs/' + folder + '/scripts/ belong to a song with no converted chart; skipped');
        continue;
      }
      items.forEach(({ path, a }) => {
        const id = C.slugId(songId + '-' + fileId(path));
        put('scripts/songs/' + id + '.hxc', buildModule({ className: base + C.pascal(id) + 'Script', moduleId: modId + '-' + id, a, sources: [path], songIds: [songId] }));
      });
    }

    for (const [stageId, { path, a }] of plan.stages) {
      if (!ctx.modStages.has(stageId)) {
        report.warn(path + ': stage script has no data/stages/' + stageId + '.xml, skipped');
        continue;
      }
      put('scripts/stages/' + stageId + '.hxc', buildStage({ className: base + C.pascal(stageId) + 'Stage', stageId, a, sources: [path], stageSprites: ctx.stageSprites.get(stageId) || [] }));
    }
    plan.events.forEach(({ path, name, a }) => {
      if (!a.callbacks.has('onEvent') && !a.callbacks.has('onPostEvent')) report.warn(path + ': custom event script has no onEvent/onPostEvent; nothing will run');
      put('scripts/events/' + C.slugId(name) + '.hxc', buildEvent({ className: base + C.pascal(name) + 'Event', eventName: name, a, sources: [path] }));
    });
    plan.kinds.forEach(({ path, name, a }) => {
      put('scripts/notekinds/' + C.slugId(name) + '.hxc', buildNoteKind({ className: base + C.pascal(name) + 'NoteKind', kindId: name, a, sources: [path] }));
    });
    if (count) report.count('Scripts converted (Codename HScript -> V-Slice)', count);
  }

  C.codenameHx = { prepare, emit, analyze, splitScript, tokenize, rewrite };
})(typeof window !== 'undefined' ? window : globalThis);
