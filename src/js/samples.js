// Example bases for the archive. All of these are made up so the site has something to show;
// real entries will come from plugin recordings and CopyPaste imports.

// ---------- Terrain helpers ----------
function heightField(size, res, fn) {
  const step = size / (res - 1), half = size / 2, heights = [];
  for (let i = 0; i < res; i++) {
    const z = -half + i * step;
    for (let j = 0; j < res; j++) {
      const x = -half + j * step;
      const edge = smoothstep(0, 10, half - Math.max(Math.abs(x), Math.abs(z))); // fade to flat ground at the edges
      heights.push(R2(fn(x, z) * edge));
    }
  }
  return { size, res, heights };
}

// ---------- Grid base helper ----------
// Cells are 3 m squares; cell (i, j) spans x [ox+3i, ox+3i+3], z [oz+3j, oz+3j+3].
// Edge "X:i:j" runs along x at z = oz+3j; edge "Z:i:j" runs along z at x = ox+3i. "@L" picks the floor.
function gridBase(o) {
  const ents = [];
  const key = (i, j) => i + "," + j;
  const cellSet = new Set(o.cells.map(c => key(c[0], c[1])));
  const E = (prefab, grade, pos, rot) => ents.push({ prefab, grade, pos: pos.map(R2), rot: rot || 0 });
  const cellPos = (i, j, y) => [o.ox + 3 * i + 1.5, y, o.oz + 3 * j + 1.5];
  const edgePos = (k, i, j, L) => (k === "X"
    ? [[o.ox + 3 * i + 1.5, o.oy + 1 + 3 * L, o.oz + 3 * j], 0]
    : [[o.ox + 3 * i, o.oy + 1 + 3 * L, o.oz + 3 * j + 1.5], 90]);
  const perimeter = [];
  o.cells.forEach(([i, j]) => {
    if (!cellSet.has(key(i, j - 1))) perimeter.push(["X", i, j]);
    if (!cellSet.has(key(i, j + 1))) perimeter.push(["X", i, j + 1]);
    if (!cellSet.has(key(i - 1, j))) perimeter.push(["Z", i, j]);
    if (!cellSet.has(key(i + 1, j))) perimeter.push(["Z", i + 1, j]);
  });
  const gr = o.grades;
  o.cells.forEach(([i, j]) => E("foundation", gr.foundation, cellPos(i, j, o.oy), 0));

  const stairHoles = new Set((o.stairs || []).map(s => key(s.i, s.j) + "@" + s.L));
  for (let L = 0; L < o.levels; L++) {
    const inner = (o.inner || []).filter(w => w.L === L).map(w => [w.k, w.i, w.j, w.prefab]);
    perimeter.map(([k, i, j]) => [k, i, j, null]).concat(inner).forEach(([k, i, j, pf]) => {
      const id = k + ":" + i + ":" + j + "@" + L;
      const prefab = pf || (o.special && o.special[id]) || "wall";
      const [pos, rot] = edgePos(k, i, j, L);
      E(prefab, prefab === "wall.doorway" ? gr.doorway || gr.walls[L] : gr.walls[L], pos, rot);
      if (prefab === "wall.doorway") E("door.hinged.metal", "metal", pos, rot);
    });
    (o.stairs || []).filter(s => s.L === L).forEach(s => E("block.stair.ushape", gr.walls[L], cellPos(s.i, s.j, o.oy + 1 + 3 * L), 0));
  }
  const top = o.roof ? o.levels : o.levels - 1;
  for (let L = 1; L <= top; L++) {
    o.cells.forEach(([i, j]) => {
      if (stairHoles.has(key(i, j) + "@" + (L - 1))) return;
      E("floor", L === o.levels ? gr.roof : gr.floors, cellPos(i, j, o.oy + 1 + 3 * L), 0);
    });
  }
  (o.items || []).forEach(([prefab, i, j, L, dx, dz, rot]) =>
    E(prefab, "wood", [o.ox + 3 * i + 1.5 + (dx || 0), o.oy + 1 + 3 * L, o.oz + 3 * j + 1.5 + (dz || 0)], rot || 0));
  return ents;
}

// ---------- 1. 2x2 Airlock Starter (hand-sequenced "recording", includes a demolished mistake) ----------
function airlockEvents() {
  const r = rng(11);
  let t = 0, nid = 1;
  const ev = [];
  const g = (a, b) => a + (b - a) * r();
  const cx = i => (i - 0.5) * 3, cz = j => (j - 0.5) * 3;
  const place = (prefab, grade, pos, rot, gap) => { t += gap; const id = nid++; ev.push({ t: R2(t), op: "place", id, prefab, grade, pos: pos.map(R2), rot }); return id; };
  const up = (id, grade, gap) => { t += gap; ev.push({ t: R2(t), op: "upgrade", id, grade }); };
  const rm = (id, gap) => { t += gap; ev.push({ t: R2(t), op: "remove", id }); };
  const F = (i, j) => [cx(i), 0, cz(j)];
  const WX = (i, j, L) => [cx(i), 1 + 3 * L, (j - 1) * 3];
  const WZ = (i, j, L) => [(i - 1) * 3, 1 + 3 * L, cz(j)];
  const FL = (i, j, L) => [cx(i), 1 + 3 * L, cz(j)];

  const fnd = [[0, 1], [1, 1], [0, 0], [1, 0]].map(([i, j]) => place("foundation", "twigs", F(i, j), 0, g(3, 7)));
  const g0 = [];
  g0.push(place("wall.doorway", "twigs", WX(0, 2, 0), 0, g(5, 9)));
  g0.push(place("wall", "twigs", WX(1, 2, 0), 0, g(2, 4)));
  g0.push(place("wall", "twigs", WZ(2, 1, 0), 90, g(2, 4)));
  g0.push(place("wall", "twigs", WZ(2, 0, 0), 90, g(2, 4)));
  g0.push(place("wall", "twigs", WX(1, 0, 0), 0, g(2, 4)));
  g0.push(place("wall", "twigs", WX(0, 0, 0), 0, g(2, 4)));
  g0.push(place("wall", "twigs", WZ(0, 0, 0), 90, g(2, 4)));
  g0.push(place("wall", "twigs", WZ(0, 1, 0), 90, g(2, 4)));
  const innerDoor = place("wall.doorway", "twigs", WZ(1, 1, 0), 90, g(4, 7));
  g0.push(innerDoor);
  g0.push(place("wall", "twigs", WX(0, 1, 0), 0, g(3, 5)));
  const oops = place("wall", "twigs", WX(1, 1, 0), 0, g(3, 5));
  rm(oops, g(7, 11));

  t += g(45, 60);
  fnd.forEach(id => up(id, "stone", g(0.7, 1.4)));
  g0.forEach(id => up(id, "stone", g(0.6, 1.2)));

  const stairs = place("block.stair.ushape", "twigs", FL(1, 0, 0), 0, g(6, 10));
  const f1 = [[0, 1], [0, 0], [1, 1]].map(([i, j]) => place("floor", "twigs", FL(i, j, 1), 0, g(2, 4)));
  const g1 = [];
  g1.push(place("wall", "twigs", WX(0, 2, 1), 0, g(3, 6)));
  g1.push(place("wall.window", "twigs", WX(1, 2, 1), 0, g(2, 4)));
  g1.push(place("wall", "twigs", WZ(2, 1, 1), 90, g(2, 4)));
  g1.push(place("wall.window", "twigs", WZ(2, 0, 1), 90, g(2, 4)));
  g1.push(place("wall", "twigs", WX(1, 0, 1), 0, g(2, 4)));
  g1.push(place("wall", "twigs", WX(0, 0, 1), 0, g(2, 4)));
  g1.push(place("wall", "twigs", WZ(0, 0, 1), 90, g(2, 4)));
  g1.push(place("wall", "twigs", WZ(0, 1, 1), 90, g(2, 4)));
  t += g(20, 30);
  up(stairs, "stone", g(1, 2));
  f1.forEach(id => up(id, "stone", g(0.7, 1.3)));
  g1.forEach(id => up(id, "stone", g(0.6, 1.2)));

  const roof = [[0, 1], [1, 1], [0, 0], [1, 0]].map(([i, j]) => place("floor", "twigs", FL(i, j, 2), 0, g(3, 5)));
  roof.forEach(id => up(id, "stone", g(0.8, 1.4)));

  t += g(70, 95);
  up(g0[0], "toptier", g(2, 3));
  up(innerDoor, "metal", g(1.5, 2.5));
  roof.forEach(id => up(id, "metal", g(0.8, 1.4)));

  place("door.hinged.metal", "metal", WX(0, 2, 0), 0, g(4, 7));
  place("door.hinged.metal", "metal", WZ(1, 1, 0), 90, g(3, 5));
  place("cupboard.tool.deployed", "wood", [cx(0) - 0.6, 1, cz(0) - 0.9], 0, g(5, 8));
  place("sleepingbag_leather_deployed", "wood", [cx(1) + 0.5, 1, cz(1)], 0, g(4, 6));
  place("box.wooden.large", "wood", [cx(1) + 0.4, 4, cz(1) - 1.05], 0, g(5, 8));
  place("box.wooden.large", "wood", [cx(0) - 1.05, 4, cz(0)], 90, g(2, 4));
  place("furnace", "stone", [cx(0) + 0.7, 4, cz(1) + 0.6], 0, g(3, 5));
  return ev;
}

// ---------- 2. Anvil Overhang: two floors tucked under an anvil rock's slab, the rock is the roof ----------
function anvilBase() {
  return gridBase({
    ox: 0, oy: 0, oz: -3, levels: 2, roof: false,
    cells: [[0, 0], [1, 0], [0, 1], [1, 1]],
    stairs: [{ i: 0, j: 0, L: 0 }],
    special: { "X:1:2@0": "wall.doorway", "Z:2:0@1": "wall.window", "Z:2:1@1": "wall.window" },
    inner: [{ k: "X", i: 1, j: 1, L: 0, prefab: "wall.doorway" }],
    grades: { foundation: "stone", walls: ["stone", "stone"], floors: "wood", roof: "stone", doorway: "metal" },
    items: [
      ["cupboard.tool.deployed", 1, 0, 0, 0.6, -0.8, 0],
      ["sleepingbag_leather_deployed", 0, 1, 0, -0.6, 0, 0],
      ["box.wooden.large", 0, 1, 1, -0.6, 0.9, 0],
      ["box.wooden.large", 1, 1, 1, 0.5, 0.9, 0],
      ["furnace", 1, 0, 1, 0.7, -0.6, 0]
    ]
  });
}
const anvilTerrain = () => heightField(72, 49, (x, z) => 0.45 * noise3(x * 0.15, 0.3, z * 0.15, 11) - 0.25);

// ---------- 3. Cave Mouth Hideaway: airlock base inside a small cave, ceiling does the roofing ----------
function caveBase() {
  return gridBase({
    ox: -3, oy: 0, oz: -3, levels: 2, roof: false,
    cells: [[0, 0], [1, 0], [0, 1], [1, 1]],
    stairs: [{ i: 1, j: 0, L: 0 }],
    special: { "X:0:2@0": "wall.doorway", "X:0:2@1": "wall.window", "X:1:2@1": "wall.window" },
    inner: [
      { k: "Z", i: 1, j: 1, L: 0, prefab: "wall.doorway" },
      { k: "X", i: 0, j: 1, L: 0, prefab: "wall" }
    ],
    grades: { foundation: "stone", walls: ["metal", "stone"], floors: "stone", roof: "stone", doorway: "toptier" },
    items: [
      ["cupboard.tool.deployed", 1, 1, 0, 0.7, 0.6, 90],
      ["sleepingbag_leather_deployed", 0, 0, 0, 0, -0.4, 90],
      ["box.wooden.large", 0, 0, 1, -0.5, -0.9, 0],
      ["box.wooden.large", 0, 1, 1, -0.9, 0.3, 90],
      ["furnace", 1, 1, 1, 0.6, 0.6, 0]
    ]
  });
}
const caveTerrain = () => heightField(72, 49, (x, z) => {
  if ((x / 12.4) ** 2 + (z / 11.4) ** 2 < 1) return 0; // hollow under the dome
  return 14 * Math.exp(-((x / 16) ** 2 + ((z + 8) / 12) ** 2)) + 0.3 * noise3(x * 0.2, 0.1, z * 0.2, 5);
});

// ---------- 4. Cliffside Lookout: 3x2 on a ledge, front row sunk into the slope, windows over the drop ----------
function cliffBase() {
  return gridBase({
    ox: -4.5, oy: 3, oz: -3, levels: 2, roof: true,
    cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
    stairs: [{ i: 0, j: 0, L: 0 }],
    special: { "Z:0:1@0": "wall.doorway", "X:1:2@0": "wall.window", "X:0:2@1": "wall.window", "X:1:2@1": "wall.window", "X:2:2@1": "wall.window" },
    inner: [
      { k: "Z", i: 2, j: 0, L: 0, prefab: "wall.doorway" },
      { k: "Z", i: 2, j: 1, L: 0, prefab: "wall" }
    ],
    grades: { foundation: "stone", walls: ["stone", "stone"], floors: "wood", roof: "metal", doorway: "metal" },
    items: [
      ["cupboard.tool.deployed", 2, 1, 0, 0.6, 0.7, 0],
      ["box.wooden.large", 2, 0, 0, 0.5, -0.9, 0],
      ["box.wooden.large", 2, 1, 0, 0.5, -0.4, 0],
      ["furnace", 1, 1, 1, 0, 0.6, 0],
      ["sleepingbag_leather_deployed", 2, 0, 1, 0.4, 0, 0]
    ]
  });
}
const cliffTerrain = () => heightField(72, 49, (x, z) => {
  let p;
  if (z > 0) p = 3 * (1 - smoothstep(0, 8, z));            // slope down in front
  else if (z > -10) p = 3;                                 // the ledge
  else p = 3 + 12 * smoothstep(-10, -17, z);               // cliff face behind
  return p * (1 - smoothstep(10, 22, Math.abs(x))) + 0.3 * noise3(x * 0.2, 0.7, z * 0.2, 7);
});

const SAMPLES = [
  {
    slug: "airlock-starter", name: "2x2 Airlock Starter", builder: "Example builder", group: "Solo",
    setting: "open", source: "recorded", sample: true, video: null,
    events: airlockEvents()
  },
  {
    slug: "anvil-overhang", name: "Anvil Overhang", builder: "Example builder", group: "Solo",
    setting: "rock", source: "copypaste", sample: true, video: null,
    terrain: anvilTerrain(),
    features: [{ type: "rock.anvil", pos: [0, 0, 0], rot: 0, seed: 4 }],
    events: autoOrder(anvilBase(), { seed: 5 })
  },
  {
    slug: "cave-hideaway", name: "Cave Mouth Hideaway", builder: "Example builder", group: "Duo",
    setting: "cave", source: "recorded", sample: true, video: null,
    terrain: caveTerrain(),
    features: [{ type: "cave.small", pos: [0, 0, 0], rot: 0, seed: 9 }],
    events: autoOrder(caveBase(), { seed: 8, idle: true })
  },
  {
    slug: "cliffside-lookout", name: "Cliffside Lookout", builder: "Example builder", group: "Trio",
    setting: "cliff", source: "copypaste", sample: true, video: null,
    terrain: cliffTerrain(),
    features: [{ type: "rock.cliff", pos: [0, 0, -14], rot: 0, seed: 2 }],
    events: autoOrder(cliffBase(), { seed: 3 })
  }
];
