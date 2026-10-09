// Psych API behaviour, run through the real hscript interpreter against mocks of the V-Slice API (tests/diff/Mocks.hx).
// `main()` is called after lua_refresh(); `log` is the exact list of mock calls expected.
module.exports = [
  {
    name: 'sprite lifecycle',
    lua: `function main()
      makeLuaSprite('flash', 'myimg', 5, 6)
      makeGraphic('flash', 100, 50, 'FF0000')
      setObjectCamera('flash', 'camHUD')
      setProperty('flash.alpha', 0.25)
      scaleObject('flash', 2, 3)
      setScrollFactor('flash', 0, 0)
      addLuaSprite('flash', true)
      removeLuaSprite('flash', false)
      return getProperty('flash.alpha')
    end`,
    value: 0.25,
    log: ['FunkinSprite.create myimg @5,6', 'makeSolidColor 100x50 FFFF0000', 'updateHitbox myimg', 'PlayState.add myimg z=400', 'PlayState.refresh', 'PlayState.remove myimg'],
  },
  {
    name: 'property paths (characters, health, cameras, strums)',
    lua: `function main()
      setProperty('boyfriend.x', 123)
      setProperty('health', 1.75)
      setProperty('camGame.zoom', 1.2)
      setProperty('playerStrums[1].alpha', 0.5)
      setProperty('defaultCamZoom', 0.7)
      return getProperty('boyfriend.x') + getProperty('health') + getProperty('playerStrums[1].alpha') + getProperty('camGame.zoom') + getProperty('defaultCamZoom')
    end`,
    value: 123 + 1.75 + 0.5 + 1.2 + 0.7,
    log: [],
  },
  {
    name: 'unknown object paths are nil, not errors',
    lua: `function main() setProperty('nothing.x', 5) if getProperty('nothing.x') == nil then return 1 end return 0 end`,
    value: 1,
    log: [],
  },
  {
    name: 'tweens, note tweens, timers and their completion callbacks',
    lua: `local fired = ''
    function onTweenCompleted(tag) fired = fired .. 'T:' .. tag .. ';' end
    function onTimerCompleted(tag, loops, left) fired = fired .. 'R:' .. tag .. ';' end
    function main()
      makeLuaSprite('s', 'img', 0, 0)
      doTweenAlpha('ta', 's', 0.5, 1, 'quadOut')
      noteTweenX('nx', 5, 300, 2, 'linear')
      runTimer('rt', 3, 2)
      cancelTween('missing')
      return fired
    end`,
    value: 'T:ta;T:nx;R:rt;',
    log: ['FunkinSprite.create img @0,0', 'tween img {alpha=0.5} 1', 'tween ply1 {x=300} 2', 'timer.start 3 x2'],
  },
  {
    name: 'camera, character and audio helpers',
    lua: `function main()
      cameraShake('game', 0.02, 0.4)
      cameraFlash('hud', 'FFFFFF', 0.3)
      cameraFade('camOther', '000000', 1)
      characterPlayAnim('dad', 'singUP', true)
      playSound('hit', 0.5)
      cameraSetTarget('dad')
      return getCharacterX('boyfriend') + getHealth() * 10
    end`,
    value: 20,
    log: ['camGame.shake 0.02 0.4', 'camHUD.flash 0.3', 'camCutscene.fade 1', 'dad.playAnimation singUP restart=true', 'sound sound:hit 0.5', 'setPosition follow 500,400'],
  },
  {
    name: 'text objects',
    lua: `function main()
      makeLuaText('t', 'hi', 200, 1, 2)
      setTextString('t', 'bye ' .. songName)
      setTextSize('t', 30)
      addLuaText('t')
      return getTextString('t')
    end`,
    value: 'bye My Song',
    log: ['FlxText "hi"', 'PlayState.add  z=0'],
  },
  {
    name: 'Psych globals are refreshed from the game state',
    lua: `function main() return curBeat * 1000 + curStep + bpm / 10 + (downscroll and 100000 or 0) + (difficulty == 2 and 1000000 or 0) end`,
    value: 13 * 1000 + 53 + 15 + 100000 + 1000000,
    log: [],
  },
  {
    name: 'health helpers and score',
    lua: `function main() setHealth(0.5) addHealth(0.25) addScore(350) return getHealth() * 1000 + score end`,
    value: 750 + 0,
    log: [],
  },
  {
    name: 'script variables (setVar/getVar) and random helpers',
    lua: `function main() setVar('k', 7) return getVar('k') + getRandomInt(3, 9) end`,
    value: 10,
    log: [],
  },
];
