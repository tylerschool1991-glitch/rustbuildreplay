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
const TERRAIN_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });

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
// Local frame: origin at the piece's base centre; walls run along local x and face local z.
// Parts are boxes (w, h, d at x, y, z, optional yaw ry in degrees) or polygon slabs
// (poly = [[x, z], ...] with a top height per vertex and a thickness t).
const B = (w, h, d, x, y, z, m, ry) => ({ w, h, d, x, y, z, m, ry });
const SLAB = (poly, tops, t, m) => ({ poly, tops: Array.isArray(tops) ? tops : poly.map(() => tops), t, m });
// Equilateral triangle with 3 m sides, centred on its centroid; edge normals point at 90°, 210° and 330°.
const TRI_R = Math.sqrt(3);
const TRI = [[0, -TRI_R], [1.5, TRI_R / 2], [-1.5, TRI_R / 2]];
const SQUARE = [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]];

function triFrameBars(y, h) {
  const inr = TRI_R / 2;
  return [90, 210, 330].map(a => {
    const r = a * Math.PI / 180, d = inr - 0.15;
    return B(2.3, h, 0.3, Math.cos(r) * d, y, Math.sin(r) * d, undefined, 90 - a);
  });
}
function spiralSteps(radius, len, rise, count, column) {
  const p = [B(column, rise, column, 0, rise / 2, 0)];
  for (let k = 0; k < count; k++) {
    const a = k * (360 / count) * 0.85, r = a * Math.PI / 180, top = rise * (k + 1) / count;
    p.push(B(len, 0.12, 0.5, Math.cos(r) * radius, top - 0.06, Math.sin(r) * radius, undefined, -a));
  }
  return p;
}

function partsFor(prefab) {
  switch (prefab) {
    // Foundations extend 3 m below their top-minus-1 so they read as sunk into slopes.
    case "foundation": return [B(3, 4, 3, 0, -1, 0)];
    case "foundation.triangle": return [SLAB(TRI, 1, 4)];
    case "foundation.steps": {
      // Attached to a foundation edge; steps lead outward along local +z.
      return [0.75, 0.5, 0.25].map((top, k) => B(3, top + 1, 0.5, 0, (top - 1) / 2, 0.25 + 0.5 * k));
    }
    case "wall": return [B(3, 3, 0.25, 0, 1.5, 0)];
    case "wall.doorway": return [B(0.9, 3, 0.25, -1.05, 1.5, 0), B(0.9, 3, 0.25, 1.05, 1.5, 0), B(1.2, 0.8, 0.25, 0, 2.6, 0)];
    case "wall.window": return [B(1, 3, 0.25, -1, 1.5, 0), B(1, 3, 0.25, 1, 1.5, 0), B(1, 1.2, 0.25, 0, 0.6, 0), B(1, 0.9, 0.25, 0, 2.55, 0)];
    case "wall.half": return [B(3, 1.5, 0.25, 0, 0.75, 0)];
    case "wall.low": return [B(3, 1, 0.25, 0, 0.5, 0)];
    case "wall.frame": return [B(0.3, 3, 0.25, -1.35, 1.5, 0), B(0.3, 3, 0.25, 1.35, 1.5, 0), B(2.4, 0.3, 0.25, 0, 2.85, 0)];
    case "floor": return [B(3, 0.2, 3, 0, -0.1, 0)];
    case "floor.triangle": return [SLAB(TRI, 0, 0.2)];
    case "floor.frame": return [B(3, 0.2, 0.3, 0, -0.1, -1.35), B(3, 0.2, 0.3, 0, -0.1, 1.35), B(0.3, 0.2, 2.4, -1.35, -0.1, 0), B(0.3, 0.2, 2.4, 1.35, -0.1, 0)];
    case "floor.triangle.frame": return triFrameBars(-0.1, 0.2);
    // Roofs: a sloped slab rising toward local +z (square) or toward the far corner (triangle). Shapes are approximate.
    case "roof": return [SLAB(SQUARE, [0.25, 0.25, 1.75, 1.75], 0.25)];
    case "roof.triangle": return [SLAB(TRI, [1.75, 0.25, 0.25], 0.25)];
    case "block.stair.ushape": {
      const p = [];
      for (let k = 0; k < 6; k++) { const h = 0.25 * (k + 1); p.push(B(1.4, h, 0.4, -0.75, h / 2, -1.25 + 0.4 * k)); }
      p.push(B(2.9, 1.5, 0.5, 0, 0.75, 1.2));
      for (let k = 0; k < 6; k++) { const h = 1.5 + 0.25 * (k + 1); p.push(B(1.4, h, 0.4, 0.75, h / 2, 0.75 - 0.4 * k)); }
      return p;
    }
    case "block.stair.lshape": {
      const p = [];
      for (let k = 0; k < 5; k++) { const h = 0.3 * (k + 1); p.push(B(1.4, h, 0.45, -0.75, h / 2, -1.25 + 0.45 * k)); }
      p.push(B(1.5, 1.8, 1.4, -0.75, 0.9, 0.8));
      for (let k = 0; k < 4; k++) { const h = 1.8 + 0.3 * (k + 1); p.push(B(0.38, h, 1.4, 0.19 + 0.38 * k, h / 2, 0.8)); }
      return p;
    }
    case "block.stair.spiral": return spiralSteps(0.85, 1.3, 3, 12, 0.3);
    case "block.stair.spiral.triangle": return spiralSteps(0.5, 0.75, 3, 10, 0.2);
    case "ramp": return [SLAB(SQUARE, [0, 0, 1, 1], 0.2)];
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
// Convex polygon slab with a (possibly sloped) planar top.
function slabGeo(poly, tops, t) {
  const key = JSON.stringify([poly, tops, t]);
  if (geoCache.has(key)) return geoCache.get(key);
  const n = poly.length;
  const cx = poly.reduce((a, v) => a + v[0], 0) / n, cz = poly.reduce((a, v) => a + v[1], 0) / n;
  const pos = [];
  const V = (i, top) => [poly[i][0], top ? tops[i] : tops[i] - t, poly[i][1]];
  const tri = (a, b, c, out) => {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = ab[1] * ac[2] - ab[2] * ac[1], ny = ab[2] * ac[0] - ab[0] * ac[2], nz = ab[0] * ac[1] - ab[1] * ac[0];
    if (nx * out[0] + ny * out[1] + nz * out[2] < 0) { const tmp = b; b = c; c = tmp; }
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  };
  for (let i = 1; i < n - 1; i++) {
    tri(V(0, true), V(i, true), V(i + 1, true), [0, 1, 0]);
    tri(V(0, false), V(i, false), V(i + 1, false), [0, -1, 0]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const out = [(poly[i][0] + poly[j][0]) / 2 - cx, 0, (poly[i][1] + poly[j][1]) / 2 - cz];
    tri(V(i, true), V(j, true), V(j, false), out);
    tri(V(i, true), V(j, false), V(i, false), out);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  const res = { geo, edges: new THREE.EdgesGeometry(geo) };
  geoCache.set(key, res);
  return res;
}
const partGeo = p => (p.poly ? slabGeo(p.poly, p.tops, p.t) : boxGeo(p.w, p.h, p.d));
function placePart(obj, p) {
  obj.position.set(p.x || 0, p.y || 0, p.z || 0);
  obj.rotation.y = (p.ry || 0) * Math.PI / 180;
}

function makePiece(e, y0) {
  const structural = STRUCTURAL.has(e.prefab);
  const group = new THREE.Group();
  partsFor(e.prefab).forEach(p => {
    const c = partGeo(p);
    const mesh = new THREE.Mesh(c.geo, structural ? MATS[e.grade] || MATS.twigs : DMATS[p.m] || DMATS.generic);
    placePart(mesh, p);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const ln = new THREE.LineSegments(c.edges, EDGE_MAT);
    placePart(ln, p);
    group.add(mesh, ln);
  });
  group.position.set(e.pos[0], e.pos[1], e.pos[2]);
  group.rotation.y = (e.rot || 0) * Math.PI / 180;
  group.visible = false;
  return { group, structural, level: levelOf(e.pos[1], y0), baseY: e.pos[1] };
}

// ---------- Line-art icons ----------
// Draws a piece as a small isometric line drawing from its own model, painter-style, so hidden lines
// are covered. Colours come from CSS (stroke: currentColor, fill: var(--icon-bg)).
const ICON_PARTS = {
  "foundation": [B(3, 1.4, 3, 0, 0.7, 0)],
  "foundation.triangle": [SLAB(TRI, 1.4, 1.4)],
  "foundation.steps": [B(3, 1.4, 3, 0, 0.7, -1.5), ...[0.75, 0.5, 0.25].map((top, k) => B(3, top * 1.4, 0.5, 0, top * 0.7, 0.25 + 0.5 * k))],
  "floor": [B(3, 0.3, 3, 0, 0.15, 0)],
  "floor.triangle": [SLAB(TRI, 0.3, 0.3)]
};
const iconCache = new Map();
function isoIcon(prefab) {
  if (iconCache.has(prefab)) return iconCache.get(prefab);
  const view = [0.62, 0.7, 0.62];
  const faces = [];
  (ICON_PARTS[prefab] || partsFor(prefab)).forEach(pt => {
    const r = (pt.ry || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const tr = (x, y, z) => [(pt.x || 0) + x * c + z * s, (pt.y || 0) + y, (pt.z || 0) - x * s + z * c];
    let fs;
    if (pt.poly) {
      const n = pt.poly.length;
      const top = pt.poly.map((v, i) => tr(v[0], pt.tops[i], v[1]));
      const bot = pt.poly.map((v, i) => tr(v[0], pt.tops[i] - pt.t, v[1]));
      fs = [top, bot];
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; fs.push([top[i], top[j], bot[j], bot[i]]); }
    } else {
      const hw = pt.w / 2, hh = pt.h / 2, hd = pt.d / 2;
      const V = (a, b, d) => tr(a * hw, b * hh, d * hd);
      fs = [
        [V(-1, 1, -1), V(1, 1, -1), V(1, 1, 1), V(-1, 1, 1)], [V(-1, -1, -1), V(1, -1, -1), V(1, -1, 1), V(-1, -1, 1)],
        [V(1, -1, -1), V(1, 1, -1), V(1, 1, 1), V(1, -1, 1)], [V(-1, -1, -1), V(-1, 1, -1), V(-1, 1, 1), V(-1, -1, 1)],
        [V(-1, -1, 1), V(1, -1, 1), V(1, 1, 1), V(-1, 1, 1)], [V(-1, -1, -1), V(1, -1, -1), V(1, 1, -1), V(-1, 1, -1)]
      ];
    }
    const all = [].concat(...fs);
    const pc = [0, 1, 2].map(k => all.reduce((a, v) => a + v[k], 0) / all.length);
    fs.forEach(f => {
      // Newell normal, flipped to point away from the part's centre; keep faces turned toward the viewer.
      let nx = 0, ny = 0, nz = 0;
      for (let i = 0; i < f.length; i++) {
        const a = f[i], b = f[(i + 1) % f.length];
        nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const fc = [0, 1, 2].map(k => f.reduce((a, v) => a + v[k], 0) / f.length);
      if (nx * (fc[0] - pc[0]) + ny * (fc[1] - pc[1]) + nz * (fc[2] - pc[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; }
      if (nx * view[0] + ny * view[1] + nz * view[2] <= 1e-6) return;
      faces.push({ pts: f, depth: fc[0] * view[0] + fc[1] * view[1] + fc[2] * view[2] });
    });
  });
  faces.sort((a, b) => a.depth - b.depth);
  const proj = v => [(v[0] - v[2]) * 0.866, -v[1] + (v[0] + v[2]) * 0.5];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  faces.forEach(f => f.pts.forEach(v => { const [x, y] = proj(v); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
  const S = 48, pad = 5, k = (S - pad * 2) / Math.max(x1 - x0, y1 - y0, 0.01);
  const ox = (S - (x1 - x0) * k) / 2, oy = (S - (y1 - y0) * k) / 2;
  const polys = faces.map(f => '<polygon points="' + f.pts.map(v => { const [x, y] = proj(v); return ((x - x0) * k + ox).toFixed(1) + "," + ((y - y0) * k + oy).toFixed(1); }).join(" ") + '"/>').join("");
  const svg = '<svg class="ic" viewBox="0 0 48 48" aria-hidden="true">' + polys + "</svg>";
  iconCache.set(prefab, svg);
  return svg;
}
// Hand-drawn glyphs for things that aren't pieces.
const GLYPHS = {
  rotate: '<svg class="ic glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M36 26a12 12 0 1 1-4-9.5"/><path d="M33 9v8h-8"/></svg>',
  demolish: '<svg class="ic glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M10 38V18h12v20"/><path d="M26 38V26h12v12"/><path d="M20 8l8 8M28 8l-8 8"/></svg>',
  plan: '<svg class="ic glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M9 11h26a4 4 0 0 1 4 4v22H13a4 4 0 0 1-4-4z"/><path d="M9 33a4 4 0 0 1 4-4h26"/><path d="M17 15v10M23 15v10M29 15v10M15 20h18"/></svg>',
  hammer: '<svg class="ic glyph" viewBox="0 0 48 48" aria-hidden="true"><path d="M12 14l9-5 13 8-4 6-8-4"/><path d="M22 19L11 39a3 3 0 0 0 5 3l11-19"/></svg>'
};

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
    const y = pos.getY(k);
    c.copy(grass).lerp(dirt, Math.max(0, Math.min(1, 0.35 + 0.55 * noise3(x * 0.09, 0.5, z * 0.09, 3))));
    c.multiplyScalar(0.86 + 0.03 * Math.min(8, Math.max(0, y)));      // higher ground slightly lighter
    if (ny < 0.9) c.lerp(rock, Math.min(1, (0.9 - ny) / 0.25));
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
    if (present) pc.group.rotation.y = (s.rot || 0) * Math.PI / 180;
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
  return { scene, grid, ground };
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
