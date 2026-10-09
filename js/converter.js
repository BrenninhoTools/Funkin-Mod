/*
 * Orchestrator: finds the mod inside the zip, converts everything and builds the output zip.
 * Input: a Psych Engine mod (.zip). Output: a Friday Night Funkin' V-Slice (Polymod) mod folder in a .zip.
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  const ROOT_MARKERS = ['weeks', 'characters', 'stages', 'songs', 'data', 'images', 'custom_events', 'custom_notetypes', 'scripts', 'music', 'sounds'];

  /** Looks for Psych mods inside the zip. Returns [{prefix, name}] */
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
      if (parts[parts.length - 1].toLowerCase() === 'pack.json' && parts.length <= 4) {
        prefixes.add(parts.slice(0, -1).join('/') + (parts.length > 1 ? '/' : ''));
      }
    }
    if (!prefixes.size) {
      // No pack.json: use the shallowest prefix that contains typical mod folders.
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
  C.scanMod = async function (zip, mod) {
    const fs = new C.ModFS(zip, mod.prefix);
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
    const scripts = fs.paths.filter((p) => /\.(lua|hx|hscript)$/i.test(p));
    return {
      pack,
      songs: C.songs.listSongFolders(fs),
      characters: fs.list('characters', ['json']).filter((p) => p.split('/').length === 2).map(idOf),
      stages: fs.list('stages', ['json']).filter((p) => p.split('/').length === 2).map(idOf),
      weeks: fs.list('weeks', ['json']).filter((p) => p.split('/').length === 2).map(idOf),
      scripts,
      fileCount: fs.paths.length,
    };
  };

  const SKIP_DIRS = {
    scripts: 'Scripts (Lua/HScript)',
    custom_events: 'Custom events (Lua)',
    custom_notetypes: 'Custom note types (Lua)',
    shaders: 'Shaders',
  };

  function classifyUnconverted(p) {
    const lower = p.toLowerCase();
    const top = lower.split('/')[0];
    if (SKIP_DIRS[top]) return SKIP_DIRS[top];
    const ext = C.extOf(lower);
    if (ext === 'lua') return 'Lua scripts';
    if (ext === 'hx' || ext === 'hscript') return 'HScript files';
    if (lower.startsWith('data/')) return 'Extra files in data/';
    if (lower.startsWith('weeks/')) return 'Extra files in weeks/';
    if (lower.startsWith('characters/') || lower.startsWith('stages/')) return 'Extra character/stage files';
    return null;
  }

  /**
   * Converts one mod.
   * @param {JSZip} zip input zip (already loaded)
   * @param {{prefix:string,name:string}} mod item returned by detectMods
   * @param {Object} opts {title, modId, author, description, apiVersion, artist, charter, license, includeReport, JSZip, onLog, onProgress}
   * @returns {Promise<{zip:JSZip, report:Report, modId:string, title:string, reportText:string}>}
   */
  C.convertMod = async function (zip, mod, opts) {
    opts = opts || {};
    const JSZipCtor = opts.JSZip || root.JSZip;
    const report = new C.Report(opts.onLog);
    const fs = new C.ModFS(zip, mod.prefix);

    let pack = {};
    const packPath = fs.resolve('pack.json');
    if (packPath) {
      try {
        pack = await fs.json(packPath);
      } catch (e) {
        report.warn(e.message);
      }
    } else report.warn('pack.json not found; using the folder name as the mod name.');

    const title = (opts.title || pack.name || mod.name || 'Converted Mod').trim();
    const modId = C.slugId(opts.modId || title);
    report.log('Mod: "' + title + '" -> folder "' + modId + '"');

    const outZip = new JSZipCtor();
    const out = new C.Output(outZip, modId, report);
    const progress = opts.onProgress || function () {};

    // --- Pre-scan -----------------------------------------------------------------------
    const charFiles = fs.list('characters', ['json']).filter((p) => p.split('/').length === 2);
    const stageFiles = fs.list('stages', ['json']).filter((p) => p.split('/').length === 2);
    const weekFiles = fs.list('weeks', ['json']).filter((p) => p.split('/').length === 2);
    const songFolders = C.songs.listSongFolders(fs);
    report.log('Found ' + songFolders.length + ' song(s), ' + charFiles.length + ' character(s), ' + stageFiles.length + ' stage(s), ' + weekFiles.length + ' week(s).');

    const modChars = new Set(charFiles.map((p) => C.stripExt(C.baseName(p))));
    const modStages = new Map();
    for (const p of stageFiles) {
      const id = C.stripExt(C.baseName(p));
      let isPixel = false;
      try {
        isPixel = !!(await fs.json(p)).isPixelStage;
      } catch (e) {
        /* the error is reported when the stage is converted */
      }
      modStages.set(id, { isPixel });
    }

    const total = charFiles.length + songFolders.length + stageFiles.length + weekFiles.length + 1;
    let done = 0;
    const tick = (label) => progress(++done, total, label);

    const ctx = { fs, out, report, modId, modChars, modStages, opts, charInfo: new Map(), stageUsage: new Map(), warnedBaseChars: new Set(), warnedFrame: new Set() };

    // --- Characters -----------------------------------------------------------------------
    for (const p of charFiles) {
      const info = await C.characters.convertCharacter(p, ctx);
      if (info) ctx.charInfo.set(info.id, info);
      tick('Character ' + C.baseName(p));
    }

    // --- Songs ----------------------------------------------------------------------------
    const songInfos = [];
    for (const folder of songFolders) {
      const info = await C.songs.convertSong(folder, ctx);
      if (info) {
        songInfos.push(info);
        const u = ctx.stageUsage.get(info.stage) || { bf: [], dad: [], gf: [] };
        u.bf.push(info.player);
        u.dad.push(info.opponent);
        u.gf.push(info.girlfriend);
        ctx.stageUsage.set(info.stage, u);
      }
      tick('Song ' + folder);
    }

    // --- Stages ---------------------------------------------------------------------------
    for (const p of stageFiles) {
      await C.stages.convertStage(p, ctx);
      tick('Stage ' + C.baseName(p));
    }

    // --- Weeks ----------------------------------------------------------------------------
    const usedSongs = new Set();
    for (const p of weekFiles) {
      const info = await C.weeks.convertWeek(p, ctx);
      if (info) info.songs.forEach((s) => usedSongs.add(s));
      tick('Week ' + C.baseName(p));
    }
    for (const s of usedSongs) {
      if (!songInfos.some((i) => i.id === s)) report.warn('A week references the song "' + s + '", but no chart was converted for it.');
    }
    const orphans = songInfos.map((i) => i.id).filter((id) => !usedSongs.has(id));
    if (orphans.length) C.weeks.buildExtrasLevel(modId, title, orphans, out, report);

    // --- Remaining files --------------------------------------------------------------------
    let copied = 0;
    for (const p of fs.paths) {
      const lower = p.toLowerCase();
      if (lower === 'pack.json') continue;
      if (lower === 'pack.png') {
        out.binary('_polymod_icon.png', await fs.bytes(p));
        continue;
      }
      const top = lower.split('/')[0];
      if (['images', 'music', 'sounds', 'fonts', 'videos'].includes(top)) {
        if (lower.endsWith('.json') && lower.startsWith('images/menucharacters/')) continue; // already folded into the levels
        if (!out.has(p)) {
          out.binary(p, await fs.bytes(p));
          copied++;
        }
        continue;
      }
      if (['songs', 'characters', 'stages', 'weeks'].includes(top) && /\.(json|ogg)$/.test(lower)) continue; // already converted
      if (lower.startsWith('data/') && lower.endsWith('.json')) continue;
      if (lower.startsWith('stages/') && lower.endsWith('.lua') && fs.exists(p.replace(/\.lua$/i, '.json'))) continue; // read by the stage converter
      const cat = classifyUnconverted(p);
      if (cat) report.skip(cat, p);
    }
    report.count('Media files copied', copied);
    tick('Files');

    // --- Polymod meta -----------------------------------------------------------------------
    const meta = {
      title,
      description: opts.description || pack.description || "Converted from Psych Engine to Friday Night Funkin' (V-Slice).",
      contributors: [{ name: opts.author || 'Unknown' }],
      api_version: opts.apiVersion || '0.8.0',
      mod_version: '1.0.0',
      license: opts.license || 'All Rights Reserved',
    };
    out.json('_polymod_meta.json', meta);
    if (pack.restart) report.log('pack.json asked for "restart"; V-Slice mods are reloaded on game restart anyway.');
    if (pack.runsGlobally === false) report.log('pack.json had runsGlobally=false; in V-Slice every enabled mod runs globally.');

    for (const [cat, list] of report.unconverted) report.warn(cat + ': ' + list.length + ' file(s) with no automatic conversion (see the report).');
    if (!report.stats['Songs converted'] && !report.stats['Characters converted'] && !report.stats['Weeks converted'])
      report.error('Nothing was converted: this zip does not look like a Psych Engine mod.');

    const reportText = report.toMarkdown(title);
    if (opts.includeReport !== false) out.text('CONVERSION_REPORT.md', reportText);

    return { zip: outZip, report, modId, title, reportText };
  };
})(typeof window !== 'undefined' ? window : globalThis);
