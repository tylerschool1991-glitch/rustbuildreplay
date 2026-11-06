// The look: sky, sun and haze by time of day, soft shadows, ambient occlusion, bloom, colour grading,
// a miniature (tilt-shift) mode, quality levels, and the "Look" panel. Purely visual: nothing here
// changes a piece's size, position, sockets or stability.
const Look = (function () {
  const KEY = "buildreplay.look.v1";
  const state = { style: "cozy", hour: 16.5, quality: "auto", miniature: false, orbit: false, follow: true };
  try { Object.assign(state, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { /* storage blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } };
  const listeners = [];
  const onChange = fn => listeners.push(fn);
  function set(patch) {
    Object.assign(state, patch);
    save();
    stages.forEach(applyStage);
    applyGlobal();
    listeners.forEach(fn => fn(state));
  }
  const cozy = () => state.style === "cozy";

  // ---------- Time of day ----------
  // Colours are sRGB; hours run from just before sunrise to night.
  const KEYS = [
    { h: 5.5,  top: "#2d3c63", hor: "#e3a07c", sun: "#ff9b5e", si: 0.5,  sky: "#7f90b8", gnd: "#463d35", hi: 0.6, exp: 1.0 },
    { h: 7.5,  top: "#6895cf", hor: "#ecc8a4", sun: "#ffcf9c", si: 1.3,  sky: "#aebfdc", gnd: "#55523f", hi: 0.78, exp: 0.9 },
    { h: 10.5, top: "#5a93d6", hor: "#cddfeb", sun: "#fff1de", si: 1.7,  sky: "#b8cbe2", gnd: "#5d6644", hi: 0.85, exp: 0.82 },
    { h: 13,   top: "#4d8bd3", hor: "#d2e3ee", sun: "#fff8ee", si: 1.8,  sky: "#bdd0e6", gnd: "#616b48", hi: 0.88, exp: 0.8 },
    { h: 16.5, top: "#5e8fcf", hor: "#e9d3b6", sun: "#ffd7a0", si: 1.65, sky: "#b3c4dc", gnd: "#625e42", hi: 0.82, exp: 0.84 },
    { h: 18.6, top: "#566db0", hor: "#efa97e", sun: "#ff9655", si: 1.25, sky: "#9ca6c9", gnd: "#55493a", hi: 0.7, exp: 0.92 },
    { h: 20,   top: "#26335c", hor: "#bb7676", sun: "#ff7a52", si: 0.4,  sky: "#64729f", gnd: "#363033", hi: 0.5, exp: 1.05 },
    { h: 21.5, top: "#0c1327", hor: "#27304c", sun: "#a9bde6", si: 0.35, sky: "#33426a", gnd: "#1a1c24", hi: 0.42, exp: 1.2 }
  ];
  const HOUR_MIN = KEYS[0].h, HOUR_MAX = KEYS[KEYS.length - 1].h;
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  function mixHex(a, b, t, out) { tmpA.set(a).convertSRGBToLinear(); tmpB.set(b).convertSRGBToLinear(); return out.copy(tmpA).lerp(tmpB, t); }
  function atHour(h) {
    h = Math.max(HOUR_MIN, Math.min(HOUR_MAX, h));
    let i = 0;
    while (i < KEYS.length - 2 && h > KEYS[i + 1].h) i++;
    const a = KEYS[i], b = KEYS[i + 1], t = smoothstep(0, 1, (h - a.h) / (b.h - a.h));
    const o = {};
    ["top", "hor", "sun", "sky", "gnd"].forEach(k => { o[k] = mixHex(a[k], b[k], t, new THREE.Color()); });
    ["si", "hi", "exp"].forEach(k => { o[k] = a[k] + (b[k] - a[k]) * t; });
    // The sun rises in the east (+x), crosses the south (-z) and sets in the west; after dusk the
    // light is the moon, high in the south-east.
    let dir;
    if (h <= 20.3) {
      const f = (h - 5.6) / (20.3 - 5.6);
      const az = (-80 + 160 * f) * Math.PI / 180, el = Math.max(0.035, Math.sin(Math.PI * Math.max(0, Math.min(1, f))) * 1.0);
      const elev = Math.asin(Math.min(0.92, el * 0.92));
      dir = new THREE.Vector3(Math.sin(az) * Math.cos(elev) * -1, Math.sin(elev), -Math.cos(az) * Math.cos(elev));
    } else {
      dir = new THREE.Vector3(0.45, 0.75, -0.48);
    }
    o.dir = dir.normalize();
    o.night = smoothstep(19.8, 21.2, h);
    return o;
  }
  const hourLabel = h => {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60 / 15) * 15;
    const H = (hh + (mm === 60 ? 1 : 0)) % 24, M = mm === 60 ? 0 : mm;
    return ((H + 11) % 12 + 1) + ":" + String(M).padStart(2, "0") + (H < 12 ? " am" : " pm");
  };

  // ---------- Sky dome ----------
  function makeSky() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, gnd: { value: new THREE.Color() },
        sunCol: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, night: { value: 0 }
      },
      vertexShader: "varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }",
      fragmentShader: [
        "uniform vec3 top; uniform vec3 hor; uniform vec3 gnd; uniform vec3 sunCol; uniform vec3 sunDir; uniform float night;",
        "varying vec3 vDir;",
        "float hash(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }",
        "void main(){",
        "  vec3 d = normalize(vDir); float h = d.y;",
        "  vec3 col = mix(hor, top, pow(clamp(h, 0.0, 1.0), 0.55));",
        "  col = mix(col, gnd, smoothstep(0.0, -0.12, h));",
        "  float s = max(dot(d, normalize(sunDir)), 0.0);",
        "  col += sunCol * (pow(s, 900.0) * 6.0 * (1.0 - night * 0.6) + pow(s, 12.0) * 0.22 + pow(s, 3.0) * 0.08 * (1.0 - night));",
        "  float st = step(0.9975, hash(floor(d * 260.0))) * night * smoothstep(0.05, 0.4, h);",
        "  col += vec3(st) * 0.9;",
        "  gl_FragColor = vec4(col, 1.0);",
        "  #include <tonemapping_fragment>",
        "  #include <encodings_fragment>",
        "}"
      ].join("\n"),
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    sky.onBeforeRender = (r, s, cam) => { sky.position.copy(cam.position); sky.updateMatrixWorld(); };
    return sky;
  }

  // ---------- Stages (one per 3D view) ----------
  const stages = [];
  function register(st) {
    st.sky = makeSky();
    st.scene.add(st.sky);
    st.scene.userData.noAO = [st.sky];
    st.focus = new THREE.Vector3();
    stages.push(st);
    applyStage(st);
    return st;
  }
  function applyStage(st) {
    const L = atHour(cozy() ? state.hour : 13);
    const u = st.sky.material.uniforms;
    u.top.value.copy(L.top); u.hor.value.copy(L.hor); u.gnd.value.copy(L.gnd).lerp(L.hor, 0.35);
    u.sunCol.value.copy(L.sun); u.sunDir.value.copy(L.dir); u.night.value = L.night;
    st.sun.color.copy(L.sun);
    st.sun.intensity = L.si;
    st.hemi.color.copy(L.sky);
    st.hemi.groundColor.copy(L.gnd);
    st.hemi.intensity = L.hi;
    st.fill.intensity = 0.28 + 0.12 * L.night;
    st.fill.color.copy(L.sky);
    st.dir = L.dir;
    st.exposure = L.exp;
    const fogCol = u.hor.value.clone().lerp(u.top.value, 0.12);
    st.scene.fog.color.copy(fogCol);
    st.scene.fog.near = cozy() ? 38 : 120;
    st.scene.fog.far = cozy() ? 190 + 110 * smoothstep(18.8, 20.5, state.hour) : 420;
    if (st.grid) st.grid.visible = !cozy() && st.gridWanted !== false;
    if (st.decor) st.decor.visible = cozy();
    follow(st, st.focus);
  }
  // The sun's shadow follows what the camera is looking at, so shadows stay sharp wherever you build.
  function follow(st, target) {
    st.focus.copy(target);
    const d = st.dir || new THREE.Vector3(0.5, 0.8, 0.3);
    st.sun.position.copy(target).addScaledVector(d, 90);
    st.sun.target.position.copy(target);
    st.sun.target.updateMatrixWorld();
  }
  function applyGlobal() {
    EDGE_MAT.visible = !cozy();
    setGradeLook(cozy());
  }

  // ---------- Quality ----------
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  const PRESETS = {
    low:    { post: false, ao: false, bloom: false, shadow: 1024, ratio: 1,    decor: 0.3 },
    medium: { post: true,  ao: true,  bloom: true,  shadow: 2048, ratio: 1,    decor: 0.65 },
    high:   { post: true,  ao: true,  bloom: true,  shadow: 4096, ratio: 1.75, decor: 1 }
  };
  let autoLevel = isMobile ? "low" : "medium";
  const level = () => (state.quality === "auto" ? autoLevel : state.quality);
  const preset = () => PRESETS[level()] || PRESETS.medium;

  // ---------- Shaders for the last steps ----------
  const GradeShader = {
    uniforms: { tDiffuse: { value: null }, warmth: { value: 0.0 }, sat: { value: 1.0 }, vignette: { value: 0.0 }, lift: { value: 0.0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: [
      "uniform sampler2D tDiffuse; uniform float warmth; uniform float sat; uniform float vignette; uniform float lift;",
      "varying vec2 vUv;",
      "vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }",
      "void main(){",
      "  vec3 c = texture2D(tDiffuse, vUv).rgb;",
      "  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));",
      "  c = mix(vec3(l), c, sat);",
      "  c *= mix(vec3(1.0), vec3(1.06, 1.0, 0.92), warmth);",
      "  c = c + lift * (1.0 - c) * vec3(0.9, 0.95, 1.05) * 0.06;",
      "  vec2 q = vUv - 0.5; float v = 1.0 - dot(q, q) * vignette * 1.6;",
      "  c *= clamp(v, 0.0, 1.0);",
      "  gl_FragColor = vec4(toSRGB(clamp(c, 0.0, 1.0)), 1.0);",
      "}"
    ].join("\n")
  };
  // Miniature: a blur that grows away from a horizontal band (sharp where you're looking).
  const TiltShader = {
    uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2(1, 0) }, amount: { value: 0.0 }, focus: { value: 0.55 }, res: { value: new THREE.Vector2(1, 1) } },
    vertexShader: GradeShader.vertexShader,
    fragmentShader: [
      "uniform sampler2D tDiffuse; uniform vec2 dir; uniform float amount; uniform float focus; uniform vec2 res;",
      "varying vec2 vUv;",
      "void main(){",
      "  float d = abs(vUv.y - focus); float r = smoothstep(0.06, 0.45, d) * amount;",
      "  vec2 step = dir / res * r * 1.8;",
      "  vec4 s = texture2D(tDiffuse, vUv) * 0.1964825;",
      "  s += (texture2D(tDiffuse, vUv + step * 1.4117647) + texture2D(tDiffuse, vUv - step * 1.4117647)) * 0.2969069;",
      "  s += (texture2D(tDiffuse, vUv + step * 3.2941176) + texture2D(tDiffuse, vUv - step * 3.2941176)) * 0.0944703;",
      "  s += (texture2D(tDiffuse, vUv + step * 5.1764706) + texture2D(tDiffuse, vUv - step * 5.1764706)) * 0.0103813;",
      "  gl_FragColor = s;",
      "}"
    ].join("\n")
  };

  // ---------- A renderer for one canvas ----------
  const views = [];
  function makeView(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const V = { renderer, composer: null, key: "", w: 1, h: 1, frames: [], hidden: [] };
    function setRatio() { renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset().ratio)); }
    setRatio();
    // Resizing only resizes the effect buffers; a new quality level (or scene) rebuilds them, and the
    // old ones are always freed first. (Leaving them behind used to eat graphics memory on every change
    // until the browser killed the page.)
    V.setSize = (w, h) => { V.w = w; V.h = h; setRatio(); renderer.setSize(w, h, false); };
    const pixels = () => { const pr = renderer.getPixelRatio(); return [Math.max(1, Math.floor(V.w * pr)), Math.max(1, Math.floor(V.h * pr))]; };
    function teardown() {
      const ps = V.passes;
      if (ps) {
        Object.keys(ps).forEach(k => {
          const pass = ps[k];
          try {
            if (pass.dispose) pass.dispose();
            if (pass.noiseTexture) pass.noiseTexture.dispose();
            if (pass.material && pass.material.dispose) pass.material.dispose();
            if (pass.fsQuad && pass.fsQuad.dispose) pass.fsQuad.dispose();
          } catch (e) { /* already gone */ }
        });
      }
      if (V.composer) { V.composer.renderTarget1.dispose(); V.composer.renderTarget2.dispose(); }
      V.composer = null; V.passes = null; V.sized = "";
    }
    function resizeEffects() {
      const [W, H] = pixels();
      V.composer.setSize(W, H);
      const ps = V.passes;
      if (ps.fxaa) ps.fxaa.uniforms.resolution.value.set(1 / W, 1 / H);
      if (ps.th) { ps.th.uniforms.res.value.set(W, H); ps.tv.uniforms.res.value.set(W, H); }
    }
    // If the graphics card drops the page's 3D context (out of memory, driver reset), step down to Low
    // and carry on when the browser hands it back, instead of leaving a dead page.
    canvas.addEventListener("webglcontextlost", e => {
      e.preventDefault();
      V.lost = true;
      autoLevel = "low";
      if (state.quality !== "low") { state.quality = "auto"; save(); }
      if (typeof setStatus === "function") setStatus("The graphics card ran out of room, so the view switched to Low quality.", true);
    });
    canvas.addEventListener("webglcontextrestored", () => { V.lost = false; V.composer = null; V.passes = null; V.key = ""; });
    function build(scene, camera) {
      V.builds = (V.builds || 0) + 1; // read by the automated checks
      const P = preset();
      const [W, H] = pixels();
      teardown();
      if (!P.post) return;
      const rt = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType });
      const composer = new THREE.EffectComposer(renderer, rt);
      composer.setPixelRatio(1);
      composer.setSize(W, H);
      const passes = {};
      if (P.ao) {
        const ao = new THREE.SSAOPass(scene, camera, W, H);
        // Light needs more than 8 bits between passes, or dusk skies band.
        ao.beautyRenderTarget.dispose();
        ao.beautyRenderTarget = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType });
        ao.ssaoMaterial.uniforms.tDiffuse.value = ao.beautyRenderTarget.texture;
        ao.kernelRadius = 1.6; ao.minDistance = 0.00004; ao.maxDistance = 0.012;
        // Grass and flowers sway in their own shader, so they stay out of the occlusion pass.
        const orig = ao.renderOverride.bind(ao);
        ao.renderOverride = function (r, mat, target, cc, ca) {
          const hide = mat === ao.normalMaterial ? scene.userData.noAO || [] : [];
          hide.forEach(o => { o.userData.wasVisible = o.visible; o.visible = false; });
          orig(r, mat, target, cc, ca);
          hide.forEach(o => { o.visible = o.userData.wasVisible; });
        };
        composer.addPass(ao); passes.ao = ao;
      } else {
        const rp = new THREE.RenderPass(scene, camera);
        composer.addPass(rp); passes.render = rp;
      }
      if (P.bloom) {
        const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(W, H), 0.22, 0.55, 0.82);
        composer.addPass(bloom); passes.bloom = bloom;
      }
      const th = new THREE.ShaderPass(TiltShader), tv = new THREE.ShaderPass(TiltShader);
      th.uniforms.res.value.set(W, H); tv.uniforms.res.value.set(W, H); tv.uniforms.dir.value.set(0, 1);
      composer.addPass(th); composer.addPass(tv); passes.th = th; passes.tv = tv;
      const grade = new THREE.ShaderPass(GradeShader);
      composer.addPass(grade); passes.grade = grade;
      const fxaa = new THREE.ShaderPass(THREE.FXAAShader);
      fxaa.uniforms.resolution.value.set(1 / W, 1 / H);
      composer.addPass(fxaa); passes.fxaa = fxaa;
      V.composer = composer; V.passes = passes;
    }
    V.render = (scene, camera, st) => {
      if (V.lost) return;
      try { draw(scene, camera, st); }
      catch (err) {
        // Never let a rendering error stop the page: drop the effects and draw plainly from now on.
        if (!V.failed) { V.failed = true; console.error("BuildReplay: effects turned off after an error", err); }
        teardown(); V.noPost = true;
        try { renderer.render(scene, camera); } catch (e2) { /* nothing more to do */ }
      }
    };
    function draw(scene, camera, st) {
      const P = preset();
      const key = level() + ":" + scene.uuid;
      if (key !== V.key) { V.key = key; setRatio(); renderer.setSize(V.w, V.h, false); if (V.noPost) teardown(); else build(scene, camera); }
      const sz = V.w + "x" + V.h + "@" + renderer.getPixelRatio();
      if (V.composer && sz !== V.sized) { V.sized = sz; resizeEffects(); }
      if (st) {
        renderer.toneMappingExposure = st.exposure || 1;
        st.sun.shadow.mapSize.width !== P.shadow && resizeShadow(st, P.shadow);
      }
      if (!V.composer) { renderer.render(scene, camera); trackFps(); return; }
      const ps = V.passes;
      if (ps.ao) {
        if (ps.ao.camera !== camera || ps.ao.lastNear !== camera.near) ps.ao.camera = camera;
        const u = ps.ao.ssaoMaterial.uniforms;
        u.cameraNear.value = camera.near; u.cameraFar.value = camera.far;
        u.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
        u.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
      }
      if (ps.render) ps.render.camera = camera;
      const mini = cozy() && state.miniature ? 1 : 0;
      ps.th.enabled = ps.tv.enabled = !!mini;
      ps.th.uniforms.amount.value = ps.tv.uniforms.amount.value = mini * 1.8;
      if (ps.bloom) ps.bloom.enabled = cozy();
      const g = ps.grade.uniforms;
      g.warmth.value = cozy() ? 0.55 : 0; g.sat.value = cozy() ? 1.08 : 1; g.vignette.value = cozy() ? 0.55 : 0; g.lift.value = cozy() ? 1 : 0;
      V.composer.render();
      trackFps();
    }
    function trackFps() {
      if (state.quality !== "auto") return;
      const now = performance.now();
      V.frames.push(now);
      if (V.frames.length > 90) V.frames.shift();
      if (V.frames.length === 90 && autoLevel !== "low") {
        const ms = (V.frames[89] - V.frames[0]) / 89;
        if (ms > 42) { autoLevel = autoLevel === "high" ? "medium" : "low"; V.frames = []; views.forEach(v => { v.key = ""; }); listeners.forEach(fn => fn(state)); }
      }
    }
    views.push(V);
    return V;
  }
  function resizeShadow(st, size) {
    st.sun.shadow.mapSize.set(size, size);
    if (st.sun.shadow.map) { st.sun.shadow.map.dispose(); st.sun.shadow.map = null; }
  }

  // ---------- The Look panel ----------
  function mountPanel(viewport, opts) {
    opts = opts || {};
    const wrap = el("div", "look");
    const btn = el("button", "look-btn");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    const panel = el("div", "look-panel");
    panel.hidden = true;
    const row = (label, ctl) => { const r = el("div", "look-row"); const l = el("span", "look-label", label); r.append(l, ctl); return r; };
    function seg(name, options, cur, onPick) {
      const g = el("div", "seg"); g.setAttribute("role", "group"); g.setAttribute("aria-label", name);
      options.forEach(([v, text]) => {
        const b = el("button", "", text); b.type = "button"; b.dataset.v = v;
        b.addEventListener("click", () => onPick(v));
        g.appendChild(b);
      });
      g.sync = val => g.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === val)));
      g.sync(cur);
      return g;
    }
    const style = seg("Style", [["cozy", "Cozy"], ["accurate", "Accurate"]], state.style, v => set({ style: v }));
    const time = el("input"); time.type = "range"; time.min = HOUR_MIN; time.max = HOUR_MAX; time.step = 0.25; time.value = state.hour;
    time.setAttribute("aria-label", "Time of day");
    const timeOut = el("span", "look-val");
    time.addEventListener("input", () => set({ hour: Number(time.value) }));
    const timeWrap = el("div", "look-time"); timeWrap.append(time, timeOut);
    const quality = seg("Quality", [["auto", "Auto"], ["low", "Low"], ["medium", "Med"], ["high", "High"]], state.quality, v => set({ quality: v }));
    const toggles = el("div", "look-toggles");
    function toggle(key, label, title) {
      const l = el("label", "look-tog"); const c = el("input"); c.type = "checkbox"; c.checked = !!state[key];
      c.addEventListener("change", () => set({ [key]: c.checked }));
      l.title = title || "";
      l.append(c, document.createTextNode(" " + label));
      l.sync = () => { c.checked = !!state[key]; };
      return l;
    }
    const tMini = toggle("miniature", "Miniature", "Tilt-shift blur, like looking at a model");
    const tOrbit = toggle("orbit", "Slow orbit", "The camera drifts slowly around the build");
    toggles.append(tMini, tOrbit);
    let tFollow = null;
    if (opts.follow) { tFollow = toggle("follow", "Follow the build", "During a replay the camera eases toward each new piece"); toggles.append(tFollow); }
    const cine = el("button", "btn look-cine", "Cinematic view");
    cine.type = "button";
    cine.title = "Hides the interface. Press Esc or click to come back.";
    cine.addEventListener("click", () => { close(); setCinema(true, opts.onCinema); });
    const note = el("p", "look-note", "Cozy is for watching. Accurate turns off haze, grass and blur and shows piece outlines, for checking peeks.");
    panel.append(row("Style", style), row("Time", timeWrap), row("Quality", quality), toggles, cine, note);
    wrap.append(btn, panel);
    viewport.appendChild(wrap);
    function syncAll() {
      style.sync(state.style); quality.sync(state.quality);
      time.value = state.hour; time.disabled = !cozy();
      timeOut.textContent = cozy() ? hourLabel(state.hour) : "Noon";
      tMini.sync(); tOrbit.sync(); if (tFollow) tFollow.sync();
      tMini.querySelector("input").disabled = !cozy();
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/></svg><span></span>';
      btn.querySelector("span").textContent = cozy() ? hourLabel(state.hour) + " · Cozy" : "Accurate";
    }
    function close() { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); }
    btn.addEventListener("click", e => { e.stopPropagation(); panel.hidden = !panel.hidden; btn.setAttribute("aria-expanded", String(!panel.hidden)); });
    document.addEventListener("pointerdown", e => { if (!panel.hidden && !wrap.contains(e.target)) close(); });
    onChange(syncAll);
    syncAll();
    return { close };
  }

  // ---------- Cinematic view ----------
  let cinemaCb = null;
  function setCinema(on, cb) {
    document.documentElement.classList.toggle("cinema", on);
    if (on) cinemaCb = cb || null;
    if (cinemaCb) cinemaCb(on);
    if (!on) cinemaCb = null;
    window.dispatchEvent(new Event("resize"));
  }
  window.addEventListener("keydown", e => { if (e.key === "Escape" && document.documentElement.classList.contains("cinema")) setCinema(false); });
  const exitHint = el("button", "cinema-exit", "Esc to leave cinematic view");
  exitHint.type = "button";
  exitHint.addEventListener("click", () => setCinema(false));
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(exitHint));
  if (document.body) document.body.appendChild(exitHint);

  // Shared clock for wind and other gentle motion.
  const time = { value: 0 };
  function tick(dt) { time.value += dt; }

  return { views, level, state, set, onChange, register, follow, makeView, mountPanel, tick, time, cozy, preset, setCinema, applyGlobal, hourLabel };
})();

// ---------- Dust puffs when a piece lands ----------
function makeDust(scene) {
  const N = 240;
  const pos = new Float32Array(N * 3), alpha = new Float32Array(N), size = new Float32Array(N);
  const vel = new Float32Array(N * 3), life = new Float32Array(N), maxLife = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute("size", new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color("#d9ccb2").convertSRGBToLinear() } },
    vertexShader: "attribute float alpha; attribute float size; varying float vA; void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * 320.0 / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }",
    fragmentShader: "uniform vec3 color; varying float vA; void main(){ vec2 p = gl_PointCoord - 0.5; float d = dot(p,p); if (d > 0.25) discard; gl_FragColor = vec4(color, vA * (1.0 - d * 4.0)); \n#include <tonemapping_fragment>\n#include <encodings_fragment>\n}",
    transparent: true, depthWrite: false
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  let next = 0;
  function emit(x, y, z, spread, count) {
    for (let k = 0; k < count; k++) {
      const i = next; next = (next + 1) % N;
      const a = Math.random() * Math.PI * 2, r = spread * (0.4 + Math.random() * 0.6);
      pos[i * 3] = x + Math.cos(a) * r; pos[i * 3 + 1] = y + Math.random() * 0.15; pos[i * 3 + 2] = z + Math.sin(a) * r;
      vel[i * 3] = Math.cos(a) * (0.5 + Math.random()); vel[i * 3 + 1] = 0.25 + Math.random() * 0.35; vel[i * 3 + 2] = Math.sin(a) * (0.5 + Math.random());
      maxLife[i] = life[i] = 0.7 + Math.random() * 0.5;
      size[i] = 0.25 + Math.random() * 0.3;
    }
  }
  function update(dt) {
    let any = false;
    for (let i = 0; i < N; i++) {
      if (life[i] <= 0) { alpha[i] = 0; continue; }
      any = true;
      life[i] -= dt;
      const t = 1 - Math.max(0, life[i]) / maxLife[i];
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      vel[i * 3] *= 0.92; vel[i * 3 + 2] *= 0.92; vel[i * 3 + 1] *= 0.96;
      size[i] += dt * 0.5;
      alpha[i] = Math.sin(Math.PI * Math.min(1, t)) * 0.38;
    }
    if (any) { geo.attributes.position.needsUpdate = true; geo.attributes.alpha.needsUpdate = true; geo.attributes.size.needsUpdate = true; }
  }
  return { emit, update, points: pts };
}

Look.applyGlobal();
