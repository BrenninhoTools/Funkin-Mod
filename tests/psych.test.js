/* Psych Engine -> V-Slice end-to-end test (data + Lua scripts). */
const assert = require('assert');
const { JSZip, C, PNG, OGG, readJson, readText, checkHScript, collectHxc } = require('./helpers');

const SONG_LUA = `
local shakeAmount = 0.5
local colors = {'FF0000', '00FF00', '0000FF'}
local names = {}

function onCreate()
    makeLuaSprite('flash', '', 0, 0)
    makeGraphic('flash', screenWidth, screenHeight, 'FFFFFF')
    setObjectCamera('flash', 'camOther')
    setProperty('flash.alpha', 0)
    addLuaSprite('flash', true)
    makeLuaText('info', 'Song: ' .. songName .. ' | bpm ' .. bpm, 400, 10, 10)
    addLuaText('info')
    for i = 0, 3 do
        noteTweenAlpha('hide' .. i, i, 0.3, 1, 'quadOut')
    end
    names.first = 'x'
end

function onBeatHit()
    if curBeat % 4 == 0 and not downscroll then
        cameraShake('game', 0.01, 0.2)
        doTweenAlpha('flashIn', 'flash', 0.6, 0.1, 'linear')
    end
    local c = colors[(curBeat % #colors) + 1]
    setTextColor('info', c)
end

function onEvent(name, value1, value2)
    if name == 'Screen Shake' then
        local d = tonumber(value1) or 0.5
        cameraShake('camGame', d * shakeAmount, 0.2)
    end
end

function goodNoteHit(id, direction, noteType, isSustainNote)
    if noteType == 'Hurt Note' then setHealth(getHealth() - 0.5) end
end

function onStartCountdown()
    if not seenCutscene then
        runTimer('cut', 1.5)
        return Function_Stop
    end
    return Function_Continue
end

function onTimerCompleted(tag, loops, loopsLeft)
    if tag == 'cut' then
        seenCutscene = true
        startCountdown()
    end
end
`;

function buildFakeMod() {
  const z = new JSZip();
  const R = 'cool-mod/';
  z.file(R + 'pack.json', JSON.stringify({ name: 'Cool Mod', description: 'test', runsGlobally: false }));
  z.file(R + 'pack.png', PNG);

  // --- song with 3 sections (BPM changes in the 2nd), mustHit, events ---
  const chart = {
    song: {
      song: 'Test Song', bpm: 120, speed: 2.5, needsVoices: true, player1: 'cool-bf', player2: 'cool-dad', gfVersion: 'gf', stage: 'coolstage',
      arrowSkin: '', splashSkin: '',
      notes: [
        { mustHitSection: true, sectionBeats: 4, sectionNotes: [[0, 0, 0], [500, 5, 250, 'Alt Animation'], [1000, 3, 0, 'Hurt Note']] },
        { mustHitSection: false, changeBPM: true, bpm: 60, sectionNotes: [[2000, 1, 0], [2500, 6, 0, 'GF Sing'], [3000, -1, 'Hey!', 'BF', '1']] },
        { mustHitSection: true, gfSection: true, sectionNotes: [] },
      ],
      events: [
        [1500, [['Camera Follow Pos', '100', '200'], ['Play Animation', 'hey', 'dad']]],
        [2200, [['Change Scroll Speed', '2', '1']]],
        [2600, [['Camera Follow Pos', '', '']]],
        [2700, [['Screen Shake', '0.5, 0.05', '']]],
      ],
    },
  };
  z.file(R + 'data/test-song/test-song.json', JSON.stringify(chart));
  const hard = JSON.parse(JSON.stringify(chart));
  hard.song.speed = 3;
  z.file(R + 'data/test-song/test-song-hard.json', JSON.stringify(hard));
  z.file(R + 'data/test-song/modchart.lua', SONG_LUA);
  z.file(R + 'songs/test-song/Inst.ogg', OGG);
  z.file(R + 'songs/test-song/Voices-Player.ogg', OGG);
  z.file(R + 'songs/test-song/Voices-Opponent.ogg', OGG);

  // --- characters ---
  z.file(R + 'characters/cool-bf.json', JSON.stringify({
    animations: [
      { anim: 'idle', name: 'BF idle', fps: 24, loop: false, indices: [], offsets: [0, 0] },
      { anim: 'singLEFT', name: 'BF left', fps: 30, loop: true, indices: [1, 2], offsets: [12, -6] },
    ],
    image: 'characters/COOL_BF', scale: 2, sing_duration: 4, healthicon: 'cool', position: [0, 350], camera_position: [0, 0], flip_x: true, no_antialiasing: false,
  }));
  z.file(R + 'characters/cool-dad.json', JSON.stringify({
    animations: [{ anim: 'danceLeft', name: 'dl', fps: 24, loop: false, indices: [], offsets: [0, 0] }, { anim: 'danceRight', name: 'dr', fps: 24, loop: false, indices: [], offsets: [0, 0] }],
    image: 'characters/COOL_DAD', scale: 1, sing_duration: 6, healthicon: 'dad', position: [10, 20], camera_position: [5, 6], flip_x: false, no_antialiasing: true,
  }));
  z.file(R + 'images/characters/COOL_BF.png', PNG);
  z.file(R + 'images/characters/COOL_BF.xml', '<TextureAtlas><SubTexture name="BF idle0000" x="0" y="0" width="100" height="120" frameX="-2" frameY="-3" frameWidth="110" frameHeight="130"/></TextureAtlas>');
  z.file(R + 'images/characters/COOL_DAD.png', PNG);
  z.file(R + 'images/icons/icon-cool.png', PNG);
  z.file(R + 'images/icons/dad.png', PNG); // name without the "icon-" prefix

  // --- stage ---
  z.file(R + 'stages/coolstage.json', JSON.stringify({ defaultZoom: 0.8, isPixelStage: false, boyfriend: [770, 100], girlfriend: [400, 130], opponent: [100, 100], hide_girlfriend: true, camera_boyfriend: [1, 2], camera_opponent: [0, 0], camera_girlfriend: [0, 0] }));
  z.file(R + 'stages/coolstage.lua', `
    function onCreate()
      makeLuaSprite('bg', 'stageback', -600, -200);
      setScrollFactor('bg', 0.9, 0.9);
      scaleObject('bg', 1.2, 1.2);
      addLuaSprite('bg', false);
      makeAnimatedLuaSprite('crowd', 'crowd', 10, 20);
      addAnimationByPrefix('crowd', 'idle', 'Crowd Idle', 24, true);
      objectPlayAnimation('crowd', 'idle', true);
      addLuaSprite('crowd', true);
      makeLuaSprite('dyn', 'x', someVar, 0);
      addLuaSprite('dyn', false);
    end
    function onBeatHit()
      if curBeat % 2 == 0 then setProperty('crowd.angle', 2) else setProperty('crowd.angle', -2) end
    end
  `);
  z.file(R + 'images/stageback.png', PNG);
  z.file(R + 'images/crowd.png', PNG);
  z.file(R + 'images/crowd.xml', '<TextureAtlas/>');

  // --- week ---
  z.file(R + 'weeks/week1.json', JSON.stringify({
    songs: [['Test Song', 'cool', [1, 2, 3]]], weekCharacters: ['cool-dad', '', 'cool-bf'], weekBackground: 'stage', storyName: 'My New Week', weekName: 'Week 1', hideStoryMode: false, difficulties: '',
  }));
  z.file(R + 'images/storymenu/week1.png', PNG);
  z.file(R + 'images/menucharacters/cool-dad.json', JSON.stringify({ image: 'Menu_Dad', scale: 0.9, position: [20, 30], idle_anim: 'M Dad Idle', confirm_anim: 'M Dad Idle', flipX: false }));
  z.file(R + 'images/menucharacters/cool-bf.json', JSON.stringify({ image: 'Menu_BF', scale: 1, position: [0, 0], idle_anim: 'M BF Idle', confirm_anim: 'M BF Confirm', flipX: true }));
  z.file(R + 'images/menucharacters/Menu_Dad.png', PNG);
  z.file(R + 'images/menucharacters/Menu_BF.png', PNG);

  // --- orphan song (in no week) ---
  z.file(R + 'data/lonely/lonely.json', JSON.stringify({ song: { song: 'Lonely', bpm: 100, speed: 1, player1: 'bf', player2: 'dad', stage: 'stage', notes: [{ mustHitSection: true, sectionNotes: [[0, 0, 0]] }] } }));
  z.file(R + 'songs/lonely/Inst.ogg', OGG);
  z.file(R + 'songs/lonely/Voices.ogg', OGG);

  // --- scripts ---
  z.file(R + 'scripts/global.lua', 'function onUpdate(elapsed)\n  if keyboardJustPressed("SPACE") then addScore(10) end\nend\n');
  z.file(R + 'custom_events/Screen Shake.lua', "function onEvent(name, value1, value2)\n  cameraShake('game', tonumber(value1) or 0.05, 0.2)\nend\n");
  z.file(R + 'custom_events/Screen Shake.txt', 'Shakes the screen');
  z.file(R + 'custom_notetypes/Hurt Note.lua', "function goodNoteHit(id, direction, noteType, isSustainNote)\n  setHealth(getHealth() - 0.4)\nend\n");
  // Real-world Psych JSON is sloppy: comments, a missing comma, trailing commas.
  z.file(R + 'stages/lenient.json', '{\n  // a comment\n  "defaultZoom": 0.7,\n  "boyfriend": [770, 100]\n  "girlfriend": [400, 130],\n  "opponent": [100, 100,],\n}\n');
  // Audio in a differently-cased folder and in mp3 format; stage referenced with another letter case; legacy numeric note type.
  z.file(R + 'data/odd-song/odd-song.json', JSON.stringify({ song: { song: 'Odd Song', bpm: 100, speed: 1, player1: 'cool-bf2', player2: 'cool-dad', stage: 'Hallo', notes: [{ mustHitSection: true, sectionNotes: [[0, 0, 0, '0']] }] } }));
  z.file(R + 'songs/Odd-Song/Inst.mp3', OGG);
  z.file(R + 'characters/cool-bf2.json', JSON.stringify({ animations: [{ anim: 'idle', name: 'x', fps: 24, loop: false, indices: [], offsets: [0, 0] }], image: 'characters/COOL_DAD', healthicon: 'dad' })); // shares the "dad" icon with cool-dad
  // A stage whose scenery is built from a Lua constant, a solid rectangle, setGraphicSize and screenCenter.
  z.file(R + 'stages/hallo.json', JSON.stringify({ defaultZoom: 0.9 }));
  z.file(R + 'stages/hallo.lua', `local escenario = 'stages/hallo/'
function onCreate()
  makeLuaSprite('bgc', escenario..'bg-clouds', -100, 50)
  setScrollFactor('bgc', 0.5, 0.5)
  addLuaSprite('bgc', false)
  makeLuaSprite('white', '', 0, 0)
  makeGraphic('white', 400, 200, 'FF0000')
  screenCenter('white')
  addLuaSprite('white', true)
  makeLuaSprite('sky', escenario..'sky')
  setGraphicSize('sky', 640)
  addLuaSprite('sky', false)
end
function onBeatHit() setProperty('bgc.alpha', 0.5) end
`);
  z.file(R + 'images/stages/hallo/bg-clouds.png', PNG);
  z.file(R + 'images/stages/hallo/sky.png', PNG);
  // A week without a title image, engine list files, script assets and the intro text.
  z.file(R + 'weeks/week2.json', JSON.stringify({ songs: [['Odd Song', 'dad', [1, 2, 3]]], weekCharacters: ['', '', ''], storyName: 'Second', weekName: 'Second' }));
  z.file(R + 'weeks/weekList.txt', 'week1\nweek2');
  z.file(R + 'data/characterList.txt', 'cool-bf');
  z.file(R + 'data/introText.txt', 'a--b');
  z.file(R + 'scripts/Rating/Combe.png', PNG);
  z.file(R + 'scripts/broken.lua', 'function onCreate(\n');
  z.file(R + 'shaders/blur.frag', 'void main(){}');
  z.file(R + 'music/menu.ogg', OGG);
  return z;
}

async function run(t) {
  const zip = buildFakeMod();
  if (process.env.WRITE_FIXTURE) require('fs').writeFileSync(process.env.WRITE_FIXTURE, await zip.generateAsync({ type: 'nodebuffer' }));

  // detection + scan
  const mods = C.detectMods(zip, 'x.zip');
  assert.deepStrictEqual(mods.map((m) => m.prefix), ['cool-mod/']);
  const scan = await C.scanMod(zip, mods[0]);
  assert.strictEqual(scan.engine, 'psych');
  assert.deepStrictEqual(scan.songs.sort(), ['lonely', 'odd-song', 'test-song']);
  assert.deepStrictEqual(scan.characters.sort(), ['cool-bf', 'cool-bf2', 'cool-dad']);
  assert.strictEqual(scan.pack.name, 'Cool Mod');

  const res = await C.convertMod(zip, mods[0], { JSZip, artist: 'Me', author: 'Tester' });
  const M = res.modId + '/';
  assert.strictEqual(res.modId, 'cool-mod');
  assert.strictEqual(res.engine, 'psych');

  const buf = await res.zip.generateAsync({ type: 'nodebuffer' });
  const re = await JSZip.loadAsync(buf); // round-trip: makes sure it is a valid zip

  // --- meta
  const meta = await readJson(re, M + '_polymod_meta.json');
  assert.strictEqual(meta.title, 'Cool Mod');
  assert.strictEqual(meta.api_version, '0.8.0');
  assert.strictEqual(meta.contributors[0].name, 'Tester');
  assert(re.file(M + '_polymod_icon.png'), 'icon');

  // --- song
  const md = await readJson(re, M + 'data/songs/test-song/test-song-metadata.json');
  assert.strictEqual(md.version, '2.2.4');
  assert.strictEqual(md.songName, 'Test Song');
  assert.strictEqual(md.artist, 'Me');
  assert.deepStrictEqual(md.playData.difficulties, ['normal', 'hard']);
  assert.deepStrictEqual(md.playData.characters.playerVocals, ['cool-bf']);
  assert.deepStrictEqual(md.playData.characters.opponentVocals, ['cool-dad']);
  assert.strictEqual(md.playData.stage, 'coolstage');
  assert.deepStrictEqual(md.timeChanges, [{ t: 0, bpm: 120 }, { t: 2000, bpm: 60 }]); // 4 beats at 120 bpm = 2000 ms

  const ch = await readJson(re, M + 'data/songs/test-song/test-song-chart.json');
  assert.strictEqual(ch.version, '2.0.0');
  assert.deepStrictEqual(ch.scrollSpeed, { normal: 2.5, hard: 3 });
  assert.deepStrictEqual(ch.notes.normal, [
    { t: 0, d: 0 },
    { t: 500, d: 5, l: 250, k: 'alt' },
    { t: 1000, d: 3, k: 'Hurt Note' },
    { t: 2000, d: 5 },
    { t: 2500, d: 2 },
  ]);
  assert.strictEqual(ch.notes.hard.length, 5);

  const ev = (e) => ch.events.filter((x) => x.e === e);
  assert.deepStrictEqual(ev('FocusCamera').map((x) => [x.t, x.v]), [
    [0, 0],
    [1500, { char: -1, x: 100, y: 200 }],
    [2600, 1],
    [6000, 2],
  ]);
  assert.deepStrictEqual(ev('PlayAnimation').map((x) => [x.t, x.v]), [
    [1500, { target: 'dad', anim: 'hey', force: true }],
    [3000, { target: 'bf', anim: 'hey', force: true }],
  ]);
  assert.deepStrictEqual(ev('ScrollSpeed')[0], { t: 2200, e: 'ScrollSpeed', v: { scroll: 2, duration: 4, ease: 'linear' } });
  // "Screen Shake" is handled by scripts (onEvent + custom event), so it is kept as a pass-through event.
  assert.deepStrictEqual(ev('Screen Shake'), [{ t: 2700, e: 'Screen Shake', v: { value1: '0.5, 0.05', value2: '' } }]);
  assert(re.file(M + 'songs/test-song/Inst.ogg'));
  assert(re.file(M + 'songs/test-song/Voices-cool-bf.ogg'), 'Voices-Player -> Voices-<player id>');
  assert(re.file(M + 'songs/test-song/Voices-cool-dad.ogg'));
  assert(!re.file(M + 'songs/test-song/Voices-Player.ogg'));

  // --- orphan song
  const lm = await readJson(re, M + 'data/songs/lonely/lonely-metadata.json');
  assert.strictEqual(lm.playData.stage, 'mainStage');
  assert.strictEqual(lm.playData.characters.playerVocals, undefined);
  assert(re.file(M + 'songs/lonely/Voices.ogg'));
  const extras = await readJson(re, M + 'data/levels/cool-mod-extras.json');
  assert.deepStrictEqual(extras.songs, ['lonely']);
  assert.strictEqual(extras.visible, false);

  // --- characters
  const bf = await readJson(re, M + 'data/characters/cool-bf.json');
  assert.strictEqual(bf.version, '1.0.2');
  assert.strictEqual(bf.assetPath, 'characters/COOL_BF');
  assert.strictEqual(bf.scale, 2);
  assert.strictEqual(bf.danceEvery, 2);
  assert.deepStrictEqual(bf.offsets, [0, 175]);
  assert.strictEqual(bf.flipX, true);
  assert.deepStrictEqual(bf.healthIcon, { id: 'cool' });
  assert.deepStrictEqual(bf.animations, [
    { name: 'idle', prefix: 'BF idle' },
    { name: 'singLEFT', prefix: 'BF left', frameRate: 30, looped: true, frameIndices: [1, 2], offsets: [6, -3] },
  ]);
  const dad = await readJson(re, M + 'data/characters/cool-dad.json');
  assert.strictEqual(dad.danceEvery, undefined);
  assert.strictEqual(dad.isPixel, true);
  assert.deepStrictEqual(dad.cameraOffsets, [5, 6]);
  assert(re.file(M + 'images/icons/icon-dad.png'));

  // --- stage
  const st = await readJson(re, M + 'data/stages/coolstage.json');
  assert.strictEqual(st.cameraZoom, 0.8);
  assert.deepStrictEqual(st.characters.bf.position, [880, 360]);
  assert.deepStrictEqual(st.characters.bf.cameraOffsets, [-99, -98]);
  assert.deepStrictEqual(st.characters.dad.position, [300, 500]);
  assert.strictEqual(st.characters.gf.alpha, 0);
  assert.strictEqual(st.props.length, 2);
  assert.strictEqual(st.props[0].name, 'bg');
  assert.strictEqual(st.props[1].zIndex, 410);

  // --- week
  const lv = await readJson(re, M + 'data/levels/cool-mod-week1.json');
  assert.strictEqual(lv.titleAsset, 'storymenu/titles/cool-mod-week1');
  assert.deepStrictEqual(lv.songs, ['test-song']);
  assert.strictEqual(lv.props.length, 3);
  assert.deepStrictEqual(lv.props[0].offsets, [150, 40]);

  // --- scripts (Lua -> HScript)
  const song = await readText(re, M + 'scripts/songs/test-song.hxc');
  assert(/class CoolModTestSongSong extends Song/.test(song));
  assert(/super\("test-song"\)/.test(song));
  assert(/function s\d+_onBeatHit\(\)/.test(song));
  assert(/override function onNoteHit\(event:HitNoteScriptEvent\)/.test(song));
  assert(/override function onSongEvent/.test(song));
  assert(/if \(s\d+_onStartCountdown\(\) == Function_Stop\) \{ event.cancel\(\); \}/.test(song));
  assert(/function makeLuaSprite\(/.test(song), 'shim functions are pasted in');
  assert(!/function cameraFlash\(/.test(song), 'unused shim functions are not');
  const glob = await readText(re, M + 'scripts/global/global.hxc');
  assert(/class CoolModGlobalScript extends Module/.test(glob));
  assert(/if \(!__ensure\(\)\) return;/.test(glob));
  const stg = await readText(re, M + 'scripts/stages/coolstage.hxc');
  assert(/class CoolModCoolstageStage extends Stage/.test(stg));
  assert(!/makeLuaSprite\("bg"/.test(stg), 'static props are not recreated at runtime');
  assert(/makeLuaSprite\("dyn"/.test(stg), 'dynamic ones still are');
  const evc = await readText(re, M + 'scripts/events/screen-shake.hxc');
  assert(/class CoolModScreenShakeEvent extends SongEvent/.test(evc));
  assert(/super\("Screen Shake"\)/.test(evc));
  const nk = await readText(re, M + 'scripts/notekinds/hurt-note.hxc');
  assert(/class CoolModHurtNoteNoteKind extends NoteKind/.test(nk));
  assert(/super\("Hurt Note"/.test(nk));
  assert(!re.file(M + 'scripts/foo.lua') && !re.file(M + 'scripts/global.lua'), 'Lua sources are not copied');

  // --- tolerant JSON and unusual audio locations
  const lenient = await readJson(re, M + 'data/stages/lenient.json');
  assert.strictEqual(lenient.cameraZoom, 0.7);
  assert(re.file(M + 'songs/odd-song/Inst.mp3'), 'audio found in a differently-cased folder, kept as mp3');
  assert(res.report.warnings.some((w) => /Inst\.mp3.*only reads \.ogg/.test(w)));
  assert(C.lenientParse('{a: 1, \'b\': [1, 2,], /* c */ "d": "x" "e": true,}').e === true);
  const oddMeta = await readJson(re, M + 'data/songs/odd-song/odd-song-metadata.json');
  assert.strictEqual(oddMeta.playData.stage, 'hallo', 'stage "Hallo" resolves to stages/hallo.json');
  assert.deepStrictEqual(oddMeta.playData.characters.player, 'cool-bf2');
  assert.deepStrictEqual((await readJson(re, M + 'data/songs/odd-song/odd-song-chart.json')).notes.normal, [{ t: 0, d: 0 }], 'numeric note type "0" is a normal note');
  assert(!res.report.warnings.some((w) => /Duplicate output/.test(w)), 'icons shared by several characters are written once');

  // --- stage scenery built from Lua constants and static helpers
  const hallo = await readJson(re, M + 'data/stages/hallo.json');
  assert.deepStrictEqual(hallo.props.map((p) => [p.name, p.zIndex]), [['bgc', 10], ['sky', 20], ['white', 410]]);
  assert.strictEqual(hallo.props[0].assetPath, 'stages/hallo/bg-clouds');
  assert.deepStrictEqual(hallo.props[0].position, [-100, 50]);
  assert.strictEqual(hallo.props[1].assetPath, 'stages/hallo/sky');
  assert.strictEqual(hallo.props[1].scale, 640, 'setGraphicSize(tag, 640) on a 1x1 image');
  assert.strictEqual(hallo.props[2].assetPath, 'stages/cool-mod/solid-ff0000ff');
  assert.deepStrictEqual(hallo.props[2].scale, [400, 200]);
  assert.deepStrictEqual(hallo.props[2].position, [440, 260], 'screenCenter on the 400x200 rectangle');
  assert(re.file(M + 'images/stages/cool-mod/solid-ff0000ff.png'));
  const halloScript = await readText(re, M + 'scripts/stages/hallo.hxc');
  assert(!/makeLuaSprite|makeGraphic|screenCenter|setGraphicSize/.test(halloScript.split('function s')[1] || ''), 'static setup is not repeated at runtime');
  assert(/setProperty\("bgc.alpha", 0\.5\)/.test(halloScript), 'runtime changes in onBeatHit are kept');

  // --- weeks / misc files
  const w2 = await readJson(re, M + 'data/levels/cool-mod-week2.json');
  assert.strictEqual(w2.titleAsset, 'storymenu/titles/cool-mod-week2');
  assert(re.file(M + 'images/storymenu/titles/cool-mod-week2.png'), 'missing title image -> transparent placeholder');
  assert(re.file(M + 'data/introText.txt') && re.file(M + 'scripts/Rating/Combe.png'));
  assert(!/weekList|characterList/.test(await readText(re, M + 'CONVERSION_REPORT.md')), 'engine list files are not reported');

  // --- missing audio: the error says what was found instead
  const ghost = new JSZip();
  ghost.file('g/pack.json', '{"name":"G"}');
  ghost.file('g/data/ghost/ghost.json', JSON.stringify({ song: { song: 'Ghost', bpm: 100, speed: 1, player1: 'bf', player2: 'dad', notes: [] } }));
  ghost.file('g/songs/Other/Inst.ogg', OGG);
  const gres = await C.convertMod(ghost, C.detectMods(ghost, 'g.zip')[0], { JSZip, convertScripts: false });
  assert(gres.report.errors.some((e) => /missing Inst\.ogg.*songs\/ghost\/ does not exist.*Other/.test(e)), gres.report.errors.join(' | '));

  // --- copies and report
  assert(re.file(M + 'music/menu.ogg'));
  const rep = await readText(re, M + 'CONVERSION_REPORT.md');
  assert(/Shaders/.test(rep));
  assert(/broken\.lua/.test(rep), 'a Lua syntax error is reported');
  assert.strictEqual(res.reportText, rep);
  assert.strictEqual(res.report.errors.length, 1, 'only the deliberately broken script fails: ' + res.report.errors.join(' | '));

  for (const f of await collectHxc(re, M)) {
    const bad = require('./lint').lint(f.text);
    assert.deepStrictEqual(bad, [], f.name + ': undeclared identifiers: ' + bad.join(', '));
  }
  const hx = checkHScript(await collectHxc(re, M));
  if (hx && !hx.error) {
    hx.results.forEach((r) => assert(r.ok, 'HScript parse error: ' + r.line));
    t.note('HScript syntax check passed for ' + hx.results.length + ' generated files');
  } else t.note('HScript syntax check skipped (see tests/hscript/README.md)');

  // Opting out of script conversion leaves the Lua files in the report instead.
  const res2 = await C.convertMod(zip, mods[0], { JSZip, convertScripts: false });
  const re2 = await JSZip.loadAsync(await res2.zip.generateAsync({ type: 'nodebuffer' }));
  assert(!Object.keys(re2.files).some((n) => n.endsWith('.hxc')));
  assert(/Lua scripts/.test(await readText(re2, 'cool-mod/CONVERSION_REPORT.md')));
  const ch2 = await readJson(re2, 'cool-mod/data/songs/test-song/test-song-chart.json');
  assert(!ch2.events.some((e) => e.e === 'Screen Shake'), 'without scripts the unsupported event is dropped');
}

module.exports = { run, buildFakeMod };
