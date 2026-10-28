// Element data for the periodic table: symbol, name, standard atomic weight
// (or [mass number] of the most stable isotope for synthetic elements).
const RAW = `
H Hydrogen 1.008
He Helium 4.0026
Li Lithium 6.94
Be Beryllium 9.0122
B Boron 10.81
C Carbon 12.011
N Nitrogen 14.007
O Oxygen 15.999
F Fluorine 18.998
Ne Neon 20.180
Na Sodium 22.990
Mg Magnesium 24.305
Al Aluminum 26.982
Si Silicon 28.085
P Phosphorus 30.974
S Sulfur 32.06
Cl Chlorine 35.45
Ar Argon 39.95
K Potassium 39.098
Ca Calcium 40.078
Sc Scandium 44.956
Ti Titanium 47.867
V Vanadium 50.942
Cr Chromium 51.996
Mn Manganese 54.938
Fe Iron 55.845
Co Cobalt 58.933
Ni Nickel 58.693
Cu Copper 63.546
Zn Zinc 65.38
Ga Gallium 69.723
Ge Germanium 72.630
As Arsenic 74.922
Se Selenium 78.971
Br Bromine 79.904
Kr Krypton 83.798
Rb Rubidium 85.468
Sr Strontium 87.62
Y Yttrium 88.906
Zr Zirconium 91.224
Nb Niobium 92.906
Mo Molybdenum 95.95
Tc Technetium [98]
Ru Ruthenium 101.07
Rh Rhodium 102.91
Pd Palladium 106.42
Ag Silver 107.87
Cd Cadmium 112.41
In Indium 114.82
Sn Tin 118.71
Sb Antimony 121.76
Te Tellurium 127.60
I Iodine 126.90
Xe Xenon 131.29
Cs Cesium 132.91
Ba Barium 137.33
La Lanthanum 138.91
Ce Cerium 140.12
Pr Praseodymium 140.91
Nd Neodymium 144.24
Pm Promethium [145]
Sm Samarium 150.36
Eu Europium 151.96
Gd Gadolinium 157.25
Tb Terbium 158.93
Dy Dysprosium 162.50
Ho Holmium 164.93
Er Erbium 167.26
Tm Thulium 168.93
Yb Ytterbium 173.05
Lu Lutetium 174.97
Hf Hafnium 178.49
Ta Tantalum 180.95
W Tungsten 183.84
Re Rhenium 186.21
Os Osmium 190.23
Ir Iridium 192.22
Pt Platinum 195.08
Au Gold 196.97
Hg Mercury 200.59
Tl Thallium 204.38
Pb Lead 207.2
Bi Bismuth 208.98
Po Polonium [209]
At Astatine [210]
Rn Radon [222]
Fr Francium [223]
Ra Radium [226]
Ac Actinium [227]
Th Thorium 232.04
Pa Protactinium 231.04
U Uranium 238.03
Np Neptunium [237]
Pu Plutonium [244]
Am Americium [243]
Cm Curium [247]
Bk Berkelium [247]
Cf Californium [251]
Es Einsteinium [252]
Fm Fermium [257]
Md Mendelevium [258]
No Nobelium [259]
Lr Lawrencium [266]
Rf Rutherfordium [267]
Db Dubnium [268]
Sg Seaborgium [269]
Bh Bohrium [270]
Hs Hassium [269]
Mt Meitnerium [278]
Ds Darmstadtium [281]
Rg Roentgenium [282]
Cn Copernicium [285]
Nh Nihonium [286]
Fl Flerovium [289]
Mc Moscovium [290]
Lv Livermorium [293]
Ts Tennessine [294]
Og Oganesson [294]
`;

export const CATEGORIES = {
  'alkali':          { label: 'Alkali metal',          color: '#ff7a6b' },
  'alkaline-earth':  { label: 'Alkaline earth metal',  color: '#ffb35c' },
  'transition':      { label: 'Transition metal',      color: '#f2d45c' },
  'post-transition': { label: 'Post-transition metal', color: '#9fd88a' },
  'metalloid':       { label: 'Metalloid',             color: '#5fd3b4' },
  'nonmetal':        { label: 'Reactive nonmetal',     color: '#5cb8ff' },
  'halogen':         { label: 'Halogen',               color: '#8f9bff' },
  'noble-gas':       { label: 'Noble gas',             color: '#c58cff' },
  'lanthanide':      { label: 'Lanthanide',            color: '#ff8fc8' },
  'actinide':        { label: 'Actinide',              color: '#ff6f9e' },
};

const SETS = {
  'alkali': [3, 11, 19, 37, 55, 87],
  'alkaline-earth': [4, 12, 20, 38, 56, 88],
  'post-transition': [13, 31, 49, 50, 81, 82, 83, 84, 113, 114, 115, 116],
  'metalloid': [5, 14, 32, 33, 51, 52],
  'nonmetal': [1, 6, 7, 8, 15, 16, 34],
  'halogen': [9, 17, 35, 53, 85, 117],
  'noble-gas': [2, 10, 18, 36, 54, 86, 118],
};

function categoryOf(z) {
  if (z >= 57 && z <= 71) return 'lanthanide';
  if (z >= 89 && z <= 103) return 'actinide';
  for (const [cat, list] of Object.entries(SETS)) if (list.includes(z)) return cat;
  return 'transition';
}

// Grid position: rows 1–7 are periods, rows 9–10 hold the f-block.
function positionOf(z) {
  if (z === 1) return { row: 1, col: 1 };
  if (z === 2) return { row: 1, col: 18 };
  if (z <= 18) {
    const row = z <= 10 ? 2 : 3;
    const start = row === 2 ? 3 : 11;
    const i = z - start;
    return { row, col: i < 2 ? i + 1 : i + 11 };
  }
  if (z <= 54) {
    const row = z <= 36 ? 4 : 5;
    return { row, col: z - (row === 4 ? 18 : 36) };
  }
  const row = z <= 86 ? 6 : 7;
  const base = row === 6 ? 54 : 86;
  const i = z - base; // 1-based within the period
  if (i <= 2) return { row, col: i };
  if (i <= 17) return { row: row + 3, col: i }; // f-block row, cols 3–17
  return { row, col: i - 14 };
}

export const ELEMENTS = RAW.trim().split('\n').map((line, i) => {
  const [symbol, name, mass] = line.trim().split(/\s+/);
  const z = i + 1;
  return { z, symbol, name, mass, category: categoryOf(z), ...positionOf(z) };
});
