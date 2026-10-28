// Molecular vibrations: normal modes from a valence force field, with IR intensities.
//
//   V = ½Σ k_r (Δr)² + ½Σ k_θ (Δθ)² + Σ V_τ (1 − cos Δτ) + ½Σ k_oop χ² (+ H-bond springs)
//
// referenced to the molecule's own geometry, so it is at the energy minimum. The
// Hessian (numerical second derivatives) is mass-weighted, translations and rotations
// are projected out, and diagonalizing gives the normal modes:
//   wavenumber ν̃ = √λ / (2πc) = 1302.79·√λ cm⁻¹ for λ in mdyn·Å⁻¹·amu⁻¹.
// IR intensity ∝ |dμ/dQ|², with the dipole μ = Σ qᵢ rᵢ from fixed partial charges.
// Bond force constants are measured values where known, otherwise Badger's rule.

import { ELEMENTS } from './elements.js';
import { jacobiEigen } from './eht.js';

const BY_SYMBOL = new Map(ELEMENTS.map((e) => [e.symbol, e]));
const WAVENUMBER = 1302.79; // cm⁻¹ per √(mdyn·Å⁻¹·amu⁻¹)
const DEG = Math.PI / 180;

// Bond-stretch force constants, mdyn/Å, keyed by sorted symbols + bond order.
const K_BOND = {
  'H-H1': 5.75, 'C-H1': 4.9, 'H-N1': 6.4, 'H-O1': 7.8, 'H-S1': 4.1, 'H-P1': 3.2, 'H-Si1': 2.9,
  'F-H1': 9.66, 'Cl-H1': 5.16, 'B-H1': 3.5, 'Br-H1': 4.1, 'H-Li1': 1.0,
  'C-C1': 4.5, 'C-C1.5': 7.0, 'C-C2': 9.6, 'C-C3': 15.7,
  'C-N1': 5.0, 'C-N1.5': 6.5, 'C-N2': 10.5, 'C-N3': 18.5,
  'C-O1': 5.0, 'C-O1.5': 7.0, 'C-O2': 12.3, 'C-O3': 19.0,
  'C-F1': 5.7, 'C-Cl1': 3.4, 'Br-C1': 2.8, 'C-S1': 3.0, 'C-S2': 7.5,
  'N-N1': 4.0, 'N-N2': 10.0, 'N-N3': 22.4, 'N-O1': 4.0, 'N-O1.5': 9.0, 'N-O2': 11.0,
  'O-O1': 4.0, 'O-O1.5': 5.7, 'O-O2': 11.8, 'O-S1.5': 9.9, 'O-S2': 10.0, 'O-S1.33': 10.5,
  'F-F1': 4.45, 'Cl-Cl1': 3.2, 'B-F1': 6.1, 'F-S1': 5.0, 'Cl-P1': 2.1, 'F-N1': 4.3,
  'F-O1': 3.9, 'F-Xe1': 2.8, 'Cl-F1': 4.2, 'F-Si1': 5.0, 'Cl-Si1': 2.6, 'Cl-O1': 2.9,
};
// Badger's rule: k = 1.86 / (r − d)³ mdyn/Å, with d set by the two atoms' periods.
const BADGER_D = { '1,1': 0.025, '1,2': 0.335, '1,3': 0.585, '2,2': 0.68, '2,3': 0.90, '3,3': 1.06 };

const massOf = (symbol) => parseFloat(BY_SYMBOL.get(symbol).mass.replace(/[[\]]/g, ''));

// Cumulated double bonds (O=C=O, N=N=O, S=C=S) are stiffer than isolated ones.
const K_CUMULATED = { 'C-O2': 15.5, 'N-N2': 17.9, 'N-O2': 11.5, 'C-S2': 7.9 };

function bondConstant(a, b, order, r, ionic, cumulated) {
  if (cumulated) {
    const ck = K_CUMULATED[[a, b].sort().join('-') + order];
    if (ck) return ck;
  }
  if (ionic) {
    const key = [Math.min(BY_SYMBOL.get(a).row, 3), Math.min(BY_SYMBOL.get(b).row, 3)].sort().join(',');
    return 1.86 / Math.max(0.3, r - BADGER_D[key]) ** 3;
  }
  // CO₂-like cumulated C=O bonds are stiffer than a ketone's.
  const key = [a, b].sort().join('-') + order;
  if (K_BOND[key]) return K_BOND[key];
  const rows = [Math.min(BY_SYMBOL.get(a).row, 3), Math.min(BY_SYMBOL.get(b).row, 3)].sort().join(',');
  return 1.86 / Math.max(0.2, r - (BADGER_D[rows] ?? 0.9)) ** 3;
}

const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const len = (u) => Math.hypot(u[0], u[1], u[2]);
const P = (x, i) => [x[3 * i], x[3 * i + 1], x[3 * i + 2]];

const angle = (x, a, b, c) => {
  const u = sub(P(x, a), P(x, b)), w = sub(P(x, c), P(x, b));
  return Math.atan2(len(cross(u, w)), dot(u, w));
};
const dihedral = (x, a, b, c, d) => {
  const F = sub(P(x, a), P(x, b)), G = sub(P(x, b), P(x, c)), H = sub(P(x, d), P(x, c));
  const A = cross(F, G), B = cross(H, G);
  return Math.atan2(dot(cross(B, A), G) / (len(G) || 1), dot(A, B));
};
const oop = (x, c, a, b, d) => { // sine of the out-of-plane angle at center c
  const u = sub(P(x, a), P(x, c)), v = sub(P(x, b), P(x, c)), w = sub(P(x, d), P(x, c));
  return dot(u, cross(v, w)) / (len(u) * len(v) * len(w));
};

/** Internal-coordinate terms with reference values from the given geometry. */
function buildTerms(mol, x0) {
  const { atoms, bonds } = mol;
  const terms = [];
  const nbrs = atoms.map(() => []);
  for (const b of bonds) {
    nbrs[b.a].push(b.b); nbrs[b.b].push(b.a);
    const r = len(sub(P(x0, b.a), P(x0, b.b)));
    const doubles = (i) => bonds.filter((o) => (o.a === i || o.b === i) && o.order === 2).length;
    const cumulated = b.order === 2 && (doubles(b.a) >= 2 || doubles(b.b) >= 2);
    const k = bondConstant(atoms[b.a].symbol, atoms[b.b].symbol, b.order, r, b.ionic, cumulated);
    terms.push({ type: 'bond', atoms: [b.a, b.b], k, ref: r, order: b.order });
  }
  for (let c = 0; c < atoms.length; c++) {
    const nb = nbrs[c];
    for (let i = 0; i < nb.length; i++) {
      for (let j = i + 1; j < nb.length; j++) {
        const th = angle(x0, nb[i], c, nb[j]);
        const hasH = atoms[nb[i]].symbol === 'H' || atoms[nb[j]].symbol === 'H';
        const r1r2 = len(sub(P(x0, nb[i]), P(x0, c))) * len(sub(P(x0, nb[j]), P(x0, c)));
        // Bend constants (mdyn·Å/rad²): X–H bends by central atom; heavy-atom bends grow with r₁r₂.
        let k;
        if (th > 170 * DEG) k = hasH ? 0.25 : 0.57 * r1r2;
        else if (hasH) k = { C: 0.53, N: 0.64, O: 0.68, S: 0.45, P: 0.4, Si: 0.35, B: 0.45 }[atoms[c].symbol] ?? 0.5;
        else k = 0.55 * r1r2;
        terms.push({ type: 'angle', atoms: [nb[i], c, nb[j]], k, ref: th });
      }
    }
    // Planar three-coordinate centers resist bending out of plane.
    if (nb.length === 3 && Math.abs(oop(x0, c, nb[0], nb[1], nb[2])) < 0.08) {
      terms.push({ type: 'oop', atoms: [c, ...nb], k: 0.45, ref: oop(x0, c, nb[0], nb[1], nb[2]) });
    }
  }
  for (const b of bonds) {
    if (b.ionic) continue;
    const outB = nbrs[b.a].filter((v) => v !== b.b), outC = nbrs[b.b].filter((v) => v !== b.a);
    if (!outB.length || !outC.length) continue;
    if ([...outB.map((a) => angle(x0, a, b.a, b.b)), ...outC.map((d) => angle(x0, b.a, b.b, d))].some((t) => t > 170 * DEG)) continue;
    const V = (b.order >= 1.5 ? 0.30 : 0.04) / (outB.length * outC.length); // mdyn·Å
    for (const a of outB) for (const d of outC) {
      terms.push({ type: 'torsion', atoms: [a, b.a, b.b, d], k: V, ref: dihedral(x0, a, b.a, b.b, d) });
    }
  }
  for (const hb of mol.hbonds ?? []) {
    terms.push({ type: 'hbond', atoms: [hb.h, hb.a], k: 0.12, ref: hb.length });
  }
  return terms;
}

function value(t, x) {
  const [a, b, c, d] = t.atoms;
  if (t.type === 'bond' || t.type === 'hbond') return len(sub(P(x, a), P(x, b)));
  if (t.type === 'angle') return angle(x, a, b, c);
  if (t.type === 'torsion') return dihedral(x, a, b, c, d);
  return oop(x, a, b, c, d);
}

function termEnergy(t, x) {
  const q = value(t, x);
  if (t.type === 'torsion') {
    let dq = q - t.ref;
    dq -= 2 * Math.PI * Math.round(dq / (2 * Math.PI));
    return t.k * (1 - Math.cos(dq));
  }
  return 0.5 * t.k * (q - t.ref) ** 2;
}

const energy = (terms, x) => terms.reduce((s, t) => s + termEnergy(t, x), 0);

/**
 * Normal modes of a molecule (atoms with pos in Å, bonds, optional hbonds).
 * charges: partial charges per atom (for IR intensities), or null.
 * Returns { modes: [{ wavenumber, intensity, disp: Float64Array(3N), label }], linear, zeroModes }.
 */
export function normalModes(mol, charges = null) {
  const n = mol.atoms.length;
  const N = 3 * n;
  const x0 = new Float64Array(N);
  mol.atoms.forEach((a, i) => x0.set(a.pos, 3 * i));
  const mass = mol.atoms.map((a) => massOf(a.symbol));
  const terms = buildTerms(mol, x0);

  // Only terms touching an atom change when it moves: index them per atom.
  const touching = Array.from({ length: n }, () => []);
  terms.forEach((t, k) => new Set(t.atoms).forEach((a) => touching[a].push(k)));
  const localE = (x, atomsMoved) => {
    const ks = new Set(atomsMoved.flatMap((a) => touching[a]));
    let e = 0;
    for (const k of ks) e += termEnergy(terms[k], x);
    return e;
  };

  // Hessian by central differences (mdyn/Å, since energies are in mdyn·Å).
  const h = 1e-3;
  const Hs = new Float64Array(N * N);
  const x = Float64Array.from(x0);
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      const ai = Math.floor(i / 3), aj = Math.floor(j / 3);
      const moved = ai === aj ? [ai] : [ai, aj];
      let v;
      if (i === j) {
        const e0 = localE(x, moved);
        x[i] += h; const ep = localE(x, moved);
        x[i] -= 2 * h; const em = localE(x, moved);
        x[i] += h;
        v = (ep - 2 * e0 + em) / (h * h);
      } else {
        const f = (si, sj) => { x[i] += si * h; x[j] += sj * h; const e = localE(x, moved); x[i] -= si * h; x[j] -= sj * h; return e; };
        v = (f(1, 1) - f(1, -1) - f(-1, 1) + f(-1, -1)) / (4 * h * h);
      }
      Hs[i * N + j] = Hs[j * N + i] = v;
    }
  }

  // Mass-weight, then project out overall translation and rotation.
  const sm = Array.from({ length: N }, (_, i) => Math.sqrt(mass[Math.floor(i / 3)]));
  const Hm = new Float64Array(N * N);
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) Hm[i * N + j] = Hs[i * N + j] / (sm[i] * sm[j]);
  const com = [0, 0, 0];
  const M = mass.reduce((s, m) => s + m, 0);
  mol.atoms.forEach((a, i) => { for (let k = 0; k < 3; k++) com[k] += (mass[i] * a.pos[k]) / M; });
  const ext = [];
  for (let k = 0; k < 3; k++) { const v = new Float64Array(N); for (let i = 0; i < n; i++) v[3 * i + k] = sm[3 * i]; ext.push(v); }
  for (let k = 0; k < 3; k++) {
    const v = new Float64Array(N);
    for (let i = 0; i < n; i++) {
      const r = sub(mol.atoms[i].pos, com);
      const e = [0, 0, 0]; e[k] = 1;
      const c = cross(e, r);
      for (let d = 0; d < 3; d++) v[3 * i + d] = c[d] * sm[3 * i];
    }
    ext.push(v);
  }
  const basis = []; // Gram–Schmidt; a linear molecule has only 2 independent rotations
  for (const v of ext) {
    for (const b of basis) { const p = dot3N(v, b); for (let i = 0; i < N; i++) v[i] -= p * b[i]; }
    const l = Math.sqrt(dot3N(v, v));
    if (l > 1e-6) basis.push(v.map((c) => c / l));
  }
  const Pm = new Float64Array(N * N);
  for (let i = 0; i < N; i++) Pm[i * N + i] = 1;
  for (const b of basis) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) Pm[i * N + j] -= b[i] * b[j];
  const Hp = multiply(multiply(Pm, Hm, N), Pm, N);

  const { values, vectors } = jacobiEigen(Hp, N);
  const order = [...values.keys()].sort((a, b) => values[a] - values[b]);
  const zeroModes = basis.length; // 6, or 5 for a linear molecule
  const modes = [];
  for (const k of order.slice(zeroModes)) {
    const lam = values[k];
    const wavenumber = Math.sign(lam) * WAVENUMBER * Math.sqrt(Math.abs(lam));
    const disp = new Float64Array(N);
    for (let i = 0; i < N; i++) disp[i] = vectors[i * N + k] / sm[i]; // Cartesian displacement
    // IR: change of dipole along the mode (mass-weighted normalization).
    let intensity = 0;
    if (charges) {
      const dmu = [0, 0, 0];
      for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) dmu[d] += charges[i] * disp[3 * i + d];
      intensity = dot(dmu, dmu);
    }
    const peak = Math.max(...Array.from({ length: n }, (_, i) => Math.hypot(disp[3 * i], disp[3 * i + 1], disp[3 * i + 2])));
    for (let i = 0; i < N; i++) disp[i] /= peak || 1;
    modes.push({ wavenumber, intensity, disp, label: describe(mol, terms, x0, disp) });
  }
  const maxI = Math.max(...modes.map((m) => m.intensity), 1e-12);
  for (const m of modes) m.intensity /= maxI;
  return { modes, linear: zeroModes === 5, zeroModes, hasIntensities: !!charges };
}

const dot3N = (u, v) => { let s = 0; for (let i = 0; i < u.length; i++) s += u[i] * v[i]; return s; };
function multiply(A, B, N) {
  const C = new Float64Array(N * N);
  for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) {
    const a = A[i * N + k];
    if (!a) continue;
    for (let j = 0; j < N; j++) C[i * N + j] += a * B[k * N + j];
  }
  return C;
}

/** Name a mode by which internal coordinates carry most of its energy. */
function describe(mol, terms, x0, disp) {
  const s = 0.01;
  const x = Float64Array.from(x0, (v, i) => v + s * disp[i]);
  const parts = terms.map((t) => {
    let dq = value(t, x) - t.ref;
    if (t.type === 'torsion') dq -= 2 * Math.PI * Math.round(dq / (2 * Math.PI));
    return { t, dq, e: 0.5 * t.k * dq * dq };
  });
  const total = parts.reduce((a, p) => a + p.e, 0) || 1;
  const sym = (i) => mol.atoms[i].symbol;
  const bondSym = (o) => (o === 2 ? '=' : o === 3 ? '≡' : o % 1 ? '⋯' : '–');
  const nameOf = ({ t }) => {
    const a = t.atoms;
    if (t.type === 'bond') return `${sym(a[0])}${bondSym(t.order)}${sym(a[1])} stretch`;
    if (t.type === 'hbond') return 'hydrogen-bond stretch';
    if (t.type === 'angle') return `${sym(a[0])}–${sym(a[1])}–${sym(a[2])} bend`;
    if (t.type === 'torsion') return `twist about ${sym(a[1])}–${sym(a[2])}`;
    return `${sym(a[0])} out-of-plane wag`;
  };
  // Group by name, so equivalent bonds (e.g. both O–H) count together.
  const groups = new Map();
  for (const p of parts) {
    const key = nameOf(p).replace(/^(\w+)(.)(\w+)( stretch)$/, (m0, a, b, c, d) => [a, c].sort().join(b) + d);
    const g = groups.get(key) ?? { e: 0, items: [] };
    g.e += p.e; g.items.push(p);
    groups.set(key, g);
  }
  const [name, g] = [...groups].sort((a, b) => b[1].e - a[1].e)[0];
  const share = g.e / total;
  let prefix = '';
  const big = g.items.filter((p) => p.e > 0.2 * g.e);
  if (big.length >= 2 && (name.endsWith('stretch') || name.endsWith('bend'))) {
    prefix = big.every((p) => Math.sign(p.dq) === Math.sign(big[0].dq)) ? 'symmetric ' : 'asymmetric ';
  }
  return share > 0.45 ? prefix + name : `mixed: ${prefix}${name}`;
}

// Measured fundamental frequencies (cm⁻¹, gas phase) for comparison, lowest first.
export const MEASURED = {
  H2: [4161], N2: [2330], O2: [1556], F2: [892], Cl2: [560], CO: [2143], HF: [3962], HCl: [2886],
  H2O: [1595, 3657, 3756], H2S: [1183, 2615, 2626],
  CO2: [667, 667, 1333, 2349], N2O: [589, 589, 1285, 2224], HCN: [712, 712, 2097, 3311],
  SO2: [518, 1151, 1362], O3: [701, 1042, 1103], NO2: [750, 1318, 1618],
  NH3: [950, 1627, 1627, 3337, 3444, 3444], CH4: [1306, 1306, 1306, 1534, 1534, 2917, 3019, 3019, 3019],
  BF3: [480, 480, 691, 888, 1454, 1454], CH2O: [1167, 1249, 1500, 1746, 2783, 2843],
};
