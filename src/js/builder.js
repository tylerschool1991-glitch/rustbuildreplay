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
  // Building plan wheel, clockwise from the top.
  const PLAN = [
    "foundation", "foundation.triangle", "foundation.steps", "floor", "floor.triangle", "floor.frame", "floor.triangle.frame",
    "wall", "wall.doorway", "wall.window", "wall.frame", "wall.half", "wall.low",
    "block.stair.ushape", "block.stair.lshape", "block.stair.spiral", "block.stair.spiral.triangle", "ramp", "roof", "roof.triangle"
  ];
  const SOCKET_WALL = { doorway: "wall.doorway", frame: "wall.frame", window: "wall.window" };
  const placeOf = prefab => (CATALOG_BY_ID[prefab] ? CATALOG_BY_ID[prefab].place : "free");
  const DESC = {
    "foundation": "Every base starts here. Snaps edge to edge.",
    "foundation.triangle": "Fills angles and builds honeycomb.",
    "foundation.steps": "Steps up onto a foundation from outside.",
    "floor": "Solid floor or ceiling on top of walls.",
    "floor.triangle": "Triangle floor or ceiling.",
    "floor.frame": "Takes a hatch or a grill.",
    "floor.triangle.frame": "Triangle frame for a hatch or a grill.",
    "wall": "Full-height wall.",
    "wall.doorway": "Takes a door.",
    "wall.window": "Takes window bars or an embrasure.",
    "wall.frame": "Takes a double door or a garage door.",
    "wall.half": "Half-height wall.",
    "wall.low": "Low cover wall.",
    "block.stair.ushape": "Two flights up to the next floor.",
    "block.stair.lshape": "Turning stairs up to the next floor.",
    "block.stair.spiral": "Compact stairs on a square.",
    "block.stair.spiral.triangle": "Spiral stairs that fit a triangle.",
    "ramp": "A slope instead of steps.",
    "roof": "Sloped roof on top of walls.",
    "roof.triangle": "Triangle roof for angled sections.",
    "door.hinged.metal": "Closes off a doorway.",
    "cupboard.tool.deployed": "Building privilege and upkeep.",
    "box.wooden.large": "Storage for the loot room.",
    "furnace": "Smelts ore.",
    "sleepingbag_leather_deployed": "A place to respawn."
  };
  function describe(id) {
    const c = CATALOG_BY_ID[id];
    if (!c) return DESC[id] || "";
    return (DESC[id] ? DESC[id] + " " : "") + sizeText(c) + " (measured)";
  }
  const HAMMER = [
    { id: "wood", name: "Upgrade to Wood", desc: "Hit a piece to upgrade it to wood." },
    { id: "stone", name: "Upgrade to Stone", desc: "Hit a piece to upgrade it to stone." },
    { id: "metal", name: "Upgrade to Sheet Metal", desc: "Hit a piece to upgrade it to sheet metal." },
    { id: "toptier", name: "Upgrade to Armored", desc: "Hit a piece to upgrade it to armored." },
    { id: "rotate", name: "Rotate", desc: "Turn the piece you hit." },
    { id: "demolish", name: "Demolish", desc: "Remove the piece you hit and anything it was holding up." }
  ];
  const SLOTS = ["plan", "hammer"];
  const STORE_KEY = "buildreplay.sandbox.v3";
  const MAX_LEVEL = 5;
  const FOUNDATION_DEPTH = FOUNDATION_DEPTH_M; // measured: a foundation reaches 3 m below its top
  const SPIRALS = new Set(["block.stair.spiral", "block.stair.spiral.triangle"]);
  const SNAP_PX = 85;         // how close (in screen pixels) the pointer must be to a snap point
  const REASON = {
    FS: "Foundation steps go on the outer edge of a foundation",
    W: "Walls go on a foundation or floor edge, or on top of a wall or half wall",
    FL: "Floors attach to a wall or half-wall top, the middle of a plain wall, or another floor's edge",
    RF: "A roof's low edge goes on a wall or half-wall top, or a foundation or floor edge",
    S: "Stairs need a foundation or solid floor of the same shape",
    D: "This goes in a matching wall opening",
    H: "This goes in a floor frame of the same shape",
    X: "Place it on a foundation, a solid floor or the ground"
  };
  const NO_SNAP = {
    F: "Point at the ground",
    FS: "Point at the outer edge of a foundation",
    W: "Point at the edge of a foundation or floor",
    FL: "Point above a wall or half wall, at the middle of a wall, or next to another floor",
    RF: "Point above a wall top or the edge of a foundation or floor",
    S: "Point at a foundation or solid floor of the same shape",
    D: "Point at a matching wall opening on this floor",
    H: "Point at a floor frame of the same shape",
    X: "Point at a foundation, a solid floor or the ground"
  };

  const kindOf = prefab =>
    prefab === "foundation" || prefab === "foundation.triangle" ? "F" :
    prefab === "foundation.steps" ? "FS" :
    prefab === "roof" || prefab === "roof.triangle" ? "RF" :
    SHAPE[prefab] && prefab.indexOf("floor") === 0 ? "FL" :
    SHAPE[prefab] ? "S" :
    WALLS.has(prefab) ? "W" :
    SOCKET_WALL[placeOf(prefab)] ? "D" :
    placeOf(prefab).indexOf("hatch") === 0 ? "H" : "X";

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
    buildDecor();
  }
  function buildDecor() {
    if (decor) { scene.remove(decor.group); decor.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    decor = makeDecor({ heightAt, center: [0, 0], radius: 72, seed: terrain.seed, level: Look.level() });
    scene.add(decor.group);
    stage.decor = decor.group;
    decor.group.visible = Look.cozy();
    scene.userData.noAO = [stage.sky].concat(decor.noAO);
    if (ready) decor.setAvoid(decorAvoid());
  }
  // Grass, stones and trees make way for foundations, steps and items on the ground.
  function decorAvoid() {
    const out = [];
    all().forEach(p => {
      if (p.kind === "F") out.push({ x: p.cx, z: p.cz, r: p.shape === "tri" ? 1.85 : 2.2 });
      else if (p.kind === "FS") out.push({ x: p.mx + p.nx * 1.5, z: p.mz + p.nz * 1.5, r: 1.75 });
      else if (p.kind === "X" && p.ground) { const c = CATALOG_BY_ID[p.prefab]; out.push({ x: p.x, z: p.z, r: c ? Math.hypot(c.w, c.d) / 2 + 0.15 : 1 }); }
    });
    return out;
  }

  // ---------- Pieces ----------
  const viewport = $("bviewport"), canvas = $("bcanvas");
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  let ready = false, active = false;
  let renderer, view, stage, dust, decor = null, scene, camera, controls, root, ghost = null, ghostPrefab = null;
  const drops = new Map(); // pieces settling into place

  const S = { pieces: new Map(), sock: new Map(), events: [], nextId: 1, alias: new Map(), undo: [], redo: [], baseT: 0, resumeAt: null, name: "" };
  const ui = { slot: "plan", plan: "foundation", deploy: "cupboard.tool.deployed", recent: ["cupboard.tool.deployed", "box.wooden.large", "door.hinged.metal", "furnace", "sleepingbag_leather_deployed", "autoturret", "workbench1", "generator.wind.scrap"], cat: "Essentials", search: "", extraOpen: {}, wb: 1, hammer: "stone", tool: "place", prefab: "foundation", grade: "stone", level: 0, rot: 0, hideAbove: true };
  let hover = null, lastPointer = null, highlighted = null, flashTimer = null;

  const all = () => Array.from(S.pieces.values());
  const get = k => { const id = S.sock.get(k); return id ? S.pieces.get(id) : null; };
  const isSurface = p => p.kind === "F" || p.kind === "FL";
  const isSolidSurface = p => !!p && (p.kind === "F" || (p.kind === "FL" && SOLID_FLOORS.has(p.prefab)));

  function keyOf(p) {
    switch (p.kind) {
      case "F": case "FL": case "RF": return fpKey(p.cx, p.cz, Hof(p));
      case "S": return "S" + fpKey(p.cx, p.cz, Hof(p)) + ":" + (p.half || 0);
      case "W": return edgeKey(p, Hof(p));
      case "D": return "D" + edgeKey(p, Hof(p));
      case "H": return "H" + fpKey(p.cx, p.cz, Hof(p));
      case "FS": return "FS" + edgeKey(p, Hof(p));
      default: return null;
    }
  }
  function posOf(p) {
    switch (p.kind) {
      case "F": return [p.cx, p.by, p.cz];
      case "S": return [p.cx, Hof(p) + SPIRAL_RISE * (p.half || 0), p.cz];
      case "FL": case "RF": case "H": return [p.cx, Hof(p), p.cz];
      case "W": case "D": return [p.mx, Hof(p), p.mz];
      case "FS": return [p.mx, p.by, p.mz];
      default: return [p.x, Hof(p) + (!p.ground && p.L > 0 ? FLOOR_T / 2 : 0), p.z]; // floors' top is 0.1 m above the storey line
    }
  }
  function polyOf(p) {
    switch (p.kind) {
      case "F": case "FL": case "RF": case "S": case "H": return shapeVerts(p.shape, p.cx, p.cz, p.theta);
      case "W": case "D": return rectPoly(p.mx, p.mz, 3, 0.25, wallRot(p.a));
      case "FS": return rectPoly(p.mx + p.nx * 1.5, p.mz + p.nz * 1.5, 1.5, 3, wallRot(p.a));
      default: return footRect(p.prefab, p.x, p.z, p.rot);
    }
  }
  // An item's footprint on the ground: its measured bounds, offset from its origin and turned with it.
  function footRect(prefab, x, z, rot) {
    const c = CATALOG_BY_ID[prefab];
    if (!c) return rectPoly(x, z, 0.8, 0.8, rot);
    const ox = c.b[0], oz = c.b[2], cs = cosd(rot), sn = sind(rot);
    return rectPoly(x + ox * cs + oz * sn, z - ox * sn + oz * cs, c.w, c.d, rot);
  }
  function overlapsAny(poly, filter, inset) {
    const s = inset === undefined ? 0.12 : inset;
    const P = shrink(poly, s);
    return all().find(o => filter(o) && polyOverlap(P, shrink(polyOf(o), s))) || null;
  }
  // An item's solid footprint: its measured collision boxes turned with it. Rust checks these, not the
  // outer bounds (a sleeping bag's bounds, for one, are 25 cm bigger than the bag).
  function itemRects(prefab, x, z, rot) {
    const c = CATALOG_BY_ID[prefab];
    if (!c) return [rectPoly(x, z, 0.8, 0.8, rot)];
    const cs = cosd(rot), sn = sind(rot);
    const boxes = (c.cols && c.cols.length ? c.cols : [c.b]).filter(b => b[3] > 0.02 && b[5] > 0.02);
    return boxes.map(([bx, , bz, w, , d]) => rectPoly(x + bx * cs + bz * sn, z - bx * sn + bz * cs, w, d, rot));
  }
  // What an item can't overlap: other items on the same floor (or the ground), the walls standing on that
  // floor (20 cm thick), and for ground items, foundations and steps.
  function obstaclesFor(p) {
    const H = Hof(p), out = [];
    all().forEach(o => {
      if (o.id === p.id) return;
      if (p.ground) {
        if (o.kind === "X" && o.ground) itemRects(o.prefab, o.x, o.z, o.rot).forEach(r => out.push({ r, o }));
        else if (o.kind === "F" || o.kind === "FS") out.push({ r: polyOf(o), o });
      } else if (sameH(Hof(o), H)) {
        if (o.kind === "X" && !o.ground) itemRects(o.prefab, o.x, o.z, o.rot).forEach(r => out.push({ r, o }));
        else if (o.kind === "W") out.push({ r: rectPoly(o.mx, o.mz, 3, WALL_T, wallRot(o.a)), o });
      }
    });
    return out;
  }
  // How far, and which way, to move polygon A so it no longer overlaps B (separating axis test).
  function pushOut(A, B) {
    let best = null;
    for (const P of [A, B]) {
      for (let i = 0; i < P.length; i++) {
        const [x1, z1] = P[i], [x2, z2] = P[(i + 1) % P.length];
        let nx = z2 - z1, nz = -(x2 - x1);
        const l = Math.hypot(nx, nz);
        if (!l) continue;
        nx /= l; nz /= l;
        let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
        A.forEach(([x, z]) => { const d = x * nx + z * nz; a0 = Math.min(a0, d); a1 = Math.max(a1, d); });
        B.forEach(([x, z]) => { const d = x * nx + z * nz; b0 = Math.min(b0, d); b1 = Math.max(b1, d); });
        const back = a1 - b0, fwd = b1 - a0;
        if (back <= 0 || fwd <= 0) return null;
        const d = Math.min(back, fwd);
        if (!best || d < best.d) best = back < fwd ? { d, x: -nx, z: -nz } : { d, x: nx, z: nz };
      }
    }
    return best;
  }
  // Aiming a little into a wall or another item slides the item out until it sits flush, so tight
  // layouts are easy to place. A big overlap is left alone (and shows as blocked).
  function settleItem(c) {
    const x0 = c.x, z0 = c.z;
    for (let it = 0; it < 8; it++) {
      const mine = itemRects(c.prefab, c.x, c.z, c.rot), obs = obstaclesFor(c);
      let worst = null;
      mine.forEach(m => obs.forEach(ob => { const v = pushOut(m, ob.r); if (v && v.d > 0.004 && (!worst || v.d > worst.d)) worst = v; }));
      if (!worst) return;
      if (worst.d > 0.6) break;
      c.x += worst.x * (worst.d + 0.003);
      c.z += worst.z * (worst.d + 0.003);
    }
    // It doesn't fit here (squeezed between things, or aimed deep into something): leave it where it
    // was aimed so the message names what's in the way.
    c.x = x0; c.z = z0;
  }
  function deployOk(p) {
    const H = Hof(p);
    const P = [].concat(...itemRects(p.prefab, p.x, p.z, p.rot).map(r => shrink(r, 0.02)));
    const solids = all().filter(s => isSolidSurface(s) && sameH(Hof(s), H)).map(polyOf);
    const stairs = all().filter(s => s.kind === "S" && sameH(Hof(s), H)).map(polyOf);
    return P.every(([x, z]) => solids.some(sp => pointInPoly(x, z, sp)) && !stairs.some(sp => pointInPoly(x, z, sp)));
  }
  function deployBlocked(p) {
    const mine = itemRects(p.prefab, p.x, p.z, p.rot).map(r => shrink(r, 0.004));
    for (const ob of obstaclesFor(p)) {
      const R = shrink(ob.r, 0.004);
      if (mine.some(m => polyOverlap(m, R))) return ob.o.kind === "W" ? "Runs into the " + prefabName(ob.o.prefab).toLowerCase() : "Overlaps the " + prefabName(ob.o.prefab).toLowerCase();
    }
    return null;
  }

  // ---------- Sockets and support (from the game's socket data, Rust 2635.289.1) ----------
  // Female sockets along edges, i.e. where a wall (or a roof's low edge) or a floor can attach:
  //   foundations: Wall on every edge (no Floor sockets);
  //   floors and floor frames: Wall and Floor on every edge (a floor can hang off another floor);
  //   wall, doorway, window, frame: Wall and Floor on top (3 m), Floor at mid-height (1.5 m) on both
  //     sides; only the plain wall's mid-height sockets carry stability;
  //   half wall: Wall and Floor on top (1.5 m); low wall: nothing on top;
  //   roof: its low edge attaches like a wall onto a Wall socket; Floor at the low edge, Wall and Floor
  //     at the high edge 3 m up.
  const WALL_HT = { "wall": 3, "wall.doorway": 3, "wall.window": 3, "wall.frame": 3, "wall.half": 1.5, "wall.low": 1 };
  const halfL = v => Math.round(v * 2) / 2;
  const Lfor = (H, by) => halfL((H - by - 1) / 3);
  // What the storey selector offers. Generous on purpose: half walls, mid-wall floors and walls on half walls
  // put sockets between storey lines, and a storey's own floor (tops of the walls below) must be placeable
  // while standing on that storey. Snapping still picks whichever spot is nearest the cursor.
  const inBand = L => L > ui.level - 0.51 && L < ui.level + 0.99;      // walls, stairs and items
  const inCeil = L => L > ui.level - 0.01 && L < ui.level + 1.51;      // floors and roofs
  function roofLow(p) {
    // The edge a roof stands on: its model's low side is local -z (square) or the base (+z) for a triangle.
    const r = rad(p.rot), ap = APOTHEM[p.shape];
    const dx = p.shape === "sq" ? -Math.sin(r) : Math.sin(r), dz = p.shape === "sq" ? -Math.cos(r) : Math.cos(r);
    return { mx: p.cx + dx * ap, mz: p.cz + dz * ap, nx: dx, nz: dz, a: norm(Math.atan2(dz, dx) * 180 / Math.PI) };
  }
  const flip = e => ({ mx: e.mx, mz: e.mz, a: norm(e.a + 180), nx: -e.nx, nz: -e.nz });
  function femalesOf(p) {
    const out = [], H = Hof(p);
    const add = (e, h, type, stab) => out.push({ e, H: R2(h), type, stab, by: p.by, id: p.id });
    const both = (e, h, stab) => { add(e, h, "FL", stab); add(flip(e), h, "FL", stab); };
    if (p.kind === "F") edgesOf(p).forEach(e => add(e, H, "W", true));
    else if (p.kind === "FL") edgesOf(p).forEach(e => { add(e, H, "W", true); add(e, H, "FL", true); });
    else if (p.kind === "W") {
      const ht = WALL_HT[p.prefab];
      if (ht === 3) { add(p, H + 3, "W", true); both(p, H + 3, true); both(p, H + 1.5, p.prefab === "wall"); }
      else if (ht === 1.5) { add(p, H + 1.5, "W", true); both(p, H + 1.5, true); }
    } else if (p.kind === "RF") {
      const lo = roofLow(p);
      add(lo, H, "FL", true);
      if (p.shape === "sq") {
        const hi = { mx: 2 * p.cx - lo.mx, mz: 2 * p.cz - lo.mz, nx: -lo.nx, nz: -lo.nz, a: norm(lo.a + 180) };
        add(hi, H + 3, "W", true); add(hi, H + 3, "FL", true);
      }
    }
    return out;
  }
  function femaleIndex(skipId) {
    const idx = new Map();
    all().forEach(p => {
      if (p.id === skipId) return;
      femalesOf(p).forEach(f => {
        const k = f.type + edgeKey(f.e, f.H);
        if (!idx.has(k)) idx.set(k, []);
        idx.get(k).push(f);
      });
    });
    return idx;
  }
  // The pieces a piece stands on (its male sockets in their female sockets). Foundations stand on the ground.
  function supportersOf(p, idx) {
    const H = Hof(p), ids = [];
    const take = list => (list || []).forEach(f => { if (f.id !== p.id && f.stab) ids.push(f.id); });
    switch (p.kind) {
      case "F": return [];
      case "FS": (idx.get("W" + edgeKey(p, H)) || []).forEach(f => { const o = S.pieces.get(f.id); if (o && o.kind === "F") ids.push(o.id); }); break;
      case "W": take(idx.get("W" + edgeKey(p, H))); break;
      case "RF": take(idx.get("W" + edgeKey(roofLow(p), H))); break;
      case "FL":
        edgesOf(p).forEach(e => (idx.get("FL" + edgeKey(e, H)) || []).forEach(f => {
          // The socket's floor side has to face this floor.
          if (f.id !== p.id && f.stab && f.e.nx * (p.cx - e.mx) + f.e.nz * (p.cz - e.mz) > 0) ids.push(f.id);
        }));
        break;
      case "S": {
        if (p.half) { const b = get("S" + fpKey(p.cx, p.cz, H) + ":0"); if (b && b.prefab === p.prefab) ids.push(b.id); break; }
        const s = get(fpKey(p.cx, p.cz, H)); if (isSolidSurface(s) && s.shape === p.shape) ids.push(s.id); break;
      }
      case "D": { const w = get(edgeKey(p, H)); if (w && w.prefab === SOCKET_WALL[placeOf(p.prefab)]) ids.push(w.id); break; }
      case "H": { const f = get(fpKey(p.cx, p.cz, H)); if (f && f.prefab === (p.shape === "tri" ? "floor.triangle.frame" : "floor.frame")) ids.push(f.id); break; }
      default: {
        if (p.ground) return [];
        if (!deployOk(p)) return [];
        const P = shrink(polyOf(p), 0.02);
        all().forEach(s => { if (s.id !== p.id && isSolidSurface(s) && sameH(Hof(s), H) && polyOverlap(P, polyOf(s))) ids.push(s.id); });
      }
    }
    return ids;
  }
  const isRoot = p => p.kind === "F" || (p.kind === "X" && p.ground);
  function supported(p, idx) { return isRoot(p) || supportersOf(p, idx || femaleIndex(p.id)).length > 0; }
  // Everything still connected to a foundation (or to the ground) through sockets that carry stability.
  function groundedIds() {
    const idx = femaleIndex();
    const sup = new Map();
    const ok = new Set();
    all().forEach(p => { if (isRoot(p)) ok.add(p.id); else sup.set(p.id, supportersOf(p, idx)); });
    let changed = true;
    while (changed) {
      changed = false;
      sup.forEach((s, id) => { if (!ok.has(id) && s.some(x => ok.has(x))) { ok.add(id); changed = true; } });
    }
    return ok;
  }

  // ---------- Stability (measured with BuildReplayMeasure brstability on Rust 2635.289.1) ----------
  // How Rust works it out, matched against 21 test structures built on a real server:
  //  - Foundations are 100%.
  //  - Every other piece has supports, one per male socket, each with a factor: a wall's base 0.7 (low wall
  //    0.9) plus 0.1 at each end where it meets another wall's end; a floor 0.25 per edge (triangle 0.33);
  //    a roof's low edge 0.3; stairs, ramps and foundation steps 0.7.
  //  - Each support takes ONE of the pieces at that socket: the one with the fewest steps to the ground.
  //  - Stability = sum of factor x (that piece's own support value, worked out without counting this piece),
  //    capped at 100%. A piece under 5% collapses (and can't be placed).
  const COLLAPSE = 0.05;
  const isStab = p => p.kind === "F" || p.kind === "FS" || p.kind === "W" || p.kind === "FL" || p.kind === "RF" || p.kind === "S";
  // Wall-end stability sockets: a 0.1 m wide box at each end of a wall (2.5 m tall on full walls, 1 m on
  // half walls, 0.5 m on low walls); two wall ends brace each other wherever their boxes overlap.
  const STAB_H = { "wall": 1.5, "wall.doorway": 1.5, "wall.window": 1.5, "wall.frame": 1.5, "wall.half": 0.75, "wall.low": 0.5 };
  const STAB_BOX = { "wall": 2.5, "wall.doorway": 2.5, "wall.window": 2.5, "wall.frame": 2.5, "wall.half": 1, "wall.low": 0.5 };
  const ptKey = (x, z) => Math.round(x * 20) + ":" + Math.round(z * 20);
  function wallEnds(p) {
    const tx = -p.nz, tz = p.nx, y = Hof(p) + STAB_H[p.prefab], h = STAB_BOX[p.prefab];
    return [{ k: ptKey(p.mx + tx * 1.5, p.mz + tz * 1.5), y, h }, { k: ptKey(p.mx - tx * 1.5, p.mz - tz * 1.5), y, h }];
  }
  function femaleIndexOf(list, skipId) {
    const idx = new Map();
    list.forEach(p => {
      if (p.id === skipId) return;
      femalesOf(p).forEach(f => {
        const k = f.type + edgeKey(f.e, f.H);
        if (!idx.has(k)) idx.set(k, []);
        idx.get(k).push(f);
      });
    });
    return idx;
  }
  function wallEndIndex(list) {
    const ends = new Map();
    list.forEach(p => { if (p.kind === "W") wallEnds(p).forEach(w => { if (!ends.has(w.k)) ends.set(w.k, []); ends.get(w.k).push({ id: p.id, y: w.y, h: w.h }); }); });
    return ends;
  }
  // Supports of a piece: [{ f: factor, c: [ids of pieces at that socket] }].
  function supportLinks(p, idx, ends) {
    const H = Hof(p), notMe = f => f.id !== p.id;
    switch (p.kind) {
      case "W": {
        const out = [{ f: p.prefab === "wall.low" ? 0.9 : 0.7, c: (idx.get("W" + edgeKey(p, H)) || []).filter(notMe).map(f => f.id) }];
        wallEnds(p).forEach(w => out.push({ f: 0.1, c: (ends.get(w.k) || []).filter(o => o.id !== p.id && Math.abs(o.y - w.y) < (o.h + w.h) / 2 - 0.001).map(o => o.id) }));
        return out;
      }
      case "RF": return [{ f: 0.3, c: (idx.get("W" + edgeKey(roofLow(p), H)) || []).filter(notMe).map(f => f.id) }];
      case "FL":
        return edgesOf(p).map(e => ({
          f: p.shape === "tri" ? 0.33 : 0.25,
          c: (idx.get("FL" + edgeKey(e, H)) || []).filter(f => notMe(f) && f.stab && f.e.nx * (p.cx - e.mx) + f.e.nz * (p.cz - e.mz) > 0).map(f => f.id)
        }));
      case "FS": return [{ f: 0.7, c: (idx.get("W" + edgeKey(p, H)) || []).filter(f => { const o = S.pieces.get(f.id); return o && o.kind === "F"; }).map(f => f.id) }];
      case "S": return [{ f: 0.7, c: supportersOf(p, idx) }];
    }
    return [];
  }
  // Solves the whole structure: Map id -> { s: stability 0..1, d: steps to the ground }.
  function solveStability(list) {
    const idx = femaleIndexOf(list), ends = wallEndIndex(list), node = new Map();
    list.forEach(p => {
      if (!isStab(p)) return;
      const g = p.kind === "F";
      node.set(p.id, { p, g, sup: g ? [] : supportLinks(p, idx, ends), d: g ? 1 : Infinity, s: g ? 1 : 0 });
    });
    node.forEach(n => n.sup.forEach(l => { l.c = l.c.filter(id => node.has(id)); }));
    for (let guard = 0, ch = true; ch && guard < 2000; guard++) {
      ch = false;
      node.forEach(n => {
        if (n.g) return;
        let d = Infinity;
        n.sup.forEach(l => l.c.forEach(id => { const m = node.get(id); if (m.d + 1 < d) d = m.d + 1; }));
        if (d !== n.d) { n.d = d; ch = true; }
      });
    }
    const pick = (l, a, b) => { let best = null; for (const id of l.c) { if (id === a || id === b) continue; const m = node.get(id); if (!best || m.d < best.d) best = m; } return best; };
    const csv = (q, ign) => {
      if (q.g) return 1;
      let v = 0;
      q.sup.forEach(l => { const m = pick(l, q.p.id, ign); if (m) v += l.f * m.s; });
      return Math.min(1, v);
    };
    const stabOf = n => {
      let v = 0;
      n.sup.forEach(l => { const m = pick(l, n.p.id, n.p.id); if (m) v += l.f * csv(m, n.p.id); });
      return Math.min(1, v);
    };
    for (let it = 0; it < 400; it++) {
      let delta = 0;
      node.forEach(n => { if (n.g) return; const v = stabOf(n); delta = Math.max(delta, Math.abs(v - n.s)); n.s = v; });
      if (delta < 1e-7) break;
    }
    node.pick = pick; node.csv = csv;
    return node;
  }
  // A new piece's stability against the structure as it stands (what Rust checks when you place it).
  function candidateStability(c) {
    if (!isStab(c)) return null;
    if (c.kind === "F") return 1;
    const node = S.solved || (S.solved = solveStability(all()));
    const list = all(), tmp = Object.assign({}, c, { id: -1 });
    const sup = supportLinks(tmp, femaleIndexOf(list), wallEndIndex(list));
    let v = 0;
    sup.forEach(l => {
      const ids = l.c.filter(id => node.has(id));
      const m = node.pick({ c: ids }, -1, -1);
      if (m) v += l.f * node.csv(m, -1);
    });
    return Math.min(1, v);
  }
  function stabilityOf(p) {
    if (!isStab(p)) return null;
    const node = S.solved || (S.solved = solveStability(all()));
    const n = node.get(p.id);
    return n ? n.s : null;
  }
  const pct = v => (v >= 0.995 ? 100 : v < 0.01 && v > 0 ? "<1" : Math.round(v * 100)) + "%";

  function validate(c) {
    if (c.L > MAX_LEVEL + 1) return "That's as high as the sandbox goes for now";
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
      if (overlapsAny(poly, o => o.kind === "S" && Hof(o) < H - 0.1 && Hof(o) > H - 3.1)) return "The stairs below need this space open";
    }
    if (c.kind === "W") {
      const top = H + WALL_HT[c.prefab];
      const clash = all().find(o => o.kind === "W" && Math.abs(o.mx - c.mx) < 0.05 && Math.abs(o.mz - c.mz) < 0.05 && Hof(o) < top - 0.05 && Hof(o) + WALL_HT[o.prefab] > H + 0.05);
      if (clash) return "That would run into the " + prefabName(clash.prefab).toLowerCase() + " here";
    }
    if (c.kind === "S") {
      if (get(fpKey(c.cx, c.cz, H + 3))) return "Stairs need an opening above; remove that floor first";
      if (overlapsAny(poly, o => o.kind === "X" && sameH(Hof(o), H))) return "Clear the items off this floor first";
    }
    if (c.kind === "X" && c.ground) {
      const g = groundUnder(poly);
      if (g.max - g.min > 0.8) return "Too steep here";
      return deployBlocked(c);
    }
    if (c.kind === "X") { const b = deployBlocked(c); if (b) return b; }
    if (!supported(c)) return REASON[c.kind];
    if (c.kind !== "F") {
      const st = candidateStability(c);
      c.stab = st;
      if (st !== null && st < COLLAPSE) return "Not stable enough (" + pct(st) + "; Rust needs 5%)";
    }
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

  // Foundation fits the ground at this top height: not buried, and reaching down to it.
  function groundFits(poly, top) {
    const g = groundUnder(poly);
    return g.max <= top + 0.05 && g.min >= top - FOUNDATION_DEPTH;
  }
  function allFemales(type) {
    const out = [];
    all().forEach(p => femalesOf(p).forEach(f => { if (f.type === type) out.push(f); }));
    return out;
  }
  function snap(sx, sy) {
    const prefab = ui.prefab, kind = kindOf(prefab), shape = SHAPE[prefab];
    let c = null;
    if (kind === "F") {
      // Measured: a foundation's male sockets sit level with a neighbour's edge, or 1.5 m above or below it.
      const opts = [];
      all().forEach(f => {
        if (f.kind !== "F") return;
        edgesOf(f).forEach(e => {
          const a = attach(e, shape), poly = shapeVerts(shape, a.cx, a.cz, a.theta);
          [0, 1.5, -1.5].forEach(dy => {
            const by = R2(f.by + dy), top = by + 1;
            if (S.sock.has(fpKey(a.cx, a.cz, top)) || !groundFits(poly, top)) return;
            opts.push(Object.assign({}, a, { by, ref: [a.cx, top, a.cz] }));
          });
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
    } else if (kind === "FL") {
      // Floor sockets: wall tops, half-wall tops, wall middles (both sides), floor edges, roof edges.
      const opts = [], seen = new Set();
      allFemales("FL").forEach(f => {
        const L = Lfor(f.H, f.by);
        if (!inCeil(L)) return;
        const fp = attach(f.e, shape), k = fpKey(fp.cx, fp.cz, f.H);
        if (seen.has(k) || S.sock.has(k)) return;
        seen.add(k);
        opts.push(Object.assign(fp, { by: f.by, L, ref: [fp.cx, f.H, fp.cz] }));
      });
      const best = nearestOnScreen(opts, sx, sy, SNAP_PX);
      if (best) c = { shape, L: best.L, by: best.by, cx: best.cx, cz: best.cz, theta: best.theta, rot: norm(-best.theta) };
    } else if (kind === "RF") {
      // A roof's low edge goes on a Wall socket (a wall or half-wall top, or a foundation or floor edge)
      // and it rises 3 m across its width. R turns it to stand on another edge under the same spot.
      const opts = [];
      allFemales("W").forEach(f => {
        const L = Lfor(f.H, f.by);
        if (!inCeil(L)) return;
        [f.e, flip(f.e)].forEach(e => {
          const fp = attach(e, shape), k = fpKey(fp.cx, fp.cz, f.H);
          if (S.sock.has(k)) return;
          const dx = -e.nx, dz = -e.nz;
          const rot = norm((shape === "sq" ? Math.atan2(-dx, -dz) : Math.atan2(dx, dz)) * 180 / Math.PI);
          if (opts.some(o => o.k === k && Math.abs(o.rot - rot) < 0.5)) return;
          opts.push(Object.assign(fp, { k, by: f.by, L, rot, ref: [fp.cx, f.H + 0.75, fp.cz] }));
        });
      });
      const near = nearestOnScreen(opts, sx, sy, SNAP_PX);
      if (near) {
        const same = opts.filter(o => o.k === near.k).sort((x, y) => x.rot - y.rot);
        const best = same[((ui.rot % same.length) + same.length) % same.length];
        c = { shape, L: best.L, by: best.by, cx: best.cx, cz: best.cz, theta: best.theta, rot: best.rot };
      }
    } else if (kind === "S") {
      const opts = all().filter(s => isSolidSurface(s) && inBand(s.L) && s.shape === shape && !all().some(o => o.kind === "S" && sameH(Hof(o), Hof(s)) && Math.hypot(o.cx - s.cx, o.cz - s.cz) < 0.1))
        .map(s => ({ cx: s.cx, cz: s.cz, theta: s.theta, by: s.by, L: s.L, half: 0, ref: [s.cx, Hof(s), s.cz] }));
      // A spiral stair can take a second spiral on top to climb the rest of the storey.
      if (SPIRALS.has(prefab)) all().forEach(o => {
        if (o.prefab === prefab && inBand(o.L) && !o.half && !S.sock.has("S" + fpKey(o.cx, o.cz, Hof(o)) + ":1"))
          opts.push({ cx: o.cx, cz: o.cz, theta: o.theta, by: o.by, L: o.L, half: 1, ref: [o.cx, Hof(o) + SPIRAL_RISE, o.cz] });
      });
      const best = nearestOnScreen(opts, sx, sy, SNAP_PX);
      if (best) c = { shape, L: best.L, by: best.by, cx: best.cx, cz: best.cz, theta: best.theta, half: best.half, rot: norm(-(best.theta + ui.rot * TURN[shape]) + (best.half ? 180 : 0)) };
    } else if (kind === "W") {
      // Wall sockets: foundation and floor edges, full-wall and half-wall tops, a square roof's high edge.
      const seen = new Set(), opts = [];
      const ht = WALL_HT[prefab] || 3;
      allFemales("W").forEach(f => {
        const L = Lfor(f.H, f.by), k = edgeKey(f.e, f.H);
        if (!inBand(L) || seen.has(k)) return;
        seen.add(k);
        // Skip spots that are taken (say, the foundation edge under a half wall), so aiming at the face of
        // a wall snaps to the free spot on top of it rather than to the one it already fills.
        if (S.sock.has(k)) return;
        if (all().some(o => o.kind === "W" && Math.abs(o.mx - f.e.mx) < 0.05 && Math.abs(o.mz - f.e.mz) < 0.05 && Hof(o) < f.H + ht - 0.05 && Hof(o) + WALL_HT[o.prefab] > f.H + 0.05)) return;
        opts.push({ mx: f.e.mx, mz: f.e.mz, a: f.e.a, nx: f.e.nx, nz: f.e.nz, by: f.by, L, ref: [f.e.mx, f.H + 0.3, f.e.mz] });
      });
      const best = nearestOnScreen(opts, sx, sy, SNAP_PX);
      if (best) c = { L: best.L, by: best.by, mx: best.mx, mz: best.mz, a: best.a, nx: best.nx, nz: best.nz, rot: norm(wallRot(best.a) + (ui.rot % 2 ? 180 : 0)) };
    } else if (kind === "D") {
      const wallType = SOCKET_WALL[placeOf(prefab)];
      const opts = all().filter(o => o.kind === "W" && inBand(o.L) && o.prefab === wallType)
        .map(o => ({ mx: o.mx, mz: o.mz, a: o.a, nx: o.nx, nz: o.nz, by: o.by, L: o.L, rot: o.rot, ref: [o.mx, Hof(o) + 1.2, o.mz] }));
      const best = nearestOnScreen(opts, sx, sy, SNAP_PX);
      if (best) c = { L: best.L, by: best.by, mx: best.mx, mz: best.mz, a: best.a, nx: best.nx, nz: best.nz, rot: norm(best.rot + (ui.rot % 2 ? 180 : 0)) };
    } else if (kind === "H") {
      const frameType = placeOf(prefab) === "hatch.tri" ? "floor.triangle.frame" : "floor.frame";
      const opts = all().filter(o => o.prefab === frameType && (inBand(o.L) || inCeil(o.L)))
        .map(o => ({ shape: o.shape, L: o.L, by: o.by, cx: o.cx, cz: o.cz, theta: o.theta, rot: o.rot, ref: [o.cx, Hof(o), o.cz] }));
      const best = nearestOnScreen(opts, sx, sy, SNAP_PX);
      if (best) c = { shape: best.shape, L: best.L, by: best.by, cx: best.cx, cz: best.cz, theta: best.theta, rot: best.rot };
    } else {
      const rot = norm(ui.rot * 90);
      const hit = pieceUnder(sx, sy, p => isSolidSurface(p) && inBand(p.L));
      if (hit) {
        c = { L: hit.piece.L, by: hit.piece.by, x: Math.round(hit.point.x * 100) / 100, z: Math.round(hit.point.z * 100) / 100, rot };
      } else if (ui.level === 0 && terrainMesh) {
        // Most deployables can also go straight on the ground, like in Rust.
        setRay(sx, sy);
        const t = ray.intersectObject(terrainMesh)[0];
        if (t) {
          const x = Math.round(t.point.x * 100) / 100, z = Math.round(t.point.z * 100) / 100;
          const g = groundUnder(footRect(prefab, x, z, rot));
          c = { L: 0, by: R2(g.max - 1), x, z, rot, ground: true };
        }
      }
    }
    if (!c) return null;
    Object.assign(c, { prefab, kind, grade: STRUCTURAL.has(prefab) ? "twigs" : "wood" });
    if (kind === "X") {
      settleItem(c);
      if (c.ground) { const g = groundUnder(footRect(prefab, c.x, c.z, c.rot)); c.by = R2(g.max - 1); }
    }
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
  // Like Rust: pieces left under 5% stability fall, then whatever they were holding is checked again.
  function collapse(ops) {
    for (let round = 0; round < 200; round++) {
      const ok = groundedIds();
      const node = solveStability(all());
      const fall = all().filter(p => !ok.has(p.id) || (node.has(p.id) && !node.get(p.id).g && node.get(p.id).s < COLLAPSE));
      if (!fall.length) { S.solved = node; return; }
      fall.forEach(p => ops.push({ type: "remove", p: doRemove(p.id) }));
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
    settle(p);
    const ops = [{ type: "place", p: snapshot(p) }];
    collapse(ops);
    commit(ops);
  }
  // A placed piece drops the last few centimetres into place with a little puff of dust (Cozy only).
  function settle(p) {
    if (reduceMotion || !Look.cozy() || !p.mesh) return;
    drops.set(p.id, { start: performance.now(), mesh: p.mesh, y: p.mesh.position.y, p, puffed: false });
  }
  function runDrops(now) {
    drops.forEach((d, id) => {
      const e = Math.min(1, (now - d.start) / 260);
      d.mesh.position.y = d.y + Math.pow(1 - e, 3) * 0.55;
      if (e >= 1) {
        d.mesh.position.y = d.y;
        drops.delete(id);
        const pp = d.p, big = pp.kind === "F" || pp.kind === "FL" || pp.kind === "RF";
        const x = pp.kind === "W" || pp.kind === "D" || pp.kind === "FS" ? pp.mx : pp.cx !== undefined ? pp.cx : pp.pos[0];
        const z = pp.kind === "W" || pp.kind === "D" || pp.kind === "FS" ? pp.mz : pp.cz !== undefined ? pp.cz : pp.pos[2];
        dust.emit(x, d.y + (pp.kind === "F" ? -0.05 : 0.02), z, big ? 1.4 : 0.7, big ? 26 : 12);
      }
    });
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
    if (p.kind === "F" || p.kind === "FL" || p.kind === "FS" || p.kind === "H") return flash(prefabName(p.prefab) + " doesn't rotate");
    const step = p.kind === "W" || p.kind === "D" ? 180 : p.kind === "X" ? 90 : TURN[p.shape];
    const old = p.rot, nr = norm(old - step);
    if (p.kind === "X") {
      const test = Object.assign({}, p, { rot: nr });
      const b = deployBlocked(test) || (!deployOk(test) ? REASON.X : null);
      if (b) return flash(b);
    }
    if (p.kind === "RF" && !supported(Object.assign({}, p, { rot: nr }))) return flash("Its low edge would have nothing to stand on");
    doRot(id, nr);
    const ops = [{ type: "rot", id, from: old, to: nr }];
    collapse(ops);
    commit(ops);
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
    const placingCeiling = ui.tool === "place" && (k === "FL" || k === "RF" || k === "H");
    all().forEach(p => {
      let v = true;
      if (ui.hideAbove) v = p.L < ui.level + 0.99 || (placingCeiling && (p.kind === "FL" || p.kind === "RF") && p.L < ui.level + 1.51);
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

  // ---------- Pointer ----------
  function local(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return [clientX - r.left, clientY - r.top];
  }
  function updateHover() {
    if (!lastPointer) return;
    const [sx, sy] = lastPointer;
    clearHighlight();
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
      if (!flashTimer) setHint(why || "Click to place " + prefabName(c.prefab).toLowerCase() + (c.stab != null && c.kind !== "F" ? " · stability " + pct(c.stab) : ""), !!why);
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
  const wheelEl = $("wheel"), wheelSvg = $("wheelSvg"), wheelIcon = $("wheelIcon"), wheelName = $("wheelName"), wheelSub = $("wheelSub");
  const W = { open: false, sticky: false, items: [], hovered: null, cx: 0, cy: 0, scale: 1, openedAt: 0, start: null, segs: [] };
  const SVGNS = "http://www.w3.org/2000/svg";
  const R0 = 146, R1 = 206, POP = 16, ICON = 34;
  function gradeIcon(g) {
    return '<svg class="ic glyph" viewBox="0 0 48 48" aria-hidden="true"><rect x="9" y="9" width="30" height="30" rx="3" style="fill:' + GRADES[g].hex + '"/><path d="M9 19h30M9 29h30M19 9v10M29 19v10M19 29v10"/></svg>';
  }
  function wheelItems() {
    if (ui.slot === "plan") return PLAN.map(id => ({ id, name: prefabName(id), desc: describe(id), icon: isoIcon(id) }));
    if (ui.slot === "hammer") return HAMMER.map(h => Object.assign({}, h, { icon: GRADES[h.id] ? gradeIcon(h.id) : GLYPHS[h.id] }));
    return ui.recent.map(id => ({ id, name: prefabName(id), desc: describe(id), icon: isoIcon(id) }));
  }
  const selectedId = () => (ui.slot === "plan" ? ui.plan : ui.slot === "hammer" ? ui.hammer : ui.deploy);
  function arcPath(r0, r1, a0, a1) {
    const P = (r, a) => (r * Math.cos(rad(a))).toFixed(2) + " " + (r * Math.sin(rad(a))).toFixed(2);
    const large = a1 - a0 > 180 ? 1 : 0;
    return "M" + P(r1, a0) + " A" + r1 + " " + r1 + " 0 " + large + " 1 " + P(r1, a1) + " L" + P(r0, a1) + " A" + r0 + " " + r0 + " 0 " + large + " 0 " + P(r0, a0) + " Z";
  }
  function renderWheel() {
    wheelSvg.innerHTML = "";
    W.items = wheelItems();
    W.segs = [];
    const n = W.items.length, step = 360 / n;
    const ring = document.createElementNS(SVGNS, "circle");
    ring.setAttribute("r", String((R0 + R1) / 2)); ring.setAttribute("class", "wring");
    ring.setAttribute("stroke-width", String(R1 - R0));
    wheelSvg.appendChild(ring);
    W.items.forEach((it, i) => {
      const mid = -90 + i * step;
      const g = document.createElementNS(SVGNS, "g");
      g.setAttribute("class", "wseg");
      const path = document.createElementNS(SVGNS, "path");
      path.setAttribute("d", arcPath(R0, R1, mid - step / 2, mid + step / 2));
      g.appendChild(path);
      const rm = (R0 + R1) / 2;
      const holder = document.createElementNS(SVGNS, "g");
      holder.setAttribute("transform", "translate(" + (rm * Math.cos(rad(mid)) - ICON / 2).toFixed(1) + " " + (rm * Math.sin(rad(mid)) - ICON / 2).toFixed(1) + ")");
      holder.innerHTML = it.icon.replace("<svg ", '<svg width="' + ICON + '" height="' + ICON + '" ');
      g.appendChild(holder);
      wheelSvg.appendChild(g);
      W.segs.push({ g, path, holder, mid, step });
    });
    showWheelItem(W.items.find(it => it.id === selectedId()) || null, true);
  }
  // Highlight one segment: red, popped outward, with its details in the centre.
  function showWheelItem(it, isCurrent) {
    W.items.forEach((x, i) => {
      const seg = W.segs[i], on = !!it && x.id === it.id;
      seg.g.classList.toggle("hot", on);
      seg.path.setAttribute("d", arcPath(R0, on ? R1 + POP : R1, seg.mid - seg.step / 2, seg.mid + seg.step / 2));
      const rm = (R0 + R1 + (on ? POP : 0)) / 2;
      seg.holder.setAttribute("transform", "translate(" + (rm * Math.cos(rad(seg.mid)) - ICON / 2).toFixed(1) + " " + (rm * Math.sin(rad(seg.mid)) - ICON / 2).toFixed(1) + ")");
    });
    wheelIcon.innerHTML = it ? it.icon : "";
    wheelName.textContent = it ? it.name : "";
    wheelSub.textContent = it ? (W.target ? targetLine(it) : it.desc) : "";
    wheelEl.classList.toggle("current", !!isCurrent);
  }
  function targetLine(it) {
    const t = W.target, nm = (STRUCTURAL.has(t.prefab) ? gradeName(t.grade) + " " : "") + prefabName(t.prefab).toLowerCase();
    const st = stabilityOf(t);
    if (st != null && it.id === "demolish") return "Demolish this " + nm + " (stability " + pct(st) + ")";
    if (GRADES[it.id]) return "Upgrade this " + nm + " to " + GRADES[it.id].name.toLowerCase();
    return (it.id === "rotate" ? "Rotate this " : "Demolish this ") + nm;
  }
  function openWheel(sx, sy, sticky) {
    renderWheel();
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const outer = R1 + POP + 6;
    W.scale = Math.min(1, (Math.min(vw, vh) - 16) / (outer * 2));
    const half = outer * W.scale;
    W.cx = Math.max(half + 4, Math.min(vw - half - 4, sx));
    W.cy = Math.max(half + 4, Math.min(vh - half - 4, sy));
    wheelEl.style.left = W.cx + "px";
    wheelEl.style.top = W.cy + "px";
    wheelEl.style.setProperty("--wheel-scale", W.scale);
    wheelEl.hidden = false;
    W.open = true; W.sticky = !!sticky; W.btns = sticky ? 0 : 2; W.hovered = null; W.openedAt = performance.now(); W.start = [sx, sy];
    // Like Rust: the hammer wheel acts on the piece you were looking at when you opened it.
    W.target = null;
    if (ui.slot === "hammer" && !sticky) { const hit = pieceUnder(sx, sy); if (hit) W.target = hit.piece; }
    hideGhost(); clearHighlight();
    if (W.target) highlight(W.target);
    showWheelItem(W.items.find(it => it.id === selectedId()) || null, true);
    return true;
  }
  function wheelHit(sx, sy) {
    const dx = (sx - W.cx) / W.scale, dy = (sy - W.cy) / W.scale;
    if (Math.hypot(dx, dy) < 40) return null; // dead zone in the middle
    const n = W.items.length, step = 360 / n;
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;
    return W.items[((Math.round((ang + 90) / step) % n) + n) % n];
  }
  function wheelHover(sx, sy) {
    const it = wheelHit(sx, sy);
    if (it === W.hovered) return;
    W.hovered = it;
    if (it) showWheelItem(it, false);
    else showWheelItem(W.items.find(x => x.id === selectedId()) || null, true);
  }
  function closeWheel(choose) {
    if (!W.open) return;
    W.open = false;
    wheelEl.hidden = true;
    const target = W.target;
    W.target = null;
    if (choose && W.hovered) {
      chooseFromWheel(W.hovered.id);
      if (target && S.pieces.has(target.id)) {
        if (ui.tool === "demolish") actDemolish(target.id);
        else if (ui.tool === "rotate") actRotate(target.id);
        else if (ui.tool === "upgrade") actUpgrade(target.id);
      }
    }
    W.hovered = null;
    updateHover();
  }
  function chooseFromWheel(id) {
    if (ui.slot === "plan") ui.plan = id;
    else if (ui.slot === "hammer") ui.hammer = id;
    else if (ui.slot === "deploy") pickDeployable(id);
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
    const st = stabilityOf(p);
    return toolHintBase(p) + (st != null ? " · stability " + pct(st) : "");
  }
  function toolHintBase(p) {
    if (ui.tool === "upgrade") return STRUCTURAL.has(p.prefab) ? "Upgrade " + gradeName(p.grade) + " " + prefabName(p.prefab).toLowerCase() + " to " + gradeName(ui.grade) : prefabName(p.prefab) + " has no grade";
    if (ui.tool === "rotate") return "Rotate " + prefabName(p.prefab).toLowerCase();
    return "Demolish " + prefabName(p.prefab).toLowerCase();
  }
  function hammerLabel() {
    return GRADES[ui.hammer] ? "Upgrade to " + GRADES[ui.hammer].name : ui.hammer === "rotate" ? "Rotate" : "Demolish";
  }
  const SLOT_NAMES = { plan: "Building Plan", hammer: "Hammer", deploy: "Deployables" };
  function updateHeader() {
    $("bKicker").textContent = SLOT_NAMES[ui.slot] + " · " + (LEVEL_NAMES[ui.level] || "Level " + (ui.level + 1));
    $("bLabel").textContent = ui.slot === "hammer" ? hammerLabel() : prefabName(ui.prefab);
    $("lvlLabel").textContent = LEVEL_NAMES[ui.level] || "Level " + (ui.level + 1);
    $("slotPlanSub").textContent = prefabName(ui.plan);
    $("slotHammerSub").textContent = hammerLabel();
    document.querySelectorAll(".slot").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.slot === ui.slot)));
    document.querySelectorAll("#deployList .dock-item").forEach(b => b.setAttribute("aria-pressed", String(ui.slot === "deploy" && b.dataset.prefab === ui.deploy)));
  }
  function updateStats() {
    let pieces = 0, deploy = 0;
    const grades = {};
    S.pieces.forEach(p => {
      if (STRUCTURAL.has(p.prefab)) { pieces++; grades[p.grade] = (grades[p.grade] || 0) + 1; }
      else deploy++;
    });
    const last = S.events[S.events.length - 1];
    $("bStatsLine").textContent = pieces + " pieces · " + deploy + " items · " + fmt(last ? last.t : 0) + " build";
    fillGradeBar($("bGrades"), grades);
    $("bUndo").disabled = !S.undo.length;
    $("bRedo").disabled = !S.redo.length;
  }
  function afterChange() {
    S.solved = null;
    if (decor) decor.setAvoid(decorAvoid());
    refreshVisibility();
    updateStats();
    save();
  }

  function pickDeployable(id) {
    ui.deploy = id;
    ui.recent = [id].concat(ui.recent.filter(x => x !== id)).slice(0, 8);
  }
  function selectSlot(slot) {
    const prevPrefab = ui.prefab;
    ui.slot = slot;
    if (slot === "plan") { ui.tool = "place"; ui.prefab = ui.plan; }
    else if (slot === "deploy") { ui.tool = "place"; ui.prefab = ui.deploy; }
    else if (slot === "hammer") {
      if (GRADES[ui.hammer]) { ui.tool = "upgrade"; ui.grade = ui.hammer; }
      else ui.tool = ui.hammer;
    }
    if (ui.prefab !== prevPrefab) ui.rot = 0;
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

  // ---------- Walk mode ----------
  function surfaceTopAt(x, z) {
    // The lowest foundation or floor top under a point (where you'd stand on entering), else the ground.
    let best = null;
    all().forEach(p => {
      if (!isSolidSurface(p) && p.kind !== "FL") return;
      if (!pointInPoly(x, z, polyOf(p))) return;
      const top = Hof(p) + (p.kind === "FL" ? FLOOR_T / 2 : 0);
      if (best === null || top < best) best = top;
    });
    return best === null ? heightAt(x, z) : best;
  }
  function startWalk() {
    if (Walk.active()) return;
    closeWheel(false);
    hideGhost(); clearHighlight();
    const t = controls.target, dx = t.x - camera.position.x, dz = t.z - camera.position.z;
    all().forEach(p => { p.mesh.visible = true; });
    viewport.classList.add("walking");
    $("walkHud").hidden = false;
    Walk.start({
      pieces: all().map(p => ({ id: p.id, prefab: p.prefab, pos: p.pos, rot: p.rot })),
      groundAt: heightAt,
      spawn: { x: t.x, z: t.z, y: surfaceTopAt(t.x, t.z), yaw: Math.atan2(-dx, -dz) },
      // Prefer standing inside the base: the spot in view, then each ground-floor surface, nearest first.
      spawnCandidates: [{ x: t.x, z: t.z, y: surfaceTopAt(t.x, t.z) }].concat(
        all().filter(p => (p.kind === "F" || (p.kind === "FL" && SOLID_FLOORS.has(p.prefab))) && p.L === ui.level)
          .sort((a, b) => Math.hypot(a.cx - t.x, a.cz - t.z) - Math.hypot(b.cx - t.x, b.cz - t.z))
          .map(p => ({ x: p.cx, z: p.cz, y: Hof(p) + (p.kind === "FL" ? FLOOR_T / 2 : 0) }))),
      canvas, root,
      pieceById: id => S.pieces.get(id),
      onLock: locked => { $("walkLook").hidden = locked; },
      onExit: () => {
        viewport.classList.remove("walking");
        $("walkHud").hidden = true;
        refreshVisibility();
        updateHover();
      }
    });
    Walk.resize(viewport.clientWidth, viewport.clientHeight);
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

  // Deployables window: category tabs, search, scrolling list of every item.
  function deployRow(c, o) {
    o = o || {};
    const b = el("button", "dock-item" + (c.extra ? " extra" : ""));
    b.type = "button";
    b.dataset.prefab = c.id;
    const isWb = o.workbench, id = isWb ? "workbench" + ui.wb : c.id, shown = CATALOG_BY_ID[id];
    b.title = (isWb ? "Workbench" : c.name) + " · " + sizeText(shown) + " (measured)";
    const active = ui.slot === "deploy" && (isWb ? /^workbench[123]$/.test(ui.deploy) : c.id === ui.deploy);
    b.setAttribute("aria-pressed", String(active));
    const ic = el("span", "dock-icon"); ic.innerHTML = isoIcon(id);
    const txt = el("span", "dock-text");
    const meta = (o.showCat ? c.cat + " · " : "") + (c.extra && o.showCat ? "Skin/seasonal · " : "") + MOUNT[shown.place] + " · " + sizeText(shown);
    txt.append(el("span", "dock-name", isWb ? "Workbench" : c.name), el("span", "dock-meta", meta));
    b.append(ic, txt);
    if (isWb) {
      const lv = el("span", "dock-levels");
      lv.setAttribute("role", "group"); lv.setAttribute("aria-label", "Workbench level");
      [1, 2, 3].forEach(n => {
        const k = el("span", "dock-lv", String(n));
        k.setAttribute("role", "button"); k.tabIndex = 0;
        k.title = "Workbench level " + n;
        k.setAttribute("aria-pressed", String(ui.wb === n));
        const pick = e => { e.stopPropagation(); ui.wb = n; pickDeployable("workbench" + n); selectSlot("deploy"); };
        k.addEventListener("click", pick);
        k.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(e); } });
        lv.appendChild(k);
      });
      b.appendChild(lv);
    }
    b.addEventListener("click", () => { pickDeployable(id); selectSlot("deploy"); });
    return b;
  }
  function renderDeployList() {
    const list = $("deployList");
    list.innerHTML = "";
    const term = ui.search.trim().toLowerCase();
    let count = 0;
    if (term) {
      const items = CATALOG.filter(c => c.name.toLowerCase().indexOf(term) >= 0 || c.id.indexOf(term) >= 0)
        .sort((a, b) => (a.extra - b.extra) || a.name.localeCompare(b.name));
      items.forEach(c => list.appendChild(deployRow(c, { showCat: true })));
      count = items.length;
      if (!items.length) list.appendChild(el("p", "dock-empty", "Nothing matches “" + ui.search.trim() + "”."));
    } else if (ui.cat === "Essentials") {
      ESSENTIALS.forEach(id => list.appendChild(deployRow(CATALOG_BY_ID[id], { workbench: id === "workbench1" })));
      count = ESSENTIALS.length;
    } else {
      const main = CATALOG.filter(c => c.cat === ui.cat && !c.extra), extra = CATALOG.filter(c => c.cat === ui.cat && c.extra);
      main.forEach(c => list.appendChild(deployRow(c)));
      count = main.length;
      if (!main.length) list.appendChild(el("p", "dock-empty", "Nothing here is used much in base building; it's all in the section below."));
      if (extra.length) {
        const open = !!ui.extraOpen[ui.cat];
        const h = el("button", "dock-extra-head");
        h.type = "button";
        h.setAttribute("aria-expanded", String(open));
        h.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4"/></svg>';
        h.append(document.createTextNode("Skins, seasonal & decor"), el("span", "dock-extra-n", String(extra.length)));
        h.addEventListener("click", () => { ui.extraOpen[ui.cat] = !open; renderDeployList(); if (!open) h.scrollIntoView({ block: "nearest" }); });
        list.appendChild(h);
        if (open) extra.forEach(c => list.appendChild(deployRow(c)));
      }
    }
    document.querySelectorAll("#deployTabs button").forEach(b => b.setAttribute("aria-pressed", String(!term && b.dataset.cat === ui.cat)));
    $("deployCount").textContent = count + (count === 1 ? " item" : " items");
  }
  const MOUNT = { free: "Floor or ground", doorway: "Doorway", frame: "Wall frame", window: "Window", hatch: "Floor frame", "hatch.tri": "Triangle floor frame" };
  function buildDeployWindow() {
    const tabs = $("deployTabs");
    DEPLOY_CATS.forEach(cat => {
      const b = el("button", null, cat);
      b.type = "button";
      b.dataset.cat = cat;
      b.addEventListener("click", () => { ui.cat = cat; ui.search = ""; $("deploySearch").value = ""; renderDeployList(); $("deployList").scrollTop = 0; });
      tabs.appendChild(b);
    });
    $("deploySearch").addEventListener("input", e => { ui.search = e.target.value; renderDeployList(); });
    $("deployToggle").addEventListener("click", () => {
      const win = $("deployWin");
      const open = win.classList.toggle("collapsed") === false;
      $("deployToggle").setAttribute("aria-expanded", String(open));
      $("deployToggle").textContent = open ? "Hide" : "Show";
    });
    renderDeployList();
  }

  function buildPanels() {
    buildDeployWindow();
    $("slotPlanIcon").innerHTML = GLYPHS.plan;
    $("slotHammerIcon").innerHTML = GLYPHS.hammer;
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
      if (slot === ui.slot) openWheel(viewport.clientWidth / 2, viewport.clientHeight / 2, true);
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

    $("bWalk").addEventListener("click", startWalk);
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
    $("bUpAllToggle").addEventListener("click", () => { const box = $("upAllBox"); box.hidden = !box.hidden; });
    viewport.addEventListener("contextmenu", e => e.preventDefault());

    document.addEventListener("keydown", e => {
      if (!active || Walk.active()) return;
      if (e.key.toLowerCase() === "v" && !e.target.closest("input, select, textarea") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); startWalk(); return; }
      if (e.target.closest("input, select, textarea")) return;
      const k = e.key.toLowerCase();
      if (k === "escape" && W.open) { closeWheel(false); return; }
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === "r") { ui.rot++; updateHover(); }
      else if (k === "[" || e.key === "PageDown") setLevel(ui.level - 1);
      else if (k === "]" || e.key === "PageUp") setLevel(ui.level + 1);
      else if (/^[1-2]$/.test(k)) selectSlot(SLOTS[Number(k) - 1]);
    });
  }

  // ---------- Setup and render loop ----------
  function resize() {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if (!w || !h) return;
    view.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    Walk.resize(w, h);
  }
  function init() {
    view = Look.makeView(canvas);
    renderer = view.renderer;
    stage = makeStage();
    scene = stage.scene;
    stage.gridWanted = false;
    stage.grid.visible = false;
    stage.ground.visible = false;
    dust = makeDust(scene);
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

    const saved = loadSaved();
    setTerrain(saved && saved.seed ? saved.seed : newSeed());
    if (saved && Array.isArray(saved.pieces)) restore(saved); else seedStarter();
    buildPanels();
    Look.mountPanel(viewport);
    Look.onChange(() => { if (decor && decor.level !== Look.level()) buildDecor(); });
    selectSlot("plan");
    afterChange();
    frameBuild();

    let down = null;
    canvas.addEventListener("pointermove", e => { if (Walk.active()) return; lastPointer = local(e.clientX, e.clientY); if (!down && !W.open) updateHover(); });
    canvas.addEventListener("pointerdown", e => {
      if (Walk.active()) return;
      if (W.open) { e.preventDefault(); closeWheel(e.button === 0 && !!W.hovered); return; }
      if (e.button === 2) {
        e.preventDefault();
        const [sx, sy] = local(e.clientX, e.clientY);
        openWheel(sx, sy, false);
        return;
      }
      down = { x: e.clientX, y: e.clientY, b: e.button };
    });
    canvas.addEventListener("pointerup", e => {
      if (Walk.active()) return;
      const d = down; down = null;
      if (!d || d.b !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; // that was an orbit drag
      lastPointer = local(e.clientX, e.clientY);
      updateHover();
      act();
    });
    // Like Rust: hold right-click to open the wheel, point at an option, left-click to pick it.
    // Letting go of right-click without clicking just closes it.
    // A left press while the right button is held is a "chorded" press: browsers report it as a
    // pointermove whose buttons now include the left one, not as a pointerdown.
    function heldPick(e) {
      const [sx, sy] = local(e.clientX, e.clientY);
      wheelHover(sx, sy);
      if (W.hovered) closeWheel(true);
    }
    window.addEventListener("pointermove", e => {
      if (!W.open || W.sticky) return;
      const leftNow = (e.buttons & 1) === 1, leftBefore = (W.btns & 1) === 1;
      W.btns = e.buttons;
      if (leftNow && !leftBefore) { e.preventDefault(); heldPick(e); return; }
      const [sx, sy] = local(e.clientX, e.clientY);
      wheelHover(sx, sy);
    });
    window.addEventListener("mousedown", e => {
      if (!W.open || W.sticky || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      heldPick(e);
    }, true);
    window.addEventListener("pointerup", e => {
      if (!W.open || W.sticky || e.button !== 2) return;
      const [sx, sy] = local(e.clientX, e.clientY);
      const quick = performance.now() - W.openedAt < 400 && Math.hypot(sx - W.start[0], sy - W.start[1]) < 8;
      if (quick && !W.hovered) { W.sticky = true; return; } // a quick right-click leaves it open for clicking
      closeWheel(false);
    });
    canvas.addEventListener("pointerleave", () => { if (!W.open && !Walk.active()) { hideGhost(); clearHighlight(); hover = null; } });
    if (window.ResizeObserver) new ResizeObserver(resize).observe(viewport);
    window.addEventListener("resize", resize);
    requestAnimationFrame(tick);
    ready = true;
  }
  const fly = makeFlyKeys(() => active && !W.open && !Walk.active());
  let lastFrame = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (active) {
      Look.tick(dt);
      runDrops(now);
      dust.update(dt);
      if (Walk.active()) {
        Walk.update(dt);
        const wc = Walk.camera();
        Look.follow(stage, wc.position);
        view.render(scene, wc, stage);
      } else {
        if (fly.step(dt, camera, controls)) updateHover();
        controls.autoRotate = Look.state.orbit && !reduceMotion;
        controls.autoRotateSpeed = 0.35;
        controls.update();
        Look.follow(stage, controls.target);
        view.render(scene, camera, stage);
      }
    }
    requestAnimationFrame(tick);
  }

  // Test hook: lets automated checks drive the builder at a world position instead of a mouse position.
  const testApi = {
    pieces: () => all().map(p => ({ id: p.id, prefab: p.prefab, L: p.L, by: p.by, H: Hof(p), cx: p.cx, cz: p.cz, mx: p.mx, mz: p.mz, rot: p.rot })),
    demolish(id) { actDemolish(id); },
    stability() { S.solved = null; const n = solveStability(all()); const o = {}; n.forEach((v, id) => { o[id] = { s: v.s, d: v.d }; }); return o; },
    // Builds pieces directly (no snapping) from a spec in metres: used to check stability against the game.
    buildRaw(list) {
      clearAll();
      const ids = {};
      list.forEach(sp => {
        const kind = kindOf(sp.prefab), shape = SHAPE[sp.prefab], [x, y, z] = sp.at || [0, 0, 0];
        let c = { prefab: sp.prefab, kind, grade: sp.grade || "twigs", L: 0, by: y - 1 };
        if (kind === "W" || kind === "D") { const a = sp.yaw % 180 === 0 ? 0 : 90; Object.assign(c, { mx: x, mz: z, a, nx: cosd(a), nz: sind(a), rot: wallRot(a) }); }
        else if (kind === "X") Object.assign(c, { x, z, rot: sp.yaw || 0, ground: !!sp.ground, grade: "wood" });
        else if (kind === "H") Object.assign(c, { shape: "sq", cx: x, cz: z, theta: 0, rot: 0, grade: "wood" });
        else if (sp.attachTo !== undefined) {
          const host = S.pieces.get(ids[sp.attachTo]);
          const e = edgesOf(host).sort((p, q) => Math.hypot(p.mx - sp.near[0], p.mz - sp.near[1]) - Math.hypot(q.mx - sp.near[0], q.mz - sp.near[1]))[0];
          Object.assign(c, attach(e, shape)); c.rot = norm(-c.theta);
        } else if (kind === "RF") Object.assign(c, { shape, cx: x, cz: z, theta: 0, rot: norm(sp.yaw + 180) });
        else Object.assign(c, { shape, cx: x, cz: z, theta: sp.theta || 0, rot: norm(-(sp.theta || 0)) });
        const p = doPlace(c);
        ids[sp.label] = p.id;
      });
      afterChange();
      return ids;
    },
    rotate(id) { actRotate(id); },
    // Each of our models' extents against the item's measured bounds (metres; positive = sticks out).
    modelCheck() {
      return Object.keys(ITEM_MODELS).map(id => {
        const c = CATALOG_BY_ID[id], lift = c.place === "window" ? WINDOW_BOTTOM : 0;
        let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        ITEM_MODELS[id]().forEach(p => {
          const r = (p.ry || 0) * Math.PI / 180, cs = Math.abs(Math.cos(r)), sn = Math.abs(Math.sin(r));
          const hw = (p.w * cs + p.d * sn) / 2, hd = (p.w * sn + p.d * cs) / 2;
          lo = [Math.min(lo[0], p.x - hw), Math.min(lo[1], p.y - p.h / 2), Math.min(lo[2], p.z - hd)];
          hi = [Math.max(hi[0], p.x + hw), Math.max(hi[1], p.y + p.h / 2), Math.max(hi[2], p.z + hd)];
        });
        const b = c.b, bl = [b[0] - b[3] / 2, b[1] - b[4] / 2 + lift, b[2] - b[5] / 2], bh = [b[0] + b[3] / 2, b[1] + b[4] / 2 + lift, b[2] + b[5] / 2];
        const out = [0, 1, 2].map(k => Math.max(bl[k] - lo[k], hi[k] - bh[k]));
        return { id, over: out.map(v => Math.round(v * 1000) / 1000), model: [0, 1, 2].map(k => Math.round((hi[k] - lo[k]) * 1000) / 1000), measured: [b[3], b[4], b[5]] };
      });
    },
    placeItem(prefab, x, z, y, rot) {
      pickDeployable(prefab); selectSlot("deploy"); ui.rot = Math.round((rot || 0) / 90);
      const [sx, sy] = testApi.toScreen(x, y, z);
      const c = snap(sx, sy);
      if (!c) return { r: "no-snap" };
      const why = validate(c);
      if (why) return { r: why, x: c.x, z: c.z };
      actPlace(c);
      return { r: "ok", x: c.x, z: c.z };
    },
    setRot(r) { ui.rot = r; },
    setPrefab(prefab) { if (CATALOG_BY_ID[prefab]) { pickDeployable(prefab); selectSlot("deploy"); } else { ui.plan = prefab; selectSlot("plan"); } },
    setHammer(id) { ui.hammer = id; selectSlot("hammer"); },
    setLevel, selectSlot, startWalk,
    state: () => ({ slot: ui.slot, tool: ui.tool, prefab: ui.prefab, grade: ui.grade, hammer: ui.hammer }),
    newTerrain(seed) { clearAll(); setTerrain(seed); frameBuild(); },
    view(pos, target) { camera.position.set(pos[0], pos[1], pos[2]); controls.target.set(target[0], target[1], target[2]); controls.update(); },
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
      if (!v && Walk.active()) Walk.stop();
    },
    test: testApi
  };
})();
