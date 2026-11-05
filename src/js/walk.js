// Walk mode: a first-person player inside the sandbox build.
// Body: the measured Rust player capsule, 1.8 m tall and 1 m across (radius 0.5).
// Crouch height, eye height, step height, speeds and jump height are NOT measured yet; they are marked below.
const Walk = (function () {
  const PLAYER_H = 1.8, PLAYER_R = 0.5;            // measured
  const CROUCH_H = 1.1, EYE_DROP = 0.15;           // estimate
  const STEP_UP = 0.45;                            // estimate: highest ledge you can walk onto without jumping
  const SPEED = { walk: 4.0, sprint: 6.5, crouch: 1.8 }; // estimate, m/s
  const GRAVITY = 18, JUMP_V = Math.sqrt(2 * 18 * 1.05); // estimate: about a 1 m jump
  const OPENABLE = /^(door\.|wall\.frame\.garagedoor|wall\.frame\.cell\.gate|wall\.frame\.fence\.gate|gates\.external|floor\..*hatch)/;

  let on = false, opts = null, prisms = [], camera = null, keys = new Set();
  const pos = new THREE.Vector3();
  let vy = 0, yaw = 0, pitch = 0, grounded = false, crouch = false, locked = false, dragLook = null;
  const open = new Map(); // piece id -> { group, pos, rot }

  // ---------- Collision shapes: every part of every piece as a convex prism in world space ----------
  function rotXZ(x, z, deg) { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [x * c + z * s, -x * s + z * c]; }
  function planeFrom(a, b, c) {
    // y = px * x + pz * z + k through three points
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vyy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vyy, ny = uz * vx - ux * vz, nz = ux * vyy - uy * vx;
    if (Math.abs(ny) < 1e-9) return { px: 0, pz: 0, k: a[1] };
    return { px: -nx / ny, pz: -nz / ny, k: a[1] + (nx * a[0] + nz * a[2]) / ny };
  }
  function prismsFor(piece) {
    const out = [];
    collisionParts(piece.prefab).forEach(pt => {
      const toWorld = (lx, lz) => {
        const [ax, az] = rotXZ(lx, lz, pt.ry || 0);
        const [wx, wz] = rotXZ(ax + (pt.x || 0), az + (pt.z || 0), piece.rot || 0);
        return [wx + piece.pos[0], wz + piece.pos[2]];
      };
      if (pt.poly) {
        const pts = pt.poly.map(([x, z], i) => { const [wx, wz] = toWorld(x, z); return [wx, piece.pos[1] + (pt.y || 0) + pt.tops[i], wz]; });
        const top = planeFrom(pts[0], pts[1], pts[2]);
        out.push({ id: piece.id, poly: pts.map(p => [p[0], p[2]]), top, t: pt.t });
      } else {
        const hw = pt.w / 2, hd = pt.d / 2, y1 = piece.pos[1] + pt.y + pt.h / 2;
        out.push({ id: piece.id, poly: [toWorld(-hw, -hd), toWorld(hw, -hd), toWorld(hw, hd), toWorld(-hw, hd)], top: { px: 0, pz: 0, k: y1 }, t: pt.h });
      }
    });
    out.forEach(p => {
      // Keep polygons counter-clockwise so edge normals point outward.
      let area = 0;
      for (let i = 0; i < p.poly.length; i++) { const a = p.poly[i], b = p.poly[(i + 1) % p.poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
      if (area < 0) p.poly.reverse();
      p.prefab = piece.prefab;
    });
    return out;
  }
  const topAt = (p, x, z) => p.top.px * x + p.top.pz * z + p.top.k;
  function inside(poly, x, z) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
    }
    return true;
  }
  // Push a circle (x, z, r) out of a convex polygon; returns the correction or null.
  function pushOut(poly, x, z, r) {
    if (inside(poly, x, z)) {
      let best = Infinity, nx = 0, nz = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const ex = b[0] - a[0], ez = b[1] - a[1], len = Math.hypot(ex, ez) || 1;
        const ox = ez / len, oz = -ex / len; // outward for counter-clockwise polygons
        const d = (x - a[0]) * ox + (z - a[1]) * oz; // negative inside
        if (-d < best) { best = -d; nx = ox; nz = oz; }
      }
      return [nx * (best + r), nz * (best + r)];
    }
    let bd = Infinity, qx = 0, qz = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / l2));
      const px = a[0] + ex * t, pz = a[1] + ez * t, d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; qx = px; qz = pz; }
    }
    if (bd >= r) return null;
    const k = (r - bd) / (bd || 1);
    return [(x - qx) * k, (z - qz) * k];
  }
  const solid = p => !open.has(p.id);

  // ---------- Physics step ----------
  function height() { return crouch ? CROUCH_H : PLAYER_H; }
  function step(dt) {
    let mx = 0, mz = 0;
    if (keys.has("w")) mz += 1;
    if (keys.has("s")) mz -= 1;
    if (keys.has("d")) mx += 1;
    if (keys.has("a")) mx -= 1;
    crouch = keys.has("control") || keys.has("c");
    const speed = crouch ? SPEED.crouch : keys.has("shift") ? SPEED.sprint : SPEED.walk;
    const len = Math.hypot(mx, mz);
    if (len) {
      mx /= len; mz /= len;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
      pos.x += (fx * mz + rx * mx) * speed * dt;
      pos.z += (fz * mz + rz * mx) * speed * dt;
    }
    const H = height();
    // Walls and anything taller than a step push the player sideways.
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      prisms.forEach(p => {
        if (!solid(p)) return;
        const top = topAt(p, pos.x, pos.z), bottom = top - p.t;
        if (top <= pos.y + STEP_UP || bottom >= pos.y + H) return;
        const fix = pushOut(p.poly, pos.x, pos.z, PLAYER_R);
        if (fix) { pos.x += fix[0]; pos.z += fix[1]; moved = true; }
      });
      if (!moved) break;
    }
    // Ground: the highest surface under the player that's within a step of the feet.
    let ground = opts.groundAt(pos.x, pos.z);
    const probes = [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]];
    prisms.forEach(p => {
      if (!solid(p)) return;
      probes.forEach(([ox, oz]) => {
        const x = pos.x + ox, z = pos.z + oz;
        if (!inside(p.poly, x, z)) return;
        const top = topAt(p, x, z);
        if (top <= pos.y + STEP_UP && top > ground) ground = top;
      });
    });
    vy -= GRAVITY * dt;
    if (grounded && keys.has(" ")) { vy = JUMP_V; grounded = false; }
    let ny = pos.y + vy * dt;
    // Ceilings stop a jump.
    if (vy > 0) prisms.forEach(p => {
      if (!solid(p) || !inside(p.poly, pos.x, pos.z)) return;
      const bottom = topAt(p, pos.x, pos.z) - p.t;
      if (bottom >= pos.y + H - 0.01 && bottom < ny + H) { ny = bottom - H; vy = 0; }
    });
    if (ny <= ground) { ny = ground; vy = 0; grounded = true; }
    else grounded = ny - ground < 0.05 && vy <= 0;
    pos.y = ny;
    camera.position.set(pos.x, pos.y + H - EYE_DROP, pos.z);
    camera.rotation.set(pitch, yaw, 0, "YXZ");
    if (opts.onMove) opts.onMove(pos, H);
  }

  // ---------- Doors and hatches (E) ----------
  const ray = new THREE.Raycaster();
  function useTarget() {
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    ray.far = 3.5;
    camera.updateMatrixWorld();
    const hits = ray.intersectObjects(opts.root.children, true).filter(h => h.object.isMesh && h.object.visible !== false);
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.pid === undefined) o = o.parent;
      if (!o) continue;
      const piece = opts.pieceById(o.userData.pid);
      if (piece && OPENABLE.test(piece.prefab)) return piece;
      if (piece) return null; // something solid is in the way
    }
    return null;
  }
  function toggle(piece) {
    const g = piece.mesh;
    if (open.has(piece.id)) {
      const st = open.get(piece.id);
      g.position.copy(st.pos); g.rotation.y = st.rot; g.visible = true;
      open.delete(piece.id);
      return;
    }
    open.set(piece.id, { pos: g.position.clone(), rot: g.rotation.y });
    if (/hatch/.test(piece.prefab)) { g.visible = false; return; }
    // Swing open 90° around the hinge edge.
    const c = CATALOG_BY_ID[piece.prefab], half = c ? c.w / 2 : 0.6;
    const a = -Math.PI / 2;
    const hx = -half, ox = hx - (hx * Math.cos(a)), oz = -(-hx * Math.sin(a));
    const r = g.rotation.y, cs = Math.cos(r), sn = Math.sin(r);
    g.position.x += ox * cs + oz * sn;
    g.position.z += -ox * sn + oz * cs;
    g.rotation.y = r + a;
  }

  // ---------- Input ----------
  function onKey(e) {
    if (!on) return;
    const k = e.key === " " ? " " : e.key.toLowerCase();
    if (e.type === "keydown") {
      if (k === "escape" || k === "v") { e.preventDefault(); stop(); return; }
      if (k === "e" && !e.repeat) { const t = useTarget(); if (t) toggle(t); }
      keys.add(k);
    } else keys.delete(k);
    if ("wasd ".indexOf(k) >= 0 || k === "control" || k === "shift" || k === "c" || k === "e") e.preventDefault();
  }
  function onMouse(e) {
    if (!on) return;
    let dx = 0, dy = 0;
    if (locked) { dx = e.movementX; dy = e.movementY; }
    else if (dragLook) { dx = e.clientX - dragLook[0]; dy = e.clientY - dragLook[1]; dragLook = [e.clientX, e.clientY]; }
    else return;
    yaw -= dx * 0.0024;
    pitch = Math.max(-1.5, Math.min(1.5, pitch - dy * 0.0024));
  }
  function onDown(e) {
    if (!on) return;
    if (!locked && opts.canvas.requestPointerLock) {
      try { const r = opts.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* fall back to drag-to-look */ }
    }
    if (!locked) dragLook = [e.clientX, e.clientY];
  }
  function onUp() { dragLook = null; }
  function onLock() {
    locked = document.pointerLockElement === opts.canvas;
    if (opts.onLock) opts.onLock(locked);
  }

  function start(o) {
    opts = o;
    camera = new THREE.PerspectiveCamera(72, 1, 0.05, 500);
    prisms = [];
    o.pieces.forEach(p => { prisms.push(...prismsFor(p)); });
    // Spawn at the first candidate spot with nothing solid in the way.
    const clear = c => !prisms.some(p => {
      const top = topAt(p, c.x, c.z), bottom = top - p.t;
      return top > c.y + STEP_UP && bottom < c.y + PLAYER_H && pushOut(p.poly, c.x, c.z, PLAYER_R);
    });
    const spot = (o.spawnCandidates || []).find(clear) || o.spawn;
    pos.set(spot.x, spot.y, spot.z);
    yaw = o.spawn.yaw || 0; pitch = -0.1; vy = 0; grounded = false; keys.clear(); open.clear();
    on = true;
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("mousemove", onMouse);
    o.canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    document.addEventListener("pointerlockchange", onLock);
    onDown({ clientX: 0, clientY: 0 });
    dragLook = null;
    step(0);
  }
  function stop() {
    if (!on) return;
    on = false;
    // Close anything that was opened so the build is left as it was.
    Array.from(open.keys()).forEach(id => { const p = opts.pieceById(id); if (p) toggle(p); });
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keyup", onKey, true);
    window.removeEventListener("mousemove", onMouse);
    opts.canvas.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointerlockchange", onLock);
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    keys.clear();
    if (opts.onExit) opts.onExit();
  }

  return {
    start, stop,
    active: () => on,
    update(dt) { if (on) step(Math.min(dt, 0.05)); },
    camera: () => camera,
    resize(w, h) { if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); } },
    // For automated checks.
    test: { pos: () => pos.clone(), teleport(x, y, z) { pos.set(x, y, z); vy = 0; }, sim(seconds) { for (let i = 0; i < seconds * 60; i++) step(1 / 60); }, press(k) { keys.add(k); }, release(k) { keys.delete(k); }, setYaw(v) { yaw = v; }, use() { const t = useTarget(); if (t) toggle(t); return t ? t.prefab : null; }, isOpen: id => open.has(id) }
  };
})();
