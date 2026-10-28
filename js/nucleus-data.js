// Nuclear physics for the Nucleus view: which isotope, its size, shape, binding
// energy, and the energies of its collective oscillations.

import { ELEMENTS } from './elements.js';

// Mass number of the most abundant natural isotope, Z = 1–92. Elements with no
// stable isotope use the longest-lived one (the bracketed mass in elements.js).
const MOST_ABUNDANT_A = [
  1, 4, 7, 9, 11, 12, 14, 16, 19, 20,
  23, 24, 27, 28, 31, 32, 35, 40, 39, 40,
  45, 48, 51, 52, 55, 56, 59, 58, 63, 64,
  69, 74, 75, 80, 79, 84, 85, 88, 89, 90,
  93, 98, 98, 102, 103, 106, 107, 114, 115, 120,
  121, 130, 127, 132, 133, 138, 139, 140, 141, 142,
  145, 152, 153, 158, 159, 164, 165, 166, 169, 174,
  175, 180, 181, 184, 187, 192, 193, 195, 197, 202,
  205, 208, 209, 209, 210, 222, 223, 226, 227, 232,
  231, 238,
];

// Most-abundant isotopes that are radioactive, but so slowly they're still around.
const LONG_LIVED = {
  49: 'very slightly radioactive (half-life 4.4×10¹⁴ years)',
  52: 'very slightly radioactive (half-life 8×10²⁰ years)',
  75: 'radioactive (half-life 4.1×10¹⁰ years)',
  83: 'very slightly radioactive (half-life 2×10¹⁹ years)',
  90: 'radioactive (half-life 1.4×10¹⁰ years)',
  92: 'radioactive (half-life 4.5×10⁹ years)',
};

export const MAGIC = [2, 8, 20, 28, 50, 82, 126, 184];

export const R0 = 1.2; // fm; nuclear radius R = R0 · A^(1/3)
const H_MEV_S = 4.135667696e-21; // Planck's constant in MeV·s

export function isotopeFor(z) {
  const el = ELEMENTS[z - 1];
  const A = z <= 92 ? MOST_ABUNDANT_A[z - 1] : parseInt(el.mass.replace(/[[\]]/g, ''), 10);
  const N = A - z;
  let stability;
  if (z > 92) stability = 'synthetic and radioactive (longest-lived isotope shown)';
  else if (LONG_LIVED[z]) stability = LONG_LIVED[z];
  else if (z === 43 || z === 61 || z >= 84) stability = 'radioactive; this element has no stable isotopes (longest-lived shown)';
  else stability = 'stable';
  return { Z: z, N, A, symbol: el.symbol, name: el.name, stability };
}

/**
 * Semi-empirical (Bethe–Weizsäcker) mass formula, MeV:
 *   B = aV·A − aS·A^(2/3) − aC·Z(Z−1)/A^(1/3) − aA·(A−2Z)²/A ± δ
 */
export function bindingEnergy(Z, A) {
  const aV = 15.75, aS = 17.8, aC = 0.711, aA = 23.7, aP = 11.18;
  const N = A - Z;
  const volume = aV * A;
  const surface = aS * A ** (2 / 3);
  const coulomb = (aC * Z * (Z - 1)) / A ** (1 / 3);
  const asymmetry = (aA * (A - 2 * Z) ** 2) / A;
  const pairing = Z % 2 === 0 && N % 2 === 0 ? aP / Math.sqrt(A) : Z % 2 === 1 && N % 2 === 1 ? -aP / Math.sqrt(A) : 0;
  const B = A > 1 ? volume - surface - coulomb - asymmetry + pairing : 0;
  return { B, perNucleon: A > 1 ? B / A : 0, volume, surface, coulomb, asymmetry, pairing };
}

const nearestMagicDistance = (n) => Math.min(...MAGIC.map((m) => Math.abs(n - m)));

/**
 * Quadrupole deformation β₂, estimated from the valence proton and neutron counts
 * (distances to the nearest magic numbers) through Casten's P-factor, P = NpNn/(Np+Nn).
 * Nuclei near closed shells are round; mid-shell nuclei (rare earths, actinides) are
 * prolate, with β₂ ≈ 0.3.
 */
export function deformation(Z, N) {
  const np = nearestMagicDistance(Z), nn = nearestMagicDistance(N);
  const P = np + nn ? (np * nn) / (np + nn) : 0;
  return { beta: Math.min(0.3, 0.065 * P), np, nn, P };
}

const period = (E) => H_MEV_S / E;

/** Collective oscillations: energy (MeV) and period (s). */
export function collectiveModes(Z, A, beta) {
  const dipole = 31.2 * A ** (-1 / 3) + 20.6 * A ** (-1 / 6); // Berman & Fultz systematics
  const monopole = 80 * A ** (-1 / 3);
  const quadrupole = 63 * A ** (-1 / 3);
  // Lowest rotational state of a deformed nucleus (Grodzins): E(2⁺) ≈ 1225 / (A^(7/3) β²) MeV.
  const rotation = beta >= 0.1 ? 1225 / (A ** (7 / 3) * beta * beta) : null;
  const out = {
    dipole: { E: dipole, T: period(dipole) },
    breathing: { E: monopole, T: period(monopole) },
    quadrupole: { E: quadrupole, T: period(quadrupole) },
    rotation: rotation ? { E: rotation, T: period(rotation) } : null,
  };
  if (A < 4) for (const k of ['dipole', 'breathing', 'quadrupole']) out[k] = null; // too few nucleons for a collective mode
  return out;
}

export const radiusFm = (A) => R0 * Math.cbrt(A);

export const isMagic = (n) => MAGIC.includes(n);

// Quark content and masses (PDG values, MeV/c²).
export const NUCLEONS = {
  proton: { quarks: ['u', 'u', 'd'], mass: 938.272, charge: '+1', radius: 0.84 },
  neutron: { quarks: ['u', 'd', 'd'], mass: 939.565, charge: '0', radius: 0.8 },
};
export const QUARKS = {
  u: { name: 'up', charge: '+⅔', mass: 2.16 },
  d: { name: 'down', charge: '−⅓', mass: 4.70 },
};

/** "3.1×10⁻²² s" style formatting. */
export function sci(x, digits = 2) {
  if (x === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(x)));
  const mant = (x / 10 ** exp).toFixed(digits - 1);
  const sup = String(exp).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
  return `${mant}×10${sup}`;
}
