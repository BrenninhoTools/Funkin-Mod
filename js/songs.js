/*
 * Songs: Psych Engine charts -> V-Slice SongMetadata (2.2.x) + SongChartData (2.0.0).
 *
 * Rules taken from the Funkin source code:
 *  - source/funkin/data/song/importer/FNFLegacyImporter.hx  (strumline swap on mustHitSection)
 *  - source/funkin/data/song/SongData.hx                    (note fields t/d/l/k, event fields t/e/v)
 *  - source/funkin/play/event/*.hx                          (event schemas)
 *  - source/funkin/Paths.hx                                 (songs/<id>/Inst.ogg, Voices-<char>.ogg)
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  const METADATA_VERSION = '2.2.4';
  const CHART_VERSION = '2.0.0';
  const STRUMLINE_SIZE = 4;

  /** Psych base-game stage ids -> equivalent V-Slice stage ids. */
  const BASE_STAGE_MAP = {
    stage: 'mainStage',
    spooky: 'spookyMansion',
    philly: 'phillyTrain',
    limo: 'limoRide',
    mall: 'mall',
    mallevil: 'mallEvil',
    school: 'school',
    schoolevil: 'schoolEvil',
    tank: 'tankmanBattlefield',
  };
  C.BASE_STAGE_MAP = BASE_STAGE_MAP;

  const DIFF_ORDER = ['easy', 'normal', 'hard'];

  function r3(n) {
    return Math.round(n * 1000) / 1000;
  }

  function sectionBeats(sec) {
    if (sec && sec.sectionBeats != null) return C.num(sec.sectionBeats, 4);
    if (sec && sec.lengthInSteps != null) return C.num(sec.lengthInSteps, 16) / 4;
    return 4;
  }

  /** Mirrors Psych's Conductor.mapBPMChanges: section start times in ms plus BPM changes. */
  function mapTiming(song) {
    const sections = Array.isArray(song.notes) ? song.notes : [];
    let bpm = C.num(song.bpm, 100);
    const timeChanges = [{ t: 0, bpm }];
    const starts = [];
    let pos = 0;
    sections.forEach((sec) => {
      starts.push(pos);
      if (sec && sec.changeBPM && C.num(sec.bpm, 0) > 0 && sec.bpm !== bpm) {
        bpm = C.num(sec.bpm, bpm);
        if (pos === 0) timeChanges[0].bpm = bpm;
        else timeChanges.push({ t: r3(pos), bpm });
      }
      pos += ((60 / bpm) * 1000 / 4) * Math.round(sectionBeats(sec) * 4);
    });
    return { timeChanges, starts, endTime: pos };
  }

  function bpmAt(timeChanges, t) {
    let bpm = timeChanges[0].bpm;
    for (const tc of timeChanges) if (tc.t <= t) bpm = tc.bpm;
    return bpm;
  }

  function normalizeNoteType(raw, stats) {
    if (raw === true) return 'alt';
    if (raw == null || raw === false || raw === '' || typeof raw === 'number') return null;
    const s = String(raw);
    const key = s.toLowerCase().trim();
    if (key === 'alt animation') return 'alt';
    if (key === 'no animation') return 'noanim'; // NoAnimNoteKind id in V-Slice
    if (key === 'gf sing') {
      stats.gfSing++;
      return null;
    }
    stats.customKinds.add(s);
    return s;
  }

  function charTarget(v, def) {
    const s = String(v == null ? '' : v).toLowerCase().trim();
    if (s === 'dad' || s === 'opponent' || s === '1') return 'dad';
    if (s === 'gf' || s === 'girlfriend' || s === '2') return 'gf';
    if (s === 'bf' || s === 'boyfriend' || s === 'player' || s === '0') return 'bf';
    return def;
  }

  /**
   * Converts one Psych event. Returns a list of V-Slice events, or null if there is no equivalent.
   * (`Camera Follow Pos` is handled separately, together with the per-section camera.)
   */
  function convertEvent(name, v1, v2, t, timeChanges) {
    const key = String(name).toLowerCase().trim();
    switch (key) {
      case 'play animation': {
        const anim = String(v1 == null ? '' : v1).trim();
        if (!anim) return null;
        return [{ t, e: 'PlayAnimation', v: { target: charTarget(v2, 'bf'), anim, force: true } }];
      }
      case 'hey!': {
        const who = String(v1 == null ? '' : v1).toLowerCase().trim();
        const gfOnly = who === 'gf' || who === 'girlfriend' || who === '1';
        const bfOnly = who === 'bf' || who === 'boyfriend' || who === '0';
        const out = [];
        if (!gfOnly) out.push({ t, e: 'PlayAnimation', v: { target: 'bf', anim: 'hey', force: true } });
        if (!bfOnly) out.push({ t, e: 'PlayAnimation', v: { target: 'gf', anim: 'cheer', force: true } });
        return out;
      }
      case 'change scroll speed': {
        const scroll = C.num(v1, 1);
        const seconds = C.num(v2, 0);
        const steps = (seconds * bpmAt(timeChanges, t)) / 15; // 1 step = 15/bpm seconds; V-Slice durations are in steps
        const ev = { scroll, duration: r3(steps), ease: seconds <= 0 ? 'INSTANT' : 'linear' };
        return [{ t, e: 'ScrollSpeed', v: ev }];
      }
      default:
        return null;
    }
  }

  /** Reads every event of a chart (the `events` list plus legacy event notes with data < 0). */
  function collectRawEvents(song, extraEvents) {
    const out = []; // {t, name, v1, v2}
    const push = (list) => {
      if (!Array.isArray(list)) return;
      for (const grp of list) {
        if (!Array.isArray(grp)) continue;
        const t = C.num(grp[0], 0);
        const inner = Array.isArray(grp[1]) ? grp[1] : [];
        for (const ev of inner) {
          if (!Array.isArray(ev)) continue;
          out.push({ t, name: String(ev[0] == null ? '' : ev[0]), v1: ev[1], v2: ev[2] });
        }
      }
    };
    push(song.events);
    push(extraEvents);
    return out;
  }

  /**
   * Converts one chart (one difficulty).
   * @returns {{notes:Array, events:Array, timeChanges:Array, stats:Object}}
   */
  function convertChart(song, extraEvents) {
    const sections = Array.isArray(song.notes) ? song.notes : [];
    const timing = mapTiming(song);
    const stats = { gfSing: 0, customKinds: new Set(), unsupported: new Map(), gfSections: 0, noteCount: 0 };
    const notes = [];
    const rawEvents = collectRawEvents(song, extraEvents);

    sections.forEach((sec) => {
      if (!sec || !Array.isArray(sec.sectionNotes)) return;
      const mustHit = !!sec.mustHitSection;
      if (sec.gfSection) stats.gfSections++;
      for (const n of sec.sectionNotes) {
        if (!Array.isArray(n)) continue;
        const time = C.num(n[0], NaN);
        let data = C.num(n[1], NaN);
        if (!Number.isFinite(time) || !Number.isFinite(data)) continue;
        if (data < 0) {
          // Legacy event stored as a note: [t, -1, name, v1, v2]
          rawEvents.push({ t: time, name: String(n[2] == null ? '' : n[2]), v1: n[3], v2: n[4] });
          continue;
        }
        if (data > STRUMLINE_SIZE * 2 - 1) data = data % (STRUMLINE_SIZE * 2);
        if (!mustHit) data = data >= STRUMLINE_SIZE ? data - STRUMLINE_SIZE : data + STRUMLINE_SIZE;

        const note = { t: r3(time), d: data };
        const len = C.num(n[2], 0);
        if (len > 0) note.l = r3(len);
        const kind = normalizeNoteType(n[3], stats);
        if (kind) note.k = kind;
        notes.push(note);
      }
    });
    notes.sort((a, b) => a.t - b.t || a.d - b.d);
    stats.noteCount = notes.length;

    // --- Events + per-section camera -------------------------------------------------
    const cam = []; // {t, order, kind, ...}
    timing.starts.forEach((t, i) => {
      const sec = sections[i] || {};
      const char = sec.gfSection ? 2 : sec.mustHitSection ? 0 : 1;
      cam.push({ t, order: 0, kind: 'section', char });
    });

    const events = [];
    rawEvents.sort((a, b) => a.t - b.t);
    for (const ev of rawEvents) {
      const key = ev.name.toLowerCase().trim();
      if (key === 'camera follow pos') {
        const x = parseFloat(ev.v1);
        const y = parseFloat(ev.v2);
        if (Number.isNaN(x) && Number.isNaN(y)) cam.push({ t: ev.t, order: 1, kind: 'reset' });
        else cam.push({ t: ev.t, order: 1, kind: 'pos', x: Number.isNaN(x) ? 0 : x, y: Number.isNaN(y) ? 0 : y });
        continue;
      }
      const converted = convertEvent(ev.name, ev.v1, ev.v2, r3(ev.t), timing.timeChanges);
      if (converted) events.push(...converted);
      else stats.unsupported.set(ev.name, (stats.unsupported.get(ev.name) || 0) + 1);
    }

    // Psych ignores section camera changes while the camera is forced to a position.
    cam.sort((a, b) => a.t - b.t || a.order - b.order);
    let forced = false;
    let sectionChar = null;
    let lastChar = null;
    for (const c of cam) {
      if (c.kind === 'section') {
        sectionChar = c.char;
        if (!forced && lastChar !== c.char) {
          events.push({ t: r3(c.t), e: 'FocusCamera', v: c.char });
          lastChar = c.char;
        }
      } else if (c.kind === 'pos') {
        forced = true;
        lastChar = 'pos';
        events.push({ t: r3(c.t), e: 'FocusCamera', v: { char: -1, x: c.x, y: c.y } });
      } else if (c.kind === 'reset') {
        forced = false;
        if (sectionChar != null) {
          events.push({ t: r3(c.t), e: 'FocusCamera', v: sectionChar });
          lastChar = sectionChar;
        }
      }
    }
    events.sort((a, b) => a.t - b.t);

    return { notes, events, timeChanges: timing.timeChanges, stats };
  }

  /** Finds the `song` object inside the JSON (accepts {song:{...}} and {song:{song:{...}}}). */
  function unwrapSong(json) {
    let s = json && json.song !== undefined ? json.song : json;
    if (s && typeof s === 'object' && s.song && typeof s.song === 'object' && !Array.isArray(s.notes)) s = s.song;
    return s && typeof s === 'object' ? s : null;
  }

  /** Lists the song folders (data/<folder>/ containing at least one chart). */
  function listSongFolders(fs) {
    const folders = new Map(); // lower-case -> original name
    for (const p of fs.list('data', ['json'])) {
      const parts = p.split('/');
      if (parts.length !== 3) continue; // data/<folder>/<file>.json
      const folder = parts[1];
      const file = parts[2].toLowerCase();
      if (file === 'events.json') continue;
      const fl = folder.toLowerCase();
      const flSlug = C.formatToSongPath(folder);
      if (file === fl + '.json' || file.startsWith(fl + '-') || file === flSlug + '.json' || file.startsWith(flSlug + '-')) {
        folders.set(fl, folder);
      }
    }
    return [...folders.values()];
  }

  function listCharts(fs, folder) {
    const fl = folder.toLowerCase();
    const flSlug = C.formatToSongPath(folder);
    const charts = []; // {diff, path}
    for (const p of fs.list('data/' + folder, ['json'])) {
      const parts = p.split('/');
      if (parts.length !== 3) continue;
      const file = C.stripExt(parts[2]).toLowerCase();
      if (file === 'events') continue;
      let diff = null;
      for (const base of [fl, flSlug]) {
        if (file === base) diff = 'normal';
        else if (file.startsWith(base + '-')) diff = file.slice(base.length + 1);
        if (diff) break;
      }
      if (!diff) continue;
      diff = C.slugId(diff);
      if (!charts.some((c) => c.diff === diff)) charts.push({ diff, path: p });
    }
    charts.sort((a, b) => {
      const ia = DIFF_ORDER.indexOf(a.diff);
      const ib = DIFF_ORDER.indexOf(b.diff);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.diff.localeCompare(b.diff);
    });
    return charts;
  }

  /**
   * Converts a whole song.
   * @param ctx {fs, out, report, modChars:Set, modStages:Map(id->{isPixel}), opts}
   * @returns song info used by the rest of the conversion, or null on failure.
   */
  async function convertSong(folder, ctx) {
    const { fs, out, report } = ctx;
    const id = C.formatToSongPath(folder);
    const charts = listCharts(fs, folder);
    if (!charts.length) {
      report.error('Song "' + folder + '": no chart found in data/' + folder + '/');
      return null;
    }

    let extraEvents = null;
    const evPath = fs.resolve('data/' + folder + '/events.json');
    if (evPath) {
      try {
        const evJson = await fs.json(evPath);
        const s = unwrapSong(evJson) || evJson;
        extraEvents = Array.isArray(s.events) ? s.events : null;
      } catch (e) {
        report.warn(e.message);
      }
    }

    const results = [];
    for (const ch of charts) {
      try {
        const json = await fs.json(ch.path);
        const song = unwrapSong(json);
        if (!song || !Array.isArray(song.notes)) throw new Error('unrecognized chart format');
        results.push({ diff: ch.diff, song, conv: convertChart(song, extraEvents) });
      } catch (e) {
        report.error('Song "' + folder + '" (' + ch.diff + '): ' + e.message);
      }
    }
    if (!results.length) return null;

    const primary = results.find((r) => r.diff === 'normal') || results[0];
    const ps = primary.song;

    // --- Characters / stage -----------------------------------------------------------
    const player = ps.player1 || 'bf';
    const opponent = ps.player2 || 'dad';
    const girlfriend = ps.gfVersion || ps.player3 || 'gf';
    let stage = ps.stage;
    if (!stage) stage = 'stage';
    const stageLower = String(stage).toLowerCase();
    let stageOut = stage;
    let pixel = false;
    if (ctx.modStages.has(stage)) {
      pixel = !!ctx.modStages.get(stage).isPixel;
    } else if (BASE_STAGE_MAP[stageLower]) {
      stageOut = BASE_STAGE_MAP[stageLower];
      pixel = stageLower === 'school' || stageLower === 'schoolevil';
    } else {
      report.warn('Song "' + id + '": stage "' + stage + '" is not in the mod; assuming it exists in the base game.');
    }
    for (const c of [player, opponent, girlfriend]) {
      if (!ctx.modChars.has(c) && !ctx.warnedBaseChars.has(c)) {
        ctx.warnedBaseChars.add(c);
        report.log('Character "' + c + '" is not in the mod; assuming it exists in the base game.');
      }
    }
    if (ps.arrowSkin && ps.arrowSkin !== 'NOTE_assets' && ps.arrowSkin !== 'noteSkins/NOTE_assets') {
      report.warn('Song "' + id + '": custom note skin "' + ps.arrowSkin + '" was not converted (V-Slice uses note styles).');
    }
    if (ps.splashSkin && ps.splashSkin !== 'noteSplashes' && ps.splashSkin !== 'noteSplashes/noteSplashes') {
      report.warn('Song "' + id + '": custom splash skin "' + ps.splashSkin + '" was not converted.');
    }

    // --- Differences between difficulties ---------------------------------------------
    const pj = JSON.stringify(primary.conv.events);
    const ptc = JSON.stringify(primary.conv.timeChanges);
    for (const r of results) {
      if (r === primary) continue;
      if (JSON.stringify(r.conv.events) !== pj)
        report.warn('Song "' + id + '": events of "' + r.diff + '" differ from "' + primary.diff + '"; V-Slice shares events between difficulties, so the ones from "' + primary.diff + '" are used.');
      if (JSON.stringify(r.conv.timeChanges) !== ptc)
        report.warn('Song "' + id + '": BPM of "' + r.diff + '" differs from "' + primary.diff + '"; using the one from "' + primary.diff + '".');
      if (r.song.player1 !== ps.player1 || r.song.player2 !== ps.player2 || r.song.stage !== ps.stage)
        report.warn('Song "' + id + '": characters/stage of "' + r.diff + '" differ; V-Slice would need a separate variation.');
    }

    // --- Items without an equivalent --------------------------------------------------
    const unsupported = new Map();
    let gfSing = 0;
    const customKinds = new Set();
    for (const r of results) {
      r.conv.stats.unsupported.forEach((n, k) => unsupported.set(k, Math.max(unsupported.get(k) || 0, n)));
      gfSing = Math.max(gfSing, r.conv.stats.gfSing);
      r.conv.stats.customKinds.forEach((k) => customKinds.add(k));
    }
    if (unsupported.size)
      report.warn('Song "' + id + '": events with no equivalent (ignored): ' + [...unsupported].map(([k, n]) => k + ' x' + n).join(', '));
    if (gfSing) report.warn('Song "' + id + '": ' + gfSing + ' "GF Sing" note(s) became regular opponent notes.');
    if (customKinds.size)
      report.warn('Song "' + id + '": custom note types kept as "kind" but without a script: ' + [...customKinds].join(', '));

    // --- Output files -----------------------------------------------------------------
    const difficulties = results.map((r) => r.diff);
    const ratings = {};
    difficulties.forEach((d) => (ratings[d] = 1));
    const scrollSpeed = {};
    const notesByDiff = {};
    for (const r of results) {
      scrollSpeed[r.diff] = r3(C.num(r.song.speed, 1));
      notesByDiff[r.diff] = r.conv.notes;
    }

    // Vocals: Voices.ogg is picked up by V-Slice's legacy fallback, so only the split tracks need metadata.
    const songDir = 'songs/' + folder;
    const hasPlayerVoice = fs.exists(songDir + '/Voices-Player.ogg');
    const hasOppVoice = fs.exists(songDir + '/Voices-Opponent.ogg');
    const characters = { player, girlfriend, opponent, altInstrumentals: [] };
    if (hasPlayerVoice || hasOppVoice) {
      characters.playerVocals = hasPlayerVoice ? [player] : [];
      characters.opponentVocals = hasOppVoice ? [opponent] : [];
    }

    const metadata = {
      version: METADATA_VERSION,
      songName: ps.song || folder,
      artist: ctx.opts.artist || 'Unknown',
      charter: ctx.opts.charter || undefined,
      offsets: {},
      playData: {
        songVariations: [],
        difficulties,
        characters,
        stage: stageOut,
        noteStyle: pixel ? 'pixel' : 'funkin',
        ratings,
      },
      generatedBy: 'fnf-mod-converter (Psych Engine -> V-Slice)',
      timeChanges: primary.conv.timeChanges.map((tc) => ({ t: tc.t, bpm: tc.bpm })),
    };
    if (!metadata.charter) delete metadata.charter;

    const chart = {
      version: CHART_VERSION,
      scrollSpeed,
      events: primary.conv.events,
      notes: notesByDiff,
      generatedBy: metadata.generatedBy,
    };

    out.json('data/songs/' + id + '/' + id + '-metadata.json', metadata);
    out.json('data/songs/' + id + '/' + id + '-chart.json', chart);

    // Audio
    let hasInst = false;
    for (const p of fs.list(songDir)) {
      const rel = p.slice(songDir.length + 1);
      if (rel.includes('/')) {
        report.skip('Extra song files', p);
        continue;
      }
      const lower = rel.toLowerCase();
      const ext = C.extOf(rel);
      if (ext !== 'ogg') {
        if (['mp3', 'wav', 'flac'].includes(ext)) report.warn('Audio "' + p + '" is not .ogg; desktop V-Slice only reads .ogg, so convert the file manually.');
        report.skip('Extra song files', p);
        continue;
      }
      let target = null;
      if (lower === 'inst.ogg') {
        target = 'Inst.ogg';
        hasInst = true;
      } else if (lower === 'voices.ogg') target = 'Voices.ogg';
      else if (lower === 'voices-player.ogg') target = 'Voices-' + player + '.ogg';
      else if (lower === 'voices-opponent.ogg') target = 'Voices-' + opponent + '.ogg';
      else {
        report.skip('Extra song files', p);
        continue;
      }
      out.binary('songs/' + id + '/' + target, await fs.bytes(p));
    }
    if (!hasInst) report.error('Song "' + id + '": missing songs/' + folder + '/Inst.ogg');

    report.count('Songs converted');
    report.count('Difficulties converted', difficulties.length);
    report.count('Notes converted', results.reduce((a, r) => a + r.conv.notes.length, 0));

    return { id, name: metadata.songName, player, opponent, girlfriend, stage: stageOut, difficulties };
  }

  C.songs = { listSongFolders, convertChart, mapTiming, convertSong, unwrapSong, listCharts };
})(typeof window !== 'undefined' ? window : globalThis);
