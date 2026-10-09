// Converted Codename scripts, executed against the V-Slice mocks. `file` is the generated .hxc inside the converted zip;
// `driver` runs after the class body (turned into plain script code); the last expression is the value to check.
module.exports = [
  {
    name: 'song script: lazy init, note-hit adapter, beat/update hooks, health rewrite',
    file: 'scripts/songs/cn-song-mod.hxc',
    driver: `
      PlayState.instance.currentSong = {songName: 'CN', id: 'cn-song'};
      var ok = __ensure();
      var ev = {note: {noteData: {data: 2, kind: null, getStrumlineIndex: function() { return 0; }}}, healthChange: 0.1, judgement: 'sick', score: 350, cancelled: false, cancel: function() { }};
      onNoteHit(ev);
      onBeatHit({beat: 4});
      onUpdate({elapsed: 0.016});
      [ok, ev.healthChange, PlayState.instance.health, PlayState.instance.camGame.zoom, speedUp];
    `,
    value: [true, 0.2, 1.1, 1.03, 2],
    log: ['makeGraphic 1280x720', 'PlayState.add  z=0'],
  },
  {
    name: 'song script does nothing in other songs',
    file: 'scripts/songs/cn-song-mod.hxc',
    driver: `
      PlayState.instance.currentSong = {songName: 'Other', id: 'other-song'};
      var ok = __ensure();
      onBeatHit({beat: 4});
      [ok, PlayState.instance.camGame.zoom];
    `,
    value: [false, 1],
    log: [],
  },
  {
    name: 'stage script: sprites exposed as variables, create + postCreate + beatHit',
    file: 'scripts/stages/cn-stage.hxc',
    driver: `
      var crowd = new FlxSprite();
      Reflect.setField(PlayState.instance.currentStage.props, 'crowd', crowd);
      onCreate(null);
      onCountdownStart(null);
      onBeatHit({beat: 1});
      [crowd.alpha, crowd.angle, PlayState.instance.currentStage.getDad().x];
    `,
    value: [0.5, 1, 20],
    log: [],
  },
  {
    name: 'custom event script receives Codename-style params',
    file: 'scripts/events/my-event.hxc',
    driver: `
      handleEvent({value: {params: ['hello', 3]}, time: 5});
      1;
    `,
    value: 1,
    log: ['trace [hello,3]'],
  },
  {
    name: 'custom note type: healthGain is written back to the V-Slice event',
    file: 'scripts/notekinds/hurt-note.hxc',
    driver: `
      var ev = {note: {noteData: {data: 1, kind: 'Hurt Note', getStrumlineIndex: function() { return 0; }}}, healthChange: 0.1, judgement: 'sick', score: 0, cancelled: false, cancel: function() { }};
      onNoteHit(ev);
      ev.healthChange;
    `,
    value: -0.5,
    log: [],
  },
];
