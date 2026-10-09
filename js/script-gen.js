/*
 * Builds V-Slice HScript (.hxc) class files from a translated Psych Lua script.
 *
 * Every Lua file becomes ONE class, written the way the official scripts are (see Funkin.assets and the Module example):
 *   module -> class X extends Module   (global, per-song and per-stage scripts; handlers are plain `function onUpdate(event)`)
 *   event  -> class X extends SongEvent  (custom_events/<name>.lua)
 *   kind   -> class X extends NoteKind   (custom_notetypes/<name>.lua)
 *
 * Psych callbacks stay as small functions (luaOnBeatHit, luaGoodNoteHit...) that the V-Slice handlers call, so a Lua
 * `return` inside a callback keeps its meaning. `onCreate` / `onCreatePost` run once per PlayState, as soon as the
 * stage exists (Modules have no per-song create event).
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  function pascal(s) {
    const words = String(s).split(/[^A-Za-z0-9]+/).filter(Boolean);
    let out = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    if (!out) out = 'Converted';
    if (/^[0-9]/.test(out)) out = 'X' + out;
    return out;
  }
  C.pascal = pascal;

  const q = (s) => C.psychLua.hsString(s);
  const IND = '    ';

  /** Class name -> import path, for everything the generated code may reference. */
  const IMPORTS = {
    PlayState: 'funkin.play.PlayState',
    PlayStatePlaylist: 'funkin.play.PlayStatePlaylist',
    Conductor: 'funkin.Conductor',
    Highscore: 'funkin.Highscore',
    PlayerSettings: 'funkin.PlayerSettings',
    FunkinSprite: 'funkin.graphics.FunkinSprite',
    FunkinSound: 'funkin.audio.FunkinSound',
    FlxG: 'flixel.FlxG',
    FlxText: 'flixel.text.FlxText',
    FlxTextBorderStyle: 'flixel.text.FlxText.FlxTextBorderStyle',
    FlxTween: 'flixel.tweens.FlxTween',
    FlxEase: 'flixel.tweens.FlxEase',
    FlxTimer: 'flixel.util.FlxTimer',
    FlxColor: 'flixel.util.FlxColor',
    FlxSprite: 'flixel.FlxSprite',
    SongEventData: 'funkin.data.song.SongData.SongEventData',
    SongEventRegistry: 'funkin.data.event.SongEventRegistry',
    Preferences: 'funkin.Preferences',
    Paths: 'funkin.Paths',
    StringTools: 'StringTools',
  };
  C.SCRIPT_IMPORTS = IMPORTS;

  /** Import lines for the classes mentioned in `body` (string literals and comments are ignored). */
  function importsFor(body, extra) {
    const stripped = body.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/\/\/[^\n]*/g, '');
    const set = new Set(extra || []);
    for (const name of Object.keys(IMPORTS)) if (new RegExp('\\b' + name + '\\b').test(stripped)) set.add(IMPORTS[name]);
    return [...set].sort().map((p) => 'import ' + p + ';').join('\n');
  }

  const has = (part, name) => part.callbacks.has(name);
  const fn = (part, name) => part.callbacks.get(name).fn;

  /** Fields + helper functions + translated script. */
  function members(part) {
    const extra = C.psychApi.collectHelpers(part.helpers);
    const fields = new Map(part.fields);
    extra.fields.forEach((f) => { if (!fields.has(f)) fields.set(f, '{}'); });
    // `part.members` already declares the script's own fields; add the helper fields it does not know about.
    const missing = [...fields].filter(([name]) => !part.fields.has(name)).map(([name, init]) => IND + 'var ' + name + ' = ' + init + ';');
    const fieldsText = [part.fieldsText, missing.join('\n')].filter(Boolean).join('\n');
    const helpersText = extra.code.map((c) => c.split('\n').map((l) => (l ? IND + l : l)).join('\n')).join('\n\n');
    return { fieldsText, functionsText: part.functionsText, helpersText, fields };
  }

  /** Class body in reading order: fields, constructor, framework glue, translated Lua, helpers. */
  const assemble = (m, ...glue) => [m.fieldsText, ...glue, m.functionsText, m.helpersText].filter((x) => x && x.length).join('\n\n');

  /** Statements that reset per-run state when a new PlayState starts. */
  function resetLines(fields) {
    const out = [];
    for (const [name, init] of fields) if (init === '{}') out.push(IND.repeat(3) + name + ' = {};');
    if (fields.has('__closed')) out.push(IND.repeat(3) + '__closed = false;');
    return out;
  }

  function initLines(part, depth) {
    const pad = IND.repeat(depth);
    const l = [pad + 'luaMain();'];
    if (has(part, 'onCreate')) l.push(pad + fn(part, 'onCreate') + '();');
    if (has(part, 'onCreatePost')) l.push(pad + fn(part, 'onCreatePost') + '();');
    return l;
  }

  /** V-Slice event handlers that route to the translated Psych callbacks. */
  function handlers(part, guardCall) {
    const out = [];
    const guard = guardCall ? [IND.repeat(2) + guardCall] : [];
    const add = (name, lines) => {
      if (!lines.length) return;
      out.push(IND + 'function ' + name + '(event)\n' + IND + '{\n' + guard.concat(lines.map((l) => IND.repeat(2) + l)).join('\n') + '\n' + IND + '}');
    };
    const P = (n, args) => fn(part, n) + '(' + (args || '') + ');';
    const l = [];

    if (has(part, 'onUpdate')) l.push(P('onUpdate', 'event.elapsed'));
    if (has(part, 'onUpdatePost')) l.push(P('onUpdatePost', 'event.elapsed'));
    add('onUpdate', l.splice(0));

    if (has(part, 'onBeatHit')) l.push(P('onBeatHit'));
    if (has(part, 'onSectionHit')) {
      l.push('var perMeasure = Std.int(Conductor.instance.beatsPerMeasure);');
      l.push('if (perMeasure > 0 && event.beat % perMeasure == 0)');
      l.push('{');
      l.push(IND + P('onSectionHit'));
      l.push('}');
    }
    add('onBeatHit', l.splice(0));

    if (has(part, 'onStepHit')) l.push(P('onStepHit'));
    add('onStepHit', l.splice(0));

    if (has(part, 'onSongStart')) l.push(P('onSongStart'));
    add('onSongStart', l.splice(0));

    if (has(part, 'onEndSong')) l.push(P('onEndSong'));
    add('onSongEnd', l.splice(0));

    if (has(part, 'onStartCountdown')) l.push('if (' + fn(part, 'onStartCountdown') + '() == "##PSYCHLUA_FUNCTIONSTOP") event.cancel();');
    if (has(part, 'onCountdownStarted')) l.push(P('onCountdownStarted'));
    add('onCountdownStart', l.splice(0));

    if (has(part, 'onCountdownTick')) {
      l.push('var tick = Std.string(event.step);');
      l.push('var n = tick == "THREE" ? 0 : (tick == "TWO" ? 1 : (tick == "ONE" ? 2 : (tick == "GO" ? 3 : -1)));');
      l.push('if (n >= 0) ' + P('onCountdownTick', 'n'));
    }
    add('onCountdownStep', l.splice(0));

    if (has(part, 'goodNoteHit') || has(part, 'opponentNoteHit')) {
      l.push('var note = event.note.noteData;');
      l.push('var kind = note.kind == null ? "" : note.kind;');
      const good = has(part, 'goodNoteHit') ? [P('goodNoteHit', '0, note.data % 4, kind, false')] : [];
      const opp = has(part, 'opponentNoteHit') ? [P('opponentNoteHit', '0, note.data % 4, kind, false')] : [];
      if (good.length && opp.length) l.push('if (note.getMustHitNote())', '{', IND + good[0], '}', 'else', '{', IND + opp[0], '}');
      else if (good.length) l.push('if (note.getMustHitNote()) ' + good[0]);
      else l.push('if (!note.getMustHitNote()) ' + opp[0]);
    }
    add('onNoteHit', l.splice(0));

    if (has(part, 'noteMiss')) {
      l.push('var note = event.note.noteData;');
      l.push('if (note.getMustHitNote()) ' + P('noteMiss', '0, note.data % 4, note.kind == null ? "" : note.kind, false'));
    }
    add('onNoteMiss', l.splice(0));

    if (has(part, 'noteMissPress')) l.push(P('noteMissPress', 'event.dir'));
    add('onNoteGhostMiss', l.splice(0));

    if (has(part, 'onSpawnNote')) {
      l.push('var note = event.note.noteData;');
      l.push(P('onSpawnNote', '0, note.data % 4, note.kind == null ? "" : note.kind, false'));
    }
    add('onNoteIncoming', l.splice(0));

    if (has(part, 'onEvent')) {
      l.push('var value = event.eventData.value;');
      l.push('if (value != null && Reflect.isObject(value) && Reflect.hasField(value, "value1"))');
      l.push('{');
      l.push(IND + P('onEvent', 'event.eventData.eventKind, value.value1, value.value2'));
      l.push('}');
    }
    add('onSongEvent', l.splice(0));

    if (has(part, 'onGameOver')) l.push('if (' + fn(part, 'onGameOver') + '() == "##PSYCHLUA_FUNCTIONSTOP") event.cancel();');
    add('onGameOver', l.splice(0));

    if (has(part, 'onPause')) l.push(P('onPause'));
    add('onPause', l.splice(0));
    if (has(part, 'onResume')) l.push(P('onResume'));
    add('onResume', l.splice(0));
    return out;
  }

  function header(label, source) {
    return '// Converted from Psych Engine Lua by fnf-mod-converter (' + label + ').\n// Source: ' + source + '\n// Best-effort port: review it before shipping, and keep the original script for reference.\n';
  }

  function render(head, imports, classLine, body) {
    return head + '\n' + imports + '\n\n' + classLine + '\n{\n' + body + '\n}\n';
  }

  /**
   * class X extends Module. `guard`: {songId} | {stageId} | null.
   */
  function buildModule({ className, moduleId, part, source, guard, label }) {
    const m = members(part);
    const closed = m.fields.has('__closed');
    let guardLines = [];
    if (guard && guard.songId) guardLines = [IND.repeat(2) + 'if (state.currentSong == null || state.currentSong.id != ' + q(guard.songId) + ') return false;'];
    else if (guard && guard.stageId) guardLines = [IND.repeat(2) + 'if (state.currentStageId != ' + q(guard.stageId) + ') return false;'];
    const reset = resetLines(m.fields);
    const ready = [
      IND + 'var __state = null;',
      '',
      IND + '// Psych runs onCreate once per song; a Module has no such event, so it starts when the stage is ready.',
      IND + 'function __ready()',
      IND + '{',
      IND.repeat(2) + 'var state = PlayState.instance;',
      IND.repeat(2) + 'if (state == null)',
      IND.repeat(2) + '{',
      IND.repeat(3) + '__state = null;',
      IND.repeat(3) + 'return false;',
      IND.repeat(2) + '}',
      ...guardLines,
      IND.repeat(2) + 'if (__state != state)',
      IND.repeat(2) + '{',
      IND.repeat(3) + 'if (state.currentStage == null) return false;',
      IND.repeat(3) + '__state = state;',
      ...reset,
      ...initLines(part, 3),
      IND.repeat(2) + '}',
      IND.repeat(2) + 'return ' + (closed ? '!__closed' : 'true') + ';',
      IND + '}',
    ].join('\n');
    const ctor = IND + 'function new()\n' + IND + '{\n' + IND.repeat(2) + 'super(' + q(moduleId) + ');\n' + IND + '}';
    const hs = handlers(part, 'if (!__ready()) return;');
    const body = assemble(m, ctor, ready, hs.join('\n\n'));
    const imports = importsFor(body, ['funkin.modding.module.Module']);
    return render(header(label || 'script "' + moduleId + '"', source), imports, 'class ' + className + ' extends Module', body);
  }

  /** class X extends SongEvent: a Psych custom event (custom_events/<name>.lua). */
  function buildEvent({ className, eventName, part, source }) {
    const m = members(part);
    const reset = resetLines(m.fields).map((x) => x.replace(IND.repeat(3), IND.repeat(3)));
    const handle = [
      IND + 'var __state = null;',
      '',
      IND + 'function handleEvent(data)',
      IND + '{',
      IND.repeat(2) + 'var state = PlayState.instance;',
      IND.repeat(2) + 'if (state == null) return;',
      IND.repeat(2) + 'if (__state != state)',
      IND.repeat(2) + '{',
      IND.repeat(3) + '__state = state;',
      ...reset,
      ...initLines(part, 3),
      IND.repeat(2) + '}',
      IND.repeat(2) + 'var value = data.value;',
      IND.repeat(2) + 'var value1 = value == null ? "" : value.value1;',
      IND.repeat(2) + 'var value2 = value == null ? "" : value.value2;',
      IND.repeat(2) + fn(part, 'onEvent') + '(' + q(eventName) + ', value1, value2);',
      IND + '}',
      '',
      IND + 'function getEventSchema()',
      IND + '{',
      IND.repeat(2) + 'return new SongEventSchema([',
      IND.repeat(3) + '{name: "value1", title: "Value 1", type: SongEventFieldType.STRING, defaultValue: ""},',
      IND.repeat(3) + '{name: "value2", title: "Value 2", type: SongEventFieldType.STRING, defaultValue: ""}',
      IND.repeat(2) + ']);',
      IND + '}',
    ].join('\n');
    const ctor = IND + 'function new()\n' + IND + '{\n' + IND.repeat(2) + 'super(' + q(eventName) + ');\n' + IND + '}';
    const body = assemble(m, ctor, handle);
    const imports = importsFor(body, ['funkin.play.event.SongEvent', 'funkin.data.event.SongEventSchema', 'funkin.data.event.SongEventSchema.SongEventFieldType']);
    return render(header('custom event "' + eventName + '"', source), imports, 'class ' + className + ' extends SongEvent', body);
  }

  /** class X extends NoteKind: a Psych custom note type (custom_notetypes/<name>.lua). */
  function buildNoteKind({ className, kindId, part, source }) {
    const m = members(part);
    const reset = resetLines(m.fields);
    const boot = [
      IND + 'var __state = null;',
      '',
      IND + 'function __boot()',
      IND + '{',
      IND.repeat(2) + 'var state = PlayState.instance;',
      IND.repeat(2) + 'if (state == null || __state == state) return;',
      IND.repeat(2) + '__state = state;',
      ...reset.map((x) => x.replace(IND.repeat(3), IND.repeat(2))),
      ...initLines(part, 2),
      IND + '}',
    ].join('\n');
    const sides = [];
    if (has(part, 'goodNoteHit') || has(part, 'opponentNoteHit')) {
      const l = [IND.repeat(2) + 'super.onNoteHit(event);', IND.repeat(2) + '__boot();', IND.repeat(2) + 'var note = event.note.noteData;'];
      if (has(part, 'goodNoteHit')) l.push(IND.repeat(2) + 'if (note.getMustHitNote()) ' + fn(part, 'goodNoteHit') + '(0, note.data % 4, noteKind, false);');
      if (has(part, 'opponentNoteHit')) l.push(IND.repeat(2) + 'if (!note.getMustHitNote()) ' + fn(part, 'opponentNoteHit') + '(0, note.data % 4, noteKind, false);');
      sides.push(IND + 'function onNoteHit(event)\n' + IND + '{\n' + l.join('\n') + '\n' + IND + '}');
    }
    if (has(part, 'noteMiss')) {
      sides.push(IND + 'function onNoteMiss(event)\n' + IND + '{\n' + IND.repeat(2) + 'super.onNoteMiss(event);\n' + IND.repeat(2) + '__boot();\n' + IND.repeat(2) + fn(part, 'noteMiss') + '(0, event.note.noteData.data % 4, noteKind, false);\n' + IND + '}');
    }
    const ctor = IND + 'function new()\n' + IND + '{\n' + IND.repeat(2) + 'super(' + q(kindId) + ', ' + q(kindId) + ');\n' + IND + '}';
    const body = assemble(m, ctor, boot, sides.join('\n\n'));
    const imports = importsFor(body, ['funkin.play.notes.notekind.NoteKind']);
    return render(header('custom note type "' + kindId + '"', source), imports, 'class ' + className + ' extends NoteKind', body);
  }

  C.scriptGen = { buildModule, buildEvent, buildNoteKind, pascal, importsFor };
})(typeof window !== 'undefined' ? window : globalThis);
