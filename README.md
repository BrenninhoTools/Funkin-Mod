# FNF Mod Converter

Converts **Psych Engine** mods (`.zip`) into **Friday Night Funkin' V-Slice** (Polymod) mods, right in the browser, with plain HTML + JavaScript. Nothing is uploaded anywhere.

## Usage

1. Open `index.html` in a browser (double-click; no server and no internet needed).
2. Drop the Psych Engine mod `.zip`. The page previews what it found (songs, characters, stages, weeks, scripts).
3. Adjust name, folder and author if you want, then click **Convert mod**.
4. Download the zip, extract the folder into the game's `mods/` folder and restart the game.

## What gets converted

| Psych Engine | V-Slice |
|---|---|
| `pack.json`, `pack.png` | `_polymod_meta.json`, `_polymod_icon.png` |
| `data/<song>/<song>[-difficulty].json` | `data/songs/<id>/<id>-metadata.json` + `-chart.json` |
| `songs/<song>/Inst.ogg`, `Voices*.ogg` | `songs/<id>/Inst.ogg`, `Voices[-<character>].ogg` |
| `characters/*.json` | `data/characters/*.json` (offsets divided by the scale) |
| `images/icons/<id>.png` | `images/icons/icon-<id>.png` |
| `stages/*.json` + `stages/*.lua` | `data/stages/*.json` (scenery read from Lua, best effort) |
| `weeks/*.json` + `images/menucharacters/*.json` | `data/levels/*.json` |
| `images/`, `music/`, `sounds/`, `fonts/`, `videos/` | copied as-is |

Supported events: `Camera Follow Pos`, `Play Animation`, `Hey!`, `Change Scroll Speed`, plus the per-section camera (`mustHitSection` / `gfSection`) and BPM changes.

## What is NOT converted

Lua/HScript scripts, custom events and note types, shaders, note skins, `Change Character`, `Screen Shake`, etc. Everything skipped is listed in `CONVERSION_REPORT.md` (inside the output zip) and on the result screen.

Some values are approximations: character positions in stages (corner -> feet) and camera offsets.

## Project layout

```
index.html            UI
css/style.css         styles (light/dark)
js/app.js             UI logic
js/converter.js       mod detection + orchestration
js/songs.js           charts, events, audio
js/characters.js      characters and icons
js/stages.js          stages (+ best-effort Lua scenery)
js/weeks.js           weeks -> levels
js/util.js            slugs, virtual file system, output writer, report
js/vendor/jszip.min.js
tests/run.js          end-to-end test (Node)
```

## Tests

```
node tests/run.js
```

Builds a fake Psych mod, converts it and validates the generated files.

## References in the Funkin source code

- `source/funkin/data/song/SongData.hx`, `importer/FNFLegacyImporter.hx`: chart format and strumline swap
- `source/funkin/data/character/CharacterData.hx`, `animation/AnimationData.hx`
- `source/funkin/data/stage/StageData.hx`, `play/stage/Stage.hx`: character positions (feet, not corner)
- `source/funkin/data/story/level/LevelData.hx`, `ui/story/Level.hx`
- `source/funkin/play/event/*.hx`: event schemas
- `source/funkin/modding/PolymodHandler.hx`: accepted `api_version` (`>=0.8.0 <0.9.0`)
