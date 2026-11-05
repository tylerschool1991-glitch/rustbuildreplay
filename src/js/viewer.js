// The replay viewer on a base page.
const Viewer = (function () {
  const canvas = $("scene"), viewport = $("viewport");
  const reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;

  const stage = makeStage();
  const scene = stage.scene;
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 5;
  controls.maxDistance = 90;
  controls.autoRotateSpeed = 0.7;
  const root = new THREE.Group();
  scene.add(root);

  let log = null, world = null;
  let view = [], duration = 0, idx = 0, pt = 0, playing = false, speed = 16, maxLevel = 99;
  let active = false, standing = 0, lastCurrent = -2;
  const opts = { clean: true, idle: true };
  const anims = new Map();

  const ui = {
    kicker: $("nowKicker"), label: $("nowLabel"), sub: $("nowSub"),
    clockBig: $("clockBig"), clockSmall: $("clockSmall"),
    scrub: $("scrubber"), pos: $("replayPos"), len: $("replayLen"),
    play: $("playBtn"), playIcon: $("playIcon"), log: $("log"), count: $("logCount"),
    ghost: $("optGhost"), xray: $("optXray")
  };

  // ---------- Timeline ----------
  function buildView() {
    const evs = log.events;
    const removed = new Set(evs.filter(e => e.op === "remove").map(e => e.id));
    const info = new Map();
    const out = [];
    let prevT = null, p = 0.6;
    evs.forEach(e => {
      if (e.op === "place") info.set(e.id, { prefab: e.prefab, grade: e.grade, level: levelOf(e.pos[1], world.y0) });
      const meta = info.get(e.id);
      if (!meta) return;
      if (opts.clean && removed.has(e.id)) return;
      if (prevT !== null) { const gap = Math.max(0, e.t - prevT); p += opts.idle ? Math.min(gap, 2.5) : gap; }
      prevT = e.t;
      const structural = STRUCTURAL.has(meta.prefab);
      let label, opClass, glyph;
      if (e.op === "place") {
        label = structural ? "Placed " + gradeName(e.grade) + " " + prefabName(meta.prefab) : "Placed " + prefabName(meta.prefab);
        opClass = "place"; glyph = "+";
      } else if (e.op === "upgrade") {
        label = "Upgraded " + prefabName(meta.prefab) + " to " + gradeName(e.grade);
        meta.grade = e.grade; opClass = "upgrade"; glyph = "↑";
      } else if (e.op === "rotate") {
        label = "Rotated " + prefabName(meta.prefab);
        opClass = "upgrade"; glyph = "↻";
      } else {
        label = "Demolished " + gradeName(meta.grade) + " " + prefabName(meta.prefab);
        opClass = "remove"; glyph = "×";
      }
      out.push(Object.assign({}, e, {
        pt: p, label, opClass, glyph,
        where: LEVEL_NAMES[meta.level] || "Level " + (meta.level + 1),
        swatch: structural ? (GRADES[meta.grade] || GRADES.twigs).hex : null
      }));
    });
    view = out;
    duration = view.length ? view[view.length - 1].pt + 1.2 : 0;
  }

  function countUpTo(time) {
    let lo = 0, hi = view.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (view[mid].pt <= time + 1e-6) lo = mid + 1; else hi = mid; }
    return lo;
  }

  function sync(animate) {
    const n = countUpTo(pt);
    if (n !== idx) {
      const forward = n > idx && idx >= 0;
      if (!forward || !animate || reduceMotion) resetAnims();
      standing = applyPieces(world, stateAt(view, n), maxLevel);
      if (forward && animate && !reduceMotion && n - idx < 40) {
        const now = performance.now();
        for (let i = idx; i < n; i++) {
          const e = view[i];
          if (e.op === "place" || e.op === "upgrade") anims.set(e.id, { type: e.op, start: now });
        }
      }
      idx = n;
      updateNow();
      updateLog();
    }
    updateTransport();
  }
  function forceSync() { idx = -1; sync(false); }

  function resetAnims() {
    anims.forEach((a, id) => { const pc = world && world.pieces.get(id); if (pc) { pc.group.position.y = pc.baseY; pc.group.scale.set(1, 1, 1); } });
    anims.clear();
  }
  function runAnims(now) {
    anims.forEach((a, id) => {
      const pc = world.pieces.get(id);
      if (!pc) { anims.delete(id); return; }
      const dur = a.type === "place" ? 380 : 320;
      const e = Math.min(1, (now - a.start) / dur);
      if (a.type === "place") pc.group.position.y = pc.baseY + Math.pow(1 - e, 3) * 2.2;
      else { const s = 1 + 0.07 * Math.sin(Math.PI * e); pc.group.scale.set(s, s, s); }
      if (e >= 1) { pc.group.position.y = pc.baseY; pc.group.scale.set(1, 1, 1); anims.delete(id); }
    });
  }

  // ---------- UI ----------
  function updateNow() {
    ui.kicker.textContent = "Event " + idx + " of " + view.length;
    if (idx === 0) {
      ui.label.textContent = "Ready to build";
      ui.sub.textContent = "Press play or step through the log";
    } else {
      const e = view[idx - 1];
      ui.label.innerHTML = "";
      if (e.swatch) { const sw = el("span", "sw"); sw.style.background = e.swatch; ui.label.appendChild(sw); }
      ui.label.appendChild(document.createTextNode(e.label));
      ui.sub.textContent = e.where;
    }
    const total = view.length ? view[view.length - 1].t : 0;
    ui.clockBig.textContent = fmt(idx ? view[idx - 1].t : 0);
    ui.clockSmall.textContent = "of " + fmt(total) + " · " + standing + " pieces up";
  }
  function updateTransport() {
    ui.scrub.value = duration ? Math.round((pt / duration) * 1000) : 0;
    ui.pos.textContent = fmtShort(pt / speed);
    ui.len.textContent = fmtShort(duration / speed) + " at " + speed + "×";
  }
  function setPlaying(v) {
    playing = v;
    ui.play.setAttribute("aria-label", v ? "Pause" : "Play");
    ui.playIcon.innerHTML = v ? '<rect x="3" y="2" width="3.5" height="12"/><rect x="9.5" y="2" width="3.5" height="12"/>' : '<path d="M4 2v12l10-6z"/>';
  }
  function renderLog() {
    ui.log.innerHTML = "";
    const frag = document.createDocumentFragment();
    view.forEach(e => {
      const li = el("li");
      const b = el("button");
      b.type = "button";
      b.title = e.label + " · " + e.where;
      const tx = el("span", "txt", e.label + " ");
      tx.appendChild(el("em", null, e.where));
      b.append(el("span", "ts", fmt(e.t)), el("span", "op " + e.opClass, e.glyph), tx);
      b.addEventListener("click", () => { setPlaying(false); pt = e.pt; sync(false); });
      li.appendChild(b);
      frag.appendChild(li);
    });
    ui.log.appendChild(frag);
    ui.count.textContent = view.length + " events";
    lastCurrent = -2;
  }
  function updateLog() {
    const items = ui.log.children;
    for (let i = 0; i < items.length; i++) {
      const s = i < idx - 1 ? "done" : i === idx - 1 ? "current" : "future";
      if (items[i].dataset.s !== s) items[i].dataset.s = s;
    }
    if (idx - 1 !== lastCurrent && idx > 0) {
      const li = items[idx - 1];
      if (li) {
        const top = li.offsetTop, bottom = top + li.offsetHeight;
        if (top < ui.log.scrollTop || bottom > ui.log.scrollTop + ui.log.clientHeight) ui.log.scrollTop = top - ui.log.clientHeight / 2;
      }
    }
    lastCurrent = idx - 1;
  }

  function fillInfo() {
    const back = document.querySelector("#view-base .back");
    back.href = log.source === "sandbox" ? "#build" : "#archive";
    back.textContent = log.source === "sandbox" ? "← Back to the sandbox" : "← All bases";
    $("infoName").textContent = log.name || "Untitled base";
    const tags = $("infoTags");
    tags.innerHTML = "";
    if (log.sample) tags.appendChild(el("span", "tag ex", "Example base"));
    tags.appendChild(el("span", "tag", SETTINGS[log.setting] || "Open ground"));
    if (log.group) tags.appendChild(el("span", "tag", log.group));
    tags.appendChild(el("span", "tag", (SOURCES[log.source] || SOURCES.local).label));
    const st = logStats(log);
    const dl = $("infoStats");
    dl.innerHTML = "";
    [["Pieces", st.pieces], ["Floors", st.floors], ["Build", fmt(st.time)], ["Events", st.events]].forEach(([k, v]) => {
      const d = el("div");
      d.append(el("dt", null, k), el("dd", null, String(v)));
      dl.appendChild(d);
    });
    fillGradeBar($("infoGrades"), st.grades);
    $("infoNote").textContent = (log.builder ? "By " + log.builder + ". " : "") + (SOURCES[log.source] || SOURCES.local).note;
    const vid = $("infoVideo");
    vid.innerHTML = "";
    if (log.video && /^https:\/\//.test(log.video)) {
      const a = el("a", null, "Watch the builder's video");
      a.href = log.video; a.target = "_blank"; a.rel = "noopener";
      vid.appendChild(a);
    } else {
      vid.textContent = "No video linked yet. Builders can attach their YouTube video when they claim a base.";
    }
  }

  function open(l) {
    setPlaying(false);
    resetAnims();
    log = l;
    disposeWorld(root);
    world = buildWorld(log, root);
    stage.grid.visible = !world.hasTerrain;
    const f = frameFor(log, world.y0);
    controls.target.copy(f.target);
    camera.position.copy(f.position);
    const dist = f.position.distanceTo(f.target);
    controls.maxDistance = Math.max(90, dist * 1.6);
    scene.fog.near = Math.max(50, dist * 0.9);
    scene.fog.far = Math.max(130, dist * 3);
    controls.update();
    setXray(ui.xray.checked);
    ui.ghost.checked = log.setting === "cave";
    ui.ghost.disabled = !world.hasFeatures;
    ui.ghost.closest(".tog").classList.toggle("off", !world.hasFeatures);
    setRockGhost(ui.ghost.checked && world.hasFeatures);
    buildView();
    renderLog();
    pt = 0;
    forceSync();
    fillInfo();
    resize();
  }

  function rebuildKeepingPlace() {
    const anchorT = idx > 0 ? view[idx - 1].t : -1;
    buildView();
    renderLog();
    let k = 0;
    while (k < view.length && view[k].t <= anchorT) k++;
    pt = k > 0 ? view[k - 1].pt : 0;
    resetAnims();
    forceSync();
  }

  // ---------- Controls ----------
  ui.play.addEventListener("click", () => {
    if (!playing && pt >= duration - 0.01) { pt = 0; sync(false); }
    setPlaying(!playing);
  });
  function stepFwd() { setPlaying(false); if (idx < view.length) { pt = view[idx].pt; sync(true); } }
  function stepBack() { setPlaying(false); if (idx > 0) { pt = idx >= 2 ? view[idx - 2].pt : 0; sync(false); } }
  $("stepFwd").addEventListener("click", stepFwd);
  $("stepBack").addEventListener("click", stepBack);
  ui.scrub.addEventListener("input", () => { setPlaying(false); pt = (ui.scrub.value / 1000) * duration; sync(false); });

  function bindSeg(id, attr, fn) {
    const seg = $(id);
    seg.addEventListener("click", ev => {
      const b = ev.target.closest("button");
      if (!b) return;
      seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      fn(Number(b.dataset[attr]));
    });
  }
  bindSeg("speedSeg", "speed", v => { speed = v; updateTransport(); });
  bindSeg("floorSeg", "max", v => { maxLevel = v; forceSync(); });

  $("optClean").addEventListener("change", e => { opts.clean = e.target.checked; rebuildKeepingPlace(); });
  $("optIdle").addEventListener("change", e => { opts.idle = e.target.checked; rebuildKeepingPlace(); });
  ui.xray.addEventListener("change", e => setXray(e.target.checked));
  ui.ghost.addEventListener("change", e => setRockGhost(e.target.checked));
  const orbitBox = $("optOrbit");
  orbitBox.checked = !reduceMotion;
  controls.autoRotate = orbitBox.checked;
  orbitBox.addEventListener("change", e => { controls.autoRotate = e.target.checked; });

  document.addEventListener("keydown", e => {
    if (!active) return;
    if (e.target.closest("input[type=range], input[type=text], select, textarea")) return;
    if (e.code === "Space") { e.preventDefault(); ui.play.click(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); stepFwd(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); stepBack(); }
  });

  $("copyLog").addEventListener("click", () => {
    if (!log) return;
    const copy = Object.assign({}, log);
    delete copy.slug; delete copy.sample;
    const text = JSON.stringify(copy);
    if (!navigator.clipboard) { setStatus("Copying isn't available here.", true); return; }
    navigator.clipboard.writeText(text).then(
      () => setStatus("Log copied. Save it as a .json file to load it back in."),
      () => setStatus("Copying was blocked in this browser.", true)
    );
  });

  // Legend
  GRADE_ORDER.forEach(k => {
    const s = el("span");
    const sw = el("i", "sw"); sw.style.background = GRADES[k].hex;
    s.append(sw, document.createTextNode(GRADES[k].name));
    $("legend").appendChild(s);
  });

  // ---------- Render loop ----------
  function resize() {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  if (window.ResizeObserver) new ResizeObserver(resize).observe(viewport);
  window.addEventListener("resize", resize);

  const fly = makeFlyKeys(() => active);
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (active && world) {
      if (playing) {
        pt += dt * speed;
        if (pt >= duration) { pt = duration; setPlaying(false); }
        sync(true);
      }
      runAnims(now);
      fly.step(dt, camera, controls);
      controls.update();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return {
    open,
    setActive(v) { active = v; if (!v) setPlaying(false); else resize(); },
    viewport
  };
})();
