# FNF Mod Converter

Converts **Psych Engine** and **Codename Engine** mods (`.zip`) into **Friday Night Funkin' V-Slice** (Polymod) mods, scripts included, right in the browser. Plain HTML + JavaScript; nothing is uploaded anywhere.

## Usage

1. Open `index.html` in a browser (double-click; no server and no internet needed).
2. Drop the mod `.zip`. The page detects the engine (you can override it) and previews what it found.
3. Adjust name, folder and author if you want, keep **Convert scripts** on, then click **Convert mod**.
4. Download the zip, extract the folder into the game's `mods/` folder and restart the game.

> The generated scripts are a **best-effort port**. They parse with the same HScript parser the game uses and run correctly against mocks of the V-Slice API (see Tests), but they have not been played inside the real game. Review `scripts/` and `CONVERSION_REPORT.md` before shipping a mod.

## What gets converted

| | Psych Engine | Codename Engine | V-Slice output |
|---|---|---|---|
| Mod info | `pack.json`, `pack.png` | `data/config/modpack.ini` | `_polymod_meta.json`, `_polymod_icon.png` |
| Songs | `data/<song>/<song>[-diff].json` | `songs/<song>/meta.json` + `charts/<diff>.json` | `data/songs/<id>/<id>-metadata.json` + `-chart.json` |
| Audio | `songs/<song>/Inst.ogg`, `Voices*.ogg` | `songs/<song>/song/Inst.ogg`, `Voices*.ogg` | `songs/<id>/Inst.ogg`, `Voices[-<char>].ogg` |
| Characters | `characters/*.json` | `data/characters/*.xml` | `data/characters/*.json` (+ `icons/icon-<id>.png`) |
| Stages | `stages/*.json` + Lua scenery | `data/stages/*.xml` (sprites, boxes, character slots) | `data/stages/*.json` |
| Weeks | `weeks/*.json` + `menucharacters` | `data/weeks/weeks/*.xml` + `weeks/characters` | `data/levels/*.json` |
| Media | `images/ music/ sounds/ fonts/ videos/` | same | copied as-is |

Charts: strumline swap, sustains, note kinds, BPM / time-signature changes, scroll speed, per-section camera and the usual camera / animation events. Songs outside any week are grouped in a hidden level so they show up in Freeplay.

### Scripts

| Source | Becomes |
|---|---|
| Psych `scripts/*.lua` | `Module` (runs in every song), `scripts/global/` |
| Psych `data/<song>/*.lua` | `class ... extends Song`, `scripts/songs/` |
| Psych `stages/<stage>.lua` | static props in the stage JSON + `class ... extends Stage` for the dynamic part |
| Psych `custom_events/*.lua` | `class ... extends SongEvent` (chart events are kept as pass-through events) |
| Psych `custom_notetypes/*.lua` | `class ... extends NoteKind` |
| Codename `songs/<song>/scripts/*.hx` | `Module` that only runs in that song |
| Codename `data/scripts/*.hx`, `data/charts/*.hx` | global `Module` |
| Codename `data/stages/<id>.hx` | `class ... extends Stage` (stage sprites are exposed as variables) |
| Codename `data/events/*.hx`, `data/notes/*.hx` | `SongEvent` / `NoteKind` classes |

- **Lua -> HScript** uses a real Lua parser (`js/lua.js`) and a code generator (`js/psych-lua.js`). Lua tables, 1-based indexing, truthiness, floor-modulo, string concatenation, loops and closures are translated; the Psych API (`makeLuaSprite`, `doTweenX`, `setProperty`, timers, cameras, ...) is re-implemented on top of the V-Slice `PlayState` in a compat layer (`js/psych-shim.js`) that is pasted into each generated class, only with the functions that script uses.
- **Codename HScript -> V-Slice HScript** (`js/codename-hx.js`) splits the flat script into fields / functions / statements, wraps it in a class, dispatches `create`, `postCreate`, `update`, `beatHit`, `stepHit`, `onPlayerHit`, `onDadHit`, `onEvent`, ... from the matching V-Slice events, and rewrites the common globals (`health`, `Conductor.*`, `boyfriend`, `dad`, `camGame`, `strumLines`, `add()`, ...).

## What is NOT converted

Anything with no V-Slice equivalent is listed in `CONVERSION_REPORT.md` (inside the output zip) and on the result screen:

- Lua `runHaxeCode`, shaders, custom substates / dialogue, file I/O, Lua string *patterns* (plain-text find/replace only), character scripts, note skins / splashes, Psych `Change Character`, Codename states, cutscenes, extra strumlines (V-Slice has two), key counts other than 4, chart variants, animate-atlas characters.
- Codename APIs without an equivalent (`Options`, `CoolUtil`, `importScript`, `CustomShader`, `onNoteCreation`, `onStrumCreation`, ...) are reported per script.
- A few values are approximations: character positions in stages (corner -> feet), camera offsets, and menu-character offsets.

## Project layout

```
index.html            UI                       css/style.css   styles (light/dark)
js/app.js             UI logic
js/converter.js       mod detection, engine runners, shared steps
js/util.js            slugs, virtual file system, output writer, report
js/songs.js           Psych charts, events, audio
js/characters.js      Psych characters, Sparrow atlas reader
js/stages.js          Psych stages (+ best-effort Lua scenery)
js/weeks.js           Psych weeks -> levels, base-game story props
js/codename.js        Codename data (charts, XML characters / stages / weeks)
js/xml.js             tiny XML parser + 1x1 PNG writer
js/lua.js             Lua lexer + parser
js/psych-lua.js       Lua AST -> HScript
js/psych-shim.js      Psych Lua API on top of V-Slice (HScript snippets)
js/script-gen.js      Song / Module / Stage / SongEvent / NoteKind class builders
js/psych-scripts.js   Psych script discovery and output
js/codename-hx.js     Codename HScript -> V-Slice HScript
js/vendor/jszip.min.js
tests/                see below
```

## Tests

```
node tests/run.js
```

Always runs: the Lua translator, an end-to-end Psych mod (data + scripts) and an end-to-end Codename mod, plus an identifier lint of every generated `.hxc` (and of the whole compat layer).

Optional, when the tools are available (`tests/hscript/README.md` explains the setup):

- **Parse check**: every generated `.hxc` is parsed with Polymod's own HScript parser (the one the game uses).
- **Semantic tests** (`HAXE_BIN`, `HX_HSCRIPT_CP`, `npm i fengari`): 55 Lua programs are run in real Lua (fengari) and as translated HScript in the `hscript` interpreter, and must give the same result; 9 Psych API scenarios, 8 converted Psych classes and 5 converted Codename scripts are executed against mocks of the V-Slice API.

## References in the source code

- **Funkin** (target): `source/funkin/data/song/SongData.hx`, `importer/FNFLegacyImporter.hx`, `data/character/CharacterData.hx`, `data/stage/StageData.hx`, `play/stage/Stage.hx`, `data/story/level/LevelData.hx`, `modding/module/Module.hx`, `play/song/Song.hx`, `play/event/*.hx`, `play/notes/notekind/NoteKind.hx`, `modding/PolymodHandler.hx` (`api_version >=0.8.0 <0.9.0`).
- **Psych Engine**: `source/psychlua/FunkinLua.hx` (Lua API and callbacks), `states/PlayState.hx`, `backend/Conductor.hx`.
- **Codename Engine**: `source/funkin/backend/chart/*.hx` (chart format), `game/Character.hx`, `game/Stage.hx`, `backend/week/Week.hx`, `backend/utils/XMLUtil.hx`, `game/PlayState.hx` (script callbacks).
