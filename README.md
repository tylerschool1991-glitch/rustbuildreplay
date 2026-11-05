# BuildReplay

A web archive where Rust base builders showcase their bases as 3D replays: every foundation, wall and upgrade in the order it was built, viewable from any angle, at any speed, one step at a time.

## What's here

- **Sandbox** – build a base in the browser on randomized, never-flat terrain, with Rust-style controls (hotbar: 1 Building Plan, 2 Hammer, 3 Deployable; hold right-click for the radial wheel; deployables down the right edge of the screen) and Rust’s building pieces: square and triangle foundations and floors, foundation steps, all wall types, floor frames, U/L/spiral/triangle-spiral stairs, ramps, roofs and triangle roofs. Pieces snap on shared 3 m edges like in Rust, with its support rules (walls need foundations or floors, floors need walls, unsupported pieces collapse). Place, upgrade, rotate, demolish, undo; saved in your browser; one click to watch it as a replay.
- **Archive** – gallery of bases with terrain filters (open ground, rock, cave, cliff) and group size.
- **Base page** – the replay viewer: timeline scrubber, step forward/back, 1×–64× speed, clean replay (hides demolished mistakes), skip idle time, X-ray walls, see-through rock, floor cutaways, clickable build log.
- **Terrain and formations** – heightmap terrain plus stand-in models for anvil rocks, cliffs and caves.
- **Auto-ordering** – turns a finished base (e.g. a CopyPaste save) into a plausible build order.
- **Load your own log** – open or drop a `.json` build log; nothing is uploaded.

The four bases in the archive are made-up examples.

## Project layout

```
src/
  index.html        page markup (head above <!--BODY-->, body below)
  styles.css
  js/
    core.js         Rust vocabulary (grades, prefabs), helpers, replay state
    world.js        Three.js materials, piece models, terrain, rock formations
    autoorder.js    finished base -> build log
    samples.js      example bases
    viewer.js       replay viewer
    builder.js      sandbox builder (grid, snapping, support rules, undo)
    archive.js      gallery, thumbnails, filters
    main.js         routing (#archive, #build, #base-<slug>, #local) and file loading
build.mjs           bundles src/ into dist/
dist/
  index.html        deployable single-file site
plugin/
  BuildReplay.cs    Oxide/Carbon server plugin that records builds (see plugin/README.md)
```

## Build and run

Requires Node 18+.

```
node build.mjs
```

Then open `dist/index.html` in a browser.

The live site is served by GitHub Pages from the `docs/` folder (Settings → Pages → Deploy from a branch → `main` / `/docs`): https://tylerschool1991-glitch.github.io/rustbuildreplay/. Run `node build.mjs` and commit `docs/` to update it.

## Build log format

```json
{
  "name": "My Bunker Base",
  "setting": "rock",
  "source": "recorded",
  "terrain": { "size": 72, "res": 49, "heights": [0, 0.1, "..."] },
  "features": [{ "type": "rock.anvil", "pos": [0, 0, 0], "rot": 0 }],
  "events": [
    { "t": 4.2, "op": "place", "id": 1, "prefab": "foundation", "grade": "twigs", "pos": [0, 0, 0], "rot": 0 },
    { "t": 61.0, "op": "upgrade", "id": 1, "grade": "stone" },
    { "t": 64.3, "op": "rotate", "id": 1, "rot": 90 },
    { "t": 75.5, "op": "remove", "id": 1 }
  ]
}
```

- `t` seconds since recording started; `pos` metres; `rot` yaw in degrees.
- `op`: `place`, `upgrade`, `rotate`, `remove`.
- Grades: `twigs`, `wood`, `stone`, `metal`, `toptier`.
- `terrain.heights` is row-major, `res × res`, rows along z starting at `-size/2`.
- `setting`: `open`, `rock`, `cave`, `cliff`. `source`: `recorded`, `copypaste`, `sandbox`.

## Roadmap

1. ~~Sandbox builder~~ – squares and triangles on shared 3 m edges with Rust support rules; every build becomes a replay.
2. Walk mode: drop in a Rust-sized player to test doorways, stairs and crouch spots.
3. Peek checker: highlight sightlines into the base from outside.
4. Oxide/Carbon plugin (shelved, in `plugin/`) for importing real builds.
5. Backend (Supabase): accounts via Discord/Steam, uploads, base pages, builder profiles.
6. CopyPaste import on upload, with auto-ordering.
7. More formation models, deployables and electrical.
8. MP4 timelapse export for YouTube/TikTok.
