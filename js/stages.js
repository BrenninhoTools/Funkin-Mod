/*
 * Stages: Psych stages/<id>.json (+ optional .lua) -> V-Slice data/stages/<id>.json.
 *
 * Psych's stage JSON only stores character positions and the zoom; the scenery lives in Lua.
 * The Lua is read on a best-effort basis: only calls with literal arguments are understood
 * (makeLuaSprite, makeAnimatedLuaSprite, addAnimationByPrefix, scaleObject, setScrollFactor, addLuaSprite...).
 * Anything dynamic (variables, onBeatHit, shaders...) becomes a warning in the report.
 *
 * From the source code (source/funkin/play/stage/Stage.hx):
 *   character.x = stage.characters.<slot>.position[0] - characterOrigin.x   // origin = feet (bottom-center)
 * Psych positions are the top-left corner, so (width*scale/2, height*scale) is added.
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  const STAGE_VERSION = '1.0.2';
  const FALLBACK_FRAME = { w: 400, h: 400 };

  /* ----------------------------- Lua (best effort) ----------------------------- */
  function stripLuaComments(src) {
    return src.replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '').replace(/--[^\n]*/g, '');
  }

  function splitArgs(s) {
    const args = [];
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
      } else if (ch === ',') {
        args.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim() !== '' || args.length) args.push(cur.trim());
    return args;
  }

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

  const HANDLED = new Set([
    'makeLuaSprite', 'makeAnimatedLuaSprite', 'addAnimationByPrefix', 'addAnimationByIndices', 'addAnimation',
    'objectPlayAnimation', 'scaleObject', 'setScrollFactor', 'addLuaSprite', 'setProperty', 'setBlendMode',
    'setObjectOrder', 'precacheImage', 'makeGraphic', 'updateHitbox', 'screenCenter', 'setGraphicSize',
  ]);

  /**
   * @returns {{sprites:Array, dynamic:Set<string>, skipped:Array<string>}}
   */
  function parseStageLua(src) {
    const code = stripLuaComments(src);
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
      const a = raw.map(lit);
      const tag = a[0];
      const needTag = () => typeof tag === 'string';
      switch (fn) {
        case 'makeLuaSprite':
        case 'makeAnimatedLuaSprite': {
          if (!needTag() || typeof a[1] !== 'string') {
            skipped.push(fn + '(' + m[2].trim() + ')');
            break;
          }
          const x = raw.length > 2 ? a[2] : 0; // missing argument = 0; present but non-literal = skip
          const y = raw.length > 3 ? a[3] : 0;
          if (typeof x !== 'number' || typeof y !== 'number') {
            skipped.push(fn + '(' + m[2].trim() + ')');
            break;
          }
          sprites.set(tag, { tag, image: a[1], x, y, animated: fn === 'makeAnimatedLuaSprite', anims: [], scale: [1, 1], scroll: [1, 1], alpha: 1, flipX: false, angle: 0, blend: '', front: false, added: false, start: null });
          break;
        }
        case 'makeGraphic':
          // makeGraphic creates a solid-color rectangle: no simple equivalent.
          if (needTag()) {
            sprites.delete(tag);
            skipped.push('makeGraphic("' + tag + '") (solid rectangle)');
          }
          break;
        case 'addAnimationByPrefix': {
          const s = needTag() && sprites.get(tag);
          if (s && typeof a[1] === 'string' && typeof a[2] === 'string') {
            const an = { name: a[1], prefix: a[2] };
            if (typeof a[3] === 'number' && a[3] !== 24) an.frameRate = a[3];
            if (a[4] === true) an.looped = true;
            s.anims.push(an);
          }
          break;
        }
        case 'addAnimationByIndices': {
          const s = needTag() && sprites.get(tag);
          if (s && typeof a[1] === 'string' && typeof a[2] === 'string' && typeof a[3] === 'string') {
            const an = { name: a[1], prefix: a[2], frameIndices: a[3].split(',').map((n) => parseInt(n, 10)).filter(Number.isFinite) };
            if (typeof a[4] === 'number' && a[4] !== 24) an.frameRate = a[4];
            if (a[5] === true) an.looped = true;
            s.anims.push(an);
          }
          break;
        }
        case 'objectPlayAnimation': {
          const s = needTag() && sprites.get(tag);
          if (s && typeof a[1] === 'string' && !s.start) s.start = a[1];
          break;
        }
        case 'scaleObject': {
          const s = needTag() && sprites.get(tag);
          if (s && typeof a[1] === 'number') s.scale = [a[1], typeof a[2] === 'number' ? a[2] : a[1]];
          break;
        }
        case 'setScrollFactor': {
          const s = needTag() && sprites.get(tag);
          if (s && typeof a[1] === 'number') s.scroll = [a[1], typeof a[2] === 'number' ? a[2] : a[1]];
          break;
        }
        case 'setBlendMode': {
          const s = needTag() && sprites.get(tag);
          if (s && typeof a[1] === 'string') s.blend = a[1].toLowerCase();
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
          const s = needTag() && sprites.get(tag);
          if (s && !s.added) {
            s.added = true;
            s.front = a[1] === true;
            order.push(s);
          }
          break;
        }
        case 'screenCenter':
        case 'setGraphicSize':
          if (needTag() && sprites.has(tag)) skipped.push(fn + '("' + tag + '") (depends on the image size)');
          break;
        default:
          break;
      }
    }
    return { sprites: order, dynamic, skipped };
  }
  C.parseStageLua = parseStageLua;

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
      isPixel: !!pixel,
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
      const behind = parsed.sprites.filter((s) => !s.front);
      const front = parsed.sprites.filter((s) => s.front);
      const step = behind.length ? Math.max(1, Math.min(10, Math.floor(90 / behind.length))) : 10;
      behind.forEach((s, i) => props.push(propFromSprite(s, (i + 1) * step, isPixel, fs)));
      front.forEach((s, i) => props.push(propFromSprite(s, 400 + (i + 1) * 10, isPixel, fs)));
      if (parsed.skipped.length) report.warn('Stage "' + id + '": ' + parsed.skipped.length + ' Lua item(s) not converted: ' + parsed.skipped.slice(0, 5).join('; ') + (parsed.skipped.length > 5 ? '; ...' : ''));
      if (parsed.dynamic.size) report.warn('Stage "' + id + '": the Lua uses dynamic logic (' + [...parsed.dynamic].slice(0, 8).join(', ') + ') that was not converted.');
      report.count('Stage props extracted from Lua', props.length);
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

  C.stages = { convertStage, parseStageLua };
})(typeof window !== 'undefined' ? window : globalThis);
