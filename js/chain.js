// Neutron chain reactions: Monte Carlo neutron transport through a ball of fuel,
// optionally wrapped in a reflector.
//
// Units: cm, MeV, ns. Cross sections are energy-averaged values from the evaluated
// libraries (ENDF/B), smoothed over resonances; they're interpolated log–log in energy.

const NS = 1e-9;
const V_CM_PER_NS = 1.3832; // neutron speed per √(E/MeV): c·√(2E/mₙc²)
const AVOGADRO_B = 0.60221; // atoms per barn·cm, per (g/cm³)/(g/mol)
export const MEV_J = 1.602177e-13;
export const FISSION_MEV = 200; // recoverable energy per fission
export const TNT_TON_J = 4.184e9;
const KT_ROOM = 2.53e-8; // MeV: thermal neutrons at 20 °C

// Energy grid (MeV): thermal, 1 eV … 20 MeV.
const GRID = [2.53e-8, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.1, 0.5, 1, 1.5, 2, 5, 10, 20];

/** Nuclides: mass number A, cross sections (barns) on GRID, prompt ν̄(E), Watt fission spectrum. */
export const NUCLIDES = {
  U235: {
    A: 235, label: '²³⁵U', molar: 235.04,
    f: [585, 93, 30, 12, 5, 2.6, 1.65, 1.19, 1.26, 1.29, 1.32, 1.06, 1.75, 2.1],
    c: [99, 16, 15, 6, 2.5, 1.0, 0.45, 0.17, 0.11, 0.08, 0.06, 0.03, 0.01, 0.005],
    el: [15, 14, 12, 12, 11, 11, 9.6, 5.6, 4.2, 4.1, 4.0, 3.9, 2.8, 2.8],
    inel: [0, 0, 0, 0, 0, 0, 0.05, 0.8, 1.1, 1.3, 1.35, 1.75, 1.2, 0.6],
    n2n: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.8, 0.4], n2nQ: 5.3,
    nu: (E) => (E < 1 ? 2.43 + 0.065 * E : 2.35 + 0.15 * E), watt: [0.988, 2.249],
  },
  U238: {
    A: 238, label: '²³⁸U', molar: 238.05,
    f: [0, 0, 0, 0, 0, 0, 0, 0, 0.015, 0.35, 0.53, 0.55, 1.0, 1.3],
    c: [2.68, 0.43, 10, 8, 3, 0.6, 0.15, 0.13, 0.13, 0.09, 0.05, 0.01, 0.003, 0.002],
    el: [9.3, 9.5, 10, 10, 12, 13, 11, 6.5, 4.5, 4.5, 4.6, 4.4, 2.8, 2.9],
    inel: [0, 0, 0, 0, 0, 0, 0.2, 1.0, 1.3, 1.8, 2.0, 2.3, 1.0, 0.4],
    n2n: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.4, 0.6], n2nQ: 6.2,
    nu: (E) => 2.3 + 0.15 * E, watt: [0.881, 3.4],
  },
  Pu239: {
    A: 239, label: '²³⁹Pu', molar: 239.05,
    f: [748, 60, 30, 12, 5, 2.3, 1.57, 1.67, 1.72, 1.81, 1.94, 1.8, 2.3, 2.4],
    c: [271, 30, 20, 8, 3, 0.8, 0.3, 0.1, 0.06, 0.04, 0.03, 0.01, 0.005, 0.002],
    el: [8, 10, 11, 11, 11, 11, 9.4, 5.6, 4.2, 4.0, 3.8, 3.7, 2.8, 2.9],
    inel: [0, 0, 0, 0, 0, 0, 0.05, 0.8, 1.0, 1.15, 1.2, 1.5, 0.9, 0.5],
    n2n: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 0.2], n2nQ: 5.6,
    nu: (E) => 2.874 + 0.138 * E, watt: [0.966, 2.842],
  },
  Be9: {
    A: 9, label: '⁹Be', molar: 9.012, light: true,
    c: [0.0076, 0.0012, 4e-4, 1.2e-4, 4e-5, 1.2e-5, 4e-6, 2e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6],
    el: [6.15, 6.15, 6.15, 6.15, 6.1, 6.0, 5.6, 4.0, 3.2, 2.7, 2.3, 1.4, 1.0, 0.9],
    n2n: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.5, 0.5, 0.4], n2nQ: 1.67,
  },
  H1: {
    A: 1, label: '¹H', molar: 1.008, light: true,
    c: [0.332, 0.0531, 0.0168, 0.0053, 0.00168, 5.3e-4, 1.7e-4, 7e-5, 5e-5, 4e-5, 3.5e-5, 3e-5, 3e-5, 3e-5],
    el: [20.4, 20.4, 20.4, 20.3, 20.2, 19.8, 12.7, 6.2, 4.26, 3.4, 2.9, 1.6, 0.95, 0.48],
  },
  O16: {
    A: 16, label: '¹⁶O', molar: 16.0, light: true,
    c: [1.9e-4, 3e-5, 1e-5, 3e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-5, 1e-5, 1e-5, 1e-5, 1e-5],
    el: [3.8, 3.8, 3.8, 3.8, 3.8, 3.8, 3.7, 3.5, 3.0, 2.0, 1.7, 1.2, 1.0, 0.9],
  },
};

/** Fuels: enrichment e is the fissile fraction by atom (uranium only). */
export function fuelMaterial(kind, e = 0.937) {
  if (kind === 'Pu') {
    // δ-phase plutonium (stabilized with ~1% gallium), as in the Jezebel experiment.
    return makeMaterial('Plutonium-239 (δ phase)', 15.6, [['Pu239', 1]]);
  }
  // Uranium metal: ~19.05 g/cm³ for ²³⁸U, a little less as the lighter ²³⁵U takes over.
  const molar = e * 235.04 + (1 - e) * 238.05;
  return makeMaterial(`Uranium (${pctText(e)} ²³⁵U)`, 19.05 * molar / 238.05, [['U235', e], ['U238', 1 - e]]);
}

export const REFLECTORS = {
  none: null,
  natU: () => makeMaterial('Natural uranium', 19.05, [['U235', 0.0072], ['U238', 0.9928]]),
  Be: () => makeMaterial('Beryllium', 1.85, [['Be9', 1]]),
  water: () => makeMaterial('Water', 1.0, [['H1', 2 / 3], ['O16', 1 / 3]]),
};

function pctText(e) { return e >= 0.1 ? `${(100 * e).toFixed(e > 0.995 ? 0 : 1)}%` : `${(100 * e).toFixed(2)}%`; }

/** A material: density (g/cm³) and atom fractions; atom densities in atoms per barn·cm. */
function makeMaterial(name, density, parts) {
  const molar = parts.reduce((s, [k, x]) => s + x * NUCLIDES[k].molar, 0);
  const n = (density / molar) * AVOGADRO_B;
  return { name, density, parts: parts.filter(([, x]) => x > 0).map(([k, x]) => ({ key: k, nuc: NUCLIDES[k], N: n * x })) };
}

/** Interpolate a tabulated cross section at energy E (log–log, or linear around zeros). */
function interp(tab, E) {
  if (!tab) return 0;
  if (E <= GRID[0]) return tab[0] * Math.sqrt(GRID[0] / E); // 1/v below thermal
  if (E >= GRID[GRID.length - 1]) return tab[tab.length - 1];
  let i = 0;
  while (GRID[i + 1] < E) i++;
  const a = tab[i], b = tab[i + 1];
  const u = Math.log(E / GRID[i]) / Math.log(GRID[i + 1] / GRID[i]);
  return a > 0 && b > 0 ? a * (b / a) ** u : a + (b - a) * u;
}

/** All partial cross sections of a nuclide at E (barns). Elastic stays flat below thermal. */
export function sigmas(nuc, E) {
  const thermal = E <= GRID[0];
  return {
    f: interp(nuc.f, E), c: interp(nuc.c, E),
    el: thermal ? nuc.el[0] : interp(nuc.el, E),
    inel: thermal ? 0 : interp(nuc.inel, E),
    n2n: E > (nuc.n2nQ ?? Infinity) ? interp(nuc.n2n, E) : 0,
  };
}

/** Macroscopic cross sections of a material at E: total Σ (1/cm) and per-nuclide parts. */
function macro(mat, E) {
  let tot = 0;
  const parts = mat.parts.map((p) => {
    const s = sigmas(p.nuc, E);
    const t = p.N * (s.f + s.c + s.el + s.inel + s.n2n);
    tot += t;
    return { p, s, t };
  });
  return { tot, parts };
}

export function speed(E) { return V_CM_PER_NS * Math.sqrt(E); } // cm/ns

// ---------- random sampling ----------

export function rng(seed) {
  let s = (seed ^ 0x9e3779b9) >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 0; i < 8; i++) next();
  return () => { let x; do x = next(); while (x === 0); return x; };
}

/** Watt fission spectrum, sampled exactly (the method used in MCNP). */
function sampleWatt([a, b], r) {
  const K = 1 + (a * b) / 8, L = a * (K + Math.sqrt(K * K - 1)), M = L / a - 1;
  for (;;) {
    const x = -Math.log(r()), y = -Math.log(r());
    if ((y - M * (x + 1)) ** 2 <= b * L * x) return L * x;
  }
}

/** Evaporation spectrum E·e^(−E/T), the energy left to a neutron after inelastic scattering. */
function sampleEvap(T, Emax, r) {
  for (let k = 0; k < 20; k++) {
    const E = -T * Math.log(r() * r());
    if (E < Emax) return E;
  }
  return Emax * r();
}

function isotropic(r) {
  const mu = 2 * r() - 1, phi = 2 * Math.PI * r(), s = Math.sqrt(1 - mu * mu);
  return [s * Math.cos(phi), s * Math.sin(phi), mu];
}

/** Turn direction d by polar cosine mu and a random azimuth. */
function deflect(d, mu, r) {
  const phi = 2 * Math.PI * r(), s = Math.sqrt(Math.max(0, 1 - mu * mu));
  const [u, v, w] = d;
  if (Math.abs(w) > 0.9999) return [s * Math.cos(phi), s * Math.sin(phi), mu * Math.sign(w)];
  const q = Math.sqrt(1 - w * w);
  return [
    mu * u + (s * (u * w * Math.cos(phi) - v * Math.sin(phi))) / q,
    mu * v + (s * (v * w * Math.cos(phi) + u * Math.sin(phi))) / q,
    mu * w - s * q * Math.cos(phi),
  ];
}

/** Heavy nuclei scatter fast neutrons forward: mean lab cosine of elastic scattering. */
function forwardness(A, E) { return A > 100 ? Math.min(0.8, 0.45 * E ** 0.35) : 0; }

/** Henyey–Greenstein angle with mean cosine g. */
function sampleHG(g, r) {
  if (g < 1e-3) return 2 * r() - 1;
  const t = (1 - g * g) / (1 - g + 2 * g * r());
  return Math.max(-1, Math.min(1, (1 + g * g - t * t) / (2 * g)));
}

/** Room-temperature Maxwellian, for neutrons that have slowed to thermal. */
function sampleThermal(r) {
  const c = Math.cos((Math.PI / 2) * r());
  return KT_ROOM * (-Math.log(r()) - Math.log(r()) * c * c);
}

// ---------- geometry and transport ----------

/**
 * A system: a fuel ball of radius R (cm) and an optional reflector shell of thickness T.
 * Regions: 0 = fuel, 1 = reflector, 2 = outside (escaped).
 */
export function makeSystem({ fuel, enrichment, R, reflector = 'none', T = 0 }) {
  const fuelMat = fuelMaterial(fuel, enrichment);
  const refMat = reflector !== 'none' && T > 0 ? REFLECTORS[reflector]() : null;
  const mats = [fuelMat, refMat];
  const R2 = refMat ? R + T : R;
  const mass = fuelMat.density * (4 / 3) * Math.PI * R ** 3 / 1000; // kg
  const refMass = refMat ? refMat.density * (4 / 3) * Math.PI * (R2 ** 3 - R ** 3) / 1000 : 0;
  const fissileAtoms = fuelMat.parts.filter((p) => p.nuc.f && p.key !== 'U238').reduce((s, p) => s + p.N, 0) * 1e24 * (4 / 3) * Math.PI * R ** 3;
  return { fuel, enrichment, R, R2, reflector: refMat ? reflector : 'none', T: refMat ? T : 0, mats, fuelMat, refMat, mass, refMass, fissileAtoms };
}

function regionOf(sys, p) {
  const r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  return r2 < sys.R * sys.R ? 0 : sys.refMat && r2 < sys.R2 * sys.R2 ? 1 : 2;
}

/** Distance from p along d to the next sphere surface, given the current region. */
function toBoundary(sys, p, d, region) {
  const b = p[0] * d[0] + p[1] * d[1] + p[2] * d[2];
  const c = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
  if (region === 0) return -b + Math.sqrt(Math.max(0, b * b - c + sys.R * sys.R));
  const disc = b * b - c + sys.R * sys.R;
  if (b < 0 && disc > 0) return -b - Math.sqrt(disc);
  return -b + Math.sqrt(Math.max(0, b * b - c + sys.R2 * sys.R2));
}

/**
 * Fly a neutron to its next event. Returns { kind: 'collide'|'cross'|'escape', s (cm), point,
 * region }. A crossing moves it just past the boundary into the next region.
 */
export function nextEvent(sys, n, r) {
  const mat = sys.mats[n.region];
  if (!mat) return { kind: 'escape', s: 0, point: n.p };
  const sb = toBoundary(sys, n.p, n.d, n.region);
  const st = -Math.log(r()) / macro(mat, n.E).tot;
  if (st < sb) return { kind: 'collide', s: st, point: add(n.p, n.d, st) };
  const point = add(n.p, n.d, sb + 1e-6);
  const region = regionOf(sys, point);
  return { kind: region === 2 ? 'escape' : 'cross', s: sb, point, region };
}

function add(p, d, s) { return [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s]; }

/**
 * Collide neutron n (already moved to the collision point) in its region. Returns
 * { kind: 'fission'|'capture'|'elastic'|'inelastic'|'n2n', nuclide, out: [new neutrons] }.
 * On a scatter, out holds n itself with new direction and energy.
 */
export function collide(sys, n, r) {
  const mat = sys.mats[n.region];
  const m = macro(mat, n.E);
  let x = r() * m.tot, hit = m.parts[m.parts.length - 1];
  for (const q of m.parts) { if ((x -= q.t) <= 0) { hit = q; break; } }
  const { nuc } = hit.p, s = hit.s;
  const tot = s.f + s.c + s.el + s.inel + s.n2n;
  let y = r() * tot;
  const E = n.E, A = nuc.A;
  if ((y -= s.f) < 0) {
    const nu = nuc.nu(E), k = Math.floor(nu) + (r() < nu - Math.floor(nu) ? 1 : 0);
    const out = [];
    for (let i = 0; i < k; i++) out.push({ p: n.p, d: isotropic(r), E: sampleWatt(nuc.watt, r), region: n.region });
    return { kind: 'fission', nuclide: hit.p.key, out, E };
  }
  if ((y -= s.c) < 0) return { kind: 'capture', nuclide: hit.p.key, out: [], E };
  if ((y -= s.el) < 0) {
    // Elastic: angle in the centre-of-mass frame, then the lab-frame energy and direction.
    const muc = sampleHG(forwardness(A, E), r);
    const q = A * A + 2 * A * muc + 1;
    let E2 = (E * q) / ((A + 1) * (A + 1));
    const mul = (1 + A * muc) / Math.sqrt(q);
    if (E2 < 4 * KT_ROOM) E2 = sampleThermal(r); // slowed to thermal: now in equilibrium with the material
    return { kind: 'elastic', nuclide: hit.p.key, out: [{ ...n, d: deflect(n.d, mul, r), E: E2 }], E };
  }
  const T = Math.sqrt((8 * E) / A); // nuclear temperature of the excited target (Fermi gas, a = A/8)
  if ((y -= s.inel) < 0) return { kind: 'inelastic', nuclide: hit.p.key, out: [{ ...n, d: isotropic(r), E: sampleEvap(T, E, r) }], E };
  const avail = E - nuc.n2nQ, E1 = sampleEvap(T, avail, r), E2 = sampleEvap(T, Math.max(1e-6, avail - E1), r);
  return { kind: 'n2n', nuclide: hit.p.key, out: [{ ...n, d: isotropic(r), E: E1 }, { ...n, d: isotropic(r), E: E2 }], E };
}

/** A fission neutron born at point p (fuel). */
export function birth(sys, p, r, nuclideKey = sys.fuel === 'Pu' ? 'Pu239' : 'U235') {
  return { p, d: isotropic(r), E: sampleWatt(NUCLIDES[nuclideKey].watt, r), region: regionOf(sys, p) };
}

/** Uniform random point in the fuel ball. */
export function pointInFuel(sys, r) {
  const u = Math.cbrt(r()) * sys.R, d = isotropic(r);
  return [d[0] * u, d[1] * u, d[2] * u];
}

/**
 * Follow one neutron (and any (n,2n) partners) until every branch is absorbed or escapes.
 * Fission sites and their birth times go to `sites`; tallies to `tally`.
 */
function history(sys, n0, r, sites, tally) {
  const stack = [{ ...n0, t: n0.t ?? 0 }];
  while (stack.length) {
    const n = stack.pop();
    for (let guard = 0; guard < 100000; guard++) {
      const ev = nextEvent(sys, n, r);
      n.t += ev.s / speed(n.E);
      n.p = ev.point;
      if (ev.kind === 'escape') { tally.escape++; break; }
      if (ev.kind === 'cross') { n.region = ev.region; continue; }
      const res = collide(sys, n, r);
      if (res.kind === 'fission') {
        tally.fission++;
        tally.genTime += n.t * res.out.length;
        for (const o of res.out) sites.push({ ...o, t: 0 });
        break;
      }
      if (res.kind === 'capture') { tally.capture++; break; }
      Object.assign(n, res.out[0]);
      if (res.out[1]) stack.push({ ...res.out[1], t: n.t });
    }
  }
}

/**
 * Effective multiplication factor k by power iteration over fission generations.
 * Returns { k, sd, genTime (ns), escape, capture } (fractions of neutrons that end each way).
 */
export function kEffective(sys, { neutrons = 2000, skip = 8, active = 20, seed = 1 } = {}) {
  const r = rng(seed);
  let source = Array.from({ length: neutrons }, () => birth(sys, pointInFuel(sys, r), r));
  const ks = [];
  const sum = { escape: 0, capture: 0, fission: 0, genTime: 0, born: 0 };
  for (let g = 0; g < skip + active; g++) {
    const sites = [], tally = { escape: 0, capture: 0, fission: 0, genTime: 0 };
    for (const n of source) history(sys, { ...n, t: 0 }, r, sites, tally);
    const k = sites.length / source.length;
    if (g >= skip) {
      ks.push(k);
      sum.escape += tally.escape; sum.capture += tally.capture; sum.fission += tally.fission;
      sum.genTime += tally.genTime; sum.born += sites.length;
    }
    if (!sites.length) return { k: 0, sd: 0, genTime: 0, escape: 1, capture: 0 };
    // Resample to a fixed population so the next generation has the same size.
    source = Array.from({ length: neutrons }, () => sites[Math.floor(r() * sites.length)]);
  }
  const k = ks.reduce((a, b) => a + b, 0) / ks.length;
  const sd = Math.sqrt(ks.reduce((a, b) => a + (b - k) ** 2, 0) / (ks.length * (ks.length - 1)));
  const ends = sum.escape + sum.capture + sum.fission;
  return { k, sd, genTime: sum.born ? sum.genTime / sum.born : 0, escape: sum.escape / ends, capture: sum.capture / ends, fission: sum.fission / ends };
}

/** Fuel radius (cm) at which k = 1 for this fuel and reflector, by bisection; null if never. */
export function criticalRadius(cfg, { neutrons = 1000, seed = 7 } = {}) {
  const k = (R) => kEffective(makeSystem({ ...cfg, R }), { neutrons, skip: 6, active: 12, seed }).k;
  let lo = 0.5, hi = 60;
  if (k(hi) < 1) return null;
  for (let i = 0; i < 12 && hi - lo > 0.05; i++) {
    const mid = Math.sqrt(lo * hi);
    if (k(mid) >= 1) hi = mid; else lo = mid;
  }
  return Math.sqrt(lo * hi);
}

export { NS, KT_ROOM };
