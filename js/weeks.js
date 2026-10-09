/*
 * Weeks: Psych weeks/<id>.json -> V-Slice data/levels/<id>.json (LevelData 1.0.x).
 *
 * From the source code:
 *   source/funkin/data/story/level/LevelData.hx   (level fields)
 *   source/funkin/ui/story/Level.hx               (prop.x = offsets[0] + width*0.25*index)
 * In Psych a MenuCharacter starts at x = 0.25*W*(i+1) - 150, y = 70 and applies `offset.set(position)`,
 * hence: offsets = [170 - position[0], 70 - position[1]].
 */
(function (root) {
  const C = (root.FNFConv = root.FNFConv || {});

  const LEVEL_VERSION = '1.0.2';
  const BASE_LEVEL_IDS = /^(tutorial|week\d+|weekend\d+)$/;
  // 1x1 transparent PNG, used as the prop for an empty character slot.
  const BLANK_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  function blankPng() {
    const bin = atob(BLANK_PNG_B64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  async function convertMenuCharacter(name, ctx) {
    const { fs, report } = ctx;
    if (!name) return null;
    const jsonPath = fs.resolve('images/menucharacters/' + name + '.json');
    if (!jsonPath) {
      report.warn('Week: menu character "' + name + '" has no images/menucharacters/' + name + '.json; prop skipped.');
      return null;
    }
    let j;
    try {
      j = await fs.json(jsonPath);
    } catch (e) {
      report.warn(e.message);
      return null;
    }
    const pos = Array.isArray(j.position) ? j.position : [0, 0];
    const image = String(j.image || name);
    const prop = {
      assetPath: 'menucharacters/' + image,
      scale: C.num(j.scale, 1),
      offsets: [170 - C.num(pos[0], 0), 70 - C.num(pos[1], 0)],
      animations: [],
    };
    if (j.flipX) prop.flipX = true;
    if (j.idle_anim) prop.animations.push({ name: 'idle', prefix: String(j.idle_anim), frameRate: 24 });
    if (j.confirm_anim && j.confirm_anim !== j.idle_anim) prop.animations.push({ name: 'confirm', prefix: String(j.confirm_anim), frameRate: 24 });
    if (!fs.exists('images/menucharacters/' + image + '.png')) report.warn('Week: image "images/menucharacters/' + image + '.png" not found.');
    return prop;
  }

  /**
   * @param path weeks/<id>.json
   * @param ctx {fs,out,report,modId}
   * @returns {Promise<{id:string, songs:string[]}|null>}
   */
  async function convertWeek(path, ctx) {
    const { fs, out, report } = ctx;
    const file = C.stripExt(C.baseName(path));
    let w;
    try {
      w = await fs.json(path);
    } catch (e) {
      report.error(e.message);
      return null;
    }
    const id = BASE_LEVEL_IDS.test(file.toLowerCase()) ? ctx.modId + '-' + C.slugId(file) : C.slugId(file);
    if (id !== C.slugId(file)) report.log('Week "' + file + '" renamed to "' + id + '" so it does not overwrite the base-game week.');

    const songs = (Array.isArray(w.songs) ? w.songs : []).map((s) => C.formatToSongPath(Array.isArray(s) ? s[0] : s)).filter(Boolean);
    if (!songs.length) report.warn('Week "' + file + '": no songs.');

    const titleAsset = 'storymenu/titles/' + id;
    const titleSrc = ['images/storymenu/' + file + '.png', 'images/storymenu/' + id + '.png'].find((p) => fs.exists(p));
    if (titleSrc) out.binary('images/' + titleAsset + '.png', await fs.bytes(titleSrc));
    else report.warn('Week "' + file + '": title image "images/storymenu/' + file + '.png" not found.');

    const props = [];
    const BLANK_ASSET = 'storymenu/props/' + ctx.modId + '-empty';
    const chars = Array.isArray(w.weekCharacters) ? w.weekCharacters : [];
    for (let i = 0; i < chars.length; i++) {
      const p = await convertMenuCharacter(chars[i], ctx);
      // Keep the index: V-Slice positions props by their index.
      props.push(p || { assetPath: BLANK_ASSET, scale: 1, offsets: [0, 0], animations: [] });
    }
    // Drop trailing empty slots; if any remain in the middle, create the transparent PNG.
    while (props.length && props[props.length - 1].assetPath === BLANK_ASSET) props.pop();
    if (props.some((p) => p.assetPath === BLANK_ASSET)) {
      if (!out.has('images/' + BLANK_ASSET + '.png')) out.binary('images/' + BLANK_ASSET + '.png', blankPng());
      report.log('Week "' + file + '": empty character slot in the middle of the list; used a transparent prop.');
    }

    if (w.weekBackground && w.weekBackground !== 'stage') report.warn('Week "' + file + '": background "' + w.weekBackground + '" was not converted (using the default V-Slice color).');
    if (w.hideFreeplay) report.warn('Week "' + file + '": hideFreeplay does not exist in V-Slice; its songs will show up in Freeplay.');
    if (w.weekBefore || w.startUnlocked === false) report.log('Week "' + file + '": weekBefore/startUnlocked locking does not exist in V-Slice.');
    if (Array.isArray(w.difficulties) ? w.difficulties.length : w.difficulties) report.log('Week "' + file + '": the week difficulty list was ignored (V-Slice uses each song\'s difficulties).');

    const level = {
      version: LEVEL_VERSION,
      name: String(w.storyName || w.weekName || id),
      titleAsset,
      props,
      background: '#F9CF51',
      songs,
    };
    if (w.hideStoryMode) level.visible = false;
    out.json('data/levels/' + id + '.json', level);
    report.count('Weeks converted');
    return { id, songs };
  }

  /** Creates a level hidden from Story Mode whose only job is to list songs in Freeplay. */
  function buildExtrasLevel(modId, modTitle, songIds, out, report) {
    const id = modId + '-extras';
    out.json('data/levels/' + id + '.json', {
      version: LEVEL_VERSION,
      name: modTitle + ' (extras)',
      titleAsset: 'storymenu/titles/week1',
      props: [],
      background: '#F9CF51',
      visible: false,
      songs: songIds,
    });
    report.warn('Songs that belong to no week were grouped into the hidden level "' + id + '" (shown in Freeplay, not in Story Mode): ' + songIds.join(', '));
    report.count('Extra levels created');
  }

  C.weeks = { convertWeek, buildExtrasLevel };
})(typeof window !== 'undefined' ? window : globalThis);
