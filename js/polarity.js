// Molecular polarity: partial charges, the dipole moment, and the electrostatic
// potential they create.
//
// Charges come from Gasteiger–Marsili "partial equalization of orbital
// electronegativity" (PEOE): each atom's electronegativity depends on its charge,
// χ(q) = a + b·q + c·q², and charge flows along every bond from the less to the more
// electronegative atom in a few damped rounds. It's fast, depends only on bonding,
// and is the standard way cheminformatics tools color molecules by charge.

// a, b, c (eV) by element and hybridization (Gasteiger & Marsili 1980).
const PEOE = {
  H: { '': [7.17, 6.24, -0.56] },
  C: { 'sp³': [7.98, 9.18, 1.88], 'sp²': [8.79, 9.32, 1.51], sp: [10.39, 9.45, 0.73] },
  N: { 'sp³': [11.54, 10.82, 1.36], 'sp²': [12.87, 11.15, 0.85], sp: [15.68, 11.70, -0.27] },
  O: { 'sp³': [14.18, 12.92, 1.39], 'sp²': [17.07, 13.79, 0.47] },
  F: { '': [14.66, 13.85, 2.31] },
  Cl: { '': [11.00, 9.69, 1.35] },
  Br: { '': [10.08, 8.47, 1.16] },
  I: { '': [9.90, 7.96, 0.96] },
  S: { 'sp³': [10.14, 9.13, 1.38], 'sp²': [10.88, 9.49, 1.33] },
  P: { '': [8.90, 8.24, 0.96] },
  Si: { '': [7.30, 6.56, 0.66] },
  B: { '': [5.98, 6.82, 1.61] },
};

function params(atom) {
  const t = PEOE[atom.symbol];
  if (!t) return null;
  const h = atom.hybrid?.replace(/[^sp³²]/g, '') ?? '';
  return t[h] ?? t['sp³'] ?? t[''] ?? Object.values(t)[0];
}

/**
 * Gasteiger–Marsili partial charges for a molecule { atoms, bonds }, or null if an
 * element isn't parameterized. Formal charges seed the iteration.
 */
export function gasteigerCharges(mol) {
  const P = mol.atoms.map(params);
  if (P.some((p) => !p)) return null;
  const q = mol.atoms.map((a) => a.formalCharge ?? 0);
  const chi = new Float64Array(q.length);
  // χ of the cation (q = +1) normalizes each transfer; hydrogen uses the special value 20.02.
  const chiPlus = mol.atoms.map((a, i) => (a.symbol === 'H' ? 20.02 : P[i][0] + P[i][1] + P[i][2]));
  for (let iter = 1; iter <= 6; iter++) {
    for (let i = 0; i < q.length; i++) chi[i] = P[i][0] + P[i][1] * q[i] + P[i][2] * q[i] * q[i];
    const dq = new Float64Array(q.length);
    const damp = 0.5 ** iter;
    for (const { a, b } of mol.bonds) {
      const [lo, hi] = chi[a] < chi[b] ? [a, b] : [b, a];
      const t = ((chi[hi] - chi[lo]) / chiPlus[lo]) * damp;
      dq[lo] += t; dq[hi] -= t;
    }
    for (let i = 0; i < q.length; i++) q[i] += dq[i];
  }
  return q;
}

const ATOMIC_MASS = { H: 1.008, C: 12.011, N: 14.007, O: 15.999, F: 18.998, P: 30.974, S: 32.06, Cl: 35.45, Br: 79.904, I: 126.9, Si: 28.086, B: 10.81 };

// A lone pair is a lump of charge off to one side of its atom, so it carries a dipole of
// its own that point charges miss (water and ammonia owe much of their polarity to
// it). Moments in debye, fit to the measured dipoles below (mean error 0.39 → 0.28 D).
const LONE_PAIR_D = { O: 0.3, 'Nsp³': 0.6, 'Nsp²': 0.6, Nsp: 1.4, F: 0.2, Cl: 0.15, Br: 0.15, I: 0.15, S: 0.2, P: 0.35 };
const DEBYE = 4.8032; // debye per e·Å

/**
 * Charges and dipoles of a molecule: { charges, lonePairs: [{ pos, mu }], dipole }, or
 * null if an element isn't parameterized. lonePairs' mu are point dipoles in e·Å.
 * dipole: { debye, vector (unit, pointing to the negative end, as chemists draw it), center }.
 */
export function polarity(mol) {
  const charges = mol.ionic ? mol.atoms.map((a) => a.charge ?? 0) : gasteigerCharges(mol);
  if (!charges) return null;
  const lonePairs = [];
  if (!mol.ionic) {
    for (const a of mol.atoms) {
      const s = LONE_PAIR_D[a.symbol + (a.symbol === 'N' ? a.hybrid : '')] ?? LONE_PAIR_D[a.symbol] ?? 0;
      if (!s) continue;
      // Electrons pushed out along the lone pair: the dipole points back toward the atom.
      for (const d of a.lpDirs ?? []) lonePairs.push({ pos: a.pos, mu: d.map((x) => (-s * x) / DEBYE) });
    }
  }
  let M = 0;
  const c = [0, 0, 0];
  for (const a of mol.atoms) {
    const m = ATOMIC_MASS[a.symbol] ?? 2 * a.z;
    M += m;
    for (let k = 0; k < 3; k++) c[k] += m * a.pos[k];
  }
  for (let k = 0; k < 3; k++) c[k] /= M;
  // μ about the center of mass (which only matters for ions).
  const mu = [0, 0, 0];
  mol.atoms.forEach((a, i) => { for (let k = 0; k < 3; k++) mu[k] += charges[i] * (a.pos[k] - c[k]); });
  for (const lp of lonePairs) for (let k = 0; k < 3; k++) mu[k] += lp.mu[k];
  const len = Math.hypot(...mu);
  const fromCharges = Math.hypot(...[0, 1, 2].map((k) => mol.atoms.reduce((t, a, i) => t + charges[i] * (a.pos[k] - c[k]), 0))) * DEBYE;
  return {
    charges, lonePairs,
    dipole: { debye: len * DEBYE, fromCharges, vector: len > 1e-9 ? mu.map((x) => -x / len) : [0, 0, 0], center: c },
  };
}

/** Electrostatic potential (kcal/mol for a unit + charge) at point p (Å). */
export function potentialAt(p, mol, pol) {
  let v = 0;
  mol.atoms.forEach((a, i) => {
    const r = Math.max(0.3, Math.hypot(p[0] - a.pos[0], p[1] - a.pos[1], p[2] - a.pos[2]));
    v += pol.charges[i] / r;
  });
  for (const { pos, mu } of pol.lonePairs) {
    const d = [p[0] - pos[0], p[1] - pos[1], p[2] - pos[2]];
    const r = Math.max(0.5, Math.hypot(...d));
    v += (mu[0] * d[0] + mu[1] * d[1] + mu[2] * d[2]) / (r * r * r);
  }
  return 332.06 * v;
}

// Measured gas-phase dipole moments (debye), by Hill formula where only one common
// molecule has it, and by SMILES or name otherwise.
const DIPOLE_BY_FORMULA = {
  H2O: 1.85, H3N: 1.47, FH: 1.82, ClH: 1.11, BrH: 0.83, HI: 0.45, CO: 0.11, CO2: 0, CH4: 0, H2S: 0.97,
  H3P: 0.57, CHN: 2.98, O2S: 1.63, F3N: 0.23, O3: 0.53, N2O: 0.16, NO2: 0.32, CH2O: 2.33, CH3Cl: 1.87, CH3F: 1.85,
  CHCl3: 1.04, CH2Cl2: 1.60, CCl4: 0, BF3: 0, H2O2: 1.57, C6H6: 0, C2H4: 0, C2H2: 0, F2O: 0.30, F6S: 0, Cl3P: 0.97,
  CH4O: 1.70, C3H6O: 2.88, C2H3N: 3.92, CH2O2: 1.41, C6H5Cl: 1.69, CH5N: 1.31, F4S: 0.63, ClF3: 0.6, F4Xe: 0,
  Cl5P: 0, C4H10: 0, C6H12: 0, H2: 0, N2: 0, O2: 0, F2: 0, Cl2: 0, ClNa: 9.00, FLi: 6.33, ClK: 10.27,
};
const DIPOLE_BY_SMILES = { CCO: 1.69, OCC: 1.69, COC: 1.30, 'CC(=O)O': 1.70, CNC: 1.03, 'CC#N': 3.92, 'OC=O': 1.41, 'Clc1ccccc1': 1.69, 'CC(=O)C': 2.88 };
const DIPOLE_BY_NAME = { ethanol: 1.69, 'dimethyl ether': 1.30, 'acetic acid': 1.70 };

/** Hill formula: C, then H, then the rest alphabetically. */
export function hillFormula(atoms) {
  const n = new Map();
  for (const a of atoms) n.set(a.symbol, (n.get(a.symbol) ?? 0) + 1);
  const order = n.has('C') ? ['C', 'H', ...[...n.keys()].filter((k) => k !== 'C' && k !== 'H').sort()] : [...n.keys()].sort();
  return order.filter((k) => n.has(k)).map((k) => `${k}${n.get(k) > 1 ? n.get(k) : ''}`).join('');
}

/** Measured dipole for a neutral molecule, or null. */
export function measuredDipole(mol) {
  if (mol.charge) return null;
  if (mol.smiles && DIPOLE_BY_SMILES[mol.smiles] != null) return DIPOLE_BY_SMILES[mol.smiles];
  const name = mol.name?.toLowerCase();
  if (name && DIPOLE_BY_NAME[name] != null) return DIPOLE_BY_NAME[name];
  if (mol.smiles && mol.smiles.includes('.')) return null; // clusters such as the water dimer
  if (name && /dimer|pair/.test(name)) return null;
  return DIPOLE_BY_FORMULA[hillFormula(mol.atoms)] ?? null;
}
