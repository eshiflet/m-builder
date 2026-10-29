// Works out k and the critical size off the main thread, so the sliders stay smooth.
// Messages back: { id, k } for this setup (rods out, for a reactor); for a ball { id, Rc }; for a reactor core also
// { id, lattice } (k∞, four factors, migration area), { id, rodCurve: [[rods, k], …] }
// as each rod position is done, and { id, Rc } from diffusion theory fitted to this core.
import { makeSystem, kEffective, criticalRadius, latticeProperties } from './chain.js';

self.onmessage = ({ data: { id, cfg } }) => {
  if (cfg.kind !== 'reactor') {
    const k = kEffective(makeSystem(cfg), { neutrons: 2000, skip: 8, active: 20, seed: 3 });
    self.postMessage({ id, k });
    self.postMessage({ id, Rc: criticalRadius(cfg) });
    return;
  }
  const lattice = latticeProperties(cfg);
  self.postMessage({ id, lattice });
  const run = (c) => kEffective(makeSystem(c), { neutrons: 1500, skip: 6, active: 14, seed: 5 });
  // The rods move freely afterwards, so k is worked out at three rod positions (rods out
  // first, which also gives the escape fractions, timings and fission sites).
  const k = run({ ...cfg, rods: 0 });
  self.postMessage({ id, k });
  const rodCurve = [];
  for (const rods of [0, 0.5, 1]) {
    rodCurve.push([rods, rods === 0 ? k.k : run({ ...cfg, rods }).k]);
    self.postMessage({ id, rodCurve: [...rodCurve] });
  }
  // Critical radius with the rods out: one-group diffusion, k = k∞ / (1 + M²(π/R)²), with M²
  // taken from this core's own rods-out k (so it also knows about the rod channels and the
  // curved edge, and agrees with the k shown for this core).
  if (lattice.kInf <= 1) { self.postMessage({ id, Rc: null }); return; }
  const M2 = Math.max(1, (lattice.kInf / k.k - 1) * cfg.R * cfg.R / (Math.PI * Math.PI));
  const Rc = Math.PI * Math.sqrt(M2) / Math.sqrt(lattice.kInf - 1);
  self.postMessage({ id, Rc: Rc < 2000 ? Rc : null });
};
