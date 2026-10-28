// SMILES parser: atoms, bonds, ring closures, branches, charges, implicit
// hydrogens, tetrahedral chirality (@/@@), double-bond geometry (/ \), and
// several molecules separated by “.”.

const ORGANIC = new Set(['B', 'C', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I']);
const AROMATIC = new Set(['b', 'c', 'n', 'o', 'p', 's']);
const DEFAULT_VALENCE = { B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6], F: [1], Cl: [1], Br: [1], I: [1] };
const BOND_CHARS = { '-': 1, '=': 2, '#': 3, ':': 1.5, '/': 1, '\\': 1 };

export class SmilesError extends Error {}

function parseBracket(text, fail) {
  const m = text.match(/^(\d+)?([A-Z][a-z]?|[a-z][a-z]?)(@@|@)?(H\d*)?([+-]{1,3}|[+-]\d+)?(?::\d+)?$/);
  if (!m) fail(`Can’t read bracket atom [${text}]`);
  const [, , sym, chiral, h, charge] = m;
  const aromatic = sym[0] === sym[0].toLowerCase();
  let q = 0;
  if (charge) {
    const sign = charge[0] === '+' ? 1 : -1;
    q = /\d/.test(charge) ? sign * +charge.slice(1) : sign * charge.length;
  }
  return {
    symbol: aromatic ? sym[0].toUpperCase() + sym.slice(1) : sym,
    aromatic,
    chiral: chiral ?? null,
    hCount: h ? (h.length > 1 ? +h.slice(1) : 1) : 0,
    charge: q,
  };
}

/**
 * Returns { atoms, bonds }. Each atom has { symbol, aromatic, charge, chiral, nbrs },
 * where nbrs lists neighbor indices in SMILES order (which defines @/@@).
 * Bonds are { a, b, order, dir } with a written before b; dir is '/' or '\\' if given.
 * Hydrogens are added as explicit atoms.
 */
export function parseSmiles(str) {
  str = str.trim();
  let i = 0;
  const fail = (msg) => { throw new SmilesError(`${msg} (position ${i + 1})`); };
  if (!str) fail('Empty SMILES');

  const atoms = [];
  const bonds = [];
  const rings = new Map();
  const stack = [];
  let prev = null;
  let pending = null; // bond character waiting for its second atom

  const bondOrder = (a, b, ch) => (ch ? BOND_CHARS[ch] : atoms[a].aromatic && atoms[b].aromatic ? 1.5 : 1);
  const addH = (idx) => {
    const h = atoms.length;
    atoms.push({ symbol: 'H', aromatic: false, charge: 0, chiral: null, nbrs: [idx], hCount: 0 });
    bonds.push({ a: idx, b: h, order: 1, dir: null });
    atoms[idx].nbrs.push(h);
  };

  while (i < str.length) {
    const ch = str[i];
    if (ch === '(') {
      if (prev == null) fail('Branch before any atom');
      stack.push(prev); i++; continue;
    }
    if (ch === ')') {
      if (!stack.length) fail('Unmatched “)”');
      prev = stack.pop(); i++; continue;
    }
    if (ch in BOND_CHARS) { pending = ch; i++; continue; }
    if (ch === '.') { // a separate molecule in the same scene
      if (stack.length) fail('“.” inside a branch');
      prev = null; pending = null; i++; continue;
    }
    if (/\d/.test(ch) || ch === '%') {
      if (prev == null) fail('Ring number before any atom');
      const label = ch === '%' ? str.slice(i + 1, i + 3) : ch;
      i += ch === '%' ? 3 : 1;
      if (rings.has(label)) {
        const open = rings.get(label);
        rings.delete(label);
        const order = bondOrder(open.atom, prev, pending ?? open.ch);
        bonds.push({ a: open.atom, b: prev, order, dir: null });
        atoms[open.atom].nbrs[open.slot] = prev;
        atoms[prev].nbrs.push(open.atom);
      } else {
        rings.set(label, { atom: prev, ch: pending, slot: atoms[prev].nbrs.length });
        atoms[prev].nbrs.push(null); // filled when the ring closes
      }
      pending = null;
      continue;
    }

    let atom;
    if (ch === '[') {
      const j = str.indexOf(']', i);
      if (j < 0) fail('Unclosed “[”');
      atom = parseBracket(str.slice(i + 1, j), fail);
      i = j + 1;
    } else {
      const two = str.slice(i, i + 2);
      if (two === 'Cl' || two === 'Br') { atom = { symbol: two }; i += 2; }
      else if (ORGANIC.has(ch)) { atom = { symbol: ch }; i++; }
      else if (AROMATIC.has(ch)) { atom = { symbol: ch.toUpperCase(), aromatic: true }; i++; }
      else fail(`Unexpected “${ch}”`);
      atom.hCount = null; // implicit
    }
    atom = { aromatic: false, charge: 0, chiral: null, ...atom, nbrs: [] };
    const idx = atoms.length;
    atoms.push(atom);
    if (prev != null) {
      bonds.push({ a: prev, b: idx, order: bondOrder(prev, idx, pending), dir: pending === '/' || pending === '\\' ? pending : null });
      atoms[prev].nbrs.push(idx);
      atom.nbrs.push(prev);
    }
    pending = null;
    for (let k = 0; k < (atom.hCount || 0); k++) addH(idx); // bracket H comes right after the previous atom
    prev = idx;
  }
  if (rings.size) fail(`Ring ${[...rings.keys()][0]} is never closed`);
  if (stack.length) fail('Unclosed “(”');

  // Implicit hydrogens for organic-subset atoms: fill up to the lowest normal valence.
  const heavyCount = atoms.length;
  for (let idx = 0; idx < heavyCount; idx++) {
    const a = atoms[idx];
    if (a.hCount !== null || a.symbol === 'H') continue;
    let sum = 0;
    for (const bd of bonds) if (bd.a === idx || bd.b === idx) sum += bd.order === 1.5 ? 1 : bd.order;
    // An aromatic atom shares one double bond in the ring, except O/S and N/P with three
    // connections (pyrrole-type), whose lone pair joins the ring instead.
    const connections = a.nbrs.length;
    const pyrroleLike = (a.symbol === 'N' || a.symbol === 'P') && connections >= 3;
    if (a.aromatic && a.symbol !== 'O' && a.symbol !== 'S' && !pyrroleLike) sum += 1;
    const target = (DEFAULT_VALENCE[a.symbol] ?? [sum]).find((v) => v >= sum) ?? sum;
    for (let k = 0; k < target - sum; k++) addH(idx);
  }
  return { atoms, bonds };
}
