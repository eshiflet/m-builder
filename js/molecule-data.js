// Reference data for molecule building: covalent radii, electronegativity,
// display colors, and a table of molecules with measured geometries.

// Single-bond covalent radii in Å (Pyykkö & Atsumi 2009).
export const COVALENT_RADIUS = {
  H: 0.32, He: 0.46, Li: 1.33, Be: 1.02, B: 0.85, C: 0.75, N: 0.71, O: 0.63, F: 0.64, Ne: 0.67,
  Na: 1.55, Mg: 1.39, Al: 1.26, Si: 1.16, P: 1.11, S: 1.03, Cl: 0.99, Ar: 0.96,
  K: 1.96, Ca: 1.71, Ga: 1.24, Ge: 1.21, As: 1.21, Se: 1.16, Br: 1.14, Kr: 1.17,
  Rb: 2.10, Sr: 1.85, In: 1.42, Sn: 1.40, Sb: 1.40, Te: 1.36, I: 1.33, Xe: 1.31,
  Cs: 2.32, Ba: 1.96, Tl: 1.44, Pb: 1.44, Bi: 1.51, Po: 1.45, At: 1.47, Rn: 1.42,
};

// Ionic radii in Å (Shannon, 6-coordinate) for the ions the builder forms.
export const IONIC_RADIUS = {
  Li: 0.76, Na: 1.02, K: 1.38, Rb: 1.52, Cs: 1.67, Fr: 1.80,
  Mg: 0.72, Ca: 1.00, Sr: 1.18, Ba: 1.35, Ra: 1.48,
  H: 1.40, F: 1.33, Cl: 1.81, Br: 1.96, I: 2.20, At: 2.3,
  O: 1.40, S: 1.84, Se: 1.98, Te: 2.21, N: 1.46, P: 2.12,
};

// Pauling electronegativity.
export const ELECTRONEGATIVITY = {
  H: 2.20, Li: 0.98, Be: 1.57, B: 2.04, C: 2.55, N: 3.04, O: 3.44, F: 3.98,
  Na: 0.93, Mg: 1.31, Al: 1.61, Si: 1.90, P: 2.19, S: 2.58, Cl: 3.16, Ar: 3.5,
  K: 0.82, Ca: 1.00, Ga: 1.81, Ge: 2.01, As: 2.18, Se: 2.55, Br: 2.96, Kr: 3.00,
  Rb: 0.82, Sr: 0.95, In: 1.78, Sn: 1.96, Sb: 2.05, Te: 2.10, I: 2.66, Xe: 2.60,
  Cs: 0.79, Ba: 0.89, Tl: 1.62, Pb: 2.33, Bi: 2.02, Po: 2.0, At: 2.2, Rn: 2.2,
  He: 4.5, Ne: 4.5,
};

// Jmol/CPK-style atom colors.
export const ATOM_COLORS = {
  H: '#f2f2f2', He: '#d9ffff', Li: '#cc80ff', Be: '#c2ff00', B: '#ffb5b5', C: '#9a9a9a',
  N: '#4d6bff', O: '#ff3b3b', F: '#90e050', Ne: '#b3e3f5', Na: '#ab5cf2', Mg: '#8aff00',
  Al: '#bfa6a6', Si: '#f0c8a0', P: '#ff8000', S: '#ffe030', Cl: '#1ff01f', Ar: '#80d1e3',
  K: '#8f40d4', Ca: '#3dff00', Ga: '#c28f8f', Ge: '#668f8f', As: '#bd80e3', Se: '#ffa100',
  Br: '#c24040', Kr: '#5cb8d1', Rb: '#702eb0', Sr: '#00ff00', In: '#a67573', Sn: '#668080',
  Sb: '#9e63b5', Te: '#d47a00', I: '#b040c0', Xe: '#429eb0',
};

/*
 * Molecules with measured gas-phase geometries (bond lengths in Å, angles in degrees).
 *
 * Single-center entries are built by the VSEPR builder using these values:
 *   center  – the central atom
 *   lengths – bond length from the center to each ligand element
 *   angle   – the characteristic bond angle (between the two bonds for AX₂,
 *             between the like pair for AX₃ such as H–C–H in CH₂O, the bond
 *             angle of a pyramid, the equatorial angle of a seesaw, ...)
 *   angle2  – axial–axial angle of a seesaw
 *
 * Multi-center entries give a Z-matrix: each row is
 *   [symbol, bondTo, length, angleTo, angle, dihedralTo, dihedral] (0-based)
 * or explicit coordinates, plus bonds as [a, b, order].
 */
export const KNOWN_MOLECULES = [
  { formula: 'H2', name: 'Hydrogen', center: 'H', lengths: { H: 0.741 } },
  { formula: 'N2', name: 'Nitrogen', center: 'N', lengths: { N: 1.098 } },
  { formula: 'O2', name: 'Oxygen', center: 'O', lengths: { O: 1.208 } },
  { formula: 'F2', name: 'Fluorine', center: 'F', lengths: { F: 1.412 } },
  { formula: 'Cl2', name: 'Chlorine', center: 'Cl', lengths: { Cl: 1.988 } },
  { formula: 'HF', name: 'Hydrogen fluoride', center: 'F', lengths: { H: 0.917 } },
  { formula: 'HCl', name: 'Hydrogen chloride', center: 'Cl', lengths: { H: 1.275 } },
  { formula: 'CO', name: 'Carbon monoxide', center: 'C', lengths: { O: 1.128 } },

  { formula: 'H2O', name: 'Water', center: 'O', angle: 104.5, lengths: { H: 0.958 } },
  { formula: 'H2S', name: 'Hydrogen sulfide', center: 'S', angle: 92.1, lengths: { H: 1.336 } },
  { formula: 'NH3', name: 'Ammonia', center: 'N', angle: 106.7, lengths: { H: 1.012 } },
  { formula: 'PH3', name: 'Phosphine', center: 'P', angle: 93.3, lengths: { H: 1.420 } },
  { formula: 'CH4', name: 'Methane', center: 'C', lengths: { H: 1.087 } },
  { formula: 'SiH4', name: 'Silane', center: 'Si', lengths: { H: 1.480 } },
  { formula: 'CO2', name: 'Carbon dioxide', center: 'C', lengths: { O: 1.160 } },
  { formula: 'SO2', name: 'Sulfur dioxide', center: 'S', angle: 119.5, lengths: { O: 1.431 } },
  { formula: 'SO3', name: 'Sulfur trioxide', center: 'S', lengths: { O: 1.420 } },
  { formula: 'O3', name: 'Ozone', center: 'O', angle: 116.8, lengths: { O: 1.278 } },
  { formula: 'NO2', name: 'Nitrogen dioxide', center: 'N', angle: 134.1, lengths: { O: 1.197 } },
  { formula: 'N2O', name: 'Nitrous oxide', center: 'N', lengths: { N: 1.128, O: 1.184 } },
  { formula: 'HCN', name: 'Hydrogen cyanide', center: 'C', lengths: { H: 1.066, N: 1.156 } },
  { formula: 'CH2O', name: 'Formaldehyde', center: 'C', angle: 116.5, lengths: { H: 1.111, O: 1.205 } },
  { formula: 'COCl2', name: 'Phosgene', center: 'C', angle: 111.8, lengths: { O: 1.176, Cl: 1.742 } },
  { formula: 'OF2', name: 'Oxygen difluoride', center: 'O', angle: 103.1, lengths: { F: 1.405 } },
  { formula: 'HOCl', name: 'Hypochlorous acid', center: 'O', angle: 102.5, lengths: { H: 0.964, Cl: 1.690 } },
  { formula: 'NF3', name: 'Nitrogen trifluoride', center: 'N', angle: 102.4, lengths: { F: 1.365 } },
  { formula: 'PCl3', name: 'Phosphorus trichloride', center: 'P', angle: 100.3, lengths: { Cl: 2.043 } },
  { formula: 'BF3', name: 'Boron trifluoride', center: 'B', lengths: { F: 1.307 } },
  { formula: 'BeCl2', name: 'Beryllium chloride', center: 'Be', lengths: { Cl: 1.791 } },
  { formula: 'CCl4', name: 'Carbon tetrachloride', center: 'C', lengths: { Cl: 1.767 } },
  { formula: 'PCl5', name: 'Phosphorus pentachloride', center: 'P', lengths: { Cl: 2.07 } },
  { formula: 'SF4', name: 'Sulfur tetrafluoride', center: 'S', angle: 101.6, angle2: 173.1, lengths: { F: 1.60 } },
  { formula: 'ClF3', name: 'Chlorine trifluoride', center: 'Cl', angle: 87.5, lengths: { F: 1.65 } },
  { formula: 'SF6', name: 'Sulfur hexafluoride', center: 'S', lengths: { F: 1.561 } },
  { formula: 'BrF5', name: 'Bromine pentafluoride', center: 'Br', angle: 84.8, lengths: { F: 1.75 } },
  { formula: 'XeF2', name: 'Xenon difluoride', center: 'Xe', lengths: { F: 1.977 } },
  { formula: 'XeF4', name: 'Xenon tetrafluoride', center: 'Xe', lengths: { F: 1.95 } },

  // Polyatomic ions (typical bond lengths from crystal structures).
  { formula: 'NH4', charge: 1, name: 'Ammonium', center: 'N', lengths: { H: 1.03 }, crystal: true },
  { formula: 'H3O', charge: 1, name: 'Hydronium', center: 'O', angle: 111.3, lengths: { H: 0.976 } },
  { formula: 'OH', charge: -1, name: 'Hydroxide', center: 'O', lengths: { H: 0.964 } },
  { formula: 'CN', charge: -1, name: 'Cyanide', center: 'C', lengths: { N: 1.16 }, crystal: true },
  { formula: 'NO2', charge: -1, name: 'Nitrite', center: 'N', angle: 115.4, lengths: { O: 1.24 }, crystal: true },
  { formula: 'NO3', charge: -1, name: 'Nitrate', center: 'N', lengths: { O: 1.25 }, crystal: true },
  { formula: 'CO3', charge: -2, name: 'Carbonate', center: 'C', lengths: { O: 1.29 }, crystal: true },
  { formula: 'SO4', charge: -2, name: 'Sulfate', center: 'S', lengths: { O: 1.49 }, crystal: true },
  { formula: 'PO4', charge: -3, name: 'Phosphate', center: 'P', lengths: { O: 1.54 }, crystal: true },
  { formula: 'ClO4', charge: -1, name: 'Perchlorate', center: 'Cl', lengths: { O: 1.44 }, crystal: true },

  // Ionic compounds as single gas-phase units (bond length from the metal to each counter-ion).
  { formula: 'NaCl', name: 'Sodium chloride', ionic: true, lengths: { Cl: 2.361 } },
  { formula: 'NaF', name: 'Sodium fluoride', ionic: true, lengths: { F: 1.926 } },
  { formula: 'NaBr', name: 'Sodium bromide', ionic: true, lengths: { Br: 2.502 } },
  { formula: 'NaI', name: 'Sodium iodide', ionic: true, lengths: { I: 2.711 } },
  { formula: 'LiF', name: 'Lithium fluoride', ionic: true, lengths: { F: 1.564 } },
  { formula: 'LiCl', name: 'Lithium chloride', ionic: true, lengths: { Cl: 2.021 } },
  { formula: 'KF', name: 'Potassium fluoride', ionic: true, lengths: { F: 2.171 } },
  { formula: 'KCl', name: 'Potassium chloride', ionic: true, lengths: { Cl: 2.667 } },
  { formula: 'KBr', name: 'Potassium bromide', ionic: true, lengths: { Br: 2.821 } },
  { formula: 'CsCl', name: 'Cesium chloride', ionic: true, lengths: { Cl: 2.906 } },
  { formula: 'MgO', name: 'Magnesium oxide', ionic: true, lengths: { O: 1.749 } },
  { formula: 'CaO', name: 'Calcium oxide', ionic: true, lengths: { O: 1.822 } },
  { formula: 'MgF2', name: 'Magnesium fluoride', ionic: true, lengths: { F: 1.77 } },
  { formula: 'MgCl2', name: 'Magnesium chloride', ionic: true, lengths: { Cl: 2.179 } },

  {
    formula: 'C2H6', name: 'Ethane', shape: 'Tetrahedral carbons, staggered',
    zmatrix: [
      ['C'], ['C', 0, 1.535],
      ['H', 0, 1.094, 1, 111.2], ['H', 0, 1.094, 1, 111.2, 2, 120], ['H', 0, 1.094, 1, 111.2, 2, -120],
      ['H', 1, 1.094, 0, 111.2, 2, 180], ['H', 1, 1.094, 0, 111.2, 5, 120], ['H', 1, 1.094, 0, 111.2, 5, -120],
    ],
    bonds: [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1], [1, 5, 1], [1, 6, 1], [1, 7, 1]],
  },
  {
    formula: 'C2H4', name: 'Ethylene', shape: 'Trigonal planar carbons, flat',
    zmatrix: [
      ['C'], ['C', 0, 1.339],
      ['H', 0, 1.087, 1, 121.3], ['H', 0, 1.087, 1, 121.3, 2, 180],
      ['H', 1, 1.087, 0, 121.3, 2, 0], ['H', 1, 1.087, 0, 121.3, 2, 180],
    ],
    bonds: [[0, 1, 2], [0, 2, 1], [0, 3, 1], [1, 4, 1], [1, 5, 1]],
  },
  {
    formula: 'C2H2', name: 'Acetylene', shape: 'Linear',
    coords: [['H', -1.6645, 0, 0], ['C', -0.6015, 0, 0], ['C', 0.6015, 0, 0], ['H', 1.6645, 0, 0]],
    bonds: [[0, 1, 1], [1, 2, 3], [2, 3, 1]],
  },
  {
    formula: 'H2O2', name: 'Hydrogen peroxide', shape: 'Bent at each oxygen, twisted (gauche)',
    zmatrix: [['O'], ['O', 0, 1.475], ['H', 0, 0.950, 1, 94.8], ['H', 1, 0.950, 0, 94.8, 2, 111.5]],
    bonds: [[0, 1, 1], [0, 2, 1], [1, 3, 1]],
  },
  {
    formula: 'CH3OH', name: 'Methanol', shape: 'Tetrahedral carbon, bent at oxygen',
    zmatrix: [
      ['C'], ['O', 0, 1.427], ['H', 1, 0.956, 0, 108.5],
      ['H', 0, 1.094, 1, 107.2, 2, 180], ['H', 0, 1.094, 1, 111.6, 2, 60], ['H', 0, 1.094, 1, 111.6, 2, -60],
    ],
    bonds: [[0, 1, 1], [1, 2, 1], [0, 3, 1], [0, 4, 1], [0, 5, 1]],
  },
  {
    formula: 'C2H5OH', name: 'Ethanol', shape: 'Tetrahedral carbons, bent at oxygen',
    zmatrix: [
      ['C'], ['C', 0, 1.512], ['O', 1, 1.431, 0, 107.8], ['H', 2, 0.971, 1, 105.4, 0, 180],
      ['H', 1, 1.094, 0, 110.0, 2, 120], ['H', 1, 1.094, 0, 110.0, 2, -120],
      ['H', 0, 1.091, 1, 110.5, 2, 180], ['H', 0, 1.091, 1, 110.5, 6, 120], ['H', 0, 1.091, 1, 110.5, 6, -120],
    ],
    bonds: [[0, 1, 1], [1, 2, 1], [2, 3, 1], [1, 4, 1], [1, 5, 1], [0, 6, 1], [0, 7, 1], [0, 8, 1]],
  },
  {
    formula: 'C6H6', name: 'Benzene', shape: 'Flat hexagonal ring',
    coords: [0, 1, 2, 3, 4, 5].flatMap((i) => {
      const a = (i * Math.PI) / 3;
      const c = Math.cos(a), s = Math.sin(a);
      return [['C', 1.397 * c, 1.397 * s, 0], ['H', 2.481 * c, 2.481 * s, 0]];
    }),
    bonds: [0, 1, 2, 3, 4, 5].flatMap((i) => [[2 * i, (2 * i + 2) % 12, 1.5], [2 * i, 2 * i + 1, 1]]),
  },

  // Built from SMILES (connectivity + stereochemistry) and a force field.
  // Sugars: same formula, different structures.
  { smiles: 'C([C@@H]1[C@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O', name: 'β-D-Glucose', aliases: ['glucose', 'dextrose', 'blood sugar'], note: 'Six-membered ring (pyranose) in a chair; every OH is equatorial, which is part of why glucose is so stable and common.' },
  { smiles: 'C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O)O)O)O)O', name: 'α-D-Glucose', note: 'Same ring as β-glucose, but the OH on carbon 1 points axially (down). In water the two forms interconvert through the open chain.' },
  { smiles: 'C([C@H]([C@H]([C@@H]([C@H](C=O)O)O)O)O)O', name: 'D-Glucose (open chain)', note: 'The straight-chain aldehyde form. Less than 1% of glucose in water is in this form at any moment; it closes into the rings.' },
  { smiles: 'C([C@@H]1[C@@H]([C@@H]([C@H]([C@@H](O1)O)O)O)O)O', name: 'β-D-Galactose', aliases: ['galactose'], note: 'Differs from glucose only at carbon 4, where the OH is axial instead of equatorial.' },
  { smiles: 'C([C@@H]1[C@H]([C@@H]([C@](O1)(CO)O)O)O)O', name: 'β-D-Fructose', aliases: ['fructose', 'fruit sugar'], note: 'Fructose is a ketone sugar: the ring closes at carbon 2, giving a five-membered (furanose) ring. This is the form found in sucrose.' },
  { smiles: 'C([C@H]([C@H]([C@@H](C(=O)CO)O)O)O)O', name: 'D-Fructose (open chain)', note: 'The straight-chain ketone form of fructose; the C=O is on carbon 2 rather than carbon 1 as in glucose.' },
  { smiles: 'C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O[C@]2([C@H]([C@@H]([C@H](O2)CO)O)O)CO)O)O)O)O', name: 'Sucrose', aliases: ['table sugar', 'sugar', 'cane sugar'], note: 'Table sugar: an α-glucose ring joined to a β-fructose ring through one oxygen (a glycosidic bond), with water removed. C₆H₁₂O₆ + C₆H₁₂O₆ − H₂O = C₁₂H₂₂O₁₁.' },

  // Other organic molecules (several are isomers of each other).
  { smiles: 'COC', name: 'Dimethyl ether', note: 'An isomer of ethanol: same atoms, but the oxygen sits between the carbons.' },
  { smiles: 'CCC', name: 'Propane' },
  { smiles: 'CCCC', name: 'Butane', note: 'Rotating around the middle bond gives anti and gauche conformers.' },
  { smiles: 'CC(C)C', name: 'Isobutane', note: 'A branched isomer of butane.' },
  { smiles: 'C=CCC', name: '1-Butene' },
  { smiles: 'C/C=C/C', name: 'trans-2-Butene', note: 'The methyl groups are on opposite sides of the rigid C=C bond.' },
  { smiles: 'C/C=C\\C', name: 'cis-2-Butene', note: 'The methyl groups are on the same side of the C=C bond. It can’t rotate into the trans form without breaking the π bond.' },
  { smiles: 'C1CCCCC1', name: 'Cyclohexane', note: 'The chair conformer has every C–C–C–C angle staggered; the twist-boat is about 5 kcal/mol higher.' },
  { smiles: 'CC(=O)C', name: 'Acetone' },
  { smiles: 'CCC=O', name: 'Propanal', note: 'An isomer of acetone, with the C=O at the end of the chain (an aldehyde).' },
  { smiles: 'CC(=O)O', name: 'Acetic acid', aliases: ['vinegar'] },
  { smiles: 'COC=O', name: 'Methyl formate', note: 'An isomer of acetic acid (an ester).' },
  { smiles: 'OCCO', name: 'Ethylene glycol', aliases: ['antifreeze'] },
  { smiles: 'OCC(O)CO', name: 'Glycerol' },
  { smiles: 'NC(=O)N', name: 'Urea' },
  { smiles: 'NCC(=O)O', name: 'Glycine', aliases: ['amino acid'] },
  { smiles: 'C[C@@H](C(=O)O)N', name: 'L-Alanine' },
  { smiles: 'Cc1ccccc1', name: 'Toluene' },
  { smiles: 'Oc1ccccc1', name: 'Phenol' },
  { smiles: 'c1ccncc1', name: 'Pyridine' },
  { smiles: 'c1ccc2ccccc2c1', name: 'Naphthalene', aliases: ['mothballs'] },
  { smiles: 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C', name: 'Caffeine', aliases: ['coffee'] },
  { smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O', name: 'Aspirin' },
  { smiles: 'CC(=O)NC1=CC=C(C=C1)O', name: 'Acetaminophen', aliases: ['paracetamol', 'tylenol'] },
  { smiles: 'CC(C)CC1=CC=C(C=C1)C(C)C(=O)O', name: 'Ibuprofen' },
  { smiles: 'NC1=C2N=CNC2=NC=N1', name: 'Adenine', aliases: ['dna base'] },
];

export const EXAMPLES = [
  ...['H2O', 'CO2', 'NH3', 'CH4', 'BF3', 'SO2', 'HCN', 'CH2O', 'C2H4', 'C6H6', 'PCl5', 'SF4', 'ClF3', 'SF6', 'XeF4']
    .map((formula) => ({ formula, charge: 0 })),
  { formula: 'NaCl', charge: 0 }, { formula: 'MgCl2', charge: 0 }, { formula: 'CaO', charge: 0 },
  { formula: 'NH4', charge: 1 }, { formula: 'NO3', charge: -1 }, { formula: 'CO3', charge: -2 }, { formula: 'SO4', charge: -2 },
  { name: 'β-D-Glucose', label: 'Glucose' }, { name: 'β-D-Fructose', label: 'Fructose' }, { name: 'Sucrose', label: 'Sucrose' },
  { name: 'Butane', label: 'Butane' }, { name: 'Cyclohexane', label: 'Cyclohexane' }, { name: 'Caffeine', label: 'Caffeine' },
];
