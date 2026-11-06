// Our own models for the most-used deployables. Each fills its measured size (and the game's collision
// boxes still decide what you bump into), but the look is an original, simplified design: recognisable
// by shape and purpose, not a copy of the game's art. Anything you can see or shoot through (door slots,
// the embrasure's slit, hatch openings) comes straight from the measured collision boxes, so peeks match.
// Local frame: origin on the floor at the item's centre, front facing -z.
(function () {
  const mat = (hex, rough, metal, extra) => Object.assign(new THREE.MeshStandardMaterial({ color: lin(hex), roughness: rough, metalness: metal || 0 }), extra || {});
  Object.assign(DMATS, {
    mWood: mat("#a7774a", 0.85), mWoodDark: mat("#6f4c30", 0.9), mWoodPale: mat("#c49a66", 0.85),
    mSteel: mat("#8a9298", 0.5, 0.25), mSteelDark: mat("#4d555c", 0.55, 0.3), mRust: mat("#9a5f3c", 0.75, 0.15), mRustDark: mat("#6e4129", 0.8, 0.1),
    mStone: mat("#b3aa98", 0.95), mStoneDark: mat("#7d766a", 0.95), mBrass: mat("#c39a4c", 0.45, 0.4),
    mCloth: mat("#6f7f4d", 0.95), mClothDark: mat("#4f5c37", 0.95), mPillow: mat("#d9ccb0", 0.95), mRope: mat("#cdb27c", 0.9),
    mFire: mat("#ffb15a", 0.6, 0, { emissive: lin("#ff7a26"), emissiveIntensity: 1.6 }),
    mLampGreen: mat("#9cf0a0", 0.4, 0, { emissive: lin("#3bd65a"), emissiveIntensity: 1.4 }),
    mLampRed: mat("#ff8f80", 0.4, 0, { emissive: lin("#ff3b2a"), emissiveIntensity: 1.3 })
  });
  // The measured boxes of an item, in one material (for parts whose exact shape matters).
  const measured = (id, m, lift) => (CATALOG_BY_ID[id].cols || [CATALOG_BY_ID[id].b]).map(([x, y, z, w, h, d]) => B(w, h, d, x, y + (lift || 0), z, m));
  const bolts = (xs, ys, z, m, s) => { const o = []; xs.forEach(x => ys.forEach(y => o.push(B(s || 0.05, s || 0.05, 0.03, x, y, z, m || "mSteelDark")))); return o; };

  function workbench(level) {
    const top = level === 3 ? "mSteel" : "mWood", frame = level === 1 ? "mWoodDark" : level === 2 ? "mRust" : "mSteelDark";
    const W = 1.57, D = 0.84, ty = 0.78;
    const p = [
      B(W, 0.07, D, 0, ty, 0, top),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => B(0.08, ty - 0.035, 0.08, sx * (W / 2 - 0.05), (ty - 0.035) / 2, sz * (D / 2 - 0.05), frame)),
      B(W - 0.1, 0.04, D - 0.1, 0, 0.16, 0, frame),
      // Back board with tools hung on it.
      B(0.06, 2.2, 0.08, -0.75, 1.1, 0.38, frame), B(0.06, 2.2, 0.08, 0.75, 1.1, 0.38, frame),
      B(1.5, 1.05, 0.04, 0, 1.38, 0.4, level === 1 ? "mWoodPale" : level === 2 ? "mRustDark" : "mSteel"),
      B(1.57, 0.07, 0.16, 0, 2.17, 0.36, frame),
      B(0.06, 0.32, 0.03, -0.45, 1.5, 0.37, "mSteelDark"), B(0.18, 0.06, 0.04, -0.45, 1.66, 0.37, "mSteelDark"),
      B(0.05, 0.4, 0.03, -0.2, 1.45, 0.37, "mWoodDark"), B(0.2, 0.05, 0.03, 0.15, 1.62, 0.37, "mSteel"), B(0.04, 0.3, 0.03, 0.15, 1.45, 0.37, "mSteel"),
      B(0.22, 0.12, 0.2, 0.55, ty + 0.095, -0.25, "mSteelDark"), // vise
      B(0.4, 0.2, 0.3, -0.45, 0.28, -0.05, "mWoodDark")           // crate under the bench
    ];
    if (level >= 2) p.push(B(0.5, 0.25, 0.42, 0.45, ty + 0.16, 0.15, "mRust"), B(0.06, 0.06, 0.2, 0.45, ty + 0.3, -0.1, "mSteelDark"));
    if (level === 3) p.push(B(0.34, 0.86, 0.84, -0.94, 0.45, 0, "mSteelDark"), B(0.24, 0.26, 0.86, -0.97, 1.89, 0.02, "mSteelDark"), B(0.04, 0.06, 0.2, -0.78, 0.6, -0.3, "mLampGreen"), B(0.46, 0.8, 0.82, 0.55, 0.4, 0.02, "mSteel"));
    return p;
  }

  const M = {
    // A sturdy wooden cabinet with a brass plaque and a carry handle on top.
    "cupboard.tool.deployed": () => [
      B(1.14, 0.1, 0.88, 0, 0.05, 0, "mWoodDark"),
      B(1.04, 1.48, 0.78, 0, 0.84, 0.02, "mWood"),
      B(0.49, 1.3, 0.04, -0.255, 0.86, -0.39, "mWoodPale"), B(0.49, 1.3, 0.04, 0.255, 0.86, -0.39, "mWoodPale"),
      B(0.035, 0.18, 0.04, -0.04, 0.95, -0.42, "mBrass"), B(0.035, 0.18, 0.04, 0.04, 0.95, -0.42, "mBrass"),
      B(0.26, 0.2, 0.02, 0, 1.3, -0.42, "mBrass"),
      B(1.14, 0.09, 0.88, 0, 1.62, 0, "mWoodDark"),
      B(0.86, 0.16, 0.56, 0, 1.745, 0.02, "mWood"),
      B(0.06, 0.08, 0.06, -0.24, 1.86, 0.02, "mSteelDark"), B(0.06, 0.08, 0.06, 0.24, 1.86, 0.02, "mSteelDark"),
      B(0.54, 0.045, 0.06, 0, 1.89, 0.02, "mSteelDark")
    ],
    // Plank crate with dark corner posts, two straps and a latch.
    "box.wooden.large": () => [
      B(1.7, 0.66, 0.98, 0, 0.37, 0, "mWood"),
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => B(0.08, 0.74, 0.08, sx * 0.85, 0.37, sz * 0.48, "mWoodDark")),
      B(1.78, 0.08, 1.04, 0, 0.75, 0, "mWoodDark"),
      B(1.72, 0.05, 1.0, 0, 0.2, 0, "mWoodDark"), B(1.72, 0.05, 1.0, 0, 0.52, 0, "mWoodDark"),
      B(0.14, 0.16, 0.03, 0, 0.62, -0.52, "mSteelDark")
    ],
    "workbench1": () => workbench(1),
    "workbench2": () => workbench(2),
    "workbench3": () => workbench(3),
    // Squat stone furnace with a glowing mouth and a short chimney.
    "furnace": () => [
      B(0.98, 0.18, 0.99, 0, 0.09, -0.02, "mStoneDark"),
      B(0.94, 0.78, 0.95, 0, 0.57, -0.02, "mStone"),
      B(0.78, 0.38, 0.8, 0, 1.15, -0.02, "mStone"),
      B(0.58, 0.28, 0.6, 0, 1.47, -0.02, "mStoneDark"),
      B(0.44, 0.3, 0.04, 0, 0.45, -0.49, "mFire"),
      B(0.58, 0.06, 0.06, 0, 0.63, -0.5, "mSteelDark"), B(0.58, 0.06, 0.06, 0, 0.28, -0.5, "mSteelDark"),
      B(0.96, 0.05, 0.97, 0, 0.96, -0.02, "mSteelDark")
    ],
    // Stepped stone kiln, partly sunk into the ground, with fire openings on all four sides.
    "furnace.large": () => [
      B(4.2, 2.6, 4.2, 0, -0.7, 0, "mStoneDark"),
      B(3.5, 1.5, 3.5, 0, 1.35, 0, "mStone"),
      B(3.56, 0.1, 3.56, 0, 2.12, 0, "mSteelDark"),
      B(2.6, 1.55, 2.6, 0, 2.95, 0, "mStone"),
      B(1.5, 1.85, 1.5, 0, 4.65, 0, "mStoneDark"),
      B(1.6, 0.12, 1.6, 0, 5.52, 0, "mSteelDark"),
      B(1.4, 0.7, 0.04, 0, 1.26, -1.76, "mFire"), B(1.4, 0.7, 0.04, 0, 1.26, 1.76, "mFire"),
      B(0.04, 0.7, 1.4, -1.76, 1.26, 0, "mFire"), B(0.04, 0.7, 1.4, 1.76, 1.26, 0, "mFire")
    ],
    // Bedroll with a folded flap and a pillow.
    "sleepingbag_leather_deployed": () => [
      B(0.8, 0.1, 1.5, 0, 0.05, -0.15, "mCloth"),
      B(0.76, 0.06, 0.62, 0, 0.13, 0.25, "mClothDark"),
      B(0.6, 0.13, 0.3, 0, 0.09, -0.93, "mPillow"),
      B(0.82, 0.04, 0.06, 0, 0.11, 0.55, "mRope")
    ],
    // Boxy sentry gun on a cross-shaped base, with a status light.
    "autoturret": () => [
      B(1.0, 0.06, 0.12, 0, 0.03, -0.08, "mSteelDark"), B(0.12, 0.06, 1.15, 0, 0.03, -0.08, "mSteelDark"),
      B(0.24, 0.48, 0.24, 0, 0.3, -0.05, "mSteel"),
      B(0.64, 0.4, 0.62, 0, 0.74, 0, "mSteel"),
      B(0.66, 0.06, 0.64, 0, 0.97, 0, "mSteelDark"),
      B(0.2, 0.12, 0.04, -0.12, 0.8, -0.32, "mLampGreen"),
      B(0.1, 0.1, 0.48, 0.18, 0.72, -0.52, "mSteelDark"),
      B(0.18, 0.24, 0.3, -0.42, 0.7, 0.04, "mRust")
    ],
    // Post-mounted scatter gun on a plank foot, with a can of shells.
    "guntrap": () => [
      B(0.5, 0.04, 0.78, 0, 0.02, 0, "mWood"),
      B(0.1, 0.86, 0.1, 0, 0.47, 0, "mWoodDark"),
      B(0.16, 0.18, 0.46, 0, 0.86, 0.05, "mWoodDark"),
      B(0.08, 0.08, 0.6, 0, 0.92, -0.36, "mSteelDark"),
      B(0.22, 0.15, 0.2, 0.16, 0.78, 0.14, "mRust"),
      B(0.3, 0.03, 0.03, 0, 0.6, 0, "mRope")
    ],
    // Blocky stone rampart with a footing, coursing and merlons along the top.
    "wall.external.high.stone": () => [
      B(6.8, 1.5, 2.4, 0, -0.75, 0, "mStoneDark"),
      B(6.7, 6.0, 1.6, 0, 3.0, 0, "mStone"),
      B(6.74, 0.1, 1.64, 0, 1.6, 0, "mStoneDark"), B(6.74, 0.1, 1.64, 0, 3.4, 0, "mStoneDark"), B(6.74, 0.1, 1.64, 0, 5.0, 0, "mStoneDark"),
      B(6.76, 0.3, 1.7, 0, 6.12, 0, "mStoneDark"),
      ...[-2.55, -0.85, 0.85, 2.55].map(x => B(1.2, 0.25, 1.7, x, 6.39, 0, "mStone"))
    ],
    // Rusted sheet panel with ribs, hinges, a handle and a keypad.
    "door.hinged.metal": () => [
      ...measured("door.hinged.metal", "mRust"),
      ...[0.45, 0.9, 1.35, 1.8].map(y => B(1.12, 0.05, 0.135, 0, y + 0.11, 0.006, "mRustDark")),
      B(0.05, 0.16, 0.14, -0.56, 0.5, 0.006, "mSteelDark"), B(0.05, 0.16, 0.14, -0.56, 1.85, 0.006, "mSteelDark"),
      B(0.04, 0.2, 0.04, 0.45, 1.05, -0.08, "mSteelDark"),
      B(0.1, 0.15, 0.04, 0.45, 1.33, -0.08, "mSteelDark"), B(0.04, 0.03, 0.012, 0.45, 1.37, -0.1, "mLampGreen")
    ],
    // Heavy plate door; the slot near the top and its cover are where the game has them.
    "door.hinged.toptier": () => [
      ...measured("door.hinged.toptier", "mSteelDark"),
      ...bolts([-0.5, 0.5], [0.3, 0.8, 1.3], -0.08, "mSteel"),
      B(0.04, 0.2, 0.04, 0.0, 1.0, -0.09, "mSteel"),
      B(0.1, 0.15, 0.04, 0.0, 1.28, -0.09, "mSteel"), B(0.04, 0.03, 0.012, 0.0, 1.32, -0.11, "mLampGreen")
    ],
    // Two rusted leaves in a steel surround that fills the wall frame.
    "door.double.hinged.metal": () => [
      B(2.7, 0.64, 0.18, 0, 2.53, 0, "mSteelDark"),
      B(0.13, 2.2, 0.18, -1.285, 1.1, 0, "mSteelDark"), B(0.13, 2.2, 0.18, 1.285, 1.1, 0, "mSteelDark"),
      B(1.21, 2.085, 0.1, -0.601, 1.158, 0, "mRust"), B(1.21, 2.085, 0.1, 0.601, 1.158, 0, "mRust"),
      ...[0.55, 1.05, 1.55, 2.0].map(y => B(2.38, 0.05, 0.12, 0, y, 0, "mRustDark")),
      B(0.04, 0.2, 0.04, -0.1, 1.05, -0.08, "mSteelDark"), B(0.04, 0.2, 0.04, 0.1, 1.05, -0.08, "mSteelDark"),
      B(0.1, 0.15, 0.04, 0.2, 1.33, -0.08, "mSteelDark"), B(0.04, 0.03, 0.012, 0.2, 1.37, -0.1, "mLampGreen")
    ],
    // Roll-up door: the measured door panel with raised slats, side rails and a roller box on top.
    "wall.frame.garagedoor": () => {
      const c = CATALOG_BY_ID["wall.frame.garagedoor"];
      const [x0, y0, z0, w0, h0, d0] = c.cols[0];
      const p = [B(w0, h0, d0, x0, y0, z0, "mSteelDark")];
      c.cols.slice(2).forEach(([x, y, z, w, h, d], i) => p.push(B(w - 0.04, h - 0.03, d, x, y, z - 0.012, i % 2 ? "mSteel" : "mRust")));
      p.push(B(0.06, 2.85, 0.1, -1.32, 1.425, -0.07, "mSteelDark"), B(0.06, 2.85, 0.1, 1.32, 1.425, -0.07, "mSteelDark"));
      p.push(B(2.7, 0.24, 0.26, 0, 2.73, -0.18, "mSteelDark"));
      p.push(B(0.3, 0.04, 0.05, 0, 0.3, -0.13, "mSteelDark"));
      return p;
    },
    // The measured collar and lid (lid in rust), with ribs, a handle, and a ladder down to the floor below.
    "floor.ladder.hatch": () => {
      const p = measured("floor.ladder.hatch", "mSteelDark");
      p[4] = Object.assign({}, p[4], { m: "mRust" });
      [-0.22, 0, 0.22].forEach(z => p.push(B(1.08, 0.03, 0.05, -0.04, 0.226, z, "mRustDark")));
      p.push(B(0.12, 0.05, 0.05, 0.42, 0.23, 0, "mSteelDark"));
      p.push(B(0.05, 2.9, 0.05, -0.3, -1.55, 0.36, "mSteelDark"), B(0.05, 2.9, 0.05, 0.22, -1.55, 0.36, "mSteelDark"));
      for (let y = -0.35; y > -2.9; y -= 0.3) p.push(B(0.52, 0.035, 0.035, -0.04, y, 0.36, "mSteel"));
      return p;
    },
    // Plates over the window with one horizontal slit, exactly where the game leaves it.
    "shutter.metal.embrasure.a": () => [
      ...measured("shutter.metal.embrasure.a", "mSteel", WINDOW_BOTTOM),
      ...bolts([-0.9, -0.3, 0.3, 0.9], [WINDOW_BOTTOM + 1.45], 0.215, "mSteelDark", 0.045),
      ...bolts([-0.9, 0.9], [WINDOW_BOTTOM + 0.12], 0.215, "mSteelDark", 0.045)
    ]
  };
  Object.assign(ITEM_MODELS, M);
})();
