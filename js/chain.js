// Neutron chain reactions: Monte Carlo neutron transport through a ball of fuel (optionally
// wrapped in a reflector) or through a reactor core (fuel lumps in a moderator, with
// control rods), plus point kinetics with delayed neutrons for running a reactor.
//
// Units: cm, MeV, ns. Cross sections are energy-averaged values from the evaluated
// libraries (ENDF/B), smoothed over resonances and interpolated log–log in energy, except
// ²³⁸U below 4 keV, whose resonances are drawn individually (they're what makes lumping
// the fuel matter).

const V_CM_PER_NS = 1.3832; // neutron speed per √(E/MeV): c·√(2E/mₙc²)
const AVOGADRO_B = 0.60221; // atoms per barn·cm, per (g/cm³)/(g/mol)
export const MEV_J = 1.602177e-13;
export const FISSION_MEV = 200; // recoverable energy per fission
export const TNT_TON_J = 4.184e9;
export const KT_ROOM = 2.53e-8; // MeV: thermal neutrons at 20 °C
export const K_BOLTZMANN = 8.617e-11; // MeV per kelvin
export const E_THERMAL = 6.25e-7; // MeV: below the cadmium cutoff (0.625 eV) a neutron counts as thermal

// Energy grid (MeV): thermal, 1 eV … 20 MeV.
const GRID = [2.53e-8, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.1, 0.5, 1, 1.5, 2, 5, 10, 20];

/** Delayed neutrons: fraction β of all fission neutrons, and six precursor groups (half-life s, share). */
export const DELAYED = {
  U235: { beta: 0.0065, T: [55.7, 22.7, 6.22, 2.30, 0.61, 0.23], a: [0.033, 0.219, 0.196, 0.395, 0.115, 0.042] },
  U238: { beta: 0.0148, T: [52.4, 21.6, 5.0, 1.93, 0.49, 0.17], a: [0.013, 0.137, 0.162, 0.388, 0.225, 0.075] },
  Pu239: { beta: 0.0021, T: [53.8, 22.3, 5.19, 2.09, 0.55, 0.22], a: [0.035, 0.298, 0.211, 0.326, 0.086, 0.044] },
};

/** Nuclides: mass number A, cross sections (barns) on GRID, ν̄(E), Watt fission spectrum. */
export const NUCLIDES = {
  U235: {
    A: 235, label: '²³⁵U', molar: 235.04,
    // Thermal fission falls a little faster than 1/v (Westcott g = 0.976 at 20 °C, ≈0.94 in a hot
    // PWR), and the resonances from 1 eV to 1 keV capture about half as often as they fission.
    f: [585, 75.6, 30, 12, 5, 2.6, 1.65, 1.19, 1.26, 1.29, 1.32, 1.06, 1.75, 2.1],
    c: [99, 13.2, 35, 12, 3.5, 1.0, 0.45, 0.17, 0.11, 0.08, 0.06, 0.03, 0.01, 0.005],
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
    A: 9, label: '⁹Be', molar: 9.012,
    c: [0.0076, 0.0012, 4e-4, 1.2e-4, 4e-5, 1.2e-5, 4e-6, 2e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6],
    el: [6.15, 6.15, 6.15, 6.15, 6.1, 6.0, 5.6, 4.0, 3.2, 2.7, 2.3, 1.4, 1.0, 0.9],
    n2n: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.5, 0.5, 0.4], n2nQ: 1.67,
  },
  // Hydrogen bound in water scatters thermal neutrons about twice as strongly as a free proton.
  H1: {
    A: 1, label: '¹H', molar: 1.008,
    c: [0.332, 0.0531, 0.0168, 0.0053, 0.00168, 5.3e-4, 1.7e-4, 7e-5, 5e-5, 4e-5, 3.5e-5, 3e-5, 3e-5, 3e-5],
    el: [44, 20.4, 20.4, 20.3, 20.2, 19.8, 12.7, 6.2, 4.26, 3.4, 2.9, 1.6, 0.95, 0.48],
  },
  H2: {
    A: 2, label: '²H', molar: 2.014,
    c: [5.2e-4, 8e-5, 2.6e-5, 8e-6, 3e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6],
    el: [4.2, 3.4, 3.4, 3.4, 3.4, 3.4, 3.1, 2.9, 2.6, 2.4, 2.3, 1.6, 1.0, 0.65],
  },
  C12: {
    // Reactor-grade graphite: the capture includes the boron and other impurities (≈4.5 mb).
    A: 12, label: '¹²C', molar: 12.011,
    c: [0.0045, 7e-4, 2.2e-4, 7e-5, 2.2e-5, 7e-6, 2e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6],
    el: [4.74, 4.74, 4.74, 4.74, 4.74, 4.7, 4.5, 3.7, 2.6, 2.2, 1.7, 1.2, 1.2, 1.4],
  },
  O16: {
    A: 16, label: '¹⁶O', molar: 16.0,
    c: [1.9e-4, 3e-5, 1e-5, 3e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-5, 1e-5, 1e-5, 1e-5, 1e-5],
    el: [3.8, 3.8, 3.8, 3.8, 3.8, 3.8, 3.7, 3.5, 3.0, 2.0, 1.7, 1.2, 1.0, 0.9],
  },
  // Control-rod absorber: ¹⁰B swallows thermal neutrons by (n,α) with a 3,840-barn, 1/v cross section.
  B10: {
    A: 10, label: '¹⁰B', molar: 10.013,
    c: [3840, 614, 194, 61, 19.4, 6.1, 1.9, 0.6, 0.4, 0.35, 0.3, 0.2, 0.1, 0.05],
    el: [2.2, 2.2, 2.2, 2.2, 2.2, 2.2, 2.2, 2.0, 1.5, 1.3, 1.2, 1.0, 0.9, 0.8],
  },
  B11: {
    A: 11, label: '¹¹B', molar: 11.009,
    c: [0.005, 8e-4, 2.5e-4, 8e-5, 2.5e-5, 8e-6, 3e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6, 1e-6],
    el: [5.0, 5.0, 5.0, 5.0, 5.0, 4.9, 4.6, 3.0, 2.2, 1.8, 1.6, 1.3, 1.1, 1.0],
  },
  // Power-reactor structure: zirconium alloy for fuel cladding (ZIRLO, Zircaloy), and stainless
  // steel (type 304, as one averaged nucleus: 70% Fe, 19% Cr, 10% Ni) for control-rod cladding.
  Zr: {
    A: 91, label: 'Zr', molar: 91.224,
    c: [0.185, 0.03, 0.03, 0.2, 0.2, 0.05, 0.015, 0.006, 0.005, 0.004, 0.003, 0.002, 0.001, 0.001],
    el: [6.2, 6.3, 6.3, 6.4, 6.5, 7.0, 8.0, 7.0, 5.0, 4.5, 4.2, 3.9, 3.8, 3.8],
    inel: [0, 0, 0, 0, 0, 0, 0, 0, 0.1, 0.4, 0.9, 1.5, 1.0, 0.5],
    n2n: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.4, 1.0], n2nQ: 7.2,
  },
  SS: {
    A: 55, label: 'steel', molar: 55.4,
    c: [2.9, 0.47, 0.15, 0.1, 0.05, 0.05, 0.01, 0.005, 0.004, 0.003, 0.003, 0.002, 0.001, 0.001],
    el: [10.5, 10.5, 10.5, 10.5, 10.5, 9.0, 4.0, 3.5, 3.0, 2.8, 2.7, 2.4, 2.3, 2.2],
    inel: [0, 0, 0, 0, 0, 0, 0, 0.2, 0.5, 1.0, 1.3, 1.4, 1.0, 0.5],
  },
  Si28: {
    A: 28, label: '²⁸Si', molar: 28.086,
    c: [0.17, 0.027, 0.009, 0.003, 0.001, 3e-4, 1e-4, 1e-3, 2e-3, 2e-3, 2e-3, 2e-3, 1e-3, 1e-3],
    el: [2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 3.0, 3.0, 2.5, 2.2, 1.5, 1.2, 1.0],
    inel: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.7, 0.5, 0.3],
  },
  // Silver–indium–cadmium (the absorber in most PWR control rods). Each has a few huge capture
  // resonances below 20 eV, drawn individually (energy, neutron and radiation widths in eV, spin
  // factor g); the tables hold the rest (the 1/v tail of resonances below zero energy, and the
  // smaller resonances above, averaged).
  Ag107: {
    A: 107, label: '¹⁰⁷Ag', molar: 106.905,
    c: [35, 5.6, 1.8, 1.5, 0.8, 0.5, 0.25, 0.1, 0.07, 0.05, 0.04, 0.02, 0.005, 0.002],
    el: [7, 6, 6, 6, 6, 7, 6.5, 5, 4, 4, 3.8, 3.8, 3, 3],
    inel: [0, 0, 0, 0, 0, 0, 0.3, 1.2, 1.7, 2.0, 2.1, 2.2, 1.5, 0.8],
    lines: [{ E: 16.30, gn: 0.0061, gg: 0.13, g: 0.75 }],
  },
  Ag109: {
    A: 109, label: '¹⁰⁹Ag', molar: 108.905,
    c: [1, 0.16, 0.05, 2.0, 1.0, 0.6, 0.3, 0.1, 0.07, 0.05, 0.04, 0.02, 0.005, 0.002],
    el: [5, 5, 5, 6, 6, 7, 6.5, 5, 4, 4, 3.8, 3.8, 3, 3],
    inel: [0, 0, 0, 0, 0, 0, 0.3, 1.2, 1.7, 2.0, 2.1, 2.2, 1.5, 0.8],
    lines: [{ E: 5.19, gn: 0.0127, gg: 0.137, g: 0.75 }],
  },
  In115: {
    A: 115, label: '¹¹⁵In', molar: 114.904,
    c: [1, 0.16, 15, 2.0, 1.0, 0.6, 0.3, 0.15, 0.1, 0.07, 0.05, 0.02, 0.005, 0.002],
    el: [2.5, 2.5, 3, 4, 5, 6, 6.5, 5, 4, 4, 3.8, 3.8, 3, 3],
    inel: [0, 0, 0, 0, 0, 0, 0.3, 1.2, 1.7, 2.0, 2.1, 2.2, 1.5, 0.8],
    lines: [{ E: 1.457, gn: 0.0030, gg: 0.072, g: 0.55 }],
  },
  // Natural cadmium: ¹¹³Cd (12.2% of it) has a resonance at 0.178 eV that makes cadmium nearly
  // black to thermal neutrons and transparent above ~0.5 eV.
  Cd: {
    A: 112, label: 'Cd', molar: 112.41,
    c: [7, 1.1, 0.4, 0.5, 0.3, 0.2, 0.1, 0.06, 0.05, 0.04, 0.03, 0.02, 0.005, 0.002],
    el: [5.5, 5.5, 5.5, 5.5, 6, 6.5, 6.5, 5, 4, 4, 3.8, 3.8, 3, 3],
    inel: [0, 0, 0, 0, 0, 0, 0.3, 1.0, 1.5, 1.8, 2.0, 2.2, 1.5, 0.8],
    lines: [{ E: 0.178, gn: 0.00065, gg: 0.1135, g: 0.75, scale: 0.122 }],
  },
};

// ---------- ²³⁸U resolved resonances ----------
//
// The first fourteen are measured (energy eV, neutron width Γn meV); above 300 eV a ladder is
// drawn from the measured statistics: mean spacing 20.9 eV, s-wave strength function
// 1.0×10⁻⁴, Porter–Thomas widths, Wigner spacings. Radiation width Γγ = 23 meV throughout.
// Each line is Doppler-broadened to room temperature (a pseudo-Voigt profile).
const U238_MEASURED = [
  [6.674, 1.49], [20.87, 10.3], [36.68, 34.1], [66.03, 24.6], [80.75, 1.87], [102.6, 71.7], [116.9, 25.5],
  [145.7, 0.86], [165.3, 3.1], [189.7, 173], [208.5, 51], [237.4, 27.9], [273.7, 25.6], [291.0, 16],
];
const RES_MAX_EV = 4000;
const U238_LINES = (() => {
  const r = rng(238);
  const list = U238_MEASURED.map(([E, gn]) => ({ E, gn: gn / 1000, gg: 0.023 }));
  let E = 300;
  while (E < RES_MAX_EV) {
    E += 20.9 * Math.sqrt(-(4 / Math.PI) * Math.log(r())); // Wigner distribution of spacings
    const g = Math.sqrt(-2 * Math.log(r())) * Math.cos(2 * Math.PI * r()); // Porter–Thomas: Γn ∝ (Gaussian)²
    list.push({ E, gn: 1.0e-4 * 20.9 * Math.sqrt(E) * g * g, gg: 0.023 });
  }
  return list;
})();

/**
 * Resonance lines ready to evaluate at temperature kT (MeV): peak cross section, capture share and
 * a pseudo-Voigt (Thompson–Cox–Hastings) mix of the natural (Lorentzian) and Doppler (Gaussian)
 * shapes. Worked out once per temperature.
 */
const broadenedCache = new Map();
function broadened(lines, A, kT) {
  let byT = broadenedCache.get(lines);
  if (!byT) broadenedCache.set(lines, (byT = new Map()));
  let out = byT.get(kT);
  if (out) return out;
  const kTeV = kT * 1e6;
  out = lines.map((line) => {
    const res = { ...line }, G = res.gn + res.gg;
    res.peak = (2.608e6 / res.E) * ((A + 1) / A) ** 2 * (((res.g ?? 1) * res.gn) / G) * (res.scale ?? 1); // σ₀ = 4πƛ²·g·Γn/Γ
    res.cap = res.gg / G; res.G = G;
    const fG = 2 * Math.sqrt(Math.LN2) * Math.sqrt((4 * res.E * kTeV) / A), fL = G;
    const f = (fG ** 5 + 2.69269 * fG ** 4 * fL + 2.42843 * fG ** 3 * fL ** 2 + 4.47163 * fG ** 2 * fL ** 3 + 0.07842 * fG * fL ** 4 + fL ** 5) ** 0.2;
    const q = fL / f;
    res.f = f; res.eta = 1.36603 * q - 0.47719 * q * q + 0.11116 * q * q * q;
    return res;
  });
  byT.set(kT, out);
  return out;
}

/** One broadened line's cross section at e (eV), before the capture/scatter split. */
function lineShape(res, e) {
  const x = e - res.E, f = res.f;
  const L = (f / (2 * Math.PI)) / (x * x + (f * f) / 4);
  const G = ((2 * Math.sqrt(Math.LN2)) / (f * Math.sqrt(Math.PI))) * Math.exp((-4 * Math.LN2 * x * x) / (f * f));
  return res.peak * ((Math.PI * res.G) / 2) * (res.eta * L + (1 - res.eta) * G);
}

/** Resonance capture and scattering of ²³⁸U at E (MeV), in barns, at temperature kT. */
function u238Resonances(E, kT) {
  const U238_RES = broadened(U238_LINES, 238, kT);
  const e = E * 1e6;
  let lo = 0, hi = U238_RES.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (U238_RES[m].E < e) lo = m; else hi = m; }
  let c = 0, s = 0;
  for (let i = Math.max(0, lo - 6); i <= Math.min(U238_RES.length - 1, hi + 6); i++) {
    const res = U238_RES[i], shape = lineShape(res, e);
    c += shape * res.cap;
    s += shape * (1 - res.cap);
  }
  return { c, s };
}

/**
 * A nuclide's own few resonance lines at E (MeV). Capture grows as 1/v below a line (the neutron
 * width goes as √E), which is what gives ¹¹³Cd its huge thermal cross section.
 */
function lineSigmas(nuc, E, kT) {
  const e = E * 1e6;
  let c = 0, s = 0;
  for (const res of broadened(nuc.lines, nuc.A, kT)) {
    const shape = lineShape(res, e);
    c += shape * res.cap * Math.sqrt(res.E / e);
    s += shape * (1 - res.cap);
  }
  return { c, s };
}

// ---------- materials ----------

/** Uranium metal (enrichment e = ²³⁵U atom fraction) or δ-phase plutonium. */
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

export const MODERATORS = {
  graphite: () => makeMaterial('Graphite', 1.6, [['C12', 1]]),
  water: () => makeMaterial('Water', 1.0, [['H1', 2 / 3], ['O16', 1 / 3]]),
  heavy: () => makeMaterial('Heavy water', 1.105, [['H2', 2 / 3], ['O16', 1 / 3]]),
};

/** Boron carbide, B₄C, with natural boron (19.9% ¹⁰B). */
const rodMaterial = () => makeMaterial('Boron carbide', 2.52, [['B10', 0.8 * 0.199], ['B11', 0.8 * 0.801], ['C12', 0.2]]);

function pctText(e) { return e >= 0.1 ? `${(100 * e).toFixed(e > 0.995 ? 0 : 1)}%` : `${(100 * e).toFixed(2)}%`; }

/** A material: density (g/cm³) and atom fractions; atom densities in atoms per barn·cm. */
function makeMaterial(name, density, parts) {
  const molar = parts.reduce((s, [k, x]) => s + x * NUCLIDES[k].molar, 0);
  const n = (density / molar) * AVOGADRO_B;
  return { name, density, parts: parts.filter(([, x]) => x > 0).map(([k, x]) => ({ key: k, nuc: NUCLIDES[k], N: n * x })) };
}

/** Two materials blended by volume: fraction v of a, the rest b. */
function blend(name, a, v, b) {
  const parts = new Map();
  for (const p of a.parts) parts.set(p.key, { ...p, N: p.N * v });
  for (const p of b.parts) {
    const q = parts.get(p.key);
    if (q) q.N += p.N * (1 - v); else parts.set(p.key, { ...p, N: p.N * (1 - v) });
  }
  return { name, density: a.density * v + b.density * (1 - v), parts: [...parts.values()] };
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
export function sigmas(nuc, E, kT = KT_ROOM) {
  const thermal = E <= GRID[0];
  const s = {
    f: interp(nuc.f, E), c: interp(nuc.c, E),
    el: thermal ? nuc.el[0] : interp(nuc.el, E),
    inel: thermal ? 0 : interp(nuc.inel, E),
    n2n: E > (nuc.n2nQ ?? Infinity) ? interp(nuc.n2n, E) : 0,
  };
  if (nuc === NUCLIDES.U238 && E > 1e-6 && E < RES_MAX_EV * 1e-6) {
    // Resolved range: a 1/v background (the bound levels' tail) plus the resonances, and
    // 9 b of potential scattering.
    const res = u238Resonances(E, kT);
    s.c = 2.68 * Math.sqrt(KT_ROOM / E) + res.c;
    s.el = 9.0 + res.s;
  }
  if (nuc.lines && E < 1e-3) {
    const res = lineSigmas(nuc, E, kT);
    s.c += res.c;
    s.el += res.s;
  }
  return s;
}

/** Macroscopic cross sections of a material at E: total Σ (1/cm) and per-nuclide parts. */
function macro(mat, E) {
  if (mat.cacheE === E) return mat.cache;
  let tot = 0;
  const parts = mat.parts.map((p) => {
    const s = sigmas(p.nuc, E, mat.kT);
    const t = p.N * (s.f + s.c + s.el + s.inel + s.n2n);
    tot += t;
    return { p, s, t };
  });
  mat.cacheE = E;
  mat.cache = { tot, parts };
  return mat.cache;
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

/** Maxwellian at temperature kT (room temperature unless the material is hotter), for neutrons that have slowed to thermal. */
function sampleThermal(r, kT = KT_ROOM) {
  const c = Math.cos((Math.PI / 2) * r());
  return kT * (-Math.log(r()) - Math.log(r()) * c * c);
}

// ---------- geometry ----------
//
// A system gives regionAt(p) → index into mats (or −1 outside) and boundary(p, d, region, cap),
// the distance to the next surface. Neutrons fly straight between surfaces and collisions.

const OUT = -1;

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function add(p, d, s) { return [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s]; }

/**
 * A ball: fuel radius R (cm) and an optional reflector shell of thickness T.
 * Regions: 0 = fuel, 1 = reflector.
 */
export function makeSystem(cfg) {
  if (cfg.kind === 'reactor') return PWR_DESIGNS[cfg.design] ? makePinCore(cfg) : makeReactor(cfg);
  const { fuel, enrichment, R, reflector = 'none', T = 0 } = cfg;
  const fuelMat = fuelMaterial(fuel, enrichment);
  const refMat = reflector !== 'none' && T > 0 ? REFLECTORS[reflector]() : null;
  const R2 = refMat ? R + T : R;
  const vol = (4 / 3) * Math.PI * R ** 3;
  return {
    kind: 'ball', fuel, enrichment, R, R2, reflector: refMat ? reflector : 'none', T: refMat ? T : 0,
    mats: [fuelMat, refMat], fuelMat, refMat,
    mass: fuelMat.density * vol / 1000, // kg
    refMass: refMat ? refMat.density * (4 / 3) * Math.PI * (R2 ** 3 - R ** 3) / 1000 : 0,
    fissileAtoms: fissile(fuelMat) * 1e24 * vol,
    regionAt(p) {
      const r2 = dot(p, p);
      return r2 < R * R ? 0 : refMat && r2 < R2 * R2 ? 1 : OUT;
    },
    boundary(p, d, region) {
      const b = dot(p, d), c = dot(p, p);
      if (region === 0) return -b + Math.sqrt(Math.max(0, b * b - c + R * R));
      const disc = b * b - c + R * R;
      if (b < 0 && disc > 0) return -b - Math.sqrt(disc);
      return -b + Math.sqrt(Math.max(0, b * b - c + R2 * R2));
    },
    sourcePoint(r) { return uniformInBall(R, r); },
  };
}

function fissile(mat) { return mat.parts.filter((p) => p.key === 'U235' || p.key === 'Pu239').reduce((s, p) => s + p.N, 0); }

function uniformInBall(R, r) {
  const u = Math.cbrt(r()) * R, d = isotropic(r);
  return [d[0] * u, d[1] * u, d[2] * u];
}

/**
 * A reactor core: a sphere of radius R (cm) holding a cubic lattice of uranium-metal lumps
 * (radius a, spacing pitch) in a moderator, or the same amounts mixed evenly; and nine
 * boron-carbide control rods (one central, eight in a ring) inserted from the top by
 * `rods` (0 = out, 1 = fully in). `infinite` drops the outer surface and the rods, for the
 * lattice's own k∞ and migration length.
 *
 * Regions: 0 = fuel lump (or the even mix), 1 = moderator, 2 = control rod.
 */
function makeReactor({ enrichment, moderator = 'graphite', lumps = true, a = 3, pitch = 21, R = 300, rods = 0, infinite = false }) {
  const fuelMat = fuelMaterial('U', enrichment), modMat = MODERATORS[moderator]();
  a = Math.min(a, 0.48 * pitch);
  const v = ((4 / 3) * Math.PI * a ** 3) / pitch ** 3; // fuel volume fraction
  const mixMat = lumps ? null : blend(`${fuelMat.name} mixed into ${modMat.name.toLowerCase()}`, fuelMat, v, modMat);
  const rodR = infinite ? 0 : Math.min(15, Math.max(0.8, 0.06 * R));
  const rodXY = infinite ? [] : [[0, 0], ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => [0.45 * R * Math.cos((i * Math.PI) / 4), 0.45 * R * Math.sin((i * Math.PI) / 4)])];
  let zb = R - 2 * R * rods; // rod tips
  const R2 = infinite ? Infinity : R;
  // A lump sits in every cell whose lump fits wholly inside the core and clear of the rod channels.
  const lumpFits = (i, j, k) => {
    const cx = (i + 0.5) * pitch, cy = (j + 0.5) * pitch, cz = (k + 0.5) * pitch;
    if (Math.sqrt(cx * cx + cy * cy + cz * cz) + a > R) return false;
    for (const [x, y] of rodXY) if ((cx - x) ** 2 + (cy - y) ** 2 < (rodR + a) ** 2) return false;
    return true;
  };
  // Looked up from a table of the cells, worked out once (every lattice cell holds one when infinite).
  const half = infinite ? 0 : Math.ceil(R / pitch), side = 2 * half;
  let lumpAt = lumpFits;
  if (infinite) lumpAt = () => true;
  else if (side ** 3 <= 8e6) {
    const table = new Uint8Array(side ** 3);
    for (let i = -half; i < half; i++) for (let j = -half; j < half; j++) for (let k = -half; k < half; k++) {
      table[((i + half) * side + j + half) * side + k + half] = lumpFits(i, j, k) ? 1 : 0;
    }
    lumpAt = (i, j, k) => i >= -half && i < half && j >= -half && j < half && k >= -half && k < half
      && table[((i + half) * side + j + half) * side + k + half] === 1;
  }
  const inRod = (p) => {
    if (p[2] <= zb) return false;
    for (const [x, y] of rodXY) if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < rodR * rodR) return true;
    return false;
  };
  const sys = {
    kind: 'reactor', fuel: 'U', enrichment, moderator, lumps, a, pitch, R, R2, rods, infinite, rodR, rodXY, zb, v,
    mats: [lumps ? fuelMat : mixMat, modMat, rodMaterial()], fuelMat, modMat, refMat: null,
    /** Move the rods (0 = out, 1 = in) without rebuilding the core. */
    setRods(x) { sys.rods = x; zb = sys.zb = R - 2 * R * x; },
    regionAt(p) {
      if (!infinite && dot(p, p) >= R * R) return OUT;
      if (inRod(p)) return 2;
      if (!lumps) return 0;
      const i = Math.floor(p[0] / pitch), j = Math.floor(p[1] / pitch), k = Math.floor(p[2] / pitch);
      if (!lumpAt(i, j, k)) return 1;
      const dx = p[0] - (i + 0.5) * pitch, dy = p[1] - (j + 0.5) * pitch, dz = p[2] - (k + 0.5) * pitch;
      return dx * dx + dy * dy + dz * dz < a * a ? 0 : 1;
    },
    /**
     * Distance to the next surface, or `cap` if none is nearer (the neutron collides first, so
     * surfaces beyond it needn't be found). The lattice cell comes first: it's close, and it
     * lets most rods be ruled out at a glance.
     */
    boundary(p, d, region, cap = Infinity) {
      let t = cap;
      if (!infinite) { const b = dot(p, d), c = dot(p, p) - R * R; t = Math.min(t, -b + Math.sqrt(Math.max(0, b * b - c))); }
      if (lumps && region !== 2) {
        const i = Math.floor(p[0] / pitch), j = Math.floor(p[1] / pitch), k = Math.floor(p[2] / pitch);
        const qx = p[0] - (i + 0.5) * pitch, qy = p[1] - (j + 0.5) * pitch, qz = p[2] - (k + 0.5) * pitch;
        const b = qx * d[0] + qy * d[1] + qz * d[2], c = qx * qx + qy * qy + qz * qz - a * a;
        if (region === 0) t = Math.min(t, -b + Math.sqrt(Math.max(0, b * b - c)));
        else {
          if (b < 0 && b * b - c > 0 && lumpAt(i, j, k)) t = Math.min(t, -b - Math.sqrt(b * b - c));
          // Leaving this lattice cell.
          if (d[0] > 0) t = Math.min(t, ((i + 1) * pitch - p[0]) / d[0]); else if (d[0] < 0) t = Math.min(t, (i * pitch - p[0]) / d[0]);
          if (d[1] > 0) t = Math.min(t, ((j + 1) * pitch - p[1]) / d[1]); else if (d[1] < 0) t = Math.min(t, (j * pitch - p[1]) / d[1]);
          if (d[2] > 0) t = Math.min(t, ((k + 1) * pitch - p[2]) / d[2]); else if (d[2] < 0) t = Math.min(t, (k * pitch - p[2]) / d[2]);
        }
      }
      // Rods: their side walls (above the tip) and the tip's flat end. A rod further off
      // sideways than t + its radius can't be reached within t.
      if (p[2] + Math.abs(d[2]) * t <= zb && region !== 2) return t; // below every rod tip all the way
      const a2 = d[0] * d[0] + d[1] * d[1];
      for (let n = 0; n < rodXY.length; n++) {
        const px = p[0] - rodXY[n][0], py = p[1] - rodXY[n][1], reach = rodR + t;
        if (px * px + py * py > reach * reach) continue;
        if (a2 > 1e-12) {
          const b2 = px * d[0] + py * d[1], disc = b2 * b2 - a2 * (px * px + py * py - rodR * rodR);
          if (disc > 0) {
            const sq = Math.sqrt(disc), t1 = (-b2 - sq) / a2, t2 = (-b2 + sq) / a2;
            if (t1 > 1e-9 && t1 < t && p[2] + d[2] * t1 > zb) t = t1;
            if (t2 > 1e-9 && t2 < t && p[2] + d[2] * t2 > zb) t = t2;
          }
        }
        if (d[2] !== 0) {
          const tt = (zb - p[2]) / d[2];
          if (tt > 1e-9 && tt < t && (px + d[0] * tt) ** 2 + (py + d[1] * tt) ** 2 < rodR * rodR) t = tt;
        }
      }
      return t;
    },
    /** A fission site drawn from the fundamental mode sin(πr/R)/r, in fuel. */
    sourcePoint(r) {
      for (;;) {
        let x;
        if (infinite) x = uniformInBall(3 * pitch, r);
        else {
          let u;
          do u = r(); while (r() * 0.59 > u * Math.sin(Math.PI * u));
          const dd = isotropic(r);
          x = [dd[0] * u * R, dd[1] * u * R, dd[2] * u * R];
        }
        if (!lumps) { if (sys.regionAt(x) === 0) return x; continue; }
        const i = Math.floor(x[0] / pitch), j = Math.floor(x[1] / pitch), k = Math.floor(x[2] / pitch);
        if (!lumpAt(i, j, k)) continue;
        const o = uniformInBall(a * 0.999, r);
        return [(i + 0.5) * pitch + o[0], (j + 0.5) * pitch + o[1], (k + 0.5) * pitch + o[2]];
      }
    },
    /** Centers of every fuel lump (for drawing). */
    lumpCenters() {
      const n = Math.ceil(R / pitch), out = [];
      for (let i = -n; i < n; i++) for (let j = -n; j < n; j++) for (let k = -n; k < n; k++) {
        if (lumpAt(i, j, k)) out.push((i + 0.5) * pitch, (j + 0.5) * pitch, (k + 0.5) * pitch);
      }
      return new Float32Array(out);
    },
  };
  if (!infinite) {
    const lumpCount = lumps ? sys.lumpCenters().length / 3 : 0;
    const fuelVol = lumps ? lumpCount * (4 / 3) * Math.PI * a ** 3 : v * (4 / 3) * Math.PI * R ** 3;
    sys.lumpCount = lumpCount;
    sys.mass = (fuelMat.density * fuelVol) / 1000;
    sys.modMass = (modMat.density * ((4 / 3) * Math.PI * R ** 3 - fuelVol)) / 1000;
    sys.fissileAtoms = fissile(fuelMat) * 1e24 * fuelVol;
  }
  return sys;
}

// ---------- a pressurized-water reactor, rod by rod: the AP1000 ----------
//
// Westinghouse AP1000, from its Design Control Document (Rev. 19, Tables 4.1-1, 4.3-1 and 4.3-2):
// 157 fuel assemblies, each a 17 × 17 array of 264 UO₂ fuel rods in zirconium-alloy cladding,
// 24 guide tubes and a central instrument tube; 14 ft of active fuel; three enrichments in the
// first core (2.35%, 3.40% and 4.45%), the two lower in a checkerboard in the middle and the
// highest round the edge. Reactivity is held down by boron dissolved in the water, by burnable
// absorbers (1,558 borosilicate-glass rods in guide tubes and 8,832 fuel rods with a thin boride
// coating, "IFBA") and by 69 rod clusters: 53 "black" ones of 24 silver–indium–cadmium rodlets
// and 16 "gray" ones (12 thin Ag–In–Cd and 12 steel rodlets) for load following.

export const AP1000 = {
  assemblies: 157, assemblyPitch: 21.5, n: 17, H: 426.72, // 168 in of active fuel
  pelletR: 0.4096, cladIR: 0.418, cladOR: 0.475, // 0.3225 in pellets in 0.374 in rods, 0.0225 in clad
  guideIR: 0.561, guideOR: 0.602,
  enrich: [0.0235, 0.034, 0.0445], // weight fraction of ²³⁵U, regions 1–3 of the first core
  fuelDensity: 10.37, // 95.5% of theoretical, less the pellet dishes and chamfers
  aicR: 0.433, rodCladR: 0.484, grayR: 0.203, grayCladR: 0.250, // 0.341 in and 0.160 in absorber
  equivalentR: 152.0, barrelR: 169.9, reflector: 25, // core barrel ID 133.75 in; water above and below
  pyrexLength: 368.3, ifbaLength: 386.1, // absorber lengths, 145 in and 152 in
  rodSpeed: 1.905, // cm/s: rods move at most 45 in per minute
  hot: { T: 565, water: 0.743 }, // hot zero power: 557 °F, 2250 psia
  cold: { T: 293, water: 0.998 }, // 68 °F, 1 atm
  // Published first-core values to compare with:
  betaEff: 0.0075, lifetime: 19.8e-6, criticalBoronHot: 1382, criticalBoronCold099: 1574, allRodsWorth: 0.1269,
};

// Guide-tube positions in a 17 × 17 Westinghouse assembly (row, column), in groups of four
// placed symmetrically, so the first 4, 8, 12 … make a symmetric set of burnable-absorber rods.
const GUIDE_TUBES = [[3, 3], [3, 13], [13, 3], [13, 13], [2, 8], [8, 2], [8, 14], [14, 8], [5, 5], [5, 11], [11, 5], [11, 11],
  [2, 5], [2, 11], [14, 5], [14, 11], [5, 2], [11, 2], [5, 14], [11, 14], [5, 8], [8, 5], [8, 11], [11, 8]];

/**
 * The first core's layout: the 157 assembly positions (i, j from the centre), each with its
 * enrichment region (0–2), rod cluster (0 none, 1 black, 2 gray) and burnable absorbers.
 * The map, the enrichment zoning and the 69 cluster sites follow the published description;
 * which assemblies hold which burnable absorbers is a symmetric estimate that matches the
 * published totals.
 */
export function ap1000Layout() {
  const inMap = (i, j) => Math.hypot(i, j) <= 7 || (Math.abs(i) === 7 && Math.abs(j) === 1) || (Math.abs(j) === 7 && Math.abs(i) === 1);
  const list = [];
  for (let i = -7; i <= 7; i++) for (let j = -7; j <= 7; j++) if (inMap(i, j)) list.push({ i, j });
  const edge = (i, j) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !inMap(i + a, j + b));
  const nearEdge = (i, j) => [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([a, b]) => inMap(i + a, j + b) && edge(i + a, j + b));
  for (const a of list) {
    const { i, j } = a, odd = Math.abs(i + j) % 2 === 1;
    a.region = edge(i, j) || (nearEdge(i, j) && odd) ? 2 : odd ? 1 : 0;
    // Clusters sit on every other assembly diagonally, except the outermost tips.
    a.control = Math.abs(i % 2) === Math.abs(j % 2) && Math.abs(i) < 7 && Math.abs(j) < 7 ? 1 : 0;
    const ai = Math.abs(i), aj = Math.abs(j);
    if (a.control && ((ai === 2 && aj === 4) || (ai === 4 && aj === 2) || (ai === 1 && aj === 5) || (ai === 5 && aj === 1))) a.control = 2;
    // Burnable absorbers in the more reactive assemblies (glass rods only where no cluster is).
    const outer = edge(i, j);
    a.pyrex = a.control ? 0 : a.region === 1 ? 24 : outer ? 12 : 16;
    a.ifba = a.region === 1 ? 128 : a.region === 2 ? (outer ? 64 : 80) : 0;
  }
  return list;
}

// TVA's Sequoyah Nuclear Plant, on Chickamauga Lake north of Chattanooga: two Westinghouse
// four-loop PWRs (Units 1 and 2, 1981 and 1982), 3,455 MWt each. 193 assemblies of standard
// 17 × 17 fuel, 12 ft of active fuel, a steel baffle round the core, and 53 rod clusters of
// silver–indium–cadmium (80/15/5, 142 in of absorber) in four control banks (A–D) and four
// shutdown banks (SA–SD), at the positions TVA gave the NRC in 2019. Sequoyah now burns mixed,
// part-used fuel; this is a fresh first core, and its loading (three enrichments, borosilicate
// "Pyrex" absorber rods) is that of its identical twin Watts Bar Unit 1, whose first core and
// startup measurements ORNL published as the VERA benchmark.
export const SEQUOYAH = {
  assemblies: 193, assemblyPitch: 21.5, n: 17, H: 365.76, // 144 in of active fuel
  pelletR: 0.4096, cladIR: 0.418, cladOR: 0.475, guideIR: 0.561, guideOR: 0.602,
  enrich: [0.0211, 0.02619, 0.031], fuelDensity: 10.257,
  aicR: 0.433, rodCladR: 0.484, grayR: 0.203, grayCladR: 0.250,
  equivalentR: 168.5, barrelR: 187.96, reflector: 25, baffle: true, // 132.7 in core, 148 in barrel ID
  pyrexLength: 360, ifbaLength: 0, rodSpeed: 1.905, // 72 steps of 5/8 in a minute
  hot: { T: 565, water: 0.743 }, cold: { T: 293, water: 0.998 },
  // Measured at Watts Bar 1's first startup (hot zero power):
  criticalBoronHot: 1291, boronWorth: 10.77, bankDWorth: 1342, allBanksSum: 6467,
};

// Sequoyah's rod clusters by core row (1–15) and column (R … A), from TVA's 2019 map.
const SEQUOYAH_RODS = {
  2: { M: 'SA', K: 'B', H: 'C', F: 'B' }, 3: { L: 'SD', J: 'SB', G: 'SB', E: 'SC' },
  4: { M: 'D', H: 'D', D: 'D', B: 'SA' }, 5: { N: 'SC', L: 'SA', E: 'SA', C: 'SD' },
  6: { P: 'B', K: 'C', H: 'A', F: 'C', B: 'B' }, 7: { N: 'SB', C: 'SB' },
  8: { P: 'C', M: 'D', K: 'A', H: 'D', F: 'A', D: 'D', B: 'C' }, 9: { N: 'SB', C: 'SB' },
  10: { P: 'B', K: 'C', H: 'A', F: 'C', B: 'B' }, 11: { N: 'SD', L: 'SA', E: 'SA', C: 'SC' },
  12: { P: 'SA', M: 'D', H: 'D', D: 'D' }, 13: { L: 'SC', J: 'SB', G: 'SB', E: 'SD' },
  14: { K: 'B', H: 'C', F: 'B', D: 'SA' },
};
// Watts Bar 1, first core, one quarter from the centre out: [enrichment region, Pyrex rods].
const WBN1_QUARTER = [
  [[0, 0], [1, 20], [0, 0], [1, 20], [0, 0], [1, 20], [0, 0], [2, 12]],
  [[1, 20], [0, 0], [1, 24], [0, 0], [1, 20], [0, 0], [2, 24], [2, 0]],
  [[0, 0], [1, 24], [0, 0], [1, 20], [0, 0], [1, 16], [0, 0], [2, 8]],
  [[1, 20], [0, 0], [1, 20], [0, 0], [1, 20], [0, 0], [2, 16], [2, 0]],
  [[0, 0], [1, 20], [0, 0], [1, 20], [1, 0], [1, 24], [2, 0]],
  [[1, 20], [0, 0], [1, 16], [0, 0], [1, 24], [2, 12], [2, 0]],
  [[0, 0], [2, 24], [0, 0], [2, 16], [2, 0], [2, 0]],
  [[2, 12], [2, 0], [2, 8], [2, 0]],
];

/** Sequoyah's 193 positions, with Watts Bar 1's first-core loading and Sequoyah's rod banks. */
export function sequoyahLayout() {
  const COLS = 'RPNMLKJHGFEDCBA', list = [];
  for (let j = -7; j <= 7; j++) for (let i = -7; i <= 7; i++) {
    const q = WBN1_QUARTER[Math.abs(j)]?.[Math.abs(i)];
    if (!q) continue;
    const bank = SEQUOYAH_RODS[j + 8]?.[COLS[i + 7]] ?? null;
    list.push({ i, j, region: q[0], pyrex: q[1], ifba: 0, control: bank ? 1 : 0, bank });
  }
  return list;
}

const PWR_DESIGNS = { ap1000: { ...AP1000, layout: ap1000Layout }, sequoyah: { ...SEQUOYAH, layout: sequoyahLayout } };

const CELL = { WATER: 0, FUEL: 1, IFBA: 2, GUIDE: 3, BLACK: 4, GRAY_AIC: 5, GRAY_SS: 6, PYREX: 7, INSTRUMENT: 8, BAFFLE: 9 };
const PIN_REG = { FUEL0: 0, WATER: 1, AIC: 2, ZR: 3, GAP: 4, FUEL1: 5, FUEL2: 6, SS: 7, GLASS: 8, IFBA: 9, BAFFLE: 10 };
const FUEL_REGIONS = [PIN_REG.FUEL0, PIN_REG.FUEL1, PIN_REG.FUEL2];

/** A material from atom densities (atoms per barn·cm). */
function atomMaterial(name, density, parts) {
  return { name, density, parts: parts.filter(([, N]) => N > 0).map(([key, N]) => ({ key, nuc: NUCLIDES[key], N })) };
}

/** Uranium dioxide with a weight fraction w of ²³⁵U. */
function uo2(w, density) {
  const a = w / 235.04 / (w / 235.04 + (1 - w) / 238.05);
  return makeMaterial(`UO₂ (${pctText(w)} ²³⁵U)`, density, [['U235', a / 3], ['U238', (1 - a) / 3], ['O16', 2 / 3]]);
}

/** Water with ppm (by weight) of natural boron dissolved in it, as boric acid. */
function boratedWater(density, ppm) {
  const w = ppm * 1e-6, nW = ((density * (1 - w)) / 18.015) * AVOGADRO_B, nB = ((density * w) / 10.811) * AVOGADRO_B;
  return atomMaterial(ppm > 0 ? `Water with ${Math.round(ppm)} ppm boron` : 'Water', density, [['H1', 2 * nW], ['O16', nW], ['B10', 0.199 * nB], ['B11', 0.801 * nB]]);
}

/** 80% silver, 15% indium, 5% cadmium by weight. */
function agInCd() {
  const rho = 10.16, n = (w, M) => ((rho * w) / M) * AVOGADRO_B;
  return atomMaterial('Silver–indium–cadmium', rho, [['Ag107', 0.5184 * n(0.8, 107.87)], ['Ag109', 0.4816 * n(0.8, 107.87)], ['In115', n(0.15, 114.82)], ['Cd', n(0.05, 112.41)]]);
}

function besselJ0(x) {
  let s = 0, term = 1;
  for (let k = 0; k < 14; k++) { if (k) term *= -(x * x) / 4 / (k * k); s += term; }
  return s;
}

/**
 * A PWR core (the AP1000 or Sequoyah), every rod in it: fuel rods (pellet, helium gap, cladding), guide tubes with
 * control rodlets or burnable-absorber rods, all in borated water, inside the core barrel with
 * water above and below the fuel. Options: boron (ppm), hot (hot zero power, else cold), absorbers
 * (the first core's burnable absorbers), rods (0 out … 1 in; all 69 clusters move together).
 * `infinite` gives one kind of assembly repeated forever (lattice: 'assembly', the default, at
 * enrichment index 1) or one fuel rod repeated (lattice: 'pin'); `insert: 'black'` puts a black
 * rodlet in every guide tube (as in the VERA benchmark's rodded assembly).
 */
function makePinCore(cfg) {
  const A = PWR_DESIGNS[cfg.design], { boron = A.criticalBoronHot, hot = true, absorbers = true, infinite = false, lattice = 'assembly', insert = null, banks = null } = cfg;
  const state = hot ? A.hot : A.cold, kT = K_BOLTZMANN * (cfg.T ?? state.T);
  const enrich = cfg.enrich ?? A.enrich;
  const fuels = enrich.map((w) => uo2(w, cfg.fuelDensity ?? A.fuelDensity));
  const water = boratedWater(cfg.waterDensity ?? state.water, boron);
  const zr = makeMaterial('Zirconium alloy', 6.55, [['Zr', 1]]);
  const gap = { name: 'Helium gap', density: 0, parts: [] };
  const ss = makeMaterial('Stainless steel', 8.0, [['SS', 1]]);
  const glass = atomMaterial('Borosilicate glass', 2.25, [['B10', 9.62e-4], ['B11', 3.87e-3], ['Si28', 0.01975], ['O16', 0.04675]]);
  const ifba = atomMaterial('Boride coating', 3.85, [['B10', 0.01802], ['Zr', 0.009]]);
  // The baffle: steel plates 2.22 cm thick round the core, here filling the two rod cells outside it.
  const baffle = makeMaterial('Stainless steel baffle', (8.0 * 2.22) / (2 * (A.assemblyPitch / A.n)), [['SS', 1]]);
  const mats = [fuels[0], water, agInCd(), zr, gap, fuels[1] ?? fuels[0], fuels[2] ?? fuels[0], ss, glass, ifba, baffle];
  for (const m of mats) m.kT = kT;
  const FUEL_OF = [PIN_REG.FUEL0, PIN_REG.FUEL1, PIN_REG.FUEL2];

  // Rings round each cell's centre, inside out: [radius², region]; water beyond.
  const ring = (list) => list.map(([r, reg]) => [r * r, reg]);
  const fuelRings = FUEL_OF.map((f) => ring([[A.pelletR, f], [A.cladIR, PIN_REG.GAP], [A.cladOR, PIN_REG.ZR]]));
  const ifbaRings = FUEL_OF.map((f) => ring([[A.pelletR, f], [A.pelletR + 0.001, PIN_REG.IFBA], [A.cladIR, PIN_REG.GAP], [A.cladOR, PIN_REG.ZR]]));
  const tube = [[A.guideIR, PIN_REG.WATER], [A.guideOR, PIN_REG.ZR]];
  const emptyTube = ring(tube);
  const blackRings = ring([[A.aicR, PIN_REG.AIC], [A.rodCladR, PIN_REG.SS], ...tube]);
  const grayAicRings = ring([[A.grayR, PIN_REG.AIC], [A.grayCladR, PIN_REG.SS], ...tube]);
  const graySsRings = ring([[A.grayCladR, PIN_REG.SS], ...tube]);
  const pyrexRings = ring([[0.214, PIN_REG.GAP], [0.231, PIN_REG.SS], [0.241, PIN_REG.GAP], [0.427, PIN_REG.GLASS], [0.437, PIN_REG.GAP], [0.484, PIN_REG.SS], ...tube]);
  const H2 = A.H / 2, Z2 = H2 + A.reflector, Rb = A.barrelR;
  let zb = H2 - A.H * (cfg.rods ?? 0);
  const rodded = (kind) => kind === CELL.BLACK || kind === CELL.GRAY_AIC || kind === CELL.GRAY_SS;
  /** The rings of a cell of this kind at height z. */
  const rings = (kind, fr, z) => {
    switch (kind) {
      case CELL.FUEL: return fuelRings[fr];
      case CELL.IFBA: return infinite || Math.abs(z) < A.ifbaLength / 2 ? ifbaRings[fr] : fuelRings[fr];
      case CELL.BLACK: return infinite || z > zb ? blackRings : emptyTube;
      case CELL.GRAY_AIC: return z > zb ? grayAicRings : emptyTube;
      case CELL.GRAY_SS: return z > zb ? graySsRings : emptyTube;
      case CELL.PYREX: return infinite || Math.abs(z) < A.pyrexLength / 2 ? pyrexRings : emptyTube;
      default: return emptyTube;
    }
  };
  /** Planes across a cell of this kind where its rings change. */
  const zPlanes = (kind) => (rodded(kind) ? [zb] : kind === CELL.IFBA ? [-A.ifbaLength / 2, A.ifbaLength / 2] : kind === CELL.PYREX ? [-A.pyrexLength / 2, A.pyrexLength / 2] : []);

  // The cell grid: P cm square cells, NX across. One kind and fuel region per cell.
  const n = A.n;
  const P = infinite && lattice === 'pin' ? (cfg.pinPitch ?? 1.26) : A.assemblyPitch / n; // the inter-assembly gap shared out among the cells
  const PAD = infinite ? 0 : 2; // rod cells round the 15 × 15 assemblies, for the baffle
  const NX = infinite ? (lattice === 'pin' ? 1 : n) : 15 * n + 2 * PAD;
  const kindT = new Uint8Array(NX * NX), fuelT = new Uint8Array(NX * NX);
  const assemblyKinds = (a) => {
    const k = new Uint8Array(n * n).fill(CELL.FUEL);
    k[8 * n + 8] = CELL.INSTRUMENT;
    GUIDE_TUBES.forEach(([gi, gj], t) => {
      let kind = CELL.GUIDE;
      if (a.control === 1 && (!banks || !a.bank || banks.includes(a.bank))) kind = CELL.BLACK;
      else if (a.control === 2) kind = t % 2 ? CELL.GRAY_SS : CELL.GRAY_AIC;
      else if (absorbers && t < a.pyrex) kind = CELL.PYREX;
      k[gi * n + gj] = kind;
    });
    // IFBA rods: an even spread over the fuel rods (every so many, row by row).
    if (absorbers && a.ifba) {
      const fuelIdx = [];
      for (let q = 0; q < n * n; q++) if (k[q] === CELL.FUEL) fuelIdx.push(q);
      for (let m = 0; m < a.ifba; m++) k[fuelIdx[Math.floor(((m + 0.5) * fuelIdx.length) / a.ifba)]] = CELL.IFBA;
    }
    return k;
  };
  let layout = null;
  if (infinite && lattice === 'pin') { kindT[0] = CELL.FUEL; fuelT[0] = 0; }
  else if (infinite) {
    const k = assemblyKinds({ control: insert === 'black' ? 1 : 0, pyrex: 0, ifba: 0 });
    kindT.set(k);
    fuelT.fill(cfg.enrich ? 0 : 1);
  } else {
    layout = A.layout();
    for (const a of layout) {
      const k = assemblyKinds(a), I = a.i + 7, J = a.j + 7;
      for (let li = 0; li < n; li++) for (let lj = 0; lj < n; lj++) {
        const q = (PAD + I * n + li) * NX + PAD + J * n + lj;
        kindT[q] = k[li * n + lj];
        fuelT[q] = a.region;
      }
    }
    if (A.baffle) {
      // Steel in every water cell within two cells of an assembly.
      const near = (gx, gy) => {
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
          const x = gx + dx, y = gy + dy;
          if (x >= 0 && y >= 0 && x < NX && y < NX && kindT[x * NX + y] !== CELL.WATER && kindT[x * NX + y] !== CELL.BAFFLE) return true;
        }
        return false;
      };
      for (let gx = 0; gx < NX; gx++) for (let gy = 0; gy < NX; gy++) if (kindT[gx * NX + gy] === CELL.WATER && near(gx, gy)) kindT[gx * NX + gy] = CELL.BAFFLE;
    }
  }
  const W = (NX * P) / 2; // half-width of the grid
  /** The cell holding (x, y): its index (or −1 outside the grid) and centre. */
  const cellOf = (x, y) => {
    let gx = Math.floor(x / P + NX / 2), gy = Math.floor(y / P + NX / 2);
    const cx = (gx - NX / 2 + 0.5) * P, cy = (gy - NX / 2 + 0.5) * P;
    if (infinite) { gx = ((gx % NX) + NX) % NX; gy = ((gy % NX) + NX) % NX; }
    else if (gx < 0 || gy < 0 || gx >= NX || gy >= NX) return { q: -1, cx, cy };
    return { q: gx * NX + gy, cx, cy };
  };

  const sys = {
    kind: 'reactor', design: cfg.design, spec: A, pins: true, banks, fuel: 'U', enrichment: enrich[1] ?? enrich[0], moderator: 'water', lumps: false,
    boron, hot, absorbers, infinite, rods: cfg.rods ?? 0, a: A.pelletR, pitch: P, R: A.equivalentR, R2: Rb, H: A.H, zb, rodXY: [], rodR: 0,
    mats, fuelMat: mats[PIN_REG.FUEL1], modMat: water, refMat: null, fuelRegions: FUEL_REGIONS, layout, kT,
    setRods(x) { sys.rods = x; zb = sys.zb = H2 - A.H * x; },
    regionAt(p) {
      if (!infinite) {
        if (Math.abs(p[2]) >= Z2 || p[0] * p[0] + p[1] * p[1] >= Rb * Rb) return OUT;
        if (Math.abs(p[2]) >= H2) return PIN_REG.WATER;
      }
      const { q, cx, cy } = cellOf(p[0], p[1]);
      if (q < 0 || kindT[q] === CELL.WATER) return PIN_REG.WATER;
      if (kindT[q] === CELL.BAFFLE) return PIN_REG.BAFFLE;
      const rr = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
      for (const [r2, reg] of rings(kindT[q], fuelT[q], p[2])) if (rr < r2) return reg;
      return PIN_REG.WATER;
    },
    boundary(p, d, region, cap = Infinity) {
      let t = cap;
      const plane = (z0) => { if (d[2] !== 0) { const tt = (z0 - p[2]) / d[2]; if (tt > 1e-9 && tt < t) t = tt; } };
      const a2 = d[0] * d[0] + d[1] * d[1];
      if (!infinite) {
        plane(-Z2); plane(Z2); plane(-H2); plane(H2);
        if (a2 > 1e-12) { const b = p[0] * d[0] + p[1] * d[1], c = p[0] * p[0] + p[1] * p[1] - Rb * Rb; t = Math.min(t, (-b + Math.sqrt(Math.max(0, b * b - a2 * c))) / a2); }
        if (Math.abs(p[2]) >= H2) return t; // water above or below the fuel
      }
      const { q, cx, cy } = cellOf(p[0], p[1]);
      if (q < 0 && !infinite) {
        // Between the grid's edge and the barrel: the grid's sides.
        for (let ax = 0; ax < 2; ax++) {
          if (d[ax] > 0 && p[ax] < -W) t = Math.min(t, (-W - p[ax]) / d[ax]);
          if (d[ax] < 0 && p[ax] > W) t = Math.min(t, (W - p[ax]) / d[ax]);
        }
        return t;
      }
      // The cell's walls.
      if (d[0] > 0) t = Math.min(t, (cx + P / 2 - p[0]) / d[0]); else if (d[0] < 0) t = Math.min(t, (cx - P / 2 - p[0]) / d[0]);
      if (d[1] > 0) t = Math.min(t, (cy + P / 2 - p[1]) / d[1]); else if (d[1] < 0) t = Math.min(t, (cy - P / 2 - p[1]) / d[1]);
      const kind = kindT[q];
      if (kind === CELL.WATER || kind === CELL.BAFFLE) return t;
      // Its rings, and the planes where they change.
      if (!infinite) for (const z0 of zPlanes(kind)) if (Math.abs(z0) < H2) plane(z0);
      if (a2 > 1e-12) {
        const px = p[0] - cx, py = p[1] - cy, b = px * d[0] + py * d[1], rho2 = px * px + py * py;
        for (const [r2] of rings(kind, fuelT[q], p[2])) {
          const disc = b * b - a2 * (rho2 - r2);
          if (disc <= 0) continue;
          const sq = Math.sqrt(disc), t1 = (-b - sq) / a2, t2 = (-b + sq) / a2;
          if (t1 > 1e-9 && t1 < t) t = t1;
          else if (t2 > 1e-9 && t2 < t) t = t2;
        }
      }
      return t;
    },
    /** A fission site drawn from the fundamental mode J₀(2.405 r/R)·cos(πz/H), in fuel. */
    sourcePoint(r) {
      for (;;) {
        let x;
        if (infinite) x = [(r() - 0.5) * 2 * W, (r() - 0.5) * 2 * W, (r() - 0.5) * 100];
        else {
          const Re = A.equivalentR + 7, He = A.H + 14;
          let rho, z;
          do rho = A.equivalentR * 1.08 * Math.sqrt(r()); while (r() > besselJ0((2.405 * rho) / Re));
          do z = (r() - 0.5) * A.H; while (r() > Math.cos((Math.PI * z) / He));
          const ph = 2 * Math.PI * r();
          x = [rho * Math.cos(ph), rho * Math.sin(ph), z];
        }
        if (FUEL_REGIONS.includes(sys.regionAt(x))) return x;
      }
    },
  };
  if (!infinite) {
    // Fuel rods, and where the control rodlets are (x, y, 1 black or 2 gray-absorber or 3 gray-steel).
    let pins = 0, fissileVol = 0;
    const rodlets = [];
    for (let q = 0; q < NX * NX; q++) {
      const kind = kindT[q];
      if (kind === CELL.FUEL || kind === CELL.IFBA) { pins++; fissileVol += fissile(mats[FUEL_OF[fuelT[q]]]); }
      else if (rodded(kind)) {
        const gx = Math.floor(q / NX), gy = q % NX;
        rodlets.push((gx - NX / 2 + 0.5) * P, (gy - NX / 2 + 0.5) * P, kind === CELL.BLACK ? 1 : kind === CELL.GRAY_AIC ? 2 : 3);
      }
    }
    // Clusters of banks that stay withdrawn, parked above the core (4).
    if (banks) for (const a of layout) if (a.control && a.bank && !banks.includes(a.bank)) {
      GUIDE_TUBES.forEach(([gi, gj]) => rodlets.push((a.i * n + gi - (n - 1) / 2) * P, (a.j * n + gj - (n - 1) / 2) * P, 4));
    }
    const pelletVol = Math.PI * A.pelletR ** 2 * A.H;
    sys.lumpCount = pins;
    sys.rodlets = new Float32Array(rodlets);
    sys.mass = ((pins * pelletVol * (cfg.fuelDensity ?? A.fuelDensity)) / 1000) * (238.0 / 270.0); // uranium, kg
    sys.modMass = (water.density * Math.PI * A.equivalentR ** 2 * A.H * 0.55) / 1000;
    sys.fissileAtoms = fissileVol * 1e24 * pelletVol;
    sys.v = (Math.PI * A.pelletR ** 2) / P ** 2;
  }
  return sys;
}

// ---------- transport ----------

/**
 * Fly a neutron to its next event. Returns { kind: 'collide'|'cross'|'escape', s (cm), point,
 * region }. A crossing moves it just past the surface into the next region.
 */
export function nextEvent(sys, n, r) {
  const mat = sys.mats[n.region];
  if (!mat) return { kind: 'escape', s: 0, point: n.p };
  const st = -Math.log(r()) / macro(mat, n.E).tot;
  const sb = sys.boundary(n.p, n.d, n.region, st);
  if (st <= sb) return { kind: 'collide', s: st, point: add(n.p, n.d, st) };
  const point = add(n.p, n.d, sb + 1e-6);
  const region = sys.regionAt(point);
  return { kind: region === OUT ? 'escape' : 'cross', s: sb, point, region };
}

/**
 * Collide neutron n (already moved to the collision point) in its region. Returns
 * { kind: 'fission'|'capture'|'elastic'|'inelastic'|'n2n', nuclide, out: [new neutrons], E }.
 * On a scatter, out holds n itself with new direction and energy. Fission neutrons that
 * come later from a decaying fragment ("delayed") carry delay (s) and group.
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
    const dn = DELAYED[hit.p.key], out = [];
    for (let i = 0; i < k; i++) {
      if (r() < dn.beta) {
        // Delayed: a fission fragment β-decays into a state that sheds a neutron (~0.45 MeV).
        let u = r(), g = 0;
        while (g < 5 && (u -= dn.a[g]) > 0) g++;
        out.push({ p: n.p, d: isotropic(r), E: sampleEvap(0.22, 1.5, r), region: n.region, delayed: true, group: g, delay: (-dn.T[g] / Math.LN2) * Math.log(r()) });
      } else out.push({ p: n.p, d: isotropic(r), E: sampleWatt(nuc.watt, r), region: n.region });
    }
    return { kind: 'fission', nuclide: hit.p.key, out, E };
  }
  if ((y -= s.c) < 0) return { kind: 'capture', nuclide: hit.p.key, out: [], E };
  if ((y -= s.el) < 0) {
    // Elastic: angle in the centre-of-mass frame, then the lab-frame energy and direction.
    const muc = sampleHG(forwardness(A, E), r);
    const q = A * A + 2 * A * muc + 1;
    let E2 = (E * q) / ((A + 1) * (A + 1));
    const mul = (1 + A * muc) / Math.sqrt(q);
    const kT = mat.kT ?? KT_ROOM;
    if (E2 < 4 * kT) E2 = sampleThermal(r, kT); // slowed to thermal: now in equilibrium with the material
    return { kind: 'elastic', nuclide: hit.p.key, out: [{ ...n, d: deflect(n.d, mul, r), E: E2 }], E };
  }
  const T = Math.sqrt((8 * E) / A); // nuclear temperature of the excited target (Fermi gas, a = A/8)
  if ((y -= s.inel) < 0) return { kind: 'inelastic', nuclide: hit.p.key, out: [{ ...n, d: isotropic(r), E: sampleEvap(T, E, r) }], E };
  const avail = E - nuc.n2nQ, E1 = sampleEvap(T, avail, r), E2 = sampleEvap(T, Math.max(1e-6, avail - E1), r);
  return { kind: 'n2n', nuclide: hit.p.key, out: [{ ...n, d: isotropic(r), E: E1 }, { ...n, d: isotropic(r), E: E2 }], E };
}

/** A fission neutron born at point p. */
export function birth(sys, p, r, nuclideKey = sys.fuel === 'Pu' ? 'Pu239' : 'U235') {
  return { p, d: isotropic(r), E: sampleWatt(NUCLIDES[nuclideKey].watt, r), region: sys.regionAt(p) };
}

/** A random point in the fuel (where fissions start). */
export function pointInFuel(sys, r) { return sys.sourcePoint(r); }

/**
 * Follow one neutron (and any (n,2n) partners) until every branch is absorbed or escapes.
 * Fission sites go to `sites`; tallies to `tally`, including the four-factor counts:
 * thermal and fast fissions (and the neutrons they make), captures while slowing down,
 * neutrons that reach thermal, thermal absorptions in fuel and elsewhere, and the
 * birth-to-absorption distance² (for the migration area).
 */
function history(sys, n0, r, sites, tally) {
  const stack = [{ ...n0, t: n0.t ?? 0, p0: n0.p, th: n0.E < E_THERMAL }];
  while (stack.length) {
    const n = stack.pop();
    for (let guard = 0; guard < 200000; guard++) {
      const ev = nextEvent(sys, n, r);
      n.t += ev.s / speed(n.E);
      n.p = ev.point;
      if (ev.kind === 'escape') { tally.escape++; break; }
      if (ev.kind === 'cross') { n.region = ev.region; continue; }
      const res = collide(sys, n, r);
      const thermal = n.E < E_THERMAL;
      if (res.kind === 'fission' || res.kind === 'capture') {
        const r2 = (n.p[0] - n.p0[0]) ** 2 + (n.p[1] - n.p0[1]) ** 2 + (n.p[2] - n.p0[2]) ** 2;
        tally.r2 += r2; tally.absorbed++;
        if (thermal) { if (FUEL_NUCLIDES.has(res.nuclide)) tally.thAbsFuel++; else tally.thAbsOther++; }
        else if (res.kind === 'capture') tally.epiCapture++;
        else tally.epiFission++;
        if (n.region === 2) tally.rod++;
        if (res.nuclide === 'B10' && sys.mats[n.region] === sys.modMat) tally.boron++;
      }
      if (res.kind === 'fission') {
        tally.fission++;
        tally.made += res.out.length;
        if (thermal) tally.madeThermal += res.out.length;
        for (const o of res.out) {
          if (o.delayed) tally.delayed++;
          else { tally.genTime += n.t; tally.prompt++; }
          tally.byNuclide[res.nuclide] = (tally.byNuclide[res.nuclide] ?? 0) + 1;
          sites.push({ ...o, t: 0 });
        }
        break;
      }
      if (res.kind === 'capture') { tally.capture++; break; }
      Object.assign(n, res.out[0]);
      if (!n.th && n.E < E_THERMAL) { n.th = true; tally.thermalized++; }
      if (res.out[1]) stack.push({ ...res.out[1], t: n.t, p0: n.p0, th: res.out[1].E < E_THERMAL });
    }
  }
}

const FUEL_NUCLIDES = new Set(['U235', 'U238', 'Pu239']);

const emptyTally = () => ({
  escape: 0, capture: 0, fission: 0, genTime: 0, prompt: 0, delayed: 0, made: 0, madeThermal: 0,
  thermalized: 0, epiCapture: 0, epiFission: 0, thAbsFuel: 0, thAbsOther: 0, r2: 0, absorbed: 0, rod: 0, boron: 0, byNuclide: {},
});

/**
 * Effective multiplication factor k by power iteration over fission generations.
 * Returns { k, sd, genTime (ns, prompt neutrons), beta (delayed fraction), escape, capture,
 * fission (fractions of neutron endings), fourFactor, M2 (cm²), sites (last generation) }.
 */
export function kEffective(sys, { neutrons = 2000, skip = 8, active = 20, seed = 1, onProgress = null } = {}) {
  const r = rng(seed);
  let source = Array.from({ length: neutrons }, () => birth(sys, sys.sourcePoint(r), r));
  const ks = [];
  const sum = emptyTally();
  let lastSites = [];
  for (let g = 0; g < skip + active; g++) {
    const sites = [], tally = emptyTally();
    for (const n of source) history(sys, { ...n, t: 0, delayed: false }, r, sites, tally);
    const k = sites.length / source.length;
    if (g >= skip) {
      ks.push(k);
      for (const key of Object.keys(sum)) {
        if (key === 'byNuclide') for (const [nk, v] of Object.entries(tally.byNuclide)) sum.byNuclide[nk] = (sum.byNuclide[nk] ?? 0) + v;
        else sum[key] += tally[key];
      }
    }
    if (!sites.length) return { k: 0, sd: 0, genTime: 0, beta: 0, escape: 1, capture: 0, fission: 0, sites: [] };
    lastSites = sites;
    // Resample to a fixed population so the next generation has the same size.
    source = Array.from({ length: neutrons }, () => sites[Math.floor(r() * sites.length)]);
    onProgress?.((g + 1) / (skip + active));
  }
  const k = ks.reduce((a, b) => a + b, 0) / ks.length;
  const sd = ks.length > 1 ? Math.sqrt(ks.reduce((a, b) => a + (b - k) ** 2, 0) / (ks.length * (ks.length - 1))) : 0;
  const ends = sum.escape + sum.capture + sum.fission;
  const born = sum.prompt + sum.delayed;
  // Four factors (for a moderated lattice): ε fast fission, p resonance escape, f thermal
  // utilization, η neutrons per thermal absorption in fuel.
  const slowingLoss = sum.thermalized + sum.epiCapture + sum.epiFission;
  const fourFactor = sum.thermalized > 0 && sum.madeThermal > 0 ? {
    eta: sum.madeThermal / Math.max(1, sum.thAbsFuel),
    f: sum.thAbsFuel / Math.max(1, sum.thAbsFuel + sum.thAbsOther),
    p: sum.thermalized / Math.max(1, slowingLoss),
    eps: sum.made / sum.madeThermal,
  } : null;
  const dominant = Object.entries(sum.byNuclide).sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'U235';
  return {
    k, sd, genTime: sum.prompt ? sum.genTime / sum.prompt : 0, beta: born ? sum.delayed / born : 0, dominant,
    escape: sum.escape / ends, capture: sum.capture / ends, fission: sum.fission / ends, rod: sum.rod / ends, boron: sum.boron / ends,
    fourFactor, M2: sum.absorbed ? sum.r2 / sum.absorbed / 6 : 0,
    sites: lastSites.slice(0, 1500).map((s) => s.p),
  };
}

/** Fuel radius (cm) at which a ball is critical, by bisection; null if never. */
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

/**
 * The lattice by itself, infinitely large: k∞, the four factors and the migration area M²
 * (from how far neutrons wander between birth and absorption). One-group diffusion then
 * gives the critical radius of a bare sphere, R = π·M/√(k∞ − 1).
 */
export function latticeProperties(cfg, opts = {}) {
  const res = kEffective(makeSystem({ ...cfg, kind: 'reactor', infinite: true }), { neutrons: 1500, skip: 4, active: 10, seed: 11, ...opts });
  const Rc = res.k > 1 ? (Math.PI * Math.sqrt(res.M2)) / Math.sqrt(res.k - 1) : null;
  return { kInf: res.k, sd: res.sd, fourFactor: res.fourFactor, M2: res.M2, Rc, genTime: res.genTime, beta: res.beta };
}

// ---------- point kinetics ----------

/**
 * The reactor as a whole over seconds to minutes: neutron population n and six groups of
 * delayed-neutron precursors C, driven by the reactivity ρ = (k − 1)/k:
 *   dn/dt = (ρ − β)/Λ · n + Σ λᵢCᵢ + S,   dCᵢ/dt = βᵢ/Λ · n − λᵢCᵢ.
 * Stepped implicitly (stable however stiff), in short enough steps to follow fast growth.
 */
export class PointKinetics {
  constructor({ beta, Lambda, nuclide = 'U235', source = 1e5 }) {
    const g = DELAYED[nuclide];
    this.beta = beta;
    this.Lambda = Lambda; // s
    this.betas = g.a.map((x) => x * beta);
    this.lambdas = g.T.map((t) => Math.LN2 / t);
    this.S = source; // neutrons/s from a start-up source
    this.n = source * Lambda; // a few neutrons, as from the source alone
    this.C = this.betas.map(() => 0);
    this.t = 0;
  }

  /** Settle into the steady state a source holds a subcritical core at: n = −S·Λ/ρ. */
  equilibrate(rho) {
    if (rho < 0) this.n = (-this.S * this.Lambda) / rho;
    this.C = this.betas.map((b, i) => (b * this.n) / (this.Lambda * this.lambdas[i]));
  }

  /** Advance by dt seconds at reactivity rho. */
  step(dt, rho) {
    const { betas, lambdas, beta, Lambda } = this;
    let left = dt, guard = 0;
    while (left > 0 && guard++ < 20000) {
      const rate = Math.abs(rho - beta) / Lambda;
      const h = Math.min(left, 0.05, 0.1 / Math.max(rate, 1e-9));
      let denom = 1 - (h * (rho - beta)) / Lambda, num = this.n + h * this.S;
      for (let i = 0; i < 6; i++) {
        const q = 1 + h * lambdas[i];
        denom -= (h * lambdas[i] * h * betas[i]) / Lambda / q;
        num += (h * lambdas[i] * this.C[i]) / q;
      }
      this.n = num / denom;
      for (let i = 0; i < 6; i++) this.C[i] = (this.C[i] + (h * betas[i] * this.n) / Lambda) / (1 + h * lambdas[i]);
      left -= h;
      this.t += h;
    }
    return this.n;
  }

  /** Fissions per second, given ν neutrons per fission. */
  fissionRate(nu = 2.43) { return this.n / (this.Lambda * nu); }
}
