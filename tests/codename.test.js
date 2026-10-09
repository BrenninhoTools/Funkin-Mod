/* Codename Engine -> V-Slice end-to-end test (data + HScript scripts). */
const assert = require('assert');
const { JSZip, C, PNG, OGG, readJson, readText, checkHScript, collectHxc } = require('./helpers');

function chart(extra) {
  return Object.assign({
    codenameChart: true,
    stage: 'cn-stage',
    scrollSpeed: 2.2,
    noteTypes: ['Hurt Note'],
    strumLines: [
      { characters: ['cn-dad'], type: 0, position: 'dad', notes: [{ time: 0, id: 0, type: 0, sLen: 0 }, { time: 500, id: 2, type: 1, sLen: 250 }] },
      { characters: ['cn-bf'], type: 1, position: 'boyfriend', vocalsSuffix: '-bf', notes: [{ time: 250, id: 1, type: 0, sLen: 0 }, { time: 750, id: 3, type: 0, sLen: 100 }] },
      { characters: ['gf'], type: 2, position: 'girlfriend', notes: [] },
    ],
    events: [
      { name: 'Camera Movement', time: 0, params: [1, true, 4, 'CLASSIC', 'In', 0, 0] },
      { name: 'Camera Movement', time: 2000, params: [0, true, 4, 'quad', 'InOut', 10, 20] },
      { name: 'BPM Change', time: 4000, params: [180] },
      { name: 'Scroll Speed Change', time: 5000, params: [true, 3, 4, 'linear', 'In', false] },
      { name: 'My Event', time: 1000, params: ['hello', 3] },
      { name: 'Camera Flash', time: 6000, params: [false, '#FFFFFF', 4, 'camHUD'] },
    ],
  }, extra || {});
}

const SONG_HX = `import flixel.FlxSprite;
import funkin.backend.scripting.events.NoteHitEvent;

var flash:FlxSprite;
public var speedUp = 2;

function create() {
    flash = new FlxSprite().makeGraphic(FlxG.width, FlxG.height, 0xFFFFFFFF);
    flash.alpha = 0;
    flash.cameras = [camHUD];
    add(flash);
}

function postCreate() {
    dad.visible = true;
    health = 1;
}

function update(elapsed:Float) {
    if (FlxG.keys.justPressed.SPACE) health += 0.1;
}

function beatHit(curBeat:Int) {
    if (curBeat % 4 == 0) camGame.zoom += 0.03;
}

function onPlayerHit(event) {
    event.healthGain *= 2;
}

function onNoteCreation(event) {
    event.cancel();
}

function onEvent(eventEvent) {
    if (eventEvent.event.name == "My Event") trace(eventEvent.event.params[0]);
}
`;

function buildFakeMod() {
  const z = new JSZip();
  const R = 'cn-mod/';
  z.file(R + 'data/config/modpack.ini', '[Mod]\nname=CN Mod\ndescription=A Codename mod\n');
  z.file(R + 'songs/cn-song/meta.json', JSON.stringify({ displayName: 'CN Song', bpm: 150, icon: 'cn-dad', color: '#AA0000', difficulties: ['easy', 'hard'] }));
  z.file(R + 'songs/cn-song/charts/easy.json', JSON.stringify(chart()));
  z.file(R + 'songs/cn-song/charts/hard.json', JSON.stringify(chart({ scrollSpeed: 3 })));
  z.file(R + 'songs/cn-song/song/Inst.ogg', OGG);
  z.file(R + 'songs/cn-song/song/Voices.ogg', OGG);
  z.file(R + 'songs/cn-song/song/Voices-bf.ogg', OGG);
  z.file(R + 'songs/cn-song/scripts/mod.hx', SONG_HX);
  z.file(R + 'songs/cn-song/cutscene.hx', 'function create() {}');

  // characters
  z.file(R + 'data/characters/cn-bf.xml', `<!DOCTYPE codename-engine-character>
<character y="350" sprite="cn-bf-sheet" flipX="true" isPlayer="true" icon="cn-bf" color="#31B0D1" scale="2" holdTime="4">
  <anim name="idle" anim="BF idle" x="-5" y="0" fps="24" loop="false" indices="2..4,0"/>
  <anim name="singLEFT" anim="BF left" x="6" y="-7" fps="30" loop="true"/>
</character>`);
  z.file(R + 'data/characters/cn-dad.xml', `<!DOCTYPE codename-engine-character>
<character sprite="cn-dad" icon="cn-dad" holdTime="6.1" antialiasing="false" camx="5" camy="6">
  <anim name="danceLeft" anim="dl" fps="24" loop="false"/>
  <anim name="danceRight" anim="dr" fps="24" loop="false"/>
</character>`);
  z.file(R + 'images/characters/cn-bf-sheet.png', PNG);
  z.file(R + 'images/characters/cn-bf-sheet.xml', '<TextureAtlas><SubTexture name="BF idle0002" x="0" y="0" width="100" height="120" frameX="-2" frameY="-3" frameWidth="110" frameHeight="130"/></TextureAtlas>');
  z.file(R + 'images/characters/cn-dad.png', PNG);
  z.file(R + 'images/icons/cn-bf.png', PNG);
  z.file(R + 'images/icons/cn-dad/icon.png', PNG);

  // stage
  z.file(R + 'data/stages/cn-stage.xml', `<!DOCTYPE codename-engine-stage>
<stage zoom="0.8" name="CN Stage" folder="stages/cn/">
  <sprite name="bg" x="-600" y="-200" sprite="bg" scroll="0.9"/>
  <girlfriend/>
  <dad x="100" y="100"/>
  <boyfriend camxoffset="5"/>
  <box name="floor" x="0" y="500" width="1000" height="40" color="#112233"/>
  <sprite name="crowd" x="10" y="20" sprite="crowd" type="beat"><anim name="idle" anim="Crowd Idle" fps="24" loop="true"/></sprite>
</stage>`);
  z.file(R + 'data/stages/cn-stage.hx', 'function create() { crowd.alpha = 0.5; }\nfunction postCreate() { dad.x += 10; }\nfunction beatHit(curBeat) { crowd.angle += 1; }\n');
  z.file(R + 'images/stages/cn/bg.png', PNG);
  z.file(R + 'images/stages/cn/crowd.png', PNG);
  z.file(R + 'images/stages/cn/crowd.xml', '<TextureAtlas/>');

  // week
  z.file(R + 'data/weeks/weeks/cn-week.xml', '<week name="CN WEEK" chars="cn-dad,none,bf" sprite="cnweek" bgColor="#FF8800"><song>cn-song</song></week>');
  z.file(R + 'data/weeks/characters/cn-dad.xml', '<char scale="0.8" x="20" y="-20"><anim name="idle" anim="Dad idle" fps="24"/></char>');
  z.file(R + 'images/menus/storymenu/weeks/cnweek.png', PNG);
  z.file(R + 'images/menus/storymenu/characters/cn-dad.png', PNG);

  // other scripts
  z.file(R + 'data/events/My Event.hx', 'function onEvent(e) {\n  if (e.event.name == "My Event") trace(e.event.params);\n}\n');
  z.file(R + 'data/events/My Event.json', JSON.stringify({ params: [{ name: 'Text', type: 'String', defaultValue: '' }] }));
  z.file(R + 'data/notes/Hurt Note.hx', 'function onPlayerHit(e) { e.healthGain = -0.5; }\n');
  z.file(R + 'data/scripts/global.hx', 'public var counter = 0;\nfunction postUpdate(elapsed) { counter += elapsed; }\n');
  z.file(R + 'data/characters/cn-dad.hx', 'function create() {}');
  z.file(R + 'shaders/x.frag', 'void main(){}');
  z.file(R + 'music/freakyMenu.ogg', OGG);
  return z;
}

async function run(t) {
  const zip = buildFakeMod();
  if (process.env.WRITE_FIXTURE_CN) require('fs').writeFileSync(process.env.WRITE_FIXTURE_CN, await zip.generateAsync({ type: 'nodebuffer' }));

  const mods = C.detectMods(zip, 'cn.zip');
  assert.deepStrictEqual(mods.map((m) => m.prefix), ['cn-mod/']);
  const scan = await C.scanMod(zip, mods[0]);
  assert.strictEqual(scan.engine, 'codename');
  assert.deepStrictEqual(scan.songs, ['cn-song']);
  assert.deepStrictEqual(scan.characters.sort(), ['cn-bf', 'cn-dad']);
  assert.deepStrictEqual(scan.stages, ['cn-stage']);
  assert.deepStrictEqual(scan.weeks, ['cn-week']);
  assert.strictEqual(scan.pack.name, 'CN Mod');

  const res = await C.convertMod(zip, mods[0], { JSZip, artist: 'Me' });
  const M = res.modId + '/';
  assert.strictEqual(res.engine, 'codename');
  assert.strictEqual(res.modId, 'cn-mod');
  const re = await JSZip.loadAsync(await res.zip.generateAsync({ type: 'nodebuffer' }));

  const meta = await readJson(re, M + '_polymod_meta.json');
  assert.strictEqual(meta.title, 'CN Mod');
  assert(/Codename Engine/.test(meta.description) || meta.description === 'A Codename mod');

  // --- song
  const md = await readJson(re, M + 'data/songs/cn-song/cn-song-metadata.json');
  assert.strictEqual(md.songName, 'CN Song');
  assert.deepStrictEqual(md.playData.difficulties, ['easy', 'hard']);
  assert.deepStrictEqual(md.playData.characters, { player: 'cn-bf', girlfriend: 'gf', opponent: 'cn-dad', altInstrumentals: [], playerVocals: ['cn-bf'], opponentVocals: [] });
  assert.strictEqual(md.playData.stage, 'cn-stage');
  assert.deepStrictEqual(md.timeChanges, [{ t: 0, bpm: 150 }, { t: 4000, bpm: 180 }]);

  const ch = await readJson(re, M + 'data/songs/cn-song/cn-song-chart.json');
  assert.deepStrictEqual(ch.scrollSpeed, { easy: 2.2, hard: 3 });
  assert.deepStrictEqual(ch.notes.easy, [
    { t: 0, d: 4 },               // opponent strumline -> +4
    { t: 250, d: 1 },             // player strumline
    { t: 500, d: 6, l: 250, k: 'Hurt Note' },
    { t: 750, d: 3, l: 100 },
  ]);
  const ev = (e) => ch.events.filter((x) => x.e === e);
  assert.deepStrictEqual(ev('FocusCamera').map((x) => [x.t, x.v]), [
    [0, 0],                                                              // strumline 1 = player
    [2000, { char: 1, x: 10, y: 20, ease: 'quad', easeDir: 'InOut' }],   // strumline 0 = opponent
  ]);
  assert.deepStrictEqual(ev('ScrollSpeed')[0].v, { scroll: 3, duration: 4, ease: 'linear', absolute: true });
  assert.deepStrictEqual(ev('My Event'), [{ t: 1000, e: 'My Event', v: { params: ['hello', 3] } }]);
  // A converted script defines onEvent, so events with no V-Slice equivalent are kept as pass-through events.
  assert.deepStrictEqual(ev('Camera Flash'), [{ t: 6000, e: 'Camera Flash', v: { params: [false, '#FFFFFF', 4, 'camHUD'] } }]);
  assert(re.file(M + 'songs/cn-song/Inst.ogg'));
  assert(re.file(M + 'songs/cn-song/Voices-cn-bf.ogg'), 'Voices-bf.ogg -> Voices-<player id>.ogg');

  // --- character
  const bf = await readJson(re, M + 'data/characters/cn-bf.json');
  assert.strictEqual(bf.assetPath, 'characters/cn-bf-sheet');
  assert.strictEqual(bf.scale, 2);
  assert.deepStrictEqual(bf.offsets, [0, 175]);
  assert.strictEqual(bf.flipX, true);
  assert.strictEqual(bf.danceEvery, 2);
  assert.deepStrictEqual(bf.healthIcon, { id: 'cn-bf' });
  assert.deepStrictEqual(bf.animations, [
    { name: 'idle', prefix: 'BF idle', offsets: [-5, 0], frameIndices: [2, 3, 4, 0] },
    { name: 'singLEFT', prefix: 'BF left', frameRate: 30, looped: true, offsets: [6, -7] },
  ]);
  const dad = await readJson(re, M + 'data/characters/cn-dad.json');
  assert.strictEqual(dad.singTime, 6.1);
  assert.strictEqual(dad.isPixel, true);
  assert.strictEqual(dad.danceEvery, undefined);
  assert.deepStrictEqual(dad.cameraOffsets, [5, 6]);
  assert(re.file(M + 'images/icons/icon-cn-bf.png'));
  assert(re.file(M + 'images/icons/icon-cn-dad.png'), 'icons/<id>/icon.png -> icons/icon-<id>.png');

  // --- stage
  const st = await readJson(re, M + 'data/stages/cn-stage.json');
  assert.strictEqual(st.cameraZoom, 0.8);
  assert.strictEqual(st.name, 'CN Stage');
  assert.deepStrictEqual(st.props.map((p) => [p.name, p.zIndex]), [['bg', 10], ['floor', 50], ['crowd', 60]]);
  assert.strictEqual(st.props[0].assetPath, 'stages/cn/bg');
  assert.deepStrictEqual(st.props[0].scroll, [0.9, 0.9]);
  assert.deepStrictEqual(st.props[1].scale, [1000, 40]);
  assert.strictEqual(st.props[2].danceEvery, 1);
  assert.deepStrictEqual(st.props[2].animations, [{ name: 'idle', prefix: 'Crowd Idle', looped: true }]);
  assert.strictEqual(st.props[2].startingAnimation, 'idle');
  assert.deepStrictEqual([st.characters.gf.zIndex, st.characters.dad.zIndex, st.characters.bf.zIndex], [20, 30, 40]);
  assert.deepStrictEqual(st.characters.bf.position, [880, 360]);
  assert.deepStrictEqual(st.characters.bf.cameraOffsets, [-95, -100]);
  assert.deepStrictEqual(st.characters.dad.position, [300, 500]);
  const solid = [...Object.keys(re.files)].find((n) => /stages\/cn-mod\/solid-112233ff\.png$/.test(n));
  assert(solid, 'solid box rendered as a 1x1 PNG');
  const png = await re.file(solid).async('nodebuffer');
  assert.strictEqual(png.slice(1, 4).toString(), 'PNG');

  // --- week
  const lv = await readJson(re, M + 'data/levels/cn-week.json');
  assert.strictEqual(lv.name, 'CN WEEK');
  assert.strictEqual(lv.background, '#FF8800');
  assert.deepStrictEqual(lv.songs, ['cn-song']);
  assert.strictEqual(lv.titleAsset, 'storymenu/titles/cn-week');
  assert(re.file(M + 'images/storymenu/titles/cn-week.png'));
  assert.strictEqual(lv.props.length, 3);
  assert.strictEqual(lv.props[1].assetPath, 'storymenu/props/cn-mod-empty', 'empty slot in the middle -> transparent prop');
  assert.strictEqual(lv.props[2].assetPath, 'storymenu/props/bf', 'base-game character -> V-Slice base prop');
  assert(re.file(M + 'images/storymenu/props/cn-mod-empty.png'));
  assert.deepStrictEqual(lv.props[0].offsets, [150, 90]);
  assert.strictEqual(lv.props[0].assetPath, 'menus/storymenu/characters/cn-dad');

  // --- scripts
  const song = await readText(re, M + 'scripts/songs/cn-song-mod.hxc');
  assert(/class CnModCnSongModScript extends Module/.test(song));
  assert(/super\("cn-mod-cn-song-mod", 1000, \{state: PlayState\}\)/.test(song));
  assert(/if \(__sid != "cn-song"\) return false;/.test(song), 'song scripts only run in their song');
  assert(/function __cn_create\(\)/.test(song) && /function __cn_beatHit\(curBeat:Int\)/.test(song));
  assert(/PlayState\.instance\.health = 1;/.test(song), 'health is rewritten');
  assert(/PlayState\.instance\.health \+= 0\.1;/.test(song));
  assert(/if \(curBeat % 4 == 0\)/.test(song), 'a parameter named like a global is NOT rewritten');
  assert(/override function onNoteHit\(event:HitNoteScriptEvent\)/.test(song));
  assert(/override function onSongEvent/.test(song));
  assert(!/NoteHitEvent;/.test(song.split('class ')[0]) || !/funkin\.backend/.test(song), 'Codename-only imports are dropped');
  assert(/var speedUp;/.test(song) && /speedUp = 2;/.test(song), 'top-level vars become fields initialised in __cn_main');
  const stg = await readText(re, M + 'scripts/stages/cn-stage.hxc');
  assert(/class CnModCnStageStage extends Stage/.test(stg));
  assert(/var bg;/.test(stg) && /var crowd;/.test(stg), 'stage sprites are exposed as variables');
  assert(/crowd = ps\.currentStage\.getNamedProp\("crowd"\);/.test(stg));
  assert(/__cn_postCreate\(\);/.test(stg));
  const evc = await readText(re, M + 'scripts/events/my-event.hxc');
  assert(/class CnModMyEventEvent extends SongEvent/.test(evc) && /super\("My Event"\)/.test(evc));
  const nk = await readText(re, M + 'scripts/notekinds/hurt-note.hxc');
  assert(/extends NoteKind/.test(nk) && /super\("Hurt Note"/.test(nk));
  assert(await readText(re, M + 'scripts/global/data-scripts-global.hxc'));

  // --- report
  const rep = await readText(re, M + 'CONVERSION_REPORT.md');
  assert(/Codename Engine/.test(rep));
  assert(/Character scripts/.test(rep) && /Shaders/.test(rep));
  assert(/onNoteCreation/.test(rep), 'unsupported callback listed');
  assert(re.file(M + 'music/freakyMenu.ogg'));
  assert.strictEqual(res.report.errors.length, 0, 'no errors: ' + res.report.errors.join(' | '));

  for (const f of await collectHxc(re, M)) {
    const bad = require('./lint').lint(f.text);
    assert.deepStrictEqual(bad, [], f.name + ': undeclared identifiers: ' + bad.join(', '));
  }
  const hx = checkHScript(await collectHxc(re, M));
  if (hx && !hx.error) {
    hx.results.forEach((r) => assert(r.ok, 'HScript parse error: ' + r.line));
    t.note('HScript syntax check passed for ' + hx.results.length + ' generated files');
  } else t.note('HScript syntax check skipped (see tests/hscript/README.md)');

  // Without script conversion the same event is dropped and listed in the report.
  const noScripts = await C.convertMod(zip, mods[0], { JSZip, convertScripts: false });
  const reNo = await JSZip.loadAsync(await noScripts.zip.generateAsync({ type: 'nodebuffer' }));
  const chNo = await readJson(reNo, M + 'data/songs/cn-song/cn-song-chart.json');
  assert(!chNo.events.some((e) => e.e === 'Camera Flash' || e.e === 'My Event'));
  assert(/Camera Flash/.test(await readText(reNo, M + 'CONVERSION_REPORT.md')));

  // Engine override: forcing the other engine finds nothing.
  const wrong = await C.convertMod(zip, mods[0], { JSZip, engine: 'psych' });
  assert(wrong.report.errors.some((e) => /does not look like a Psych Engine mod/.test(e)));
}

module.exports = { run, buildFakeMod };
