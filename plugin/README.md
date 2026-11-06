# BuildReplay plugin (Oxide / Carbon)

Records a base as it's built and saves a build log the BuildReplay viewer can play back.

**Status: first version, not yet tested on a live server.** Expect to adjust a few things after the first test build (see "First test" below).

## Install

1. Copy `BuildReplay.cs` into your server's `oxide/plugins/` folder (Carbon: `carbon/plugins/`). It loads automatically.
2. Give yourself permission, from the server console or RCON:
   ```
   oxide.grant user <your name or Steam ID> buildreplay.use
   ```
   On Carbon, use Carbon's permission command for the same `buildreplay.use` permission.

## Use

| Command | What it does |
| --- | --- |
| `/rec start` | Start recording. Everything you place, upgrade, rotate or demolish is logged. |
| `/rec stop <name> [setting:rock]` | Save the recording. `setting` is `open`, `rock`, `cave` or `cliff` (default `open`). |
| `/rec status` | Show how long you've been recording and how many events were logged. |
| `/rec cancel` | Throw the recording away. |

Example: `/rec stop Anvil Bunker setting:rock`

Logs are saved to `oxide/data/BuildReplay/` (Carbon: `carbon/data/BuildReplay/`) as `<name>-<date>.json`. Open that file in the viewer with **Load build log**, or drop it onto the page.

## What gets recorded

- Placements by the recording player: building blocks and deployables (doors, TC, boxes, furnaces, bags…).
- Upgrades and rotations of those pieces, by anyone (so teammates helping upgrade are included).
- Removal of those pieces: demolish, pick-up or destruction.
- The terrain around the base: a 72 m square heightmap centred on the first foundation.

Not yet recorded: rock and cave formations (tag the base with `setting:` for now), electrical wiring, building skins, locks.

## Config

`oxide/config/BuildReplay.json`:

| Setting | Default | Meaning |
| --- | --- | --- |
| Foundation pivot offset in metres | `-1` | Lines foundations up with walls in the viewer. Adjust if foundations look 1 m too high or low. |
| Capture terrain around the base | `true` | Saves the heightmap around the base. |
| Terrain patch size in metres | `72` | Width of the terrain square. |
| Terrain samples per side | `49` | Heightmap resolution (2–129). |
| Auto-save when the recording player disconnects | `true` | Saves an "Autosave" log instead of losing the recording. |

## First test (calibration)

On a local or test server:

1. `/rec start`, place **one foundation, one wall on its front edge, one doorway on its side edge**, upgrade the wall to stone, rotate the doorway, then `/rec stop calibration`.
2. Load `calibration-*.json` in the viewer and check:
   - **Walls sit on top of the foundation.** If there's a 1 m gap or overlap, change the foundation pivot offset.
   - **Walls sit on the foundation's edges, facing the right way.** If they're rotated 90° or mirrored, note which and we'll fix the rotation mapping.
   - **The terrain matches the ground** around the foundation.
3. Report what you see and we'll adjust the plugin or the viewer.

## Coordinates

The plugin converts Rust (Unity, left-handed) coordinates to the viewer (three.js, right-handed): positions are relative to the first foundation, z is flipped, yaw is negated. Times are seconds since `/rec start`.

---

# BuildReplayMeasure (one-time sizing tool)

`BuildReplayMeasure.cs` reads the exact sizes of every deployable and building piece straight from the game's prefabs, so the sandbox can match Rust to the centimetre. It doesn't spawn anything and you don't need to join the server.

1. Set up a local server (Oxide or Carbon) on your PC. It can be brand new and empty.
2. Copy `BuildReplayMeasure.cs` into `oxide/plugins/` (Carbon: `carbon/plugins/`).
3. In the server console window, type: `brmeasure`
4. It replies with how many items it measured and writes `oxide/data/BuildReplay/measurements.json` (Carbon: `carbon/data/BuildReplay/measurements.json`).
5. Send that file back; the sandbox's sizes are then replaced with the measured ones. You can delete the plugin and the server afterwards.

What it records for each item: its shortname, display name, craft category, prefab, overall bounds, and every collision box (centre and size in metres, relative to the item's origin). For building pieces it also records the collision boxes for each grade.

## Stability test (`brstability`, version 0.5)

Rust works out a stability percentage for every building piece and collapses anything under 5%. The socket data says how much support each connection gives, but not how Rust combines them, so this command measures it on real structures instead of guessing.

1. Use your **local test server** (not a live server). Replace `BuildReplayMeasure.cs` in `oxide/plugins/` (Carbon: `carbon/plugins/`) with this version; it reloads by itself.
2. In the server console, type: `brstability`
3. (You can also run it from the F1 console while standing in an open area in game; then it builds the tests around you.) It builds about 20 small test structures (walls stacked, floors overhanging, bridges, half walls, roofs, triangles) on flat empty spots around the map, with collapse switched off so weak pieces stay up. After about 30 seconds it records every piece's stability and the supports Rust found, deletes everything it built, and switches collapse back on.
4. When the console says `stability measured`, send `oxide/data/BuildReplay/stability.json` (Carbon: `carbon/data/BuildReplay/stability.json`).
