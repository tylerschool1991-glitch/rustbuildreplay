# BuildReplay

A web archive where Rust base builders showcase their bases as 3D replays: every foundation, wall and upgrade in the order it was built, viewable from any angle, at any speed, one step at a time.

## What's here

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
    archive.js      gallery, thumbnails, filters
    main.js         routing (#archive, #base-<slug>, #local) and file loading
build.mjs           bundles src/ into dist/
dist/
  index.html        deployable single-file site
```

## Build and run

Requires Node 18+.

```
node build.mjs
```

Then open `dist/index.html` in a browser, or deploy the `dist/` folder to Netlify, Cloudflare Pages or GitHub Pages.

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
    { "t": 75.5, "op": "remove", "id": 1 }
  ]
}
```

- `t` seconds since recording started; `pos` metres; `rot` yaw in degrees.
- `op`: `place`, `upgrade`, `remove`.
- Grades: `twigs`, `wood`, `stone`, `metal`, `toptier`.
- `terrain.heights` is row-major, `res × res`, rows along z starting at `-size/2`.
- `setting`: `open`, `rock`, `cave`, `cliff`. `source`: `recorded`, `copypaste`.

## Roadmap

1. Oxide/Carbon plugin: `/rec start`, `/rec stop`, writes this log format including nearby terrain and formations.
2. Backend (Supabase): accounts via Discord/Steam, uploads, base pages, builder profiles.
3. CopyPaste import on upload, with auto-ordering.
4. More formation models, deployables and electrical.
5. MP4 timelapse export for YouTube/TikTok.
