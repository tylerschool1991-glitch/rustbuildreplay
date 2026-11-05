// Routing between the archive (#archive) and base pages (#base-<slug>, #local), plus file loading.
let localLog = null;

function normalizeLog(log, fallbackName) {
  log.events = log.events.slice().sort((a, b) => a.t - b.t);
  if (!SETTINGS[log.setting]) log.setting = "open";
  if (!SOURCES[log.source]) log.source = "local";
  log.name = log.name || fallbackName || "Untitled base";
  if (log.terrain) {
    const t = log.terrain;
    const ok = t && typeof t.size === "number" && Number.isInteger(t.res) && t.res > 1 && Array.isArray(t.heights) && t.heights.length === t.res * t.res;
    if (!ok) delete log.terrain;
  }
  if (log.features && !Array.isArray(log.features)) delete log.features;
  if (log.features) log.features = log.features.filter(f => f && Array.isArray(f.pos) && f.pos.length === 3);
  return log;
}

function validate(log) {
  if (!log || !Array.isArray(log.events)) return "the file needs an \"events\" array.";
  if (!log.events.length) return "the events array is empty.";
  for (let i = 0; i < log.events.length; i++) {
    const e = log.events[i];
    if (!e || typeof e.t !== "number") return "events[" + i + "] is missing a numeric \"t\".";
    if (["place", "upgrade", "rotate", "remove"].indexOf(e.op) < 0) return "events[" + i + "] has op \"" + e.op + "\"; use place, upgrade, rotate or remove.";
    if (e.id === undefined) return "events[" + i + "] is missing \"id\".";
    if (e.op === "place") {
      if (!e.prefab) return "events[" + i + "] is missing \"prefab\".";
      if (!Array.isArray(e.pos) || e.pos.length !== 3 || e.pos.some(v => typeof v !== "number")) return "events[" + i + "] needs \"pos\" as [x, y, z] in metres.";
      if (!e.grade) e.grade = "twigs";
    }
  }
  return null;
}

function readFile(file) {
  const fr = new FileReader();
  fr.onload = () => {
    let log;
    try { log = JSON.parse(fr.result); } catch (err) { setStatus("Couldn't read " + file.name + ": it isn't valid JSON.", true); return; }
    const problem = validate(log);
    if (problem) { setStatus("Couldn't load " + file.name + ": " + problem, true); return; }
    setStatus("Loaded " + log.events.length + " events from " + file.name + ".");
    openLocalLog(normalizeLog(log, file.name.replace(/\.json$/i, "")));
  };
  fr.readAsText(file);
}

// Shows a log that isn't in the archive (a loaded file or a sandbox build) on the base page.
function openLocalLog(log) {
  localLog = normalizeLog(log);
  localLog.slug = "local";
  if (location.hash === "#local") route(); else location.hash = "local";
}

function route() {
  const h = location.hash.replace(/^#/, "");
  let target = null;
  if (h.indexOf("base-") === 0) target = SAMPLES.find(s => "base-" + s.slug === h) || null;
  else if (h === "local") target = localLog;
  const view = target ? "base" : h === "build" ? "build" : "archive";
  document.documentElement.dataset.mode = view === "archive" ? "archive" : "base";
  $("view-archive").hidden = view !== "archive";
  $("view-base").hidden = view !== "base";
  $("view-build").hidden = view !== "build";
  Viewer.setActive(view === "base");
  Builder.setActive(view === "build");
  if (target) Viewer.open(target);
  window.scrollTo(0, 0);
}

(function init() {
  SAMPLES.forEach(s => normalizeLog(s));
  Archive.init(SAMPLES);

  const fileInput = $("fileInput");
  $("loadBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { if (fileInput.files[0]) readFile(fileInput.files[0]); fileInput.value = ""; });

  [Viewer.viewport, $("view-archive")].forEach(zone => {
    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("drag"); });
    zone.addEventListener("dragleave", e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove("drag"); });
    zone.addEventListener("drop", e => {
      e.preventDefault();
      zone.classList.remove("drag");
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readFile(f);
    });
  });

  window.BuildReplayTest = Builder.test; // used by automated checks
  window.BuildReplayWalk = Walk.test;
  window.addEventListener("hashchange", route);
  route();
})();
