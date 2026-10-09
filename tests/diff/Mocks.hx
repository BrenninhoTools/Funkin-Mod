/** Minimal mocks of the V-Slice / Flixel API used by the generated compat layer. Every call is appended to Log.lines. */
class Log {
  public static var lines:Array<String> = [];
  public static function add(s:String):Void lines.push(s);
}

class MockPoint {
  public var x:Float = 0;
  public var y:Float = 0;
  public function new() {}
  public function set(?nx:Float, ?ny:Float):MockPoint {
    x = nx == null ? 0 : nx;
    y = ny == null ? x : ny;
    return this;
  }
  public function setPosition(nx:Float, ny:Float):Void {
    x = nx;
    y = ny;
  }
}

class MockAnim {
  public function new() {}
  public function addByPrefix(n:String, p:String, f:Float, l:Bool):Void Log.add('anim.addByPrefix ' + n + ' ' + p + ' ' + f + ' ' + l);
  public function addByIndices(n:String, p:String, idx:Array<Int>, s:String, f:Float, l:Bool):Void Log.add('anim.addByIndices ' + n + ' [' + idx.join(',') + ']');
  public function play(n:String, f:Bool, r:Bool, s:Int):Void Log.add('anim.play ' + n + ' force=' + f);
}

class MockSprite {
  public var x:Float = 0;
  public var y:Float = 0;
  public var width:Float = 100;
  public var height:Float = 100;
  public var alpha:Float = 1;
  public var angle:Float = 0;
  public var zIndex:Int = 0;
  public var antialiasing:Bool = true;
  public var visible:Bool = true;
  public var blend:Dynamic = null;
  public var color:Int = 0xFFFFFFFF;
  public var cameras:Array<Dynamic> = null;
  public var scale:MockPoint = new MockPoint();
  public var scrollFactor:MockPoint = new MockPoint();
  public var animation:MockAnim = new MockAnim();
  public var name:String = '';
  public function new(?x:Float, ?y:Float) {
    this.x = x == null ? 0 : x;
    this.y = y == null ? 0 : y;
  }
  public function setPosition(nx:Float, ny:Float):Void {
    x = nx;
    y = ny;
    Log.add('setPosition ' + name + ' ' + nx + ',' + ny);
  }
  public function makeGraphic(w:Int, h:Int, c:Int):MockSprite {
    Log.add('makeGraphic ' + w + 'x' + h);
    return this;
  }
  public function makeSolidColor(w:Int, h:Int, c:Int):MockSprite {
    Log.add('makeSolidColor ' + w + 'x' + h + ' ' + StringTools.hex(c, 8));
    return this;
  }
  public function updateHitbox():Void Log.add('updateHitbox ' + name);
  public function setGraphicSize(w:Float, h:Float):Void Log.add('setGraphicSize ' + w + ' ' + h);
  public function destroy():Void Log.add('destroy ' + name);
  public static function create(x:Float, y:Float, key:String):MockSprite {
    var s = new MockSprite(x, y);
    s.name = key;
    Log.add('FunkinSprite.create ' + key + ' @' + x + ',' + y);
    return s;
  }
  public static function createSparrow(x:Float, y:Float, key:String):MockSprite {
    var s = new MockSprite(x, y);
    s.name = key;
    Log.add('FunkinSprite.createSparrow ' + key);
    return s;
  }
}

class MockText extends MockSprite {
  public var text:String = '';
  public var size:Int = 8;
  public var alignment:String = 'left';
  public function new(x:Float, y:Float, w:Float, t:String, s:Int) {
    super(x, y);
    text = t;
    size = s;
    Log.add('FlxText "' + t + '"');
  }
  public function setBorderStyle(style:Dynamic, color:Int, size:Float):Void Log.add('border ' + size);
}

class MockCamera {
  public var name:String;
  public var zoom:Float = 1;
  public function new(n:String) name = n;
  public function shake(i:Float, d:Float):Void Log.add(name + '.shake ' + i + ' ' + d);
  public function flash(c:Int, d:Float, ?cb:Dynamic, ?f:Bool):Void Log.add(name + '.flash ' + d);
  public function fade(c:Int, d:Float, ?fi:Bool, ?cb:Dynamic, ?f:Bool):Void Log.add(name + '.fade ' + d);
}

class MockChar extends MockSprite {
  public var characterId:String;
  public var cameraFocusPoint:MockPoint = new MockPoint();
  public function new(id:String) {
    super(10, 20);
    characterId = id;
    name = id;
    cameraFocusPoint.set(500, 400);
  }
  public function playAnimation(n:String, restart:Bool, ignore:Bool):Void Log.add(characterId + '.playAnimation ' + n + ' restart=' + restart);
  public function dance(f:Bool):Void Log.add(characterId + '.dance');
}

class MockStage {
  public var props:Dynamic = {};
  public var bf = new MockChar('bf');
  public var dad = new MockChar('dad');
  public var gf = new MockChar('gf');
  public function new() {}
  public function getBoyfriend(?pop:Bool):MockChar return bf;
  public function getDad(?pop:Bool):MockChar return dad;
  public function getGirlfriend(?pop:Bool):MockChar return gf;
  public function getNamedProp(n:String):Dynamic return Reflect.field(props, n);
  public function add(o:Dynamic, ?above:Bool):Void Log.add('Stage.add ' + o.name + ' z=' + o.zIndex);
  public function remove(o:Dynamic, ?destroy:Bool):Void Log.add('Stage.remove ' + o.name);
  public function refresh():Void Log.add('Stage.refresh');
}

class MockStrumline {
  public var notes:Array<Dynamic> = [];
  public var prefix:String;
  public var cache:Map<Int, MockSprite> = new Map();
  public function new(p:String) prefix = p;
  public function getByIndex(i:Int):MockSprite {
    if (!cache.exists(i)) {
      var s = new MockSprite();
      s.name = prefix + i;
      cache.set(i, s);
    }
    return cache.get(i);
  }
}

class MockPlayState {
  public static var instance:MockPlayState = null;
  public var camGame = new MockCamera('camGame');
  public var camHUD = new MockCamera('camHUD');
  public var camCutscene = new MockCamera('camCutscene');
  public var health:Float = 1;
  public var songScore:Float = 0;
  public var currentStage = new MockStage();
  public var cameraFollowPoint = new MockChar('follow');
  public var opponentStrumline = new MockStrumline('opp');
  public var playerStrumline = new MockStrumline('ply');
  public var iconP1 = new MockSprite();
  public var iconP2 = new MockSprite();
  public var currentCameraZoom:Float = 0.9;
  public var isBotPlayMode:Bool = false;
  public var isPracticeMode:Bool = false;
  public var isInCountdown:Bool = true;
  public var isGameOverState:Bool = false;
  public var currentDifficulty:String = 'hard';
  public var currentStageId:String = 'mainStage';
  public var currentSong:Dynamic = {songName: 'My Song', id: 'my-song'};
  public var currentChart:Dynamic = {scrollSpeed: 2.5};
  public function new() {}
  public function add(o:Dynamic):Void Log.add('PlayState.add ' + o.name + ' z=' + o.zIndex);
  public function remove(o:Dynamic):Void Log.add('PlayState.remove ' + o.name);
  public function refresh():Void Log.add('PlayState.refresh');
  public function endSong(f:Bool):Void Log.add('PlayState.endSong');
  public function startCountdown():Void Log.add('PlayState.startCountdown');
}

class MockConductor {
  public static var instance:MockConductor = new MockConductor();
  public var songPosition:Float = 1234;
  public var currentBeat:Int = 13;
  public var currentStep:Int = 53;
  public var currentMeasure:Int = 3;
  public var currentBeatTime:Float = 13.5;
  public var currentStepTime:Float = 53.5;
  public var bpm:Float = 150;
  public var beatLengthMs:Float = 400;
  public var stepLengthMs:Float = 100;
  public var beatsPerMeasure:Float = 4;
  public function new() {}
}

class MockRandom {
  public function new() {}
  public function int(a:Int, b:Int):Int return a;
  public function float(a:Float, b:Float):Float return a;
  public function bool(c:Float):Bool return true;
}

class MockKeys {
  public var pressed:Dynamic = {SPACE: true};
  public var justPressed:Dynamic = {SPACE: true};
  public var justReleased:Dynamic = {};
  public function new() {}
}

class MockFlxG {
  public static var width:Int = 1280;
  public static var height:Int = 720;
  public static var random = new MockRandom();
  public static var keys = new MockKeys();
}

class MockEase {
  public static var linear:Dynamic = function(t:Float) return t;
  public static var quadOut:Dynamic = function(t:Float) return t;
}

class MockTween {
  public function new() {}
  public function cancel():Void Log.add('tween.cancel');
  public static function tween(obj:Dynamic, values:Dynamic, dur:Float, opts:Dynamic):MockTween {
    var parts = [];
    for (f in Reflect.fields(values)) {
      Reflect.setProperty(obj, f, Reflect.field(values, f));
      parts.push(f + '=' + Reflect.field(values, f));
    }
    Log.add('tween ' + obj.name + ' {' + parts.join(',') + '} ' + dur);
    var done = Reflect.field(opts, 'onComplete');
    if (done != null) done(null);
    return new MockTween();
  }
  public static function color(obj:Dynamic, dur:Float, from:Int, to:Int, opts:Dynamic):MockTween {
    Log.add('tween.color ' + obj.name + ' ' + StringTools.hex(to, 8));
    return new MockTween();
  }
}

class MockTimer {
  public var finished:Bool = false;
  public var loops:Int = 0;
  public var loopsLeft:Int = 0;
  public function new() {}
  public function start(time:Float, cb:Dynamic, ?loops:Int):MockTimer {
    Log.add('timer.start ' + time + ' x' + loops);
    this.loops = loops;
    loopsLeft = 0;
    finished = true;
    cb(this);
    return this;
  }
  public function cancel():Void Log.add('timer.cancel');
}

class MockColor {
  public static function fromString(s:String):Int {
    var h = StringTools.replace(s, '#', '');
    return Std.parseInt('0xFF' + h);
  }
}

class MockSound {
  public static function playOnce(path:String, vol:Float):Void Log.add('sound ' + path + ' ' + vol);
  public static function playMusic(key:String, params:Dynamic):Void Log.add('music ' + key);
}
class MockPaths {
  public static function sound(k:String):String return 'sound:' + k;
}
class MockPrefs {
  public static var downscroll:Bool = true;
  public static var flashingLights:Bool = true;
}
class MockBorder {
  public static var OUTLINE:String = 'OUTLINE';
}

class MockTallies {
  public var missed:Int = 2;
  public var combo:Int = 7;
  public var sick:Int = 1;
  public var good:Int = 0;
  public var bad:Int = 0;
  public var shit:Int = 0;
  public function new() {}
}
class MockHighscore {
  public static var tallies = new MockTallies();
}
