// Turns a finished base (e.g. a CopyPaste save: prefab, final grade, position, rotation)
// into a believable build log, the way most players build:
// foundations -> per floor: floors, stairs, walls (placed as twig, then upgraded) -> doors -> loot.
function autoOrder(entities, opts) {
  opts = opts || {};
  const r = rng(opts.seed || 1);
  const g = (a, b) => a + (b - a) * r();
  const y0 = baseFloorY(entities.map(e => Object.assign({ op: "place" }, e)));
  let cx = 0, cz = 0;
  entities.forEach(e => { cx += e.pos[0]; cz += e.pos[2]; });
  cx /= entities.length || 1; cz /= entities.length || 1;

  const items = entities.map((e, k) => Object.assign({}, e, { id: k + 1, level: levelOf(e.pos[1], y0) }));
  const ev = [];
  let t = 0;
  const place = (it, gap) => {
    t += gap;
    ev.push({ t: R2(t), op: "place", id: it.id, prefab: it.prefab, grade: STRUCTURAL.has(it.prefab) ? "twigs" : it.grade || "wood", pos: it.pos.slice(), rot: it.rot || 0 });
  };
  const upgrade = (it, gap) => {
    if (!STRUCTURAL.has(it.prefab) || !it.grade || it.grade === "twigs") return;
    t += gap;
    ev.push({ t: R2(t), op: "upgrade", id: it.id, grade: it.grade });
  };
  const angle = it => Math.atan2(it.pos[2] - cz, it.pos[0] - cx);
  const byRow = (a, b) => a.pos[2] - b.pos[2] || a.pos[0] - b.pos[0];

  const structural = items.filter(i => STRUCTURAL.has(i.prefab));
  const maxL = structural.reduce((m, i) => Math.max(m, i.level), 0);
  for (let L = 0; L <= maxL; L++) {
    const batch = [];
    if (L === 0) batch.push(...structural.filter(i => i.prefab === "foundation").sort(byRow));
    batch.push(...structural.filter(i => i.prefab === "floor" && i.level === L).sort(byRow));
    batch.push(...structural.filter(i => i.prefab === "block.stair.ushape" && i.level === L));
    batch.push(...structural.filter(i => WALLS.has(i.prefab) && i.level === L).sort((a, b) => angle(a) - angle(b)));
    if (!batch.length) continue;
    if (L > 0) t += g(8, 16);
    batch.forEach(i => place(i, g(2.2, 4.5)));
    t += opts.idle ? g(35, 70) : g(4, 8);
    batch.forEach(i => upgrade(i, g(0.7, 1.3)));
  }

  t += opts.idle ? g(60, 90) : g(6, 10);
  const deploy = items.filter(i => !STRUCTURAL.has(i.prefab));
  const isDoor = i => (i.prefab.indexOf("door") === 0 ? 0 : 1);
  deploy.sort((a, b) => isDoor(a) - isDoor(b));
  deploy.forEach(i => place(i, g(3, 6)));
  return ev;
}
