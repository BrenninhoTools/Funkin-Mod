/*
 * Orchestrator: finds the mod inside the zip, detects its engine, converts everything and builds the output zip.
 * Input: a Psych Engine or Codename Engine mod (.zip). Output: a Friday Night Funkin' V-Slice (Polymod) mod folder in a .zip.
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  const ROOT_MARKERS = ['weeks', 'characters', 'stages', 'songs', 'data', 'images', 'custom_events', 'custom_notetypes', 'scripts', 'music', 'sounds'];

  /** Looks for mods inside the zip. Returns [{prefix, name}] */
  C.detectMods = function (zip, zipName) {
    const files = [];
    zip.forEach((rel, e) => {
      if (e.dir) return;
      const p = rel.replace(/\\/g, '/');
      if (p.startsWith('__MACOSX/')) return;
      files.push(p);
    });

    const prefixes = new Set();
    for (const p of files) {
      const parts = p.split('/');
      const last = parts[parts.length - 1].toLowerCase();
      if (last === 'pack.json' && parts.length <= 4) {
        prefixes.add(parts.slice(0, -1).join('/') + (parts.length > 1 ? '/' : ''));
      }
      // Codename Engine: data/config/modpack.ini
      if (last === 'modpack.ini' && parts.length >= 3 && parts[parts.length - 2].toLowerCase() === 'config' && parts[parts.length - 3].toLowerCase() === 'data' && parts.length <= 6) {
        prefixes.add(parts.slice(0, -3).join('/') + (parts.length > 3 ? '/' : ''));
      }
    }
    if (!prefixes.size) {
      // No pack.json / modpack.ini: use the shallowest prefix that contains typical mod folders.
      let best = null;
      const found = new Map(); // prefix -> depth
      for (const p of files) {
        const parts = p.split('/');
        for (let i = 0; i < parts.length - 1 && i < 4; i++) {
          if (ROOT_MARKERS.includes(parts[i].toLowerCase())) {
            const pre = parts.slice(0, i).join('/') + (i > 0 ? '/' : '');
            found.set(pre, i);
            break;
          }
        }
      }
      for (const depth of found.values()) if (best == null || depth < best) best = depth;
      for (const [pre, depth] of found) if (depth === best) prefixes.add(pre);
    }

    // Drop prefixes nested inside another prefix (keep the outermost).
    const list = [...prefixes].sort((a, b) => a.length - b.length);
    const roots = [];
    for (const pre of list) if (!roots.some((r) => r !== '' && pre.startsWith(r))) roots.push(pre);

    return roots.map((prefix) => {
      const seg = prefix.replace(/\/$/, '').split('/').pop();
      return { prefix, name: seg || String(zipName || 'mod').replace(/\.zip$/i, '') };
    });
  };

  /** Quick, read-only look at a mod (used by the UI preview before converting). */
  C.scanMod = async function (zip, mod, engineOverride) {
    const fs = new C.ModFS(zip, mod.prefix);
    const engine = engineOverride && engineOverride !== 'auto' ? engineOverride : C.codename.detectEngine(fs);
    if (engine === 'codename') {
      const s = await C.codename.scan(fs);
      return Object.assign(s, { engine, pack: { name: s.pack.name, description: s.pack.description } });
    }
    let pack = {};
    const pp = fs.resolve('pack.json');
    if (pp) {
      try {
        pack = await fs.json(pp);
      } catch (e) {
        /* the conversion reports it */
      }
    }
    const idOf = (p) => C.stripExt(C.baseName(p));
    return {
      engine,
      pack,
      songs: C.songs.listSongFolders(fs),
      characters: fs.list('characters', ['json']).filter((p) => p.split('/').length === 2).map(idOf),
      stages: fs.list('stages', ['json']).filter((p) => p.split('/').length === 2).map(idOf),
      weeks: fs.list('weeks', ['json']).filter((p) => p.split('/').length === 2).map(idOf),
      scripts: fs.paths.filter((p) => /\.(lua|hx|hscript)$/i.test(p)),
      fileCount: fs.paths.length,
    };
  };

  const SKIP_DIRS = {
    scripts: 'Scripts (Lua/HScript)',
    custom_events: 'Custom events (Lua)',
    custom_notetypes: 'Custom note types (Lua)',
    shaders: 'Shaders',
  };

  function classifyUnconverted(p, engine) {
    const lower = p.toLowerCase();
    const top = lower.split('/')[0];
    if (top === 'shaders') return 'Shaders';
    if (engine === 'psych' && SKIP_DIRS[top]) return SKIP_DIRS[top];
    const ext = C.extOf(lower);
    if (ext === 'lua') return 'Lua scripts';
    if (ext === 'hx' || ext === 'hscript') return 'HScript files';
    if (lower.startsWith('data/')) return 'Extra files in data/';
    if (lower.startsWith('weeks/')) return 'Extra files in weeks/';
    if (lower.startsWith('characters/') || lower.startsWith('stages/')) return 'Extra character/stage files';
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Engine runners                                                      */
  /* ------------------------------------------------------------------ */
  async function stageUsageAdd(ctx, info) {
    const u = ctx.stageUsage.get(info.stage) || { bf: [], dad: [], gf: [] };
    u.bf.push(info.player);
    u.dad.push(info.opponent);
    if (info.girlfriend) u.gf.push(info.girlfriend);
    ctx.stageUsage.set(info.stage, u);
  }

  async function finishLevels(ctx, songInfos, usedSongs) {
    const { report, out, modId } = ctx;
    for (const s of usedSongs) {
      if (!songInfos.some((i) => i.id === s)) report.warn('A week references the song "' + s + '", but no chart was converted for it.');
    }
    const orphans = songInfos.map((i) => i.id).filter((id) => !usedSongs.has(id));
    if (orphans.length) C.weeks.buildExtrasLevel(modId, ctx.title, orphans, out, report);
  }

  async function runPsych(ctx, tick, setTotal) {
    const { fs, report } = ctx;
    const charFiles = fs.list('characters', ['json']).filter((p) => p.split('/').length === 2);
    const stageFiles = fs.list('stages', ['json']).filter((p) => p.split('/').length === 2);
    const weekFiles = fs.list('weeks', ['json']).filter((p) => p.split('/').length === 2);
    const songFolders = C.songs.listSongFolders(fs);
    report.log('Found ' + songFolders.length + ' song(s), ' + charFiles.length + ' character(s), ' + stageFiles.length + ' stage(s), ' + weekFiles.length + ' week(s).');
    setTotal(charFiles.length + songFolders.length + stageFiles.length + weekFiles.length + 1);

    ctx.modChars = new Set(charFiles.map((p) => C.stripExt(C.baseName(p))));
    for (const p of stageFiles) {
      const id = C.stripExt(C.baseName(p));
      let isPixel = false;
      try {
        isPixel = !!(await fs.json(p)).isPixelStage;
      } catch (e) {
        /* the error is reported when the stage is converted */
      }
      ctx.modStages.set(id, { isPixel });
    }

    // Scripts, phase 1: translate, so charts know which events the scripts handle.
    if (ctx.convertScripts) await C.psychScripts.prepare(ctx);

    for (const p of charFiles) {
      const info = await C.characters.convertCharacter(p, ctx);
      if (info) ctx.charInfo.set(info.id, info);
      tick('Character ' + C.baseName(p));
    }
    const songInfos = [];
    for (const folder of songFolders) {
      const info = await C.songs.convertSong(folder, ctx);
      if (info) {
        songInfos.push(info);
        await stageUsageAdd(ctx, info);
      }
      tick('Song ' + folder);
    }
    for (const p of stageFiles) {
      await C.stages.convertStage(p, ctx);
      tick('Stage ' + C.baseName(p));
    }
    const used = new Set();
    for (const p of weekFiles) {
      const info = await C.weeks.convertWeek(p, ctx);
      if (info) info.songs.forEach((s) => used.add(s));
      tick('Week ' + C.baseName(p));
    }
    await finishLevels(ctx, songInfos, used);
    if (ctx.convertScripts) C.psychScripts.emit(ctx, songInfos);
    return songInfos;
  }

  async function runCodename(ctx, tick, setTotal) {
    const { fs, report } = ctx;
    const charFiles = C.codename.listXml(fs, 'data/characters');
    const stageFiles = C.codename.listXml(fs, 'data/stages');
    const weekFiles = C.codename.listXml(fs, 'data/weeks/weeks');
    const songFolders = C.codename.listSongs(fs);
    report.log('Found ' + songFolders.length + ' song(s), ' + charFiles.length + ' character(s), ' + stageFiles.length + ' stage(s), ' + weekFiles.length + ' week(s).');
    setTotal(charFiles.length + songFolders.length + stageFiles.length + weekFiles.length + 1);

    ctx.modChars = new Set(charFiles.map((p) => C.stripExt(C.baseName(p))));
    ctx.stageSprites = new Map();
    for (const p of stageFiles) ctx.modStages.set(C.stripExt(C.baseName(p)), { isPixel: false });

    if (ctx.convertScripts) await C.codenameHx.prepare(ctx);

    for (const p of charFiles) {
      const info = await C.codename.convertCharacter(p, ctx);
      if (info) ctx.charInfo.set(info.id, info);
      tick('Character ' + C.baseName(p));
    }
    const songInfos = [];
    for (const folder of songFolders) {
      const info = await C.codename.convertSong(folder, ctx);
      if (info) {
        songInfos.push(info);
        await stageUsageAdd(ctx, info);
      }
      tick('Song ' + folder);
    }
    for (const p of stageFiles) {
      await C.codename.convertStage(p, ctx);
      tick('Stage ' + C.baseName(p));
    }
    const used = new Set();
    for (const p of weekFiles) {
      const info = await C.codename.convertWeek(p, ctx);
      if (info) info.songs.forEach((s) => used.add(s));
      tick('Week ' + C.baseName(p));
    }
    await finishLevels(ctx, songInfos, used);
    if (ctx.convertScripts) C.codenameHx.emit(ctx, songInfos);
    return songInfos;
  }

  /** Is this file already handled by the engine-specific converters (so it must not be copied/reported)? */
  function handledByConverter(ctx, p, lower) {
    const { fs } = ctx;
    if (ctx.convertScripts && /\.(lua|hx|hscript)$/.test(lower)) return true; // the script plans report what they skip
    if (ctx.convertScripts && ctx.scriptPlan && ctx.scriptPlan.handled.has(p)) return true;
    if (ctx.engine === 'psych') {
      const top = lower.split('/')[0];
      if (['songs', 'characters', 'stages', 'weeks'].includes(top) && /\.(json|ogg)$/.test(lower)) return true;
      if (lower.startsWith('data/') && lower.endsWith('.json')) return true;
      if (lower.startsWith('stages/') && lower.endsWith('.lua') && fs.exists(p.replace(/\.lua$/i, '.json'))) return true;
      if (ctx.convertScripts && lower.startsWith('custom_events/') && lower.endsWith('.txt')) return true;
      if (lower.endsWith('.json') && lower.startsWith('images/menucharacters/')) return true;
    } else {
      if (lower.startsWith('songs/') && /\.(json|ogg|mp3|wav)$/.test(lower)) return true;
      if (lower.startsWith('data/') && /\.(xml|ini|txt|json)$/.test(lower)) return true;
    }
    return false;
  }

  /**
   * Converts one mod.
   * @param {JSZip} zip input zip (already loaded)
   * @param {{prefix:string,name:string}} mod item returned by detectMods
   * @param {Object} opts {engine, title, modId, author, description, apiVersion, artist, charter, license, includeReport, convertScripts, JSZip, onLog, onProgress}
   * @returns {Promise<{zip:JSZip, report:Report, modId:string, title:string, reportText:string, engine:string}>}
   */
  C.convertMod = async function (zip, mod, opts) {
    opts = opts || {};
    const JSZipCtor = opts.JSZip || root.JSZip;
    const report = new C.Report(opts.onLog);
    const fs = new C.ModFS(zip, mod.prefix);
    const engine = opts.engine && opts.engine !== 'auto' ? opts.engine : C.codename.detectEngine(fs);
    const engineName = engine === 'codename' ? 'Codename Engine' : 'Psych Engine';

    let pack = {};
    if (engine === 'psych') {
      const packPath = fs.resolve('pack.json');
      if (packPath) {
        try {
          pack = await fs.json(packPath);
        } catch (e) {
          report.warn(e.message);
        }
      } else report.warn('pack.json not found; using the folder name as the mod name.');
    } else {
      const ini = fs.resolve('data/config/modpack.ini');
      if (ini) pack = C.codename.parseIni(await fs.text(ini));
    }

    const title = (opts.title || pack.name || mod.name || 'Converted Mod').trim();
    const modId = C.slugId(opts.modId || title);
    report.log('Engine: ' + engineName + '. Mod: "' + title + '" -> folder "' + modId + '"');

    const outZip = new JSZipCtor();
    const out = new C.Output(outZip, modId, report);
    const progress = opts.onProgress || function () {};
    let total = 1;
    let done = 0;
    const tick = (label) => progress(++done, total, label);
    const setTotal = (n) => { total = n; };

    const ctx = {
      fs, out, report, modId, title, opts, engine,
      modChars: new Set(), modStages: new Map(), charInfo: new Map(), stageUsage: new Map(), stageSprites: new Map(),
      warnedBaseChars: new Set(), warnedFrame: new Set(),
      convertScripts: opts.convertScripts !== false,
      passEvents: { all: false, names: new Set() },
    };

    const songInfos = engine === 'codename' ? await runCodename(ctx, tick, setTotal) : await runPsych(ctx, tick, setTotal);

    // --- Remaining files --------------------------------------------------------------------
    let copied = 0;
    const MEDIA = ['images', 'music', 'sounds', 'fonts', 'videos'];
    for (const p of fs.paths) {
      const lower = p.toLowerCase();
      if (lower === 'pack.json') continue;
      if (lower === 'pack.png') {
        out.binary('_polymod_icon.png', await fs.bytes(p));
        continue;
      }
      const top = lower.split('/')[0];
      if (MEDIA.includes(top)) {
        if (handledByConverter(ctx, p, lower)) continue;
        if (!out.has(p)) {
          out.binary(p, await fs.bytes(p));
          copied++;
        }
        continue;
      }
      if (handledByConverter(ctx, p, lower)) continue;
      const cat = classifyUnconverted(p, engine);
      if (cat) report.skip(cat, p);
    }
    report.count('Media files copied', copied);
    tick('Files');

    // --- Polymod meta -----------------------------------------------------------------------
    const meta = {
      title,
      description: opts.description || pack.description || 'Converted from ' + engineName + " to Friday Night Funkin' (V-Slice).",
      contributors: [{ name: opts.author || 'Unknown' }],
      api_version: opts.apiVersion || '0.8.0',
      mod_version: '1.0.0',
      license: opts.license || 'All Rights Reserved',
    };
    out.json('_polymod_meta.json', meta);
    if (engine === 'psych') {
      if (pack.restart) report.log('pack.json asked for "restart"; V-Slice mods are reloaded on game restart anyway.');
      if (pack.runsGlobally === false) report.log('pack.json had runsGlobally=false; in V-Slice every enabled mod runs globally.');
    }

    for (const [cat, list] of report.unconverted) report.warn(cat + ': ' + list.length + ' file(s) with no automatic conversion (see the report).');
    if (!report.stats['Songs converted'] && !report.stats['Characters converted'] && !report.stats['Weeks converted'])
      report.error('Nothing was converted: this zip does not look like a ' + engineName + ' mod (engine ' + (opts.engine && opts.engine !== 'auto' ? 'chosen manually' : 'auto-detected') + '). If it is from the other engine, pick it in "Source engine". Codename mods have data/config/modpack.ini and XML characters; Psych mods have pack.json and JSON characters.');

    const reportText = report.toMarkdown(title, engineName);
    if (opts.includeReport !== false) out.text('CONVERSION_REPORT.md', reportText);

    return { zip: outZip, report, modId, title, reportText, engine, songInfos };
  };
})(typeof window !== 'undefined' ? window : globalThis);
