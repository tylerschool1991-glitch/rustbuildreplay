// Meadow dressing for the Cozy style: swaying grass, wildflowers, pebbles, bushes and trees, scattered on
// the terrain with a fixed seed. Nothing here can be built on or walked into, and none of it shows in the
// Accurate style. Anything standing where a foundation or ground item goes is tucked away.
function makeDecor(opts) {
  const heightAt = opts.heightAt, cx = opts.center ? opts.center[0] : 0, cz = opts.center ? opts.center[1] : 0;
  const R = opts.radius || 65, rand = rng(opts.seed || 7);
  const group = new THREE.Group();
  group.name = "decor";
  const C = hex => new THREE.Color(hex).convertSRGBToLinear();
  const slopeAt = (x, z) => { const e = 0.6; const dx = heightAt(x + e, z) - heightAt(x - e, z), dz = heightAt(x, z + e) - heightAt(x, z - e); return Math.hypot(dx, dz) / (2 * e); };

  // Wind: bends anything tall in world space, by how high up the model the vertex is.
  function sway(mat, strength, flat) {
    if (flat) mat.side = THREE.DoubleSide;
    mat.onBeforeCompile = sh => {
      // Lit like the ground from either side: the back of a blade isn't darkened.
      if (flat) sh.fragmentShader = sh.fragmentShader.replace("#include <normal_fragment_begin>", "vec3 normal = normalize(vNormal); vec3 geometryNormal = normal;");
      sh.uniforms.uTime = Look.time;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace("#include <begin_vertex>", [
          "#include <begin_vertex>",
          "#ifdef USE_INSTANCING",
          "  vec3 ip = instanceMatrix[3].xyz; mat3 im = mat3(instanceMatrix); float sc2 = dot(im[0], im[0]);",
          "  float hgt = max(position.y, 0.0);",
          "  float ph = ip.x * 0.31 + ip.z * 0.23;",
          "  float gust = 0.6 + 0.4 * sin(uTime * 0.35 + ip.x * 0.05);",
          "  vec3 wo = vec3(sin(uTime * 1.7 + ph) * 0.7 + sin(uTime * 2.9 + ph * 1.6) * 0.3, 0.0, cos(uTime * 1.3 + ph * 0.8) * 0.4) * gust * " + strength.toFixed(3) + " * hgt * hgt;",
          "  transformed += vec3(dot(im[0], wo), dot(im[1], wo), dot(im[2], wo)) / sc2;",
          "#endif"
        ].join("\n"));
    };
    mat.customProgramCacheKey = () => "sway" + strength + (flat ? "f" : "");
  }

  // ---------- Geometry ----------
  // Thin blades with normals pointing up; drawn from both sides without flipping the normal (see sway).
  function twoSided(pos, col) {
    const P = [], Cc = [], Nn = [];
    for (let t = 0; t < pos.length / 9; t++) {
      const v = pos.slice(t * 9, t * 9 + 9), c = col.slice(t * 9, t * 9 + 9);
      P.push(...v);
      Cc.push(...c);
      for (let k = 0; k < 3; k++) Nn.push(0, 1, 0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(Nn, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(Cc, 3));
    return g;
  }
  function bladeClump() {
    const pos = [], col = [];
    const base = C("#55783a"), tip = C("#a6c867");
    for (let b = 0; b < 9; b++) {
      const a = rand() * Math.PI * 2, r = rand() * 0.24, h = 0.16 + rand() * 0.2, w = 0.03 + rand() * 0.018;
      const x = Math.cos(a) * r, z = Math.sin(a) * r, ry = rand() * Math.PI, lean = (rand() - 0.5) * 0.14;
      const ox = Math.cos(ry) * w, oz = Math.sin(ry) * w;
      pos.push(x - ox, 0, z - oz, x + ox, 0, z + oz, x + lean, h, z + lean * 0.5);
      [base, base, tip].forEach(c => col.push(c.r, c.g, c.b));
    }
    return twoSided(pos, col);
  }
  function flowerGeo() {
    const pos = [], col = [];
    const stem = C("#5d7f3c"), white = new THREE.Color(1, 1, 1);
    const h = 0.3;
    pos.push(-0.008, 0, 0, 0.008, 0, 0, 0, h, 0);
    [stem, stem, stem].forEach(c => col.push(c.r * 0.6, c.g * 0.6, c.b * 0.6));
    // A little five-petal star facing up.
    for (let p = 0; p < 5; p++) {
      const a0 = p / 5 * Math.PI * 2, a1 = a0 + 0.55, a2 = a0 - 0.55;
      pos.push(0, h + 0.012, 0, Math.cos(a1) * 0.055, h, Math.sin(a1) * 0.055, Math.cos(a2) * 0.055, h, Math.sin(a2) * 0.055);
      for (let k = 0; k < 3; k++) col.push(white.r, white.g, white.b);
    }
    return twoSided(pos, col);
  }
  function blob(seed, r, detail, squashY, colLow, colHigh) {
    let g = new THREE.IcosahedronGeometry(r, detail);
    const p = g.attributes.position, v = new THREE.Vector3(), col = [];
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k);
      const n = noise3(v.x * 1.6 + seed, v.y * 1.6, v.z * 1.6, seed);
      v.multiplyScalar(1 + (n - 0.5) * 0.35);
      v.y *= squashY;
      p.setXYZ(k, v.x, v.y, v.z);
      const t = Math.max(0, Math.min(1, (v.y / (r * squashY) + 1) / 2));
      const c = colLow.clone().lerp(colHigh, t);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  function merge(list) {
    let n = 0;
    list.forEach(g => { n += g.attributes.position.count; });
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    list.forEach(g => {
      g = g.index ? g.toNonIndexed() : g;
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nrm.set(g.attributes.normal.array, o * 3);
      if (g.attributes.color) col.set(g.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + c) * 3);
      o += c;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }
  function moved(g, x, y, z) { g = g.index ? g.toNonIndexed() : g; g.translate(x, y, z); return g; }
  function canopyGeo() {
    const lo = C("#5a8a3a"), hi = C("#a8cc68");
    return merge([
      moved(blob(1, 1.35, 1, 0.85, lo, hi), 0, 3.3, 0),
      moved(blob(2, 1.0, 1, 0.85, lo, hi), 0.85, 2.85, 0.3),
      moved(blob(3, 0.95, 1, 0.85, lo, hi), -0.7, 2.95, -0.45),
      moved(blob(4, 0.85, 1, 0.85, lo, hi), 0.15, 4.1, -0.2)
    ]);
  }
  function pineGeo() {
    const lo = C("#3f6b3c"), hi = C("#86ad62");
    const parts = [];
    [[1.5, 1.7, 2.0], [1.15, 1.5, 3.1], [0.8, 1.3, 4.1]].forEach(([r, h, y], i) => {
      const g = new THREE.ConeGeometry(r, h, 9, 1).toNonIndexed();
      const p = g.attributes.position, col = [];
      for (let k = 0; k < p.count; k++) { const t = (p.getY(k) + h / 2) / h; const c = lo.clone().lerp(hi, t * 0.7 + i * 0.1); col.push(c.r, c.g, c.b); }
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.translate(0, y, 0);
      parts.push(g);
    });
    return merge(parts);
  }
  function trunkGeo(h) {
    const g = new THREE.CylinderGeometry(0.1, 0.19, h, 7, 1).toNonIndexed();
    g.translate(0, h / 2, 0);
    const c = C("#7a5a3f"), col = [];
    for (let k = 0; k < g.attributes.position.count; k++) col.push(c.r, c.g, c.b);
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    return g;
  }

  // ---------- Scatter ----------
  const P = Look.preset();
  const items = { grass: [], flower: [], stone: [], bush: [], tree: [], pine: [] };
  const occ = (x, z) => noise01(x * 0.06, 2.2, z * 0.06, (opts.seed || 7) + 3);
  const spot = (minR, maxR) => {
    const a = rand() * Math.PI * 2, r = Math.sqrt(minR * minR + rand() * (maxR * maxR - minR * minR));
    return [cx + Math.cos(a) * r, cz + Math.sin(a) * r, r];
  };
  const GRASS = Math.round(42000 * P.decor);
  for (let i = 0; i < GRASS * 1.6 && items.grass.length < GRASS; i++) {
    const [x, z, r] = spot(0, R);
    if (slopeAt(x, z) > 0.55 || occ(x, z) < 0.2 + rand() * 0.25) continue;
    items.grass.push({ x, z, s: (0.75 + rand() * 0.6) * (1 - smoothstep(R * 0.8, R, r) * 0.8), ry: rand() * 6.28, tint: 0.85 + rand() * 0.3 });
  }
  const FLOWERS = Math.round(2600 * P.decor), palette = ["#fff6e4", "#ffe07a", "#f6b7c6", "#c9b6f2", "#ffffff", "#f7c98a"].map(C);
  for (let i = 0; i < FLOWERS * 3 && items.flower.length < FLOWERS; i++) {
    const [x, z] = spot(0, R * 0.9);
    const patch = noise01(x * 0.11, 5.5, z * 0.11, (opts.seed || 7) + 9);
    if (patch < 0.62 || slopeAt(x, z) > 0.5) continue;
    items.flower.push({ x, z, s: 0.8 + rand() * 0.6, ry: rand() * 6.28, color: palette[Math.floor(patch * 97) % palette.length] });
  }
  for (let i = 0; i < 260; i++) { const [x, z] = spot(3, R); items.stone.push({ x, z, s: 0.1 + Math.pow(rand(), 3) * 0.55, ry: rand() * 6.28 }); }
  for (let i = 0; i < 70; i++) { const [x, z] = spot(14, R); if (slopeAt(x, z) < 0.5) items.bush.push({ x, z, s: 0.5 + rand() * 0.45, ry: rand() * 6.28 }); }
  for (let i = 0; i < 46; i++) {
    const [x, z] = spot(30, R + 20);
    if (slopeAt(x, z) > 0.45) continue;
    (rand() < 0.35 ? items.pine : items.tree).push({ x, z, s: 0.8 + rand() * 0.55, ry: rand() * 6.28 });
  }

  // ---------- Meshes ----------
  const meshes = [];
  function inst(geo, mat, list, o) {
    o = o || {};
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    m.count = list.length;
    m.castShadow = !!o.cast; m.receiveShadow = o.receive !== false;
    m.frustumCulled = false;
    m.userData.list = list; m.userData.sink = o.sink || 0; m.userData.pad = o.pad || 0; m.userData.tint = o.tint;
    if (o.colors) list.forEach((it, i) => m.setColorAt(i, it.color || new THREE.Color(it.tint || 1, it.tint || 1, it.tint || 1)));
    group.add(m);
    meshes.push(m);
    return m;
  }
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  sway(grassMat, 0.55, true);
  const flowerMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  sway(flowerMat, 0.45, true);
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  sway(leafMat, 0.012);
  const plainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: C("#a8a195"), roughness: 0.95, flatShading: true });

  const grass = inst(bladeClump(), grassMat, items.grass, { colors: true });
  const flowers = inst(flowerGeo(), flowerMat, items.flower, { colors: true });
  const stoneGeo = new THREE.IcosahedronGeometry(1, 0);
  { const p = stoneGeo.attributes.position, v = new THREE.Vector3(); for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k); v.multiplyScalar(0.75 + 0.5 * noise3(v.x * 2, v.y * 2, v.z * 2, 4)); v.y *= 0.6; p.setXYZ(k, v.x, v.y, v.z); } stoneGeo.computeVertexNormals(); }
  inst(stoneGeo, stoneMat, items.stone, { cast: true, sink: 0.25, pad: 0.3 });
  inst(blob(9, 1, 1, 0.75, C("#4f7a35"), C("#93ba58")), leafMat, items.bush, { cast: true, sink: 0.2, pad: 0.9 });
  inst(trunkGeo(2.6), plainMat, items.tree, { cast: true, pad: 3 });
  inst(canopyGeo(), leafMat, items.tree, { cast: true, pad: 3 });
  inst(trunkGeo(2.0), plainMat, items.pine, { cast: true, pad: 2.2 });
  inst(pineGeo(), leafMat, items.pine, { cast: true, pad: 2.2 });

  // ---------- Keep clear of the build ----------
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let avoid = [];
  const CELL = 4, cells = new Map();
  function setAvoid(list) {
    avoid = list || [];
    cells.clear();
    avoid.forEach((a, i) => {
      const r = a.r + 3.5;
      for (let gx = Math.floor((a.x - r) / CELL); gx <= Math.floor((a.x + r) / CELL); gx++)
        for (let gz = Math.floor((a.z - r) / CELL); gz <= Math.floor((a.z + r) / CELL); gz++) {
          const k = gx + ":" + gz;
          if (!cells.has(k)) cells.set(k, []);
          cells.get(k).push(i);
        }
    });
    meshes.forEach(m => {
      const pad = m.userData.pad, sink = m.userData.sink;
      m.userData.list.forEach((it, i) => {
        const near = cells.get(Math.floor(it.x / CELL) + ":" + Math.floor(it.z / CELL));
        let hidden = false;
        if (near) for (const j of near) { const a = avoid[j]; if (Math.hypot(it.x - a.x, it.z - a.z) < a.r + pad) { hidden = true; break; } }
        const y = heightAt(it.x, it.z) - sink * it.s;
        q.setFromAxisAngle(up, it.ry);
        const sc = hidden ? 0 : it.s;
        m4.compose(p3.set(it.x, y, it.z), q, s3.set(sc, sc, sc));
        m.setMatrixAt(i, m4);
      });
      m.instanceMatrix.needsUpdate = true;
    });
  }
  setAvoid([]);
  return { group, setAvoid, noAO: [grass, flowers], level: opts.level };
}
