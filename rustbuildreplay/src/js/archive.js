// Archive gallery: thumbnails, filters, cards.
const Archive = (function () {
  let logs = [];
  let thumbs = {};
  const filter = { setting: "all", group: "all" };

  // Renders each base's finished state once with a throwaway renderer.
  function renderThumbs(list) {
    const out = {};
    let r;
    try {
      r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch (err) { return out; }
    r.setPixelRatio(1);
    r.setSize(640, 400, false);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputEncoding = THREE.sRGBEncoding;
    const st = makeStage();
    const cam = new THREE.PerspectiveCamera(38, 1.6, 0.1, 400);
    const root = new THREE.Group();
    st.scene.add(root);
    setXray(false);
    list.forEach(log => {
      disposeWorld(root);
      const w = buildWorld(log, root);
      applyPieces(w, stateAt(log.events, log.events.length), 99);
      setRockGhost(log.setting === "cave");
      st.grid.visible = !w.hasTerrain;
      const f = frameFor(log, w.y0);
      cam.position.copy(f.position).sub(f.target).multiplyScalar(0.76).add(f.target);
      cam.lookAt(f.target);
      r.render(st.scene, cam);
      out[log.slug] = r.domElement.toDataURL("image/jpeg", 0.86);
    });
    disposeWorld(root);
    setRockGhost(false);
    r.dispose();
    if (r.forceContextLoss) r.forceContextLoss();
    return out;
  }

  function card(log) {
    const a = el("a", "bcard");
    a.href = "#base-" + log.slug;
    const th = el("div", "thumb");
    if (thumbs[log.slug]) {
      const img = el("img");
      img.src = thumbs[log.slug];
      img.alt = "Finished " + log.name + " base";
      th.appendChild(img);
    }
    th.appendChild(el("span", "badge", SETTINGS[log.setting] || "Open ground"));
    const body = el("div", "bbody");
    body.appendChild(el("div", "bname", log.name));
    body.appendChild(el("div", "bmeta", (log.builder || "Unknown builder") + " · " + (log.group || "Any size")));
    const st = logStats(log);
    const bar = el("div", "gbar");
    fillGradeBar(bar, st.grades);
    body.appendChild(bar);
    const stats = el("div", "bstats");
    [[st.pieces, " pieces"], [st.floors, st.floors === 1 ? " floor" : " floors"], [fmt(st.time), " build"]].forEach(([v, s]) => {
      const sp = el("span");
      sp.append(el("b", null, String(v)), document.createTextNode(s));
      stats.appendChild(sp);
    });
    body.appendChild(stats);
    const src = SOURCES[log.source] || SOURCES.local;
    body.appendChild(el("span", "src" + (log.source === "copypaste" ? " auto" : ""), src.label));
    a.appendChild(th);
    a.appendChild(body);
    return a;
  }

  function uploadCard() {
    const b = el("button", "bcard upload");
    b.type = "button";
    b.appendChild(el("div", "bname", "Load your own build log"));
    b.appendChild(el("p", null, "Recorded a base with the plugin? Open the .json file here, or drop it anywhere on this page."));
    b.addEventListener("click", () => $("fileInput").click());
    return b;
  }

  function render() {
    const grid = $("grid");
    grid.innerHTML = "";
    const shown = logs.filter(l => (filter.setting === "all" || l.setting === filter.setting) && (filter.group === "all" || l.group === filter.group));
    shown.forEach(l => grid.appendChild(card(l)));
    grid.appendChild(uploadCard());
    $("archEmpty").hidden = shown.length > 0;
    $("archCount").textContent = shown.length + (shown.length === 1 ? " base" : " bases");
  }

  function init(list) {
    logs = list;
    thumbs = renderThumbs(list);
    const chips = $("settingChips");
    chips.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      chips.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      filter.setting = b.dataset.setting;
      render();
    });
    $("groupSel").addEventListener("change", e => { filter.group = e.target.value; render(); });
    render();
  }

  return { init };
})();
