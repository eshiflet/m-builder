// Ground-state electron configurations (Madelung rule + known exceptions)
// and Slater's-rule effective nuclear charge.

export const L_LETTERS = 'spdf';

const subKey = (n, l) => `${n}${L_LETTERS[l]}`;

// Subshells in Madelung (n + l, then n) filling order.
const FILL_ORDER = [];
for (let n = 1; n <= 7; n++) {
  for (let l = 0; l < Math.min(n, 4); l++) FILL_ORDER.push([n, l]);
}
FILL_ORDER.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]) || a[0] - b[0]);

// Elements whose measured ground state differs from the Madelung prediction.
const EXCEPTIONS = {
  24: { '3d': 5, '4s': 1 },
  29: { '3d': 10, '4s': 1 },
  41: { '4d': 4, '5s': 1 },
  42: { '4d': 5, '5s': 1 },
  44: { '4d': 7, '5s': 1 },
  45: { '4d': 8, '5s': 1 },
  46: { '4d': 10, '5s': 0 },
  47: { '4d': 10, '5s': 1 },
  57: { '4f': 0, '5d': 1 },
  58: { '4f': 1, '5d': 1 },
  64: { '4f': 7, '5d': 1 },
  78: { '5d': 9, '6s': 1 },
  79: { '5d': 10, '6s': 1 },
  89: { '5f': 0, '6d': 1 },
  90: { '5f': 0, '6d': 2 },
  91: { '5f': 2, '6d': 1 },
  92: { '5f': 3, '6d': 1 },
  93: { '5f': 4, '6d': 1 },
  96: { '5f': 7, '6d': 1 },
  103: { '6d': 0, '7p': 1 },
};

const NOBLE_GASES = [[2, 'He'], [10, 'Ne'], [18, 'Ar'], [36, 'Kr'], [54, 'Xe'], [86, 'Rn']];

/** Returns [{ n, l, key, count }] sorted by n then l. */
export function electronConfig(z) {
  const counts = new Map();
  let left = z;
  for (const [n, l] of FILL_ORDER) {
    if (left <= 0) break;
    const take = Math.min(left, 2 * (2 * l + 1));
    counts.set(subKey(n, l), take);
    left -= take;
  }
  for (const [key, c] of Object.entries(EXCEPTIONS[z] || {})) counts.set(key, c);

  return [...counts.entries()]
    .filter(([, c]) => c > 0)
    .map(([key, count]) => ({ n: +key[0], l: L_LETTERS.indexOf(key[1]), key, count }))
    .sort((a, b) => a.n - b.n || a.l - b.l);
}

/** Noble-gas shorthand, e.g. "[Ar] 3d<sup>6</sup> 4s<sup>2</sup>". */
export function configHTML(z) {
  const config = electronConfig(z);
  const core = [...NOBLE_GASES].reverse().find(([nz]) => nz < z);
  let coreCounts = new Map();
  let prefix = '';
  if (core) {
    coreCounts = new Map(electronConfig(core[0]).map(s => [s.key, s.count]));
    prefix = `[${core[1]}] `;
  }
  const rest = config
    .map(s => ({ ...s, count: s.count - (coreCounts.get(s.key) || 0) }))
    .filter(s => s.count > 0)
    .map(s => `${s.key}<sup>${s.count}</sup>`);
  return prefix + rest.join(' ');
}

/** Effective nuclear charge felt by an electron in subshell (n, l), per Slater's rules. */
export function slaterZeff(z, config, n, l) {
  // Slater groups: (1s)(2s,2p)(3s,3p)(3d)(4s,4p)(4d)(4f)(5s,5p)...
  const group = (sn, sl) => [sn, sl <= 1 ? 0 : sl - 1];
  const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const g = group(n, l);

  let shielding = 0;
  for (const s of config) {
    const sg = group(s.n, s.l);
    let count = s.count;
    if (s.n === n && s.l === l) count -= 1; // exclude the electron itself
    if (count <= 0) continue;
    if (same(sg, g)) {
      shielding += count * (n === 1 ? 0.30 : 0.35);
    } else if (l <= 1) {
      if (s.n === n - 1) shielding += count * 0.85;
      else if (s.n < n - 1) shielding += count * 1.0;
    } else if (before(sg, g)) {
      shielding += count * 1.0;
    }
  }
  return Math.max(z - shielding, 1);
}

/** Electrons in each of the 2l+1 orbitals of a subshell, filled per Hund's rule. */
export function orbitalOccupancy(l, count) {
  const m = 2 * l + 1;
  return Array.from({ length: m }, (_, i) => (count > i ? 1 : 0) + (count > m + i ? 1 : 0));
}
