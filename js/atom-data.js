// Measured atomic properties for the periodic-trend overlays and emission spectra.

// First ionization energy, eV (NIST), Z = 1 … 103.
const IE = [
  13.598, 24.587, 5.392, 9.323, 8.298, 11.260, 14.534, 13.618, 17.423, 21.565,
  5.139, 7.646, 5.986, 8.152, 10.487, 10.360, 12.968, 15.760, 4.341, 6.113,
  6.561, 6.828, 6.746, 6.767, 7.434, 7.902, 7.881, 7.640, 7.726, 9.394,
  5.999, 7.899, 9.789, 9.752, 11.814, 14.000, 4.177, 5.695, 6.217, 6.634,
  6.759, 7.092, 7.28, 7.361, 7.459, 8.337, 7.576, 8.994, 5.786, 7.344,
  8.608, 9.010, 10.451, 12.130, 3.894, 5.212, 5.577, 5.539, 5.473, 5.525,
  5.582, 5.644, 5.670, 6.150, 5.864, 5.939, 6.022, 6.108, 6.184, 6.254,
  5.426, 6.825, 7.550, 7.864, 7.834, 8.438, 8.967, 8.959, 9.226, 10.438,
  6.108, 7.417, 7.286, 8.417, 9.318, 10.749, 4.073, 5.278, 5.380, 6.307,
  5.89, 6.194, 6.266, 6.026, 5.974, 5.991, 6.198, 6.282, 6.368, 6.50,
  6.58, 6.626, 4.96,
];

// Pauling electronegativity; null where none is defined (He, Ne, Ar).
const EN = [
  2.20, null, 0.98, 1.57, 2.04, 2.55, 3.04, 3.44, 3.98, null,
  0.93, 1.31, 1.61, 1.90, 2.19, 2.58, 3.16, null, 0.82, 1.00,
  1.36, 1.54, 1.63, 1.66, 1.55, 1.83, 1.88, 1.91, 1.90, 1.65,
  1.81, 2.01, 2.18, 2.55, 2.96, 3.00, 0.82, 0.95, 1.22, 1.33,
  1.6, 2.16, 1.9, 2.2, 2.28, 2.20, 1.93, 1.69, 1.78, 1.96,
  2.05, 2.1, 2.66, 2.6, 0.79, 0.89, 1.10, 1.12, 1.13, 1.14,
  1.13, 1.17, 1.2, 1.2, 1.1, 1.22, 1.23, 1.24, 1.25, 1.1,
  1.27, 1.3, 1.5, 2.36, 1.9, 2.2, 2.20, 2.28, 2.54, 2.00,
  1.62, 2.33, 2.02, 2.0, 2.2, 2.2, 0.7, 0.9, 1.1, 1.3,
  1.5, 1.38, 1.36, 1.28, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3,
  1.3, 1.3, 1.3,
];

// Covalent radius, pm (Cordero et al. 2008; high-spin values for Mn, Fe, Co), Z = 1 … 96.
const RADIUS = [
  31, 28, 128, 96, 84, 76, 71, 66, 57, 58,
  166, 141, 121, 111, 107, 105, 102, 106, 203, 176,
  170, 160, 153, 139, 161, 152, 150, 124, 132, 122,
  122, 120, 119, 120, 120, 116, 220, 195, 190, 175,
  164, 154, 147, 146, 142, 139, 145, 144, 142, 139,
  139, 138, 139, 140, 244, 215, 207, 204, 203, 201,
  199, 198, 198, 196, 194, 192, 192, 189, 190, 187,
  187, 175, 170, 162, 151, 144, 141, 136, 136, 132,
  145, 146, 148, 140, 150, 150, 260, 221, 215, 206,
  200, 196, 190, 187, 180, 169,
];

export const TRENDS = {
  radius: {
    label: 'Atomic radius', unit: 'pm', values: RADIUS, digits: 0,
    text: 'Atoms get bigger down a group (each period adds a shell) and smaller across a period (more protons pull the same shell in tighter).',
  },
  ionization: {
    label: 'Ionization energy', unit: 'eV', values: IE, digits: 2,
    text: 'The energy to pull off the outermost electron. It rises across a period and peaks at the noble gases; it drops down a group as the electron sits farther out. Dips after full or half-full subshells (B after Be, O after N) show the subshell structure.',
  },
  electronegativity: {
    label: 'Electronegativity', unit: 'Pauling', values: EN, digits: 2,
    text: 'How strongly an atom pulls shared electrons in a bond. Highest at fluorine (top right), lowest at cesium and francium (bottom left). Bonds between atoms that differ a lot are polar or ionic.',
  },
};

/** Value of a trend for element z, or null. */
export const trendValue = (key, z) => TRENDS[key].values[z - 1] ?? null;

// Hydrogen: Rydberg constant for ¹H (reduced mass), m⁻¹.
export const RYDBERG_H = 10967758.34;
const AIR_INDEX = 1.000277; // visible-light refractive index of air; tables quote air wavelengths

/** Hydrogen line from n2 → n1, wavelength in nm (air above 200 nm, as tables quote it). */
export function hydrogenLine(n1, n2) {
  const vac = 1e9 / (RYDBERG_H * (1 / (n1 * n1) - 1 / (n2 * n2)));
  return vac > 200 ? vac / AIR_INDEX : vac;
}
export const HYDROGEN_SERIES = { 1: 'Lyman', 2: 'Balmer', 3: 'Paschen', 4: 'Brackett' };

// Strong visible / near-visible emission lines of neutral atoms, nm in air (NIST).
// Relative brightness (0–1) is approximate, for drawing.
export const EMISSION_LINES = {
  He: [[388.9, 0.6], [447.1, 0.7], [471.3, 0.3], [492.2, 0.4], [501.6, 0.6], [587.6, 1], [667.8, 0.7], [706.5, 0.5]],
  Li: [[460.3, 0.2], [610.4, 0.4], [670.8, 1]],
  Ne: [[540.1, 0.4], [585.2, 0.8], [588.2, 0.6], [594.5, 0.6], [597.6, 0.3], [603.0, 0.4], [607.4, 0.6], [609.6, 0.6], [614.3, 0.8], [616.4, 0.5], [621.7, 0.4], [626.6, 0.6], [633.4, 0.7], [638.3, 0.8], [640.2, 1], [650.7, 0.7], [659.9, 0.5], [692.9, 0.6], [703.2, 0.8]],
  Na: [[498.3, 0.1], [568.8, 0.15], [589.0, 1], [589.6, 0.6]],
  Mg: [[516.7, 0.5], [517.3, 0.7], [518.4, 1]],
  Ar: [[415.9, 0.3], [420.1, 0.3], [427.2, 0.2], [696.5, 0.8], [706.7, 0.7], [738.4, 0.7], [750.4, 1], [763.5, 0.9]],
  K: [[404.4, 0.3], [404.7, 0.2], [766.5, 1], [769.9, 0.7]],
  Cu: [[510.6, 0.8], [515.3, 0.7], [521.8, 1]],
  Zn: [[468.0, 0.6], [472.2, 0.7], [481.1, 0.8], [636.2, 1]],
  Kr: [[427.4, 0.4], [431.9, 0.4], [436.3, 0.3], [557.0, 1], [587.1, 0.9]],
  Rb: [[420.2, 0.4], [421.6, 0.3], [780.0, 1]],
  Cd: [[467.8, 0.6], [480.0, 0.7], [508.6, 0.8], [643.8, 1]],
  In: [[410.2, 0.7], [451.1, 1]],
  Xe: [[450.1, 0.5], [462.4, 0.8], [467.1, 1], [473.4, 0.5], [480.7, 0.4]],
  Cs: [[455.5, 1], [459.3, 0.6]],
  Ba: [[553.5, 1]],
  Hg: [[404.7, 0.7], [435.8, 1], [546.1, 1], [577.0, 0.6], [579.1, 0.6]],
  Tl: [[535.0, 1]],
};
