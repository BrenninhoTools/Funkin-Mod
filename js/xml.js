/*
 * Tiny dependency-free XML parser + a 1x1 solid-color PNG writer.
 * The parser handles what Codename Engine mods use: elements, attributes, text, comments, DOCTYPE, CDATA.
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
  const decode = (s) => s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g, (m, n, d, h) => (n ? ENT[m] : String.fromCodePoint(d ? parseInt(d, 10) : parseInt(h, 16))));

  const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  /** @returns the root element: {name, attrs, children, text} */
  function parse(text) {
    const rootEl = { name: '#root', attrs: {}, children: [], text: '' };
    const stack = [rootEl];
    let m;
    TOKEN.lastIndex = 0;
    const src = String(text).replace(/^﻿/, '');
    while ((m = TOKEN.exec(src))) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined) top.text += m[1];
      else if (m[2] !== undefined) {
        if (stack.length > 1) stack.pop();
      } else if (m[3] !== undefined) {
        const attrs = {};
        let a;
        ATTR.lastIndex = 0;
        while ((a = ATTR.exec(m[4] || ''))) attrs[a[1]] = decode(a[2] !== undefined ? a[2] : a[3]);
        const el = { name: m[3], attrs, children: [], text: '' };
        top.children.push(el);
        if (!m[5]) stack.push(el);
      } else if (m[6] !== undefined) top.text += decode(m[6]);
    }
    const first = rootEl.children[0];
    if (!first) throw new Error('empty XML document');
    return first;
  }

  const kids = (el, name) => el.children.filter((c) => c.name === name);
  const attr = (el, name, def) => (el && el.attrs[name] !== undefined ? el.attrs[name] : def);

  /** Parses Codename's index ranges, e.g. "2..12,0,1" -> [2,3,...,12,0,1]. */
  function parseRange(s) {
    const out = [];
    for (const part of String(s || '').split(',')) {
      const t = part.trim();
      if (!t) continue;
      const m = /^(-?\d+)\s*\.\.\s*(-?\d+)$/.exec(t);
      if (m) {
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        if (a <= b) for (let i = a; i <= b; i++) out.push(i);
        else for (let i = a; i >= b; i--) out.push(i);
      } else if (/^-?\d+$/.test(t)) out.push(parseInt(t, 10));
    }
    return out;
  }

  /* -------------------------------- PNG (1x1, solid color) -------------------------------- */
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function adler32(bytes) {
    let a = 1;
    let b = 0;
    for (let i = 0; i < bytes.length; i++) {
      a = (a + bytes[i]) % 65521;
      b = (b + a) % 65521;
    }
    return ((b << 16) | a) >>> 0;
  }
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }
  /** @param {number} r 0-255 ... @returns {Uint8Array} PNG file bytes */
  function solidPng(r, g, b, a) {
    const sig = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, 1);
    dv.setUint32(4, 1);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    const raw = Uint8Array.from([0, r, g, b, a]); // filter byte + pixel
    // zlib stream with one stored (uncompressed) deflate block
    const z = new Uint8Array(2 + 5 + raw.length + 4);
    z[0] = 0x78;
    z[1] = 0x01;
    z[2] = 1; // BFINAL=1, BTYPE=00
    z[3] = raw.length & 0xff;
    z[4] = raw.length >> 8;
    z[5] = ~raw.length & 0xff;
    z[6] = (~raw.length >> 8) & 0xff;
    z.set(raw, 7);
    new DataView(z.buffer).setUint32(7 + raw.length, adler32(raw));
    const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  /** "#RRGGBB", "#AARRGGBB", "0xAARRGGBB", "RRGGBB" or int -> {r,g,b,a}. */
  function parseColor(c, def) {
    if (c == null || c === '') return def || { r: 255, g: 255, b: 255, a: 255 };
    if (typeof c === 'number') return { a: (c >>> 24) & 255 || 255, r: (c >>> 16) & 255, g: (c >>> 8) & 255, b: c & 255 };
    let s = String(c).trim().replace(/^#|^0x/i, '');
    if (!/^[0-9a-fA-F]+$/.test(s)) return def || { r: 255, g: 255, b: 255, a: 255 };
    if (s.length === 3) s = s.split('').map((x) => x + x).join('');
    if (s.length === 6) s = 'FF' + s;
    if (s.length !== 8) return def || { r: 255, g: 255, b: 255, a: 255 };
    const n = parseInt(s, 16);
    return { a: (n >>> 24) & 255, r: (n >>> 16) & 255, g: (n >>> 8) & 255, b: n & 255 };
  }

  C.xml = { parse, kids, attr, parseRange, solidPng, parseColor };
})(typeof window !== 'undefined' ? window : globalThis);
