# HScript syntax check (optional)

`node tests/run.js` can additionally parse every generated `.hxc` with the **same HScript parser the game uses**
(Polymod's fork). It is skipped automatically when the tools below are not configured.

1. Install Haxe 4.3+ (https://haxe.org/download/).
2. Create a folder (any name, outside the project) with this structure, copying three files from
   https://github.com/FunkinCrew/polymod (`polymod/hscript/_internal/Parser.hx`, `Expr.hx` and `polymod/util/DefineUtil.hx`):

   ```
   hxmin/polymod/hscript/_internal/Parser.hx
   hxmin/polymod/hscript/_internal/Expr.hx
   hxmin/polymod/util/DefineUtil.hx
   hxmin/polymod/hscript/_internal/PolymodStaticAbstractReference.hx   <- a stub, content below
   ```

   ```haxe
   package polymod.hscript._internal;
   class PolymodStaticAbstractReference {}
   ```
3. Run the tests with:

   ```
   HAXE_BIN=/path/to/haxe HAXE_STD_PATH=/path/to/haxe/std HX_PARSER_CP=/path/to/hxmin node tests/run.js
   ```

This only validates **syntax**. It does not run the scripts, so runtime behaviour inside the game still has to be tested in the game.
