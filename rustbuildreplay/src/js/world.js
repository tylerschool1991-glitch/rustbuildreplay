// Everything 3D that is shared between the replay viewer and archive thumbnails:
// materials, building piece models, terrain, rock formations.

const lin = hex => new THREE.Color(hex).convertSRGBToLinear();
const SKY = 0x252a25;
const GROUND_HEX = "#39422f";

const MATS = {};
GRADE_ORDER.forEach(k => {
  MATS[k] = new THREE.MeshStandardMaterial({ color: lin(GRADES[k].hex), roughness: 0.85, metalness: GRADES[k].metal });
});
const solidMat = hex => new THREE.MeshStandardMaterial({ color: lin(hex), roughness: 0.8 });
const DMATS = {
  door: Object.assign(solidMat("#565e63"), { metalness: 0.5, roughness: 0.55 }),
  tc: solidMat("#6f7b4d"), tcLid: solidMat("#3f4630"),
  box: solidMat("#7d5631"), furnace: solidMat("#5b5650"), bag: solidMat("#435039"), generic: solidMat("#9a9a9a")
};
const EDGE_MAT = new THREE.LineBasicMaterial({ color: 0x141713, transparent: true, opacity: 0.55 });
const ROCK_MAT = new THREE.MeshStandardMaterial({ color: lin("#7a766c"), roughness: 1, flatShading: true, side: THREE.DoubleSide });
const TERRAIN_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });

function setXray(on) {
  GRADE_ORDER.forEach(k => {
    const base = GRADES[k].opacity;
    const op = on ? Math.min(base, 0.2) : base;
    MATS[k].opacity = op;
    MATS[k].transparent = op < 1;
    MATS[k].depthWrite = op >= 1;
    MATS[k].needsUpdate = true;
  });
  EDGE_MAT.opacity = on ? 0.3 : 0.55;
}
function setRockGhost(on) {
  ROCK_MAT.opacity = on ? 0.22 : 1;
  ROCK_MAT.transparent = on;
  ROCK_MAT.depthWrite = !on;
  ROCK_MAT.needsUpdate = true;
}
setXray(false);

// ---------- Building pieces ----------
// Local frame: origin at the piece's base centre; walls run along local x.
const B = (w, h, d, x, y, z, m) => ({ w, h, d, x, y, z, m });
function partsFor(prefab) {
  switch (prefab) {
    // Foundations extend 3 m below their top-minus-1 so they read as sunk into slopes.
    case "foundation": return [B(3, 4, 3, 0, -1, 0)];
    case "wall": return [B(3, 3, 0.25, 0, 1.5, 0)];
    case "wall.doorway": return [B(0.9, 3, 0.25, -1.05, 1.5, 0), B(0.9, 3, 0.25, 1.05, 1.5, 0), B(1.2, 0.8, 0.25, 0, 2.6, 0)];
    case "wall.window": return [B(1, 3, 0.25, -1, 1.5, 0), B(1, 3, 0.25, 1, 1.5, 0), B(1, 1.2, 0.25, 0, 0.6, 0), B(1, 0.9, 0.25, 0, 2.55, 0)];
    case "floor": return [B(3, 0.2, 3, 0, -0.1, 0)];
    case "block.stair.ushape": {
      const p = [];
      for (let k = 0; k < 6; k++) { const h = 0.25 * (k + 1); p.push(B(1.4, h, 0.4, -0.75, h / 2, -1.25 + 0.4 * k)); }
      p.push(B(2.9, 1.5, 0.5, 0, 0.75, 1.2));
      for (let k = 0; k < 6; k++) { const h = 1.5 + 0.25 * (k + 1); p.push(B(1.4, h, 0.4, 0.75, h / 2, 0.75 - 0.4 * k)); }
      return p;
    }
    case "door.hinged.metal": return [B(1.14, 2.15, 0.08, 0, 1.08, 0, "door")];
    case "cupboard.tool.deployed": return [B(0.9, 1.0, 0.55, 0, 0.5, 0, "tc"), B(0.96, 0.08, 0.6, 0, 1.04, 0, "tcLid")];
    case "box.wooden.large": return [B(1.3, 0.7, 0.75, 0, 0.35, 0, "box")];
    case "furnace": return [B(0.85, 1.3, 0.85, 0, 0.65, 0, "furnace")];
    case "sleepingbag_leather_deployed": return [B(0.8, 0.12, 1.9, 0, 0.06, 0, "bag")];
    default: return [B(0.8, 0.8, 0.8, 0, 0.4, 0, "generic")];
  }
}

const geoCache = new Map();
function boxGeo(w, h, d) {
  const key = w + "|" + h + "|" + d;
  if (!geoCache.has(key)) { const geo = new THREE.BoxGeometry(w, h, d); geoCache.set(key, { geo, edges: new THREE.EdgesGeometry(geo) }); }
  return geoCache.get(key);
}

function makePiece(e, y0) {
  const structural = STRUCTURAL.has(e.prefab);
  const group = new THREE.Group();
  partsFor(e.prefab).forEach(p => {
    const c = boxGeo(p.w, p.h, p.d);
    const mesh = new THREE.Mesh(c.geo, structural ? MATS[e.grade] || MATS.twigs : DMATS[p.m] || DMATS.generic);
    mesh.position.set(p.x, p.y, p.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const ln = new THREE.LineSegments(c.edges, EDGE_MAT);
    ln.position.copy(mesh.position);
    group.add(mesh, ln);
  });
  group.position.set(e.pos[0], e.pos[1], e.pos[2]);
  group.rotation.y = (e.rot || 0) * Math.PI / 180;
  group.visible = false;
  return { group, structural, level: levelOf(e.pos[1], y0), baseY: e.pos[1] };
}

// ---------- Terrain ----------
// heights is row-major: row i runs along z (from -size/2), column j along x.
function makeTerrain(t) {
  const seg = t.res - 1;
  const geo = new THREE.PlaneGeometry(t.size, t.size, seg, seg);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) pos.setZ(k, t.heights[k] || 0);
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const grass = lin(GROUND_HEX), dirt = lin("#4d4735"), rock = lin("#66625a");
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k), z = pos.getZ(k), ny = nrm.getY(k);
    c.copy(grass).lerp(dirt, 0.3 + 0.3 * noise3(x * 0.12, 0.5, z * 0.12, 3));
    if (ny < 0.85) c.lerp(rock, Math.min(1, (0.85 - ny) / 0.3));
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, TERRAIN_MAT);
  mesh.receiveShadow = true; mesh.castShadow = true;
  mesh.userData.own = true;
  return mesh;
}

// ---------- Rock formations ----------
// Stand-in models: we can't ship Facepunch's rocks, so each formation type gets its own stylised shape.
function rockMesh(seed, sx, sy, sz, o) {
  o = o || {};
  let geo = new THREE.IcosahedronGeometry(1, o.detail || 3); // non-indexed in r128
  const p = geo.attributes.position;
  const amp = o.amp === undefined ? 0.12 : o.amp;
  const v = new THREE.Vector3();
  for (let k = 0; k < p.count; k++) {
    v.fromBufferAttribute(p, k);
    v.multiplyScalar(1 + amp * noise3(v.x * 1.8, v.y * 1.8, v.z * 1.8, seed));
    if (o.flatBottom !== undefined && v.y < o.flatBottom) v.y = o.flatBottom;
    p.setXYZ(k, v.x, v.y, v.z);
  }
  if (o.cut) {
    const a = p.array, keep = [];
    for (let i = 0; i < a.length; i += 9) {
      const cx = (a[i] + a[i + 3] + a[i + 6]) / 3, cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
      if (!o.cut(cx, cy, cz)) for (let j = 0; j < 9; j++) keep.push(a[i + j]);
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(keep, 3));
  }
  geo.scale(sx, sy, sz);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, ROCK_MAT);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.own = true;
  return mesh;
}
const at = (obj, x, y, z) => { obj.position.set(x, y, z); return obj; };

function makeFeature(f) {
  const g = new THREE.Group();
  const s = f.scale || 1, seed = f.seed || 1;
  switch (f.type) {
    case "rock.anvil":
      // Narrow pedestal on one side, wide flat-bottomed slab overhanging the build area.
      g.add(at(rockMesh(seed, 3 * s, 4.8 * s, 3.4 * s), -6 * s, 4.2 * s, 0));
      g.add(at(rockMesh(seed + 5, 8.5 * s, 2 * s, 6 * s, { flatBottom: -0.62, amp: 0.1 }), -1 * s, 8.6 * s, 0));
      break;
    case "rock.cliff":
      g.add(at(rockMesh(seed, 22 * s, 9 * s, 6 * s, { amp: 0.15 }), 0, 6 * s, 0));
      break;
    case "cave.small":
      // Hollow dome with the floor and the +z side cut away to form the mouth.
      g.add(rockMesh(seed, 12 * s, 9 * s, 11 * s, { amp: 0.07, detail: 4, cut: (x, y, z) => y < 0.03 || z > 0.55 }));
      break;
    default:
      g.add(at(rockMesh(seed, 2 * s, 2 * s, 2 * s), 0, 1 * s, 0));
  }
  g.position.set(f.pos[0], f.pos[1], f.pos[2]);
  g.rotation.y = (f.rot || 0) * Math.PI / 180;
  return g;
}

// ---------- World assembly ----------
function buildWorld(log, root) {
  const y0 = baseFloorY(log.events);
  if (log.terrain) root.add(makeTerrain(log.terrain));
  (log.features || []).forEach(f => root.add(makeFeature(f)));
  const pieces = new Map();
  log.events.forEach(e => {
    if (e.op !== "place" || pieces.has(e.id)) return;
    const pc = makePiece(e, y0);
    root.add(pc.group);
    pieces.set(e.id, pc);
  });
  return { pieces, y0, hasTerrain: !!log.terrain, hasFeatures: !!(log.features && log.features.length) };
}
function disposeWorld(root) {
  root.traverse(o => { if (o.userData && o.userData.own && o.geometry) o.geometry.dispose(); });
  root.clear();
}
function applyPieces(world, state, maxLevel) {
  let up = 0;
  world.pieces.forEach((pc, id) => {
    const s = state.get(id);
    const present = !!(s && s.present);
    if (present) up++;
    pc.group.visible = present && pc.level <= maxLevel;
    if (present && pc.structural) {
      const m = MATS[s.grade] || MATS.twigs;
      pc.group.children.forEach(ch => { if (ch.isMesh) ch.material = m; });
    }
  });
  return up;
}

function makeStage() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 50, 130);
  scene.add(new THREE.HemisphereLight(0xece6d2, 0x2b3029, 0.85));
  const sun = new THREE.DirectionalLight(0xfff0d4, 0.95);
  sun.position.set(18, 30, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 100;
  sun.shadow.bias = -0.0008;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: lin(GROUND_HEX), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.03;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(72, 24, 0x4a5440, 0x414a38); // the 3 m Rust building grid
  grid.position.y = 0.01;
  scene.add(grid);
  return { scene, grid };
}

// Camera framing around the base (rocks get extra room).
function frameFor(log, y0) {
  const box = new THREE.Box3();
  log.events.forEach(e => { if (e.op === "place") box.expandByPoint(new THREE.Vector3(e.pos[0], e.pos[1] + 2, e.pos[2])); });
  if (box.isEmpty()) box.expandByPoint(new THREE.Vector3(0, 0, 0));
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const dist = Math.max(16, size * 1.7) + (log.features && log.features.length ? 9 : 0);
  const target = new THREE.Vector3(center.x, Math.max(y0 + 1.5, y0 + (center.y - y0) * 0.6), center.z);
  const position = target.clone().add(new THREE.Vector3(0.6, 0.52, 0.8).multiplyScalar(dist));
  return { target, position };
}
