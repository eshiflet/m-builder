// Ground-state nuclear shapes from the macroscopic–microscopic (Nilsson–Strutinsky)
// method:
//
//   E(δ) = E_liquid-drop(δ) + δE_shell,protons(δ) + δE_shell,neutrons(δ)
//
// • Liquid drop: deforming costs surface energy and gains Coulomb energy,
//   E_LD = β²/(4π) · (2E_s − E_c) to second order.
// • Shell correction: single-particle levels of the deformed Nilsson potential,
//     h = ħω₀(δ)[N + 3/2 − δ·(4/3)√(π/5) r²Y₂₀] − 2κħω̊ l·s − κμħω̊ (l² − ⟨l²⟩_N),
//   diagonalized within each oscillator shell N; the Strutinsky correction is the
//   sum of filled levels minus its smoothed (Gaussian, 6th-order curvature) average.
// • Pairing correction: BCS pairing on the same levels (G fixed so the average gap is
//   Δ̃ = 12/√A MeV), minus its smooth counterpart −¼g̃Δ̃². Pairing keeps near-magic
//   nuclei like ¹²⁰Sn round.
// The δ that minimizes E is the ground-state deformation (β₂ ≈ δ/0.95).

const SQRT_PI = Math.sqrt(Math.PI);

// Nilsson κ, μ by oscillator shell (Bengtsson & Ragnarsson 1985).
const KAPPA_MU = {
  p: [[0.120, 0], [0.120, 0], [0.105, 0], [0.090, 0.30], [0.065, 0.57], [0.060, 0.65], [0.054, 0.69], [0.054, 0.69], [0.054, 0.69], [0.054, 0.69], [0.054, 0.69], [0.054, 0.69]],
  n: [[0.120, 0], [0.120, 0], [0.105, 0], [0.090, 0.25], [0.070, 0.39], [0.062, 0.43], [0.062, 0.34], [0.062, 0.26], [0.062, 0.26], [0.062, 0.26], [0.062, 0.26], [0.062, 0.26]],
};

const fact = [1];
for (let i = 1; i < 60; i++) fact[i] = fact[i - 1] * i;

/** Clebsch–Gordan ⟨j1 m1 j2 m2 | J M⟩ for integer angular momenta (Racah formula). */
function cg(j1, m1, j2, m2, J, M) {
  if (m1 + m2 !== M || Math.abs(m1) > j1 || Math.abs(m2) > j2 || Math.abs(M) > J) return 0;
  if (J < Math.abs(j1 - j2) || J > j1 + j2) return 0;
  const pre = Math.sqrt(
    ((2 * J + 1) * fact[J + j1 - j2] * fact[J - j1 + j2] * fact[j1 + j2 - J]) / fact[j1 + j2 + J + 1]
    * fact[J + M] * fact[J - M] * fact[j1 - m1] * fact[j1 + m1] * fact[j2 - m2] * fact[j2 + m2],
  );
  let sum = 0;
  for (let k = 0; k <= j1 + j2 - J; k++) {
    const d = [k, j1 + j2 - J - k, j1 - m1 - k, j2 + m2 - k, J - j2 + m1 + k, J - j1 - m2 + k];
    if (d.some((x) => x < 0)) continue;
    sum += (k % 2 ? -1 : 1) / d.reduce((p, x) => p * fact[x], 1);
  }
  return pre * sum;
}

/** Eigenvalues of a small symmetric matrix (cyclic Jacobi). */
function eigenvalues(a) {
  const n = a.length;
  const m = a.map((row) => row.slice());
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += m[p][q] * m[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-14) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const kp = m[k][p], kq = m[k][q];
          m[k][p] = c * kp - s * kq; m[k][q] = s * kp + c * kq;
        }
        for (let k = 0; k < n; k++) {
          const pk = m[p][k], qk = m[q][k];
          m[p][k] = c * pk - s * qk; m[q][k] = s * pk + c * qk;
        }
      }
    }
  }
  return m.map((row, i) => row[i]);
}

// Radial ⟨N l'| r² |N l⟩ in oscillator units, within one shell.
function r2(N, lp, l) {
  if (lp === l) return N + 1.5;
  if (lp === l + 2) return -Math.sqrt((N - l) * (N + l + 3));
  if (lp === l - 2) return -Math.sqrt((N - l + 2) * (N + l + 1));
  return 0;
}

// Angular ⟨l' Λ| Y₂₀ |l Λ⟩.
const y20 = (lp, l, L) => Math.sqrt((5 * (2 * l + 1)) / (4 * Math.PI * (2 * lp + 1))) * cg(l, 0, 2, 0, lp, 0) * cg(l, L, 2, 0, lp, L);

/**
 * One (N, Ω) block of the Nilsson Hamiltonian in units of ħω̊₀, in the basis |N l Λ Σ⟩.
 * Levels of the same N and Ω never cross, so sorting a block's eigenvalues tracks each
 * orbital continuously as δ changes.
 */
export function nilssonBlock(delta, kind, N, twoOmega) {
  const omegaRatio = (1 - (4 / 3) * delta * delta - (16 / 27) * delta ** 3) ** (-1 / 6);
  const betaP = (4 / 3) * Math.sqrt(Math.PI / 5) * delta;
  const [kappa, mu] = KAPPA_MU[kind][Math.min(N, 11)];
  const l2avg = (N * (N + 3)) / 2;
  const Omega = twoOmega / 2;
  const basis = []; // { l, L (Λ), S (Σ) }
  for (let l = N; l >= 0; l -= 2) {
    for (const S of [0.5, -0.5]) {
      const L = Omega - S;
      if (Math.abs(L) <= l) basis.push({ l, L, S });
    }
  }
  const H = basis.map((bi) => basis.map((bj) => {
    let h = 0;
    if (bi.S === bj.S && bi.L === bj.L) {
      h += omegaRatio * ((bi.l === bj.l ? N + 1.5 : 0) - betaP * r2(N, bi.l, bj.l) * y20(bi.l, bj.l, bj.L));
    }
    if (bi.l === bj.l) {
      const l = bi.l;
      // l·s: diagonal Λ·Σ, and ½√((l−Λ)(l+Λ+1)) between |Λ,+½⟩ and |Λ+1,−½⟩.
      if (bi.L === bj.L && bi.S === bj.S) h += -2 * kappa * bi.L * bi.S - kappa * mu * (l * (l + 1) - l2avg);
      const lo = bi.S > 0 ? bi : bj, hi = bi.S > 0 ? bj : bi;
      if (bi.S !== bj.S && hi.L === lo.L + 1) h += -2 * kappa * 0.5 * Math.sqrt((l - lo.L) * (l + lo.L + 1));
    }
    return h;
  }));
  return { basis, H, kappa, mu };
}

/**
 * Nilsson single-particle energies (units of ħω̊₀), one entry per Kramers-degenerate
 * pair, for shells 0..Nmax at deformation δ.
 */
function nilssonLevels(delta, kind, Nmax) {
  const levels = [];
  for (let N = 0; N <= Nmax; N++) {
    for (let twoOmega = 1; twoOmega <= 2 * N + 1; twoOmega += 2) levels.push(...eigenvalues(nilssonBlock(delta, kind, N, twoOmega).H));
  }
  return levels.sort((x, y) => x - y);
}

// Strutinsky smoothing: Gaussian of width γ with a 6th-order curvature correction.
const GAMMA = 1.2;
const C = [1, -1 / 4, 1 / 32, -1 / 384]; // c_m = (−1)^m / (2^{2m} m!)
function hermite(n, x) {
  let h0 = 1, h1 = 2 * x;
  if (n === 0) return h0;
  for (let k = 1; k < n; k++) [h0, h1] = [h1, 2 * x * h1 - 2 * k * h0];
  return h1;
}
const erf = (x) => { // Abramowitz–Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
function smoothOccupation(x) {
  let s = 0;
  for (let m = 1; m <= 3; m++) s += C[m] * hermite(2 * m - 1, x);
  return 0.5 * (1 + erf(x)) - (Math.exp(-x * x) / SQRT_PI) * s;
}
function smoothEnergyTerm(x) { // ∫_{−∞}^{x} u·g(u) du
  let s = 0;
  for (let m = 0; m <= 3; m++) s += C[m] * (-0.5 * hermite(2 * m, x) - (m ? 2 * m * hermite(2 * m - 2, x) : 0));
  return (Math.exp(-x * x) / SQRT_PI) * s;
}

/**
 * Strutinsky shell correction (units of ħω̊₀) for `particles` nucleons in `levels`.
 * Returns { dE, lambda, g } with the smooth Fermi level and smooth level density there.
 */
function shellCorrection(levels, particles) {
  const count = (lambda) => levels.reduce((n, e) => n + 2 * smoothOccupation((lambda - e) / GAMMA), 0);
  let lo = levels[0] - 5, hi = levels[levels.length - 1];
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (count(mid) < particles) lo = mid; else hi = mid;
  }
  const lambda = (lo + hi) / 2;
  let smooth = 0;
  for (const e of levels) {
    const x = (lambda - e) / GAMMA;
    smooth += 2 * (e * smoothOccupation(x) + GAMMA * smoothEnergyTerm(x));
  }
  let sum = 0, left = particles;
  for (const e of levels) {
    const take = Math.min(2, left);
    sum += take * e;
    left -= take;
    if (left <= 0) break;
  }
  // Smooth level density (particles per ħω̊₀) at the Fermi level.
  let g = 0;
  for (const e of levels) {
    const u = (lambda - e) / GAMMA;
    let f = 0;
    for (let m = 0; m <= 3; m++) f += C[m] * hermite(2 * m, u);
    g += (2 / (GAMMA * SQRT_PI)) * Math.exp(-u * u) * f;
  }
  return { dE: sum - smooth, lambda, g };
}

/**
 * BCS pairing correction (units of ħω̊₀): pairing correlation energy on the real
 * levels minus the smooth estimate −¼ g̃ Δ̃². `gap` is Δ̃ in the same units.
 */
function pairingCorrection(levels, particles, lambdaSmooth, g, gap) {
  const WINDOW = 1.0;
  const win = levels.filter((e) => Math.abs(e - lambdaSmooth) < WINDOW);
  const below = levels.filter((e) => e <= lambdaSmooth - WINDOW).length;
  const nw = particles - 2 * below;
  if (win.length < 2 || nw <= 0) return 0;
  const rho = g / 2; // pairs per unit energy
  const G = 1 / (rho * Math.asinh(WINDOW / gap));
  const smooth = -0.25 * g * gap * gap;

  const lambdaFor = (D) => {
    let lo = win[0] - 2, hi = win[win.length - 1] + 2;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      const n = win.reduce((s, e) => s + 1 - (e - mid) / Math.hypot(e - mid, D), 0);
      if (n < nw) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const gapEq = (D) => {
    const lam = lambdaFor(D);
    return win.reduce((s, e) => s + 1 / Math.hypot(e - lam, D), 0) - 2 / G;
  };
  let sharp = 0, left = nw;
  for (const e of win) { const take = Math.min(2, left); sharp += take * e; left -= take; if (left <= 0) break; }
  if (gapEq(1e-4) <= 0) return -smooth; // no pairing solution: gap collapses
  let lo = 1e-4, hi = 5 * gap;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (gapEq(mid) > 0) lo = mid; else hi = mid;
  }
  const D = (lo + hi) / 2, lam = lambdaFor(D);
  const bcs = win.reduce((s, e) => s + e * (1 - (e - lam) / Math.hypot(e - lam, D)), 0) - (D * D) / G;
  return bcs - sharp - smooth;
}

const cache = new Map();

/**
 * Potential energy versus quadrupole deformation, and its minimum.
 * Returns { beta, curve: [{ beta, E }] } with E in MeV relative to spherical.
 */
export function groundStateShape(Z, N) {
  const key = `${Z},${N}`;
  if (cache.has(key)) return cache.get(key);
  const A = Z + N;
  const I = (N - Z) / A;
  const Es = 17.9439 * (1 - 1.7826 * I * I) * A ** (2 / 3);
  const Ec = (0.7053 * Z * Z) / Math.cbrt(A);
  const hw = { p: 41 * A ** (-1 / 3) * (1 - I / 3), n: 41 * A ** (-1 / 3) * (1 + I / 3) };
  // Enough shells to sit well above the Fermi level for the smoothing.
  const shellsFor = (n) => Math.min(13, Math.ceil(Math.cbrt(3 * n)) + 4);
  const curve = [];
  for (let d = -0.35; d <= 0.5001; d += 0.025) {
    const beta = d / 0.95;
    const ld = ((beta * beta) / (4 * Math.PI)) * (2 * Es - Ec);
    const micro = (kind, n) => {
      if (n < 2) return 0;
      const levels = nilssonLevels(d, kind, shellsFor(n));
      const sc = shellCorrection(levels, n);
      const pair = pairingCorrection(levels, n, sc.lambda, sc.g, 12 / Math.sqrt(A) / hw[kind]);
      return (sc.dE + pair) * hw[kind];
    };
    curve.push({ beta, E: ld + micro('p', Z) + micro('n', N) });
  }
  const E0 = curve.reduce((best, c) => (Math.abs(c.beta) < Math.abs(best.beta) ? c : best)).E;
  for (const c of curve) c.E -= E0;
  const min = curve.reduce((best, c) => (c.E < best.E ? c : best));
  // A shallow minimum (within 0.3 MeV of spherical) is treated as spherical/soft.
  const result = { beta: min.E < -0.3 ? min.beta : 0, curve, depth: -min.E };
  cache.set(key, result);
  return result;
}
