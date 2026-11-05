// Shared vocabulary and helpers.

// Rust building grades (BuildingGrade enum names) with display colours.
const GRADES = {
  twigs:   { name: "Twig",        hex: "#cfae6e", opacity: 0.55, metal: 0 },
  wood:    { name: "Wood",        hex: "#8b5d36", opacity: 1, metal: 0 },
  stone:   { name: "Stone",       hex: "#a09c92", opacity: 1, metal: 0 },
  metal:   { name: "Sheet Metal", hex: "#a8603a", opacity: 1, metal: 0.35 },
  toptier: { name: "Armored",     hex: "#64737f", opacity: 1, metal: 0.45 }
};
const GRADE_ORDER = ["twigs", "wood", "stone", "metal", "toptier"];

const PREFAB_NAMES = {
  "foundation": "Foundation",
  "foundation.triangle": "Triangle Foundation",
  "foundation.steps": "Foundation Steps",
  "wall": "Wall",
  "wall.doorway": "Doorway",
  "wall.window": "Window Wall",
  "wall.half": "Half Wall",
  "wall.low": "Low Wall",
  "wall.frame": "Wall Frame",
  "floor": "Floor",
  "floor.frame": "Floor Frame",
  "floor.triangle": "Triangle Floor",
  "floor.triangle.frame": "Triangle Floor Frame",
  "roof": "Roof",
  "roof.triangle": "Triangle Roof",
  "block.stair.lshape": "L-Shaped Stairs",
  "block.stair.spiral": "Spiral Stairs",
  "block.stair.spiral.triangle": "Triangle Spiral Stairs",
  "ramp": "Ramp",
  "block.stair.ushape": "U-Shaped Stairs",
  "door.hinged.metal": "Sheet Metal Door",
  "cupboard.tool.deployed": "Tool Cupboard",
  "box.wooden.large": "Large Wood Box",
  "furnace": "Furnace",
  "sleepingbag_leather_deployed": "Sleeping Bag"
};
const STRUCTURAL = new Set([
  "foundation", "foundation.triangle", "foundation.steps",
  "wall", "wall.doorway", "wall.window", "wall.half", "wall.low", "wall.frame",
  "floor", "floor.frame", "floor.triangle", "floor.triangle.frame", "roof", "roof.triangle",
  "block.stair.ushape", "block.stair.lshape", "block.stair.spiral", "block.stair.spiral.triangle", "ramp"
]);
const WALLS = new Set(["wall", "wall.doorway", "wall.window", "wall.half", "wall.low", "wall.frame"]);
const LEVEL_NAMES = ["Ground floor", "2nd floor", "3rd floor", "4th floor", "5th floor", "6th floor"];

const SETTINGS = { open: "Open ground", rock: "Rock", cave: "Cave", cliff: "Cliff" };
const SOURCES = {
  recorded: {
    label: "Recorded live",
    note: "Build order captured by the BuildReplay plugin while the base was being built."
  },
  copypaste: {
    label: "Auto-ordered",
    note: "Imported from a CopyPaste save. The finished base is exact, but the build order was generated automatically and may not match how it was really built."
  },
  sandbox: {
    label: "Built in sandbox",
    note: "Built in the BuildReplay sandbox with Rust's building pieces and support rules. Check the final design in the real game before relying on it."
  },
  local: {
    label: "Your log",
    note: "Loaded from a file on this device. Nothing is uploaded."
  }
};

const $ = id => document.getElementById(id);
const R2 = n => Math.round(n * 100) / 100;
const fmt = s => { s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60); return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
const fmtShort = s => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const gradeName = g => (GRADES[g] ? GRADES[g].name : g || "");
const prefabName = p => PREFAB_NAMES[p] || p;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function setStatus(msg, err) {
  const s = $("status");
  s.textContent = msg || "";
  s.classList.toggle("err", !!err);
}

// Deterministic random numbers so sample bases look the same every time.
function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Cheap smooth-ish 3D noise in roughly [-1, 1]; good enough for rock and terrain texture.
function noise3(x, y, z, s) {
  return (
    Math.sin(x * 1.7 + s) * Math.sin(y * 2.3 + s * 1.31) * Math.sin(z * 1.9 + s * 0.77) +
    0.5 * Math.sin(x * 3.7 + y * 1.3 + s * 2.1) * Math.sin(z * 3.1 - y * 2.7 + s) +
    0.25 * Math.sin(x * 7.3 - z * 5.1 + s * 3.3) * Math.sin(y * 6.7 + s * 1.7)
  ) / 1.75;
}
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Height of the lowest foundation; floors are counted from here so a base on a cliff still starts at "Ground floor".
function baseFloorY(events) {
  let m = Infinity;
  events.forEach(e => { if (e.op === "place" && e.prefab === "foundation") m = Math.min(m, e.pos[1]); });
  return isFinite(m) ? m : 0;
}
function levelOf(y, y0) {
  const d = y - y0;
  return d < 0.9 ? 0 : Math.max(0, Math.floor((d - 1) / 3 + 0.01));
}

// Replays the first k events and returns id -> { present, grade, prefab, pos }.
function stateAt(events, k) {
  const state = new Map();
  for (let i = 0; i < k; i++) {
    const e = events[i];
    if (e.op === "place") state.set(e.id, { present: true, grade: e.grade, prefab: e.prefab, pos: e.pos, rot: e.rot || 0 });
    else if (e.op === "upgrade") { const s = state.get(e.id); if (s) s.grade = e.grade; }
    else if (e.op === "rotate") { const s = state.get(e.id); if (s) s.rot = e.rot || 0; }
    else if (e.op === "remove") { const s = state.get(e.id); if (s) s.present = false; }
  }
  return state;
}

function logStats(log) {
  const y0 = baseFloorY(log.events);
  const st = stateAt(log.events, log.events.length);
  let pieces = 0, maxL = 0;
  const grades = {};
  st.forEach(s => {
    if (!s.present || !STRUCTURAL.has(s.prefab)) return;
    pieces++;
    grades[s.grade] = (grades[s.grade] || 0) + 1;
    if (WALLS.has(s.prefab)) maxL = Math.max(maxL, levelOf(s.pos[1], y0));
  });
  const last = log.events[log.events.length - 1];
  return { pieces, floors: maxL + 1, grades, time: last ? last.t : 0, events: log.events.length };
}

function fillGradeBar(bar, grades) {
  bar.innerHTML = "";
  const total = Object.values(grades).reduce((a, b) => a + b, 0) || 1;
  const parts = [];
  GRADE_ORDER.forEach(g => {
    if (!grades[g]) return;
    const seg = el("i");
    seg.style.width = (grades[g] / total * 100).toFixed(1) + "%";
    seg.style.background = GRADES[g].hex;
    seg.title = GRADES[g].name + ": " + grades[g];
    bar.appendChild(seg);
    parts.push(grades[g] + " " + GRADES[g].name.toLowerCase());
  });
  bar.setAttribute("aria-label", "Final grades: " + parts.join(", "));
  bar.setAttribute("role", "img");
}

// ---------- Deployables catalog ----------
// Every placeable item, grouped like Rust's crafting menu. Sizes are in metres (w along the item's front,
// d front-to-back, h tall) and are ESTIMATES until replaced with numbers measured from the game
// (plugin/BuildReplayMeasure.cs). place: free (floor, foundation or ground), doorway, frame (double-door
// wall frame), window, hatch / hatch.tri (square or triangle floor frame).
const DEPLOY_CATS = ["Construction", "Items", "Electrical", "Traps", "Fun"];
const CATALOG = [
  // Construction
  ["door.hinged.wood", "Wooden Door", "Construction", 1.14, 0.08, 2.15, "doorway"],
  ["door.hinged.metal", "Sheet Metal Door", "Construction", 1.14, 0.08, 2.15, "doorway"],
  ["door.hinged.toptier", "Armored Door", "Construction", 1.14, 0.12, 2.15, "doorway"],
  ["door.double.hinged.wood", "Wood Double Door", "Construction", 2.36, 0.08, 2.6, "frame"],
  ["door.double.hinged.metal", "Sheet Metal Double Door", "Construction", 2.36, 0.08, 2.6, "frame"],
  ["door.double.hinged.toptier", "Armored Double Door", "Construction", 2.36, 0.12, 2.6, "frame"],
  ["wall.frame.garagedoor", "Garage Door", "Construction", 2.36, 0.15, 2.6, "frame"],
  ["wall.frame.netting", "Netting", "Construction", 2.36, 0.05, 2.6, "frame"],
  ["wall.frame.cell", "Prison Cell Wall", "Construction", 2.36, 0.1, 2.6, "frame"],
  ["wall.frame.cell.gate", "Prison Cell Gate", "Construction", 2.36, 0.1, 2.6, "frame"],
  ["wall.frame.fence", "Chainlink Fence", "Construction", 2.36, 0.05, 2.6, "frame"],
  ["wall.frame.fence.gate", "Chainlink Fence Gate", "Construction", 2.36, 0.05, 2.6, "frame"],
  ["wall.frame.shopfront", "Wood Shop Front", "Construction", 2.36, 0.2, 2.6, "frame"],
  ["wall.frame.shopfront.metal", "Metal Shop Front", "Construction", 2.36, 0.2, 2.6, "frame"],
  ["wall.window.bars.wood", "Wooden Window Bars", "Construction", 1.0, 0.08, 0.9, "window"],
  ["wall.window.bars.metal", "Metal Window Bars", "Construction", 1.0, 0.08, 0.9, "window"],
  ["wall.window.bars.toptier", "Reinforced Window Bars", "Construction", 1.0, 0.1, 0.9, "window"],
  ["wall.window.glass.reinforced", "Strengthened Glass Window", "Construction", 1.0, 0.08, 0.9, "window"],
  ["shutter.wood.a", "Wood Shutters", "Construction", 1.0, 0.1, 0.9, "window"],
  ["shutter.metal.embrasure.a", "Metal Horizontal Embrasure", "Construction", 1.0, 0.1, 0.9, "window"],
  ["shutter.metal.embrasure.b", "Metal Vertical Embrasure", "Construction", 1.0, 0.1, 0.9, "window"],
  ["floor.ladder.hatch", "Ladder Hatch", "Construction", 1.6, 1.6, 0.12, "hatch"],
  ["floor.triangle.ladder.hatch", "Triangle Ladder Hatch", "Construction", 1.2, 1.2, 0.12, "hatch.tri"],
  ["floor.grill", "Floor Grill", "Construction", 2.36, 2.36, 0.08, "hatch"],
  ["floor.triangle.grill", "Triangle Floor Grill", "Construction", 1.7, 1.5, 0.08, "hatch.tri"],
  ["ladder.wooden.wall", "Wooden Ladder", "Construction", 0.8, 0.25, 4.0, "free"],
  ["wall.external.high", "High External Wooden Wall", "Construction", 6.0, 0.7, 6.0, "free"],
  ["wall.external.high.stone", "High External Stone Wall", "Construction", 6.0, 0.8, 6.0, "free"],
  ["gates.external.high.wood", "High External Wooden Gate", "Construction", 6.0, 0.7, 6.0, "free"],
  ["gates.external.high.stone", "High External Stone Gate", "Construction", 6.0, 0.8, 6.0, "free"],
  ["barricade.wood", "Wooden Barricade", "Construction", 2.0, 0.6, 1.2, "free"],
  ["barricade.woodwire", "Barbed Wooden Barricade", "Construction", 2.0, 0.6, 1.2, "free"],
  ["barricade.cover.wood", "Wooden Barricade Cover", "Construction", 2.0, 0.3, 1.0, "free"],
  ["barricade.stone", "Stone Barricade", "Construction", 2.0, 1.0, 1.0, "free"],
  ["barricade.concrete", "Concrete Barricade", "Construction", 2.5, 1.0, 1.2, "free"],
  ["barricade.sandbags", "Sandbag Barricade", "Construction", 2.5, 0.8, 1.0, "free"],
  ["barricade.metal", "Metal Barricade", "Construction", 2.0, 0.4, 1.5, "free"],
  // Items
  ["cupboard.tool.deployed", "Tool Cupboard", "Items", 0.96, 0.6, 1.08, "free"],
  ["box.wooden", "Wood Storage Box", "Items", 0.9, 0.55, 0.55, "free"],
  ["box.wooden.large", "Large Wood Box", "Items", 1.3, 0.75, 0.7, "free"],
  ["locker", "Locker", "Items", 1.2, 0.5, 2.0, "free"],
  ["fridge", "Fridge", "Items", 0.9, 0.7, 1.9, "free"],
  ["coffin.storage", "Coffin", "Items", 0.8, 2.1, 0.6, "free"],
  ["dropbox", "Drop Box", "Items", 0.6, 0.4, 0.9, "free"],
  ["mailbox", "Mail Box", "Items", 0.5, 0.5, 1.2, "free"],
  ["vending.machine", "Vending Machine", "Items", 1.2, 0.9, 2.2, "free"],
  ["stash.small", "Small Stash", "Items", 0.4, 0.4, 0.2, "free"],
  ["workbench1", "Workbench Level 1", "Items", 1.4, 0.75, 0.9, "free"],
  ["workbench2", "Workbench Level 2", "Items", 2.2, 1.0, 1.2, "free"],
  ["workbench3", "Workbench Level 3", "Items", 2.6, 1.6, 1.5, "free"],
  ["research.table", "Research Table", "Items", 1.5, 0.8, 1.0, "free"],
  ["box.repair.bench", "Repair Bench", "Items", 1.6, 0.9, 1.1, "free"],
  ["furnace", "Furnace", "Items", 0.85, 0.85, 1.3, "free"],
  ["furnace.large", "Large Furnace", "Items", 2.2, 2.2, 3.4, "free"],
  ["small.oil.refinery", "Small Oil Refinery", "Items", 1.3, 1.3, 2.0, "free"],
  ["campfire", "Camp Fire", "Items", 1.0, 1.0, 0.4, "free"],
  ["bbq", "Barbeque", "Items", 1.2, 0.6, 1.0, "free"],
  ["fireplace.stone", "Stone Fireplace", "Items", 1.8, 1.0, 2.0, "free"],
  ["sleepingbag_leather_deployed", "Sleeping Bag", "Items", 0.8, 1.9, 0.12, "free"],
  ["bed", "Bed", "Items", 1.4, 2.2, 0.6, "free"],
  ["water.barrel", "Water Barrel", "Items", 0.8, 0.8, 1.1, "free"],
  ["water.catcher.small", "Small Water Catcher", "Items", 1.2, 1.2, 0.9, "free"],
  ["water.catcher.large", "Large Water Catcher", "Items", 2.4, 2.4, 1.6, "free"],
  ["water.purifier", "Water Purifier", "Items", 0.9, 0.9, 1.0, "free"],
  ["mixingtable", "Mixing Table", "Items", 1.6, 0.8, 1.0, "free"],
  ["composter", "Composter", "Items", 1.0, 1.0, 1.2, "free"],
  ["planter.small", "Small Planter Box", "Items", 2.6, 0.9, 0.6, "free"],
  ["planter.large", "Large Planter Box", "Items", 2.6, 2.6, 0.6, "free"],
  ["hitchtroughcombo", "Hitch & Trough", "Items", 2.8, 0.9, 1.4, "free"],
  ["lantern", "Lantern", "Items", 0.3, 0.3, 0.5, "free"],
  ["table", "Table", "Items", 1.8, 1.0, 0.8, "free"],
  ["chair", "Chair", "Items", 0.6, 0.6, 1.0, "free"],
  ["shelves", "Salvaged Shelves", "Items", 1.6, 0.5, 2.0, "free"],
  ["rug", "Rug", "Items", 2.5, 1.8, 0.03, "free"],
  // Electrical
  ["generator.wind.scrap", "Wind Turbine", "Electrical", 3.0, 3.0, 12.0, "free"],
  ["electric.solarpanel.large", "Large Solar Panel", "Electrical", 2.4, 2.4, 1.6, "free"],
  ["electric.fuelgenerator.small", "Small Generator", "Electrical", 1.0, 0.7, 0.8, "free"],
  ["electric.battery.rechargable.small", "Small Rechargeable Battery", "Electrical", 0.5, 0.3, 0.4, "free"],
  ["electric.battery.rechargable.medium", "Medium Rechargeable Battery", "Electrical", 0.8, 0.5, 0.8, "free"],
  ["electric.battery.rechargable.large", "Large Rechargeable Battery", "Electrical", 1.5, 0.9, 1.4, "free"],
  ["electric.switch", "Switch", "Electrical", 0.25, 0.12, 0.3, "free"],
  ["electric.splitter", "Splitter", "Electrical", 0.3, 0.12, 0.3, "free"],
  ["electric.blocker", "Blocker", "Electrical", 0.3, 0.12, 0.3, "free"],
  ["electrical.branch", "Electrical Branch", "Electrical", 0.3, 0.12, 0.3, "free"],
  ["electrical.combiner", "Root Combiner", "Electrical", 0.3, 0.12, 0.3, "free"],
  ["electric.andswitch", "AND Switch", "Electrical", 0.3, 0.12, 0.3, "free"],
  ["electric.orswitch", "OR Switch", "Electrical", 0.3, 0.12, 0.3, "free"],
  ["electric.xorswitch", "XOR Switch", "Electrical", 0.3, 0.12, 0.3, "free"],
  ["electric.counter", "Counter", "Electrical", 0.3, 0.12, 0.3, "free"],
  ["electric.timer", "Timer", "Electrical", 0.3, 0.12, 0.3, "free"],
  ["electric.doorcontroller", "Door Controller", "Electrical", 0.3, 0.12, 0.3, "free"],
  ["electric.rf.broadcaster", "RF Broadcaster", "Electrical", 0.4, 0.3, 0.5, "free"],
  ["electric.rf.receiver", "RF Receiver", "Electrical", 0.4, 0.3, 0.5, "free"],
  ["electric.pressurepad", "Pressure Pad", "Electrical", 1.0, 1.0, 0.05, "free"],
  ["electric.laserdetector", "Laser Detector", "Electrical", 0.3, 0.2, 0.3, "free"],
  ["electric.hbhfsensor", "HBHF Sensor", "Electrical", 0.3, 0.2, 0.3, "free"],
  ["smart.switch", "Smart Switch", "Electrical", 0.3, 0.12, 0.3, "free"],
  ["smart.alarm", "Smart Alarm", "Electrical", 0.3, 0.12, 0.3, "free"],
  ["storage.monitor", "Storage Monitor", "Electrical", 0.3, 0.12, 0.3, "free"],
  ["electric.audioalarm", "Audio Alarm", "Electrical", 0.3, 0.2, 0.3, "free"],
  ["ceilinglight", "Ceiling Light", "Electrical", 0.5, 0.5, 0.4, "free"],
  ["electric.flasherlight", "Flasher Light", "Electrical", 0.3, 0.3, 0.3, "free"],
  ["electric.sirenlight", "Siren Light", "Electrical", 0.3, 0.3, 0.3, "free"],
  ["searchlight", "Search Light", "Electrical", 0.8, 0.8, 1.4, "free"],
  ["electric.heater", "Electric Heater", "Electrical", 0.8, 0.4, 0.8, "free"],
  ["electric.igniter", "Igniter", "Electrical", 0.3, 0.3, 0.3, "free"],
  ["electric.teslacoil", "Tesla Coil", "Electrical", 0.8, 0.8, 1.6, "free"],
  ["electric.sprinkler", "Sprinkler", "Electrical", 0.3, 0.3, 0.4, "free"],
  ["waterpump", "Water Pump", "Electrical", 1.0, 1.0, 1.2, "free"],
  // Traps
  ["autoturret", "Auto Turret", "Traps", 0.9, 0.9, 1.1, "free"],
  ["flameturret", "Flame Turret", "Traps", 0.9, 0.9, 1.2, "free"],
  ["guntrap", "Shotgun Trap", "Traps", 0.7, 0.7, 0.9, "free"],
  ["sam.site", "SAM Site", "Traps", 2.4, 2.4, 2.6, "free"],
  ["landmine", "Land Mine", "Traps", 0.4, 0.4, 0.08, "free"],
  ["trap.bear", "Snap Trap", "Traps", 0.6, 0.6, 0.1, "free"],
  ["spikes.floor", "Wooden Floor Spikes", "Traps", 2.0, 2.0, 0.4, "free"],
  // Fun
  ["sign.wooden.small", "Small Wooden Sign", "Fun", 1.2, 0.1, 1.0, "free"],
  ["sign.wooden.large", "Large Wooden Sign", "Fun", 2.4, 0.1, 1.4, "free"],
  ["sign.post.single", "Single Sign Post", "Fun", 0.8, 0.2, 2.0, "free"],
  ["piano", "Wheelbarrow Piano", "Fun", 1.6, 0.8, 1.2, "free"],
  ["arcade.machine.chippy", "Chippy Arcade Game", "Fun", 0.8, 0.8, 1.9, "free"]
].map(([id, name, cat, w, d, h, place]) => ({ id, name, cat, w, d, h, place }));
const CATALOG_BY_ID = {};
CATALOG.forEach(c => { CATALOG_BY_ID[c.id] = c; if (!PREFAB_NAMES[c.id]) PREFAB_NAMES[c.id] = c.name; });
