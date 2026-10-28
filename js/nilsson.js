// Nuclear single-particle orbitals in the deformed (Nilsson) shell model.
//
// Each nucleon moves in the average potential of all the others: a harmonic oscillator,
// stretched by the quadrupole deformation δ, plus a strong spin–orbit term and an l²
// term that flattens the bottom of the well. Diagonalizing it shell by shell (in
// js/nuclear-shape.js) gives levels labeled by Ω, the angular momentum along the
// symmetry axis, and parity π = (−1)^N. At δ = 0 they bunch into the spherical shells
// (1s1/2, 1p3/2, …) whose gaps make the magic numbers 2, 8, 20, 28, 50, 82, 126.

import { nilssonBlock } from './nuclear-shape.js';
import { jacobiEigen } from './eht.js';

const L_LETTERS = 'spdfghijklm';
const fact = [1];
for (let i = 1; i < 40; i++) fact[i] = fact[i - 1] * i;
// Γ(n + ½) = (2n)! √π / (4ⁿ n!)
const gammaHalf = (n) => (fact[2 * n] * Math.sqrt(Math.PI)) / (4 ** n * fact[n]);

/** Spectroscopic label like "1g9/2" for oscillator shell N, orbital l, total j = twoJ/2. */
export function sphericalLabel(N, l, twoJ) {
  return `${(N - l) / 2 + 1}${L_LETTERS[l]}${twoJ}/2`;
}

/** Ω as a fraction string, e.g. "7/2". */
export const omegaText = (twoOmega) => `${twoOmega}/2`;

/** Spherical (l, j) states feeding block (N, Ω), lowest first: they label the block's lines. */
function sphericalParents(kind, N, twoOmega) {
  const { kappa, mu } = nilssonBlock(0, kind, N, 1);
  const l2avg = (N * (N + 3)) / 2;
  const out = [];
  for (let l = N; l >= 0; l -= 2) {
    for (const twoJ of [2 * l + 1, 2 * l - 1]) {
      if (twoJ < twoOmega || twoJ < 1) continue;
      const ls = twoJ > 2 * l ? l / 2 : -(l + 1) / 2;
      out.push({ l, twoJ, E: N + 1.5 - 2 * kappa * ls - kappa * mu * (l * (l + 1) - l2avg) });
    }
  }
  return out.sort((a, b) => a.E - b.E);
}

/** Eigen-decomposition of one block, lowest first: [{ E, c: [...] }]. */
function solveBlock(delta, kind, N, twoOmega) {
  const { basis, H } = nilssonBlock(delta, kind, N, twoOmega);
  const n = basis.length;
  const { values, vectors } = jacobiEigen(H.flat(), n);
  const order = [...values.keys()].sort((a, b) => values[a] - values[b]);
  return { basis, states: order.map((k) => ({ E: values[k], c: basis.map((_, i) => vectors[i * n + k]) })) };
}

/**
 * Every Nilsson orbital of shells 0..Nmax as a line E(δ) in units of ħω̊₀.
 * Returns { deltas, lines: [{ id, N, twoOmega, parity, k, label, E: [] }] }.
 */
export function nilssonDiagram(kind, Nmax, deltas) {
  const lines = [];
  for (let N = 0; N <= Nmax; N++) {
    for (let twoOmega = 1; twoOmega <= 2 * N + 1; twoOmega += 2) {
      const parents = sphericalParents(kind, N, twoOmega);
      const block = parents.map((p, k) => ({
        id: `${N},${twoOmega},${k}`, N, twoOmega, k, parity: N % 2 ? '−' : '+',
        label: sphericalLabel(N, p.l, p.twoJ), l: p.l, twoJ: p.twoJ, E: [],
      }));
      for (const d of deltas) solveBlock(d, kind, N, twoOmega).states.forEach((s, k) => block[k].E.push(s.E));
      lines.push(...block);
    }
  }
  return { deltas, lines };
}

/**
 * All orbitals at one δ, lowest first, with how many of `count` nucleons fill them
 * (each holds two: Ω and −Ω). With pairing (the default), the Fermi level λ comes from
 * BCS with the empirical gap Δ = 12/√A MeV, and an odd nucleon sits in the orbital
 * closest to λ (the lowest quasiparticle), which is how real odd nuclei pick their
 * ground state. That orbital is the valence orbital.
 */
export function fillLevels(kind, count, delta, Nmax, A = null) {
  const levels = [];
  for (let N = 0; N <= Nmax; N++) {
    for (let twoOmega = 1; twoOmega <= 2 * N + 1; twoOmega += 2) {
      const parents = sphericalParents(kind, N, twoOmega);
      solveBlock(delta, kind, N, twoOmega).states.forEach((s, k) => levels.push({
        id: `${N},${twoOmega},${k}`, N, twoOmega, k, parity: N % 2 ? '−' : '+', E: s.E,
        label: sphericalLabel(N, parents[k].l, parents[k].twoJ),
      }));
    }
  }
  levels.sort((a, b) => a.E - b.E);
  const last = Math.max(0, Math.ceil(count / 2) - 1);
  let fermi = levels[last + 1] ? (levels[last].E + levels[last + 1].E) / 2 : levels[last].E;
  if (A && count > 1) {
    const gap = 12 / Math.sqrt(A) / (41 / Math.cbrt(A)); // Δ in units of ħω̊₀
    const num = (lam) => levels.reduce((t, l) => t + 1 - (l.E - lam) / Math.hypot(l.E - lam, gap), 0);
    let lo = levels[0].E - 2, hi = levels[levels.length - 1].E + 2;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (num(mid) < count) lo = mid; else hi = mid; }
    fermi = (lo + hi) / 2;
  }
  const valence = A && count > 1 ? levels.reduce((b, l) => (Math.abs(l.E - fermi) < Math.abs(b.E - fermi) ? l : b)) : levels[last];
  // Fill pairs from the bottom; an odd nucleon is blocked in the valence orbital.
  let left = count;
  if (count % 2) { valence.occ = 1; left--; }
  for (const lv of levels) {
    if (lv.occ === 1 && lv === valence && count % 2) continue;
    lv.occ = Math.min(2, Math.max(0, left));
    left -= lv.occ;
  }
  return { levels, valence, fermi };
}

/** Shells to include so the diagram reaches a bit above the Fermi level. */
export const shellsFor = (count) => Math.min(9, Math.max(2, Math.ceil(Math.cbrt(3 * Math.max(count, 1))) + 1));

/** Oscillator length b = ħc / √(m c² ħω̊₀) in fm, with ħω̊₀ = 41 A^(−1/3) MeV. */
export const oscillatorLength = (A) => 197.327 / Math.sqrt(938.9 * 41 * A ** (-1 / 3));

// Radial oscillator function R_{n_r l}(x) ∝ x^l e^{−x²/2} L_{n_r}^{l+½}(x²), x = r/b.
export function radial(nr, l, x) {
  const a = l + 0.5, t = x * x;
  let L0 = 1, L1 = 1 + a - t;
  if (nr === 0) L1 = 1;
  else for (let k = 1; k < nr; k++) [L0, L1] = [L1, ((2 * k + 1 + a - t) * L1 - (k + a) * L0) / (k + 1)];
  const norm = Math.sqrt((2 * fact[nr]) / gammaHalf(nr + l + 1)); // ∫ R² x² dx = 1
  return norm * x ** l * Math.exp(-t / 2) * L1;
}

// Normalized associated Legendre part of Y_lm (m ≥ 0, Condon–Shortley phase).
export function ylm(l, m, ct) {
  const st = Math.sqrt(Math.max(0, 1 - ct * ct));
  let pmm = 1;
  for (let i = 1; i <= m; i++) pmm *= -(2 * i - 1) * st;
  let p = pmm;
  if (l > m) {
    let pm1 = ct * (2 * m + 1) * pmm;
    p = pm1;
    for (let ll = m + 2; ll <= l; ll++) { const pn = ((2 * ll - 1) * ct * pm1 - (ll + m - 1) * pmm) / (ll - m); pmm = pm1; pm1 = pn; p = pn; }
  }
  return Math.sqrt(((2 * l + 1) / (4 * Math.PI)) * (fact[l - m] / fact[l + m])) * p;
}

/** Wavefunction pieces of one orbital: its two spin components at a stretched point. */
export function orbital(delta, kind, N, twoOmega, k) {
  const { basis, states } = solveBlock(delta, kind, N, twoOmega);
  const s = states[k];
  const comps = basis.map((b, i) => ({ ...b, c: s.c[i], nr: (N - b.l) / 2 }));
  const weightUp = comps.filter((q) => q.S > 0).reduce((t, q) => t + q.c * q.c, 0);
  // Composition in (l, Λ): the largest pieces, for the info panel.
  const byL = new Map();
  for (const q of comps) byL.set(q.l, (byL.get(q.l) ?? 0) + q.c * q.c);
  const amp = (x, ct, up) => {
    let v = 0;
    for (const q of comps) if ((q.S > 0) === up && q.c) v += q.c * radial(q.nr, q.l, x) * ylm(q.l, Math.abs(q.L), ct);
    return v;
  };
  return { E: s.E, N, twoOmega, comps, weightUp, lMix: [...byL].sort((a, b) => b[1] - a[1]), amp };
}

/**
 * Sample `count` points from an orbital's density, in fm, with z the symmetry axis.
 * Each point carries which spin component it came from (1 = up along z).
 */
export function samplePoints(orb, delta, A, count = 16000) {
  const b0 = oscillatorLength(A);
  const ratio = (1 - (4 / 3) * delta * delta - (16 / 27) * delta ** 3) ** (-1 / 6);
  const bPerp = b0 / Math.sqrt(ratio * (1 + delta / 3)), bZ = b0 / Math.sqrt(ratio * (1 - (2 * delta) / 3));
  const L = Math.sqrt(2 * orb.N + 3) + 2.2; // stretched units; the density is negligible beyond
  const dens = (x, y, z) => {
    const r = Math.hypot(x, y, z), ct = r > 1e-9 ? z / r : 1;
    const u = orb.amp(r, ct, true), d = orb.amp(r, ct, false);
    return [u * u, d * d];
  };
  // Density bound from a coarse grid in the (ρ, z) half-plane.
  let max = 0;
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 80; j++) {
    const [u, d] = dens((i / 40) * L, 0, (j / 40 - 1) * L);
    max = Math.max(max, u + d);
  }
  max *= 1.3;
  const pos = new Float32Array(count * 3), spin = new Uint8Array(count);
  let n = 0;
  for (let tries = 0; n < count && tries < count * 400; tries++) {
    const x = (Math.random() * 2 - 1) * L, y = (Math.random() * 2 - 1) * L, z = (Math.random() * 2 - 1) * L;
    const [u, d] = dens(x, y, z);
    if (Math.random() * max > u + d) continue;
    pos[n * 3] = x * bPerp; pos[n * 3 + 1] = y * bPerp; pos[n * 3 + 2] = z * bZ;
    spin[n] = Math.random() * (u + d) < u ? 1 : 0;
    n++;
  }
  return { pos: pos.subarray(0, n * 3), spin: spin.subarray(0, n), count: n, extent: L * Math.max(bPerp, bZ) };
}

/**
 * Measured ground-state spin and parity of odd-A nuclei ("Z,A" → "7/2-"), to compare
 * with the shell model's prediction.
 */
export const MEASURED_SPIN = {
  '1,3': '1/2+', '2,3': '1/2+', '3,7': '3/2-', '4,9': '3/2-', '5,11': '3/2-', '6,13': '1/2-', '7,15': '1/2-',
  '8,17': '5/2+', '9,19': '1/2+', '10,21': '3/2+', '11,23': '3/2+', '12,25': '5/2+', '13,27': '5/2+',
  '14,29': '1/2+', '15,31': '1/2+', '16,33': '3/2+', '17,35': '3/2+', '17,37': '3/2+', '19,39': '3/2+',
  '19,41': '3/2+', '20,41': '7/2-', '20,43': '7/2-', '21,45': '7/2-', '22,47': '5/2-', '22,49': '7/2-',
  '23,51': '7/2-', '24,53': '3/2-', '25,55': '5/2-', '26,57': '1/2-', '27,59': '7/2-', '29,63': '3/2-',
  '29,65': '3/2-', '31,69': '3/2-', '33,75': '3/2-', '34,77': '1/2-', '35,79': '3/2-', '37,85': '5/2-',
  '37,87': '3/2-', '38,87': '9/2+', '39,89': '1/2-', '40,91': '5/2+', '41,93': '9/2+', '42,95': '5/2+',
  '47,107': '1/2-', '47,109': '1/2-', '49,115': '9/2+', '50,117': '1/2+', '51,121': '5/2+', '51,123': '7/2+',
  '53,127': '5/2+', '54,129': '1/2+', '54,131': '3/2+', '55,133': '7/2+', '56,137': '3/2+', '57,139': '7/2+',
  '59,141': '5/2+', '60,143': '7/2-', '62,147': '7/2-', '63,153': '5/2+', '64,155': '3/2-', '64,157': '3/2-',
  '65,159': '3/2+', '66,163': '5/2-', '67,165': '7/2-', '68,167': '7/2+', '70,173': '5/2-', '71,175': '7/2+',
  '72,177': '7/2-', '73,181': '7/2+', '78,195': '1/2-', '79,197': '3/2+', '80,199': '1/2-', '81,205': '1/2+',
  '82,207': '1/2-', '83,209': '9/2-', '92,235': '7/2-', '94,239': '1/2+',
};
