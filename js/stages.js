/*
 * Stages: Psych stages/<id>.json (+ optional .lua) -> V-Slice data/stages/<id>.json.
 *
 * Psych's stage JSON only stores character positions and the zoom; the scenery lives in Lua.
 * The Lua is read on a best-effort basis: only calls whose arguments can be evaluated statically are understood
 * (literals, `local name = "literal"` constants and `..` concatenations of them):
 *   makeLuaSprite, makeAnimatedLuaSprite, makeGraphic, addAnimationByPrefix, scaleObject, setScrollFactor,
 *   setGraphicSize, screenCenter, addLuaSprite...
 * Anything dynamic (other variables, onBeatHit, shaders...) is left for the generated stage script, or reported.
 *
 * From the source code (source/funkin/play/stage/Stage.hx):
 *   character.x = stage.characters.<slot>.position[0] - characterOrigin.x   // origin = feet (bottom-center)
 * Psych positions are the top-left corner, so (width*scale/2, height*scale) is added.
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  const STAGE_VERSION = '1.0.2';
  const FALLBACK_FRAME = { w: 400, h: 400 };
  const SCREEN = { w: 1280, h: 720 };

  /* ----------------------------- Lua (best effort) ----------------------------- */
  function stripLuaComments(src) {
    return src.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '').replace(/--[^\n]*/g, '');
  }

  function splitTop(s, sep) {
    // Splits `s` on `sep` outside of quotes.
    const parts = [];
    let cur = '';
    let q = null;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) {
        cur += ch;
        if (ch === '\\') cur += s[++i] || '';
        else if (ch === q) q = null;
      } else if (ch === '"' || ch === "'") {
        q = ch;
        cur += ch;
      } else if (s.startsWith(sep, i)) {
        parts.push(cur.trim());
        cur = '';
        i += sep.length - 1;
      } else cur += ch;
    }
    parts.push(cur.trim());
    return parts;
  }
  const splitArgs = (s) => (s.trim() === '' ? [] : splitTop(s, ','));

  /** Parses a Lua literal; returns undefined when the argument is not a literal. */
  function lit(a) {
    if (a == null) return undefined;
    const m = /^'((?:[^'\\]|\\.)*)'$/.exec(a) || /^"((?:[^"\\]|\\.)*)"$/.exec(a);
    if (m) return m[1].replace(/\\(.)/g, '$1');
    if (a === 'true') return true;
    if (a === 'false') return false;
    if (a === 'nil') return null;
    if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(a)) return parseFloat(a);
    return undefined;
  }

  /** `local name = "literal"` / `name = 12` assignments (only names that are never given two different values). */
  function collectConsts(code) {
    const seen = new Map();
    const re = /(?:^|\n)[ \t]*(?:local[ \t]+)?([A-Za-z_]\w*)[ \t]*=[ \t]*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|-?\d+(?:\.\d+)?)[ \t]*(?=;|\n|$)/g;
    let m;
    while ((m = re.exec(code))) {
      const v = lit(m[2]);
      if (!seen.has(m[1])) seen.set(m[1], v);
      else if (seen.get(m[1]) !== v) seen.set(m[1], undefined);
    }
    const out = new Map();
    for (const [k, v] of seen) if (v !== undefined) out.set(k, v);
    return out;
  }

  /** Evaluates an argument: literal, known constant, or a `..` concatenation of those. undefined = not static. */
  function evalArg(a, consts) {
    if (a == null) return undefined;
    const l = lit(a);
    if (l !== undefined) return l;
    if (/^[A-Za-z_]\w*$/.test(a)) return consts.has(a) ? consts.get(a) : undefined;
    const parts = splitTop(a, '..');
    if (parts.length < 2) return undefined;
    let out = '';
    for (const p of parts) {
      const v = evalArg(p, consts);
      if (v === undefined || v === null || typeof v === 'boolean') return undefined;
      out += v;
    }
    return out;
  }

  const HANDLED = new Set([
    'makeLuaSprite', 'makeAnimatedLuaSprite', 'addAnimationByPrefix', 'addAnimationByIndices', 'addAnimation',
    'luaSpriteAddAnimationByPrefix', 'luaSpriteAddAnimationByIndices', 'luaSpritePlayAnimation',
    'objectPlayAnimation', 'scaleObject', 'setScrollFactor', 'setLuaSpriteScrollFactor', 'addLuaSprite', 'setProperty', 'setBlendMode',
    'setObjectOrder', 'precacheImage', 'makeGraphic', 'luaSpriteMakeGraphic', 'updateHitbox', 'screenCenter', 'setGraphicSize',
  ]);

  /**
   * @returns {{sprites:Array, dynamic:Set<string>, skipped:Array<string>}}
   */
  function parseStageLua(src) {
    const code = stripLuaComments(src);
    const consts = collectConsts(code);
    const sprites = new Map();
    const order = [];
    const dynamic = new Set();
    const skipped = [];
    const re = /([A-Za-z_][\w.]*)\s*\(([^()]*)\)/g;
    let m;
    while ((m = re.exec(code))) {
      const fn = m[1];
      if (!HANDLED.has(fn)) {
        if (/^on(?!Create(Post)?$)[A-Z]\w*$/.test(fn) || /^(runTimer|doTweenX|doTweenY|doTweenAlpha|doTweenAngle|doTweenZoom|setShaderFloat|initLuaShader|setSpriteShader|runHaxeCode|playSound|triggerEvent|addHaxeLibrary|startTween|callOnLuas)$/.test(fn))
          dynamic.add(fn);
        continue;
      }
      const raw = splitArgs(m[2]);
      const a = raw.map((x) => evalArg(x, consts));
      const tag = a[0];
      const needTag = () => typeof tag === 'string';
      const spr = () => (needTag() ? sprites.get(tag) : undefined);
      switch (fn) {
        case 'makeLuaSprite':
        case 'makeAnimatedLuaSprite': {
          if (!needTag() || (raw.length > 1 && typeof a[1] !== 'string' && a[1] !== null)) {
            skipped.push(fn + '(' + m[2].trim() + ')');
            break;
          }
          const x = raw.length > 2 ? a[2] : 0; // missing argument = 0; present but non-static = skip
          const y = raw.length > 3 ? a[3] : 0;
          if (typeof x !== 'number' || typeof y !== 'number') {
            skipped.push(fn + '(' + m[2].trim() + ')');
            break;
          }
          sprites.set(tag, { tag, image: a[1] || '', x, y, animated: fn === 'makeAnimatedLuaSprite', anims: [], scale: [1, 1], scroll: [1, 1], alpha: 1, flipX: false, angle: 0, blend: '', front: false, added: false, start: null, solid: null, size: null, center: null });
          break;
        }
        case 'makeGraphic':
        case 'luaSpriteMakeGraphic': {
          const s = spr();
          if (s && typeof a[1] === 'number' && typeof a[2] === 'number') s.solid = { w: a[1], h: a[2], color: typeof a[3] === 'string' ? a[3] : 'FFFFFF' };
          else if (needTag()) {
            sprites.delete(tag);
            skipped.push(fn + '("' + tag + '", ...) with a size or color that is not a literal');
          }
          break;
        }
        case 'addAnimationByPrefix':
        case 'luaSpriteAddAnimationByPrefix': {
          const s = spr();
          if (s && typeof a[1] === 'string' && typeof a[2] === 'string') {
            const an = { name: a[1], prefix: a[2] };
            if (typeof a[3] === 'number' && a[3] !== 24) an.frameRate = a[3];
            if (a[4] === true) an.looped = true;
            s.anims.push(an);
          }
          break;
        }
        case 'addAnimationByIndices':
        case 'luaSpriteAddAnimationByIndices': {
          const s = spr();
          if (s && typeof a[1] === 'string' && typeof a[2] === 'string' && typeof a[3] === 'string') {
            const an = { name: a[1], prefix: a[2], frameIndices: a[3].split(',').map((n) => parseInt(n, 10)).filter(Number.isFinite) };
            if (typeof a[4] === 'number' && a[4] !== 24) an.frameRate = a[4];
            if (a[5] === true) an.looped = true;
            s.anims.push(an);
          }
          break;
        }
        case 'objectPlayAnimation':
        case 'luaSpritePlayAnimation': {
          const s = spr();
          if (s && typeof a[1] === 'string' && !s.start) s.start = a[1];
          break;
        }
        case 'scaleObject': {
          const s = spr();
          if (s && typeof a[1] === 'number') s.scale = [a[1], typeof a[2] === 'number' ? a[2] : a[1]];
          break;
        }
        case 'setScrollFactor':
        case 'setLuaSpriteScrollFactor': {
          const s = spr();
          if (s && typeof a[1] === 'number') s.scroll = [a[1], typeof a[2] === 'number' ? a[2] : a[1]];
          break;
        }
        case 'setBlendMode': {
          const s = spr();
          if (s && typeof a[1] === 'string') s.blend = a[1].toLowerCase();
          break;
        }
        case 'setGraphicSize': {
          const s = spr();
          if (s && typeof a[1] === 'number') s.size = [a[1], typeof a[2] === 'number' ? a[2] : 0];
          else if (s) skipped.push('setGraphicSize("' + tag + '") with a size that is not a literal');
          break;
        }
        case 'screenCenter': {
          const s = spr();
          if (s) s.center = typeof a[1] === 'string' ? a[1].toLowerCase() : 'xy';
          break;
        }
        case 'setProperty': {
          if (needTag()) {
            const mm = /^([^.]+)\.(alpha|flipX|angle)$/.exec(tag);
            const s = mm && sprites.get(mm[1]);
            if (s && a[1] !== undefined && a[1] !== null) {
              if (mm[2] === 'alpha' && typeof a[1] === 'number') s.alpha = a[1];
              else if (mm[2] === 'flipX') s.flipX = !!a[1];
              else if (mm[2] === 'angle' && typeof a[1] === 'number') s.angle = a[1];
            }
          }
          break;
        }
        case 'addLuaSprite': {
          const s = spr();
          if (s && !s.added) {
            s.added = true;
            s.front = a[1] === true;
            order.push(s);
          }
          break;
        }
        default:
          break;
      }
    }
    return { sprites: order, dynamic, skipped, consts };
  }
  C.parseStageLua = parseStageLua;

  function pngSize(bytes) {
    if (!bytes || bytes.length < 24 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }

  /** Fills image/scale/position of a parsed sprite using sizes read from the mod's own files. */
  async function resolveSprite(s, ctx, stageId) {
    const { fs, out, report } = ctx;
    let native = null;
    if (s.solid) {
      const col = C.xml.parseColor(s.solid.color, { r: 255, g: 255, b: 255, a: 255 });
      const hex = [col.r, col.g, col.b, col.a].map((v) => v.toString(16).padStart(2, '0')).join('');
      s.image = 'stages/' + ctx.modId + '/solid-' + hex;
      if (!out.has('images/' + s.image + '.png')) out.binary('images/' + s.image + '.png', C.xml.solidPng(col.r, col.g, col.b, col.a));
      // The generated PNG is 1x1, so scale = size. scaleObject() after makeGraphic multiplies that size.
      s.scale = [s.solid.w * s.scale[0], s.solid.h * s.scale[1]];
      native = { w: 1, h: 1 };
      s.pxSize = { w: s.solid.w, h: s.solid.h };
    } else {
      if (!s.image) return false;
      if (s.animated && s.anims.length && fs.exists('images/' + s.image + '.xml')) {
        try {
          const frames = C.parseSparrow(await fs.text('images/' + s.image + '.xml'));
          native = C.characters.frameSizeFor(frames, { name: s.anims[0].prefix });
        } catch (e) {
          native = null;
        }
      }
      if (!native && (s.size || s.center) && fs.exists('images/' + s.image + '.png')) native = pngSize(await fs.bytes('images/' + s.image + '.png'));
      if (native) s.pxSize = { w: native.w * s.scale[0], h: native.h * s.scale[1] };
      if (s.size) {
        if (!native) report.warn('Stage "' + stageId + '": could not read the size of "' + s.image + '" for setGraphicSize("' + s.tag + '")');
        else {
          const sx = s.size[0] / native.w;
          const sy = s.size[1] ? s.size[1] / native.h : sx;
          s.scale = [sx, sy];
          s.pxSize = { w: native.w * sx, h: native.h * sy };
        }
      }
    }
    if (s.center) {
      if (!s.pxSize) report.warn('Stage "' + stageId + '": could not center "' + s.tag + '" (unknown image size)');
      else {
        if (s.center.includes('x')) s.x = Math.round(((SCREEN.w - s.pxSize.w) / 2) * 10) / 10;
        if (s.center.includes('y')) s.y = Math.round(((SCREEN.h - s.pxSize.h) / 2) * 10) / 10;
      }
    }
    return true;
  }

  function propFromSprite(s, zIndex, pixel, fs) {
    const hasXml = fs.exists('images/' + s.image + '.xml');
    const p = {
      name: s.tag,
      assetPath: s.image,
      position: [s.x, s.y],
      zIndex,
      scale: s.scale[0] === s.scale[1] ? s.scale[0] : [s.scale[0], s.scale[1]],
      scroll: s.scroll,
      danceEvery: 0,
      animType: 'sparrow',
      isPixel: !!pixel || !!s.solid,
      animations: [],
    };
    if (s.alpha !== 1) p.alpha = s.alpha;
    if (s.flipX) p.flipX = true;
    if (s.angle) p.angle = s.angle;
    if (s.blend) p.blend = s.blend;
    if (s.animated || hasXml) {
      p.animations = s.anims;
      if (s.anims.length) p.startingAnimation = s.start && s.anims.some((x) => x.name === s.start) ? s.start : s.anims[0].name;
    }
    return p;
  }

  /**
   * @param path stages/<id>.json
   * @param ctx {fs,out,report,charInfo:Map, stageUsage:Map, warnedFrame:Set}
   * @returns {Promise<{id:string,isPixel:boolean}|null>}
   */
  async function convertStage(path, ctx) {
    const { fs, out, report } = ctx;
    const id = C.stripExt(C.baseName(path));
    let src;
    try {
      src = await fs.json(path);
    } catch (e) {
      report.error(e.message);
      return null;
    }
    const isPixel = !!src.isPixelStage;
    const usage = ctx.stageUsage.get(id) || { bf: [], dad: [], gf: [] };

    const slot = (key, jsonKey, camKey, zIndex, baseCam) => {
      const p = Array.isArray(src[jsonKey]) ? src[jsonKey] : key === 'bf' ? [770, 100] : key === 'gf' ? [400, 130] : [100, 100];
      const cam = Array.isArray(src[camKey]) ? src[camKey] : [0, 0];
      const charId = usage[key][0];
      const info = charId ? ctx.charInfo.get(charId) : null;
      const fr = (info && info.frameSize) || FALLBACK_FRAME;
      const sc = info ? info.scale : 1;
      if (!info || !info.frameSize) {
        if (charId && !ctx.warnedFrame.has(charId)) {
          ctx.warnedFrame.add(charId);
          report.log('Stage "' + id + '": frame size of "' + charId + '" unknown (base-game character or no atlas); using ' + FALLBACK_FRAME.w + 'x' + FALLBACK_FRAME.h + ' to compute the feet position.');
        }
      }
      return {
        zIndex,
        position: [Math.round((C.num(p[0], 0) + (fr.w * sc) / 2) * 10) / 10, Math.round((C.num(p[1], 0) + fr.h * sc) * 10) / 10],
        cameraOffsets: [baseCam[0] + C.num(cam[0], 0), baseCam[1] + C.num(cam[1], 0)],
      };
    };

    const characters = {
      bf: slot('bf', 'boyfriend', 'camera_boyfriend', 300, [-100, -100]),
      dad: slot('dad', 'opponent', 'camera_opponent', 200, [150, -100]),
      gf: slot('gf', 'girlfriend', 'camera_girlfriend', 100, [0, 0]),
    };
    if (src.hide_girlfriend) characters.gf.alpha = 0;

    // --- Scenery from Lua --------------------------------------------------------------
    const props = [];
    const luaPath = fs.resolve('stages/' + id + '.lua');
    if (luaPath) {
      const parsed = parseStageLua(await fs.text(luaPath));
      const usable = [];
      for (const s of parsed.sprites) {
        if (await resolveSprite(s, ctx, id)) usable.push(s);
        else parsed.skipped.push('"' + s.tag + '" has no image');
      }
      const behind = usable.filter((s) => !s.front);
      const front = usable.filter((s) => s.front);
      const step = behind.length ? Math.max(1, Math.min(10, Math.floor(90 / behind.length))) : 10;
      behind.forEach((s, i) => props.push(propFromSprite(s, (i + 1) * step, isPixel, fs)));
      front.forEach((s, i) => props.push(propFromSprite(s, 400 + (i + 1) * 10, isPixel, fs)));
      for (const p of props) {
        if (!p.assetPath.startsWith('stages/' + ctx.modId + '/solid-') && !fs.exists('images/' + p.assetPath + '.png'))
          report.warn('Stage "' + id + '": image "images/' + p.assetPath + '.png" not found for prop "' + p.name + '".');
      }
      if (parsed.skipped.length) report.warn('Stage "' + id + '": ' + parsed.skipped.length + ' Lua item(s) not converted: ' + parsed.skipped.slice(0, 5).join('; ') + (parsed.skipped.length > 5 ? '; ...' : ''));
      if (parsed.dynamic.size) {
        const names = [...parsed.dynamic].slice(0, 8).join(', ');
        if (ctx.convertScripts) report.log('Stage "' + id + '": dynamic Lua logic (' + names + ') is handled by the generated stage script.');
        else report.warn('Stage "' + id + '": the Lua uses dynamic logic (' + names + ') that was not converted (script conversion is off).');
      }
      report.count('Stage props extracted from Lua', props.length);
      // Used by the script converter so setup calls already folded into the JSON are not repeated at runtime.
      ctx.stageStaticTags = ctx.stageStaticTags || new Map();
      ctx.stageStaticTags.set(id, new Set(usable.map((s) => s.tag)));
    } else {
      report.warn('Stage "' + id + '": there is no stages/' + id + '.lua, so the stage has no scenery (only positions and zoom).');
    }

    if (src.directory) report.warn('Stage "' + id + '": uses "directory" (' + src.directory + '); move its assets to images/ manually.');

    out.json('data/stages/' + id + '.json', {
      version: STAGE_VERSION,
      name: id,
      cameraZoom: C.num(src.defaultZoom, 1),
      props,
      characters,
    });
    report.count('Stages converted');
    return { id, isPixel };
  }

  C.stages = { convertStage, parseStageLua, evalArg, collectConsts };
})(typeof window !== 'undefined' ? window : globalThis);
