// Works out k and the critical size off the main thread, so the sliders stay smooth. The page
// runs several of these at once, one task each, since the tasks don't depend on each other:
//   'ball-k'    → { k } for a metal ball
//   'ball-Rc'   → { Rc } its critical radius (by bisection)
//   'lattice'   → { lattice } k∞, four factors and migration area of the reactor's lattice
//   'core'      → { k } for the reactor core at rods = cfg.rods (escape fractions, timings, sites)
import { makeSystem, kEffective, criticalRadius, latticeProperties } from './chain.js';

const CORE_RUN = { neutrons: 1500, skip: 6, active: 14, seed: 5 };
// A PWR core is big and loosely coupled: more neutrons per generation, and more generations.
const PWR_RUN = { neutrons: 3000, skip: 12, active: 20, seed: 5 };

self.onmessage = ({ data: { id, task, cfg } }) => {
  let out;
  if (task === 'ball-k') out = { k: kEffective(makeSystem(cfg), { neutrons: 2000, skip: 8, active: 20, seed: 3 }) };
  else if (task === 'ball-Rc') out = { Rc: criticalRadius(cfg) };
  else if (task === 'lattice') out = { lattice: latticeProperties(cfg) };
  else if (task === 'core') out = { k: kEffective(makeSystem(cfg), cfg.design ? PWR_RUN : CORE_RUN) };
  self.postMessage({ id, task, rods: cfg.rods, ...out });
};
