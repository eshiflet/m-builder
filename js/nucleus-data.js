// Nuclear physics for the Nucleus view: which isotope, its size, shape, binding
// energy, and the energies of its collective oscillations.

import { ELEMENTS } from './elements.js';
import { groundStateShape } from './nuclear-shape.js';

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
const nearestMagicDistance = (n) => Math.min(...MAGIC.map((m) => Math.abs(n - m)));
export const valenceCounts = (Z, N) => ({ np: nearestMagicDistance(Z), nn: nearestMagicDistance(N) });

export const R0 = 1.2; // fm; nuclear radius R = R0 · A^(1/3)
const H_MEV_S = 4.135667696e-21; // Planck's constant in MeV·s

// Halo nuclei: a compact core plus loosely bound nucleons far outside it.
export const HALOS = {
  '2,4': { core: 2, halo: 2, kind: 'n' }, // ⁶He
  '2,6': { core: 2, halo: 4, kind: 'n' }, // ⁸He
  '3,8': { core: 6, halo: 2, kind: 'n' }, // ¹¹Li = ⁹Li + 2n
  '4,7': { core: 6, halo: 1, kind: 'n' }, // ¹¹Be = ¹⁰Be + n
  '4,10': { core: 8, halo: 2, kind: 'n' }, // ¹⁴Be
  '5,12': { core: 10, halo: 2, kind: 'n' }, // ¹⁷B
  '6,13': { core: 12, halo: 1, kind: 'n' }, // ¹⁹C
  '6,16': { core: 14, halo: 2, kind: 'n' }, // ²²C
  '5,3': { core: 4, halo: 1, kind: 'p' }, // ⁸B = ⁷Be + p (proton halo)
};

// Light isotopes that exist even though the mass formula (poor for small A) says otherwise.
const KNOWN_LIGHT = {
  1: [0, 1, 2], 2: [1, 2, 4, 6], 3: [3, 4, 5, 6, 8], 4: [3, 5, 6, 7, 10], 5: [3, 5, 6, 7, 12],
  6: [5, 6, 7, 8, 13, 16], 7: [6, 7, 8], 8: [7, 8, 9, 10],
};

/** Neutron counts with a bound nucleus for element Z (mass formula, plus known light ones). */
export function allowedNeutrons(z) {
  const out = new Set(KNOWN_LIGHT[z] ?? []);
  const def = defaultA(z) - z;
  out.add(def);
  if (z > 8) {
    for (let n = Math.max(1, Math.floor(z * 0.8)); n <= Math.ceil(z * 1.9) + 10; n++) {
      const sn = bindingEnergy(z, z + n).B - bindingEnergy(z, z + n - 1).B;
      const sp = bindingEnergy(z, z + n).B - bindingEnergy(z - 1, z + n - 1).B;
      if (sn > 0 && sp > 0) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function defaultA(z) {
  const el = ELEMENTS[z - 1];
  return z <= 92 ? MOST_ABUNDANT_A[z - 1] : parseInt(el.mass.replace(/[[\]]/g, ''), 10);
}

/** The element's most common (or longest-lived) isotope, or a chosen neutron count. */
export function isotopeFor(z, n = null) {
  const el = ELEMENTS[z - 1];
  const A0 = defaultA(z);
  const N = n ?? A0 - z;
  const A = z + N;
  const halo = HALOS[`${z},${N}`] ?? null;
  let stability;
  if (A !== A0) stability = halo ? `a ${halo.kind === 'n' ? 'neutron' : 'proton'}-halo nucleus (short-lived, made in accelerators)` : 'a less common or unstable isotope';
  else if (z > 92) stability = 'synthetic and radioactive (longest-lived isotope shown)';
  else if (LONG_LIVED[z]) stability = LONG_LIVED[z];
  else if (z === 43 || z === 61 || z >= 84) stability = 'radioactive; this element has no stable isotopes (longest-lived shown)';
  else stability = 'stable';
  return { Z: z, N, A, symbol: el.symbol, name: el.name, stability, halo, isDefault: A === A0 };
}

/**
 * Half-density radii (fm) of the proton and neutron distributions, Woods–Saxon
 * diffuseness 0.55 fm. Extra neutrons extend a little farther (the neutron skin):
 * r_n − r_p ≈ 0.9·(N − Z)/A − 0.03 fm (Trzcińska et al. 2001).
 */
export function densityRadii(Z, N) {
  const A = Z + N;
  const Rp = Math.max(0.8, 1.12 * Math.cbrt(A) - 0.86 / Math.cbrt(A));
  const skin = Math.max(0, 0.9 * ((N - Z) / A) - 0.03);
  return { Rp, Rn: Rp + skin * 1.3, a: 0.55, skin }; // half-density shift ≈ 1.3 × rms difference
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

// Light nuclei where the shell calculation misses alpha clustering: measured intrinsic deformations.
const LIGHT_SHAPES = { '10,10': 0.45, '12,12': 0.45, '4,4': 0.6, '6,6': -0.4 };

/**
 * Ground-state quadrupole deformation β₂ (negative = oblate) from the
 * Nilsson–Strutinsky calculation in nuclear-shape.js, with the energy-vs-shape curve.
 * `depth` is how much energy deforming saves: large → rigid, small → soft.
 */
export function deformation(Z, N) {
  const A = Z + N;
  if (A < 8) {
    const m = LIGHT_SHAPES[`${Z},${N}`];
    return { beta: m ?? 0, curve: null, depth: 0, source: m != null ? 'measured' : 'too light for a meaningful shape' };
  }
  const calc = groundStateShape(Z, N);
  const measured = LIGHT_SHAPES[`${Z},${N}`];
  if (measured != null) return { ...calc, beta: measured, source: 'measured' };
  return { ...calc, source: A < 40 ? 'calculated (rough for light nuclei)' : 'calculated' };
}

const period = (E) => H_MEV_S / E;

export const HBAR_MEV_S = 6.582119569e-22;
export const BABYSECOND = 1e-23; // s; light crosses 3 fm in one babysecond

/**
 * Rotation period of a deformed nucleus at spin J: for a rigid rotor with
 * E(J) = E(2⁺)·J(J+1)/6, the angular frequency is ω = dE/dJ / ħ = (2J+1)·E(2⁺)/(6ħ).
 */
export const rotationPeriod = (E2, J) => (2 * Math.PI * 6 * HBAR_MEV_S) / ((2 * J + 1) * E2);

/** Collective oscillations: energy (MeV) and period (s). */
export function collectiveModes(Z, A, beta) {
  const dipole = 31.2 * A ** (-1 / 3) + 20.6 * A ** (-1 / 6); // Berman & Fultz systematics
  const monopole = 80 * A ** (-1 / 3);
  const quadrupole = 63 * A ** (-1 / 3);
  // Lowest rotational state of a deformed nucleus (Grodzins): E(2⁺) ≈ 1225 / (A^(7/3) β²) MeV.
  const rotation = Math.abs(beta) >= 0.1 ? 1225 / (A ** (7 / 3) * beta * beta) : null;
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
