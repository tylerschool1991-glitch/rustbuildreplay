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
  "wall": "Wall",
  "wall.doorway": "Doorway",
  "wall.window": "Window Wall",
  "floor": "Floor",
  "block.stair.ushape": "U-Shaped Stairs",
  "door.hinged.metal": "Sheet Metal Door",
  "cupboard.tool.deployed": "Tool Cupboard",
  "box.wooden.large": "Large Wood Box",
  "furnace": "Furnace",
  "sleepingbag_leather_deployed": "Sleeping Bag"
};
const STRUCTURAL = new Set(["foundation", "wall", "wall.doorway", "wall.window", "floor", "block.stair.ushape"]);
const WALLS = new Set(["wall", "wall.doorway", "wall.window"]);
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
    if (e.op === "place") state.set(e.id, { present: true, grade: e.grade, prefab: e.prefab, pos: e.pos });
    else if (e.op === "upgrade") { const s = state.get(e.id); if (s) s.grade = e.grade; }
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
