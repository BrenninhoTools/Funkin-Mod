/* Shared helpers: slugs, virtual file system over the input zip, output writer, conversion report. */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  /** Same algorithm as Psych Engine's Paths.formatToSongPath. */
  C.formatToSongPath = function (s) {
    let p = String(s == null ? '' : s).replace(/ /g, '-');
    p = p.replace(/[~&\\;:<>#]/g, '-');
    p = p.replace(/[.,'"%?!]/g, '');
    return p.toLowerCase();
  };

  /** Safe ID for a mod folder or level. */
  C.slugId = function (s) {
    const r = String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return r || 'converted-mod';
  };

  C.num = function (v, def) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? n : def;
  };

  C.baseName = (p) => p.slice(p.lastIndexOf('/') + 1);
  C.dirName = (p) => (p.lastIndexOf('/') < 0 ? '' : p.slice(0, p.lastIndexOf('/')));
  C.stripExt = (p) => p.replace(/\.[^./]+$/, '');
  C.extOf = (p) => {
    const m = /\.([^./]+)$/.exec(p);
    return m ? m[1].toLowerCase() : '';
  };

  /** Strips the BOM and parses JSON; the error message names the offending file. */
  C.parseJson = function (text, label) {
    try {
      return JSON.parse(String(text).replace(/^﻿/, ''));
    } catch (e) {
      throw new Error('Invalid JSON in ' + label + ': ' + e.message);
    }
  };

  /* ------------------------------------------------------------------ */
  /* Report                                                              */
  /* ------------------------------------------------------------------ */
  class Report {
    constructor(onLog) {
      this.onLog = onLog || function () {};
      this.warnings = [];
      this.errors = [];
      this.info = [];
      this.stats = {};
      this.unconverted = new Map(); // category -> [paths]
    }
    log(msg) {
      this.info.push(msg);
      this.onLog('info', msg);
    }
    warn(msg) {
      this.warnings.push(msg);
      this.onLog('warn', msg);
    }
    error(msg) {
      this.errors.push(msg);
      this.onLog('error', msg);
    }
    count(key, n) {
      this.stats[key] = (this.stats[key] || 0) + (n == null ? 1 : n);
    }
    skip(category, path) {
      if (!this.unconverted.has(category)) this.unconverted.set(category, []);
      this.unconverted.get(category).push(path);
    }
    toMarkdown(modTitle) {
      const L = [];
      L.push('# Conversion report: ' + modTitle, '');
      L.push("Psych Engine -> Friday Night Funkin' (V-Slice / Polymod)", '');
      L.push('## Summary', '');
      for (const k of Object.keys(this.stats)) L.push('- ' + k + ': ' + this.stats[k]);
      L.push('');
      if (this.errors.length) {
        L.push('## Errors', '');
        this.errors.forEach((e) => L.push('- ' + e));
        L.push('');
      }
      if (this.warnings.length) {
        L.push('## Warnings', '');
        this.warnings.forEach((w) => L.push('- ' + w));
        L.push('');
      }
      if (this.unconverted.size) {
        L.push('## Not converted (no automatic equivalent)', '');
        for (const [cat, list] of this.unconverted) {
          L.push('### ' + cat + ' (' + list.length + ')', '');
          list.slice(0, 200).forEach((p) => L.push('- `' + p + '`'));
          if (list.length > 200) L.push('- ... and ' + (list.length - 200) + ' more');
          L.push('');
        }
      }
      return L.join('\n');
    }
  }
  C.Report = Report;

  /* ------------------------------------------------------------------ */
  /* Virtual file system over a JSZip                                    */
  /* ------------------------------------------------------------------ */
  class ModFS {
    /**
     * @param {JSZip} zip input zip
     * @param {string} rootPrefix mod folder prefix inside the zip ('' or 'folder/')
     */
    constructor(zip, rootPrefix) {
      this.zip = zip;
      this.prefix = rootPrefix || '';
      this.paths = []; // paths relative to the mod root
      this.byLower = new Map();
      zip.forEach((rel, entry) => {
        if (entry.dir) return;
        const norm = rel.replace(/\\/g, '/');
        if (!norm.startsWith(this.prefix)) return;
        const sub = norm.slice(this.prefix.length);
        if (!sub || sub.startsWith('__MACOSX/') || /(^|\/)(\.DS_Store|Thumbs\.db)$/i.test(sub)) return;
        this.paths.push(sub);
        this.byLower.set(sub.toLowerCase(), { sub, entry });
      });
      this.paths.sort();
    }
    /** Case-insensitive lookup; returns the real path or null. */
    resolve(p) {
      const hit = this.byLower.get(p.toLowerCase());
      return hit ? hit.sub : null;
    }
    exists(p) {
      return this.byLower.has(p.toLowerCase());
    }
    entry(p) {
      const hit = this.byLower.get(p.toLowerCase());
      return hit ? hit.entry : null;
    }
    async text(p) {
      const e = this.entry(p);
      if (!e) throw new Error('File not found: ' + p);
      return e.async('string');
    }
    async json(p) {
      return C.parseJson(await this.text(p), p);
    }
    async bytes(p) {
      const e = this.entry(p);
      if (!e) throw new Error('File not found: ' + p);
      return e.async('uint8array');
    }
    /** Lists paths under `dir/` (case-insensitive), optionally filtered by extension. */
    list(dir, exts) {
      const d = dir.replace(/\/?$/, '/').toLowerCase();
      return this.paths.filter((p) => {
        if (!p.toLowerCase().startsWith(d)) return false;
        return !exts || exts.includes(C.extOf(p));
      });
    }
  }
  C.ModFS = ModFS;

  /* ------------------------------------------------------------------ */
  /* Output                                                              */
  /* ------------------------------------------------------------------ */
  class Output {
    constructor(zip, folder, report) {
      this.zip = zip;
      this.folder = folder;
      this.report = report;
      this.written = new Set();
    }
    has(path) {
      return this.written.has(path.toLowerCase());
    }
    _put(path, data, compress) {
      const key = path.toLowerCase();
      if (this.written.has(key)) {
        this.report.warn('Duplicate output file, keeping the first version: ' + path);
        return false;
      }
      this.written.add(key);
      this.zip.file(this.folder + '/' + path, data, { compression: compress ? 'DEFLATE' : 'STORE' });
      return true;
    }
    json(path, obj) {
      return this._put(path, JSON.stringify(obj, null, 2) + '\n', true);
    }
    text(path, str) {
      return this._put(path, str, true);
    }
    /** Binaries (png/ogg/...) are already compressed, so they are stored as-is. */
    binary(path, bytes) {
      return this._put(path, bytes, false);
    }
  }
  C.Output = Output;
})(typeof window !== 'undefined' ? window : globalThis);
