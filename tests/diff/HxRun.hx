import hscript.Parser;
import hscript.Interp;
import Mocks;

/**
 * Runs translated scripts in the plain hscript interpreter, with mocks of the V-Slice API.
 * Input: JSON file [{name, code}]. Output: one JSON array on the last line: [{name, ok, value, log, error}].
 */
class HxRun {
  static function toJson(v:Dynamic):Dynamic {
    if (v == null) return null;
    if (Std.isOfType(v, Array)) return [for (x in (v : Array<Dynamic>)) toJson(x)];
    if (Std.isOfType(v, String) || Std.isOfType(v, Bool) || Std.isOfType(v, Int) || Std.isOfType(v, Float)) return v;
    var o:Dynamic = {};
    for (f in Reflect.fields(v)) Reflect.setField(o, f, toJson(Reflect.field(v, f)));
    return o;
  }

  static function main() {
    var tests:Array<Dynamic> = haxe.Json.parse(sys.io.File.getContent(Sys.args()[0]));
    var results:Array<Dynamic> = [];
    for (t in tests) {
      Log.lines = [];
      MockPlayState.instance = new MockPlayState();
      var parser = new Parser();
      parser.allowTypes = true;
      parser.allowJSON = true;
      parser.allowMetadata = true;
      var interp = new Interp();
      var v = interp.variables;
      v.set('Std', Std);
      v.set('Math', Math);
      v.set('Reflect', Reflect);
      v.set('Type', Type);
      v.set('StringTools', StringTools);
      v.set('Date', Date);
      v.set('Array', Array);
      v.set('String', String);
      v.set('PlayState', MockPlayState);
      v.set('Conductor', MockConductor);
      v.set('FlxG', MockFlxG);
      v.set('FlxEase', MockEase);
      v.set('FlxTween', MockTween);
      v.set('FlxTimer', MockTimer);
      v.set('FlxColor', MockColor);
      v.set('FlxText', MockText);
      v.set('FlxTextBorderStyle', MockBorder);
      v.set('FunkinSprite', MockSprite);
      v.set('FlxSprite', MockSprite);
      v.set('FunkinSound', MockSound);
      v.set('Paths', MockPaths);
      v.set('Preferences', MockPrefs);
      v.set('trace', Reflect.makeVarArgs(function(args:Array<Dynamic>) Log.add('trace ' + args.join(' '))));
      try {
        var prog = parser.parseString(t.code);
        var res = interp.execute(prog);
        results.push({name: t.name, ok: true, value: toJson(res), log: Log.lines});
      } catch (e:Dynamic) {
        results.push({name: t.name, ok: false, error: Std.string(e), log: Log.lines});
      }
    }
    Sys.println(haxe.Json.stringify(results));
  }
}
