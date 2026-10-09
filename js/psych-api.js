/*
 * Psych Engine Lua API -> direct V-Slice code.
 *
 * Instead of pasting an emulation layer into every script, each Psych function is *lowered* to the statements a
 * human would write against the real V-Slice API (PlayState.instance, FunkinSprite, FlxTween, FunkinSound...).
 * Tags that are string literals ("flash") become class fields; only dynamic tags/paths fall back to a few tiny helpers.
 *
 * Everything emitted here avoids what the game's script sandbox blocks or lacks (Type.typeof, Type.getClass,
 * Reflect.deleteField...); the only reflection used is Reflect.field/setField/getProperty/setProperty, which the
 * sandbox (funkin.util.ReflectUtil) provides.
 *
 * Verified against the Funkin source: PlayState (camGame, camHUD, camCutscene, health, songScore, iconP1/2, healthBar,
 * cameraFollowPoint, currentCameraZoom, isBotPlayMode, currentStage, playerStrumline/opponentStrumline.getByIndex),
 * Stage (add, remove, refresh, getBoyfriend/getDad/getGirlfriend/getNamedProp), BaseCharacter (playAnimation,
 * cameraFocusPoint, characterId), Conductor.instance, FunkinSprite.create/createSparrow/makeSolidColor, FunkinSound.playOnce.
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  const PS = 'PlayState.instance';
  const STAGE = PS + '.currentStage';

  /** Psych "global" variables, replaced inline by the V-Slice expression that holds the same information. */
  const GLOBAL_EXPR = {
    curBeat: 'Conductor.instance.currentBeat',
    curStep: 'Conductor.instance.currentStep',
    curSection: 'Conductor.instance.currentMeasure',
    curDecBeat: 'Conductor.instance.currentBeatTime',
    curDecStep: 'Conductor.instance.currentStepTime',
    bpm: 'Conductor.instance.bpm',
    curBpm: 'Conductor.instance.bpm',
    crochet: 'Conductor.instance.beatLengthMs',
    stepCrochet: 'Conductor.instance.stepLengthMs',
    songLength: 'FlxG.sound.music.length',
    songName: PS + '.currentSong.songName',
    songPath: PS + '.currentSong.id',
    scrollSpeed: PS + '.currentChart.scrollSpeed',
    difficultyName: PS + '.currentDifficulty',
    difficulty: '(' + PS + '.currentDifficulty == "easy" ? 0 : (' + PS + '.currentDifficulty == "hard" ? 2 : 1))',
    curStage: PS + '.currentStageId',
    boyfriendName: STAGE + '.getBoyfriend().characterId',
    dadName: STAGE + '.getDad().characterId',
    gfName: STAGE + '.getGirlfriend().characterId',
    screenWidth: 'FlxG.width',
    screenHeight: 'FlxG.height',
    downscroll: 'Preferences.downscroll',
    middlescroll: 'false',
    lowQuality: 'false',
    shadersEnabled: 'false',
    flashingLights: 'Preferences.flashingLights',
    ghostTapping: 'true',
    hideHud: 'false',
    framerate: '60',
    score: PS + '.songScore',
    misses: 'Highscore.tallies.missed',
    hits: 'Highscore.tallies.totalNotesHit',
    combo: 'Highscore.tallies.combo',
    rating: '0',
    ratingName: '""',
    ratingFC: '""',
    isStoryMode: 'PlayStatePlaylist.isStoryMode',
    botPlay: PS + '.isBotPlayMode',
    practice: PS + '.isPracticeMode',
    startedCountdown: '(!' + PS + '.isInCountdown)',
    inGameOver: PS + '.isGameOverState',
    mustHitSection: 'false',
    gfSection: 'false',
    altAnim: 'false',
    hasVocals: 'true',
    playbackRate: PS + '.playbackRate',
    version: '"0.7.3"',
    modFolder: '""',
    currentModDirectory: '""',
    scriptName: '""',
    luaDebugMode: 'false',
    luaDeprecatedWarnings: 'false',
    Function_Stop: '"##PSYCHLUA_FUNCTIONSTOP"',
    Function_Continue: '"##PSYCHLUA_FUNCTIONCONTINUE"',
    Function_StopLua: '"##PSYCHLUA_FUNCTIONSTOPLUA"',
    Function_StopHScript: '"##PSYCHLUA_FUNCTIONSTOPHSCRIPT"',
    Function_StopAll: '"##PSYCHLUA_FUNCTIONSTOPALL"',
  };
  /** Psych globals that read as booleans (so conditions on them need no truthiness wrapper). */
  const BOOL_GLOBALS = new Set(['downscroll', 'middlescroll', 'lowQuality', 'shadersEnabled', 'flashingLights', 'ghostTapping', 'hideHud', 'isStoryMode', 'botPlay', 'practice', 'startedCountdown', 'inGameOver', 'mustHitSection', 'gfSection', 'altAnim', 'hasVocals']);

  /** Objects Psych scripts reach by name. */
  const ROOTS = {
    boyfriend: STAGE + '.getBoyfriend()',
    bf: STAGE + '.getBoyfriend()',
    dad: STAGE + '.getDad()',
    gf: STAGE + '.getGirlfriend()',
    camGame: PS + '.camGame',
    camHUD: PS + '.camHUD',
    camOther: PS + '.camCutscene',
    iconP1: PS + '.iconP1',
    iconP2: PS + '.iconP2',
    healthBar: PS + '.healthBar',
    healthBarBG: PS + '.healthBarBG',
    camFollow: PS + '.cameraFollowPoint',
    camFollowPos: PS + '.cameraFollowPoint',
  };
  /** Single-name PlayState properties (setProperty('health', 1)). */
  const SCALARS = {
    health: PS + '.health',
    defaultCamZoom: PS + '.currentCameraZoom',
    cpuControlled: PS + '.isBotPlayMode',
    inCutscene: PS + '.isInCutscene',
    practiceMode: PS + '.isPracticeMode',
    playbackRate: PS + '.playbackRate',
  };
  const STRUM_ROOTS = new Set(['playerStrums', 'opponentStrums', 'strumLineNotes']);

  const CAMERAS = { camgame: PS + '.camGame', game: PS + '.camGame', camhud: PS + '.camHUD', hud: PS + '.camHUD', camother: PS + '.camCutscene', other: PS + '.camCutscene' };
  const CHARS = { bf: STAGE + '.getBoyfriend()', boyfriend: STAGE + '.getBoyfriend()', player: STAGE + '.getBoyfriend()', '0': STAGE + '.getBoyfriend()', dad: STAGE + '.getDad()', opponent: STAGE + '.getDad()', '1': STAGE + '.getDad()', gf: STAGE + '.getGirlfriend()', girlfriend: STAGE + '.getGirlfriend()', '2': STAGE + '.getGirlfriend()' };

  const EASES = new Set(['linear', 'backIn', 'backInOut', 'backOut', 'bounceIn', 'bounceInOut', 'bounceOut', 'circIn', 'circInOut', 'circOut', 'cubeIn', 'cubeInOut', 'cubeOut', 'elasticIn', 'elasticInOut', 'elasticOut', 'expoIn', 'expoInOut', 'expoOut', 'quadIn', 'quadInOut', 'quadOut', 'quartIn', 'quartInOut', 'quartOut', 'quintIn', 'quintInOut', 'quintOut', 'sineIn', 'sineInOut', 'sineOut', 'smoothStepIn', 'smoothStepInOut', 'smoothStepOut', 'smootherStepIn', 'smootherStepInOut', 'smootherStepOut']);

  /** Functions whose result is a Bool (conditions on them need no truthiness wrapper). */
  const BOOL_FUNCS = new Set(['keyboardJustPressed', 'keyboardPressed', 'keyboardReleased', 'keyJustPressed', 'keyPressed', 'getRandomBool', 'luaSpriteExists', 'stringStartsWith', 'stringEndsWith', 'startCountdown']);

  /* ------------------------------------------------------------------ */
  /* Tiny helpers for what cannot be written inline (dynamic tags, tonumber, floor-modulo...). Class members.        */
  /* ------------------------------------------------------------------ */
  const HELPERS = {
    __t: { code: 'function __t(v)\n{\n    return v != null && v != false;\n}' },
    __or: { code: 'function __or(a, b)\n{\n    return (a != null && a != false) ? a : b;\n}' },
    __and: { code: 'function __and(a, b)\n{\n    return (a != null && a != false) ? b : a;\n}' },
    __orf: { code: 'function __orf(a, f)\n{\n    return (a != null && a != false) ? a : f();\n}' },
    __andf: { code: 'function __andf(a, f)\n{\n    return (a != null && a != false) ? f() : a;\n}' },
    __num: { code: 'function __num(v)\n{\n    if (v == null) return null;\n    var n = Std.parseFloat(Std.string(v));\n    return Math.isNaN(n) ? null : n;\n}' },
    __mod: { code: 'function __mod(a, b)\n{\n    var r = a % b;\n    if (r != 0 && ((r < 0) != (b < 0))) r += b;\n    return r;\n}' },
    __sub: { code: 'function __sub(s, i, j)\n{\n    s = Std.string(s);\n    var n = s.length;\n    if (j == null) j = -1;\n    if (i < 0) i = n + i + 1;\n    if (j < 0) j = n + j + 1;\n    if (i < 1) i = 1;\n    if (j > n) j = n;\n    if (i > j) return "";\n    return s.substr(Std.int(i) - 1, Std.int(j - i + 1));\n}' },
    __rep: { code: 'function __rep(s, n)\n{\n    var out = "";\n    var i = 0;\n    while (i < n)\n    {\n        out += s;\n        i++;\n    }\n    return out;\n}' },
    __find: { code: 'function __find(s, pat, init)\n{\n    var i = Std.string(s).indexOf(pat, init == null ? 0 : Std.int(init) - 1);\n    return i < 0 ? null : i + 1;\n}' },
    __match: { code: 'function __match(s, pat)\n{\n    return Std.string(s).indexOf(pat) >= 0 ? pat : null;\n}' },
    __format: {
      code: 'function __format(fmt, args)\n{\n    var out = "";\n    var ai = 0;\n    var i = 0;\n    while (i < fmt.length)\n    {\n        var ch = fmt.charAt(i);\n        if (ch == "%" && i + 1 < fmt.length)\n        {\n            var j = i + 1;\n            var spec = "";\n            while (j < fmt.length && "0123456789.-+ #".indexOf(fmt.charAt(j)) >= 0)\n            {\n                spec += fmt.charAt(j);\n                j++;\n            }\n            var conv = fmt.charAt(j);\n            if (conv == "%") out += "%";\n            else\n            {\n                var a = ai < args.length ? args[ai] : null;\n                ai++;\n                var piece = "";\n                if (conv == "d" || conv == "i") piece = Std.string(Std.int(a));\n                else if (conv == "f")\n                {\n                    var prec = 6;\n                    var dot = spec.indexOf(".");\n                    if (dot >= 0) prec = Std.parseInt(spec.substr(dot + 1));\n                    var p = Math.pow(10, prec);\n                    piece = Std.string(Math.round(a * p) / p);\n                    if (prec > 0)\n                    {\n                        var di = piece.indexOf(".");\n                        if (di < 0)\n                        {\n                            piece += ".";\n                            di = piece.length - 1;\n                        }\n                        while (piece.length - di - 1 < prec) piece += "0";\n                    }\n                }\n                else piece = Std.string(a);\n                var left = spec.indexOf("-") >= 0;\n                var k = 0;\n                var zero = false;\n                while (k < spec.length && "-+ #0".indexOf(spec.charAt(k)) >= 0)\n                {\n                    if (spec.charAt(k) == "0") zero = true;\n                    k++;\n                }\n                var wend = k;\n                while (wend < spec.length && spec.charAt(wend) != ".") wend++;\n                var width = wend > k ? Std.parseInt(spec.substring(k, wend)) : 0;\n                while (piece.length < width) piece = left ? piece + " " : ((zero && conv != "s") ? "0" + piece : " " + piece);\n                out += piece;\n            }\n            i = j + 1;\n        }\n        else\n        {\n            out += ch;\n            i++;\n        }\n    }\n    return out;\n}',
    },
    __pcall: { code: 'function __pcall(f)\n{\n    try\n    {\n        f();\n        return true;\n    }\n    catch (e)\n    {\n        trace("[psych-convert] pcall caught: " + Std.string(e));\n        return false;\n    }\n}' },
    __unsupported: { code: 'function __unsupported(name)\n{\n    trace("[psych-convert] Psych function not supported in V-Slice: " + name);\n    return null;\n}' },
    // --- dynamic tags / paths -------------------------------------------------------------------------
    __obj: { fields: ['__sprites'], code: 'function __obj(tag)\n{\n    var o = Reflect.field(__sprites, tag);\n    if (o != null) return o;\n    var stage = PlayState.instance.currentStage;\n    return stage == null ? null : stage.getNamedProp(tag);\n}' },
    __reg: { fields: ['__sprites'], code: 'function __reg(tag, obj)\n{\n    Reflect.setField(__sprites, tag, obj);\n    return obj;\n}' },
    __cam: { code: 'function __cam(name)\n{\n    var n = Std.string(name).toLowerCase();\n    var state = PlayState.instance;\n    if (n == "camhud" || n == "hud") return state.camHUD;\n    if (n == "camother" || n == "other") return state.camCutscene;\n    return state.camGame;\n}' },
    __char: { code: 'function __char(name)\n{\n    var n = Std.string(name).toLowerCase();\n    var stage = PlayState.instance.currentStage;\n    if (n == "dad" || n == "opponent" || n == "1") return stage.getDad();\n    if (n == "gf" || n == "girlfriend" || n == "2") return stage.getGirlfriend();\n    return stage.getBoyfriend();\n}' },
    __color: { code: 'function __color(c)\n{\n    if (c == null) return 0xFFFFFFFF;\n    var s = Std.string(c);\n    if (s.indexOf("0x") == 0) return Std.parseInt(s);\n    if (s.indexOf("#") == 0) return FlxColor.fromString(s);\n    if (s.length == 6 || s.length == 8) return FlxColor.fromString("#" + s);\n    return c;\n}' },
    __ease: { code: 'function __ease(name)\n{\n    if (name == null || name == "") return FlxEase.linear;\n    var f = Reflect.field(FlxEase, Std.string(name));\n    return f == null ? FlxEase.linear : f;\n}' },
    __rootObj: { deps: ['__obj'], code: 'function __rootObj(name)\n{\n    var state = PlayState.instance;\n    var stage = state.currentStage;\n    if (name == "boyfriend" || name == "bf") return stage.getBoyfriend();\n    if (name == "dad") return stage.getDad();\n    if (name == "gf") return stage.getGirlfriend();\n    if (name == "camGame") return state.camGame;\n    if (name == "camHUD") return state.camHUD;\n    if (name == "camOther") return state.camCutscene;\n    if (name == "iconP1") return state.iconP1;\n    if (name == "iconP2") return state.iconP2;\n    if (name == "camFollow" || name == "camFollowPos") return state.cameraFollowPoint;\n    return __obj(name);\n}' },
    __getProp: { deps: ['__rootObj'], code: 'function __getProp(path)\n{\n    var parts = Std.string(path).split(".");\n    if (parts.length == 1) return Reflect.getProperty(PlayState.instance, parts[0]);\n    var cur = __rootObj(parts[0]);\n    var i = 1;\n    while (i < parts.length && cur != null)\n    {\n        cur = Reflect.getProperty(cur, parts[i]);\n        i++;\n    }\n    return cur;\n}' },
    __setProp: { deps: ['__rootObj'], code: 'function __setProp(path, value)\n{\n    var parts = Std.string(path).split(".");\n    if (parts.length == 1)\n    {\n        Reflect.setProperty(PlayState.instance, parts[0], value);\n        return;\n    }\n    var cur = __rootObj(parts[0]);\n    var i = 1;\n    while (i < parts.length - 1 && cur != null)\n    {\n        cur = Reflect.getProperty(cur, parts[i]);\n        i++;\n    }\n    if (cur != null) Reflect.setProperty(cur, parts[parts.length - 1], value);\n}' },
    __strum: { code: 'function __strum(i)\n{\n    var state = PlayState.instance;\n    return i < 4 ? state.opponentStrumline.getByIndex(Std.int(i)) : state.playerStrumline.getByIndex(Std.int(i) - 4);\n}' },
  };

  /* ------------------------------------------------------------------ */
  /* Lowering                                                            */
  /* ------------------------------------------------------------------ */
  const idPart = (tag) => String(tag).replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');

  /** Code for a color argument. */
  function colorCode(a, i, def) {
    if (!a.has(i)) return def || '0xFFFFFFFF';
    const s = a.s(i);
    if (s != null) {
      if (/^0x[0-9a-fA-F]{6,8}$/.test(s)) return s.length === 8 ? '0xFF' + s.slice(2) : s;
      const h = s.replace(/^#/, '');
      if (/^[0-9a-fA-F]{6}$/.test(h)) return '0xFF' + h.toUpperCase();
      if (/^[0-9a-fA-F]{8}$/.test(h)) return '0x' + h.toUpperCase();
    }
    a.helper('__color');
    return '__color(' + a.c(i) + ')';
  }

  function camCode(a, i, def) {
    if (!a.has(i)) return def || PS + '.camGame';
    const s = a.s(i);
    if (s != null && CAMERAS[s.toLowerCase()]) return CAMERAS[s.toLowerCase()];
    a.helper('__cam');
    return '__cam(' + a.c(i) + ')';
  }

  function charCode(a, i) {
    const s = a.s(i);
    if (s != null && CHARS[s.toLowerCase()]) return CHARS[s.toLowerCase()];
    a.helper('__char');
    return '__char(' + a.c(i) + ')';
  }

  function easeCode(a, i) {
    if (!a.has(i)) return 'FlxEase.linear';
    const s = a.s(i);
    if (s != null) {
      if (s === '') return 'FlxEase.linear';
      if (EASES.has(s)) return 'FlxEase.' + s;
    }
    a.helper('__ease');
    return '__ease(' + a.c(i) + ')';
  }

  /** Code that evaluates to the object a tag/name refers to. */
  function objCode(a, i) {
    const s = a.s(i);
    if (s != null) return a.objByName(s);
    a.helper('__obj');
    return '__obj(' + a.c(i) + ')';
  }

  /** `a.b[2].c` -> V-Slice lvalue/rvalue expression, or null when the path is not a literal. */
  function pathCode(a, i) {
    const path = a.s(i);
    if (path == null) return null;
    const parts = path.split('.');
    const first = /^([A-Za-z_]\w*)(?:\[(\d+)\])?$/.exec(parts[0]);
    if (!first) return null;
    const rootName = first[1];
    let rest = parts.slice(1);
    let index = first[2] != null ? parseInt(first[2], 10) : null;
    if (STRUM_ROOTS.has(rootName)) {
      // playerStrums[1].alpha  |  playerStrums.members[1].alpha
      if (index == null && rest.length) {
        const m = /^members\[(\d+)\]$/.exec(rest[0]);
        if (m) { index = parseInt(m[1], 10); rest = rest.slice(1); }
        else if (rest[0] === 'members') rest = rest.slice(1);
      }
      if (index == null) return null;
      let strum;
      if (rootName === 'playerStrums') strum = PS + '.playerStrumline.getByIndex(' + index + ')';
      else if (rootName === 'opponentStrums') strum = PS + '.opponentStrumline.getByIndex(' + index + ')';
      else strum = index < 4 ? PS + '.opponentStrumline.getByIndex(' + index + ')' : PS + '.playerStrumline.getByIndex(' + (index - 4) + ')';
      return [strum].concat(rest).join('.');
    }
    let base;
    if (rest.length === 0 && SCALARS[rootName]) return SCALARS[rootName];
    if (rest.length === 0 && index == null) {
      // single name: a PlayState property or a tagged object
      base = a.knownTag(rootName) || ROOTS[rootName] ? a.objByName(rootName) : PS + '.' + rootName;
    } else base = a.objByName(rootName);
    if (index != null) base += '[' + index + ']';
    return [base].concat(rest.filter((p) => p !== 'members')).join('.');
  }

  const stmts = (...lines) => ({ s: lines });
  const expr = (code) => ({ e: code });

  /**
   * Lowering table. Each entry receives the call context `a` and returns {e: expression} or {s: [statements]}
   * (statements only valid in statement position), or null when the call cannot be translated.
   * Context: a.n, a.has(i), a.s(i) string literal, a.num(i) number literal, a.c(i) code, a.helper(name), a.field(name, init),
   * a.objByName(tag), a.knownTag(tag), a.spriteField(tag), a.textField(tag), a.tweenCb(tagCode), a.timerCb(tagCode),
   * a.cancelTween, a.cancelTimer.
   */
  const LOWER = {
    /* ---------------------------------------------------------- sprites */
    makeLuaSprite(a) {
      const img = a.has(1) ? a.s(1) : '';
      const x = a.c(2, '0');
      const y = a.c(3, '0');
      const make = img == null ? 'FunkinSprite.create(' + x + ', ' + y + ', ' + a.c(1) + ')' : img === '' ? 'new FunkinSprite(' + x + ', ' + y + ')' : 'FunkinSprite.create(' + x + ', ' + y + ', ' + JSON.stringify(img) + ')';
      const tag = a.s(0);
      if (tag == null) { a.helper('__reg'); return stmts('__reg(' + a.c(0) + ', ' + make + ');'); }
      const f = a.spriteField(tag);
      return stmts(f + ' = ' + make + ';', f + '.antialiasing = true;');
    },
    makeAnimatedLuaSprite(a) {
      const x = a.c(2, '0');
      const y = a.c(3, '0');
      const make = 'FunkinSprite.createSparrow(' + x + ', ' + y + ', ' + a.c(1) + ')';
      const tag = a.s(0);
      if (tag == null) { a.helper('__reg'); return stmts('__reg(' + a.c(0) + ', ' + make + ');'); }
      const f = a.spriteField(tag);
      return stmts(f + ' = ' + make + ';', f + '.antialiasing = true;');
    },
    makeGraphic(a) {
      const o = objCode(a, 0);
      return stmts(o + '.makeSolidColor(' + a.c(1, '256') + ', ' + a.c(2, '256') + ', ' + colorCode(a, 3, '0xFFFFFFFF') + ');');
    },
    addLuaSprite(a) {
      const o = objCode(a, 0);
      const front = a.has(1) ? (a.node(1).t === 'True' ? '400' : a.node(1).t === 'False' ? '50' : '(' + a.c(1) + ' == true ? 400 : 50)') : '50';
      return stmts(o + '.zIndex = ' + front + ';', STAGE + '.add(' + o + ');', STAGE + '.refresh();');
    },
    removeLuaSprite(a) {
      const o = objCode(a, 0);
      const destroy = !a.has(1) || a.node(1).t !== 'False';
      return stmts(STAGE + '.remove(' + o + ', true);', ...(destroy ? [o + '.destroy();'] : []));
    },
    addAnimationByPrefix(a) {
      return stmts(objCode(a, 0) + '.animation.addByPrefix(' + a.c(1) + ', ' + a.c(2) + ', ' + a.c(3, '24') + ', ' + a.c(4, 'true') + ');');
    },
    addAnimationByIndices(a) {
      const idx = a.s(3);
      const arr = idx != null ? '[' + idx.split(',').map((n) => parseInt(n, 10)).filter(Number.isFinite).join(', ') + ']' : null;
      if (arr == null) return null;
      return stmts(objCode(a, 0) + '.animation.addByIndices(' + a.c(1) + ', ' + a.c(2) + ', ' + arr + ', "", ' + a.c(4, '24') + ', false);');
    },
    objectPlayAnimation(a) {
      return stmts(objCode(a, 0) + '.animation.play(' + a.c(1) + ', ' + a.c(2, 'false') + ');');
    },
    scaleObject(a) {
      const o = objCode(a, 0);
      const keep = a.has(3) && a.node(3).t === 'False';
      return stmts(o + '.scale.set(' + a.c(1) + ', ' + a.c(2, a.c(1)) + ');', ...(keep ? [] : [o + '.updateHitbox();']));
    },
    setGraphicSize(a) {
      const o = objCode(a, 0);
      return stmts(o + '.setGraphicSize(' + a.c(1) + ', ' + a.c(2, '0') + ');', o + '.updateHitbox();');
    },
    updateHitbox(a) { return stmts(objCode(a, 0) + '.updateHitbox();'); },
    setScrollFactor(a) { return stmts(objCode(a, 0) + '.scrollFactor.set(' + a.c(1) + ', ' + a.c(2, a.c(1)) + ');'); },
    setObjectCamera(a) { return stmts(objCode(a, 0) + '.cameras = [' + camCode(a, 1, PS + '.camGame') + '];'); },
    setObjectOrder(a) { return stmts(objCode(a, 0) + '.zIndex = ' + a.c(1) + ';', STAGE + '.refresh();'); },
    screenCenter(a) {
      const o = objCode(a, 0);
      const axis = (a.has(1) ? a.s(1) || 'xy' : 'xy').toLowerCase();
      const out = [];
      if (axis.includes('x')) out.push(o + '.x = (FlxG.width - ' + o + '.width) / 2;');
      if (axis.includes('y')) out.push(o + '.y = (FlxG.height - ' + o + '.height) / 2;');
      return stmts(...out);
    },
    setBlendMode(a) { return stmts(objCode(a, 0) + '.blend = ' + a.c(1) + ';'); },
    luaSpriteExists(a) {
      const tag = a.s(0);
      return expr(tag != null ? '(' + a.objByName(tag) + ' != null)' : '(' + (a.helper('__obj'), '__obj(' + a.c(0) + ')') + ' != null)');
    },
    getObjectOrder(a) { return expr(objCode(a, 0) + '.zIndex'); },
    getMidpointX(a) { const o = objCode(a, 0); return expr('(' + o + '.x + ' + o + '.width / 2)'); },
    getMidpointY(a) { const o = objCode(a, 0); return expr('(' + o + '.y + ' + o + '.height / 2)'); },

    /* ---------------------------------------------------------- properties */
    setProperty(a) {
      const p = pathCode(a, 0);
      if (p != null) return stmts(p + ' = ' + a.c(1) + ';');
      a.helper('__setProp');
      return stmts('__setProp(' + a.c(0) + ', ' + a.c(1) + ');');
    },
    getProperty(a) {
      const p = pathCode(a, 0);
      if (p != null) return expr(p);
      a.helper('__getProp');
      return expr('__getProp(' + a.c(0) + ')');
    },
    setVar(a) {
      const name = a.s(0);
      if (name == null) return null;
      return stmts(a.varField(name) + ' = ' + a.c(1) + ';');
    },
    getVar(a) {
      const name = a.s(0);
      return name == null ? null : expr(a.varField(name));
    },

    /* ---------------------------------------------------------- text */
    makeLuaText(a) {
      const tag = a.s(0);
      if (tag == null) return null;
      const f = a.textField(tag);
      return stmts(f + ' = new FlxText(' + a.c(3, '0') + ', ' + a.c(4, '0') + ', ' + a.c(2, '0') + ', ' + a.str(1) + ', 16);', f + '.scrollFactor.set();', f + '.cameras = [' + PS + '.camHUD];');
    },
    addLuaText(a) { return stmts(PS + '.add(' + objCode(a, 0) + ');'); },
    removeLuaText(a) { const o = objCode(a, 0); return stmts(PS + '.remove(' + o + ');', o + '.destroy();'); },
    setTextString(a) { return stmts(objCode(a, 0) + '.text = ' + a.str(1) + ';'); },
    getTextString(a) { return expr(objCode(a, 0) + '.text'); },
    setTextColor(a) { return stmts(objCode(a, 0) + '.color = ' + colorCode(a, 1) + ';'); },
    setTextSize(a) { return stmts(objCode(a, 0) + '.size = ' + a.c(1) + ';'); },
    setTextAlignment(a) { return stmts(objCode(a, 0) + '.alignment = ' + a.c(1, '"left"') + ';'); },
    setTextBorder(a) { return stmts(objCode(a, 0) + '.setBorderStyle(FlxTextBorderStyle.OUTLINE, ' + colorCode(a, 2, '0xFF000000') + ', ' + a.c(1, '2') + ');'); },
    setTextFont() { return stmts(); },
    setTextItalic() { return stmts(); },
    setTextAutoSize() { return stmts(); },

    /* ---------------------------------------------------------- tweens / timers */
    doTweenX(a) { return tween(a, 'x'); },
    doTweenY(a) { return tween(a, 'y'); },
    doTweenAlpha(a) { return tween(a, 'alpha'); },
    doTweenAngle(a) { return tween(a, 'angle'); },
    doTweenZoom(a) { return tween(a, 'zoom'); },
    doTweenColor(a) {
      const o = objCode(a, 1);
      const make = 'FlxTween.color(' + o + ', ' + a.c(3) + ', ' + o + '.color, ' + colorCode(a, 2) + ', {ease: ' + easeCode(a, 4) + a.tweenCb(a.c(0)) + '})';
      return stmts(a.keepTween(a.c(0), make));
    },
    noteTweenX(a) { return noteTween(a, 'x'); },
    noteTweenY(a) { return noteTween(a, 'y'); },
    noteTweenAlpha(a) { return noteTween(a, 'alpha'); },
    noteTweenAngle(a) { return noteTween(a, 'angle'); },
    cancelTween(a) {
      a.cancelTween = true;
      return stmts('if (Reflect.field(__tweens, ' + a.c(0) + ') != null) Reflect.field(__tweens, ' + a.c(0) + ').cancel();');
    },
    runTimer(a) {
      const cb = a.timerCb(a.c(0));
      const make = 'new FlxTimer().start(' + a.c(1, '1') + ', function(tmr)\n{\n' + (cb ? '    ' + cb + '\n' : '') + '}, ' + a.c(2, '1') + ')';
      return stmts(a.keepTimer(a.c(0), make));
    },
    cancelTimer(a) {
      a.cancelTimer = true;
      return stmts('if (Reflect.field(__timers, ' + a.c(0) + ') != null) Reflect.field(__timers, ' + a.c(0) + ').cancel();');
    },

    /* ---------------------------------------------------------- audio */
    playSound(a) { return stmts('FunkinSound.playOnce(Paths.sound(' + a.c(0) + '), ' + a.c(1, '1') + ');'); },
    playMusic(a) { return stmts('FunkinSound.playMusic(' + a.c(0) + ', {startingVolume: ' + a.c(1, '1') + ', overrideExisting: true, restartTrack: true, loop: ' + a.c(2, 'false') + '});'); },
    getSongPosition() { return expr('Conductor.instance.songPosition'); },

    /* ---------------------------------------------------------- camera */
    cameraShake(a) { return stmts(camCode(a, 0) + '.shake(' + a.c(1, '0.05') + ', ' + a.c(2, '0.5') + ');'); },
    cameraFlash(a) { return stmts(camCode(a, 0) + '.flash(' + colorCode(a, 1, '0xFFFFFFFF') + ', ' + a.c(2, '0.5') + ', null, ' + a.c(3, 'false') + ');'); },
    cameraFade(a) { return stmts(camCode(a, 0) + '.fade(' + colorCode(a, 1, '0xFF000000') + ', ' + a.c(2, '0.5') + ', false, null, ' + a.c(3, 'false') + ');'); },
    cameraSetTarget(a) {
      const ch = charCode(a, 0);
      return stmts('var __target = ' + ch + ';', PS + '.cameraFollowPoint.setPosition(__target.cameraFocusPoint.x, __target.cameraFocusPoint.y);');
    },
    setCameraFollowPoint(a) { return stmts(PS + '.cameraFollowPoint.setPosition(' + a.c(0) + ', ' + a.c(1) + ');'); },
    getCameraFollowX() { return expr(PS + '.cameraFollowPoint.x'); },
    getCameraFollowY() { return expr(PS + '.cameraFollowPoint.y'); },

    /* ---------------------------------------------------------- game state / characters */
    getHealth() { return expr(PS + '.health'); },
    setHealth(a) { return stmts(PS + '.health = ' + a.c(0) + ';'); },
    addHealth(a) { return stmts(PS + '.health += ' + a.c(0) + ';'); },
    addScore(a) { return stmts(PS + '.songScore += ' + a.c(0, '0') + ';'); },
    setScore(a) { return stmts(PS + '.songScore = ' + a.c(0, '0') + ';'); },
    startCountdown() { return expr(PS + '.startCountdown()'); },
    endSong() { return stmts(PS + '.endSong(true);'); },
    close(a) { a.field('__closed', 'false'); return stmts('__closed = true;'); },
    debugPrint(a) { return stmts('trace(' + a.all().join(', ') + ');'); },
    characterPlayAnim(a) { return stmts(charCode(a, 0) + '.playAnimation(' + a.c(1) + ', ' + a.c(2, 'false') + ', true);'); },
    characterDance(a) { return stmts(charCode(a, 0) + '.dance(true);'); },
    getCharacterX(a) { return expr(charCode(a, 0) + '.x'); },
    getCharacterY(a) { return expr(charCode(a, 0) + '.y'); },
    setCharacterX(a) { return stmts(charCode(a, 0) + '.x = ' + a.c(1) + ';'); },
    setCharacterY(a) { return stmts(charCode(a, 0) + '.y = ' + a.c(1) + ';'); },
    getRandomInt(a) { return expr('FlxG.random.int(' + a.c(0) + ', ' + a.c(1, '0') + ')'); },
    getRandomFloat(a) { return expr('FlxG.random.float(' + a.c(0) + ', ' + a.c(1, '1') + ')'); },
    getRandomBool(a) { return expr('FlxG.random.bool(' + a.c(0, '50') + ')'); },
    triggerEvent(a) {
      const call = a.hasCb('onEvent') ? ['luaOnEvent(' + a.c(0) + ', ' + a.c(1, '""') + ', ' + a.c(2, '""') + ');'] : [];
      return stmts('SongEventRegistry.handleEvent(new SongEventData(Conductor.instance.songPosition, ' + a.c(0) + ', {value1: ' + a.c(1, '""') + ', value2: ' + a.c(2, '""') + '}));', ...call);
    },
    precacheImage() { return stmts(); },
    precacheSound() { return stmts(); },
    precacheMusic() { return stmts(); },
    updateScoreText() { return stmts(); },

    /* ---------------------------------------------------------- input */
    keyboardPressed(a) { const k = a.s(0); return k != null ? expr('FlxG.keys.pressed.' + k.toUpperCase()) : null; },
    keyboardJustPressed(a) { const k = a.s(0); return k != null ? expr('FlxG.keys.justPressed.' + k.toUpperCase()) : null; },
    keyboardReleased(a) { const k = a.s(0); return k != null ? expr('FlxG.keys.justReleased.' + k.toUpperCase()) : null; },
    keyJustPressed(a) { const k = (a.s(0) || '').toLowerCase(); const m = { left: 'NOTE_LEFT_P', down: 'NOTE_DOWN_P', up: 'NOTE_UP_P', right: 'NOTE_RIGHT_P', accept: 'ACCEPT', back: 'BACK' }[k]; return m ? expr('PlayerSettings.player1.controls.' + m) : null; },
    keyPressed(a) { const k = (a.s(0) || '').toLowerCase(); const m = { left: 'NOTE_LEFT', down: 'NOTE_DOWN', up: 'NOTE_UP', right: 'NOTE_RIGHT' }[k]; return m ? expr('PlayerSettings.player1.controls.' + m) : null; },

    /* ---------------------------------------------------------- strings / colors */
    stringStartsWith(a) { return expr('StringTools.startsWith(' + a.c(0) + ', ' + a.c(1) + ')'); },
    stringEndsWith(a) { return expr('StringTools.endsWith(' + a.c(0) + ', ' + a.c(1) + ')'); },
    stringSplit(a) { return expr(a.c(0) + '.split(' + a.c(1) + ')'); },
    stringTrim(a) { return expr('StringTools.trim(' + a.c(0) + ')'); },
    getColorFromHex(a) { return expr(colorCode(a, 0)); },
  };
  LOWER.luaSpriteMakeGraphic = LOWER.makeGraphic;
  LOWER.luaSpriteAddAnimationByPrefix = LOWER.addAnimationByPrefix;
  LOWER.luaSpriteAddAnimationByIndices = LOWER.addAnimationByIndices;
  LOWER.luaSpritePlayAnimation = LOWER.objectPlayAnimation;
  LOWER.setLuaSpriteScrollFactor = LOWER.setScrollFactor;
  LOWER.setLuaSpriteCamera = LOWER.setObjectCamera;
  LOWER.scaleLuaSprite = LOWER.scaleObject;

  function tween(a, prop) {
    const o = objCode(a, 1);
    const make = 'FlxTween.tween(' + o + ', {' + prop + ': ' + a.c(2) + '}, ' + a.c(3, '1') + ', {ease: ' + easeCode(a, 4) + a.tweenCb(a.c(0)) + '})';
    return stmts(a.keepTween(a.c(0), make));
  }

  function noteTween(a, prop) {
    const n = a.num(1);
    let target;
    if (n != null) target = n < 4 ? PS + '.opponentStrumline.getByIndex(' + n + ')' : PS + '.playerStrumline.getByIndex(' + (n - 4) + ')';
    else {
      const c = a.c(1);
      target = '(' + c + ' < 4 ? ' + PS + '.opponentStrumline.getByIndex(' + c + ') : ' + PS + '.playerStrumline.getByIndex(' + c + ' - 4))';
    }
    const make = 'FlxTween.tween(' + target + ', {' + prop + ': ' + a.c(2) + '}, ' + a.c(3, '1') + ', {ease: ' + easeCode(a, 4) + a.tweenCb(a.c(0)) + '})';
    return stmts(a.keepTween(a.c(0), make));
  }

  /** Psych functions that exist but have no sensible V-Slice equivalent (reported, never silently dropped). */
  const KNOWN_UNSUPPORTED = new Set([
    'initLuaShader', 'setSpriteShader', 'removeSpriteShader', 'setShaderFloat', 'setShaderFloatArray', 'setShaderInt', 'setShaderBool', 'setShaderSampler2D',
    'runHaxeCode', 'runHaxeFunction', 'addHaxeLibrary', 'addLuaScript', 'removeLuaScript', 'callOnLuas', 'callOnScripts', 'setOnLuas',
    'openCustomSubstate', 'closeCustomSubstate', 'startDialogue', 'startVideo', 'saveFile', 'getTextFromFile', 'checkFileExists', 'setHealthBarColors',
    'setTimeBarColors', 'setRatingName', 'setRatingPercent', 'setRatingFC', 'reloadRating', 'getPropertyFromClass', 'setPropertyFromClass',
    'getPropertyFromGroup', 'setPropertyFromGroup', 'createInstance', 'addInstance', 'callMethod', 'setSoundVolume', 'getSoundVolume', 'stopSound',
  ]);

  function lower(name, a) {
    const f = LOWER[name];
    return f ? f(a) : null;
  }

  /** Collects helper source (with dependencies) and extra fields for the given helper names. */
  function collectHelpers(names) {
    const seen = new Set();
    const code = [];
    const fields = new Set();
    const visit = (n) => {
      if (seen.has(n) || !HELPERS[n]) return;
      seen.add(n);
      (HELPERS[n].deps || []).forEach(visit);
      (HELPERS[n].fields || []).forEach((f) => fields.add(f));
      code.push(HELPERS[n].code);
    };
    names.forEach(visit);
    return { code, fields };
  }

  C.psychApi = { lower, LOWER, HELPERS, GLOBAL_EXPR, BOOL_GLOBALS, BOOL_FUNCS, ROOTS, KNOWN_UNSUPPORTED, collectHelpers, idPart, EASES };
})(typeof window !== 'undefined' ? window : globalThis);
