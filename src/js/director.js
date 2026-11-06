// Director camera for replays: shows each new piece in turn from an angle where it can be seen.
// - If a newly placed piece is already in clear view, the replay carries on and the camera stays put.
// - Otherwise the replay waits while the camera glides to it. For that shot it tries ~50 viewpoints around
//   the piece, casts sight-lines from each to the piece's centre and corners against everything built so far
//   (and the terrain and rocks), and keeps the clearest, preferring a three-quarter view and a small move.
// - If nothing can see it (a box inside a finished room, a base inside a cave), whatever blocks the view
//   fades out for that shot.
function makeDirector(camera, controls, root) {
  const ray = new THREE.Raycaster();
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const ghostMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, transparent: true, opacity: 0.16, depthWrite: false, roughness: 1 });
  let world = null, heightAt = () => 0;
  let shot = null, holdUntil = 0, pausedUntil = 0, ghosts = [];
  const history = [], decisions = []; // recent shots and decisions, for automated checks
  const HOLD = 0.45; // seconds the camera rests on a piece before the replay moves on

  // ---------- Geometry helpers ----------
  // A piece's box where it comes to rest, cut off at the ground (most of a foundation is underground).
  function restBox(pc) {
    const box = new THREE.Box3().setFromObject(pc.group);
    const dy = pc.baseY - pc.group.position.y;
    box.min.y += dy; box.max.y += dy;
    const c = box.getCenter(tmp);
    box.min.y = Math.min(box.max.y - 0.05, Math.max(box.min.y, heightAt(c.x, c.z) + 0.02));
    return box;
  }
  function samplePoints(box) {
    const c = box.getCenter(new THREE.Vector3()), pts = [c];
    for (let i = 0; i < 8; i++) {
      tmp.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      pts.push(tmp.clone().lerp(c, 0.3));
    }
    return pts;
  }
  function obstacles(exclude) {
    const out = [];
    root.traverseVisible(o => { if (o.isMesh && !exclude.has(o) && !o.userData.ghost) out.push(o); });
    return out;
  }
  // Share of the piece visible from p (centre counts double), and the meshes in the way.
  function sight(p, box, meshes, collect) {
    let seen = 0;
    const blockers = new Set();
    samplePoints(box).forEach((q, i) => {
      const d = tmp2.subVectors(q, p), len = d.length();
      ray.set(p, d.normalize());
      ray.far = Math.max(0.01, len - 0.12);
      const hits = ray.intersectObjects(meshes, false);
      if (!hits.length) seen += i === 0 ? 2 : 1;
      else if (collect) hits.forEach(h => blockers.add(h.object));
    });
    return { vis: seen / 10, blockers };
  }
  function insideSomething(p, boxes) {
    if (p.y < heightAt(p.x, p.z) + 0.7) return true;
    return boxes.some(b => b.containsPoint(p));
  }
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const sph = v => ({ r: v.length(), az: Math.atan2(v.x, v.z), el: Math.asin(Math.max(-1, Math.min(1, v.y / (v.length() || 1)))) });
  const fromSph = (s, out) => out.set(Math.cos(s.el) * Math.sin(s.az), Math.sin(s.el), Math.cos(s.el) * Math.cos(s.az)).multiplyScalar(s.r);
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  function onScreen(c, margin) { const p = c.clone().project(camera); return Math.abs(p.x) < margin && Math.abs(p.y) < margin && p.z < 1; }

  // ---------- Fading what's in the way ----------
  function clearGhosts() {
    ghosts.forEach(g => { if (g.mesh.userData.ghost) { g.mesh.material = g.mat; g.mesh.userData.ghost = false; g.mesh.castShadow = g.cast; } });
    ghosts = [];
  }
  function ghost(meshes) {
    meshes.forEach(m => {
      if (m.userData.ghost || !m.parent || m.parent === root) return; // the terrain never fades (rock formations can)
      ghosts.push({ mesh: m, mat: m.material, cast: m.castShadow });
      m.userData.ghost = true;
      m.material = ghostMat;
      m.castShadow = false;
    });
  }

  // ---------- A shot ----------
  function shoot(pc) {
    const box = restBox(pc), c = box.getCenter(new THREE.Vector3());
    const rad = Math.max(0.6, box.getSize(new THREE.Vector3()).length() / 2);
    const exclude = new Set();
    pc.group.traverse(o => exclude.add(o));
    clearGhosts();
    const meshes = obstacles(exclude);
    const solid = [];
    world.pieces.forEach(o => { if (o !== pc && o.group.visible) solid.push(restBox(o).expandByScalar(0.25)); });
    const cur = sph(tmp.subVectors(camera.position, controls.target));
    const D = Math.max(7, Math.min(20, rad * 2.4 + 6));
    let best = null;
    [0.3, 0.55, 0.85, 1.2].forEach(el => {
      for (let k = 0; k < 14; k++) {
        const s = { r: D, az: cur.az + (k / 14) * Math.PI * 2, el };
        const p = fromSph(s, new THREE.Vector3()).add(c);
        if (insideSomething(p, solid)) continue;
        const vis = sight(p, box, meshes, false).vis;
        const turn = Math.abs(angDiff(cur.az, s.az)) / Math.PI;
        const score = vis * 3 - turn * 1.1 - Math.abs(el - 0.55) * 0.45 - (p.distanceTo(camera.position) / 40) * 0.4;
        if (!best || score > best.score) best = { score, s, vis, p };
      }
    });
    if (!best) { const s = { r: D, az: cur.az, el: 1.2 }; best = { s, vis: 0, p: fromSph(s, new THREE.Vector3()).add(c) }; }
    if (best.vis < 0.75) ghost(Array.from(sight(best.p, box, meshes, true).blockers));
    const fromT = controls.target.clone(), fromS = cur;
    const moveAz = Math.abs(angDiff(fromS.az, best.s.az));
    const dur = Math.max(0.9, Math.min(2.6, 0.7 + moveAz * 0.55 + fromT.distanceTo(c) / 14));
    shot = { fromT, toT: c, fromS, toS: best.s, t: 0, dur, lift: Math.min(0.35, moveAz * 0.18) };
    history.push({ prefab: pc.prefab || "", vis: best.vis, ghosts: ghosts.length, dur: Math.round(dur * 100) / 100 });
    if (history.length > 200) history.shift();
  }

  // ---------- Called by the viewer ----------
  let gate = false, subject = null;
  const drift = { on: true, dir: 1, turned: false, nextCheck: 0 };
  function setSubject(pc) {
    const ex = new Set(); pc.group.traverse(o => ex.add(o));
    subject = { box: restBox(pc), ex };
    drift.on = true; drift.turned = false;
  }
  // Returns true when the replay should stop at this piece while the camera gets there.
  function placed(id, nowS) {
    if (!world || nowS < pausedUntil || gate) { decisions.push({ id, skip: gate ? "gate" : "paused" }); return false; }
    const pc = world.pieces.get(id);
    if (!pc) return false;
    const box = restBox(pc), c = box.getCenter(new THREE.Vector3());
    const ex = new Set(); pc.group.traverse(o => ex.add(o));
    const seen = sight(camera.position, box, obstacles(ex), false).vis;
    const dist = camera.position.distanceTo(c);
    // Already in clear view: let the replay carry on.
    decisions.push({ id, prefab: pc.prefab, seen, on: onScreen(c, 0.75), dist: Math.round(dist) });
    if (decisions.length > 300) decisions.shift();
    if (seen >= 0.7 && onScreen(c, 0.75) && dist < 30) { setSubject(pc); return false; }
    shoot(pc);
    setSubject(pc);
    gate = true;
    return true;
  }
  function update(dt, nowS, playing, reduceMotion) {
    if (!world || nowS < pausedUntil) { gate = false; return; }
    if (shot && shot.t < shot.dur) {
      shot.t = reduceMotion ? shot.dur : Math.min(shot.dur, shot.t + dt);
      const k = ease(shot.t / shot.dur);
      controls.target.lerpVectors(shot.fromT, shot.toT, k);
      const s = {
        r: shot.fromS.r + (shot.toS.r - shot.fromS.r) * k,
        az: shot.fromS.az + angDiff(shot.fromS.az, shot.toS.az) * k,
        el: shot.fromS.el + (shot.toS.el - shot.fromS.el) * k + Math.sin(Math.PI * k) * shot.lift
      };
      camera.position.copy(controls.target).add(fromSph(s, tmp));
      camera.lookAt(controls.target);
      if (shot.t >= shot.dur) holdUntil = nowS + HOLD;
    } else {
      if (gate && nowS >= holdUntil) gate = false;
      if (playing && !reduceMotion && drift.on) {
        // Drift slowly around while the replay plays, but only while the latest piece stays in view:
        // if a wall starts to get in the way, turn back; if that's blocked too, hold still.
        const off = sph(tmp.subVectors(camera.position, controls.target));
        off.az += dt * 0.04 * drift.dir;
        camera.position.copy(controls.target).add(fromSph(off, tmp2));
        camera.lookAt(controls.target);
        if (nowS >= drift.nextCheck && subject) {
          drift.nextCheck = nowS + 0.3;
          const v = sight(camera.position, subject.box, obstacles(subject.ex), false).vis;
          if (v < 0.75) {
            off.az -= 0.3 * 0.04 * drift.dir * 2;
            camera.position.copy(controls.target).add(fromSph(off, tmp2));
            camera.lookAt(controls.target);
            if (drift.turned) drift.on = false; else { drift.dir *= -1; drift.turned = true; }
          }
        }
      }
    }
  }

  return {
    setWorld(w, h) { clearGhosts(); world = w; heightAt = h || (() => 0); shot = null; gate = false; subject = null; },
    placed,
    update,
    // While true, the replay holds still so the camera can get to the piece.
    gating: () => gate,
    busy: () => !!shot && shot.t < shot.dur,
    // You took the camera: leave it alone for a few seconds.
    pauseMs(ms) { pausedUntil = performance.now() / 1000 + ms / 1000; shot = null; gate = false; },
    off() { clearGhosts(); shot = null; gate = false; },
    history: () => history.slice(),
    decisions: () => decisions.slice(),
    // For automated checks: how much of a piece the camera sees right now, and whether it's on screen.
    check(id) {
      const pc = world && world.pieces.get(id);
      if (!pc || !pc.group.visible) return null;
      const box = restBox(pc), ex = new Set();
      pc.group.traverse(o => ex.add(o));
      const r = sight(camera.position, box, obstacles(ex), true);
      const names = [];
      r.blockers.forEach(m => { let o = m; while (o && o.parent !== root) o = o.parent; world.pieces.forEach(q => { if (q.group === o) names.push(q.prefab); }); if (o === m || !o) names.push("terrain/rock"); });
      return { vis: r.vis, onScreen: onScreen(box.getCenter(new THREE.Vector3()), 1), blockers: names, cam: camera.position.toArray().map(v => Math.round(v * 10) / 10), target: controls.target.toArray().map(v => Math.round(v * 10) / 10), box: [box.min.toArray(), box.max.toArray()].map(a => a.map(v => Math.round(v * 10) / 10)) };
    }
  };
}
