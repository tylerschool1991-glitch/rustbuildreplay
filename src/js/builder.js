// The sandbox: build a base in the browser with Rust's building pieces on randomized, never-flat terrain.
// Snapping works on shared edges, so squares and triangles (3 m sides) fit together the way they do in Rust.
// Every action is logged in the same event format the replay viewer plays.
const Builder = (function () {
  const SQ3 = Math.sqrt(3);
  const SHAPE = {
    "foundation": "sq", "foundation.triangle": "tri",
    "floor": "sq", "floor.frame": "sq", "floor.triangle": "tri", "floor.triangle.frame": "tri",
    "roof": "sq", "roof.triangle": "tri",
    "block.stair.ushape": "sq", "block.stair.lshape": "sq", "block.stair.spiral": "sq", "ramp": "sq",
    "block.stair.spiral.triangle": "tri"
  };
  const APOTHEM = { sq: 1.5, tri: SQ3 / 2 };
  const TURN = { sq: 90, tri: 120 };
  const SOLID_FLOORS = new Set(["floor", "floor.triangle"]);
  const FULL_WALLS = new Set(["wall", "wall.doorway", "wall.window", "wall.frame"]);
  // Building plan wheel: inner ring holds the everyday pieces, outer ring the rest.
  const PLAN_INNER = ["foundation", "foundation.triangle", "wall", "wall.doorway", "wall.window", "floor", "floor.triangle", "block.stair.ushape", "roof", "roof.triangle"];
  const PLAN_OUTER = ["foundation.steps", "wall.half", "wall.low", "wall.frame", "floor.frame", "floor.triangle.frame", "block.stair.lshape", "block.stair.spiral", "block.stair.spiral.triangle", "ramp"];
  const DEPLOYABLES = ["door.hinged.metal", "cupboard.tool.deployed", "box.wooden.large", "furnace", "sleepingbag_leather_deployed"];
  const WHEEL_LABEL = {
    "foundation": "Foundation", "foundation.triangle": "Triangle|Foundation", "foundation.steps": "Foundation|Steps",
    "wall": "Wall", "wall.doorway": "Doorway", "wall.window": "Window", "wall.half": "Half Wall", "wall.low": "Low Wall", "wall.frame": "Wall Frame",
    "floor": "Floor", "floor.triangle": "Triangle|Floor", "floor.frame": "Floor|Frame", "floor.triangle.frame": "Triangle|Floor Frame",
    "block.stair.ushape": "U Stairs", "block.stair.lshape": "L Stairs", "block.stair.spiral": "Spiral|Stairs", "block.stair.spiral.triangle": "Triangle|Spiral", "ramp": "Ramp",
    "roof": "Roof", "roof.triangle": "Triangle|Roof",
    "door.hinged.metal": "Sheet Metal|Door", "cupboard.tool.deployed": "Tool|Cupboard", "box.wooden.large": "Large|Wood Box", "furnace": "Furnace", "sleepingbag_leather_deployed": "Sleeping|Bag"
  };
  const HAMMER = [
    { id: "wood", label: "Wood" }, { id: "stone", label: "Stone" }, { id: "metal", label: "Sheet|Metal" }, { id: "toptier", label: "Armored" },
    { id: "rotate", label: "Rotate" }, { id: "demolish", label: "Demolish" }
  ];
  const SLOTS = ["plan", "hammer", "deploy", "tape"];
  // Deployable footprints in metres (width along local x, depth along local z). Approximate; to be checked in-game.
  const FOOTPRINT = {
    "cupboard.tool.deployed": [0.96, 0.6],
    "box.wooden.large": [1.3, 0.75],
    "furnace": [0.85, 0.85],
    "sleepingbag_leather_deployed": [0.8, 1.9]
  };
  const STORE_KEY = "buildreplay.sandbox.v3";
  const MAX_LEVEL = 5;
  const FOUNDATION_DEPTH = 4; // the foundation model reaches 4 m below its top
  const SNAP_PX = 85;         // how close (in screen pixels) the pointer must be to a snap point
  const REASON = {
    FS: "Foundation steps go on the outer edge of a foundation",
    W: "Walls need a foundation or floor edge under them, or a wall below",
    FL: "Floors need a full wall underneath on at least one edge",
    RF: "Roofs need a full wall underneath on at least one edge",
    S: "Stairs need a foundation or solid floor of the same shape",
    D: "Doors go in a doorway",
    X: "Place it on a foundation or solid floor, clear of stairs"
  };
  const NO_SNAP = {
    F: "Point at the ground",
    FS: "Point at the outer edge of a foundation",
    W: "Point at the edge of a foundation or floor",
    FL: "Point above a room with walls, or next to another floor",
    RF: "Point above a room with walls",
    S: "Point at a foundation or solid floor of the same shape",
    D: "Point at a doorway",
    X: "Point at a foundation or solid floor on this level"
  };

  const kindOf = prefab =>
    prefab === "foundation" || prefab === "foundation.triangle" ? "F" :
    prefab === "foundation.steps" ? "FS" :
    prefab === "roof" || prefab === "roof.triangle" ? "RF" :
    SHAPE[prefab] && prefab.indexOf("floor") === 0 ? "FL" :
    SHAPE[prefab] ? "S" :
    WALLS.has(prefab) ? "W" :
    prefab === "door.hinged.metal" ? "D" : "X";

  // ---------- Geometry ----------
  const rad = d => d * Math.PI / 180;
  const cosd = d => Math.cos(rad(d)), sind = d => Math.sin(rad(d));
  const norm = d => { const r = ((d % 360) + 360) % 360; return Math.round(r * 1000) / 1000 % 360; };
  const q = v => Math.round(v * 20);
  // Every surface sits at an absolute height H: a foundation's top, or a floor's top. Keys use H, so
  // bases on different ground heights never collide.
  const Hof = p => R2(p.by + 1 + 3 * p.L);
  const edgeKey = (e, H) => "E:" + q(e.mx) + ":" + q(e.mz) + ":" + q(H);
  const fpKey = (cx, cz, H) => "P:" + q(cx) + ":" + q(cz) + ":" + q(H);
  const wallRot = a => norm(90 - a);
  const sameH = (a, b) => Math.abs(a - b) < 0.1;

  // theta: footprint orientation (degrees, measured from +x toward +z). Square normals at theta+0/90/180/270,
  // triangle normals at theta+90/210/330. Meshes use rotation.y = -theta.
  function shapeVerts(shape, cx, cz, theta) {
    const pts = shape === "sq" ? [45, 135, 225, 315].map(a => [a, 1.5 * Math.SQRT2]) : [270, 30, 150].map(a => [a, SQ3]);
    return pts.map(([a, d]) => [cx + d * cosd(a + theta), cz + d * sind(a + theta)]);
  }
  function edgesOf(fp) {
    const ap = APOTHEM[fp.shape];
    return (fp.shape === "sq" ? [0, 90, 180, 270] : [90, 210, 330]).map(b => {
      const a = norm(b + fp.theta);
      return { a, nx: cosd(a), nz: sind(a), mx: fp.cx + ap * cosd(a), mz: fp.cz + ap * sind(a) };
    });
  }
  function attach(e, shape) {
    const ap = APOTHEM[shape];
    return { shape, cx: e.mx + e.nx * ap, cz: e.mz + e.nz * ap, theta: norm(shape === "sq" ? e.a + 180 : e.a + 90) };
  }
  function rectPoly(cx, cz, w, d, phi) {
    const c = cosd(phi), s = sind(phi);
    return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
  }
  function shrink(poly, s) {
    const cx = poly.reduce((a, v) => a + v[0], 0) / poly.length, cz = poly.reduce((a, v) => a + v[1], 0) / poly.length;
    return poly.map(([x, z]) => { const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1; return [x - dx / l * s, z - dz / l * s]; });
  }
  function polyOverlap(A, B) {
    for (const P of [A, B]) {
      for (let i = 0; i < P.length; i++) {
        const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % P.length];
        const nx = z2 - z1, nz = -(x2 - x1);
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        A.forEach(([x, z]) => { const d = x * nx + z * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); });
        B.forEach(([x, z]) => { const d = x * nx + z * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); });
        if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return false;
      }
    }
    return true;
  }
  function pointInPoly(x, z, P) {
    let sign = 0;
    for (let i = 0; i < P.length; i++) {
      const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % P.length];
      const c = (x2 - x1) * (z - z1) - (z2 - z1) * (x - x1);
      if (Math.abs(c) < 1e-9) continue;
      const s = c > 0 ? 1 : -1;
      if (sign === 0) sign = s; else if (s !== sign) return false;
    }
    return true;
  }

  // ---------- Terrain ----------
  // Seeded rolling hills with smaller bumps on top: like Rust, there's never a truly flat spot.
  const TERRAIN_SIZE = 200, TERRAIN_RES = 101;
  let terrain = null, terrainMesh = null;
  function valueNoise(seed) {
    const r = rng(seed);
    const perm = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    const val = Array.from({ length: 256 }, () => r());
    const h = (a, b) => val[perm[(perm[a & 255] + b) & 255]];
    const sm = t => t * t * (3 - 2 * t);
    return (x, z) => {
      const xi = Math.floor(x), zi = Math.floor(z), xf = sm(x - xi), zf = sm(z - zi);
      const a = h(xi, zi), b = h(xi + 1, zi), c = h(xi, zi + 1), d = h(xi + 1, zi + 1);
      return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
    };
  }
  function fbm(n, x, z, oct) {
    let amp = 1, f = 1, sum = 0, tot = 0;
    for (let i = 0; i < oct; i++) { sum += amp * n(x * f, z * f); tot += amp; amp *= 0.5; f *= 2.03; }
    return sum / tot;
  }
  function genTerrain(seed) {
    const n1 = valueNoise(seed), n2 = valueNoise(seed + 101), n3 = valueNoise(seed + 202);
    const step = TERRAIN_SIZE / (TERRAIN_RES - 1), half = TERRAIN_SIZE / 2;
    const raw = [];
    let min = Infinity;
    for (let i = 0; i < TERRAIN_RES; i++) {
      const z = -half + i * step;
      for (let j = 0; j < TERRAIN_RES; j++) {
        const x = -half + j * step;
        const hgt = 10 * fbm(n1, x / 70, z / 70, 3) + 2.6 * fbm(n2, x / 19, z / 19, 2) + 0.5 * fbm(n3, x / 5, z / 5, 2);
        raw.push(hgt);
        min = Math.min(min, hgt);
      }
    }
    return { seed, size: TERRAIN_SIZE, res: TERRAIN_RES, heights: raw.map(v => R2(v - min + 0.5)) };
  }
  function heightAt(x, z) {
    const t = terrain, step = t.size / (t.res - 1), half = t.size / 2;
    const fx = Math.max(0, Math.min(t.res - 1.001, (x + half) / step)), fz = Math.max(0, Math.min(t.res - 1.001, (z + half) / step));
    const j = Math.floor(fx), i = Math.floor(fz), u = fx - j, v = fz - i;
    const H = (ii, jj) => t.heights[ii * t.res + jj];
    return H(i, j) * (1 - u) * (1 - v) + H(i, j + 1) * u * (1 - v) + H(i + 1, j) * (1 - u) * v + H(i + 1, j + 1) * u * v;
  }
  // Lowest and highest ground under a footprint, sampled at corners, edge midpoints, centre and in between.
  function groundUnder(poly) {
    const cx = poly.reduce((a, v) => a + v[0], 0) / poly.length, cz = poly.reduce((a, v) => a + v[1], 0) / poly.length;
    const pts = [[cx, cz]];
    poly.forEach((v, i) => {
      const w = poly[(i + 1) % poly.length];
      pts.push(v, [(v[0] + w[0]) / 2, (v[1] + w[1]) / 2], [(v[0] + cx) / 2, (v[1] + cz) / 2]);
    });
    let min = Infinity, max = -Infinity;
    pts.forEach(([x, z]) => { const h = heightAt(x, z); min = Math.min(min, h); max = Math.max(max, h); });
    return { min, max };
  }
  function setTerrain(seed) {
    terrain = genTerrain(seed);
    if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); }
    terrainMesh = makeTerrain(terrain);
    scene.add(terrainMesh);
  }

  // ---------- Pieces ----------
  const viewport = $("bviewport"), canvas = $("bcanvas");
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  let ready = false, active = false;
  let renderer, scene, camera, controls, root, ghost = null, ghostPrefab = null;

  const S = { pieces: new Map(), sock: new Map(), events: [], nextId: 1, alias: new Map(), undo: [], redo: [], baseT: 0, resumeAt: null, name: "" };
  const ui = { slot: "plan", plan: "foundation", deploy: "cupboard.tool.deployed", hammer: "stone", tool: "place", prefab: "foundation", grade: "stone", level: 0, rot: 0, hideAbove: true };
  let hover = null, lastPointer = null, highlighted = null, flashTimer = null;

  const all = () => Array.from(S.pieces.values());
  const get = k => { const id = S.sock.get(k); return id ? S.pieces.get(id) : null; };
  const isSurface = p => p.kind === "F" || p.kind === "FL";
  const isSolidSurface = p => !!p && (p.kind === "F" || (p.kind === "FL" && SOLID_FLOORS.has(p.prefab)));

  function keyOf(p) {
    switch (p.kind) {
      case "F": case "FL": case "RF": return fpKey(p.cx, p.cz, Hof(p));
      case "S": return "S" + fpKey(p.cx, p.cz, Hof(p));
      case "W": return edgeKey(p, Hof(p));
      case "D": return "D" + edgeKey(p, Hof(p));
      case "FS": return "FS" + edgeKey(p, Hof(p));
      default: return null;
    }
  }
  function posOf(p) {
    switch (p.kind) {
      case "F": return [p.cx, p.by, p.cz];
      case "FL": case "RF": case "S": return [p.cx, Hof(p), p.cz];
      case "W": case "D": return [p.mx, Hof(p), p.mz];
      case "FS": return [p.mx, p.by, p.mz];
      default: return [p.x, Hof(p), p.z];
    }
  }
  function polyOf(p) {
    switch (p.kind) {
      case "F": case "FL": case "RF": case "S": return shapeVerts(p.shape, p.cx, p.cz, p.theta);
      case "W": case "D": return rectPoly(p.mx, p.mz, 3, 0.25, wallRot(p.a));
      case "FS": return rectPoly(p.mx + p.nx * 0.75, p.mz + p.nz * 0.75, 3, 1.5, wallRot(p.a));
      default: { const fp = FOOTPRINT[p.prefab] || [0.8, 0.8]; return rectPoly(p.x, p.z, fp[0], fp[1], p.rot); }
    }
  }
  function overlapsAny(poly, filter, inset) {
    const s = inset === undefined ? 0.12 : inset;
    const P = shrink(poly, s);
    return all().find(o => filter(o) && polyOverlap(P, shrink(polyOf(o), s))) || null;
  }
  const surfaceHasEdge = (K) => all().some(s => isSurface(s) && edgesOf(s).some(e => edgeKey(e, Hof(s)) === K));
  const fullWallAt = (e, H) => { const w = get(edgeKey(e, H)); return !!(w && w.kind === "W" && FULL_WALLS.has(w.prefab)); };

  function deployOk(p) {
    const H = Hof(p);
    const P = shrink(polyOf(p), 0.02);
    const solids = all().filter(s => isSolidSurface(s) && sameH(Hof(s), H)).map(polyOf);
    const stairs = all().filter(s => s.kind === "S" && sameH(Hof(s), H)).map(polyOf);
    return P.every(([x, z]) => solids.some(sp => pointInPoly(x, z, sp)) && !stairs.some(sp => pointInPoly(x, z, sp)));
  }
  function deployBlocked(p) {
    const H = Hof(p);
    const hit = overlapsAny(polyOf(p), o => o.id !== p.id && (o.kind === "X" || o.kind === "W") && sameH(Hof(o), H), 0.005);
    if (!hit) return null;
    return hit.kind === "W" ? "Too close to a wall" : "Overlaps the " + prefabName(hit.prefab).toLowerCase();
  }

  function supported(p) {
    const H = Hof(p);
    switch (p.kind) {
      case "F": return true;
      case "FS": return surfaceHasEdge(edgeKey(p, H));
      case "W": return surfaceHasEdge(edgeKey(p, H)) || (p.L > 0 && fullWallAt(p, H - 3));
      case "FL": case "RF": return edgesOf(p).some(e => fullWallAt(e, H - 3));
      case "S": { const s = get(fpKey(p.cx, p.cz, H)); return isSolidSurface(s) && s.shape === p.shape; }
      case "D": { const w = get(edgeKey(p, H)); return !!(w && w.prefab === "wall.doorway"); }
      default: return deployOk(p);
    }
  }

  function validate(c) {
    if (c.L > MAX_LEVEL) return "That's as high as the sandbox goes for now";
    const k = keyOf(c);
    if (k && S.sock.has(k)) return "There's already a " + prefabName(get(k).prefab).toLowerCase() + " here";
    const poly = polyOf(c), H = Hof(c);
    if (c.kind === "F") {
      const g = groundUnder(poly);
      if (g.max > H + 0.05) return "The ground comes up through this foundation here";
      if (g.min < H - FOUNDATION_DEPTH) return "Too high above the ground here; the foundation won't reach";
    }
    if (c.kind === "F" || c.kind === "FS") {
      const hit = overlapsAny(poly, o => o.kind === "F" || o.kind === "FS");
      if (hit) return "Overlaps the " + prefabName(hit.prefab).toLowerCase();
    }
    if (c.kind === "FL" || c.kind === "RF") {
      const hit = overlapsAny(poly, o => (o.kind === "FL" || o.kind === "RF") && sameH(Hof(o), H));
      if (hit) return "Overlaps the " + prefabName(hit.prefab).toLowerCase();
      if (overlapsAny(poly, o => o.kind === "S" && sameH(Hof(o), H - 3))) return "The stairs below need this space open";
    }
    if (c.kind === "S") {
      if (get(fpKey(c.cx, c.cz, H + 3))) return "Stairs need an opening above; remove that floor first";
      if (overlapsAny(poly, o => o.kind === "X" && sameH(Hof(o), H))) return "Clear the items off this floor first";
    }
    if (!supported(c)) return REASON[c.kind];
    if (c.kind === "X") { const b = deployBlocked(c); if (b) return b; }
    return null;
  }

  // ---------- Snapping (by distance on screen, since nothing is flat) ----------
  const projV = new THREE.Vector3();
  function nearestOnScreen(opts, sx, sy, maxPx) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    let best = null, bd = maxPx;
    opts.forEach(o => {
      projV.set(o.ref[0], o.ref[1], o.ref[2]).project(camera);
      if (projV.z > 1) return;
      const d = Math.hypot((projV.x + 1) / 2 * w - sx, (1 - projV.y) / 2 * h - sy);
      if (d < bd) { bd = d; best = o; }
    });
    return best;
  }
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function setRay(sx, sy) {
    ndc.set(sx / canvas.clientWidth * 2 - 1, -(sy / canvas.clientHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  // The first visible piece under the pointer (optionally only pieces matching a filter, e.g. floors behind a wall).
  function pieceUnder(sx, sy, filter) {
    setRay(sx, sy);
    const hits = ray.intersectObjects(root.children, true).filter(h => h.object.isMesh && shown(h.object));
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.pid === undefined) o = o.parent;
      if (!o) continue;
      const piece = S.pieces.get(o.userData.pid);
      if (!filter || filter(piece)) return { piece, point: h.point };
    }
    return null;
  }

  function snap(sx, sy) {
    const prefab = ui.prefab, kind = kindOf(prefab), shape = SHAPE[prefab];
    let c = null;
    if (kind === "F") {
      const opts = [];
      all().forEach(f => {
        if (f.kind !== "F") return;
        const top = Hof(f);
        edgesOf(f).forEach(e => {
          const a = attach(e, shape);
          if (!S.sock.has(fpKey(a.cx, a.cz, top))) opts.push(Object.assign(a, { by: f.by, ref: [a.cx, top, a.cz] }));
        });
      });
      const best = nearestOnScreen(opts, sx, sy, SNAP_PX);
      if (best) c = { shape, L: 0, cx: best.cx, cz: best.cz, theta: best.theta, by: best.by };
      else {
        setRay(sx, sy);
        const hit = terrainMesh && ray.intersectObject(terrainMesh)[0];
        if (!hit) return null;
        const theta = norm(ui.rot * 15);
        const cx = R2(hit.point.x), cz = R2(hit.point.z);
        const g = groundUnder(shapeVerts(shape, cx, cz, theta));
        c = { shape, L: 0, cx, cz, theta, by: R2(g.max + 0.2 - 1) };
      }
      c.rot = norm(-c.theta);
    } else if (kind === "FS") {
      const opts = [];
      all().forEach(f => {
        if (f.kind !== "F") return;
        const top = Hof(f);
        edgesOf(f).forEach(e => {
          const a = attach(e, "sq");
          if (!get(fpKey(a.cx, a.cz, top))) opts.push(Object.assign({}, e, { by: f.by, ref: [e.mx, top, e.mz] }));
        });
      });
      const best = nearestOnScreen(opts, sx, sy, SNAP_PX);
      if (best) c = { L: 0, by: best.by, mx: best.mx, mz: best.mz, a: best.a, nx: best.nx, nz: best.nz, rot: wallRot(best.a) };
    } else if (kind === "FL" || kind === "RF") {
      const L = ui.level + 1, opts = [];
      const add = (fp, by) => { const H = R2(by + 1 + 3 * L); if (!S.sock.has(fpKey(fp.cx, fp.cz, H))) opts.push(Object.assign({}, fp, { by, ref: [fp.cx, H, fp.cz] })); };
      all().forEach(o => {
        if (isSurface(o) && o.L === ui.level && o.shape === shape) add({ cx: o.cx, cz: o.cz, theta: o.theta }, o.by);
        if (o.kind === "FL" && o.L === L) edgesOf(o).forEach(e => add(attach(e, shape), o.by));
        if (o.kind === "W" && o.L === ui.level) {
          add(attach(o, shape), o.by);
          add(attach({ mx: o.mx, mz: o.mz, a: norm(o.a + 180), nx: -o.nx, nz: -o.nz }, shape), o.by);
        }
      });
      const best = nearestOnScreen(opts, sx, sy, SNAP_PX);
      if (best) {
        const extra = kind === "RF" ? ui.rot * TURN[shape] : 0;
        c = { shape, L, by: best.by, cx: best.cx, cz: best.cz, theta: best.theta, rot: norm(-(best.theta + extra)) };
      }
    } else if (kind === "S") {
      const L = ui.level;
      const opts = all().filter(s => isSolidSurface(s) && s.L === L && s.shape === shape && !S.sock.has("S" + fpKey(s.cx, s.cz, Hof(s))))
        .map(s => ({ cx: s.cx, cz: s.cz, theta: s.theta, by: s.by, ref: [s.cx, Hof(s), s.cz] }));
      const best = nearestOnScreen(opts, sx, sy, SNAP_PX);
      if (best) c = { shape, L, by: best.by, cx: best.cx, cz: best.cz, theta: best.theta, rot: norm(-(best.theta + ui.rot * TURN[shape])) };
    } else if (kind === "W") {
      const L = ui.level, seen = new Set(), opts = [];
      const add = (e, by) => {
        const H = R2(by + 1 + 3 * L), k = edgeKey(e, H);
        if (seen.has(k)) return;
        seen.add(k);
        opts.push({ mx: e.mx, mz: e.mz, a: e.a, nx: e.nx, nz: e.nz, by, ref: [e.mx, H + 0.3, e.mz] });
      };
      all().forEach(o => {
        if (isSurface(o) && o.L === L) edgesOf(o).forEach(e => add(e, o.by));
        if (L > 0 && o.kind === "W" && o.L === L - 1 && FULL_WALLS.has(o.prefab)) add(o, o.by);
      });
      const best = nearestOnScreen(opts, sx, sy, SNAP_PX);
      if (best) c = { L, by: best.by, mx: best.mx, mz: best.mz, a: best.a, nx: best.nx, nz: best.nz, rot: norm(wallRot(best.a) + (ui.rot % 2 ? 180 : 0)) };
    } else if (kind === "D") {
      const L = ui.level;
      const opts = all().filter(o => o.kind === "W" && o.L === L && o.prefab === "wall.doorway")
        .map(o => ({ mx: o.mx, mz: o.mz, a: o.a, nx: o.nx, nz: o.nz, by: o.by, rot: o.rot, ref: [o.mx, Hof(o) + 1, o.mz] }));
      const best = nearestOnScreen(opts, sx, sy, SNAP_PX);
      if (best) c = { L, by: best.by, mx: best.mx, mz: best.mz, a: best.a, nx: best.nx, nz: best.nz, rot: norm(best.rot + (ui.rot % 2 ? 180 : 0)) };
    } else {
      const hit = pieceUnder(sx, sy, p => isSolidSurface(p) && p.L === ui.level);
      if (hit) {
        c = { L: ui.level, by: hit.piece.by, x: Math.round(hit.point.x * 4) / 4, z: Math.round(hit.point.z * 4) / 4, rot: norm(ui.rot * 90) };
      }
    }
    if (!c) return null;
    Object.assign(c, { prefab, kind, grade: STRUCTURAL.has(prefab) ? "twigs" : "wood" });
    c.pos = posOf(c);
    return c;
  }

  // ---------- State changes (each one is logged) ----------
  function resolve(id) { while (S.alias.has(id)) id = S.alias.get(id); return id; }
  function now() {
    if (S.resumeAt === null) S.resumeAt = performance.now();
    return R2(S.baseT + (performance.now() - S.resumeAt) / 1000);
  }
  function emit(ev) { S.events.push(Object.assign({ t: now() }, ev)); }
  const snapshot = p => { const s = Object.assign({}, p); delete s.mesh; return s; };
  const r3 = v => Math.round(v * 1000) / 1000;

  function makeMesh(p) {
    const pc = makePiece({ prefab: p.prefab, grade: p.grade, pos: p.pos, rot: p.rot }, 0);
    pc.group.visible = true;
    pc.group.userData.pid = p.id;
    root.add(pc.group);
    p.mesh = pc.group;
  }
  function doPlace(snap, origId) {
    const p = Object.assign({}, snap, { id: S.nextId++ });
    delete p.mesh;
    if (origId !== undefined) S.alias.set(origId, p.id);
    p.pos = posOf(p);
    S.pieces.set(p.id, p);
    const k = keyOf(p);
    if (k) S.sock.set(k, p.id);
    makeMesh(p);
    emit({ op: "place", id: p.id, prefab: p.prefab, grade: p.grade, pos: p.pos.map(r3), rot: r3(p.rot) });
    return p;
  }
  function doRemove(id) {
    id = resolve(id);
    const p = S.pieces.get(id);
    if (!p) return null;
    S.pieces.delete(id);
    const k = keyOf(p);
    if (k && S.sock.get(k) === id) S.sock.delete(k);
    root.remove(p.mesh);
    if (highlighted && highlighted.id === id) highlighted = null;
    emit({ op: "remove", id });
    return snapshot(p);
  }
  function doGrade(id, g) {
    const p = S.pieces.get(resolve(id));
    if (!p) return;
    p.grade = g;
    p.mesh.children.forEach(ch => { if (ch.isMesh) ch.material = MATS[g]; });
    emit({ op: "upgrade", id: p.id, grade: g });
  }
  function doRot(id, r) {
    const p = S.pieces.get(resolve(id));
    if (!p) return;
    p.rot = r;
    p.mesh.rotation.y = rad(r);
    emit({ op: "rotate", id: p.id, rot: r3(r) });
  }
  // Rust's stability: anything that loses its support collapses.
  function collapse(ops) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of all()) {
        if (!supported(p)) { ops.push({ type: "remove", p: doRemove(p.id) }); changed = true; }
      }
    }
  }

  function commit(ops) {
    if (!ops.length) return;
    S.undo.push(ops);
    if (S.undo.length > 300) S.undo.shift();
    S.redo = [];
    afterChange();
  }
  function invert(op) {
    if (op.type === "place") doRemove(op.p.id);
    else if (op.type === "remove") doPlace(op.p, op.p.id);
    else if (op.type === "grade") doGrade(op.id, op.from);
    else if (op.type === "rot") doRot(op.id, op.from);
  }
  function apply(op) {
    if (op.type === "place") doPlace(op.p, op.p.id);
    else if (op.type === "remove") doRemove(op.p.id);
    else if (op.type === "grade") doGrade(op.id, op.to);
    else if (op.type === "rot") doRot(op.id, op.to);
  }
  function undo() {
    const ops = S.undo.pop();
    if (!ops) return flash("Nothing to undo");
    for (let i = ops.length - 1; i >= 0; i--) invert(ops[i]);
    S.redo.push(ops);
    afterChange();
  }
  function redo() {
    const ops = S.redo.pop();
    if (!ops) return flash("Nothing to redo");
    ops.forEach(apply);
    S.undo.push(ops);
    afterChange();
  }

  // ---------- Tool actions ----------
  function actPlace(c) {
    if (!c) return flash(NO_SNAP[kindOf(ui.prefab)] || "Can't place that here");
    const why = validate(c);
    if (why) return flash(why);
    const p = doPlace(c);
    commit([{ type: "place", p: snapshot(p) }]);
  }
  function actDemolish(id) {
    const ops = [];
    const snap = doRemove(id);
    if (!snap) return;
    ops.push({ type: "remove", p: snap });
    collapse(ops);
    commit(ops);
    if (ops.length > 1) flash("Demolished " + prefabName(snap.prefab).toLowerCase() + " and " + (ops.length - 1) + " piece" + (ops.length > 2 ? "s" : "") + " it was holding up", true);
  }
  function actUpgrade(id) {
    const p = S.pieces.get(id);
    if (!STRUCTURAL.has(p.prefab)) return flash("Only building pieces have grades");
    const from = GRADE_ORDER.indexOf(p.grade), to = GRADE_ORDER.indexOf(ui.grade);
    if (to === from) return flash("Already " + gradeName(p.grade));
    if (to < from) return flash("Rust doesn't allow downgrading; demolish and rebuild instead");
    const old = p.grade;
    doGrade(id, ui.grade);
    commit([{ type: "grade", id, from: old, to: ui.grade }]);
  }
  function actRotate(id) {
    const p = S.pieces.get(id);
    if (p.kind === "F" || p.kind === "FL" || p.kind === "FS") return flash(prefabName(p.prefab) + " doesn't rotate");
    const step = p.kind === "W" || p.kind === "D" ? 180 : p.kind === "X" ? 90 : TURN[p.shape];
    const old = p.rot, nr = norm(old - step);
    if (p.kind === "X") {
      const test = Object.assign({}, p, { rot: nr });
      const b = deployBlocked(test) || (!deployOk(test) ? REASON.X : null);
      if (b) return flash(b);
    }
    doRot(id, nr);
    commit([{ type: "rot", id, from: old, to: nr }]);
  }
  function upgradeAll() {
    const ops = [];
    const to = GRADE_ORDER.indexOf(ui.grade);
    all().forEach(p => {
      if (STRUCTURAL.has(p.prefab) && GRADE_ORDER.indexOf(p.grade) < to) {
        ops.push({ type: "grade", id: p.id, from: p.grade, to: ui.grade });
        doGrade(p.id, ui.grade);
      }
    });
    if (!ops.length) return flash("Everything is already " + gradeName(ui.grade) + " or better");
    commit(ops);
  }
  function clearAll() {
    all().forEach(p => root.remove(p.mesh));
    S.pieces.clear(); S.sock.clear(); S.alias.clear();
    S.events = []; S.undo = []; S.redo = []; S.nextId = 1; S.baseT = 0; S.resumeAt = null;
    afterChange();
  }

  // A small twig start, squares plus a triangle, set at a height that clears the ground under all of it.
  function seedStarter() {
    const f1 = { shape: "sq", cx: 1.5, cz: 1.5, theta: 0 };
    const f2 = attach(edgesOf(f1).find(e => e.a === 0), "sq");
    const f3 = attach(edgesOf(f2).find(e => Math.abs(e.mx - 6) < 0.01), "tri");
    let top = -Infinity;
    [f1, f2, f3].forEach(f => { top = Math.max(top, groundUnder(shapeVerts(f.shape, f.cx, f.cz, f.theta)).max); });
    const by = R2(top + 0.2 - 1);
    const F = (prefab, f) => doPlace({ prefab, kind: "F", grade: "twigs", L: 0, by, shape: f.shape, cx: f.cx, cz: f.cz, theta: f.theta, rot: norm(-f.theta) });
    const Wl = (prefab, e) => doPlace({ prefab, kind: kindOf(prefab), grade: "twigs", L: 0, by, mx: e.mx, mz: e.mz, a: e.a, nx: e.nx, nz: e.nz, rot: wallRot(e.a) });
    F("foundation", f1); F("foundation", f2); F("foundation.triangle", f3);
    const e1 = edgesOf(f1), e2 = edgesOf(f2);
    Wl("wall", e1.find(e => e.a === 270));
    Wl("wall", e1.find(e => e.a === 180));
    Wl("wall", e2.find(e => Math.abs(e.mz) < 0.01));
    Wl("wall.doorway", e1.find(e => e.a === 90));
    S.name = "Starter";
  }

  // ---------- Persistence (this browser only) ----------
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ name: S.name, seed: terrain.seed, events: S.events, nextId: S.nextId, pieces: all().map(snapshot) }));
    } catch (err) { /* storage unavailable; the build still works for this visit */ }
  }
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (err) { return null; }
  }
  function restore(d) {
    if (!d || !Array.isArray(d.pieces)) return false;
    d.pieces.forEach(p => {
      S.pieces.set(p.id, p);
      const k = keyOf(p);
      if (k) S.sock.set(k, p.id);
      makeMesh(p);
    });
    S.events = Array.isArray(d.events) ? d.events : [];
    S.nextId = d.nextId || S.pieces.size + 1;
    S.name = d.name || "";
    const last = S.events[S.events.length - 1];
    S.baseT = last ? last.t + 2 : 0;
    return true;
  }
  function toLog() {
    return {
      name: S.name.trim() || "Sandbox build", builder: "You", setting: "open", source: "sandbox",
      terrain: { size: terrain.size, res: terrain.res, heights: terrain.heights },
      events: S.events.map(e => Object.assign({}, e))
    };
  }
  function newSeed() { return 1 + Math.floor(Math.random() * 1e6); }

  // ---------- Visibility, ghost, highlight ----------
  function refreshVisibility() {
    const k = kindOf(ui.prefab);
    const placingCeiling = ui.tool === "place" && (k === "FL" || k === "RF");
    all().forEach(p => {
      let v = true;
      if (ui.hideAbove) v = p.L <= ui.level || (placingCeiling && (p.kind === "FL" || p.kind === "RF") && p.L === ui.level + 1);
      p.mesh.visible = v;
    });
  }
  const ghostOk = new THREE.MeshBasicMaterial({ color: 0x9fc48a, transparent: true, opacity: 0.45, depthWrite: false });
  const ghostBad = new THREE.MeshBasicMaterial({ color: 0xdf8a70, transparent: true, opacity: 0.45, depthWrite: false });
  const hlEdge = new THREE.LineBasicMaterial({ color: 0xd8b45f });
  const hlBad = new THREE.LineBasicMaterial({ color: 0xdf8a70 });

  function showGhost(c, ok) {
    if (ghostPrefab !== c.prefab) {
      if (ghost) scene.remove(ghost);
      ghost = new THREE.Group();
      partsFor(c.prefab).forEach(pt => {
        const m = new THREE.Mesh(partGeo(pt).geo, ghostOk);
        placePart(m, pt);
        ghost.add(m);
      });
      scene.add(ghost);
      ghostPrefab = c.prefab;
    }
    ghost.visible = true;
    ghost.children.forEach(m => { m.material = ok ? ghostOk : ghostBad; });
    ghost.position.set(c.pos[0], c.pos[1], c.pos[2]);
    ghost.rotation.y = rad(c.rot);
  }
  function hideGhost() { if (ghost) ghost.visible = false; }
  function clearHighlight() {
    if (highlighted && highlighted.mesh) highlighted.mesh.children.forEach(ch => { if (ch.isLineSegments) ch.material = EDGE_MAT; });
    highlighted = null;
  }
  function highlight(p) {
    clearHighlight();
    highlighted = p;
    const m = ui.tool === "demolish" ? hlBad : hlEdge;
    p.mesh.children.forEach(ch => { if (ch.isLineSegments) ch.material = m; });
  }

  // ---------- Tape measure ----------
  const tape = { a: null, b: null, group: null, line: null, dots: [] };
  function initTape() {
    tape.group = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: 0xd8b45f, depthTest: false, transparent: true });
    tape.line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat);
    tape.line.renderOrder = 10;
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xd8b45f, depthTest: false, transparent: true });
    const dotGeo = new THREE.SphereGeometry(0.09, 12, 8);
    tape.dots = [new THREE.Mesh(dotGeo, dotMat), new THREE.Mesh(dotGeo, dotMat)];
    tape.dots.forEach(d => { d.renderOrder = 11; tape.group.add(d); });
    tape.group.add(tape.line);
    tape.group.visible = false;
    scene.add(tape.group);
  }
  function tapePoint(sx, sy) {
    const hit = pieceUnder(sx, sy);
    if (hit) return hit.point.clone();
    setRay(sx, sy);
    const t = terrainMesh && ray.intersectObject(terrainMesh)[0];
    return t ? t.point.clone() : null;
  }
  function drawTape(a, b) {
    tape.group.visible = true;
    tape.line.geometry.setFromPoints([a, b]);
    tape.dots[0].position.copy(a);
    tape.dots[1].position.copy(b);
    const d = a.distanceTo(b), across = Math.hypot(b.x - a.x, b.z - a.z), up = b.y - a.y;
    return d.toFixed(2) + " m  ·  across " + across.toFixed(2) + " m  ·  " + (up >= 0 ? "up " : "down ") + Math.abs(up).toFixed(2) + " m";
  }
  function tapeClick(sx, sy) {
    const p = tapePoint(sx, sy);
    if (!p) return flash("Point at the ground or a building piece");
    if (!tape.a || tape.b) { tape.a = p; tape.b = null; drawTape(p, p); setHint("Click a second point to measure", false); }
    else { tape.b = p; setHint(drawTape(tape.a, tape.b), false); }
  }

  // ---------- Pointer ----------
  function local(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return [clientX - r.left, clientY - r.top];
  }
  function updateHover() {
    if (!lastPointer) return;
    const [sx, sy] = lastPointer;
    clearHighlight();
    if (ui.tool === "tape") {
      hideGhost();
      if (tape.a && !tape.b) { const p = tapePoint(sx, sy); if (p && !flashTimer) setHint(drawTape(tape.a, p), false); }
      else if (!tape.a && !flashTimer) setHint("Click a point to start measuring", false);
      return;
    }
    if (ui.tool === "place") {
      const c = snap(sx, sy);
      if (!c) {
        hideGhost();
        hover = { cand: null };
        if (!flashTimer) setHint(NO_SNAP[kindOf(ui.prefab)] || "Can't place that here", true);
        return;
      }
      const why = validate(c);
      hover = { cand: c, why };
      showGhost(c, !why);
      if (!flashTimer) setHint(why || "Click to place " + prefabName(c.prefab).toLowerCase(), !!why);
    } else {
      hideGhost();
      const hit = pieceUnder(sx, sy);
      const p = hit ? hit.piece : null;
      hover = p ? { piece: p } : null;
      if (p) highlight(p);
      if (!flashTimer) setHint(p ? toolHint(p) : idleHint(), false);
    }
  }
  function act() {
    if (ui.tool === "tape") { tapeClick(lastPointer[0], lastPointer[1]); return; }
    if (!hover) return;
    if (ui.tool === "place") actPlace(hover.cand);
    else if (hover.piece) {
      const id = hover.piece.id;
      if (ui.tool === "demolish") actDemolish(id);
      else if (ui.tool === "upgrade") actUpgrade(id);
      else if (ui.tool === "rotate") actRotate(id);
    }
    updateHover();
  }

  // ---------- Radial wheel (hold right-click, like Rust) ----------
  const wheelEl = $("wheel"), wheelSvg = $("wheelSvg"), wheelName = $("wheelName"), wheelSub = $("wheelSub");
  const W = { open: false, sticky: false, rings: [], hovered: null, cx: 0, cy: 0, scale: 1, openedAt: 0, start: null };
  const SVGNS = "http://www.w3.org/2000/svg";
  function wheelSpec() {
    const item = id => ({ id, label: WHEEL_LABEL[id] || prefabName(id), full: prefabName(id) });
    if (ui.slot === "plan") return { title: "Building Plan", rings: [{ r0: 64, r1: 152, items: PLAN_INNER.map(item) }, { r0: 156, r1: 236, items: PLAN_OUTER.map(item) }] };
    if (ui.slot === "hammer") return {
      title: "Hammer",
      rings: [{ r0: 64, r1: 200, items: HAMMER.map(h => ({ id: h.id, label: h.label, full: GRADES[h.id] ? "Upgrade to " + GRADES[h.id].name : h.label, swatch: GRADES[h.id] ? GRADES[h.id].hex : null })) }]
    };
    if (ui.slot === "deploy") return { title: "Deployables", rings: [{ r0: 64, r1: 200, items: DEPLOYABLES.map(item) }] };
    return null;
  }
  const selectedId = () => (ui.slot === "plan" ? ui.plan : ui.slot === "hammer" ? ui.hammer : ui.deploy);
  function arcPath(r0, r1, a0, a1) {
    const P = (r, a) => (r * Math.cos(rad(a))).toFixed(2) + " " + (r * Math.sin(rad(a))).toFixed(2);
    const large = a1 - a0 > 180 ? 1 : 0;
    return "M" + P(r1, a0) + " A" + r1 + " " + r1 + " 0 " + large + " 1 " + P(r1, a1) + " L" + P(r0, a1) + " A" + r0 + " " + r0 + " 0 " + large + " 0 " + P(r0, a0) + " Z";
  }
  function renderWheel(spec) {
    wheelSvg.innerHTML = "";
    W.rings = spec.rings;
    const sel = selectedId();
    spec.rings.forEach(ring => {
      const n = ring.items.length, step = 360 / n;
      ring.items.forEach((it, i) => {
        const mid = -90 + i * step;
        const g = document.createElementNS(SVGNS, "g");
        g.setAttribute("class", "wseg" + (it.id === sel ? " sel" : ""));
        g.dataset.id = it.id;
        const path = document.createElementNS(SVGNS, "path");
        path.setAttribute("d", arcPath(ring.r0, ring.r1, mid - step / 2 + 0.7, mid + step / 2 - 0.7));
        g.appendChild(path);
        const rm = (ring.r0 + ring.r1) / 2;
        const tx = rm * Math.cos(rad(mid)), ty = rm * Math.sin(rad(mid));
        if (it.swatch) {
          const sw = document.createElementNS(SVGNS, "rect");
          sw.setAttribute("x", (tx - 7).toFixed(1)); sw.setAttribute("y", (ty - 24).toFixed(1));
          sw.setAttribute("width", "14"); sw.setAttribute("height", "10"); sw.setAttribute("rx", "2");
          sw.setAttribute("fill", it.swatch); sw.setAttribute("class", "wsw");
          g.appendChild(sw);
        }
        const lines = it.label.split("|");
        const text = document.createElementNS(SVGNS, "text");
        text.setAttribute("x", tx.toFixed(1));
        text.setAttribute("y", (ty - (lines.length - 1) * 6.5 + 4).toFixed(1));
        lines.forEach((ln, k) => {
          const ts = document.createElementNS(SVGNS, "tspan");
          ts.setAttribute("x", tx.toFixed(1));
          if (k) ts.setAttribute("dy", "13");
          ts.textContent = ln;
          text.appendChild(ts);
        });
        g.appendChild(text);
        wheelSvg.appendChild(g);
      });
    });
    wheelName.textContent = spec.title;
    wheelSub.textContent = "Release on a choice";
  }
  function openWheel(sx, sy, sticky) {
    const spec = wheelSpec();
    if (!spec) return false;
    renderWheel(spec);
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const outer = spec.rings[spec.rings.length - 1].r1 + 8;
    W.scale = Math.min(1, (Math.min(vw, vh) - 16) / (outer * 2));
    const half = outer * W.scale;
    W.cx = Math.max(half + 4, Math.min(vw - half - 4, sx));
    W.cy = Math.max(half + 4, Math.min(vh - half - 4, sy));
    wheelEl.style.left = W.cx + "px";
    wheelEl.style.top = W.cy + "px";
    wheelEl.style.setProperty("--wheel-scale", W.scale);
    wheelEl.hidden = false;
    W.open = true; W.sticky = !!sticky; W.hovered = null; W.openedAt = performance.now(); W.start = [sx, sy];
    hideGhost(); clearHighlight();
    return true;
  }
  function wheelHit(sx, sy) {
    const dx = (sx - W.cx) / W.scale, dy = (sy - W.cy) / W.scale, d = Math.hypot(dx, dy);
    if (d < W.rings[0].r0 - 6) return null;
    let ring = W.rings.find(r => d < r.r1 + 2) || W.rings[W.rings.length - 1];
    const n = ring.items.length, step = 360 / n;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    const idx = ((Math.round((ang + 90) / step) % n) + n) % n;
    return ring.items[idx];
  }
  function wheelHover(sx, sy) {
    const it = wheelHit(sx, sy);
    W.hovered = it;
    wheelSvg.querySelectorAll(".wseg").forEach(g => g.classList.toggle("hot", !!it && g.dataset.id === it.id));
    wheelName.textContent = it ? it.full : wheelSpec().title;
    wheelSub.textContent = it ? (W.sticky ? "Click to select" : "Release to select") : (W.sticky ? "Click a choice" : "Release on a choice");
  }
  function closeWheel(choose) {
    if (!W.open) return;
    W.open = false;
    wheelEl.hidden = true;
    if (choose && W.hovered) chooseFromWheel(W.hovered.id);
    W.hovered = null;
    updateHover();
  }
  function chooseFromWheel(id) {
    if (ui.slot === "plan") ui.plan = id;
    else if (ui.slot === "hammer") ui.hammer = id;
    else if (ui.slot === "deploy") ui.deploy = id;
    selectSlot(ui.slot);
  }

  // ---------- UI ----------
  function setHint(text, err) {
    const h = $("bHint");
    h.textContent = text;
    h.classList.toggle("err", !!err);
  }
  function flash(text, ok) {
    clearTimeout(flashTimer);
    setHint(text, !ok);
    flashTimer = setTimeout(() => { flashTimer = null; updateHover(); }, 2600);
  }
  function idleHint() {
    if (ui.tool === "upgrade") return "Hit a building piece to upgrade it to " + gradeName(ui.grade);
    if (ui.tool === "rotate") return "Hit a piece to rotate it";
    return "Hit a piece to demolish it";
  }
  function toolHint(p) {
    if (ui.tool === "upgrade") return STRUCTURAL.has(p.prefab) ? "Upgrade " + gradeName(p.grade) + " " + prefabName(p.prefab).toLowerCase() + " to " + gradeName(ui.grade) : prefabName(p.prefab) + " has no grade";
    if (ui.tool === "rotate") return "Rotate " + prefabName(p.prefab).toLowerCase();
    return "Demolish " + prefabName(p.prefab).toLowerCase();
  }
  function hammerLabel() {
    return GRADES[ui.hammer] ? "Upgrade to " + GRADES[ui.hammer].name : ui.hammer === "rotate" ? "Rotate" : "Demolish";
  }
  const SLOT_NAMES = { plan: "Building Plan", hammer: "Hammer", deploy: "Deployable", tape: "Tape Measure" };
  function updateHeader() {
    $("bKicker").textContent = SLOT_NAMES[ui.slot] + " · " + (LEVEL_NAMES[ui.level] || "Level " + (ui.level + 1));
    $("bLabel").textContent = ui.slot === "hammer" ? hammerLabel() : ui.slot === "tape" ? "Measure" : prefabName(ui.prefab);
    $("lvlLabel").textContent = LEVEL_NAMES[ui.level] || "Level " + (ui.level + 1);
    $("slotPlanSub").textContent = prefabName(ui.plan);
    $("slotHammerSub").textContent = hammerLabel();
    $("slotDeploySub").textContent = prefabName(ui.deploy);
    document.querySelectorAll(".slot").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.slot === ui.slot)));
    document.querySelectorAll("#palDeploy .pbtn").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.prefab === ui.deploy)));
  }
  function updateStats() {
    let pieces = 0, deploy = 0;
    const grades = {};
    S.pieces.forEach(p => {
      if (STRUCTURAL.has(p.prefab)) { pieces++; grades[p.grade] = (grades[p.grade] || 0) + 1; }
      else deploy++;
    });
    const last = S.events[S.events.length - 1];
    const dl = $("bStats");
    dl.innerHTML = "";
    [["Pieces", pieces], ["Items", deploy], ["Build", fmt(last ? last.t : 0)], ["Actions", S.events.length]].forEach(([k, v]) => {
      const d = el("div");
      d.append(el("dt", null, k), el("dd", null, String(v)));
      dl.appendChild(d);
    });
    fillGradeBar($("bGrades"), grades);
    $("bClock").textContent = fmt(last ? last.t : 0);
    $("bCount").textContent = (pieces + deploy) + " pieces · " + S.events.length + " actions";
    $("bUndo").disabled = !S.undo.length;
    $("bRedo").disabled = !S.redo.length;
  }
  function afterChange() {
    refreshVisibility();
    updateStats();
    save();
  }

  function selectSlot(slot) {
    const prevPrefab = ui.prefab;
    ui.slot = slot;
    if (slot === "plan") { ui.tool = "place"; ui.prefab = ui.plan; }
    else if (slot === "deploy") { ui.tool = "place"; ui.prefab = ui.deploy; }
    else if (slot === "hammer") {
      if (GRADES[ui.hammer]) { ui.tool = "upgrade"; ui.grade = ui.hammer; }
      else ui.tool = ui.hammer;
    } else ui.tool = "tape";
    if (ui.prefab !== prevPrefab) ui.rot = 0;
    if (tape.group) tape.group.visible = slot === "tape" && !!tape.a;
    if (slot === "tape") { tape.a = null; tape.b = null; if (tape.group) tape.group.visible = false; }
    updateHeader(); refreshVisibility(); updateHover();
  }
  function setLevel(L) {
    ui.level = Math.max(0, Math.min(MAX_LEVEL, L));
    updateHeader(); refreshVisibility(); updateHover();
  }
  function frameBuild() {
    const fs = all().filter(p => p.kind === "F");
    if (fs.length) {
      const cx = fs.reduce((a, p) => a + p.cx, 0) / fs.length, cz = fs.reduce((a, p) => a + p.cz, 0) / fs.length;
      const y = fs.reduce((a, p) => a + p.by, 0) / fs.length + 1;
      controls.target.set(cx, y, cz);
      camera.position.set(cx + 12, y + 13, cz + 17);
    } else {
      const y = heightAt(0, 0);
      controls.target.set(0, y, 0);
      camera.position.set(12, y + 14, 18);
    }
    controls.update();
  }

  // Two-click confirm for actions that throw the current build away.
  function armed(btn, label, armedLabel, fn) {
    let timer = null;
    btn.addEventListener("click", () => {
      if (timer || !S.pieces.size) {
        clearTimeout(timer); timer = null;
        btn.textContent = label;
        fn();
        return;
      }
      btn.textContent = armedLabel;
      timer = setTimeout(() => { timer = null; btn.textContent = label; }, 3000);
    });
  }

  function buildPanels() {
    DEPLOYABLES.forEach(prefab => {
      const b = el("button", "pbtn");
      b.type = "button";
      b.dataset.prefab = prefab;
      b.setAttribute("aria-pressed", "false");
      b.appendChild(el("span", null, prefabName(prefab)));
      b.addEventListener("click", () => { ui.deploy = prefab; selectSlot("deploy"); });
      $("palDeploy").appendChild(b);
    });
    GRADE_ORDER.forEach(g => {
      if (g === "twigs") return;
      const o = el("option", null, GRADES[g].name);
      o.value = g;
      if (g === "stone") o.selected = true;
      $("upAllGrade").appendChild(o);
    });

    // Hotbar: clicking a slot selects it; clicking the active slot opens its wheel (handy on touch screens).
    document.querySelectorAll(".slot").forEach(b => b.addEventListener("click", () => {
      const slot = b.dataset.slot;
      if (slot === ui.slot && slot !== "tape") openWheel(viewport.clientWidth / 2, viewport.clientHeight / 2, true);
      else selectSlot(slot);
    }));
    $("lvlDown").addEventListener("click", () => setLevel(ui.level - 1));
    $("lvlUp").addEventListener("click", () => setLevel(ui.level + 1));
    $("bUndo").addEventListener("click", undo);
    $("bRedo").addEventListener("click", redo);
    $("bUpAll").addEventListener("click", () => {
      const prev = ui.grade;
      ui.grade = $("upAllGrade").value;
      upgradeAll();
      if (ui.tool !== "upgrade") ui.grade = prev;
    });
    $("optHideAbove").addEventListener("change", e => { ui.hideAbove = e.target.checked; refreshVisibility(); updateHover(); });
    const name = $("bName");
    name.value = S.name;
    name.addEventListener("input", () => { S.name = name.value; save(); });

    armed($("bClear"), "New build", "Click again to clear", () => { clearAll(); flash("Started a new build on the same terrain", true); });
    armed($("bTerrain"), "New terrain", "Click again: this clears your build", () => {
      clearAll();
      setTerrain(newSeed());
      save();
      frameBuild();
      flash("New terrain. Point at the ground to place a foundation.", true);
    });

    $("bReplay").addEventListener("click", () => {
      if (!S.events.length) return flash("Build something first, then watch it back");
      openLocalLog(toLog());
    });
    $("bCopy").addEventListener("click", () => {
      const text = JSON.stringify(toLog());
      if (!navigator.clipboard) return flash("Copying isn't available in this browser");
      navigator.clipboard.writeText(text).then(
        () => flash("Build log copied. Save it as a .json file to keep it.", true),
        () => flash("Copying was blocked in this browser")
      );
    });

    // Wheel picking with a click (for a wheel opened from the hotbar or by a quick right-click).
    wheelEl.addEventListener("pointerdown", e => {
      if (e.button !== 0) return;
      e.preventDefault();
      const [sx, sy] = local(e.clientX, e.clientY);
      wheelHover(sx, sy);
      closeWheel(true);
    });
    wheelEl.addEventListener("pointermove", e => { if (W.sticky) { const [sx, sy] = local(e.clientX, e.clientY); wheelHover(sx, sy); } });
    viewport.addEventListener("contextmenu", e => e.preventDefault());

    document.addEventListener("keydown", e => {
      if (!active) return;
      if (e.target.closest("input, select, textarea")) return;
      const k = e.key.toLowerCase();
      if (k === "escape" && W.open) { closeWheel(false); return; }
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === "r") { ui.rot++; updateHover(); }
      else if (k === "[" || e.key === "PageDown") setLevel(ui.level - 1);
      else if (k === "]" || e.key === "PageUp") setLevel(ui.level + 1);
      else if (/^[1-4]$/.test(k)) selectSlot(SLOTS[Number(k) - 1]);
    });
  }

  // ---------- Setup and render loop ----------
  function resize() {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function init() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    const stage = makeStage();
    scene = stage.scene;
    stage.grid.visible = false;
    stage.ground.visible = false;
    scene.fog = new THREE.Fog(SKY, 55, 150);
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    controls = new THREE.OrbitControls(camera, canvas);
    // Left-drag orbits, middle-drag (or Shift+drag) pans; right button is reserved for the wheel.
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: -1 };
    controls.enableDamping = !reduceMotion;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minDistance = 4;
    controls.maxDistance = 90;
    root = new THREE.Group();
    scene.add(root);
    initTape();

    const saved = loadSaved();
    setTerrain(saved && saved.seed ? saved.seed : newSeed());
    if (saved && Array.isArray(saved.pieces)) restore(saved); else seedStarter();
    buildPanels();
    selectSlot("plan");
    afterChange();
    frameBuild();

    let down = null;
    canvas.addEventListener("pointermove", e => { lastPointer = local(e.clientX, e.clientY); if (!down && !W.open) updateHover(); });
    canvas.addEventListener("pointerdown", e => {
      if (W.open) { e.preventDefault(); closeWheel(false); return; }
      if (e.button === 2) {
        e.preventDefault();
        const [sx, sy] = local(e.clientX, e.clientY);
        openWheel(sx, sy, false);
        return;
      }
      down = { x: e.clientX, y: e.clientY, b: e.button };
    });
    canvas.addEventListener("pointerup", e => {
      const d = down; down = null;
      if (!d || d.b !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; // that was an orbit drag
      lastPointer = local(e.clientX, e.clientY);
      updateHover();
      act();
    });
    // While the wheel is held open with the right button, track the pointer anywhere and pick on release.
    window.addEventListener("pointermove", e => {
      if (!W.open || W.sticky) return;
      const [sx, sy] = local(e.clientX, e.clientY);
      wheelHover(sx, sy);
    });
    window.addEventListener("pointerup", e => {
      if (!W.open || W.sticky || e.button !== 2) return;
      const [sx, sy] = local(e.clientX, e.clientY);
      const quick = performance.now() - W.openedAt < 400 && Math.hypot(sx - W.start[0], sy - W.start[1]) < 8;
      if (quick && !W.hovered) { W.sticky = true; wheelSub.textContent = "Click a choice"; return; } // a quick right-click leaves it open
      closeWheel(true);
    });
    canvas.addEventListener("pointerleave", () => { if (!W.open) { hideGhost(); clearHighlight(); hover = null; } });
    if (window.ResizeObserver) new ResizeObserver(resize).observe(viewport);
    window.addEventListener("resize", resize);
    requestAnimationFrame(tick);
    ready = true;
  }
  function tick() {
    if (active) {
      controls.update();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(tick);
  }

  // Test hook: lets automated checks drive the builder at a world position instead of a mouse position.
  const testApi = {
    pieces: () => all().map(p => ({ id: p.id, prefab: p.prefab, L: p.L, by: p.by })),
    setPrefab(prefab) { if (DEPLOYABLES.indexOf(prefab) >= 0) { ui.deploy = prefab; selectSlot("deploy"); } else { ui.plan = prefab; selectSlot("plan"); } },
    setHammer(id) { ui.hammer = id; selectSlot("hammer"); },
    setLevel, selectSlot,
    state: () => ({ slot: ui.slot, tool: ui.tool, prefab: ui.prefab, grade: ui.grade, hammer: ui.hammer }),
    newTerrain(seed) { clearAll(); setTerrain(seed); frameBuild(); },
    ground: (x, z) => heightAt(x, z),
    toScreen(x, y, z) { projV.set(x, y, z).project(camera); return [(projV.x + 1) / 2 * canvas.clientWidth, (1 - projV.y) / 2 * canvas.clientHeight]; },
    placeAt(x, z, y) {
      const k = kindOf(ui.prefab);
      const f = all().find(p => p.kind === "F");
      if (y === undefined) {
        const by = f ? f.by : heightAt(x, z) - 1;
        y = k === "F" ? (f ? by + 1 : heightAt(x, z)) : by + 1 + 3 * (k === "FL" || k === "RF" ? ui.level + 1 : ui.level);
      }
      const [sx, sy] = testApi.toScreen(x, y, z);
      lastPointer = [sx, sy];
      const c = snap(sx, sy);
      if (!c) return "no-snap";
      const why = validate(c);
      if (why) return why;
      actPlace(c);
      return "ok";
    }
  };

  return {
    setActive(v) {
      active = v;
      if (v && !ready) init();
      if (v) { setXray(false); setRockGhost(false); resize(); updateStats(); }
      if (!v && W.open) closeWheel(false);
    },
    test: testApi
  };
})();
