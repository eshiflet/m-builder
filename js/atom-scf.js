// Self-consistent atomic orbitals (density-functional theory, local-density
// approximation), computed in the browser.
//
// Each electron moves in the nucleus's −Z/r plus the average repulsion of all the
// electrons (Hartree) and an exchange–correlation potential (LDA: Slater exchange plus
// Perdew–Zunger correlation). Solve the radial Schrödinger equation for every occupied
// orbital, rebuild the density, and repeat until nothing changes. The result is a real
// numerical radial function for each orbital, which replaces the hydrogen-like ones
// scaled by Slater's rules. Orbital sizes come out close to Hartree–Fock; energies
// match the NIST LDA reference tables to a few mHa. Relativity is left out, so the
// heaviest elements' inner s orbitals are a little too large.
//
// Atomic units throughout: lengths in bohr, energies in hartree.

import { electronConfig } from './electron-config.js';

const NGRID = 1400, RMIN = 1e-6, RMAX = 80;
const H = Math.log(RMAX / RMIN) / (NGRID - 1);
const R = Float64Array.from({ length: NGRID }, (_, i) => RMIN * Math.exp(i * H));

/** Radial wavefunction on the shared log grid, with sampling helpers. */
export class NumericRadial {
  constructor(u, eps) {
    this.u = u; // u = rR, normalized so ∫u² dr = 1
    this.eps = eps;
    const cdf = new Float64Array(NGRID);
    for (let i = 1; i < NGRID; i++) {
      const a = u[i - 1] ** 2 * R[i - 1], b = u[i] ** 2 * R[i];
      cdf[i] = cdf[i - 1] + 0.5 * (a + b) * H; // dr = r dx
    }
    const total = cdf[NGRID - 1];
    for (let i = 0; i < NGRID; i++) cdf[i] /= total;
    this.cdf = cdf;
  }

  /** u(r) by interpolation in ln r. */
  uAt(r) {
    if (r <= RMIN) return 0;
    const x = Math.log(r / RMIN) / H;
    const i = Math.floor(x);
    if (i >= NGRID - 1) return 0;
    const f = x - i;
    return this.u[i] * (1 - f) + this.u[i + 1] * f;
  }

  /** R(r) = u/r. */
  R(r) { return r > RMIN ? this.uAt(r) / r : 0; }

  /** Radius (bohr) enclosing probability p. */
  quantile(p) {
    const c = this.cdf;
    let lo = 0, hi = NGRID - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid] < p) lo = mid; else hi = mid; }
    const f = (p - c[lo]) / (c[hi] - c[lo] || 1);
    return RMIN * Math.exp((lo + f) * H);
  }

  /** Radius of the outermost maximum of u² (the "size" of the orbital). */
  get peak() {
    let best = 0;
    for (let i = 1; i < NGRID; i++) if (this.u[i] ** 2 >= this.u[best] ** 2 * 0.999) best = i;
    return R[best];
  }
}

// ---------- radial solver ----------

// y'' = g(x) y with u = r^½ y and g = 2r²(V − ε) + (l + ½)², by Numerov.
function outward(V, l, eps, y) {
  const h12 = (H * H) / 12, L2 = (l + 0.5) ** 2;
  const g = (i) => 2 * R[i] * R[i] * (V[i] - eps) + L2;
  y[0] = R[0] ** (l + 0.5);
  y[1] = R[1] ** (l + 0.5);
  let nodes = 0;
  let g0 = g(0), g1 = g(1);
  y.fill(0, 2);
  for (let i = 1; i < NGRID - 1; i++) {
    const g2 = g(i + 1);
    // Deep in the forbidden region the solution only grows (no more nodes), and Numerov
    // would turn unstable: stop there.
    if (h12 * g2 > 0.25) return { nodes, end: i };
    y[i + 1] = (2 * y[i] * (1 + 5 * h12 * g1) - y[i - 1] * (1 - h12 * g0)) / (1 - h12 * g2);
    if (y[i + 1] * y[i] < 0) nodes++;
    if (Math.abs(y[i + 1]) > 1e150) { for (let k = 0; k <= i + 1; k++) y[k] *= 1e-150; }
    g0 = g1; g1 = g2;
  }
  return { nodes, end: NGRID - 1 };
}

function solveOrbital(V, n, l, guess) {
  const nr = n - l - 1;
  const y = new Float64Array(NGRID);
  // Bracket: the eigenvalue sits where the node count steps from nr to nr + 1.
  let lo = -1, hi = 0;
  for (let i = 0; i < NGRID; i++) lo = Math.min(lo, V[i] + (l * (l + 1)) / (2 * R[i] * R[i]));
  if (guess != null) {
    let a = guess - 0.05 * Math.abs(guess) - 0.01, b = Math.min(0, guess + 0.05 * Math.abs(guess) + 0.01);
    if (outward(V, l, a, y).nodes <= nr && outward(V, l, b, y).nodes > nr) { lo = a; hi = b; }
  }
  for (let it = 0; it < 70 && hi - lo > 1e-11 * Math.max(1, Math.abs(lo)); it++) {
    const mid = 0.5 * (lo + hi);
    if (outward(V, l, mid, y).nodes > nr) hi = mid; else lo = mid;
  }
  const eps = 0.5 * (lo + hi);
  const { end } = outward(V, l, eps, y);
  // Replace the diverging tail by an inward solution matched past the turning point.
  const L2 = (l + 0.5) ** 2, h12 = (H * H) / 12;
  const g = (i) => 2 * R[i] * R[i] * (V[i] - eps) + L2;
  let turn = end - 1;
  for (let i = end - 1; i > 1; i--) if (g(i) < 0) { turn = i; break; }
  const match = Math.min(end - 3, turn + 4);
  const yin = new Float64Array(NGRID);
  yin[end] = 0; yin[end - 1] = 1e-30;
  for (let i = end - 1; i > match; i--) {
    yin[i - 1] = (2 * yin[i] * (1 + 5 * h12 * g(i)) - yin[i + 1] * (1 - h12 * g(i + 1))) / (1 - h12 * g(i - 1));
    if (Math.abs(yin[i - 1]) > 1e150) { for (let k = i - 1; k < NGRID; k++) yin[k] *= 1e-150; }
  }
  const scale = yin[match] !== 0 ? y[match] / yin[match] : 0;
  for (let i = match + 1; i < NGRID; i++) y[i] = i < end ? yin[i] * scale : 0;
  const u = new Float64Array(NGRID);
  let norm = 0;
  for (let i = 0; i < NGRID; i++) { u[i] = Math.sqrt(R[i]) * y[i]; norm += u[i] * u[i] * R[i] * H; }
  norm = Math.sqrt(norm);
  // Sign convention: positive near the nucleus, like the hydrogen-like functions.
  const sgn = u[5] < 0 ? -1 : 1;
  for (let i = 0; i < NGRID; i++) u[i] *= sgn / norm;
  return { u, eps };
}

// ---------- potentials ----------

function hartree(q) {
  // q[i] = Σ f·u² (electrons per unit r). V_H(r) = (1/r)∫₀ʳ q + ∫ᵣ^∞ q/r'.
  const inner = new Float64Array(NGRID), outer = new Float64Array(NGRID);
  for (let i = 1; i < NGRID; i++) inner[i] = inner[i - 1] + 0.5 * (q[i - 1] * R[i - 1] + q[i] * R[i]) * H;
  for (let i = NGRID - 2; i >= 0; i--) outer[i] = outer[i + 1] + 0.5 * (q[i] + q[i + 1]) * H; // q/r · r dx
  return Float64Array.from(inner, (v, i) => v / R[i] + outer[i]);
}

/** LDA exchange–correlation potential (Slater exchange, Perdew–Zunger 1981 correlation). */
function vxc(rho) {
  if (rho < 1e-30) return 0;
  const vx = -Math.cbrt((3 * rho) / Math.PI);
  const rs = Math.cbrt(3 / (4 * Math.PI * rho));
  let vc;
  if (rs >= 1) {
    const s = Math.sqrt(rs), den = 1 + 1.0529 * s + 0.3334 * rs;
    const ec = -0.1423 / den;
    vc = (ec * (1 + (7 / 6) * 1.0529 * s + (4 / 3) * 0.3334 * rs)) / den;
  } else {
    const ln = Math.log(rs);
    vc = 0.0311 * ln - 0.048 - 0.0311 / 3 + (2 / 3) * 0.002 * rs * ln + ((2 * -0.0116 - 0.002) / 3) * rs;
  }
  return vx + vc;
}

// ---------- self-consistency ----------

const cache = new Map();

/**
 * Self-consistent orbitals for element z with the given configuration
 * ([{ n, l, count }], default: the ground state). Returns { orbitals: Map key → NumericRadial, iterations }.
 *
 * A free negative ion isn't bound in LDA (its extra electrons drift away), but in a
 * crystal the surrounding cations hold them. `watsonRadius` (bohr) adds that as a
 * Watson sphere: the compensating positive charge spread on a shell of that radius.
 */
export function solveAtom(z, config = electronConfig(z), { watsonRadius = null } = {}) {
  const key = `${z}:${config.map((s) => `${s.n}${s.l}${s.count}`).join(',')}:${watsonRadius ?? ''}`;
  if (cache.has(key)) return cache.get(key);
  const electrons = config.reduce((t, s) => t + s.count, 0);
  const excess = Math.max(0, electrons - z);
  const watson = (r) => (excess && watsonRadius ? -excess / Math.max(r, watsonRadius) : 0);
  // Start from a Thomas–Fermi-like screened nucleus.
  const b = 0.8853 / Math.cbrt(z);
  let V = Float64Array.from(R, (r) => {
    const x = r / b;
    const phi = 1 / (1 + 0.02747 * Math.sqrt(x) + 1.243 * x - 0.1486 * x ** 1.5 + 0.2302 * x * x + 0.007298 * x ** 2.5 + 0.006944 * x ** 3);
    const zEff = Math.max(z - electrons + 1, z * phi);
    return -zEff / r;
  });
  let orbitals = null, last = null, it = 0;
  const eps0 = new Map();
  for (it = 1; it <= 120; it++) {
    orbitals = config.map((s) => ({ s, ...solveOrbital(V, s.n, s.l, eps0.get(`${s.n}${s.l}`)) }));
    for (const o of orbitals) eps0.set(`${o.s.n}${o.s.l}`, o.eps);
    const q = new Float64Array(NGRID);
    for (const o of orbitals) for (let i = 0; i < NGRID; i++) q[i] += o.s.count * o.u[i] * o.u[i];
    const VH = hartree(q);
    const Vout = Float64Array.from(R, (r, i) => -z / r + VH[i] + vxc(q[i] / (4 * Math.PI * r * r)) + watson(r));
    const change = last ? Math.max(...orbitals.map((o, k) => Math.abs(o.eps - last[k]))) : Infinity;
    last = orbitals.map((o) => o.eps);
    if (change < 2e-7) break;
    const mix = it < 6 ? 0.25 : 0.4;
    V = Float64Array.from(V, (v, i) => (1 - mix) * v + mix * Vout[i]);
  }
  const result = { orbitals: new Map(orbitals.map((o) => [`${o.s.n}${o.s.l}`, new NumericRadial(o.u, o.eps)])), iterations: it };
  cache.set(key, result);
  return result;
}

/** The numerical radial function for subshell (n, l) of element z (ground state). */
export const radialFor = (z, n, l, config) => solveAtom(z, config).orbitals.get(`${n}${l}`);
