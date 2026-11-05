// The sandbox: build a base in the browser on Rust's 3 m grid.
// Every action is logged in the same event format the replay viewer plays.
const Builder = (function () {
  const PALETTE_BUILD = ["foundation", "wall", "wall.doorway", "wall.window", "wall.half", "wall.low", "wall.frame", "floor", "floor.frame", "block.stair.ushape"];
  const PALETTE_DEPLOY = ["door.hinged.metal", "cupboard.tool.deployed", "box.wooden.large", "furnace", "sleepingbag_leather_deployed"];
  const FULL_WALLS = new Set(["wall", "wall.doorway", "wall.window", "wall.frame"]);
  // Deployable footprints in metres (width along local x, depth along local z). Approximate; to be checked in-game.
  const FOOTPRINT = {
    "cupboard.tool.deployed": [0.96, 0.6],
    "box.wooden.large": [1.3, 0.75],
    "furnace": [0.85, 0.85],
    "sleepingbag_leather_deployed": [0.8, 1.9]
  };
  const TOOLS = { place: "Place", upgrade: "Upgrade", rotate: "Rotate", demolish: "Demolish" };
  const STORE_KEY = "buildreplay.sandbox.v1";
  const MAX_LEVEL = 5;
  const REASON = {
    W: "Walls need a foundation or floor beside them, or a wall below",
    FL: "Floors need a full wall underneath on at least one edge",
    S: "Stairs need a foundation or a solid floor under them",
    D: "Doors go in a doorway",
    X: "Place it on a foundation or solid floor, clear of stairs"
  };

  const kindOf = prefab =>
    prefab === "foundation" ? "F" :
    prefab === "floor" || prefab === "floor.frame" ? "FL" :
    prefab === "block.stair.ushape" ? "S" :
    WALLS.has(prefab) ? "W" :
    prefab === "door.hinged.metal" ? "D" : "X";

  const viewport = $("bviewport"), canvas = $("bcanvas");
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  let ready = false, active = false;
  let renderer, scene, camera, controls, root, grid, ghost = null, ghostPrefab = null;

  const S = { pieces: new Map(), sock: new Map(), events: [], nextId: 1, alias: new Map(), undo: [], redo: [], baseT: 0, resumeAt: null, name: "" };
  const ui = { tool: "place", prefab: "foundation", grade: "stone", level: 0, rot: 0, hideAbove: true };
  let hover = null, lastPointer = null, highlighted = null, flashTimer = null;

  // ---------- Sockets and positions ----------
  function keyOf(p) {
    switch (p.kind) {
      case "F": return "F:" + p.i + ":" + p.j;
      case "FL": return "FL:" + p.i + ":" + p.j + ":" + p.L;
      case "S": return "S:" + p.i + ":" + p.j + ":" + p.L;
      case "W": return "W:" + p.k + ":" + p.i + ":" + p.j + ":" + p.L;
      case "D": return "D:" + p.k + ":" + p.i + ":" + p.j + ":" + p.L;
      default: return null;
    }
  }
  function posOf(p) {
    const cx = 3 * p.i + 1.5, cz = 3 * p.j + 1.5;
    switch (p.kind) {
      case "F": return [cx, 0, cz];
      case "FL": case "S": return [cx, 1 + 3 * p.L, cz];
      case "W": case "D": return p.k === "X" ? [3 * p.i + 1.5, 1 + 3 * p.L, 3 * p.j] : [3 * p.i, 1 + 3 * p.L, 3 * p.j + 1.5];
      default: return [p.x, 1 + 3 * p.L, p.z];
    }
  }
  const get = k => { const id = S.sock.get(k); return id ? S.pieces.get(id) : null; };
  const hasFoundation = (i, j) => !!get("F:" + i + ":" + j);
  const floorAt = (i, j, L) => get("FL:" + i + ":" + j + ":" + L);
  const solidFloor = (i, j, L) => (L === 0 ? hasFoundation(i, j) : !!(floorAt(i, j, L) && floorAt(i, j, L).prefab === "floor"));
  const anySurface = (i, j, L) => (L === 0 ? hasFoundation(i, j) : !!floorAt(i, j, L));
  const wallAt = (k, i, j, L) => get("W:" + k + ":" + i + ":" + j + ":" + L);
  const fullWall = (k, i, j, L) => { const w = wallAt(k, i, j, L); return !!(w && FULL_WALLS.has(w.prefab)); };
  const edgeCells = (k, i, j) => (k === "X" ? [[i, j - 1], [i, j]] : [[i - 1, j], [i, j]]);
  const cellEdges = (i, j) => [["X", i, j], ["X", i, j + 1], ["Z", i, j], ["Z", i + 1, j]];

  function footprint(p) {
    const fp = FOOTPRINT[p.prefab] || [0.8, 0.8];
    const quarter = (((p.rot || 0) % 180) + 180) % 180 === 90;
    const w = quarter ? fp[1] : fp[0], d = quarter ? fp[0] : fp[1];
    return { x0: p.x - w / 2, x1: p.x + w / 2, z0: p.z - d / 2, z1: p.z + d / 2 };
  }
  const overlaps = (a, b) => a.x0 < b.x1 - 1e-3 && a.x1 > b.x0 + 1e-3 && a.z0 < b.z1 - 1e-3 && a.z1 > b.z0 + 1e-3;
  function deployCellsOk(p) {
    const f = footprint(p), e = 0.01;
    return [[f.x0 + e, f.z0 + e], [f.x1 - e, f.z0 + e], [f.x0 + e, f.z1 - e], [f.x1 - e, f.z1 - e]].every(([x, z]) => {
      const i = Math.floor(x / 3), j = Math.floor(z / 3);
      return solidFloor(i, j, p.L) && !get("S:" + i + ":" + j + ":" + p.L);
    });
  }
  function deployBlocked(p) {
    const f = footprint(p);
    for (const q of S.pieces.values()) {
      if (q.id === p.id || q.L !== p.L) continue;
      if (q.kind === "X" && overlaps(f, footprint(q))) return "Overlaps the " + prefabName(q.prefab).toLowerCase();
      if (q.kind === "W") {
        const t = 0.125;
        const band = q.k === "X" ? { x0: 3 * q.i, x1: 3 * q.i + 3, z0: 3 * q.j - t, z1: 3 * q.j + t } : { x0: 3 * q.i - t, x1: 3 * q.i + t, z0: 3 * q.j, z1: 3 * q.j + 3 };
        if (overlaps(f, band)) return "Too close to a wall";
      }
    }
    return null;
  }

  function supported(p) {
    switch (p.kind) {
      case "F": return true;
      case "W": return edgeCells(p.k, p.i, p.j).some(([a, b]) => anySurface(a, b, p.L)) || (p.L > 0 && fullWall(p.k, p.i, p.j, p.L - 1));
      case "FL": return cellEdges(p.i, p.j).some(([k, a, b]) => fullWall(k, a, b, p.L - 1));
      case "S": return solidFloor(p.i, p.j, p.L);
      case "D": { const w = wallAt(p.k, p.i, p.j, p.L); return !!(w && w.prefab === "wall.doorway"); }
      default: return deployCellsOk(p);
    }
  }

  function validate(c) {
    if (c.kind === "FL" && c.L < 1) return "Floors go on top of walls";
    if (c.L > MAX_LEVEL) return "That's as high as the sandbox goes for now";
    const k = keyOf(c);
    if (k && S.sock.has(k)) return "There's already a " + prefabName(get(k).prefab).toLowerCase() + " here";
    if (c.kind === "FL" && get("S:" + c.i + ":" + c.j + ":" + (c.L - 1))) return "The stairs below need this space open";
    if (c.kind === "S" && floorAt(c.i, c.j, c.L + 1)) return "Stairs need an opening above; remove that floor first";
    if (!supported(c)) return REASON[c.kind];
    if (c.kind === "X") { const b = deployBlocked(c); if (b) return b; }
    return null;
  }

  // ---------- Snapping ----------
  function workY() {
    const k = kindOf(ui.prefab);
    if (k === "F") return 0;
    if (k === "FL") return 1 + 3 * (ui.level + 1);
    return 1 + 3 * ui.level;
  }
  function snap(pt) {
    const prefab = ui.prefab, kind = kindOf(prefab);
    const i = Math.floor(pt.x / 3), j = Math.floor(pt.z / 3);
    const c = { prefab, kind, grade: STRUCTURAL.has(prefab) ? "twigs" : "wood", L: kind === "F" ? 0 : kind === "FL" ? ui.level + 1 : ui.level, i, j, rot: 0 };
    if (kind === "S") c.rot = (ui.rot % 4) * 90;
    else if (kind === "W" || kind === "D") {
      const fx = pt.x / 3 - i, fz = pt.z / 3 - j;
      const opts = [[fz, "X", i, j], [1 - fz, "X", i, j + 1], [fx, "Z", i, j], [1 - fx, "Z", i + 1, j]].sort((a, b) => a[0] - b[0]);
      c.k = opts[0][1]; c.i = opts[0][2]; c.j = opts[0][3];
      c.rot = (c.k === "X" ? 0 : 90) + (ui.rot % 2 === 1 ? 180 : 0);
    } else if (kind === "X") {
      c.x = Math.round(pt.x * 4) / 4; c.z = Math.round(pt.z * 4) / 4;
      c.rot = (ui.rot % 4) * 90;
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
    emit({ op: "place", id: p.id, prefab: p.prefab, grade: p.grade, pos: p.pos.slice(), rot: p.rot });
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
    p.mesh.rotation.y = r * Math.PI / 180;
    emit({ op: "rotate", id: p.id, rot: r });
  }
  // Rust's stability: anything that loses its support collapses.
  function collapse(ops) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of Array.from(S.pieces.values())) {
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
    if (p.kind === "F" || p.kind === "FL") return flash("Foundations and floors don't rotate");
    const step = p.kind === "W" || p.kind === "D" ? 180 : 90;
    const old = p.rot, nr = (old + step) % 360;
    if (p.kind === "X") {
      const test = Object.assign({}, p, { rot: nr });
      const b = deployBlocked(test) || (!deployCellsOk(test) ? REASON.X : null);
      if (b) return flash(b);
    }
    doRot(id, nr);
    commit([{ type: "rot", id, from: old, to: nr }]);
  }
  function upgradeAll() {
    const ops = [];
    const to = GRADE_ORDER.indexOf(ui.grade);
    Array.from(S.pieces.values()).forEach(p => {
      if (STRUCTURAL.has(p.prefab) && GRADE_ORDER.indexOf(p.grade) < to) {
        ops.push({ type: "grade", id: p.id, from: p.grade, to: ui.grade });
        doGrade(p.id, ui.grade);
      }
    });
    if (!ops.length) return flash("Everything is already " + gradeName(ui.grade) + " or better");
    commit(ops);
  }
  function clearAll() {
    Array.from(S.pieces.values()).forEach(p => root.remove(p.mesh));
    S.pieces.clear(); S.sock.clear(); S.alias.clear();
    S.events = []; S.undo = []; S.redo = []; S.nextId = 1; S.baseT = 0; S.resumeAt = null;
    afterChange();
  }

  // A small twig start so the page opens on something to build from.
  function seedStarter() {
    const seed = [
      { prefab: "foundation", i: 0, j: 0 }, { prefab: "foundation", i: 1, j: 0 },
      { prefab: "wall", k: "X", i: 0, j: 0 }, { prefab: "wall", k: "X", i: 1, j: 0 },
      { prefab: "wall", k: "Z", i: 0, j: 0 }, { prefab: "wall.doorway", k: "X", i: 0, j: 1 }
    ];
    seed.forEach(s => {
      const kind = kindOf(s.prefab);
      doPlace({ prefab: s.prefab, kind, grade: "twigs", L: 0, i: s.i, j: s.j, k: s.k, rot: s.k === "Z" ? 90 : 0 });
    });
    S.name = "Starter 2x1";
  }

  // ---------- Persistence (this browser only) ----------
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        name: S.name, events: S.events, nextId: S.nextId,
        pieces: Array.from(S.pieces.values()).map(snapshot)
      }));
    } catch (err) { /* storage unavailable; the build still works for this visit */ }
  }
  function restore() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (err) { d = null; }
    if (!d || !Array.isArray(d.pieces) || !d.pieces.length) return false;
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
      events: S.events.map(e => Object.assign({}, e))
    };
  }

  // ---------- Visibility, ghost, highlight ----------
  function refreshVisibility() {
    const placingFloor = ui.tool === "place" && kindOf(ui.prefab) === "FL";
    S.pieces.forEach(p => {
      let v = true;
      if (ui.hideAbove) v = p.L <= ui.level || (placingFloor && p.kind === "FL" && p.L === ui.level + 1);
      p.mesh.visible = v;
    });
    grid.position.y = (ui.tool === "place" ? workY() : 0) + 0.02;
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
        const m = new THREE.Mesh(boxGeo(pt.w, pt.h, pt.d).geo, ghostOk);
        m.position.set(pt.x, pt.y, pt.z);
        ghost.add(m);
      });
      scene.add(ghost);
      ghostPrefab = c.prefab;
    }
    ghost.visible = true;
    ghost.children.forEach(m => { m.material = ok ? ghostOk : ghostBad; });
    ghost.position.set(c.pos[0], c.pos[1], c.pos[2]);
    ghost.rotation.y = c.rot * Math.PI / 180;
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
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitPt = new THREE.Vector3();
  function setRay(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };

  function updateHover() {
    if (!lastPointer) return;
    setRay(lastPointer.x, lastPointer.y);
    clearHighlight();
    if (ui.tool === "place") {
      plane.constant = -workY();
      if (!ray.ray.intersectPlane(plane, hitPt)) { hideGhost(); hover = null; return; }
      const c = snap(hitPt);
      const why = validate(c);
      hover = { cand: c, why };
      showGhost(c, !why);
      if (!flashTimer) setHint(why || "Click to place " + prefabName(c.prefab).toLowerCase(), !!why);
    } else {
      hideGhost();
      const hits = ray.intersectObjects(root.children, true).filter(h => h.object.isMesh && shown(h.object));
      let p = null;
      for (const h of hits) {
        let o = h.object;
        while (o && o.userData.pid === undefined) o = o.parent;
        if (o) { p = S.pieces.get(o.userData.pid); break; }
      }
      hover = p ? { piece: p } : null;
      if (p) highlight(p);
      if (!flashTimer) setHint(p ? toolHint(p) : idleHint(), false);
    }
  }
  function act() {
    if (!hover) return;
    if (ui.tool === "place") { if (hover.cand) actPlace(hover.cand); }
    else if (hover.piece) {
      const id = hover.piece.id;
      if (ui.tool === "demolish") actDemolish(id);
      else if (ui.tool === "upgrade") actUpgrade(id);
      else if (ui.tool === "rotate") actRotate(id);
    }
    updateHover();
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
    if (ui.tool === "upgrade") return "Click a building piece to upgrade it to " + gradeName(ui.grade);
    if (ui.tool === "rotate") return "Click a piece to rotate it";
    return "Click a piece to demolish it";
  }
  function toolHint(p) {
    if (ui.tool === "upgrade") return STRUCTURAL.has(p.prefab) ? "Upgrade " + gradeName(p.grade) + " " + prefabName(p.prefab).toLowerCase() + " to " + gradeName(ui.grade) : prefabName(p.prefab) + " has no grade";
    if (ui.tool === "rotate") return "Rotate " + prefabName(p.prefab).toLowerCase();
    return "Demolish " + prefabName(p.prefab).toLowerCase();
  }
  function updateHeader() {
    $("bKicker").textContent = TOOLS[ui.tool] + " · " + (LEVEL_NAMES[ui.level] || "Level " + (ui.level + 1));
    $("bLabel").textContent = ui.tool === "place" ? prefabName(ui.prefab) : ui.tool === "upgrade" ? "Upgrade to " + gradeName(ui.grade) : TOOLS[ui.tool];
    $("lvlLabel").textContent = LEVEL_NAMES[ui.level] || "Level " + (ui.level + 1);
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

  function setTool(t) {
    ui.tool = t;
    document.querySelectorAll("#toolSeg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
    updateHeader(); refreshVisibility(); updateHover();
  }
  function setPrefab(prefab) {
    ui.prefab = prefab;
    ui.rot = 0;
    document.querySelectorAll(".pbtn").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.prefab === prefab)));
    setTool("place");
  }
  function setLevel(L) {
    ui.level = Math.max(0, Math.min(MAX_LEVEL, L));
    updateHeader(); refreshVisibility(); updateHover();
  }
  function setGrade(g) {
    ui.grade = g;
    document.querySelectorAll(".gpick").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.grade === g)));
    $("bUpAll").textContent = "Upgrade everything to " + gradeName(g);
    updateHeader(); updateHover();
  }

  function buildPanels() {
    const pal = (list, host, withKeys) => {
      list.forEach((prefab, n) => {
        const b = el("button", "pbtn");
        b.type = "button";
        b.dataset.prefab = prefab;
        b.setAttribute("aria-pressed", "false");
        b.appendChild(el("span", null, prefabName(prefab)));
        if (withKeys) b.appendChild(el("kbd", null, String((n + 1) % 10)));
        b.addEventListener("click", () => setPrefab(prefab));
        host.appendChild(b);
      });
    };
    pal(PALETTE_BUILD, $("palBuild"), true);
    pal(PALETTE_DEPLOY, $("palDeploy"), false);
    GRADE_ORDER.forEach(g => {
      const b = el("button", "pbtn gpick");
      b.type = "button";
      b.dataset.grade = g;
      const sw = el("i", "sw"); sw.style.background = GRADES[g].hex;
      const label = el("span");
      label.append(sw, document.createTextNode(" " + GRADES[g].name));
      b.appendChild(label);
      b.addEventListener("click", () => { setGrade(g); if (g !== "twigs") setTool("upgrade"); });
      $("gradePick").appendChild(b);
    });

    $("toolSeg").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setTool(b.dataset.tool); });
    $("lvlDown").addEventListener("click", () => setLevel(ui.level - 1));
    $("lvlUp").addEventListener("click", () => setLevel(ui.level + 1));
    $("bUndo").addEventListener("click", undo);
    $("bRedo").addEventListener("click", redo);
    $("bUpAll").addEventListener("click", upgradeAll);
    $("optHideAbove").addEventListener("change", e => { ui.hideAbove = e.target.checked; refreshVisibility(); updateHover(); });
    const name = $("bName");
    name.value = S.name;
    name.addEventListener("input", () => { S.name = name.value; save(); });

    let clearArmed = null;
    const clearBtn = $("bClear");
    clearBtn.addEventListener("click", () => {
      if (clearArmed) {
        clearTimeout(clearArmed); clearArmed = null;
        clearBtn.textContent = "New build";
        clearAll();
        flash("Started a new build", true);
        return;
      }
      clearBtn.textContent = "Click again to clear";
      clearArmed = setTimeout(() => { clearArmed = null; clearBtn.textContent = "New build"; }, 3000);
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

    document.addEventListener("keydown", e => {
      if (!active) return;
      if (e.target.closest("input, select, textarea")) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === "r") { ui.rot++; updateHover(); }
      else if (k === "p") setTool("place");
      else if (k === "u") setTool("upgrade");
      else if (k === "o") setTool("rotate");
      else if (k === "x") setTool("demolish");
      else if (k === "[" || e.key === "PageDown") setLevel(ui.level - 1);
      else if (k === "]" || e.key === "PageUp") setLevel(ui.level + 1);
      else if (/^[0-9]$/.test(k)) { const n = (Number(k) + 9) % 10; if (PALETTE_BUILD[n]) setPrefab(PALETTE_BUILD[n]); }
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
    grid = stage.grid;
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    camera.position.set(14, 15, 19);
    controls = new THREE.OrbitControls(camera, canvas);
    controls.target.set(3, 1, 1.5);
    controls.enableDamping = !reduceMotion;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.minDistance = 4;
    controls.maxDistance = 90;
    controls.update();
    root = new THREE.Group();
    scene.add(root);

    if (!restore()) seedStarter();
    buildPanels();
    setPrefab("foundation");
    setGrade("stone");
    afterChange();

    let down = null;
    canvas.addEventListener("pointermove", e => { lastPointer = { x: e.clientX, y: e.clientY }; if (!down) updateHover(); });
    canvas.addEventListener("pointerdown", e => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
    canvas.addEventListener("pointerup", e => {
      const d = down; down = null;
      if (!d || d.b !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return; // that was an orbit drag
      lastPointer = { x: e.clientX, y: e.clientY };
      updateHover();
      act();
    });
    canvas.addEventListener("pointerleave", () => { hideGhost(); clearHighlight(); hover = null; });
    canvas.addEventListener("contextmenu", e => e.preventDefault());
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

  return {
    setActive(v) {
      active = v;
      if (v && !ready) init();
      if (v) { setXray(false); setRockGhost(false); resize(); updateStats(); }
    }
  };
})();
