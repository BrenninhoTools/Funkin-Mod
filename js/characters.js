/*
 * Characters: Psych characters/<id>.json -> V-Slice data/characters/<id>.json.
 *
 * From the source code (source/funkin/play/stage/Bopper.hx):
 *   screen position -= (animOffset - globalOffset) * scale
 * Psych applies offsets without multiplying by the scale, so everything is divided by `scale`
 * to keep the same position in pixels.
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  const CHARACTER_VERSION = '1.0.2';

  /** Extracts <SubTexture .../> from a Sparrow atlas without needing DOMParser (works in Node too). */
  function parseSparrow(xml) {
    const frames = [];
    const re = /<SubTexture\b([^>]*)>/g;
    let m;
    while ((m = re.exec(xml))) {
      const attrs = {};
      const ar = /([\w:-]+)\s*=\s*"([^"]*)"/g;
      let a;
      while ((a = ar.exec(m[1]))) attrs[a[1]] = a[2];
      if (attrs.name == null) continue;
      frames.push({
        name: attrs.name,
        w: C.num(attrs.width, 0),
        h: C.num(attrs.height, 0),
        fw: attrs.frameWidth != null ? C.num(attrs.frameWidth, 0) : null,
        fh: attrs.frameHeight != null ? C.num(attrs.frameHeight, 0) : null,
      });
    }
    return frames;
  }
  C.parseSparrow = parseSparrow;

  /** Unscaled size of the first frame of animation `anim` in an atlas. */
  function frameSizeFor(frames, anim) {
    if (!anim || !frames.length) return null;
    const prefix = anim.name || '';
    const matches = frames.filter((f) => f.name.startsWith(prefix)).sort((a, b) => (a.name < b.name ? -1 : 1));
    if (!matches.length) return null;
    let pick = matches[0];
    if (Array.isArray(anim.indices) && anim.indices.length) {
      const want = prefix + String(anim.indices[0]).padStart(4, '0');
      pick = matches.find((f) => f.name === want) || pick;
    }
    return { w: pick.fw || pick.w, h: pick.fh || pick.h };
  }

  function convertAnimations(anims, scale) {
    const div = scale > 0 ? scale : 1;
    const out = [];
    for (const a of anims || []) {
      if (!a || !a.anim) continue;
      const o = { name: String(a.anim), prefix: String(a.name == null ? '' : a.name) };
      const fps = C.num(a.fps, 24);
      if (fps !== 24) o.frameRate = fps;
      if (a.loop) o.looped = true;
      if (Array.isArray(a.indices) && a.indices.length) o.frameIndices = a.indices.map((n) => C.num(n, 0));
      const off = Array.isArray(a.offsets) ? a.offsets : [0, 0];
      const ox = C.num(off[0], 0) / div;
      const oy = C.num(off[1], 0) / div;
      if (ox !== 0 || oy !== 0) o.offsets = [Math.round(ox * 100) / 100, Math.round(oy * 100) / 100];
      out.push(o);
    }
    return out;
  }

  /**
   * @returns {Promise<Object|null>} info used by the rest of the conversion
   */
  async function convertCharacter(path, ctx) {
    const { fs, out, report } = ctx;
    const id = C.stripExt(C.baseName(path));
    let src;
    try {
      src = await fs.json(path);
    } catch (e) {
      report.error(e.message);
      return null;
    }
    const image = String(src.image || 'characters/' + id);
    const scale = C.num(src.scale, 1) || 1;
    const anims = Array.isArray(src.animations) ? src.animations : [];
    const hasDanceLR = anims.some((a) => a.anim === 'danceLeft') && anims.some((a) => a.anim === 'danceRight');

    const pos = Array.isArray(src.position) ? src.position : [0, 0];
    const cam = Array.isArray(src.camera_position) ? src.camera_position : [0, 0];

    let renderType = 'sparrow';
    const imgBase = 'images/' + image;
    const hasXml = fs.exists(imgBase + '.xml');
    const hasTxt = fs.exists(imgBase + '.txt');
    if (fs.exists(imgBase + '/Animation.json')) {
      report.warn('Character "' + id + '": uses an Adobe Animate atlas (' + image + '/Animation.json); this type is not supported yet.');
    } else if (!hasXml && hasTxt) {
      renderType = 'packer';
    } else if (!hasXml) {
      report.warn('Character "' + id + '": atlas "images/' + image + '.xml" not found.');
    }
    if (!fs.exists(imgBase + '.png')) report.warn('Character "' + id + '": image "images/' + image + '.png" not found.');

    const data = {
      version: CHARACTER_VERSION,
      name: id,
      renderType,
      assetPath: image,
    };
    if (scale !== 1) data.scale = scale;
    data.singTime = C.num(src.sing_duration, 4);
    // Psych: danceEveryNumBeats = danceIdle (danceLeft/danceRight) ? 1 : 2
    if (!hasDanceLR) data.danceEvery = 2;
    const ox = C.num(pos[0], 0) / scale;
    const oy = C.num(pos[1], 0) / scale;
    if (ox || oy) data.offsets = [Math.round(ox * 100) / 100, Math.round(oy * 100) / 100];
    if (C.num(cam[0], 0) || C.num(cam[1], 0)) data.cameraOffsets = [C.num(cam[0], 0), C.num(cam[1], 0)];
    if (src.no_antialiasing) data.isPixel = true;
    if (src.flip_x) data.flipX = true;
    const iconId = src.healthicon || id;
    data.healthIcon = { id: iconId };
    data.animations = convertAnimations(anims, scale);
    if (!data.animations.length) report.warn('Character "' + id + '": no animations.');
    if (data.animations.length && !data.animations.some((a) => a.name === 'idle') && !hasDanceLR)
      report.warn('Character "' + id + '": has no "idle" animation nor danceLeft/danceRight.');

    out.json('data/characters/' + id + '.json', data);

    // Icon: V-Slice looks for icons/icon-<id>.png
    const iconWant = 'images/icons/icon-' + iconId + '.png';
    const iconAlt = 'images/icons/' + iconId + '.png';
    if (!fs.exists(iconWant) && fs.exists(iconAlt)) {
      if (!out.has('images/icons/icon-' + iconId + '.png')) out.binary('images/icons/icon-' + iconId + '.png', await fs.bytes(iconAlt));
    } else if (!fs.exists(iconWant)) {
      report.warn('Character "' + id + '": icon "' + iconId + '" not found in images/icons/.');
    }

    // Idle frame size (needed to convert stage positions from top-left corner to feet)
    let frameSize = null;
    if (hasXml) {
      try {
        const frames = parseSparrow(await fs.text(imgBase + '.xml'));
        const idleAnim = anims.find((a) => a.anim === 'idle') || anims.find((a) => a.anim === 'danceLeft') || anims[0];
        frameSize = frameSizeFor(frames, idleAnim);
      } catch (e) {
        report.warn('Character "' + id + '": could not read the atlas: ' + e.message);
      }
    }

    report.count('Characters converted');
    return { id, scale, frameSize, healthIcon: iconId };
  }

  C.characters = { convertCharacter, parseSparrow, frameSizeFor };
})(typeof window !== 'undefined' ? window : globalThis);
