/*
 * Psych Engine Lua API -> V-Slice HScript compatibility layer.
 *
 * Every entry is a snippet of HScript that gets pasted into the generated class, but only when the
 * converted script (transitively) uses it. Names are the same as in Psych, so translated Lua calls
 * such as `makeLuaSprite(...)` resolve to these methods unchanged.
 *
 * Conventions for the HScript below:
 *  - Only conservative syntax (var/function/if/for/while/Reflect/Std/Math), no default arguments:
 *    every optional parameter is declared `?param` and defaulted manually.
 *  - Property paths use Reflect so they work on any object.
 *
 * Entry fields: deps (other entries needed), imports (HScript imports needed), code.
 *
 * Verified against the Funkin source: PlayState (camGame, camHUD, health, songScore, iconP1/P2, healthBar,
 * cameraFollowPoint, currentStage.getBoyfriend/getDad/getGirlfriend/getNamedProp, playerStrumline/
 * opponentStrumline.getByIndex), Conductor.instance, FunkinSprite.create/createSparrow, FunkinSound.playOnce.
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  const IMPORTS = {
    PlayState: 'funkin.play.PlayState',
    Conductor: 'funkin.Conductor',
    Paths: 'funkin.Paths',
    FunkinSprite: 'funkin.graphics.FunkinSprite',
    FunkinSound: 'funkin.audio.FunkinSound',
    Preferences: 'funkin.Preferences',
    FlxG: 'flixel.FlxG',
    FlxText: 'flixel.text.FlxText',
    FlxTween: 'flixel.tweens.FlxTween',
    FlxEase: 'flixel.tweens.FlxEase',
    FlxTimer: 'flixel.util.FlxTimer',
    FlxColor: 'flixel.util.FlxColor',
    FlxSprite: 'flixel.FlxSprite',
    SongEventData: 'funkin.data.song.SongData.SongEventData',
    SongEventRegistry: 'funkin.data.event.SongEventRegistry',
    FlxTextBorderStyle: 'flixel.text.FlxText.FlxTextBorderStyle',
    PlayerSettings: 'funkin.PlayerSettings',
  };
  C.PSYCH_IMPORTS = IMPORTS;

  /** Free variables that Psych injects into every Lua script. They are class fields in the output. */
  const GLOBALS = {
    curBeat: '0', curStep: '0', curSection: '0', curDecBeat: '0', curDecStep: '0',
    bpm: '100', curBpm: '100', crochet: '600', stepCrochet: '150', songLength: '0',
    songName: "''", songPath: "''", scrollSpeed: '1', difficultyName: "''", difficulty: '1',
    curStage: "''", boyfriendName: "'bf'", dadName: "'dad'", gfName: "'gf'",
    screenWidth: '1280', screenHeight: '720',
    downscroll: 'false', middlescroll: 'false', lowQuality: 'false', shadersEnabled: 'false',
    flashingLights: 'true', ghostTapping: 'true', hideHud: 'false', framerate: '60',
    score: '0', misses: '0', hits: '0', combo: '0', rating: '0', ratingName: "''", ratingFC: "''",
    isStoryMode: 'false', botPlay: 'false', practice: 'false', startedCountdown: 'false', inGameOver: 'false',
    mustHitSection: 'false', gfSection: 'false', altAnim: 'false', seenCutscene: 'false', hasVocals: 'true',
    Function_Stop: "'##PSYCHLUA_FUNCTIONSTOP'", Function_Continue: "'##PSYCHLUA_FUNCTIONCONTINUE'",
    Function_StopLua: "'##PSYCHLUA_FUNCTIONSTOPLUA'", Function_StopHScript: "'##PSYCHLUA_FUNCTIONSTOPHSCRIPT'",
    Function_StopAll: "'##PSYCHLUA_FUNCTIONSTOPALL'",
    version: "'0.7.3'", modFolder: "''", currentModDirectory: "''", scriptName: "''",
    luaDebugMode: 'false', luaDeprecatedWarnings: 'false',
  };
  C.PSYCH_GLOBALS = GLOBALS;

  /** Always emitted: state containers and global refresh. */
  const BASE = `
  var __luaSprites = {};
  var __luaTexts = {};
  var __luaTimers = {};
  var __luaTweens = {};
  var __luaVars = {};
  var __closed = false;
  var __stopped = false;

  function __t(v) { return v != null && v != false; }

  function __unsupported(name) {
    trace('[psych-convert] Psych function not supported in V-Slice: ' + name);
    return null;
  }

  function lua_refresh() {
    var ps = PlayState.instance;
    if (ps == null) return;
    var c = Conductor.instance;
    curBeat = c.currentBeat;
    curStep = c.currentStep;
    curDecBeat = c.currentBeatTime;
    curDecStep = c.currentStepTime;
    curSection = c.currentMeasure;
    bpm = c.bpm;
    curBpm = c.bpm;
    crochet = c.beatLengthMs;
    stepCrochet = c.stepLengthMs;
    score = ps.songScore;
    botPlay = ps.isBotPlayMode;
    practice = ps.isPracticeMode;
    startedCountdown = !ps.isInCountdown;
    inGameOver = ps.isGameOverState;
    if (ps.currentSong != null) {
      songName = ps.currentSong.songName;
      songPath = ps.currentSong.id;
    }
    difficultyName = ps.currentDifficulty;
    difficulty = ps.currentDifficulty == 'easy' ? 0 : (ps.currentDifficulty == 'hard' ? 2 : 1);
    curStage = ps.currentStageId;
    var chart = ps.currentChart;
    if (chart != null) scrollSpeed = chart.scrollSpeed;
    screenWidth = FlxG.width;
    screenHeight = FlxG.height;
    downscroll = Preferences.downscroll;
    flashingLights = Preferences.flashingLights;
    if (ps.currentStage != null) {
      var bf = ps.currentStage.getBoyfriend();
      var dd = ps.currentStage.getDad();
      var gg = ps.currentStage.getGirlfriend();
      if (bf != null) boyfriendName = bf.characterId;
      if (dd != null) dadName = dd.characterId;
      if (gg != null) gfName = gg.characterId;
    }
  }
`;
  const BASE_IMPORTS = ['PlayState', 'Conductor', 'Preferences', 'FlxG'];

  const SHIM = {
    /* ---------------------------------------------------------------- Lua stdlib */
    __isArray: { code: `
  function __isArray(v) { return v != null && Type.getClass(v) != null && Type.getClassName(Type.getClass(v)) == 'Array'; }` },
    __isString: { code: `
  function __isString(v) { return v != null && Type.getClass(v) != null && Type.getClassName(Type.getClass(v)) == 'String'; }` },
    __isNum: { code: `
  function __isNum(v) { var t = Std.string(Type.typeof(v)); return t == 'TInt' || t == 'TFloat'; }` },
    lua_mod: { code: `
  function lua_mod(a, b) {
    var r = a % b;
    if (r != 0 && ((r < 0) != (b < 0))) r += b;
    return r;
  }` },
    lua_str: { code: `
  function lua_str(v) {
    if (v == null) return 'nil';
    if (v == true) return 'true';
    if (v == false) return 'false';
    return Std.string(v);
  }` },
    lua_tostring: { deps: ['lua_str'], code: `
  function lua_tostring(v) { return lua_str(v); }` },
    lua_tonumber: { code: `
  function lua_tonumber(v, ?base) {
    if (v == null) return null;
    var f = Std.parseFloat(Std.string(v));
    return Math.isNaN(f) ? null : f;
  }` },
    lua_type: { deps: ['__isString', '__isNum'], code: `
  function lua_type(v) {
    if (v == null) return 'nil';
    if (v == true || v == false) return 'boolean';
    if (__isNum(v)) return 'number';
    if (__isString(v)) return 'string';
    if (Std.string(Type.typeof(v)) == 'TFunction') return 'function';
    return 'table';
  }` },
    lua_print: { deps: ['lua_str'], code: `
  function lua_print(?a, ?b, ?c, ?d) {
    var parts = [];
    var all = [a, b, c, d];
    for (x in all) if (x != null) parts.push(lua_str(x));
    trace(parts.join(String.fromCharCode(9)));
  }` },
    __tarr: { deps: ['__isArray'], code: `
  // Array part of a Lua table: raw arrays, or the __arr field of hybrid tables.
  function __tarr(t, ?create) {
    if (t == null) return null;
    if (__isArray(t)) return t;
    var a = Reflect.field(t, '__arr');
    if (a == null && create == true) { a = []; Reflect.setField(t, '__arr', a); }
    return a;
  }` },
    lua_len: { deps: ['__isString', '__tarr'], code: `
  function lua_len(v) {
    if (v == null) return 0;
    if (__isString(v)) return v.length;
    var a = __tarr(v);
    return a == null ? 0 : a.length;
  }` },
    lua_idx: { deps: ['__isArray', '__isNum', '__tarr'], code: `
  function lua_idx(t, k) {
    if (t == null) return null;
    if (__isNum(k)) {
      var a = __tarr(t);
      return a == null ? null : a[Std.int(k) - 1];
    }
    if (__isArray(t)) return null;
    return Reflect.field(t, Std.string(k));
  }` },
    lua_setidx: { deps: ['__isArray', '__isNum', '__tarr'], code: `
  function lua_setidx(t, k, v) {
    if (t == null) return;
    if (__isNum(k)) {
      var a = __tarr(t, true);
      var i = Std.int(k) - 1;
      while (a.length < i) a.push(null);
      a[i] = v;
    } else if (!__isArray(t)) Reflect.setField(t, Std.string(k), v);
  }` },
    lua_or: { code: `
  function lua_or(a, b) { return (a != null && a != false) ? a : b; }` },
    lua_and: { code: `
  function lua_and(a, b) { return (a != null && a != false) ? b : a; }` },
    lua_orf: { code: `
  function lua_orf(a, f) { return (a != null && a != false) ? a : f(); }` },
    lua_andf: { code: `
  function lua_andf(a, f) { return (a != null && a != false) ? f() : a; }` },
    lua_pairs: { deps: ['__isArray', '__tarr'], code: `
  function lua_pairs(t) {
    var out = [];
    if (t == null) return out;
    var a = __tarr(t);
    if (a != null) {
      var i = 0;
      while (i < a.length) { out.push([i + 1, a[i]]); i++; }
    }
    if (!__isArray(t)) {
      for (f in Reflect.fields(t)) if (f != '__arr') out.push([f, Reflect.field(t, f)]);
    }
    return out;
  }` },
    lua_ipairs: { deps: ['__tarr'], code: `
  function lua_ipairs(t) {
    var out = [];
    var a = __tarr(t);
    if (a == null) return out;
    var i = 0;
    while (i < a.length && a[i] != null) { out.push([i + 1, a[i]]); i++; }
    return out;
  }` },
    lua_mk: { deps: ['__isNum', '__tarr'], code: `
  // Table constructor with mixed or numeric keys: [[key, value], ...]
  function lua_mk(pairs) {
    var o = {};
    var arr = [];
    for (p in pairs) {
      if (__isNum(p[0]) && Std.int(p[0]) == arr.length + 1) arr.push(p[1]);
      else if (!__isNum(p[0])) Reflect.setField(o, Std.string(p[0]), p[1]);
    }
    Reflect.setField(o, '__arr', arr);
    return o;
  }` },
    lua_tinsert: { deps: ['__tarr'], code: `
  function lua_tinsert(t, a, ?b) {
    var arr = __tarr(t, true);
    if (b == null) arr.push(a); else arr.insert(Std.int(a) - 1, b);
  }` },
    lua_tremove: { deps: ['__tarr'], code: `
  function lua_tremove(t, ?pos) {
    var arr = __tarr(t);
    if (arr == null || arr.length == 0) return null;
    if (pos == null) return arr.pop();
    var r = arr.splice(Std.int(pos) - 1, 1);
    return r.length > 0 ? r[0] : null;
  }` },
    lua_tconcat: { deps: ['lua_str', '__tarr'], code: `
  function lua_tconcat(t, ?sep) {
    if (sep == null) sep = '';
    var arr = __tarr(t);
    if (arr == null) return '';
    var parts = [];
    for (x in arr) parts.push(lua_str(x));
    return parts.join(sep);
  }` },
    lua_tsort: { deps: ['__tarr'], code: `
  function lua_tsort(t, ?cmp) {
    var arr = __tarr(t);
    if (arr == null) return;
    if (cmp == null) arr.sort(function(a, b) { return a < b ? -1 : (a > b ? 1 : 0); });
    else arr.sort(function(a, b) { return cmp(a, b) == true ? -1 : (cmp(b, a) == true ? 1 : 0); });
  }` },
    lua_unpack: { deps: ['__tarr'], code: `
  function lua_unpack(t) { var a = __tarr(t); return (a != null && a.length > 0) ? a[0] : null; }` },
    lua_select: { code: `
  function lua_select(n, ?a) { return a; }` },
    lua_pcall: { code: `
  function lua_pcall(f, ?a, ?b, ?c) {
    try { f(a, b, c); return true; } catch (e:Dynamic) { trace('[psych-convert] pcall caught: ' + Std.string(e)); return false; }
  }` },
    lua_error: { code: `
  function lua_error(msg, ?lvl) { trace('[psych-convert] error: ' + Std.string(msg)); }` },
    lua_assert: { code: `
  function lua_assert(v, ?msg) { if (v == null || v == false) trace('[psych-convert] assertion failed: ' + Std.string(msg)); return v; }` },
    lua_noop: { code: `
  function lua_noop(?a, ?b) { return null; }` },
    lua_max: { code: `
  function lua_max(a, b, ?c, ?d) {
    var m = a < b ? b : a;
    if (c != null && c > m) m = c;
    if (d != null && d > m) m = d;
    return m;
  }` },
    lua_min: { code: `
  function lua_min(a, b, ?c, ?d) {
    var m = a > b ? b : a;
    if (c != null && c < m) m = c;
    if (d != null && d < m) m = d;
    return m;
  }` },
    lua_random: { code: `
  function lua_random(?a, ?b) {
    if (a == null) return Math.random();
    if (b == null) return Std.int(Math.floor(Math.random() * a)) + 1;
    return Std.int(Math.floor(Math.random() * (b - a + 1))) + Std.int(a);
  }` },
    lua_rad: { code: `
  function lua_rad(d) { return d * Math.PI / 180; }` },
    lua_deg: { code: `
  function lua_deg(r) { return r * 180 / Math.PI; }` },
    lua_fmod: { code: `
  function lua_fmod(a, b) { return a % b; }` },
    lua_ostime: { code: `
  function lua_ostime() { return Std.int(Date.now().getTime() / 1000); }` },
    lua_osclock: { code: `
  function lua_osclock() { return Date.now().getTime() / 1000; }` },
    lua_sub: { code: `
  function lua_sub(s, i, ?j) {
    s = Std.string(s);
    var n = s.length;
    if (j == null) j = -1;
    if (i < 0) i = n + i + 1;
    if (j < 0) j = n + j + 1;
    if (i < 1) i = 1;
    if (j > n) j = n;
    if (i > j) return '';
    return s.substr(Std.int(i) - 1, Std.int(j - i + 1));
  }` },
    lua_rep: { code: `
  function lua_rep(s, n) { var out = ''; var i = 0; while (i < n) { out += s; i++; } return out; }` },
    lua_format: { deps: ['lua_str'], code: `
  function lua_format(fmt, ?args) {
    if (args == null) args = [];
    var out = '';
    var ai = 0;
    var i = 0;
    while (i < fmt.length) {
      var ch = fmt.charAt(i);
      if (ch == '%' && i + 1 < fmt.length) {
        var j = i + 1;
        var spec = '';
        while (j < fmt.length && '0123456789.-+ #'.indexOf(fmt.charAt(j)) >= 0) { spec += fmt.charAt(j); j++; }
        var conv = fmt.charAt(j);
        if (conv == '%') out += '%';
        else {
          var a = ai < args.length ? args[ai] : null;
          ai++;
          var piece = '';
          if (conv == 'd' || conv == 'i') piece = Std.string(Std.int(a));
          else if (conv == 'f') {
            var prec = 6;
            var dot = spec.indexOf('.');
            if (dot >= 0) prec = Std.parseInt(spec.substr(dot + 1));
            var p = Math.pow(10, prec);
            piece = Std.string(Math.round(a * p) / p);
            if (prec > 0) {
              var di = piece.indexOf('.');
              if (di < 0) { piece += '.'; di = piece.length - 1; }
              while (piece.length - di - 1 < prec) piece += '0';
            }
          }
          else piece = lua_str(a);
          // flags and width: [-0+ #]* digits [. digits]
          var left = spec.indexOf('-') >= 0;
          var k = 0;
          var zero = false;
          while (k < spec.length && '-+ #0'.indexOf(spec.charAt(k)) >= 0) { if (spec.charAt(k) == '0') zero = true; k++; }
          var wend = k;
          while (wend < spec.length && spec.charAt(wend) != '.') wend++;
          var width = wend > k ? Std.parseInt(spec.substring(k, wend)) : 0;
          while (piece.length < width) piece = left ? piece + ' ' : ((zero && conv != 's') ? '0' + piece : ' ' + piece);
          out += piece;
        }
        i = j + 1;
      } else { out += ch; i++; }
    }
    return out;
  }` },
    lua_find: { code: `
  function lua_find(s, pat, ?init, ?plain) {
    var i = s.indexOf(pat, init == null ? 0 : Std.int(init) - 1);
    if (i < 0) return null;
    return i + 1;
  }` },
    lua_gsub: { code: `
  function lua_gsub(s, pat, rep, ?n) { return StringTools.replace(s, pat, Std.string(rep)); }` },
    lua_match: { code: `
  function lua_match(s, pat) { return s.indexOf(pat) >= 0 ? pat : null; }` },
    lua_gmatch: { code: `
  function lua_gmatch(s, pat) { return s.indexOf(pat) >= 0 ? [pat] : []; }` },

    /* ---------------------------------------------------------------- Object lookup / properties */
    __cam: { code: `
  function __cam(name) {
    var ps = PlayState.instance;
    var n = Std.string(name).toLowerCase();
    if (n == 'camhud' || n == 'hud') return ps.camHUD;
    if (n == 'camother' || n == 'other') return ps.camCutscene;
    return ps.camGame;
  }` },
    __color: { imports: ['FlxColor'], code: `
  function __color(c) {
    if (c == null) return 0xFFFFFFFF;
    if (Std.string(Type.typeof(c)) == 'TInt') return c;
    var s = Std.string(c);
    if (s.indexOf('0x') == 0) return Std.parseInt(s);
    if (s.indexOf('#') == 0) return FlxColor.fromString(s);
    return FlxColor.fromString('#' + s);
  }` },
    __ease: { imports: ['FlxEase'], code: `
  function __ease(name) {
    if (name == null || name == '') return FlxEase.linear;
    var f = Reflect.field(FlxEase, Std.string(name));
    return f == null ? FlxEase.linear : f;
  }` },
    __root: { deps: ['__cam'], code: `
  function __root(name) {
    var ps = PlayState.instance;
    if (ps == null) return null;
    var o = Reflect.field(__luaSprites, name);
    if (o != null) return o;
    o = Reflect.field(__luaTexts, name);
    if (o != null) return o;
    if (name == 'boyfriend' || name == 'bf') return ps.currentStage.getBoyfriend();
    if (name == 'dad') return ps.currentStage.getDad();
    if (name == 'gf') return ps.currentStage.getGirlfriend();
    if (name == 'camGame' || name == 'camHUD' || name == 'camOther') return __cam(name);
    if (name == 'camFollow' || name == 'camFollowPos') return ps.cameraFollowPoint;
    if (name == 'iconP1' || name == 'iconP2' || name == 'healthBar' || name == 'healthBarBG') return Reflect.getProperty(ps, name);
    if (name == 'playerStrums' || name == 'opponentStrums' || name == 'strumLineNotes') {
      var arr = [];
      var i = 0;
      if (name != 'playerStrums') { i = 0; while (i < 4) { arr.push(ps.opponentStrumline.getByIndex(i)); i++; } }
      if (name != 'opponentStrums') { i = 0; while (i < 4) { arr.push(ps.playerStrumline.getByIndex(i)); i++; } }
      return arr;
    }
    if (ps.currentStage != null) {
      var prop = ps.currentStage.getNamedProp(name);
      if (prop != null) return prop;
    }
    return null;
  }` },
    __field: { code: `
  function __field(name) {
    if (name == 'defaultCamZoom') return 'currentCameraZoom';
    if (name == 'cpuControlled') return 'isBotPlayMode';
    if (name == 'inCutscene') return 'isInCutscene';
    if (name == 'practiceMode') return 'isPracticeMode';
    return name;
  }` },
    __resolve: { deps: ['__root', '__field'], code: `
  // Returns [parentObject, lastKey] for a Psych property path like 'boyfriend.scale.x' or 'playerStrums[1].alpha'.
  function __resolve(path) {
    var parts = Std.string(path).split('.');
    var cur = null;
    var ps = PlayState.instance;
    var i = 0;
    var first = parts[0];
    var bi = first.indexOf('[');
    var head = bi >= 0 ? first.substr(0, bi) : first;
    var rootObj = __root(head);
    if (rootObj == null) {
      if (parts.length == 1) return [ps, __field(head)];
      return null;
    }
    cur = rootObj;
    if (bi >= 0) cur = cur[Std.parseInt(first.substring(bi + 1, first.indexOf(']')))];
    i = 1;
    while (i < parts.length - 1) {
      var seg = parts[i];
      if (seg != 'members') {
        var b = seg.indexOf('[');
        if (b >= 0) {
          var f0 = Reflect.getProperty(cur, seg.substr(0, b));
          cur = f0[Std.parseInt(seg.substring(b + 1, seg.indexOf(']')))];
        } else cur = Reflect.getProperty(cur, seg);
      }
      if (cur == null) return null;
      i++;
    }
    if (parts.length == 1) return [cur, null];
    var last = parts[parts.length - 1];
    if (last == 'members') return [cur, null];
    return [cur, last];
  }` },
    getProperty: { deps: ['__resolve'], code: `
  function getProperty(path) {
    var r = __resolve(path);
    if (r == null) return null;
    if (r[1] == null) return r[0];
    var b = r[1].indexOf('[');
    if (b >= 0) {
      var arr = Reflect.getProperty(r[0], r[1].substr(0, b));
      return arr[Std.parseInt(r[1].substring(b + 1, r[1].indexOf(']')))];
    }
    return Reflect.getProperty(r[0], r[1]);
  }` },
    setProperty: { deps: ['__resolve'], code: `
  function setProperty(path, value) {
    var r = __resolve(path);
    if (r == null || r[1] == null) return;
    Reflect.setProperty(r[0], r[1], value);
  }` },
    getPropertyFromClass: { code: `
  function getPropertyFromClass(cls, prop) {
    var c = Type.resolveClass(cls);
    if (c == null) return null;
    var parts = Std.string(prop).split('.');
    var cur = Reflect.getProperty(c, parts[0]);
    var i = 1;
    while (i < parts.length) { if (cur == null) return null; cur = Reflect.getProperty(cur, parts[i]); i++; }
    return cur;
  }` },
    setPropertyFromClass: { code: `
  function setPropertyFromClass(cls, prop, value) {
    var c = Type.resolveClass(cls);
    if (c == null) return;
    var parts = Std.string(prop).split('.');
    if (parts.length == 1) { Reflect.setProperty(c, parts[0], value); return; }
    var cur = Reflect.getProperty(c, parts[0]);
    var i = 1;
    while (i < parts.length - 1) { if (cur == null) return; cur = Reflect.getProperty(cur, parts[i]); i++; }
    if (cur != null) Reflect.setProperty(cur, parts[parts.length - 1], value);
  }` },
    getPropertyFromGroup: { deps: ['getProperty'], code: `
  function getPropertyFromGroup(group, index, prop) { return getProperty(group + '[' + index + '].' + prop); }` },
    setPropertyFromGroup: { deps: ['setProperty'], code: `
  function setPropertyFromGroup(group, index, prop, value) { setProperty(group + '[' + index + '].' + prop, value); }` },
    getVar: { code: `
  function getVar(name) { return Reflect.field(__luaVars, name); }` },
    setVar: { code: `
  function setVar(name, value) { Reflect.setField(__luaVars, name, value); }` },

    /* ---------------------------------------------------------------- Sprites */
    makeLuaSprite: { imports: ['FunkinSprite', 'Paths'], code: `
  function makeLuaSprite(tag, ?image, ?x, ?y) {
    if (x == null) x = 0;
    if (y == null) y = 0;
    var spr = null;
    if (image == null || image == '') {
      spr = new FunkinSprite(x, y);
    } else {
      spr = FunkinSprite.create(x, y, image);
    }
    spr.antialiasing = true;
    Reflect.setField(__luaSprites, tag, spr);
    return spr;
  }` },
    makeAnimatedLuaSprite: { imports: ['FunkinSprite'], code: `
  function makeAnimatedLuaSprite(tag, ?image, ?x, ?y) {
    if (x == null) x = 0;
    if (y == null) y = 0;
    var spr = FunkinSprite.createSparrow(x, y, image);
    spr.antialiasing = true;
    Reflect.setField(__luaSprites, tag, spr);
    return spr;
  }` },
    __obj: { deps: ['__root'], code: `
  function __obj(tag) { return __root(tag); }` },
    makeGraphic: { deps: ['__obj', '__color'], code: `
  function makeGraphic(tag, ?w, ?h, ?color) {
    var spr = __obj(tag);
    if (spr == null) return;
    spr.makeSolidColor(Std.int(w == null ? 256 : w), Std.int(h == null ? 256 : h), __color(color == null ? 'FFFFFF' : color));
  }` },
    luaSpriteMakeGraphic: { deps: ['makeGraphic'], code: `
  function luaSpriteMakeGraphic(tag, ?w, ?h, ?color) { makeGraphic(tag, w, h, color); }` },
    addLuaSprite: { deps: ['__obj'], code: `
  function addLuaSprite(tag, ?front) {
    var spr = Reflect.field(__luaSprites, tag);
    if (spr == null) return;
    var ps = PlayState.instance;
    spr.zIndex = front == true ? 400 : 50;
    ps.add(spr);
    ps.refresh();
  }` },
    removeLuaSprite: { code: `
  function removeLuaSprite(tag, ?destroy) {
    var spr = Reflect.field(__luaSprites, tag);
    if (spr == null) return;
    PlayState.instance.remove(spr);
    if (destroy == null || destroy == true) { spr.destroy(); Reflect.deleteField(__luaSprites, tag); }
  }` },
    luaSpriteExists: { code: `
  function luaSpriteExists(tag) { return Reflect.field(__luaSprites, tag) != null; }` },
    addAnimationByPrefix: { deps: ['__obj'], code: `
  function addAnimationByPrefix(tag, name, prefix, ?fps, ?loop) {
    var spr = __obj(tag);
    if (spr == null) return;
    spr.animation.addByPrefix(name, prefix, fps == null ? 24 : fps, loop == null ? true : loop);
  }` },
    luaSpriteAddAnimationByPrefix: { deps: ['addAnimationByPrefix'], code: `
  function luaSpriteAddAnimationByPrefix(tag, name, prefix, ?fps, ?loop) { addAnimationByPrefix(tag, name, prefix, fps, loop); }` },
    addAnimationByIndices: { deps: ['__obj'], code: `
  function addAnimationByIndices(tag, name, prefix, indices, ?fps, ?loop) {
    var spr = __obj(tag);
    if (spr == null) return;
    var idx = [];
    for (s in Std.string(indices).split(',')) { var n = Std.parseInt(StringTools.trim(s)); if (n != null) idx.push(n); }
    spr.animation.addByIndices(name, prefix, idx, '', fps == null ? 24 : fps, loop == true);
  }` },
    luaSpriteAddAnimationByIndices: { deps: ['addAnimationByIndices'], code: `
  function luaSpriteAddAnimationByIndices(tag, name, prefix, indices, ?fps) { addAnimationByIndices(tag, name, prefix, indices, fps, false); }` },
    objectPlayAnimation: { deps: ['__obj'], code: `
  function objectPlayAnimation(tag, name, ?force, ?startFrame) {
    var spr = __obj(tag);
    if (spr == null) return;
    spr.animation.play(name, force == true, false, startFrame == null ? 0 : startFrame);
  }` },
    luaSpritePlayAnimation: { deps: ['objectPlayAnimation'], code: `
  function luaSpritePlayAnimation(tag, name, ?force) { objectPlayAnimation(tag, name, force); }` },
    scaleObject: { deps: ['__obj'], code: `
  function scaleObject(tag, x, y, ?updateHitbox) {
    var spr = __obj(tag);
    if (spr == null) return;
    spr.scale.set(x, y);
    if (updateHitbox == null || updateHitbox == true) spr.updateHitbox();
  }` },
    setGraphicSize: { deps: ['__obj'], code: `
  function setGraphicSize(tag, x, ?y, ?updateHitbox) {
    var spr = __obj(tag);
    if (spr == null) return;
    spr.setGraphicSize(x, y == null ? 0 : y);
    if (updateHitbox == null || updateHitbox == true) spr.updateHitbox();
  }` },
    updateHitbox: { deps: ['__obj'], code: `
  function updateHitbox(tag) { var spr = __obj(tag); if (spr != null) spr.updateHitbox(); }` },
    setScrollFactor: { deps: ['__obj'], code: `
  function setScrollFactor(tag, x, y) { var spr = __obj(tag); if (spr != null) spr.scrollFactor.set(x, y); }` },
    setObjectCamera: { deps: ['__obj', '__cam'], code: `
  function setObjectCamera(tag, ?cam) {
    var spr = __obj(tag);
    if (spr == null) return;
    spr.cameras = [__cam(cam == null ? 'camGame' : cam)];
  }` },
    setObjectOrder: { deps: ['__obj'], code: `
  function setObjectOrder(tag, order) {
    var spr = __obj(tag);
    if (spr == null) return;
    spr.zIndex = order;
    PlayState.instance.refresh();
  }` },
    screenCenter: { deps: ['__obj'], code: `
  function screenCenter(tag, ?axis) {
    var spr = __obj(tag);
    if (spr == null) return;
    var a = axis == null ? 'xy' : Std.string(axis).toLowerCase();
    if (a.indexOf('x') >= 0) spr.x = (FlxG.width - spr.width) / 2;
    if (a.indexOf('y') >= 0) spr.y = (FlxG.height - spr.height) / 2;
  }` },
    setBlendMode: { deps: ['__obj'], code: `
  function setBlendMode(tag, mode) { var spr = __obj(tag); if (spr != null) spr.blend = Std.string(mode).toLowerCase(); }` },
    getMidpointX: { deps: ['__obj'], code: `
  function getMidpointX(tag) { var o = __obj(tag); return o == null ? 0 : o.x + o.width / 2; }` },
    getMidpointY: { deps: ['__obj'], code: `
  function getMidpointY(tag) { var o = __obj(tag); return o == null ? 0 : o.y + o.height / 2; }` },
    getObjectOrder: { deps: ['__obj'], code: `
  function getObjectOrder(tag) { var o = __obj(tag); return o == null ? -1 : o.zIndex; }` },

    /* ---------------------------------------------------------------- Text */
    makeLuaText: { imports: ['FlxText'], code: `
  function makeLuaText(tag, ?text, ?width, ?x, ?y) {
    var t = new FlxText(x == null ? 0 : x, y == null ? 0 : y, width == null ? 0 : width, text == null ? '' : text, 16);
    t.scrollFactor.set();
    Reflect.setField(__luaTexts, tag, t);
    return t;
  }` },
    addLuaText: { code: `
  function addLuaText(tag) {
    var t = Reflect.field(__luaTexts, tag);
    if (t == null) return;
    t.cameras = [PlayState.instance.camHUD];
    PlayState.instance.add(t);
  }` },
    removeLuaText: { code: `
  function removeLuaText(tag, ?destroy) {
    var t = Reflect.field(__luaTexts, tag);
    if (t == null) return;
    PlayState.instance.remove(t);
    if (destroy == null || destroy == true) { t.destroy(); Reflect.deleteField(__luaTexts, tag); }
  }` },
    setTextString: { code: `
  function setTextString(tag, text) { var t = Reflect.field(__luaTexts, tag); if (t != null) t.text = Std.string(text); }` },
    getTextString: { code: `
  function getTextString(tag) { var t = Reflect.field(__luaTexts, tag); return t == null ? null : t.text; }` },
    setTextColor: { deps: ['__color'], code: `
  function setTextColor(tag, color) { var t = Reflect.field(__luaTexts, tag); if (t != null) t.color = __color(color); }` },
    setTextSize: { code: `
  function setTextSize(tag, size) { var t = Reflect.field(__luaTexts, tag); if (t != null) t.size = Std.int(size); }` },
    setTextAlignment: { code: `
  function setTextAlignment(tag, ?alignment) { var t = Reflect.field(__luaTexts, tag); if (t != null) t.alignment = alignment == null ? 'left' : Std.string(alignment); }` },
    setTextBorder: { deps: ['__color'], imports: ['FlxTextBorderStyle'], code: `
  function setTextBorder(tag, size, color) {
    var t = Reflect.field(__luaTexts, tag);
    if (t != null) t.setBorderStyle(FlxTextBorderStyle.OUTLINE, __color(color), size);
  }` },

    /* ---------------------------------------------------------------- Tweens / timers */
    startTween: { deps: ['__obj', '__ease', 'cancelTween', '__onTweenCompleted'], imports: ['FlxTween'], code: `
  function startTween(tag, target, values, duration, ?options) {
    var obj = __obj(target);
    if (obj == null) return;
    var opts = {};
    var ease = options != null ? Reflect.field(options, 'ease') : null;
    Reflect.setField(opts, 'ease', __ease(ease));
    Reflect.setField(opts, 'onComplete', function(t) {
      Reflect.deleteField(__luaTweens, tag);
      __onTweenCompleted(tag);
    });
    cancelTween(tag);
    Reflect.setField(__luaTweens, tag, FlxTween.tween(obj, values, duration, opts));
  }` },
    cancelTween: { code: `
  function cancelTween(tag) {
    var t = Reflect.field(__luaTweens, tag);
    if (t != null) { t.cancel(); Reflect.deleteField(__luaTweens, tag); }
  }` },
    __onTweenCompleted: { code: `
  function __onTweenCompleted(tag) { __hook_onTweenCompleted(tag); }` },
    doTweenX: { deps: ['startTween'], code: `
  function doTweenX(tag, vars, value, duration, ?ease) { startTween(tag, vars, {x: value}, duration, {ease: ease}); }` },
    doTweenY: { deps: ['startTween'], code: `
  function doTweenY(tag, vars, value, duration, ?ease) { startTween(tag, vars, {y: value}, duration, {ease: ease}); }` },
    doTweenAlpha: { deps: ['startTween'], code: `
  function doTweenAlpha(tag, vars, value, duration, ?ease) { startTween(tag, vars, {alpha: value}, duration, {ease: ease}); }` },
    doTweenAngle: { deps: ['startTween'], code: `
  function doTweenAngle(tag, vars, value, duration, ?ease) { startTween(tag, vars, {angle: value}, duration, {ease: ease}); }` },
    doTweenZoom: { deps: ['startTween'], code: `
  function doTweenZoom(tag, vars, value, duration, ?ease) { startTween(tag, vars, {zoom: value}, duration, {ease: ease}); }` },
    doTweenColor: { deps: ['__obj', '__color', '__ease', 'cancelTween', '__onTweenCompleted'], imports: ['FlxTween'], code: `
  function doTweenColor(tag, vars, targetColor, duration, ?ease) {
    var obj = __obj(vars);
    if (obj == null) return;
    cancelTween(tag);
    var from = obj.color;
    var to = __color(targetColor);
    Reflect.setField(__luaTweens, tag, FlxTween.color(obj, duration, from, to, {ease: __ease(ease), onComplete: function(t) { Reflect.deleteField(__luaTweens, tag); __onTweenCompleted(tag); }}));
  }` },
    __strum: { code: `
  function __strum(note) {
    var ps = PlayState.instance;
    var i = Std.int(note);
    if (i < 4) return ps.opponentStrumline.getByIndex(i);
    return ps.playerStrumline.getByIndex(i - 4);
  }` },
    __noteTween: { deps: ['__strum', '__ease', 'cancelTween', '__onTweenCompleted'], imports: ['FlxTween'], code: `
  function __noteTween(tag, note, values, duration, ease) {
    var s = __strum(note);
    if (s == null) return;
    cancelTween(tag);
    Reflect.setField(__luaTweens, tag, FlxTween.tween(s, values, duration, {ease: __ease(ease), onComplete: function(t) { Reflect.deleteField(__luaTweens, tag); __onTweenCompleted(tag); }}));
  }` },
    noteTweenX: { deps: ['__noteTween'], code: `
  function noteTweenX(tag, note, value, duration, ?ease) { __noteTween(tag, note, {x: value}, duration, ease); }` },
    noteTweenY: { deps: ['__noteTween'], code: `
  function noteTweenY(tag, note, value, duration, ?ease) { __noteTween(tag, note, {y: value}, duration, ease); }` },
    noteTweenAlpha: { deps: ['__noteTween'], code: `
  function noteTweenAlpha(tag, note, value, duration, ?ease) { __noteTween(tag, note, {alpha: value}, duration, ease); }` },
    noteTweenAngle: { deps: ['__noteTween'], code: `
  function noteTweenAngle(tag, note, value, duration, ?ease) { __noteTween(tag, note, {angle: value}, duration, ease); }` },
    runTimer: { deps: ['cancelTimer'], imports: ['FlxTimer'], code: `
  function runTimer(tag, ?time, ?loops) {
    if (time == null) time = 1;
    if (loops == null) loops = 1;
    cancelTimer(tag);
    var timer = new FlxTimer();
    Reflect.setField(__luaTimers, tag, timer);
    timer.start(time, function(t) {
      if (t.finished) Reflect.deleteField(__luaTimers, tag);
      __hook_onTimerCompleted(tag, t.loops, t.loopsLeft);
    }, loops);
  }` },
    cancelTimer: { code: `
  function cancelTimer(tag) {
    var t = Reflect.field(__luaTimers, tag);
    if (t != null) { t.cancel(); Reflect.deleteField(__luaTimers, tag); }
  }` },

    /* ---------------------------------------------------------------- Audio */
    playSound: { imports: ['FunkinSound', 'Paths'], code: `
  function playSound(sound, ?volume, ?tag) {
    FunkinSound.playOnce(Paths.sound(sound), volume == null ? 1 : volume);
  }` },
    playMusic: { imports: ['FunkinSound', 'Paths'], code: `
  function playMusic(sound, ?volume, ?loop) {
    FunkinSound.playMusic(sound, {startingVolume: volume == null ? 1 : volume, overrideExisting: true, restartTrack: true, loop: loop == true});
  }` },
    getSongPosition: { code: `
  function getSongPosition() { return Conductor.instance.songPosition; }` },

    /* ---------------------------------------------------------------- Camera */
    cameraShake: { deps: ['__cam'], code: `
  function cameraShake(cam, ?intensity, ?duration) { __cam(cam).shake(intensity == null ? 0.05 : intensity, duration == null ? 0.5 : duration); }` },
    cameraFlash: { deps: ['__cam', '__color'], code: `
  function cameraFlash(cam, ?color, ?duration, ?force) { __cam(cam).flash(__color(color == null ? 'FFFFFF' : color), duration == null ? 0.5 : duration, null, force == true); }` },
    cameraFade: { deps: ['__cam', '__color'], code: `
  function cameraFade(cam, ?color, ?duration, ?force) { __cam(cam).fade(__color(color == null ? '000000' : color), duration == null ? 0.5 : duration, false, null, force == true); }` },
    cameraSetTarget: { code: `
  function cameraSetTarget(target) {
    var ps = PlayState.instance;
    var t = Std.string(target).toLowerCase();
    var ch = null;
    if (t == 'dad' || t == 'opponent') ch = ps.currentStage.getDad();
    else if (t == 'gf' || t == 'girlfriend') ch = ps.currentStage.getGirlfriend();
    else ch = ps.currentStage.getBoyfriend();
    if (ch == null) return;
    ps.cameraFollowPoint.setPosition(ch.cameraFocusPoint.x, ch.cameraFocusPoint.y);
  }` },
    setCameraFollowPoint: { code: `
  function setCameraFollowPoint(x, y) { PlayState.instance.cameraFollowPoint.setPosition(x, y); }` },
    getCameraFollowX: { code: `
  function getCameraFollowX() { return PlayState.instance.cameraFollowPoint.x; }` },
    getCameraFollowY: { code: `
  function getCameraFollowY() { return PlayState.instance.cameraFollowPoint.y; }` },

    /* ---------------------------------------------------------------- Game state */
    getHealth: { code: `
  function getHealth() { return PlayState.instance.health; }` },
    setHealth: { code: `
  function setHealth(v) { PlayState.instance.health = v; }` },
    addHealth: { code: `
  function addHealth(v) { PlayState.instance.health += v; }` },
    addScore: { code: `
  function addScore(?v) { PlayState.instance.songScore += (v == null ? 0 : v); }` },
    setScore: { code: `
  function setScore(?v) { PlayState.instance.songScore = (v == null ? 0 : v); }` },
    endSong: { code: `
  function endSong() { PlayState.instance.endSong(true); }` },
    startCountdown: { code: `
  function startCountdown() { PlayState.instance.startCountdown(); return true; }` },
    close: { code: `
  function close() { __closed = true; }` },
    debugPrint: { deps: ['lua_str'], code: `
  function debugPrint(?a, ?b, ?c, ?d) {
    var parts = [];
    var all = [a, b, c, d];
    for (x in all) if (x != null) parts.push(lua_str(x));
    trace(parts.join(' '));
  }` },
    getRandomInt: { code: `
  function getRandomInt(min, ?max, ?exclude) { if (max == null) max = 0; return FlxG.random.int(Std.int(min), Std.int(max)); }` },
    getRandomFloat: { code: `
  function getRandomFloat(min, ?max, ?exclude) { if (max == null) max = 1; return FlxG.random.float(min, max); }` },
    getRandomBool: { code: `
  function getRandomBool(?chance) { return FlxG.random.bool(chance == null ? 50 : chance); }` },
    triggerEvent: { imports: ['SongEventData', 'SongEventRegistry'], code: `
  function triggerEvent(name, ?v1, ?v2) {
    var data = new SongEventData(Conductor.instance.songPosition, name, {value1: v1, value2: v2});
    SongEventRegistry.handleEvent(data);
    __hook_onEvent(name, v1, v2);
  }` },
    precacheImage: { code: `
  function precacheImage(?a) { return null; }` },
    precacheSound: { code: `
  function precacheSound(?a) { return null; }` },
    precacheMusic: { code: `
  function precacheMusic(?a) { return null; }` },
    stringStartsWith: { code: `
  function stringStartsWith(s, start) { return s.indexOf(start) == 0; }` },
    stringEndsWith: { code: `
  function stringEndsWith(s, e) { return s.length >= e.length && s.substr(s.length - e.length) == e; }` },
    stringSplit: { code: `
  function stringSplit(s, sep) { return s.split(sep); }` },
    stringTrim: { code: `
  function stringTrim(s) { return StringTools.trim(s); }` },
    // Cosmetic text settings with no V-Slice equivalent: accepted and ignored instead of reported as unsupported.
    setTextFont: { code: `
  function setTextFont(tag, ?font) { return null; }` },
    setTextItalic: { code: `
  function setTextItalic(tag, ?italic) { return null; }` },
    setTextAutoSize: { code: `
  function setTextAutoSize(tag, ?autoSize) { return null; }` },
    updateScoreText: { code: `
  function updateScoreText() { return null; }` },
    setLuaSpriteScrollFactor: { deps: ['setScrollFactor'], code: `
  function setLuaSpriteScrollFactor(tag, x, y) { setScrollFactor(tag, x, y); }` },
    getColorFromHex: { deps: ['__color'], code: `
  function getColorFromHex(c) { return __color(c); }` },

    /* ---------------------------------------------------------------- Characters */
    __char: { code: `
  function __char(name) {
    var n = Std.string(name).toLowerCase();
    var st = PlayState.instance.currentStage;
    if (n == 'dad' || n == 'opponent' || n == '1') return st.getDad();
    if (n == 'gf' || n == 'girlfriend' || n == '2') return st.getGirlfriend();
    return st.getBoyfriend();
  }` },
    characterPlayAnim: { deps: ['__char'], code: `
  function characterPlayAnim(character, anim, ?force) {
    var c = __char(character);
    if (c != null) c.playAnimation(anim, force == true, true);
  }` },
    characterDance: { deps: ['__char'], code: `
  function characterDance(character) { var c = __char(character); if (c != null) c.dance(true); }` },
    getCharacterX: { deps: ['__char'], code: `
  function getCharacterX(character) { var c = __char(character); return c == null ? 0 : c.x; }` },
    getCharacterY: { deps: ['__char'], code: `
  function getCharacterY(character) { var c = __char(character); return c == null ? 0 : c.y; }` },
    setCharacterX: { deps: ['__char'], code: `
  function setCharacterX(character, v) { var c = __char(character); if (c != null) c.x = v; }` },
    setCharacterY: { deps: ['__char'], code: `
  function setCharacterY(character, v) { var c = __char(character); if (c != null) c.y = v; }` },

    /* ---------------------------------------------------------------- Input */
    keyboardPressed: { code: `
  function keyboardPressed(key) { return Reflect.getProperty(FlxG.keys.pressed, Std.string(key).toUpperCase()) == true; }` },
    keyboardJustPressed: { code: `
  function keyboardJustPressed(key) { return Reflect.getProperty(FlxG.keys.justPressed, Std.string(key).toUpperCase()) == true; }` },
    keyboardReleased: { code: `
  function keyboardReleased(key) { return Reflect.getProperty(FlxG.keys.justReleased, Std.string(key).toUpperCase()) == true; }` },
    keyJustPressed: { imports: ['PlayerSettings'], code: `
  function keyJustPressed(key) {
    var k = Std.string(key).toLowerCase();
    var c = PlayerSettings.player1.controls;
    if (k == 'left') return c.NOTE_LEFT_P;
    if (k == 'down') return c.NOTE_DOWN_P;
    if (k == 'up') return c.NOTE_UP_P;
    if (k == 'right') return c.NOTE_RIGHT_P;
    if (k == 'accept') return c.ACCEPT;
    if (k == 'back') return c.BACK;
    return false;
  }` },
    keyPressed: { imports: ['PlayerSettings'], code: `
  function keyPressed(key) {
    var k = Std.string(key).toLowerCase();
    var c = PlayerSettings.player1.controls;
    if (k == 'left') return c.NOTE_LEFT;
    if (k == 'down') return c.NOTE_DOWN;
    if (k == 'up') return c.NOTE_UP;
    if (k == 'right') return c.NOTE_RIGHT;
    return false;
  }` },
  };

  /** Hook functions the generated class calls into the translated script (default to no-ops). */
  const HOOK_NAMES = ['onTweenCompleted', 'onTimerCompleted', 'onEvent'];
  C.PSYCH_HOOKS = HOOK_NAMES;

  C.psychShim = {
    SHIM,
    BASE,
    BASE_IMPORTS,
    GLOBALS,
    IMPORTS,
    has: (name) => Object.prototype.hasOwnProperty.call(SHIM, name),

    /** Returns {code, imports:Set} with the transitive closure of `names`. */
    collect(names) {
      const seen = new Set();
      const imports = new Set(BASE_IMPORTS);
      const parts = [];
      const visit = (n) => {
        if (seen.has(n) || !SHIM[n]) return;
        seen.add(n);
        const e = SHIM[n];
        (e.deps || []).forEach(visit);
        (e.imports || []).forEach((i) => imports.add(i));
        parts.push(e.code);
      };
      names.forEach(visit);
      return { code: parts.join('\n'), imports };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
