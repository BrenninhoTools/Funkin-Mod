/* UI: reads the zip, previews what was found, converts and offers the download. */
(function () {
  const $ = (id) => document.getElementById(id);
  const el = {
    drop: $('drop'), file: $('file'), fileRow: $('file-row'), fileName: $('file-name'), fileSize: $('file-size'),
    btnChange: $('btn-change'), loadError: $('load-error'),
    cardConfig: $('card-config'), cardResult: $('card-result'),
    pickWrap: $('mod-pick-wrap'), pick: $('mod-pick'), tiles: $('tiles'),
    scriptNotice: $('script-notice'), scriptNoticeText: $('script-notice-text'),
    contents: $('contents'), contentsBody: $('contents-body'),
    title: $('opt-title'), id: $('opt-id'), author: $('opt-author'), artist: $('opt-artist'),
    api: $('opt-api'), charter: $('opt-charter'), report: $('opt-report'),
    convert: $('btn-convert'),
    progress: $('progress'), bar: $('bar'), progressLabel: $('progress-label'), progressPct: $('progress-pct'),
    resultBody: $('result-body'), banner: $('banner'), bannerIcon: $('banner-icon'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    summary: $('summary'), download: $('btn-download'), btnReport: $('btn-report'), btnAgain: $('btn-again'), dlSize: $('dl-size'),
    warnList: $('warn-list'), warnEmpty: $('warn-empty'), errList: $('err-list'), errEmpty: $('err-empty'),
    cntWarn: $('cnt-warn'), cntErr: $('cnt-err'), log: $('log'),
    themeToggle: $('theme-toggle'), themeIcon: $('theme-icon'),
  };

  let inputZip = null;
  let mods = [];
  let downloadUrl = null;
  let reportUrl = null;
  let idTouched = false;
  let lastResult = null;

  /* ---------------- Theme ---------------- */
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t);
    const dark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    el.themeIcon.firstElementChild.setAttribute('href', dark ? '#i-sun' : '#i-moon');
  }
  let savedTheme = null;
  try { savedTheme = localStorage.getItem('fnfconv-theme'); } catch (e) { /* storage unavailable */ }
  applyTheme(savedTheme);
  el.themeToggle.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try { localStorage.setItem('fnfconv-theme', next); } catch (e) { /* storage unavailable */ }
  });

  /* ---------------- Helpers ---------------- */
  function setStep(n) {
    for (let i = 1; i <= 3; i++) {
      const s = $('st-' + i);
      s.classList.toggle('active', i === n);
      s.classList.toggle('done', i < n);
    }
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function plural(n, one, many) {
    return n === 1 ? one : many;
  }

  function showLoadError(msg) {
    el.loadError.hidden = !msg;
    el.loadError.textContent = msg || '';
  }

  function icon(id) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  function revokeUrls() {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    if (reportUrl) URL.revokeObjectURL(reportUrl);
    downloadUrl = reportUrl = null;
  }

  /* ---------------- Loading ---------------- */
  async function loadFile(file) {
    if (!file) return;
    showLoadError('');
    el.cardConfig.hidden = true;
    el.cardResult.hidden = true;
    setStep(1);
    try {
      inputZip = await JSZip.loadAsync(file);
      mods = FNFConv.detectMods(inputZip, file.name);
      if (!mods.length) {
        showLoadError('No Psych Engine mod found in this zip. I looked for a pack.json and the usual folders (weeks, characters, songs, data, images...).');
        return;
      }
      el.fileName.textContent = file.name;
      el.fileSize.textContent = fmtSize(file.size);
      el.drop.hidden = true;
      el.fileRow.hidden = false;

      el.pick.innerHTML = '';
      mods.forEach((m, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = m.prefix ? m.prefix : m.name + ' (zip root)';
        el.pick.appendChild(o);
      });
      el.pickWrap.hidden = mods.length < 2;
      await showMod(0);
      el.cardConfig.hidden = false;
      setStep(2);
    } catch (e) {
      console.error(e);
      showLoadError('Could not open the zip: ' + e.message);
    }
  }

  function tile(iconId, n, label) {
    const d = document.createElement('div');
    d.className = 'tile' + (n === 0 ? ' zero' : '');
    d.appendChild(icon(iconId));
    const b = document.createElement('b');
    b.textContent = n;
    const s = document.createElement('span');
    s.textContent = label;
    d.append(b, s);
    return d;
  }

  function group(title, names) {
    if (!names.length) return null;
    const g = document.createElement('div');
    g.className = 'contents-group';
    const h = document.createElement('h4');
    h.textContent = title + ' (' + names.length + ')';
    const chips = document.createElement('div');
    chips.className = 'chips';
    names.slice(0, 60).forEach((n) => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = n;
      chips.appendChild(c);
    });
    if (names.length > 60) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = '+' + (names.length - 60) + ' more';
      chips.appendChild(c);
    }
    g.append(h, chips);
    return g;
  }

  async function showMod(i) {
    const mod = mods[i];
    const scan = await FNFConv.scanMod(inputZip, mod);

    el.tiles.innerHTML = '';
    el.tiles.append(
      tile('i-music', scan.songs.length, plural(scan.songs.length, 'song', 'songs')),
      tile('i-user', scan.characters.length, plural(scan.characters.length, 'character', 'characters')),
      tile('i-image', scan.stages.length, plural(scan.stages.length, 'stage', 'stages')),
      tile('i-calendar', scan.weeks.length, plural(scan.weeks.length, 'week', 'weeks')),
      tile('i-files', scan.fileCount, plural(scan.fileCount, 'file', 'files'))
    );

    el.scriptNotice.hidden = scan.scripts.length === 0;
    if (scan.scripts.length) {
      el.scriptNoticeText.textContent = scan.scripts.length + ' Lua/HScript ' + plural(scan.scripts.length, 'file was', 'files were') + ' found. Scripts cannot be converted automatically (stage scenery in Lua is read on a best-effort basis).';
    }

    el.contentsBody.innerHTML = '';
    [group('Songs', scan.songs), group('Characters', scan.characters), group('Stages', scan.stages), group('Weeks', scan.weeks)]
      .filter(Boolean)
      .forEach((g) => el.contentsBody.appendChild(g));
    el.contents.hidden = !el.contentsBody.childElementCount;

    el.title.value = scan.pack.name || mod.name;
    idTouched = false;
    el.id.value = FNFConv.slugId(el.title.value);
    el.cardResult.hidden = true;
  }

  /* ---------------- Conversion ---------------- */
  function addLog(kind, msg) {
    const line = document.createElement('div');
    if (kind === 'warn') line.className = 'w';
    if (kind === 'error') line.className = 'e';
    line.textContent = (kind === 'warn' ? '! ' : kind === 'error' ? 'x ' : '- ') + msg;
    el.log.appendChild(line);
  }

  function fillList(listEl, emptyEl, items) {
    listEl.innerHTML = '';
    emptyEl.hidden = items.length > 0;
    items.forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      listEl.appendChild(li);
    });
  }

  function setProgress(pct, label) {
    el.bar.style.width = pct + '%';
    el.progressPct.textContent = pct + '%';
    if (label) el.progressLabel.textContent = label;
  }

  async function runConversion() {
    el.convert.disabled = true;
    el.cardResult.hidden = false;
    el.resultBody.hidden = true;
    el.progress.hidden = false;
    el.log.textContent = '';
    revokeUrls();
    setProgress(0, 'Starting...');
    setStep(3);
    el.cardResult.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const mod = mods[parseInt(el.pick.value || '0', 10)];
      const result = await FNFConv.convertMod(inputZip, mod, {
        title: el.title.value.trim(),
        modId: el.id.value.trim(),
        author: el.author.value.trim(),
        artist: el.artist.value.trim(),
        charter: el.charter.value.trim(),
        apiVersion: el.api.value.trim() || '0.8.0',
        includeReport: el.report.checked,
        onLog: addLog,
        onProgress: (done, total, label) => setProgress(Math.round((done / total) * 90), label),
      });

      setProgress(90, 'Compressing zip...');
      const blob = await result.zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } }, (m) => {
        setProgress(90 + Math.round(m.percent / 10));
      });
      setProgress(100, 'Done');
      lastResult = result;
      showResult(result, blob);
    } catch (e) {
      console.error(e);
      el.progress.hidden = true;
      el.resultBody.hidden = false;
      el.summary.innerHTML = '';
      setBanner('err', 'Conversion failed', e.message);
      el.download.hidden = true;
      el.btnReport.hidden = true;
      el.dlSize.textContent = '';
      fillList(el.warnList, el.warnEmpty, []);
      fillList(el.errList, el.errEmpty, [e.stack || e.message]);
      el.cntWarn.textContent = '0';
      el.cntErr.textContent = '1';
      selectTab('err');
      addLog('error', e.stack || e.message);
    } finally {
      el.convert.disabled = false;
    }
  }

  function setBanner(kind, title, sub) {
    el.banner.className = 'banner' + (kind === 'warn' ? ' has-warn' : kind === 'err' ? ' has-err' : '');
    el.bannerIcon.firstElementChild.setAttribute('href', kind === 'ok' ? '#i-check' : '#i-alert');
    el.bannerTitle.textContent = title;
    el.bannerSub.textContent = sub;
  }

  function showResult(result, blob) {
    const { report } = result;
    el.progress.hidden = true;
    el.resultBody.hidden = false;

    if (report.errors.length) setBanner('err', 'Converted with errors', report.errors.length + ' ' + plural(report.errors.length, 'error', 'errors') + ' to check before using this mod.');
    else if (report.warnings.length) setBanner('warn', 'Conversion complete', report.warnings.length + ' ' + plural(report.warnings.length, 'warning', 'warnings') + ' worth reading: some parts have no automatic equivalent.');
    else setBanner('ok', 'Conversion complete', 'Everything converted cleanly.');

    el.summary.innerHTML = '';
    Object.entries(report.stats).forEach(([k, v]) => {
      const d = document.createElement('div');
      d.className = 'stat';
      const b = document.createElement('b');
      b.textContent = v;
      const s = document.createElement('span');
      s.textContent = k;
      d.append(b, s);
      el.summary.appendChild(d);
    });

    fillList(el.warnList, el.warnEmpty, report.warnings);
    fillList(el.errList, el.errEmpty, report.errors);
    el.cntWarn.textContent = report.warnings.length;
    el.cntErr.textContent = report.errors.length;
    selectTab(report.errors.length ? 'err' : 'warn');

    downloadUrl = URL.createObjectURL(blob);
    el.download.hidden = false;
    el.download.href = downloadUrl;
    el.download.download = result.modId + '.zip';
    el.btnReport.hidden = false;
    el.dlSize.textContent = result.modId + '.zip  ·  ' + fmtSize(blob.size);
  }

  function downloadReport() {
    if (!lastResult) return;
    if (reportUrl) URL.revokeObjectURL(reportUrl);
    reportUrl = URL.createObjectURL(new Blob([lastResult.reportText], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = reportUrl;
    a.download = lastResult.modId + '-conversion-report.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function reset() {
    revokeUrls();
    inputZip = null;
    lastResult = null;
    mods = [];
    el.file.value = '';
    el.drop.hidden = false;
    el.fileRow.hidden = true;
    el.cardConfig.hidden = true;
    el.cardResult.hidden = true;
    showLoadError('');
    setStep(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------------- Tabs ---------------- */
  const TABS = ['warn', 'err', 'log'];
  function selectTab(name) {
    TABS.forEach((t) => {
      const on = t === name;
      const tab = $('tab-' + t);
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      $('panel-' + t).hidden = !on;
    });
  }
  TABS.forEach((t, i) => {
    $('tab-' + t).addEventListener('click', () => selectTab(t));
    $('tab-' + t).addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
      selectTab(next);
      $('tab-' + next).focus();
    });
  });

  /* ---------------- Events ---------------- */
  el.file.addEventListener('change', () => loadFile(el.file.files[0]));
  el.btnChange.addEventListener('click', () => el.file.click());
  el.drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.file.click(); }
  });
  // Dropping anywhere on the page works, not just on the zone.
  ['dragenter', 'dragover'].forEach((t) => window.addEventListener(t, (e) => { e.preventDefault(); el.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => window.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop' || e.target === document.documentElement) el.drop.classList.remove('over'); }));
  window.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
  el.pick.addEventListener('change', () => showMod(parseInt(el.pick.value, 10)));
  el.title.addEventListener('input', () => { if (!idTouched) el.id.value = FNFConv.slugId(el.title.value); });
  el.id.addEventListener('input', () => { idTouched = true; });
  el.convert.addEventListener('click', runConversion);
  el.btnReport.addEventListener('click', downloadReport);
  el.btnAgain.addEventListener('click', reset);
})();
