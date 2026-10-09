/*
 * Builds V-Slice HScript (.hxc) class files from translated Psych Lua parts.
 *
 * A "part" is the result of C.psychLua.translate() for one Lua file. Several parts can share one class
 * (their members are prefixed), e.g. every script that belongs to the same song.
 *
 * Class kinds (all verified against the Funkin source, see docs in the README):
 *   song   -> class X extends Song          (events dispatched by PlayState; onCreate fires after stage+characters exist)
 *   module -> class X extends Module        (global scripts; lazily initialised per PlayState instance)
 *   stage  -> class X extends Stage         (super('stageId'))
 *   event  -> class X extends SongEvent     (handleEvent + chart editor schema)
 *   kind   -> class X extends NoteKind      (super('kindId', 'title'))
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

  /** Union of what the parts need, as a members string + imports. */
  function sharedSection(parts, extraShim, extraImports) {
    const names = new Set(extraShim || []);
    parts.forEach((p) => p.used.forEach((n) => names.add(n)));
    const { code, imports } = C.psychShim.collect(names);
    (extraImports || []).forEach((i) => imports.add(i));
    const fields = Object.entries(C.PSYCH_GLOBALS).map(([k, v]) => '  var ' + k + ' = ' + v + ';').join('\n');
    return { code: fields + '\n' + C.psychShim.BASE + '\n' + code, imports };
  }

  function importLines(imports, extra) {
    const set = new Set();
    for (const key of imports) {
      const path = C.PSYCH_IMPORTS[key];
      if (path) set.add(path);
    }
    (extra || []).forEach((e) => set.add(e));
    return [...set].sort().map((p) => 'import ' + p + ';').join('\n');
  }

  const defines = (part, name) => part.callbacks.has(name);
  const partsWith = (parts, name) => parts.filter((p) => defines(p, name));
  const call = (part, name, args) => '    ' + part.prefix + name + '(' + (args || '') + ');';

  /** Mapping of V-Slice event methods to the Psych callbacks they trigger. Returns method source strings. */
  function dispatchers(parts, o) {
    const methods = [];
    const guard = o.guard ? '    if (!__ensure()) return;\n' : '    if (__closed) return;\n';
    const sup = (m) => (o.callSuper ? '    super.' + m + '(event);\n' : '');
    const kw = o.kind === 'module' ? 'override ' : 'override ';

    const add = (method, sig, bodyLines, withRefresh) => {
      if (!bodyLines.length) return;
      methods.push(
        '  ' + kw + 'function ' + method + '(' + sig + '):Void {\n' + sup(method) + guard + (withRefresh === false ? '' : '    lua_refresh();\n') + bodyLines.join('\n') + '\n  }'
      );
    };

    // update
    {
      const body = [];
      parts.forEach((p) => {
        if (defines(p, 'onUpdate')) body.push(call(p, 'onUpdate', 'event.elapsed'));
        if (defines(p, 'onUpdatePost')) body.push(call(p, 'onUpdatePost', 'event.elapsed'));
      });
      add('onUpdate', 'event:UpdateScriptEvent', body);
    }
    // beat / section
    {
      const body = [];
      parts.forEach((p) => defines(p, 'onBeatHit') && body.push(call(p, 'onBeatHit')));
      const sect = partsWith(parts, 'onSectionHit');
      if (sect.length) {
        body.push('    var __bpm = Std.int(Conductor.instance.beatsPerMeasure);');
        body.push('    if (__bpm > 0 && event.beat % __bpm == 0) {');
        body.push('      curSection = Std.int(event.beat / __bpm);');
        sect.forEach((p) => body.push('  ' + call(p, 'onSectionHit')));
        body.push('    }');
      }
      add('onBeatHit', 'event:SongTimeScriptEvent', body);
    }
    {
      const body = [];
      parts.forEach((p) => defines(p, 'onStepHit') && body.push(call(p, 'onStepHit')));
      add('onStepHit', 'event:SongTimeScriptEvent', body);
    }
    {
      const body = [];
      parts.forEach((p) => defines(p, 'onSongStart') && body.push(call(p, 'onSongStart')));
      add('onSongStart', 'event:ScriptEvent', body);
    }
    {
      const body = [];
      parts.forEach((p) => defines(p, 'onEndSong') && body.push(call(p, 'onEndSong')));
      add('onSongEnd', 'event:ScriptEvent', body);
    }
    {
      const body = [];
      parts.forEach((p) => {
        if (defines(p, 'onStartCountdown')) {
          body.push('    if (' + p.prefix + 'onStartCountdown() == Function_Stop) { event.cancel(); }');
        }
        if (defines(p, 'onCountdownStarted')) body.push(call(p, 'onCountdownStarted'));
      });
      add('onCountdownStart', 'event:CountdownScriptEvent', body);
    }
    {
      const body = [];
      const tick = partsWith(parts, 'onCountdownTick');
      if (tick.length) {
        body.push("    var __tk = Std.string(event.step);");
        body.push("    var __n = __tk == 'THREE' ? 0 : (__tk == 'TWO' ? 1 : (__tk == 'ONE' ? 2 : (__tk == 'GO' ? 3 : -1)));");
        body.push('    if (__n >= 0) {');
        tick.forEach((p) => body.push('  ' + call(p, 'onCountdownTick', '__n')));
        body.push('    }');
      }
      add('onCountdownStep', 'event:CountdownScriptEvent', body);
    }
    {
      const good = partsWith(parts, 'goodNoteHit');
      const opp = partsWith(parts, 'opponentNoteHit');
      const body = [];
      if (good.length || opp.length) {
        body.push('    var __nd = event.note.noteData;');
        body.push("    var __kind = __nd.kind == null ? '' : __nd.kind;");
        body.push('    var __dir = __nd.data % 4;');
        body.push('    if (__nd.getStrumlineIndex() == 0) {');
        good.forEach((p) => body.push('  ' + call(p, 'goodNoteHit', '0, __dir, __kind, false')));
        body.push('    } else {');
        opp.forEach((p) => body.push('  ' + call(p, 'opponentNoteHit', '0, __dir, __kind, false')));
        body.push('    }');
      }
      add('onNoteHit', 'event:HitNoteScriptEvent', body);
    }
    {
      const miss = partsWith(parts, 'noteMiss');
      const body = [];
      if (miss.length) {
        body.push('    var __nd = event.note.noteData;');
        body.push("    var __kind = __nd.kind == null ? '' : __nd.kind;");
        body.push('    if (__nd.getStrumlineIndex() == 0) {');
        miss.forEach((p) => body.push('  ' + call(p, 'noteMiss', '0, __nd.data % 4, __kind, false')));
        body.push('    }');
      }
      add('onNoteMiss', 'event:NoteScriptEvent', body);
    }
    {
      const body = [];
      partsWith(parts, 'noteMissPress').forEach((p) => body.push(call(p, 'noteMissPress', 'Std.int(event.dir)')));
      add('onNoteGhostMiss', 'event:GhostMissNoteScriptEvent', body);
    }
    {
      const body = [];
      partsWith(parts, 'onSpawnNote').forEach((p) => {
        body.push("    var __nd2 = event.note.noteData;");
        body.push(call(p, 'onSpawnNote', "0, __nd2.data % 4, (__nd2.kind == null ? '' : __nd2.kind), false"));
      });
      add('onNoteIncoming', 'event:NoteScriptEvent', body);
    }
    {
      const ev = partsWith(parts, 'onEvent');
      const body = [];
      if (ev.length) {
        body.push('    var __v = event.eventData.value;');
        body.push("    if (__v != null && Reflect.isObject(__v) && Reflect.hasField(__v, 'value1')) {");
        ev.forEach((p) => body.push('  ' + call(p, 'onEvent', "event.eventData.eventKind, Reflect.field(__v, 'value1'), Reflect.field(__v, 'value2')")));
        body.push('    }');
      }
      add('onSongEvent', 'event:SongEventScriptEvent', body);
    }
    {
      const body = [];
      partsWith(parts, 'onGameOver').forEach((p) => body.push('    if (' + p.prefix + 'onGameOver() == Function_Stop) { event.cancel(); }'));
      add('onGameOver', 'event:ScriptEvent', body);
    }
    {
      const body = [];
      partsWith(parts, 'onPause').forEach((p) => body.push(call(p, 'onPause')));
      add('onPause', 'event:PauseScriptEvent', body);
    }
    {
      const body = [];
      partsWith(parts, 'onResume').forEach((p) => body.push(call(p, 'onResume')));
      add('onResume', 'event:ScriptEvent', body);
    }
    return methods.join('\n\n');
  }

  function hooks(parts) {
    const each = (name, args) => partsWith(parts, name).map((p) => '    ' + p.prefix + name + '(' + args + ');').join('\n');
    return [
      '  function __hook_onTweenCompleted(tag) {\n' + each('onTweenCompleted', 'tag') + '\n  }',
      '  function __hook_onTimerCompleted(tag, loops, loopsLeft) {\n' + each('onTimerCompleted', 'tag, loops, loopsLeft') + '\n  }',
      '  function __hook_onEvent(name, v1, v2) {\n' + each('onEvent', 'name, v1, v2') + '\n  }',
    ].join('\n');
  }

  const resetState = '    __luaSprites = {};\n    __luaTexts = {};\n    __luaTimers = {};\n    __luaTweens = {};\n    __luaVars = {};\n    __closed = false;';

  function initCalls(parts) {
    const lines = [];
    parts.forEach((p) => {
      lines.push('    ' + p.mainFn + '();');
      if (defines(p, 'onCreate')) lines.push(call(p, 'onCreate'));
      if (defines(p, 'onCreatePost')) lines.push(call(p, 'onCreatePost'));
    });
    return lines.join('\n');
  }

  function header(label, sources) {
    return (
      '// Auto-generated by fnf-mod-converter (' + label + ').\n' +
      '// Source: ' + sources.join(', ') + '\n' +
      "// Psych Engine Lua -> V-Slice HScript. Best-effort translation: review before shipping, and keep the original script for reference.\n"
    );
  }

  function membersOf(parts) {
    return parts.map((p) => p.members).join('\n\n');
  }

  /** class X extends Song */
  function buildSong({ className, songId, parts, sources }) {
    const shared = sharedSection(parts);
    const create =
      '  override function onCreate(event:ScriptEvent):Void {\n    super.onCreate(event);\n' + resetState + '\n    lua_refresh();\n' + initCalls(parts) + '\n  }';
    return (
      header('song "' + songId + '"', sources) +
      importLines(shared.imports, ['funkin.play.song.Song']) + '\n\n' +
      'class ' + className + ' extends Song {\n' +
      '  function new() {\n    super(' + q(songId) + ');\n  }\n\n' +
      shared.code + '\n' + hooks(parts) + '\n\n' + membersOf(parts) + '\n\n' + create + '\n\n' +
      dispatchers(parts, { callSuper: true, guard: false, kind: 'song' }) + '\n}\n'
    );
  }

  /** class X extends Module (global scripts) */
  function buildModule({ className, moduleId, parts, sources, songIds }) {
    const shared = sharedSection(parts);
    const filter = songIds && songIds.length
      ? '    var __sid = ps.currentSong == null ? \'\' : ps.currentSong.id;\n    if (' + songIds.map((s) => '__sid != ' + q(s)).join(' && ') + ') return false;\n'
      : '';
    const ensure =
      '  var __ps = null;\n' +
      '  function __ensure() {\n    var ps = PlayState.instance;\n    if (ps == null) { __ps = null; return false; }\n' + filter +
      '    if (__ps != ps) {\n      if (ps.currentStage == null) return false;\n      __ps = ps;\n' + resetState + '\n      lua_refresh();\n' + initCalls(parts).replace(/^/gm, '  ') + '\n    }\n    return !__closed;\n  }';
    return (
      header('global script "' + moduleId + '"', sources) +
      importLines(shared.imports, ['funkin.modding.module.Module']) + '\n\n' +
      'class ' + className + ' extends Module {\n' +
      '  function new() {\n    super(' + q(moduleId) + ', 1000, {state: PlayState});\n  }\n\n' +
      shared.code + '\n' + hooks(parts) + '\n\n' + membersOf(parts) + '\n\n' + ensure + '\n\n' +
      dispatchers(parts, { callSuper: false, guard: true, kind: 'module' }) + '\n}\n'
    );
  }

  /** class X extends Stage */
  function buildStage({ className, stageId, parts, sources }) {
    const shared = sharedSection(parts);
    const create =
      '  override function onCreate(event:ScriptEvent):Void {\n    super.onCreate(event);\n' + resetState + '\n    lua_refresh();\n' + initCalls(parts) + '\n  }';
    return (
      header('stage "' + stageId + '"', sources) +
      importLines(shared.imports, ['funkin.play.stage.Stage']) + '\n\n' +
      'class ' + className + ' extends Stage {\n' +
      '  function new() {\n    super(' + q(stageId) + ');\n  }\n\n' +
      shared.code + '\n' + hooks(parts) + '\n\n' + membersOf(parts) + '\n\n' + create + '\n\n' +
      dispatchers(parts, { callSuper: true, guard: false, kind: 'stage' }) + '\n}\n'
    );
  }

  /** class X extends SongEvent: a Psych custom event (custom_events/<name>.lua). */
  function buildEvent({ className, eventName, part, sources }) {
    const shared = sharedSection([part]);
    const handle =
      '  var __inited = false;\n' +
      '  var __ps = null;\n' +
      '  override function handleEvent(data:SongEventData):Void {\n' +
      '    var ps = PlayState.instance;\n' +
      '    if (ps == null) return;\n' +
      '    if (__ps != ps) {\n      __ps = ps;\n' + resetState + '\n      lua_refresh();\n      ' + part.mainFn + '();\n' + (defines(part, 'onCreate') ? '      ' + part.prefix + 'onCreate();\n' : '') + '    }\n' +
      '    lua_refresh();\n' +
      '    var v = data.value;\n' +
      "    var v1 = v == null ? null : Reflect.field(v, 'value1');\n" +
      "    var v2 = v == null ? null : Reflect.field(v, 'value2');\n" +
      '    ' + part.prefix + 'onEvent(' + q(eventName) + ', v1, v2);\n' +
      '  }\n\n' +
      '  override function getEventSchema():SongEventSchema {\n' +
      '    return new SongEventSchema([\n' +
      "      {name: 'value1', title: 'Value 1', type: SongEventFieldType.STRING, defaultValue: ''},\n" +
      "      {name: 'value2', title: 'Value 2', type: SongEventFieldType.STRING, defaultValue: ''}\n" +
      '    ]);\n  }';
    return (
      header('custom event "' + eventName + '"', sources) +
      importLines(shared.imports, ['funkin.play.event.SongEvent', 'funkin.data.song.SongData.SongEventData', 'funkin.data.event.SongEventSchema', 'funkin.data.event.SongEventSchema.SongEventFieldType']) + '\n\n' +
      'class ' + className + ' extends SongEvent {\n' +
      '  function new() {\n    super(' + q(eventName) + ');\n  }\n\n' +
      shared.code + '\n' + hooks([part]) + '\n\n' + part.members + '\n\n' + handle + '\n}\n'
    );
  }

  /** class X extends NoteKind: a Psych custom note type (custom_notetypes/<name>.lua). */
  function buildNoteKind({ className, kindId, part, sources }) {
    const shared = sharedSection([part]);
    const sides = [];
    if (defines(part, 'goodNoteHit') || defines(part, 'opponentNoteHit')) {
      sides.push(
        '  override function onNoteHit(event:HitNoteScriptEvent):Void {\n' +
          '    super.onNoteHit(event);\n    __boot();\n    lua_refresh();\n' +
          '    var __nd = event.note.noteData;\n    var __dir = __nd.data % 4;\n' +
          '    if (__nd.getStrumlineIndex() == 0) {\n' + (defines(part, 'goodNoteHit') ? '  ' + call(part, 'goodNoteHit', '0, __dir, noteKind, false') : '') + '\n    } else {\n' +
          (defines(part, 'opponentNoteHit') ? '  ' + call(part, 'opponentNoteHit', '0, __dir, noteKind, false') : '') + '\n    }\n  }'
      );
    }
    if (defines(part, 'noteMiss')) {
      sides.push(
        '  override function onNoteMiss(event:NoteScriptEvent):Void {\n    super.onNoteMiss(event);\n    __boot();\n    lua_refresh();\n' +
          '    ' + part.prefix + 'noteMiss(0, event.note.noteData.data % 4, noteKind, false);\n  }'
      );
    }
    const boot =
      '  var __ps = null;\n  function __boot() {\n    var ps = PlayState.instance;\n    if (ps == null || __ps == ps) return;\n    __ps = ps;\n' + resetState + '\n    lua_refresh();\n    ' + part.mainFn + '();\n' + (defines(part, 'onCreate') ? '    ' + part.prefix + 'onCreate();\n' : '') + '  }';
    return (
      header('custom note type "' + kindId + '"', sources) +
      importLines(shared.imports, ['funkin.play.notes.notekind.NoteKind']) + '\n\n' +
      'class ' + className + ' extends NoteKind {\n' +
      '  function new() {\n    super(' + q(kindId) + ', ' + q(kindId) + ');\n  }\n\n' +
      shared.code + '\n' + hooks([part]) + '\n\n' + part.members + '\n\n' + boot + '\n\n' + sides.join('\n\n') + '\n}\n'
    );
  }

  C.scriptGen = { buildSong, buildModule, buildStage, buildEvent, buildNoteKind, pascal };
})(typeof window !== 'undefined' ? window : globalThis);
