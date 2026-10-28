// Nuclear reactions: what happens when a particle hits a nucleus.
//
// Bohr's compound-nucleus picture, with the Hauser–Feshbach/Weisskopf statistical model:
//  1. Entrance. A neutron feels no Coulomb force and gets in with the optical-model
//     probability; charged particles must cross (or tunnel through) the Coulomb barrier;
//     a photon is absorbed with the giant-dipole cross section; an electron mostly scatters
//     off the charge, and only rarely excites the nucleus through a virtual photon.
//  2. The compound nucleus shares the energy (E* = separation energy + kinetic energy in the
//     centre-of-mass frame) among all its nucleons and forgets how it was made.
//  3. It decays by whichever channel has the most ways to happen: each width Γ_x is the
//     number of open channels (transmission × final-state level density) divided by
//     2π·ρ(E*). Neutron, proton and α emission, γ rays, and fission (Bohr–Wheeler, over the
//     barrier) compete; the residual nucleus can emit again until it runs out of energy.
//
// Energies in MeV, lengths in fm, cross sections in barns (1 b = 100 fm²).

import { bindingEnergy, fissionBarrier } from './nucleus-data.js';

const HBARC = 197.327, E2 = 1.44, ALPHA = 1 / 137.036;
const M_N = 939.565, M_P = 938.272, M_ALPHA = 3727.379, M_E = 0.511, AMU = 931.494;
const B_ALPHA = 28.2957;
const HBAR_S = 6.582e-22; // ħ in MeV·s

export const PROJECTILES = {
  n: { name: 'Neutron', sym: 'n', Z: 0, A: 1, spin: 0.5, mass: M_N, color: '#f2f2f2' },
  p: { name: 'Proton', sym: 'p', Z: 1, A: 1, spin: 0.5, mass: M_P, color: '#6aa9ff' },
  e: { name: 'Electron', sym: 'e⁻', Z: -1, A: 0, spin: 0.5, mass: M_E, color: '#7dff6b' },
  g: { name: 'Gamma ray', sym: 'γ', Z: 0, A: 0, spin: 1, mass: 0, color: '#ffe066' },
  a: { name: 'Alpha particle', sym: 'α', Z: 2, A: 4, spin: 0, mass: M_ALPHA, color: '#ffb347' },
};

// Emitted particles the statistical decay considers (the projectile list's hadrons).
const EJECTILES = ['n', 'p', 'a'];

// Measured binding energies (AME 2020), MeV: light nuclei, where the mass formula is poor,
// nuclei near closed shells, and the actinides, where the outcome hinges on S_n − B_f.
const MEASURED = {
  '0,1': 0, '1,1': 0, '1,2': 2.2246, '1,3': 8.4818, '2,3': 7.7180, '2,4': 28.2957, '2,5': 27.56, '2,6': 29.269,
  '3,5': 26.61, '3,6': 31.994, '3,7': 39.244, '3,8': 41.277, '4,7': 37.600, '4,8': 56.500, '4,9': 58.165, '4,10': 64.977,
  '5,10': 64.751, '5,11': 76.205, '5,12': 79.575, '6,11': 73.440, '6,12': 92.162, '6,13': 97.108, '6,14': 105.285,
  '7,13': 94.105, '7,14': 104.659, '7,15': 115.492, '8,15': 111.955, '8,16': 127.619, '8,17': 131.763, '8,18': 139.807,
  '9,17': 128.219, '9,18': 137.369, '9,19': 147.801, '10,20': 160.645, '11,23': 186.564, '11,24': 193.523, '12,24': 198.257,
  '13,27': 224.952, '13,28': 232.677, '14,28': 236.537, '26,56': 492.254, '26,57': 499.900, '27,59': 517.308, '27,60': 524.800,
  '28,58': 506.454, '29,63': 551.384, '79,197': 1559.40, '79,198': 1565.91, '82,206': 1622.34, '82,207': 1629.08,
  '82,208': 1636.43, '82,209': 1640.38, '83,209': 1640.24, '83,210': 1644.85, '90,232': 1766.69, '90,233': 1771.48,
  '92,233': 1771.73, '92,234': 1778.57, '92,235': 1783.87, '92,236': 1790.42, '92,237': 1795.54, '92,238': 1801.69,
  '92,239': 1806.50, '94,239': 1806.92, '94,240': 1813.45, '94,241': 1818.69,
};
const CORRECTIONS = Object.entries(MEASURED).filter(([k]) => k.split(',')[1] > 4).map(([k, b]) => {
  const [Z, A] = k.split(',').map(Number);
  return { Z, N: A - Z, d: b - bindingEnergy(Z, A).B };
});

/**
 * Binding energy: measured where listed, else the mass formula plus the measured nuclei's
 * corrections blended in by distance, so separation energies next to measured nuclei stay smooth.
 */
function B(Z, A) {
  if (Z < 0 || A < 1 || Z > A) return NaN;
  const m = MEASURED[`${Z},${A}`];
  if (m != null) return m;
  const N = A - Z;
  let sw = 1 / 25, sd = 0; // far from any measured nucleus, no correction
  for (const c of CORRECTIONS) {
    const r2 = (c.Z - Z) ** 2 + (c.N - N) ** 2;
    if (r2 > 36) continue;
    sw += 1 / r2; sd += c.d / r2;
  }
  return bindingEnergy(Z, A).B + sd / sw;
}
export const bindingOf = B;
const massOf = (Z, A) => Z * M_P + (A - Z) * M_N - B(Z, A); // nuclear mass, MeV/c²

/** Energy needed to pull particle x out of nucleus (Z, A). */
export function separation(x, Z, A) {
  const p = PROJECTILES[x];
  return B(Z, A) - B(Z - p.Z, A - p.A) - (x === 'a' ? B_ALPHA : 0);
}

/** Speed as a fraction of c (relativistic). */
export const beta = (E, mass) => (mass ? Math.sqrt(1 - (mass / (E + mass)) ** 2) : 1);

// ---------- transmission through barriers ----------

const reduced = (m1, m2) => (m1 * m2) / (m1 + m2);

/** Coulomb barrier height and radius between particle x and nucleus (Z, A). */
export function coulombBarrier(x, Z, A) {
  const p = PROJECTILES[x];
  if (p.Z <= 0 || p.A === 0) return { V: 0, R: 0 };
  const R = 1.3 * (Math.cbrt(A) + Math.cbrt(p.A)) + (x === 'p' ? 0.5 : 0);
  return { V: (E2 * p.Z * Z) / R, R };
}

/**
 * Chance a particle of kinetic energy ε (centre of mass) crosses into the nucleus head-on:
 * Gamow tunneling below the Coulomb barrier, the s-wave transmission 4kK/(k+K)² into the
 * ~40 MeV deep well for neutrons.
 */
export function transmission(x, Z, A, eps) {
  if (eps <= 0) return 0;
  const p = PROJECTILES[x];
  const mu = reduced(p.mass, A * AMU);
  const k = Math.sqrt(2 * mu * eps) / HBARC, K = Math.sqrt(2 * mu * (eps + 40)) / HBARC;
  const inside = (4 * k * K) / (k + K) ** 2;
  if (p.Z <= 0) return inside;
  const { V } = coulombBarrier(x, Z, A);
  let coul;
  if (eps < V) {
    const xr = eps / V; // R / outer turning point
    // G = (1/ħ)∫√(2μ(V − ε)) dr from the surface out to the turning point.
    const G = ((E2 * p.Z * Z) / HBARC) * Math.sqrt((2 * mu) / eps) * (Math.acos(Math.sqrt(xr)) - Math.sqrt(xr * (1 - xr)));
    coul = 1 / (1 + Math.exp(Math.min(700, 2 * G)));
  } else coul = 1 - 0.5 * Math.exp(-(eps - V) / 0.6);
  return coul * Math.min(1, inside * 1.6);
}

/** Σ(2ℓ+1)T_ℓ, approximated as T_0 times the number of partial waves that reach the surface. */
function channels(x, Z, A, eps) {
  const p = PROJECTILES[x];
  const mu = reduced(p.mass, A * AMU);
  const k = Math.sqrt(2 * mu * eps) / HBARC;
  const R = 1.25 * Math.cbrt(A) + 1;
  return transmission(x, Z, A, eps) * (1 + (k * R) ** 2);
}

// ---------- level densities ----------

/** Pairing back-shift: even–even nuclei need energy to break a pair before levels appear. */
const pairShift = (Z, A) => {
  const d = 12 / Math.sqrt(A), N = A - Z;
  return Z % 2 === 0 && N % 2 === 0 ? d : Z % 2 && N % 2 ? -0.3 * d : 0.3 * d;
};

/**
 * Density of levels of one low spin (per MeV) at excitation U: the Fermi-gas formula
 * √π e^{2√(aU)} / (12 a^¼ U^{5/4}), a = A/8 per MeV, divided among spins with the spin
 * cut-off σ² ≈ 0.0146·A^{5/3}·T. Light nuclei get a floor of ~1 level per MeV.
 */
export function levelDensity(Z, A, U, aScale = 1) {
  const a = (A / 8) * aScale;
  const u = U - pairShift(Z, A);
  if (u <= 0.05) return 0.2 * Math.exp(Math.max(u, -5)); // below the pairing gap: sparse
  const total = (Math.sqrt(Math.PI) / 12) * Math.exp(2 * Math.sqrt(a * u)) / (a ** 0.25 * u ** 1.25);
  const T = Math.sqrt(u / a);
  const sigma = Math.sqrt(Math.max(1, 0.0146 * A ** (5 / 3) * T));
  return Math.max(0.2, total / (Math.sqrt(2 * Math.PI) * sigma ** 3));
}

// ---------- fission barriers ----------

// Measured (highest) fission barriers of common compound nuclei, MeV (RIPL systematics).
const BARRIERS = {
  '90,230': 6.1, '90,233': 6.4, '91,232': 6.0, '92,233': 5.9, '92,234': 5.6, '92,235': 5.8, '92,236': 5.6,
  '92,237': 6.1, '92,238': 5.9, '92,239': 6.2, '93,238': 6.0, '94,239': 6.0, '94,240': 5.6, '94,241': 6.1,
  '94,242': 5.6, '95,242': 6.3, '96,245': 6.0, '98,252': 5.3,
};

/** Fission barrier (MeV): measured for actinides, liquid drop (plus a shell term) elsewhere. */
export function barrierOf(Z, A) {
  const m = BARRIERS[`${Z},${A}`];
  if (m) return m;
  if (Z >= 88 && Z <= 102) return 5.8 + ((A - Z) % 2 ? 0.4 : 0) - 0.12 * (Z - 94);
  return fissionBarrier(Z, A).Bf + (A > 200 && A < 215 ? 5 : 0); // the Pb region is extra-stable
}

// ---------- decay widths of a compound nucleus ----------

/** Radiative width Γ_γ (MeV) from systematics: ~25 meV in uranium, ~1 eV in light nuclei. */
function gammaWidth(A, E) {
  return 1.2e-7 * (100 / A) ** 1.5 * Math.min(8, (Math.max(E, 0.5) / 7) ** 3);
}

/**
 * Widths for each way compound nucleus (Z, A) with excitation E can decay, plus the spectrum
 * of each emitted particle. Returns { widths: {n, p, a, γ, fission}, spectra, total, rho }.
 */
export function decayWidths(Z, A, E) {
  const rho = levelDensity(Z, A, E);
  const widths = {}, spectra = {};
  for (const x of EJECTILES) {
    const p = PROJECTILES[x];
    const Zr = Z - p.Z, Ar = A - p.A;
    widths[x] = 0;
    if (Ar < 1 || Zr < 0 || Zr > Ar || !isFinite(B(Zr, Ar))) continue;
    const Emax = E - separation(x, Z, A);
    if (Emax <= 0) continue;
    const g = 2 * p.spin + 1;
    // Decay to the residual's ground state, plus to its excited levels (continuum).
    const steps = 80, pts = [];
    let N = 0;
    for (let i = 0; i < steps; i++) {
      const eps = ((i + 0.5) / steps) * Emax;
      const w = g * channels(x, Zr, Ar, eps) * levelDensity(Zr, Ar, Emax - eps) * (Emax / steps);
      pts.push([eps, w]);
      N += w;
    }
    const ground = g * channels(x, Zr, Ar, Emax);
    pts.push([Emax, ground]);
    N += ground;
    widths[x] = N / (2 * Math.PI * rho);
    spectra[x] = pts;
  }
  widths['γ'] = gammaWidth(A, E);
  widths.fission = 0;
  if (Z >= 80) {
    const Bf = barrierOf(Z, A);
    // Bohr–Wheeler: transition states above the saddle, crossed with Hill–Wheeler transmission.
    const hw = (e) => 1 / (1 + Math.exp((2 * Math.PI * (Bf - e)) / 0.8));
    let N = hw(E);
    const steps = 80;
    for (let i = 0; i < steps; i++) {
      const K = ((i + 0.5) / steps) * E; // energy locked into the saddle's internal excitation
      N += hw(E - K) * levelDensity(Z, A, K, 1.05) * (E / steps);
    }
    widths.fission = N / (2 * Math.PI * rho);
    widths.Bf = Bf;
  }
  const total = EJECTILES.reduce((t, x) => t + widths[x], 0) + widths['γ'] + widths.fission;
  return { widths, spectra, total, rho };
}

// ---------- entrance channel ----------

/** Photo-absorption cross section (mb): giant dipole resonance plus quasi-deuteron. */
export function photoCrossSection(Z, A, E, gdr) {
  const N = A - Z;
  const E0 = gdr?.E ?? 31.2 * A ** (-1 / 3) + 20.6 * A ** (-1 / 6), G = gdr?.width ?? 5;
  // Thomas–Reiche–Kuhn sum rule (×1.2): ∫σ dE = 72·NZ/A mb·MeV.
  const peak = (2 * 72 * N * Z) / (A * Math.PI * G);
  const lor = (peak * (E * G) ** 2) / ((E * E - E0 * E0) ** 2 + (E * G) ** 2);
  const sd = E > 2.224 ? (61.2 * (E - 2.224) ** 1.5) / E ** 3 : 0; // deuteron photodisintegration
  const qd = E > 2.224 ? (6.5 * N * Z * sd * Math.exp(-60 / E)) / A : 0;
  return lor + qd;
}

/** Geometric cross section of a nucleus (b). */
const geometric = (A) => (Math.PI * (1.25 * Math.cbrt(A) + 0.6) ** 2) / 100;

/**
 * Head-on collision of projectile x (lab kinetic energy E) with nucleus (Z, A): the chance it
 * gets in, the compound nucleus and its excitation, and what it does otherwise.
 */
export function entrance(x, Z, A, E, gdr) {
  const p = PROJECTILES[x];
  const out = { x, E, Z, A };
  if (x === 'g') {
    out.Ecm = E;
    out.sigma = photoCrossSection(Z, A, E, gdr) / 1000;
    out.pIn = 1 - Math.exp(-out.sigma / geometric(A));
    out.compound = { Z, A, E };
    out.miss = 'passes straight through';
    return out;
  }
  if (x === 'e') {
    // Virtual photons: dN = (2α/π)(ln(E/m) − ½) dω/ω, absorbed with the photo cross section.
    const flux = (2 * ALPHA / Math.PI) * Math.max(0.1, Math.log(E / M_E) - 0.5);
    let total = 0;
    const spectrum = [];
    const wMin = 1, wMax = Math.max(1.01, E - M_E);
    for (let i = 0; i < 120; i++) {
      const w = wMin * (wMax / wMin) ** ((i + 0.5) / 120);
      const dlog = Math.log(wMax / wMin) / 120;
      const s = (flux * photoCrossSection(Z, A, w, gdr) * dlog) / 1000;
      spectrum.push([w, s]);
      total += s;
    }
    out.Ecm = E;
    out.sigma = total;
    out.pIn = 1 - Math.exp(-total / geometric(A));
    out.virtual = spectrum;
    out.compound = { Z, A, E: null }; // E* sampled from the virtual-photon spectrum
    out.miss = 'scatters off the nuclear charge';
    // Elastic scattering: diffraction minimum where qR ≈ 4.49 (Hofstadter's measurement of size).
    const k = E / HBARC, Rc = 1.2 * Math.cbrt(A);
    out.thetaMin = 2 * Math.asin(Math.min(1, 4.49 / (2 * k * Rc)));
    out.chargeRadius = Rc;
    return out;
  }
  const M = A * AMU;
  out.Ecm = (E * M) / (M + p.mass);
  const Sx = separation(x, Z + p.Z, A + p.A);
  out.compound = { Z: Z + p.Z, A: A + p.A, E: out.Ecm + Sx };
  out.S = Sx;
  const T = channels(x, Z, A, out.Ecm);
  const mu = reduced(p.mass, M);
  const k = Math.sqrt(2 * mu * out.Ecm) / HBARC;
  out.sigma = (Math.PI / (k * k)) * T / 100; // b
  if (x === 'n') {
    const Rs = 1.35 * Math.cbrt(A);
    out.sigmaEl = (4 * Math.PI * Rs * Rs) / (1 + 0.6 * k * Rs) / 100;
    out.pIn = out.sigma / (out.sigma + out.sigmaEl);
    out.miss = 'bounces off (elastic scattering)';
  } else {
    const cb = coulombBarrier(x, Z, A);
    out.barrier = cb.V;
    out.closest = (E2 * p.Z * Z) / out.Ecm; // head-on turning point
    out.pIn = transmission(x, Z, A, out.Ecm);
    out.miss = out.Ecm < cb.V ? 'turns back at the Coulomb barrier' : 'bounces off';
  }
  return out;
}

// ---------- sampling ----------

/** Deterministic random numbers, so a "fire" can be replayed. */
export function rng(seed) {
  let s = (Math.imul(seed >>> 0, 2654435761) ^ 0x9e3779b9) >>> 0 || 1;
  const next = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  for (let i = 0; i < 8; i++) next(); // the first few outputs of a small seed are small
  return next;
}

const pick = (weights, r) => {
  const keys = Object.keys(weights);
  const tot = keys.reduce((t, k) => t + weights[k], 0);
  let u = r() * tot;
  for (const k of keys) { u -= weights[k]; if (u <= 0) return k; }
  return keys[keys.length - 1];
};

function sampleSpectrum(pts, r) {
  const tot = pts.reduce((t, [, w]) => t + w, 0);
  let u = r() * tot;
  for (const [e, w] of pts) { u -= w; if (u <= 0) return e; }
  return pts[pts.length - 1][0];
}

const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());

/** Split a fissioning nucleus: fragments, prompt neutrons and γ energy (Viola kinetic energy). */
export function sampleFission(Z, A, E, r) {
  const asym = Z >= 88 && E < 25;
  let Ah = Math.round(asym ? 139.5 + 4.5 * gauss(r) : A / 2 + 8 * Math.abs(gauss(r)));
  Ah = Math.max(Math.ceil(A / 2), Math.min(A - 70, Ah));
  const TKE = (0.1189 * Z * Z) / Math.cbrt(A) + 7.3;
  // Prompt neutrons carry off the fragments' excess excitation, ~7.5 MeV each (S_n + kinetic).
  let best = null;
  for (let nu = 0; nu <= 10; nu++) {
    const Al = A - nu - Ah;
    const Zh = Math.round((Z * Ah) / A + 0.5), Zl = Z - Zh;
    const Q = B(Zh, Ah) + B(Zl, Al) - B(Z, A);
    const excess = Q + E - TKE - 2 * nu;
    if (excess < 0) break;
    best = { nu, heavy: { Z: Zh, A: Ah }, light: { Z: Zl, A: Al }, Q, excess };
    if (excess < 6 + 3 * r()) break;
  }
  if (!best) return null;
  const { heavy, light, nu } = best;
  const tke = TKE + 4 * gauss(r) * 0.5;
  const neutrons = Array.from({ length: nu }, () => 0.5 + 3 * -Math.log(1 - r() * 0.95) / 1.5); // ~2 MeV each
  const nE = neutrons.reduce((t, e) => t + e, 0);
  const gammaE = Math.max(0.5, best.Q + E - tke - nE);
  // Kinetic energy divides inversely with mass (momentum balance).
  return {
    heavy: { ...heavy, E: (tke * light.A) / (heavy.A + light.A) }, light: { ...light, E: (tke * heavy.A) / (heavy.A + light.A) },
    neutrons, gammaE, Q: best.Q, tke, Bf: barrierOf(Z, A),
  };
}

/** A γ cascade from excitation U down to the ground state: a few photons. */
function gammaCascade(U, r) {
  const out = [];
  while (U > 0.05 && out.length < 6) {
    const e = out.length >= 3 || U < 1.2 ? U : U * (0.25 + 0.55 * r());
    out.push(e);
    U -= e;
  }
  return out;
}

/**
 * Follow one compound nucleus to the end: a list of steps
 * { kind: 'n'|'p'|'a'|'γ'|'fission', E, from: {Z, A, E}, to: {Z, A, E}, lifetime, probs }.
 */
export function cascade(Z, A, E, r, force = null) {
  const steps = [];
  let cur = { Z, A, E };
  for (let guard = 0; guard < 40; guard++) {
    const d = decayWidths(cur.Z, cur.A, cur.E);
    const lifetime = HBAR_S / d.total;
    const probs = Object.fromEntries(['n', 'p', 'a', 'γ', 'fission'].map((k) => [k, d.widths[k] / d.total]));
    // `force` picks the first decay (to watch a rare channel); later ones are left to chance.
    const ch = guard === 0 && force && probs[force] > 0 ? force : pick(Object.fromEntries(Object.entries(probs).filter(([, v]) => v > 0)), r);
    if (ch === 'fission') {
      const f = sampleFission(cur.Z, cur.A, cur.E, r);
      if (f) { steps.push({ kind: 'fission', from: cur, fission: f, lifetime, probs, Bf: d.widths.Bf }); return steps; }
    }
    if (ch === 'γ' || ch === 'fission') {
      // Once only γ rays compete (no particle can get out), the rest goes in one cascade.
      const particleOpen = EJECTILES.some((x) => probs[x] > 1e-4) || probs.fission > 1e-4;
      const e = particleOpen ? Math.min(cur.E, cur.E * (0.2 + 0.5 * r())) : null;
      const gammas = e != null ? [e] : gammaCascade(cur.E, r);
      for (const g of gammas) {
        const to = { Z: cur.Z, A: cur.A, E: Math.max(0, cur.E - g) };
        steps.push({ kind: 'γ', E: g, from: cur, to, lifetime, probs });
        cur = to;
      }
      if (cur.E < 0.05) return steps;
      continue;
    }
    const p = PROJECTILES[ch];
    const eps = sampleSpectrum(d.spectra[ch], r);
    const to = { Z: cur.Z - p.Z, A: cur.A - p.A, E: Math.max(0, cur.E - separation(ch, cur.Z, cur.A) - eps) };
    steps.push({ kind: ch, E: eps * (to.A * AMU) / (to.A * AMU + p.mass), from: cur, to, lifetime, probs });
    cur = to;
    if (cur.E < 0.05 || cur.A < 2) return steps;
  }
  return steps;
}

/** Probabilities of the first decay of the compound nucleus, for the table. */
export function firstChance(Z, A, E) {
  const d = decayWidths(Z, A, E);
  return { probs: Object.fromEntries(['n', 'p', 'a', 'γ', 'fission'].map((k) => [k, d.widths[k] / d.total])), lifetime: HBAR_S / d.total, Bf: d.widths.Bf, total: d.total };
}

/** Sample an excitation energy from an electron's virtual-photon spectrum. */
export function sampleVirtual(spectrum, r) { return sampleSpectrum(spectrum, r); }

/** Q value of a reaction from initial and final nuclei and particles: masses in, masses out. */
export function qValue(initial, final) {
  const mass = (list) => list.reduce((t, { Z, A, x }) => t + (x ? (PROJECTILES[x].mass || 0) : massOf(Z, A)), 0);
  return mass(initial) - mass(final);
}

export const HBAR_MEV_S = HBAR_S;
