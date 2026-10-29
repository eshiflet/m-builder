// Works out k and the critical size off the main thread, so the sliders stay smooth.
import { makeSystem, kEffective, criticalRadius } from './chain.js';

self.onmessage = ({ data: { id, cfg } }) => {
  const k = kEffective(makeSystem(cfg), { neutrons: 2000, skip: 8, active: 20, seed: 3 });
  self.postMessage({ id, k });
  self.postMessage({ id, Rc: criticalRadius(cfg) });
};
