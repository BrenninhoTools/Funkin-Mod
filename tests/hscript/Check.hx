import polymod.hscript._internal.Parser;

/**
 * Parses .hxc files with Polymod's HScript parser (the one the game uses) and prints OK / ERR per file.
 * See tests/hscript/README.md for how to set it up. Usage: haxe -cp <parser sources> -cp . --run Check file.hxc ...
 */
class Check {
  static function main() {
    var ok = true;
    for (f in Sys.args()) {
      var src = sys.io.File.getContent(f);
      var p = new Parser();
      p.allowTypes = true;
      p.allowMetadata = true;
      p.allowJSON = true;
      try {
        p.parseModule(src, f);
        Sys.println('OK   ' + f);
      } catch (e:Dynamic) {
        ok = false;
        Sys.println('ERR  ' + f + ': ' + Std.string(e));
      }
    }
    Sys.exit(ok ? 0 : 1);
  }
}
