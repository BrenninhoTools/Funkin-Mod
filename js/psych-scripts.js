/*
 * Psych Engine script conversion (Lua -> V-Slice HScript classes).
 *
 *   scripts/**.lua                 -> Module (runs in every song)       scripts/global/<name>.hxc
 *   data/<song>/*.lua              -> Song class                         scripts/songs/<song>.hxc
 *   stages/<stage>.lua (dynamic)   -> Stage class                        scripts/stages/<stage>.hxc
 *   custom_events/<name>.lua       -> SongEvent class                    scripts/events/<name>.hxc
 *   custom_notetypes/<name>.lua    -> NoteKind class                     scripts/notekinds/<name>.hxc
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
      report.warn(label + ': Psych functions with no V-Slice equivalent (calls replaced by a no-op): ' + list);
    }
  }

  async function translateFile(fs, path, prefix, opts, report) {
    let src;
    try {
      src = await fs.text(path);
    } catch (e) {
      report.error(e.message);
      return null;
    }
    try {
      const part = C.psychLua.translate(src, Object.assign({ prefix }, opts || {}));
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
    const tf = translateFile;
    const translate = async (path, prefix, opts) => {
      const part = await tf(fs, path, prefix, opts, report);
      if (part) plan.handled.add(path);
      return part;
    };
    const noteEvent = (part) => {
      if (part.callbacks.has('onEvent')) passAll = true;
    };

    const luaFiles = fs.paths.filter((p) => /\.lua$/i.test(p));
    let idx = 0;
    for (const p of luaFiles) {
      const lower = p.toLowerCase();
      const parts = lower.split('/');
      const top = parts[0];
      const prefix = 's' + idx++ + '_';

      if (top === 'scripts') {
        const part = await translate(p, prefix, null);
        if (part) { plan.global.push({ path: p, part }); noteEvent(part); }
      } else if (top === 'custom_events') {
        const part = await translate(p, prefix, null);
        if (!part) continue;
        if (!part.callbacks.has('onEvent')) report.warn(p + ': custom event script does not define onEvent(name, value1, value2); skipped');
        else {
          const evName = fileId(p);
          plan.events.push({ path: p, name: evName, part });
          passNames.add(evName);
          part.callbacks.forEach((v, k) => !['onEvent', 'onCreate', 'onCreatePost', 'onTimerCompleted', 'onTweenCompleted'].includes(k) && report.warn(p + ': callback "' + k + '" in a custom event is ignored'));
        }
      } else if (top === 'custom_notetypes') {
        const part = await translate(p, prefix, null);
        if (part) plan.kinds.push({ path: p, name: fileId(p), part });
      } else if (top === 'stages' && parts.length === 2) {
        const stageId = fileId(p);
        let tags = new Set();
        try {
          tags = new Set(C.stages.parseStageLua(await fs.text(p)).sprites.map((s) => s.tag));
        } catch (e) {
          /* reported by the translation below */
        }
        const skipCall = (fn, arg, top) => {
          if (!SETUP.has(top) || !STATIC_STAGE_FNS.has(fn) || arg == null) return false;
          const [tag, prop] = String(arg).split('.');
          return tags.has(tag) && (fn !== 'setProperty' || STATIC_PROPS.has(prop));
        };
        const part = await translate(p, prefix, { skipCall });
        if (part) {
          plan.stages.set(stageId, { path: p, part });
          noteEvent(part);
        }
      } else if (top === 'data' && parts.length === 3) {
        const folder = C.baseName(C.dirName(p));
        const part = await translate(p, prefix, null);
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
    const put = (path, text) => {
      out.text(path, text);
      count++;
    };

    // Global scripts -> one Module each
    plan.global.forEach(({ path, part }, i) => {
      const id = C.slugId(path.replace(/^scripts\//i, '').replace(/\.lua$/i, ''));
      put('scripts/global/' + id + '.hxc', C.scriptGen.buildModule({
        className: base + C.pascal(id) + 'Script', moduleId: modId + '-' + id, parts: [part], sources: [path],
      }));
    });

    // Song scripts
    for (const [folder, items] of plan.songs) {
      const songId = C.formatToSongPath(folder);
      if (!songInfos.some((s) => s.id === songId)) {
        report.warn('Lua scripts in data/' + folder + '/ belong to a song with no converted chart; skipped');
        continue;
      }
      put('scripts/songs/' + songId + '.hxc', C.scriptGen.buildSong({
        className: base + C.pascal(songId) + 'Song', songId, parts: items.map((x) => x.part), sources: items.map((x) => x.path),
      }));
    }

    // Stage scripts
    for (const [stageId, { path, part }] of plan.stages) {
      const dynamic = part.callbacks.size > 0 || part.hasMainStatements;
      if (!dynamic) continue;
      if (!ctx.modStages.has(stageId)) {
        report.warn(path + ': stage script has no stages/' + stageId + '.json, skipped');
        continue;
      }
      put('scripts/stages/' + stageId + '.hxc', C.scriptGen.buildStage({
        className: base + C.pascal(stageId) + 'Stage', stageId, parts: [part], sources: [path],
      }));
    }

    // Custom events and note kinds
    plan.events.forEach(({ path, name, part }) => {
      put('scripts/events/' + C.slugId(name) + '.hxc', C.scriptGen.buildEvent({
        className: base + C.pascal(name) + 'Event', eventName: name, part, sources: [path],
      }));
    });
    plan.kinds.forEach(({ path, name, part }) => {
      put('scripts/notekinds/' + C.slugId(name) + '.hxc', C.scriptGen.buildNoteKind({
        className: base + C.pascal(name) + 'NoteKind', kindId: name, part, sources: [path],
      }));
    });

    if (count) report.count('Scripts converted (Lua -> HScript)', count);
  }

  C.psychScripts = { prepare, emit };
})(typeof window !== 'undefined' ? window : globalThis);
