// Converted Psych scripts (the song/global/stage/event/note-kind classes), executed against the V-Slice mocks.
module.exports = [
  {
    name: 'song class: onCreate builds sprites, tweens notes, hides HUD objects',
    file: 'scripts/songs/test-song.hxc',
    driver: `
      onCreate(null);
      [PlayState.instance.opponentStrumline.getByIndex(2).alpha, Reflect.field(__luaSprites, 'flash').alpha, Reflect.field(__luaSprites, 'flash').cameras[0].name];
    `,
    value: [0.3, 0, 'camCutscene'],
    logIncludes: ['makeSolidColor 1280x720 FFFFFFFF', 'PlayState.add  z=400', 'FlxText "Song: My Song | bpm 150"', 'tween opp0 {alpha=0.3} 1'],
  },
  {
    name: 'song class: Function_Stop in onStartCountdown cancels it, the timer callback restarts it',
    file: 'scripts/songs/test-song.hxc',
    driver: `
      onCreate(null);
      var cancelled = false;
      onCountdownStart({cancel: function() { cancelled = true; }, step: 'BEFORE'});
      [cancelled];
    `,
    value: [true],
    logIncludes: ['timer.start 1.5 x1', 'PlayState.startCountdown'],
  },
  {
    name: 'song class: note hit routes to goodNoteHit with the note kind',
    file: 'scripts/songs/test-song.hxc',
    driver: `
      onCreate(null);
      PlayState.instance.health = 1;
      onNoteHit({note: {noteData: {data: 3, kind: 'Hurt Note', getStrumlineIndex: function() { return 0; }}}});
      onNoteHit({note: {noteData: {data: 3, kind: 'Hurt Note', getStrumlineIndex: function() { return 1; }}}});
      PlayState.instance.health;
    `,
    value: 0.5,
    logIncludes: [],
  },
  {
    name: 'song class: pass-through chart event reaches onEvent (name + both values)',
    file: 'scripts/songs/test-song.hxc',
    driver: `
      onCreate(null);
      onSongEvent({eventData: {eventKind: 'Screen Shake', value: {value1: '0.5, 0.05', value2: ''}}});
      onSongEvent({eventData: {eventKind: 'FocusCamera', value: 1}});
      1;
    `,
    value: 1,
    logIncludes: ['camGame.shake 0.25 0.2'],
    logExcludes: [],
  },
  {
    name: 'custom event class: handleEvent forwards value1/value2 to onEvent',
    file: 'scripts/events/screen-shake.hxc',
    driver: `
      handleEvent({value: {value1: '0.3', value2: ''}, time: 10});
      1;
    `,
    value: 1,
    logIncludes: ['camGame.shake 0.3 0.2'],
  },
  {
    name: 'note kind class: only its own hit logic runs',
    file: 'scripts/notekinds/hurt-note.hxc',
    prelude: "var noteKind = 'Hurt Note'; // inherited from NoteKind in the game",
    driver: `
      PlayState.instance.health = 1;
      onNoteHit({note: {noteData: {data: 0, kind: 'Hurt Note', getStrumlineIndex: function() { return 0; }}}});
      PlayState.instance.health;
    `,
    value: 0.6,
    logIncludes: [],
  },
  {
    name: 'stage class: dynamic Lua runs after the static props exist',
    file: 'scripts/stages/coolstage.hxc',
    driver: `
      var crowd = new FlxSprite();
      Reflect.setField(PlayState.instance.currentStage.props, 'crowd', crowd);
      onCreate(null);
      Conductor.instance.currentBeat = 2;
      onBeatHit({beat: 2});
      var a = crowd.angle;
      Conductor.instance.currentBeat = 3;
      onBeatHit({beat: 3});
      [a, crowd.angle];
    `,
    value: [2, -2],
    logIncludes: [],
  },
  {
    name: 'global module: lazily initialised per PlayState, runs onUpdate',
    file: 'scripts/global/global.hxc',
    driver: `
      var ok = __ensure();
      onUpdate({elapsed: 0.016});
      [ok, PlayState.instance.songScore];
    `,
    value: [true, 10],
    logIncludes: [],
  },
];
