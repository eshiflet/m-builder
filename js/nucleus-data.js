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
// `core` is the core's neutron count; `sep` is the measured energy (MeV) needed to pull
// the halo nucleons off (S₂ₙ for two-neutron halos, Sₙ or Sₚ for one).
export const HALOS = {
  '2,4': { core: 2, halo: 2, kind: 'n', sep: 0.975 }, // ⁶He
  '2,6': { core: 2, halo: 4, kind: 'n', sep: 2.14 }, // ⁸He
  '3,8': { core: 6, halo: 2, kind: 'n', sep: 0.369 }, // ¹¹Li = ⁹Li + 2n
  '4,7': { core: 6, halo: 1, kind: 'n', sep: 0.502 }, // ¹¹Be = ¹⁰Be + n
  '4,10': { core: 8, halo: 2, kind: 'n', sep: 1.27 }, // ¹⁴Be
  '5,12': { core: 10, halo: 2, kind: 'n', sep: 1.38 }, // ¹⁷B
  '6,13': { core: 12, halo: 1, kind: 'n', sep: 0.58 }, // ¹⁹C
  '6,16': { core: 14, halo: 2, kind: 'n', sep: 0.14 }, // ²²C
  '5,3': { core: 4, halo: 1, kind: 'p', sep: 0.137 }, // ⁸B = ⁷Be + p (proton halo)
};

/**
 * Decay constant κ (fm⁻¹) of a halo's density outside the core, ρ ∝ e^{−2κr}/r²,
 * from κ = √(2μS)/ħc with μ the reduced mass of halo nucleons vs. core.
 */
export function haloKappa(iso) {
  const h = iso.halo.halo, A = iso.A;
  const mu = (938.9 * h * (A - h)) / A;
  return Math.sqrt(2 * mu * iso.halo.sep) / 197.327;
}

// Light isotopes that exist even though the mass formula (poor for small A) says otherwise.
export const KNOWN_LIGHT = {
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
// Pear-shaped (octupole-deformed) nuclei: measured [β₂, β₃] from Coulomb excitation,
// ²²⁴Ra (Gaffney et al. 2013), ¹⁴⁴Ba and ¹⁴⁶Ba (Bucher et al. 2016–17), ²²²,²²⁶,²²⁸Ra
// (Wollersheim 1993; Butler et al. 2020). Approximate (±0.01–0.03). ²²⁰Rn is an
// octupole vibrator: soft, not permanently pear-shaped. A quadrupole-only calculation
// misses their β₂ too, since mixing in the octupole shape is what deepens it.
export const OCTUPOLE = {
  '88,134': [0.19, 0.11], '88,136': [0.154, 0.10], '88,138': [0.20, 0.10], '88,140': [0.21, 0.07],
  '56,88': [0.18, 0.17], '56,90': [0.20, 0.11], '86,134': [0.11, 0.06],
};

export function deformation(Z, N) {
  const oct = OCTUPOLE[`${Z},${N}`];
  if (!oct) return { ...quadrupoleShape(Z, N), beta3: 0 };
  return { ...quadrupoleShape(Z, N), beta: oct[0], beta3: oct[1], source: 'measured' };
}

function quadrupoleShape(Z, N) {
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

/**
 * Collective oscillations: energy E (MeV), period T (s), and for the giant resonances
 * the width Γ (MeV). A resonance of width Γ loses its energy at the rate Γ/ħ (its
 * amplitude at Γ/2ħ): into more complicated nucleon motion (the "spreading width") and
 * by emitting particles. Widths from systematics: GDR Γ ≈ 0.026·E^1.91 for spherical
 * nuclei (Carlos et al.), broadened in deformed ones where the peak splits in two;
 * GMR Γ ≈ 0.2·E and GQR Γ ≈ 0.27·E (about 3 MeV in ²⁰⁸Pb).
 */
export function collectiveModes(Z, A, beta) {
  const dipole = 31.2 * A ** (-1 / 3) + 20.6 * A ** (-1 / 6); // Berman & Fultz systematics
  const monopole = 80 * A ** (-1 / 3);
  const quadrupole = 63 * A ** (-1 / 3);
  // Lowest rotational state of a deformed nucleus (Grodzins): E(2⁺) ≈ 1225 / (A^(7/3) β²) MeV.
  const rotation = Math.abs(beta) >= 0.1 ? 1225 / (A ** (7 / 3) * beta * beta) : null;
  const out = {
    dipole: { E: dipole, T: period(dipole), width: 0.026 * dipole ** 1.91 + 0.6 * Math.abs(beta) * dipole },
    breathing: { E: monopole, T: period(monopole), width: 0.2 * monopole },
    quadrupole: { E: quadrupole, T: period(quadrupole), width: 0.27 * quadrupole },
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

// ---------- radioactive decay and reactions ----------

export const AMU_MEV = 931.494;
const B_HE4 = 28.296; // measured binding energy of ⁴He, MeV
const MN_MINUS_MH = 0.782; // (m_n − m_¹H)c², MeV

// Measured decay data (main mode first): Q in MeV, half-life in seconds.
const YEAR = 3.156e7, DAY = 86400;
export const DECAYS = {
  // α emitters
  '92,238': { modes: [['α', 4.270]], t: 4.468e9 * YEAR, fission: true },
  '92,235': { modes: [['α', 4.679]], t: 7.04e8 * YEAR, fission: true },
  '90,232': { modes: [['α', 4.083]], t: 1.405e10 * YEAR, fission: true },
  '94,239': { modes: [['α', 5.245]], t: 24110 * YEAR, fission: true },
  '94,244': { modes: [['α', 4.666]], t: 8.0e7 * YEAR, fission: true },
  '88,226': { modes: [['α', 4.871]], t: 1600 * YEAR },
  '86,222': { modes: [['α', 5.590]], t: 3.8235 * DAY },
  '88,224': { modes: [['α', 5.789]], t: 3.632 * DAY },
  '88,222': { modes: [['α', 6.679]], t: 38.0 },
  '88,228': { modes: [['β⁻', 0.0459]], t: 5.75 * YEAR },
  '86,220': { modes: [['α', 6.405]], t: 55.6 },
  '56,144': { modes: [['β⁻', 3.12]], t: 11.5 },
  '56,146': { modes: [['β⁻', 4.1]], t: 2.22 },
  '84,210': { modes: [['α', 5.407]], t: 138.38 * DAY },
  '84,209': { modes: [['α', 4.979]], t: 124 * YEAR },
  '84,212': { modes: [['α', 8.954]], t: 2.99e-7 },
  '83,209': { modes: [['α', 3.137]], t: 2.01e19 * YEAR },
  '91,231': { modes: [['α', 5.150]], t: 32760 * YEAR },
  '93,237': { modes: [['α', 4.958]], t: 2.144e6 * YEAR },
  '95,241': { modes: [['α', 5.638]], t: 432.2 * YEAR },
  '95,243': { modes: [['α', 5.439]], t: 7370 * YEAR },
  '96,247': { modes: [['α', 5.353]], t: 1.56e7 * YEAR },
  '97,247': { modes: [['α', 5.889]], t: 1380 * YEAR },
  '98,251': { modes: [['α', 6.176]], t: 898 * YEAR },
  '98,252': { modes: [['α', 6.217]], t: 2.645 * YEAR, fission: true },
  '99,252': { modes: [['α', 6.739]], t: 471.7 * DAY },
  '100,257': { modes: [['α', 6.864]], t: 100.5 * DAY },
  '101,258': { modes: [['α', 7.271]], t: 51.5 * DAY },
  '102,259': { modes: [['α', 7.85]], t: 58 * 60 },
  '62,147': { modes: [['α', 2.311]], t: 1.06e11 * YEAR },
  '60,144': { modes: [['α', 1.905]], t: 2.29e15 * YEAR },
  // β⁻ emitters
  '1,3': { modes: [['β⁻', 0.01859]], t: 12.32 * YEAR },
  '6,14': { modes: [['β⁻', 0.1565]], t: 5730 * YEAR },
  '15,32': { modes: [['β⁻', 1.711]], t: 14.27 * DAY },
  '19,40': { modes: [['β⁻', 1.311], ['EC', 1.505]], t: 1.248e9 * YEAR },
  '27,60': { modes: [['β⁻', 2.824]], t: 5.271 * YEAR },
  '38,90': { modes: [['β⁻', 0.546]], t: 28.79 * YEAR },
  '43,98': { modes: [['β⁻', 1.79]], t: 4.2e6 * YEAR },
  '43,99': { modes: [['β⁻', 0.294]], t: 2.11e5 * YEAR },
  '53,131': { modes: [['β⁻', 0.971]], t: 8.02 * DAY },
  '55,137': { modes: [['β⁻', 1.176]], t: 30.08 * YEAR },
  '75,187': { modes: [['β⁻', 0.00266]], t: 4.12e10 * YEAR },
  '49,115': { modes: [['β⁻', 0.497]], t: 4.41e14 * YEAR },
  '87,223': { modes: [['β⁻', 1.149]], t: 22 * 60 },
  '89,227': { modes: [['β⁻', 0.0448]], t: 21.77 * YEAR },
  '2,6': { modes: [['β⁻', 3.505]], t: 0.807 },
  '2,8': { modes: [['β⁻', 10.66]], t: 0.119 },
  '3,11': { modes: [['β⁻', 20.55]], t: 0.00875 },
  '4,11': { modes: [['β⁻', 11.51]], t: 13.8 },
  '4,14': { modes: [['β⁻', 16.29]], t: 0.00435 },
  '5,17': { modes: [['β⁻', 22.68]], t: 0.00508 },
  '6,19': { modes: [['β⁻', 16.97]], t: 0.0462 },
  '6,22': { modes: [['β⁻', 22.0]], t: 0.0061 },
  '52,130': { modes: [['2β⁻', 2.527]], t: 7.9e20 * YEAR },
  // β⁺ / electron capture
  '9,18': { modes: [['β⁺', 1.656]], t: 109.77 * 60 },
  '6,11': { modes: [['β⁺', 1.982]], t: 20.36 * 60 },
  '11,22': { modes: [['β⁺', 2.842]], t: 2.602 * YEAR },
  '5,8': { modes: [['β⁺', 17.98]], t: 0.77 },
  '61,145': { modes: [['EC', 0.164]], t: 17.7 * YEAR },
  '85,210': { modes: [['EC', 3.981]], t: 8.1 * 3600 },
  // spontaneous fission
  '103,266': { modes: [['SF', 0]], t: 11 * 3600, fission: true },
};

/** Binding energy (MeV), measured for the lightest nuclei, mass formula otherwise. */
const MEASURED_B = { '1,1': 0, '1,2': 2.2246, '1,3': 8.4818, '2,3': 7.7180, '2,4': 28.2957, '3,6': 31.994, '3,7': 39.244, '4,9': 58.165, '6,12': 92.162, '8,16': 127.62, '0,1': 0 };
export const bindingOf = (Z, A) => MEASURED_B[`${Z},${A}`] ?? bindingEnergy(Z, A).B;

/** Q values (MeV) from binding energies: positive means the decay can happen. */
export function qValues(Z, A) {
  const B = (z, a) => (z < 0 || a < 1 || z > a ? NaN : bindingOf(z, a));
  return {
    alpha: B(Z - 2, A - 4) + B_HE4 - B(Z, A),
    betaMinus: B(Z + 1, A) - B(Z, A) + MN_MINUS_MH,
    ec: B(Z - 1, A) - B(Z, A) - MN_MINUS_MH,
  };
}

/**
 * Decay mode(s) of an isotope: measured where we have data, otherwise predicted from
 * mass-formula Q values ({ predicted: true }). Stable nuclei return modes: [].
 */
export function decayInfo(iso) {
  const known = DECAYS[`${iso.Z},${iso.A}`];
  if (known) return { modes: known.modes.map(([type, Q]) => ({ type, Q })), halfLife: known.t, fission: !!known.fission, predicted: false };
  if (iso.isDefault && iso.stability === 'stable') return { modes: [], halfLife: Infinity, fission: false, predicted: false };
  const q = qValues(iso.Z, iso.A);
  const modes = [];
  if (q.betaMinus > 0.05) modes.push({ type: 'β⁻', Q: q.betaMinus });
  if (q.ec > 1.022 + 0.05) modes.push({ type: 'β⁺', Q: q.ec - 1.022 });
  else if (q.ec > 0.05) modes.push({ type: 'EC', Q: q.ec });
  if (iso.Z >= 84 && q.alpha > 0) modes.unshift({ type: 'α', Q: q.alpha });
  return { modes, halfLife: null, fission: iso.Z >= 90, predicted: true };
}

/**
 * α-decay half-life from Gamow's tunneling model: the α rattles inside the nucleus,
 * hitting the Coulomb barrier ν = v/2R times a second; each time it tunnels through with
 * probability e^{−2G}, G = √(2μc²)/(ħc) · 2Z_d·e²/√Q · [arccos√x − √(x(1−x))], x = R/b,
 * b = 2Z_d·e²/Q (the classical turning point). t½ = ln 2 / (ν e^{−2G}).
 */
export function alphaTunneling(Z, A, Q) {
  const Zd = Z - 2, Ad = A - 4;
  const mu = ((4 * Ad) / (4 + Ad)) * AMU_MEV;
  const R = 1.2 * (Math.cbrt(Ad) + Math.cbrt(4)) + 0.5; // touching radius, fm
  const coul = 2 * Zd * 1.44; // MeV·fm
  const b = coul / Q;
  const x = R / b;
  const G = (Math.sqrt(2 * mu) / 197.327) * (coul / Math.sqrt(Q)) * (Math.acos(Math.sqrt(x)) - Math.sqrt(x * (1 - x)));
  const v = Math.sqrt((2 * (Q + 35)) / mu) * 2.998e23; // fm/s inside the well (≈35 MeV deep)
  const nu = v / (2 * R);
  const P = Math.exp(-2 * G);
  // The α has to form as a cluster first: measured "preformation" probabilities are a few %.
  const preform = 0.03;
  return { R, b, barrier: coul / R, G, P, nu, preform, halfLife: Math.LN2 / (preform * nu * P) };
}

/**
 * Liquid-drop fission barrier (Cohen–Swiatecki fit) from the fissility x = E_c/(2E_s):
 *   x ≤ 2/3: B_f ≈ 0.38(0.75 − x)·E_s;  x > 2/3: B_f ≈ 0.83(1 − x)³·E_s.
 */
export function fissionBarrier(Z, A) {
  const I = (A - 2 * Z) / A;
  const Es = 17.9439 * (1 - 1.7826 * I * I) * A ** (2 / 3);
  const Ec = (0.7053 * Z * Z) / Math.cbrt(A);
  const x = Ec / (2 * Es);
  const Bf = x <= 2 / 3 ? 0.38 * (0.75 - x) * Es : 0.83 * (1 - x) ** 3 * Es;
  return { x, Bf, Es, Ec };
}

/** Typical asymmetric fission split of compound nucleus (Z, A): fragments and prompt neutrons. */
export function fissionSplit(Z, A) {
  const nu = A > 240 ? 3 : 2;
  const Ah = Math.round((A - nu) * 0.585), Al = A - nu - Ah;
  // Both fragments keep the parent's proton-to-nucleon ratio (unchanged charge density).
  const Zh = Math.round((Z * Ah) / (A - nu)), Zl = Z - Zh;
  const Q = bindingOf(Zh, Ah) + bindingOf(Zl, Al) - bindingOf(Z, A);
  return { heavy: { Z: Zh, A: Ah }, light: { Z: Zl, A: Al }, neutrons: nu, Q };
}

/** Pretty half-life: "4.5 billion years", "3.8 days", "0.30 µs". */
export function halfLifeText(t) {
  if (t == null) return 'unknown';
  if (!isFinite(t)) return 'stable';
  const units = [[YEAR * 1e9, 'billion years'], [YEAR * 1e6, 'million years'], [YEAR, 'years'], [DAY, 'days'], [3600, 'hours'], [60, 'minutes'], [1, 'seconds'], [1e-3, 'ms'], [1e-6, 'µs'], [1e-9, 'ns']];
  if (t > YEAR * 1e12) return `${sci(t / YEAR)} years`;
  for (const [s, name] of units) if (t >= s) return `${(t / s).toPrecision(t / s < 10 ? 2 : 3)} ${name}`;
  return `${sci(t)} s`;
}

// ---------- chart of nuclides ----------

// Stable nuclides (mass numbers by Z): about 250, those never observed to decay.
const STABLE_A = {
  1: [1, 2], 2: [3, 4], 3: [6, 7], 4: [9], 5: [10, 11], 6: [12, 13], 7: [14, 15], 8: [16, 17, 18], 9: [19], 10: [20, 21, 22],
  11: [23], 12: [24, 25, 26], 13: [27], 14: [28, 29, 30], 15: [31], 16: [32, 33, 34, 36], 17: [35, 37], 18: [36, 38, 40], 19: [39, 41], 20: [40, 42, 43, 44, 46],
  21: [45], 22: [46, 47, 48, 49, 50], 23: [51], 24: [50, 52, 53, 54], 25: [55], 26: [54, 56, 57, 58], 27: [59], 28: [58, 60, 61, 62, 64], 29: [63, 65], 30: [64, 66, 67, 68, 70],
  31: [69, 71], 32: [70, 72, 73, 74], 33: [75], 34: [74, 76, 77, 78, 80], 35: [79, 81], 36: [80, 82, 83, 84, 86], 37: [85], 38: [84, 86, 87, 88], 39: [89], 40: [90, 91, 92, 94],
  41: [93], 42: [92, 94, 95, 96, 97, 98], 44: [96, 98, 99, 100, 101, 102, 104], 45: [103], 46: [102, 104, 105, 106, 108, 110], 47: [107, 109], 48: [106, 108, 110, 111, 112, 114], 49: [113],
  50: [112, 114, 115, 116, 117, 118, 119, 120, 122, 124], 51: [121, 123], 52: [120, 122, 123, 124, 125, 126], 53: [127], 54: [126, 128, 129, 130, 131, 132, 134], 55: [133],
  56: [132, 134, 135, 136, 137, 138], 57: [139], 58: [136, 138, 140, 142], 59: [141], 60: [142, 143, 145, 146, 148], 62: [144, 149, 150, 152, 154], 63: [153],
  64: [154, 155, 156, 157, 158, 160], 65: [159], 66: [156, 158, 160, 161, 162, 163, 164], 67: [165], 68: [162, 164, 166, 167, 168, 170], 69: [169],
  70: [168, 170, 171, 172, 173, 174, 176], 71: [175], 72: [176, 177, 178, 179, 180], 73: [181], 74: [182, 183, 184, 186], 75: [185], 76: [187, 188, 189, 190, 192],
  77: [191, 193], 78: [192, 194, 195, 196, 198], 79: [197], 80: [196, 198, 199, 200, 201, 202, 204], 81: [203, 205], 82: [204, 206, 207, 208],
};
// Radioactive but so long-lived they survive from before the Earth formed.
const PRIMORDIAL = new Set(['19,40', '20,48', '23,50', '32,76', '34,82', '36,78', '37,87', '40,96', '42,100', '48,113', '48,116', '49,115', '52,128', '52,130',
  '54,124', '54,136', '56,130', '57,138', '60,144', '60,150', '62,147', '62,148', '63,151', '64,152', '71,176', '72,174', '74,180', '75,187', '76,184', '76,186',
  '78,190', '83,209', '90,232', '92,235', '92,238']);

export const isStable = (Z, A) => STABLE_A[Z]?.includes(A) ?? false;

/** A rough line of β stability: the most stable Z for mass number A. */
export const stableZ = (A) => A / (1.98 + 0.0155 * A ** (2 / 3));

/**
 * Classify a nuclide for the chart: { kind, mode, measured } or null if it isn't
 * expected to be bound. kind: 'stable' | 'primordial' | 'radioactive'.
 */
export function classifyNuclide(Z, N) {
  const A = Z + N;
  if (Z < 1 || A < 1) return null;
  const key = `${Z},${A}`;
  if (isStable(Z, A)) return { kind: 'stable', mode: 'stable', measured: true };
  const known = DECAYS[key];
  if (PRIMORDIAL.has(key)) return { kind: 'primordial', mode: known?.modes[0][0] ?? (Z >= 62 && N > 1.4 * Z ? 'α' : 'β⁻'), measured: true, halfLife: known?.t };
  if (known) return { kind: 'radioactive', mode: known.modes[0][0], measured: true, halfLife: known.t };
  // Expected to be bound at all? Light nuclei from the list of known ones; heavier from the mass formula.
  if (Z <= 8) { if (!KNOWN_LIGHT[Z]?.includes(N)) return null; }
  else {
    // Drip lines from two-nucleon separation energies (as mass tables do), which avoids
    // the mass formula's odd–even pairing term chopping the edges into a comb.
    const B = (z, a) => bindingEnergy(z, a).B;
    const s2n = B(Z, A) - B(Z, A - 2), s2p = B(Z, A) - B(Z - 2, A - 2);
    if (!(s2n > 0 && s2p > 0)) return null;
  }
  // Predicted decay mode: β toward the stability line; α or fission for the heaviest.
  const q = qValues(Z, A);
  let mode = Z < stableZ(A) ? 'β⁻' : 'β⁺';
  if (Z >= 84 && q.alpha > 4 && Z >= stableZ(A) - 3) mode = 'α';
  if (Z >= 100 && A >= 256 && Z % 2 === 0 && N % 2 === 0 && fissionBarrier(Z, A).Bf < 2.5) mode = 'SF';
  return { kind: 'radioactive', mode, measured: false };
}
