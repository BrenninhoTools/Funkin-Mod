/*
 * Codename Engine mod -> V-Slice.
 *
 * Source layout (Codename):                              Output (V-Slice):
 *   songs/<name>/meta.json + charts/<diff>.json           data/songs/<id>/<id>-metadata.json + -chart.json
 *   songs/<name>/song/Inst.ogg, Voices.ogg                songs/<id>/Inst.ogg, Voices.ogg | Voices-<char>.ogg
 *   data/characters/<id>.xml                               data/characters/<id>.json
 *   data/stages/<id>.xml                                   data/stages/<id>.json
 *   data/weeks/weeks/<id>.xml (+ weeks/characters)         data/levels/<id>.json
 *
 * Facts taken from the Codename source (source/funkin/backend/chart/*.hx, game/Character.hx, game/Stage.hx,
 * backend/week/Week.hx, backend/utils/XMLUtil.hx):
 *  - strumLine types: 0 = opponent, 1 = player, 2 = additional (cpu); notes are {time,id,type,sLen}
 *  - note `type` is a 1-based index into chart.noteTypes (0 = default note)
 *  - events: {name, time, params[]} with built-in names such as "Camera Movement", "BPM Change", "Scroll Speed Change"
 *  - stage/character XML attributes (x, y, camx, camy, flipX, scale, holdTime, interval, icon, sprite, <anim .../>)
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});
  const X = () => C.xml;

  const STAGE_VERSION = '1.0.2';
  const CHARACTER_VERSION = '1.0.2';
  const LEVEL_VERSION = '1.0.2';
  const METADATA_VERSION = '2.2.4';
  const CHART_VERSION = '2.0.0';
  const FALLBACK_FRAME = { w: 400, h: 400 };

  const BASE_STAGES = Object.assign({}, { 'mall-evil': 'mallEvil', 'school-evil': 'schoolEvil' });
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const bool = (v) => String(v).toLowerCase() === 'true';
  const num = (v, d) => C.num(v, d);

  /* ------------------------------------------------------------------ */
  /* Detection                                                           */
  /* ------------------------------------------------------------------ */
  function score(fs) {
    let cn = 0;
    let ps = 0;
    for (const p of fs.paths) {
      const l = p.toLowerCase();
      if (/^data\/weeks\/weeks\/[^/]+\.xml$/.test(l)) cn += 3;
      if (/^data\/characters\/[^/]+\.xml$/.test(l)) cn += 2;
      if (/^data\/stages\/[^/]+\.xml$/.test(l)) cn += 2;
      if (/^songs\/[^/]+\/charts\/.+\.json$/.test(l)) cn += 3;
      if (/^songs\/[^/]+\/meta(-[^/]+)?\.json$/.test(l)) cn += 1;
      if (l === 'data/config/modpack.ini') cn += 3;
      if (l === 'pack.json') ps += 3;
      if (/^weeks\/[^/]+\.json$/.test(l)) ps += 3;
      if (/^characters\/[^/]+\.json$/.test(l)) ps += 2;
      if (/^stages\/[^/]+\.json$/.test(l)) ps += 2;
      if (/^data\/[^/]+\/[^/]+\.json$/.test(l)) ps += 1;
    }
    return { codename: cn, psych: ps };
  }

  /** @returns {'psych'|'codename'} */
  function detectEngine(fs) {
    const s = score(fs);
    if (s.codename === 0 && s.psych === 0) return 'psych';
    return s.codename > s.psych ? 'codename' : 'psych';
  }

  function listSongs(fs) {
    const names = new Map();
    for (const p of fs.paths) {
      const m = /^songs\/([^/]+)\/(charts\/.+\.json|meta(-[^/]+)?\.json)$/i.exec(p);
      if (m) names.set(m[1].toLowerCase(), m[1]);
    }
    return [...names.values()];
  }
  const listXml = (fs, dir) => fs.list(dir, ['xml']).filter((p) => p.split('/').length === dir.split('/').length + 1);

  async function scan(fs) {
    const idOf = (p) => C.stripExt(C.baseName(p));
    let pack = {};
    const ini = fs.resolve('data/config/modpack.ini');
    if (ini) pack = parseIni(await fs.text(ini));
    return {
      pack,
      songs: listSongs(fs),
      characters: listXml(fs, 'data/characters').map(idOf),
      stages: listXml(fs, 'data/stages').map(idOf),
      weeks: listXml(fs, 'data/weeks/weeks').map(idOf),
      scripts: fs.paths.filter((p) => /\.(hx|hscript|lua)$/i.test(p)),
      fileCount: fs.paths.length,
    };
  }

  function parseIni(text) {
    const out = {};
    for (const line of String(text).split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (m) out[m[1].toLowerCase()] = m[2].replace(/^"(.*)"$/, '$1');
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Characters                                                          */
  /* ------------------------------------------------------------------ */
  function convertAnims(nodes) {
    const out = [];
    for (const a of nodes) {
      if (a.attrs.name === undefined) continue;
      const o = { name: a.attrs.name, prefix: a.attrs.anim || '' };
      const fps = num(a.attrs.fps, 24);
      if (fps !== 24) o.frameRate = fps;
      if (bool(a.attrs.loop)) o.looped = true;
      const idx = X().parseRange(a.attrs.indices);
      if (idx.length) o.frameIndices = idx;
      const ox = num(a.attrs.x, 0);
      const oy = num(a.attrs.y, 0);
      if (ox || oy) o.offsets = [ox, oy];
      out.push(o);
    }
    return out;
  }

  async function convertCharacter(path, ctx) {
    const { fs, out, report } = ctx;
    const id = C.stripExt(C.baseName(path));
    let el;
    try {
      el = X().parse(await fs.text(path));
    } catch (e) {
      report.error(path + ': ' + e.message);
      return null;
    }
    const a = el.attrs;
    const sprite = (a.sprite || id).split(',')[0].trim();
    if ((a.sprite || '').includes(',')) report.warn('Character "' + id + '": multiple sprite sheets (' + a.sprite + ') are not supported; using "' + sprite + '"');
    const image = 'characters/' + sprite;
    const scale = num(a.scale, 1) || 1;
    const animNodes = X().kids(el, 'anim');
    const anims = convertAnims(animNodes);
    const hasDanceLR = anims.some((x) => x.name === 'danceLeft') && anims.some((x) => x.name === 'danceRight');

    const imgBase = 'images/' + image;
    const hasXml = fs.exists(imgBase + '.xml');
    let renderType = 'sparrow';
    if (fs.exists(imgBase + '/Animation.json') || fs.exists(imgBase + '/spritemap1.png')) {
      report.warn('Character "' + id + '": uses an Adobe Animate texture atlas (' + image + '); this type is not supported yet.');
    } else if (!hasXml && fs.exists(imgBase + '.txt')) renderType = 'packer';
    else if (!hasXml) report.warn('Character "' + id + '": atlas "images/' + image + '.xml" not found.');
    if (!fs.exists(imgBase + '.png') && !fs.exists(imgBase + '/spritemap1.png')) report.warn('Character "' + id + '": image "images/' + image + '.png" not found.');

    const data = { version: CHARACTER_VERSION, name: id, renderType, assetPath: image };
    if (scale !== 1) data.scale = scale;
    data.singTime = num(a.holdTime, 4);
    if (a.interval !== undefined) data.danceEvery = num(a.interval, 2);
    else if (!hasDanceLR) data.danceEvery = 2;
    const gx = num(a.x, 0) / scale;
    const gy = num(a.y, 0) / scale;
    if (gx || gy) data.offsets = [Math.round(gx * 100) / 100, Math.round(gy * 100) / 100];
    if (num(a.camx, 0) || num(a.camy, 0)) data.cameraOffsets = [num(a.camx, 0), num(a.camy, 0)];
    if (a.antialiasing !== undefined && !bool(a.antialiasing)) data.isPixel = true;
    if (bool(a.flipX)) data.flipX = true;
    const iconId = a.icon || id;
    data.healthIcon = { id: iconId };
    data.animations = anims;
    if (!anims.length) report.warn('Character "' + id + '": no <anim> nodes.');
    if (a.gameOverChar) report.log('Character "' + id + '": gameOverChar="' + a.gameOverChar + '" has no direct V-Slice equivalent.');

    out.json('data/characters/' + id + '.json', data);

    // Icon: Codename icons/<id>.png or icons/<id>/icon.png -> V-Slice icons/icon-<id>.png
    const want = 'images/icons/icon-' + iconId + '.png';
    const old = ['images/icons/' + iconId + '.png', 'images/icons/' + iconId + '/icon.png'].find((p) => fs.exists(p));
    if (!fs.exists(want)) {
      if (old) out.binary('images/icons/icon-' + iconId + '.png', await fs.bytes(old));
      else report.warn('Character "' + id + '": icon "' + iconId + '" not found in images/icons/.');
    }

    let frameSize = null;
    if (hasXml) {
      try {
        const frames = C.parseSparrow(await fs.text(imgBase + '.xml'));
        const idle = animNodes.find((n) => n.attrs.name === 'idle') || animNodes.find((n) => n.attrs.name === 'danceLeft') || animNodes[0];
        if (idle) frameSize = C.characters.frameSizeFor(frames, { name: idle.attrs.anim || '', indices: X().parseRange(idle.attrs.indices) });
      } catch (e) {
        report.warn('Character "' + id + '": could not read the atlas: ' + e.message);
      }
    }
    report.count('Characters converted');
    return { id, scale, frameSize, healthIcon: iconId };
  }

  /* ------------------------------------------------------------------ */
  /* Stages                                                              */
  /* ------------------------------------------------------------------ */
  const SLOT_NODES = { boyfriend: 'bf', bf: 'bf', player: 'bf', girlfriend: 'gf', gf: 'gf', dad: 'dad', opponent: 'dad' };

  async function convertStage(path, ctx) {
    const { fs, out, report } = ctx;
    const id = C.stripExt(C.baseName(path));
    let el;
    try {
      el = X().parse(await fs.text(path));
    } catch (e) {
      report.error(path + ': ' + e.message);
      return null;
    }
    let folder = el.attrs.folder || '';
    if (folder && !folder.endsWith('/')) folder += '/';
    const usage = ctx.stageUsage.get(id) || { bf: [], dad: [], gf: [] };
    const props = [];
    const spriteNames = [];
    const slots = {};
    const defaults = { bf: [770, 100, [-100, -100]], dad: [100, 100, [150, -100]], gf: [400, 130, [0, 0]] };
    let z = 0;

    for (const node of el.children) {
      const n = node.name;
      const a = node.attrs;
      if (n === 'sprite' || n === 'spr' || n === 'sparrow') {
        if (!a.sprite || !a.name) continue;
        z += 10;
        const image = folder + a.sprite;
        const anims = convertAnims(X().kids(node, 'anim'));
        const sx = a.scalex !== undefined ? num(a.scalex, 1) : num(a.scale, 1);
        const sy = a.scaley !== undefined ? num(a.scaley, 1) : num(a.scale, 1);
        const scrollX = a.scrollx !== undefined ? num(a.scrollx, 1) : num(a.scroll, 1);
        const scrollY = a.scrolly !== undefined ? num(a.scrolly, 1) : num(a.scroll, 1);
        const type = (a.type || 'loop').toLowerCase();
        const p = {
          name: a.name,
          assetPath: image,
          position: [num(a.x, 0), num(a.y, 0)],
          zIndex: z,
          scale: sx === sy ? sx : [sx, sy],
          scroll: [scrollX, scrollY],
          danceEvery: type === 'beat' ? 1 : 0,
          animType: 'sparrow',
          isPixel: a.antialiasing !== undefined && !bool(a.antialiasing),
          animations: anims,
        };
        if (a.alpha !== undefined && num(a.alpha, 1) !== 1) p.alpha = num(a.alpha, 1);
        if (bool(a.flipX)) p.flipX = true;
        if (bool(a.flipY)) p.flipY = true;
        if (a.angle !== undefined && num(a.angle, 0)) p.angle = num(a.angle, 0);
        if (a.blend) p.blend = a.blend.toLowerCase();
        if (anims.length && type !== 'none') {
          if (type === 'loop') anims.forEach((x, i) => i === 0 && (x.looped = true));
          p.startingAnimation = anims[0].name;
        }
        if (!fs.exists('images/' + image + '.png')) report.warn('Stage "' + id + '": image "images/' + image + '.png" not found for sprite "' + a.name + '".');
        props.push(p);
        spriteNames.push(a.name);
      } else if (n === 'box' || n === 'solid') {
        if (!a.name || !a.width || !a.height) continue;
        z += 10;
        const col = X().parseColor(a.color, { r: 255, g: 255, b: 255, a: 255 });
        const hex = [col.r, col.g, col.b, col.a].map((v) => v.toString(16).padStart(2, '0')).join('');
        const asset = 'stages/' + ctx.modId + '/solid-' + hex;
        if (!out.has('images/' + asset + '.png')) out.binary('images/' + asset + '.png', X().solidPng(col.r, col.g, col.b, col.a));
        props.push({
          name: a.name, assetPath: asset, position: [num(a.x, 0), num(a.y, 0)], zIndex: z,
          scale: [num(a.width, 1), num(a.height, 1)], scroll: [num(a.scroll, 1), num(a.scroll, 1)], danceEvery: 0,
          animType: 'sparrow', isPixel: true, animations: [],
        });
        spriteNames.push(a.name);
      } else if (SLOT_NODES[n]) {
        z += 10;
        const slot = SLOT_NODES[n];
        const d = defaults[slot];
        const charId = usage[slot][0];
        const info = charId ? ctx.charInfo.get(charId) : null;
        const fr = (info && info.frameSize) || FALLBACK_FRAME;
        const sc = info ? info.scale : 1;
        if (charId && (!info || !info.frameSize) && !ctx.warnedFrame.has(charId)) {
          ctx.warnedFrame.add(charId);
          report.log('Stage "' + id + '": frame size of "' + charId + '" unknown; using ' + FALLBACK_FRAME.w + 'x' + FALLBACK_FRAME.h + ' to compute the feet position.');
        }
        slots[slot] = {
          zIndex: z,
          position: [Math.round((num(a.x, d[0]) + (fr.w * sc) / 2) * 10) / 10, Math.round((num(a.y, d[1]) + fr.h * sc) * 10) / 10],
          cameraOffsets: [d[2][0] + num(a.camxoffset, 0), d[2][1] + num(a.camyoffset, 0)],
        };
        if (a.alpha !== undefined && num(a.alpha, 1) !== 1) slots[slot].alpha = num(a.alpha, 1);
        if (a.scale !== undefined && num(a.scale, 1) !== 1) slots[slot].scale = num(a.scale, 1);
      } else if (n === 'character' || n === 'char') {
        report.warn('Stage "' + id + '": extra character position "' + (a.name || '?') + '" is not supported by V-Slice stages.');
      } else if (n === 'ratings' || n === 'combo') {
        report.log('Stage "' + id + '": <' + n + '> position has no V-Slice equivalent.');
      } else if (n === 'use-extension' || n === 'extension' || n === 'ext') {
        report.warn('Stage "' + id + '": <' + n + '> script extensions are not converted.');
      } else if (n === 'high-memory' || n === 'low-memory') {
        report.warn('Stage "' + id + '": <' + n + '> blocks are not converted.');
      }
    }
    // Missing slots keep sensible defaults so the stage still loads.
    const characters = {};
    for (const s of ['bf', 'dad', 'gf']) {
      if (slots[s]) characters[s] = slots[s];
      else {
        const d = defaults[s];
        characters[s] = { zIndex: 100 + (s === 'dad' ? 100 : s === 'bf' ? 200 : 0), position: [d[0] + 200, d[1] + 400], cameraOffsets: d[2], alpha: s === 'gf' ? 0 : 1 };
        if (s !== 'gf') delete characters[s].alpha;
      }
    }
    out.json('data/stages/' + id + '.json', {
      version: STAGE_VERSION, name: el.attrs.name || id, cameraZoom: num(el.attrs.zoom, 1), props, characters,
    });
    if (el.attrs.startCamPosX !== undefined || el.attrs.startCamPosY !== undefined) report.log('Stage "' + id + '": startCamPosX/Y has no direct V-Slice equivalent (the camera starts on the first FocusCamera event).');
    report.count('Stages converted');
    ctx.stageSprites.set(id, spriteNames);
    return { id, isPixel: false };
  }

  /* ------------------------------------------------------------------ */
  /* Weeks                                                               */
  /* ------------------------------------------------------------------ */
  async function convertWeekCharacter(name, ctx) {
    const { fs, report } = ctx;
    const p = fs.resolve('data/weeks/characters/' + name + '.xml');
    if (!p) {
      const base = C.weeks.baseProp(name);
      if (base) {
        report.log('Week: character "' + name + '" is not in the mod; using the base-game V-Slice prop.');
        return base;
      }
      report.warn('Week: character "' + name + '" has no data/weeks/characters/' + name + '.xml; prop skipped.');
      return null;
    }
    let el;
    try {
      el = X().parse(await fs.text(p));
    } catch (e) {
      report.warn(p + ': ' + e.message);
      return null;
    }
    const a = el.attrs;
    const sprite = a.sprite || 'menus/storymenu/characters/' + name;
    const anims = X().kids(el, 'anim');
    const prop = {
      assetPath: sprite,
      scale: num(a.scale, 1),
      offsets: [170 - num(a.x, 0), 70 - num(a.y, 0)],
      animations: [],
    };
    for (const an of anims) {
      if (!an.attrs.name) continue;
      const o = { name: an.attrs.name, prefix: an.attrs.anim || '', frameRate: num(an.attrs.fps, 24) };
      const idx = X().parseRange(an.attrs.indices);
      if (idx.length) o.frameIndices = idx;
      prop.animations.push(o);
    }
    if (!fs.exists('images/' + sprite + '.png')) report.warn('Week: image "images/' + sprite + '.png" not found.');
    return prop;
  }

  async function convertWeek(path, ctx) {
    const { fs, out, report } = ctx;
    const file = C.stripExt(C.baseName(path));
    let el;
    try {
      el = X().parse(await fs.text(path));
    } catch (e) {
      report.error(path + ': ' + e.message);
      return null;
    }
    const id = /^(tutorial|week\d+|weekend\d+)$/i.test(file) ? ctx.modId + '-' + C.slugId(file) : C.slugId(file);
    if (id !== C.slugId(file)) report.log('Week "' + file + '" renamed to "' + id + '" so it does not overwrite the base-game week.');
    const songs = X().kids(el, 'song').map((s) => C.formatToSongPath(s.text.trim())).filter(Boolean);
    if (!songs.length) report.warn('Week "' + file + '": no songs.');

    const titleSprite = el.attrs.sprite || file;
    const titleAsset = 'storymenu/titles/' + id;
    const titleSrc = ['images/menus/storymenu/weeks/' + titleSprite + '.png'].find((p) => fs.exists(p));
    if (titleSrc) out.binary('images/' + titleAsset + '.png', await fs.bytes(titleSrc));
    else report.warn('Week "' + file + '": title image "images/menus/storymenu/weeks/' + titleSprite + '.png" not found.');

    const blank = 'storymenu/props/' + ctx.modId + '-empty';
    const props = [];
    const names = String(el.attrs.chars || '').split(',').map((s) => s.trim());
    for (const nme of names) {
      const p = nme && nme !== 'none' && nme !== 'null' ? await convertWeekCharacter(nme, ctx) : null;
      props.push(p || { assetPath: blank, scale: 1, offsets: [0, 0], animations: [] });
    }
    while (props.length && props[props.length - 1].assetPath === blank) props.pop();
    if (props.some((p) => p.assetPath === blank)) {
      if (!out.has('images/' + blank + '.png')) out.binary('images/' + blank + '.png', X().solidPng(0, 0, 0, 0));
    }

    const level = {
      version: LEVEL_VERSION,
      name: String(el.attrs.name || id),
      titleAsset,
      props,
      background: bgColor(el.attrs.bgColor),
      songs,
    };
    const difficulties = X().kids(el, 'difficulty').map((d) => d.attrs.name).filter(Boolean);
    if (difficulties.length) report.log('Week "' + file + '": difficulty list (' + difficulties.join(', ') + ') ignored (V-Slice uses each song\'s difficulties).');
    out.json('data/levels/' + id + '.json', level);
    report.count('Weeks converted');
    return { id, songs };
  }

  function bgColor(c) {
    if (!c) return '#F9CF51';
    const col = X().parseColor(c);
    return '#' + [col.r, col.g, col.b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  /* ------------------------------------------------------------------ */
  /* Songs                                                               */
  /* ------------------------------------------------------------------ */
  const DIFF_ORDER = ['easy', 'normal', 'hard'];

  function roleOf(sl) {
    if (!sl) return 0;
    if ((sl.position || '').toLowerCase() === 'girlfriend') return 2;
    return sl.type === 1 ? 0 : 1; // 0 = boyfriend/player, 1 = dad/opponent
  }

  function easeOf(name, dir) {
    const e = String(name || '');
    if (!e || e === 'CLASSIC') return { ease: 'CLASSIC' };
    if (e === 'linear') return { ease: 'linear' };
    return { ease: e, easeDir: dir || 'In' };
  }

  /** Converts one Codename chart to V-Slice notes/events. */
  function convertChart(chart, meta, extraEvents, ctx, label) {
    const stats = { unsupported: new Map(), passed: new Map(), customKinds: new Set(), extraLines: 0, noteCount: 0, badKeyCount: false };
    const strumLines = Array.isArray(chart.strumLines) ? chart.strumLines : [];
    const noteTypes = Array.isArray(chart.noteTypes) ? chart.noteTypes : [];
    const notes = [];
    strumLines.forEach((sl, idx) => {
      if (sl.keyCount && sl.keyCount !== 4) stats.badKeyCount = true;
      let base;
      if (sl.type === 1) base = 0;
      else if (sl.type === 0) base = 4;
      else {
        stats.extraLines++;
        return;
      }
      // Only the first strumline of each side maps to V-Slice's two strumlines.
      const first = strumLines.findIndex((x) => x.type === sl.type);
      if (first !== idx) {
        stats.extraLines++;
        return;
      }
      for (const n of sl.notes || []) {
        const d = num(n.id, NaN);
        const t = num(n.time, NaN);
        if (!Number.isFinite(d) || !Number.isFinite(t) || d < 0 || d > 3) continue;
        const o = { t: r3(t), d: base + d };
        const len = num(n.sLen, 0);
        if (len > 0) o.l = r3(len);
        const tn = n.type > 0 ? noteTypes[n.type - 1] : null;
        if (tn) {
          const l = String(tn).toLowerCase();
          if (/alt anim/.test(l)) o.k = 'alt';
          else if (/no anim/.test(l)) o.k = 'noanim';
          else {
            o.k = String(tn);
            stats.customKinds.add(String(tn));
          }
        }
        notes.push(o);
      }
    });
    notes.sort((a, b) => a.t - b.t || a.d - b.d);
    stats.noteCount = notes.length;

    // --- timing -------------------------------------------------------------
    const bpm0 = num(meta.bpm, 100);
    const beats = num(meta.beatsPerMeasure, 4);
    const steps = Math.round(num(meta.stepsPerBeat, 4)) || 4;
    const first = { t: 0, bpm: bpm0 };
    if (beats !== 4) first.n = beats;
    if (steps !== 4) first.bt = new Array(Math.max(1, Math.round(beats))).fill(steps);
    const timeChanges = [first];

    const evs = [...(chart.events || []), ...(extraEvents || [])].filter((e) => e && e.name).sort((a, b) => num(a.time, 0) - num(b.time, 0));
    const events = [];
    const pass = (ev) => {
      events.push({ t: r3(num(ev.time, 0)), e: ev.name, v: { params: ev.params || [] } });
      stats.passed.set(ev.name, (stats.passed.get(ev.name) || 0) + 1);
    };
    const handled = ctx.passEvents || { all: false, names: new Set() };
    for (const ev of evs) {
      const t = r3(num(ev.time, 0));
      const p = ev.params || [];
      switch (ev.name) {
        case 'Camera Movement': {
          const sl = strumLines[num(p[0], 0)];
          const v = { char: roleOf(sl) };
          const ox = num(p[5], 0);
          const oy = num(p[6], 0);
          if (ox) v.x = ox;
          if (oy) v.y = oy;
          if (p[1] === false) v.ease = 'INSTANT';
          else {
            if (p[2] !== undefined && num(p[2], 4) !== 4) v.duration = num(p[2], 4);
            const e = easeOf(p[3], p[4]);
            if (e.ease !== 'CLASSIC') Object.assign(v, e);
          }
          events.push({ t, e: 'FocusCamera', v: Object.keys(v).length === 1 ? v.char : v });
          break;
        }
        case 'Camera Position': {
          const v = { char: -1, x: num(p[0], 0), y: num(p[1], 0) };
          if (p[2] === false) v.ease = 'INSTANT';
          else {
            if (p[3] !== undefined && num(p[3], 4) !== 4) v.duration = num(p[3], 4);
            const e = easeOf(p[4], p[5]);
            if (e.ease !== 'CLASSIC') Object.assign(v, e);
          }
          if (p[6] === true) stats.unsupported.set('Camera Position (offset mode)', (stats.unsupported.get('Camera Position (offset mode)') || 0) + 1);
          events.push({ t, e: 'FocusCamera', v });
          break;
        }
        case 'BPM Change': {
          const b = num(p[0], bpm0);
          if (t === 0) timeChanges[0].bpm = b;
          else timeChanges.push({ t, bpm: b });
          break;
        }
        case 'Time Signature Change': {
          const prevBpm = timeChanges[timeChanges.length - 1].bpm;
          const tc = { t, bpm: prevBpm, n: num(p[0], 4), d: num(p[1], 4) };
          if (t === 0) Object.assign(timeChanges[0], { n: tc.n, d: tc.d });
          else timeChanges.push(tc);
          break;
        }
        case 'Scroll Speed Change': {
          const v = { scroll: num(p[1], 1) };
          if (p[0] === false) v.ease = 'INSTANT';
          else {
            v.duration = num(p[2], 4);
            Object.assign(v, easeOf(p[3], p[4]));
            if (v.ease === 'CLASSIC') v.ease = 'linear';
          }
          if (p[5] !== true) v.absolute = true;
          events.push({ t, e: 'ScrollSpeed', v });
          break;
        }
        case 'Camera Zoom': {
          if (p[2] && p[2] !== 'camGame') {
            stats.unsupported.set('Camera Zoom (non-game camera)', (stats.unsupported.get('Camera Zoom (non-game camera)') || 0) + 1);
            break;
          }
          const v = { zoom: num(p[1], 1), mode: p[6] || 'direct' };
          if (p[0] === false) v.ease = 'INSTANT';
          else {
            v.duration = num(p[3], 4);
            Object.assign(v, easeOf(p[4], p[5]));
            if (v.ease === 'CLASSIC') v.ease = 'linear';
          }
          events.push({ t, e: 'ZoomCamera', v });
          break;
        }
        case 'Camera Modulo Change':
          events.push({ t, e: 'SetCameraBop', v: { rate: num(p[0], 4), intensity: num(p[1], 1), offset: num(p[3], 0) } });
          break;
        case 'Play Animation': {
          const sl = strumLines[num(p[0], 0)];
          const role = roleOf(sl);
          const anim = String(p[1] || '').trim();
          if (anim) events.push({ t, e: 'PlayAnimation', v: { target: role === 0 ? 'bf' : role === 1 ? 'dad' : 'gf', anim, force: p[2] !== false } });
          break;
        }
        default:
          if (handled.all || handled.names.has(ev.name) || ev.name === 'HScript Call') pass(ev);
          else stats.unsupported.set(ev.name, (stats.unsupported.get(ev.name) || 0) + 1);
      }
    }
    timeChanges.sort((a, b) => a.t - b.t);
    events.sort((a, b) => a.t - b.t);
    return { notes, events, timeChanges, stats, strumLines };
  }

  async function convertSong(folder, ctx) {
    const { fs, out, report } = ctx;
    const id = C.formatToSongPath(folder);
    const dir = 'songs/' + folder;

    // meta
    let meta = {};
    const metaPath = fs.resolve(dir + '/meta.json');
    if (metaPath) {
      try {
        meta = await fs.json(metaPath);
      } catch (e) {
        report.warn(e.message);
      }
    }
    // charts
    const chartPaths = fs.list(dir + '/charts', ['json']);
    const diffs = [];
    for (const p of chartPaths) {
      const rel = p.slice((dir + '/charts/').length);
      if (rel.includes('/')) {
        report.warn('Song "' + id + '": chart variant "' + rel + '" is not converted (V-Slice variations are not generated yet).');
        continue;
      }
      diffs.push({ diff: C.slugId(C.stripExt(rel)), path: p });
    }
    if (!diffs.length) {
      report.error('Song "' + folder + '": no charts found in ' + dir + '/charts/');
      return null;
    }
    const order = Array.isArray(meta.difficulties) && meta.difficulties.length ? meta.difficulties.map((d) => C.slugId(d)) : DIFF_ORDER;
    diffs.sort((a, b) => {
      const ia = order.indexOf(a.diff);
      const ib = order.indexOf(b.diff);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.diff.localeCompare(b.diff);
    });

    // global events
    let extraEvents = null;
    const evPath = fs.resolve(dir + '/events.json');
    if (evPath) {
      try {
        const j = await fs.json(evPath);
        if (Array.isArray(j.events)) extraEvents = j.events;
      } catch (e) {
        report.warn(e.message);
      }
    }

    const results = [];
    for (const d of diffs) {
      try {
        const raw = await fs.json(d.path);
        const data = C.songs.unwrapSong(raw) || raw;
        if (raw.codenameChart === true || raw.codenameChart === 'true' || Array.isArray(raw.strumLines)) {
          results.push({ diff: d.diff, chart: raw, conv: convertChart(raw, meta, extraEvents, ctx, id), legacy: false });
        } else if (Array.isArray(data.notes)) {
          // Legacy/Psych-style chart inside a Codename song folder: reuse the Psych converter.
          const conv = C.songs.convertChart(data, null, ctx.passEvents);
          results.push({ diff: d.diff, chart: data, conv: { notes: conv.notes, events: conv.events, timeChanges: conv.timeChanges, stats: Object.assign(conv.stats, { extraLines: 0 }), strumLines: [] }, legacy: true });
        } else throw new Error('unrecognized chart format');
      } catch (e) {
        report.error('Song "' + id + '" (' + d.diff + '): ' + e.message);
      }
    }
    if (!results.length) return null;

    const primary = results.find((r) => r.diff === 'normal') || results[0];
    const pc = primary.chart;

    // characters from strumlines
    const sls = primary.conv.strumLines || [];
    let player = 'bf';
    let opponent = 'dad';
    let girlfriend = '';
    if (primary.legacy) {
      player = pc.player1 || 'bf';
      opponent = pc.player2 || 'dad';
      girlfriend = pc.gfVersion || 'gf';
    } else {
      const ps = sls.find((s) => s.type === 1);
      const os = sls.find((s) => s.type === 0);
      const gs = sls.find((s) => (s.position || '').toLowerCase() === 'girlfriend');
      if (ps && ps.characters && ps.characters[0]) player = ps.characters[0];
      if (os && os.characters && os.characters[0]) opponent = os.characters[0];
      if (gs && gs.characters && gs.characters[0]) girlfriend = gs.characters[0];
    }
    for (const c of [player, opponent, girlfriend].filter(Boolean)) {
      if (!ctx.modChars.has(c) && !ctx.warnedBaseChars.has(c)) {
        ctx.warnedBaseChars.add(c);
        report.log('Character "' + c + '" is not in the mod; assuming it exists in the base game.');
      }
    }

    let stage = pc.stage || 'stage';
    let stageOut = stage;
    let pixel = false;
    if (ctx.modStages.has(stage)) pixel = !!ctx.modStages.get(stage).isPixel;
    else {
      const k = String(stage).toLowerCase();
      if (BASE_STAGES[k]) stageOut = BASE_STAGES[k];
      else if (C.BASE_STAGE_MAP[k]) stageOut = C.BASE_STAGE_MAP[k];
      else report.warn('Song "' + id + '": stage "' + stage + '" is not in the mod; assuming it exists in the base game.');
      pixel = k === 'school' || k === 'school-evil';
    }

    // warnings
    const unsupported = new Map();
    const customKinds = new Set();
    let extra = 0;
    let badKeys = false;
    for (const r of results) {
      r.conv.stats.unsupported.forEach((n, k) => unsupported.set(k, Math.max(unsupported.get(k) || 0, n)));
      r.conv.stats.customKinds.forEach((k) => customKinds.add(k));
      extra = Math.max(extra, r.conv.stats.extraLines || 0);
      badKeys = badKeys || !!r.conv.stats.badKeyCount;
    }
    if (unsupported.size) report.warn('Song "' + id + '": events with no equivalent (ignored): ' + [...unsupported].map(([k, n]) => k + ' x' + n).join(', '));
    if (customKinds.size) report.warn('Song "' + id + '": custom note types kept as "kind": ' + [...customKinds].join(', '));
    if (extra) report.warn('Song "' + id + '": ' + extra + ' additional strumline(s) (extra opponents / cpu lines) were dropped; V-Slice has 2 strumlines.');
    if (badKeys) report.warn('Song "' + id + '": strumlines with a key count other than 4 are not supported by V-Slice; those notes may be wrong.');
    const pj = JSON.stringify(primary.conv.events);
    for (const r of results) {
      if (r === primary) continue;
      if (JSON.stringify(r.conv.events) !== pj) report.warn('Song "' + id + '": events of "' + r.diff + '" differ from "' + primary.diff + '"; V-Slice shares events between difficulties, using the ones from "' + primary.diff + '".');
    }

    const difficulties = results.map((r) => r.diff);
    const ratings = {};
    difficulties.forEach((d) => (ratings[d] = 1));
    const scrollSpeed = {};
    const notesByDiff = {};
    for (const r of results) {
      scrollSpeed[r.diff] = r3(num(r.chart.scrollSpeed !== undefined ? r.chart.scrollSpeed : r.chart.speed, 1));
      notesByDiff[r.diff] = r.conv.notes;
    }

    // audio
    const audio = dir + '/song';
    const playerSl = sls.find((s) => s.type === 1);
    const oppSl = sls.find((s) => s.type === 0);
    const suffixes = { player: playerSl && playerSl.vocalsSuffix, opponent: oppSl && oppSl.vocalsSuffix };
    const characters = { player, girlfriend, opponent, altInstrumentals: [] };
    if (suffixes.player || suffixes.opponent) {
      characters.playerVocals = suffixes.player ? [player] : [];
      characters.opponentVocals = suffixes.opponent ? [opponent] : [];
    }
    let hasInst = false;
    for (const p of fs.list(audio)) {
      const rel = p.slice(audio.length + 1);
      const lower = rel.toLowerCase();
      if (rel.includes('/') || C.extOf(rel) !== 'ogg') {
        if (['mp3', 'wav'].includes(C.extOf(rel)) && !fs.exists(p.replace(/\.[^.]+$/, '.ogg'))) report.warn('Audio "' + p + '" is not .ogg; desktop V-Slice only reads .ogg, so convert it manually.');
        if (C.extOf(rel) !== 'mp3' && C.extOf(rel) !== 'wav') report.skip('Extra song files', p);
        continue;
      }
      let target = null;
      if (lower === 'inst.ogg') {
        target = 'Inst.ogg';
        hasInst = true;
      } else if (lower === 'voices.ogg') target = 'Voices.ogg';
      else if (suffixes.player && lower === 'voices' + suffixes.player.toLowerCase() + '.ogg') target = 'Voices-' + player + '.ogg';
      else if (suffixes.opponent && lower === 'voices' + suffixes.opponent.toLowerCase() + '.ogg') target = 'Voices-' + opponent + '.ogg';
      else {
        report.skip('Extra song files', p);
        continue;
      }
      out.binary('songs/' + id + '/' + target, await fs.bytes(p));
    }
    if (!hasInst) report.error('Song "' + id + '": missing ' + audio + '/Inst.ogg. ' + C.songs.describeAudioDir(fs, audio, folder));

    const metadata = {
      version: METADATA_VERSION,
      songName: meta.displayName || folder,
      artist: ctx.opts.artist || 'Unknown',
      offsets: {},
      playData: { songVariations: [], difficulties, characters, stage: stageOut, noteStyle: pixel ? 'pixel' : 'funkin', ratings },
      generatedBy: 'fnf-mod-converter (Codename Engine -> V-Slice)',
      timeChanges: primary.conv.timeChanges,
    };
    if (ctx.opts.charter) metadata.charter = ctx.opts.charter;
    const chartOut = { version: CHART_VERSION, scrollSpeed, events: primary.conv.events, notes: notesByDiff, generatedBy: metadata.generatedBy };
    out.json('data/songs/' + id + '/' + id + '-metadata.json', metadata);
    out.json('data/songs/' + id + '/' + id + '-chart.json', chartOut);

    report.count('Songs converted');
    report.count('Difficulties converted', difficulties.length);
    report.count('Notes converted', results.reduce((a, r) => a + r.conv.notes.length, 0));
    return { id, name: metadata.songName, player, opponent, girlfriend, stage: stageOut, difficulties, folder, rawStage: stage };
  }

  C.codename = { detectEngine, score, scan, listSongs, listXml, convertCharacter, convertStage, convertWeek, convertSong, convertChart, parseIni };
})(typeof window !== 'undefined' ? window : globalThis);
