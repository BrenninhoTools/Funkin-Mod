/*
 * Psych Engine script conversion (Lua -> V-Slice HScript classes). One Lua file becomes one class:
 *
 *   scripts/**.lua                 -> Module (runs in every song)             scripts/global/<name>.hxc
 *   data/<song>/*.lua              -> Module that only runs in that song      scripts/songs/<song>-<name>.hxc
 *   stages/<stage>.lua (dynamic)   -> Module that only runs on that stage     scripts/stages/<stage>.hxc
 *   custom_events/<name>.lua       -> SongEvent                               scripts/events/<name>.hxc
 *   custom_notetypes/<name>.lua    -> NoteKind                                scripts/notekinds/<name>.hxc
 *
 * Two phases so the chart converter can know about events the scripts handle:
 *   prepare(ctx)  translate everything and compute ctx.passEvents
 *   emit(ctx, songInfos) write the .hxc files for songs/stages that were actually converted
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  const STATIC_STAGE_FNS = new Set(['makeLuaSprite', 'makeAnimatedLuaSprite', 'makeGraphic', 'luaSpriteMakeGraphic', 'addAnimationByPrefix', 'addAnimationByIndices', 'luaSpriteAddAnimationByPrefix', 'luaSpriteAddAnimationByIndices', 'objectPlayAnimation', 'luaSpritePlayAnimation', 'scaleObject', 'setGraphicSize', 'screenCenter', 'setScrollFactor', 'setLuaSpriteScrollFactor', 'addLuaSprite', 'setBlendMode', 'setProperty']);
  // Only the setup code of a stage (onCreate / main chunk) is folded into the static stage JSON; calls inside
  // other callbacks (onBeatHit, onUpdate...) are runtime behaviour and must stay in the script.
  const SETUP = new Set(['__main', 'onCreate', 'onCreatePost']);
  // setProperty is only folded for the properties the static converter understands.
  const STATIC_PROPS = new Set(['alpha', 'flipX', 'angle']);

  function fileId(p) {
    return C.stripExt(C.baseName(p));
  }

  function summarize(report, label, part) {
    part.warnings.forEach((w) => report.warn(label + ': ' + w));
    if (part.unsupported.size) {
      const list = [...part.unsupported].map(([k, n]) => k + ' x' + n).join(', ');
      report.warn(label + ': Psych functions with no V-Slice equivalent (calls replaced by a no-op that logs a message): ' + list);
    }
  }

  async function translateFile(fs, path, opts, report) {
    let src;
    try {
      src = await fs.text(path);
    } catch (e) {
      report.error(e.message);
      return null;
    }
    try {
      const part = C.psychLua.translate(src, opts || {});
      part.path = path;
      summarize(report, path, part);
      return part;
    } catch (e) {
      report.error(path + ': ' + e.message + ' (script not converted)');
      return null;
    }
  }

  /** Phase 1. */
  async function prepare(ctx) {
    const { fs, report } = ctx;
    const plan = { global: [], songs: new Map(), stages: new Map(), events: [], kinds: [], handled: new Set() };
    const passNames = new Set();
    let passAll = false;
    const translate = async (path, opts) => {
      const part = await translateFile(fs, path, opts, report);
      if (part) plan.handled.add(path);
      return part;
    };
    const noteEvent = (part) => {
      if (part.callbacks.has('onEvent')) passAll = true;
    };

    for (const p of fs.paths.filter((x) => /\.lua$/i.test(x))) {
      const parts = p.toLowerCase().split('/');
      const top = parts[0];

      if (top === 'scripts') {
        const part = await translate(p);
        if (part) { plan.global.push({ path: p, part }); noteEvent(part); }
      } else if (top === 'custom_events') {
        const part = await translate(p);
        if (!part) continue;
        if (!part.callbacks.has('onEvent')) report.warn(p + ': custom event script does not define onEvent(name, value1, value2); skipped');
        else {
          const evName = fileId(p);
          plan.events.push({ path: p, name: evName, part });
          passNames.add(evName);
          part.callbacks.forEach((v, k) => !['onEvent', 'onCreate', 'onCreatePost', 'onTimerCompleted', 'onTweenCompleted'].includes(k) && report.warn(p + ': callback "' + k + '" in a custom event is ignored'));
        }
      } else if (top === 'custom_notetypes') {
        const part = await translate(p);
        if (part) plan.kinds.push({ path: p, name: fileId(p), part });
      } else if (top === 'stages' && parts.length === 2) {
        const stageId = fileId(p);
        let tags = new Set();
        try {
          tags = new Set(C.stages.parseStageLua(await fs.text(p)).sprites.map((s) => s.tag));
        } catch (e) {
          /* reported by the translation below */
        }
        const skipCall = (fn, arg, topFn) => {
          if (!SETUP.has(topFn) || !STATIC_STAGE_FNS.has(fn) || arg == null) return false;
          const [tag, prop] = String(arg).split('.');
          return tags.has(tag) && (fn !== 'setProperty' || STATIC_PROPS.has(prop));
        };
        const part = await translate(p, { skipCall, staticTags: tags });
        if (part) {
          plan.stages.set(stageId, { path: p, part });
          noteEvent(part);
        }
      } else if (top === 'data' && parts.length === 3) {
        const folder = C.baseName(C.dirName(p));
        const part = await translate(p);
        if (part) {
          if (!plan.songs.has(folder)) plan.songs.set(folder, []);
          plan.songs.get(folder).push({ path: p, part });
          noteEvent(part);
        }
      } else if (top === 'characters') {
        report.skip('Character Lua scripts', p);
      } else {
        report.skip('Other Lua scripts', p);
      }
    }
    for (const p of fs.paths) if (/\.(hx|hscript)$/i.test(p)) report.skip('HScript files (Psych API)', p);

    ctx.scriptPlan = plan;
    ctx.passEvents = { all: passAll, names: passNames };
    return plan;
  }

  /** Phase 2. */
  function emit(ctx, songInfos) {
    const { out, report, modId } = ctx;
    const plan = ctx.scriptPlan;
    if (!plan) return;
    const base = C.pascal(modId);
    let count = 0;
    const used = new Set();
    const put = (path, text) => {
      out.text(path, text);
      count++;
    };
    const unique = (name) => {
      let n = name;
      let i = 2;
      while (used.has(n)) n = name + i++;
      used.add(n);
      return n;
    };

    // Global scripts -> one Module each (runs in every song)
    for (const { path, part } of plan.global) {
      const id = C.slugId(path.replace(/^scripts\//i, '').replace(/\.lua$/i, ''));
      const cls = unique(base + C.pascal(id));
      put('scripts/global/' + id + '.hxc', C.scriptGen.buildModule({ className: cls, moduleId: cls, part, source: path, guard: null, label: 'global script' }));
    }

    // Song scripts -> Modules that only run in their song
    for (const [folder, items] of plan.songs) {
      const songId = C.formatToSongPath(folder);
      if (!songInfos.some((s) => s.id === songId)) {
        report.warn('Lua scripts in data/' + folder + '/ belong to a song with no converted chart; skipped');
        continue;
      }
      for (const { path, part } of items) {
        const id = C.slugId(songId + '-' + fileId(path));
        const cls = unique(base + C.pascal(id));
        put('scripts/songs/' + id + '.hxc', C.scriptGen.buildModule({ className: cls, moduleId: cls, part, source: path, guard: { songId }, label: 'script for song "' + songId + '"' }));
      }
    }

    // Stage scripts (their dynamic part) -> Modules that only run on that stage
    for (const [stageId, { path, part }] of plan.stages) {
      const dynamic = part.callbacks.size > 0 || part.hasMainStatements;
      if (!dynamic) continue;
      if (!ctx.modStages.has(stageId)) {
        report.warn(path + ': stage script has no stages/' + stageId + '.json, skipped');
        continue;
      }
      const cls = unique(base + C.pascal(stageId) + 'Stage');
      put('scripts/stages/' + C.slugId(stageId) + '.hxc', C.scriptGen.buildModule({ className: cls, moduleId: cls, part, source: path, guard: { stageId }, label: 'script for stage "' + stageId + '"' }));
    }

    // Custom events and note kinds
    for (const { path, name, part } of plan.events) {
      const cls = unique(base + C.pascal(name) + 'Event');
      put('scripts/events/' + C.slugId(name) + '.hxc', C.scriptGen.buildEvent({ className: cls, eventName: name, part, source: path }));
    }
    for (const { path, name, part } of plan.kinds) {
      const cls = unique(base + C.pascal(name) + 'NoteKind');
      put('scripts/notekinds/' + C.slugId(name) + '.hxc', C.scriptGen.buildNoteKind({ className: cls, kindId: name, part, source: path }));
    }

    if (count) report.count('Scripts converted (Lua -> HScript)', count);
  }

  C.psychScripts = { prepare, emit };
})(typeof window !== 'undefined' ? window : globalThis);
