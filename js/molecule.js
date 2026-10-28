// Molecule geometry: known molecules use measured geometries; anything else
// with a single central atom gets a Lewis structure and a VSEPR estimate.

import { ELEMENTS } from './elements.js';
import { COVALENT_RADIUS, ELECTRONEGATIVITY, IONIC_RADIUS, KNOWN_MOLECULES } from './molecule-data.js';
import { parseSmiles, SmilesError } from './smiles.js';
import { generateConformers, ForceFieldError } from './forcefield.js';

const BY_SYMBOL = new Map(ELEMENTS.map((e) => [e.symbol, e]));
const DEG = Math.PI / 180;
const HALOGENS = new Set(['F', 'Cl', 'Br', 'I', 'At']);

// ---------- small vector helpers (plain [x, y, z] arrays) ----------

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => scale(a, 1 / (len(a) || 1));
const combo = (a, sa, b, sb) => add(scale(a, sa), scale(b, sb));

/** A unit vector perpendicular to v, preferring the given hint direction. */
function perpendicular(v, hint = [0, 0, 1]) {
  for (const h of [hint, [0, 0, 1], [0, 1, 0], [1, 0, 0]]) {
    const p = sub(h, scale(v, dot(h, v)));
    if (len(p) > 0.1) return norm(p);
  }
  return [1, 0, 0];
}

class BuildError extends Error {}

// ---------- formulas ----------

export function parseFormula(str) {
  const counts = new Map();
  for (const [, sym, n] of str.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    counts.set(sym, (counts.get(sym) || 0) + (n ? +n : 1));
  }
  return counts;
}

/** Hill-order key: C, then H, then alphabetical (alphabetical throughout without carbon). */
export function hillKey(counts) {
  const syms = [...counts.keys()].filter((s) => counts.get(s) > 0).sort();
  const order = counts.get('C') ? ['C', ...(counts.get('H') ? ['H'] : []), ...syms.filter((s) => s !== 'C' && s !== 'H')] : syms;
  return order.map((s) => s + (counts.get(s) > 1 ? counts.get(s) : '')).join('');
}

/** "2−", "+", or "" for a charge. */
export const chargeText = (q) => (q ? `${Math.abs(q) > 1 ? Math.abs(q) : ''}${q > 0 ? '+' : '−'}` : '');

export const formulaHTML = (str, charge = 0) =>
  str.replace(/(\d+)/g, '<sub>$1</sub>') + (charge ? `<sup>${chargeText(charge)}</sup>` : '');

export function valenceElectrons(symbol) {
  const el = BY_SYMBOL.get(symbol);
  if (!el) return null;
  if (el.z === 2) return 2;
  if (el.row > 7) return null;
  if (el.col <= 2) return el.col;
  if (el.col >= 13) return el.col - 10;
  return null; // transition metals: not handled by simple Lewis/VSEPR rules
}

function bondLength(a, b, order) {
  const r = (COVALENT_RADIUS[a] ?? 1.4) + (COVALENT_RADIUS[b] ?? 1.4);
  const factors = [1, 1, 0.87, 0.78];
  const lo = Math.floor(order), hi = Math.ceil(order);
  const f = factors[lo] + (factors[hi] - factors[lo]) * (order - lo);
  return r * f;
}

// ---------- VSEPR ----------

export const SHAPES = {
  '1,0': 'Linear', '1,1': 'Linear', '1,2': 'Linear', '1,3': 'Linear',
  '2,0': 'Linear', '2,1': 'Bent', '2,2': 'Bent', '2,3': 'Linear',
  '3,0': 'Trigonal planar', '3,1': 'Trigonal pyramidal', '3,2': 'T-shaped', '3,3': 'T-shaped',
  '4,0': 'Tetrahedral', '4,1': 'Seesaw', '4,2': 'Square planar',
  '5,0': 'Trigonal bipyramidal', '5,1': 'Square pyramidal',
  '6,0': 'Octahedral',
};

/**
 * Bond and lone-pair directions around a central atom with nL ligands and
 * E lone domains. `angle`/`angle2` override the typical angles (see molecule-data.js).
 */
function vseprDirections(nL, E, angle, angle2) {
  const sn = nL + E;
  const polar = (theta, phi, zSign = 1) => [Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi), zSign * Math.cos(theta)];

  if (nL === 1) return { bonds: [[1, 0, 0]], lps: null }; // diatomic: lone pairs placed later
  if (sn === 2) return { bonds: [[1, 0, 0], [-1, 0, 0]], lps: [] };

  if (sn === 3) {
    const t = (angle ?? (E ? 118 : 120)) * DEG / 2;
    const pair = [[Math.cos(t), Math.sin(t), 0], [Math.cos(t), -Math.sin(t), 0]];
    return E === 0 ? { bonds: [...pair, [-1, 0, 0]], lps: [] } : { bonds: pair, lps: [[-1, 0, 0]] };
  }

  if (sn === 4) {
    if (E === 0) {
      const a = Math.acos(-1 / 3);
      return { bonds: [[0, 0, 1], ...[0, 120, 240].map((p) => polar(a, p * DEG))], lps: [] };
    }
    if (E === 1) {
      const cosT = Math.cos((angle ?? 107) * DEG);
      const a = Math.asin(Math.sqrt((1 - cosT) / 1.5));
      return { bonds: [0, 120, 240].map((p) => polar(a, p * DEG, -1)), lps: [[0, 0, 1]] };
    }
    if (E === 2) {
      const t = (angle ?? 104.5) * DEG / 2;
      const l = 54.75 * DEG;
      return {
        bonds: [[Math.sin(t), 0, -Math.cos(t)], [-Math.sin(t), 0, -Math.cos(t)]],
        lps: [[0, Math.sin(l), Math.cos(l)], [0, -Math.sin(l), Math.cos(l)]],
      };
    }
  }

  if (sn === 5) {
    const eq = [0, 120, 240].map((p) => [Math.cos(p * DEG), Math.sin(p * DEG), 0]);
    if (E === 0) return { bonds: [...eq, [0, 0, 1], [0, 0, -1]], lps: [] };
    if (E === 1) { // seesaw: lone pair equatorial along +x
      const half = (angle ?? 102) * DEG / 2;
      const d = (180 - (angle2 ?? 173)) * DEG / 2;
      return {
        bonds: [
          [-Math.cos(half), Math.sin(half), 0], [-Math.cos(half), -Math.sin(half), 0],
          [-Math.sin(d), 0, Math.cos(d)], [-Math.sin(d), 0, -Math.cos(d)],
        ],
        lps: [[1, 0, 0]],
      };
    }
    if (E === 2) { // T-shaped: angle = axial–equatorial bond angle
      const d = (90 - (angle ?? 87.5)) * DEG;
      return {
        bonds: [[-1, 0, 0], [-Math.sin(d), 0, Math.cos(d)], [-Math.sin(d), 0, -Math.cos(d)]],
        lps: [[0.5, Math.sqrt(3) / 2, 0], [0.5, -Math.sqrt(3) / 2, 0]],
      };
    }
    return { bonds: [[0, 0, 1], [0, 0, -1]], lps: eq }; // linear AX2E3
  }

  if (sn === 6) {
    if (E === 1) { // square pyramidal: angle = apical–basal bond angle
      const a = (angle ?? 85) * DEG;
      return { bonds: [[0, 0, 1], ...[0, 90, 180, 270].map((p) => polar(a, p * DEG))], lps: [[0, 0, -1]] };
    }
    const sites = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
    return { bonds: sites.slice(E), lps: sites.slice(0, E) };
  }
  throw new BuildError('That many electron domains around one atom is beyond simple VSEPR.');
}

function fromVSEPR(counts, known, charge = 0) {
  const symbols = [...counts].flatMap(([s, n]) => Array(n).fill(s));
  if (symbols.length < 2) throw new BuildError('Add at least two atoms to make a molecule.');
  for (const s of new Set(symbols)) {
    if (valenceElectrons(s) == null) {
      throw new BuildError(`${BY_SYMBOL.get(s).name} is a transition or inner-transition metal. The builder covers main-group elements, whose bonding follows the octet/VSEPR rules.`);
    }
  }

  const heavy = symbols.filter((s) => s !== 'H');
  let center = known?.center;
  if (!center) {
    if (!heavy.length) {
      if (symbols.length !== 2) throw new BuildError('Hydrogen alone only forms H₂.');
      center = 'H';
    } else {
      center = [...new Set(heavy)].sort((a, b) => (ELECTRONEGATIVITY[a] ?? 2) - (ELECTRONEGATIVITY[b] ?? 2))[0];
    }
  }
  const ligSyms = [...symbols];
  ligSyms.splice(ligSyms.indexOf(center), 1);
  if (ligSyms.length > 6) {
    throw new BuildError('A formula alone doesn’t say how these atoms connect, and there’s no molecule with this formula in the library. Type a name or a SMILES string (which spells out the connections) in the search box, e.g. CCCCC for pentane.');
  }

  const valence = symbols.reduce((sum, s) => sum + valenceElectrons(s), 0) - charge;
  const lig = ligSyms.map((symbol) => ({ symbol, order: 1, lp: 0 }));
  let left = valence - 2 * lig.length;
  if (left < 0) throw new BuildError('There aren’t enough valence electrons to bond every atom to one center.');
  for (const l of lig) {
    if (l.symbol === 'H') continue;
    const give = Math.min(3, Math.floor(left / 2));
    l.lp = give;
    left -= 2 * give;
  }
  let lp = Math.floor(left / 2);
  const single = left % 2;
  const centerElectrons = () => 2 * lig.reduce((s, l) => s + l.order, 0) + 2 * lp + single;

  // Share terminal lone pairs as multiple bonds until the center has an octet.
  const rank = { O: 0, N: 1, C: 2, S: 3 };
  if (!['H', 'B', 'Be', 'Al'].includes(center)) {
    while (8 - centerElectrons() >= 2) {
      const cands = lig.filter((l) => l.symbol !== 'H' && l.lp > 0 && !HALOGENS.has(l.symbol));
      if (!cands.length) break;
      cands.sort((a, b) => a.order - b.order || (rank[a.symbol] ?? 9) - (rank[b.symbol] ?? 9));
      cands[0].order++;
      cands[0].lp--;
    }
  }

  const el = BY_SYMBOL.get(center);
  if ((center === 'H' && centerElectrons() > 2) || (el.row === 2 && centerElectrons() > 8)) {
    throw new BuildError(`${el.name} is in period ${el.row} and can’t hold more than ${center === 'H' ? 2 : 8} electrons, so it can’t bond to all of these atoms.`);
  }
  for (const l of lig) {
    if (l.symbol !== 'H' && 2 * l.order + 2 * l.lp !== 8) {
      throw new BuildError('These atoms don’t form a stable neutral molecule around one central atom (it may be an ion or need a different arrangement).');
    }
  }

  // Equivalent ligands with different bond orders are resonance forms: average them.
  for (const sym of new Set(lig.map((l) => l.symbol))) {
    const group = lig.filter((l) => l.symbol === sym);
    const orders = new Set(group.map((l) => l.order));
    if (orders.size > 1) {
      const avg = group.reduce((s, l) => s + l.order, 0) / group.length;
      const minLp = Math.min(...group.map((l) => l.lp));
      for (const l of group) { l.order = Math.round(avg * 100) / 100; l.lp = minLp; }
    }
  }

  const E = lp + single;
  const nL = lig.length;
  // Put the like pair first so an AX₃ angle override (e.g. H–C–H) applies to it.
  if (nL === 3) {
    const pairSym = [...new Set(ligSyms)].find((s) => ligSyms.filter((x) => x === s).length === 2);
    if (pairSym) lig.sort((a, b) => (b.symbol === pairSym) - (a.symbol === pairSym));
  }
  const dirs = vseprDirections(nL, E, known?.angle, known?.angle2);

  const atoms = [{ symbol: center, pos: [0, 0, 0], lp, single, lpDirs: dirs.lps }];
  const bonds = [];
  lig.forEach((l, i) => {
    const length = known?.lengths?.[l.symbol] ?? bondLength(center, l.symbol, l.order);
    atoms.push({ symbol: l.symbol, pos: scale(dirs.bonds[i], length), lp: l.lp, single: 0, lpDirs: null });
    bonds.push({ a: 0, b: i + 1, order: l.order });
  });

  return {
    name: known?.name ?? null,
    formula: known?.formula ?? conventionalFormula(center, lig.map((l) => l.symbol)),
    source: known ? 'experimental' : 'vsepr',
    vsepr: nL > 1 ? `AX<sub>${nL}</sub>${E ? `E${E > 1 ? `<sub>${E}</sub>` : ''}` : ''}` : null,
    shape: SHAPES[`${nL},${E}`] ?? null,
    atoms,
    bonds,
  };
}

// ---------- ionic compounds ----------

const isMetalCation = (s) => {
  const el = BY_SYMBOL.get(s);
  return el && el.row <= 7 && (el.col === 1 || el.col === 2) && s !== 'H' && s !== 'Be';
};

/** Charge a nonmetal takes as a simple anion (Cl⁻, O²⁻, N³⁻, H⁻), or null. */
function anionCharge(s) {
  if (s === 'H') return -1;
  const el = BY_SYMBOL.get(s);
  if (!el || el.row > 7) return null;
  if (el.col === 17) return -1;
  if (el.col === 16 && s !== 'Po') return -2;
  if (s === 'N' || s === 'P') return -3;
  return null;
}

const ionLabel = (s, q) => `${s}<sup>${chargeText(q)}</sup>`;
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** A metal from groups 1–2 combined with nonmetals: bonded by charge, not shared pairs. */
export function isIonicCombo(counts) {
  const syms = [...counts.keys()].filter((s) => counts.get(s) > 0);
  return syms.some(isMetalCation) && syms.some((s) => !isMetalCation(s));
}

function fromIonic(counts, known) {
  const syms = [...counts.keys()].filter((s) => counts.get(s) > 0);
  const metals = syms.filter(isMetalCation);
  if (syms.length !== 2 || metals.length !== 1) {
    throw new BuildError('Salts with more than two elements contain polyatomic ions (like OH⁻ or CO₃²⁻). Build the polyatomic ion on its own and set its charge.');
  }
  const cat = metals[0];
  const an = syms.find((s) => s !== cat);
  const qc = BY_SYMBOL.get(cat).col;
  const qa = anionCharge(an);
  if (qa == null) {
    throw new BuildError(`${BY_SYMBOL.get(an).name} doesn’t form a simple anion, so it won’t make an ionic compound with ${BY_SYMBOL.get(cat).name.toLowerCase()}.`);
  }
  const nc = counts.get(cat), na = counts.get(an);
  if (nc * qc + na * qa !== 0) {
    const l = (qc * -qa) / gcd(qc, -qa);
    const fc = l / qc, fa = l / -qa;
    const balanced = `${cat}${fc > 1 ? fc : ''}${an}${fa > 1 ? fa : ''}`;
    throw new BuildError(`${BY_SYMBOL.get(cat).name} forms ${ionLabel(cat, qc)} and ${BY_SYMBOL.get(an).name.toLowerCase()} forms ${ionLabel(an, qa)}. Their charges only balance as ${formulaHTML(balanced)}.`);
  }
  let center, ligand, nL;
  if (nc === 1) [center, ligand, nL] = [cat, an, na];
  else if (na === 1) [center, ligand, nL] = [an, cat, nc];
  else throw new BuildError('This compound only exists as an extended crystal lattice, with no small unit to show on its own.');
  if (nL > 4) throw new BuildError('Too many ions to arrange around one center.');

  const charge = (s) => (s === cat ? qc : qa);
  const dirs = vseprDirections(nL, 0);
  const atoms = [{ symbol: center, pos: [0, 0, 0], lp: 0, single: 0, lpDirs: [], charge: charge(center) }];
  const bonds = [];
  for (let i = 0; i < nL; i++) {
    const length = known?.lengths?.[ligand] ?? 0.83 * ((IONIC_RADIUS[cat] ?? 1.2) + (IONIC_RADIUS[an] ?? 1.6));
    atoms.push({ symbol: ligand, pos: scale(dirs.bonds[i], length), lp: 0, single: 0, lpDirs: [], charge: charge(ligand) });
    // Electrons moving across this contact: the center's charge shared among its neighbors.
    bonds.push({ a: 0, b: i + 1, order: 1, ionic: true, transfer: Math.abs(charge(center)) / nL });
  }
  return {
    name: known?.name ?? null,
    formula: known?.formula ?? `${cat}${nc > 1 ? nc : ''}${an}${na > 1 ? na : ''}`,
    source: known ? 'experimental' : 'ionic',
    ionic: true,
    cation: { symbol: cat, charge: qc },
    anion: { symbol: an, charge: qa },
    vsepr: null,
    shape: SHAPES[`${nL},0`],
    atoms,
    bonds,
  };
}

/** Central atom first (SiF4, PCl5), except hydrides of groups 16–17, written H first (H2Se, HBr). */
function conventionalFormula(center, ligands) {
  const counts = new Map();
  for (const s of ligands) counts.set(s, (counts.get(s) || 0) + 1);
  const part = (s, n) => s + (n > 1 ? n : '');
  const col = BY_SYMBOL.get(center).col;
  if (counts.size === 1 && counts.has('H') && col >= 16) return part('H', counts.get('H')) + center;
  if (counts.has(center)) counts.set(center, counts.get(center) + 1);
  const rest = [...counts].filter(([s]) => s !== center).sort(([a], [b]) => a.localeCompare(b));
  return part(center, (counts.get(center) || 1)) + rest.map(([s, n]) => part(s, n)).join('');
}

// ---------- explicit geometries ----------

/** Place a point from a Z-matrix row (natural extension reference frame). */
function placeAtom(a, b, c, r, theta, phi) {
  const bc = norm(sub(c, b));
  const n = norm(cross(sub(b, a), bc));
  const m = cross(n, bc);
  const d = [-r * Math.cos(theta), r * Math.sin(theta) * Math.cos(phi), r * Math.sin(theta) * Math.sin(phi)];
  return add(c, add(add(scale(bc, d[0]), scale(m, d[1])), scale(n, d[2])));
}

function fromExplicit(known) {
  let positions;
  if (known.coords) {
    positions = known.coords.map(([sym, x, y, z]) => ({ symbol: sym, pos: [x, y, z] }));
  } else {
    positions = [];
    for (const [sym, bi, r, ai, ang, di, dih] of known.zmatrix) {
      let pos;
      if (bi === undefined) pos = [0, 0, 0];
      else if (ai === undefined) pos = [r, 0, 0];
      else {
        const c = positions[bi].pos, b = positions[ai].pos;
        const a = di === undefined ? add(b, [0, 1, 0.01]) : positions[di].pos;
        pos = placeAtom(a, b, c, r, ang * DEG, (dih ?? 0) * DEG);
      }
      positions.push({ symbol: sym, pos });
    }
  }
  const bonds = known.bonds.map(([a, b, order]) => ({ a, b, order }));
  const atoms = positions.map(({ symbol, pos }, i) => {
    const orderSum = bonds.filter((bd) => bd.a === i || bd.b === i).reduce((s, bd) => s + bd.order, 0);
    const lp = Math.max(0, Math.round((valenceElectrons(symbol) - orderSum) / 2));
    return { symbol, pos, lp, single: 0, lpDirs: null };
  });
  return {
    name: known.name, formula: known.formula, source: 'experimental',
    vsepr: null, shape: known.shape ?? null, atoms, bonds,
  };
}

// ---------- SMILES + force field ----------

const graphCache = new Map();
const conformerCache = new Map();

function smilesGraph(smiles) {
  if (!graphCache.has(smiles)) graphCache.set(smiles, parseSmiles(smiles));
  return graphCache.get(smiles);
}

export function smilesCounts(smiles) {
  const counts = new Map();
  for (const a of smilesGraph(smiles).atoms) counts.set(a.symbol, (counts.get(a.symbol) || 0) + 1);
  return counts;
}

const smilesCharge = (smiles) => smilesGraph(smiles).atoms.reduce((q, a) => q + a.charge, 0);

/** Whether the conformers for this SMILES still need computing (slow for big molecules). */
export const needsConformers = (smiles) => !conformerCache.has(smiles);

let worker = null;
const waiting = new Map();

/**
 * Compute conformers in a Web Worker and cache them; resolves when done. Falls back
 * to computing here if workers aren't available. Errors are left for build() to report.
 */
export function computeConformers(smiles) {
  if (conformerCache.has(smiles)) return Promise.resolve();
  if (waiting.has(smiles)) return waiting.get(smiles).promise;
  try {
    worker ??= new Worker(new URL('./conformer-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.conformers) conformerCache.set(data.smiles, data.conformers);
      waiting.get(data.smiles)?.resolve();
      waiting.delete(data.smiles);
    };
  } catch {
    return Promise.resolve(); // build() will compute synchronously
  }
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  waiting.set(smiles, { promise, resolve });
  worker.postMessage({ smiles });
  return promise;
}

function fromSmiles(smiles, known, conformer = 0) {
  const graph = smilesGraph(smiles);
  if (!conformerCache.has(smiles)) conformerCache.set(smiles, generateConformers(graph));
  const conformers = conformerCache.get(smiles);
  const pick = Math.min(Math.max(conformer, 0), conformers.length - 1);
  const coords = conformers[pick].coords;
  const atoms = graph.atoms.map((a, i) => {
    const orderSum = graph.bonds.filter((b) => b.a === i || b.b === i).reduce((s, b) => s + b.order, 0);
    const valence = valenceElectrons(a.symbol) ?? 4;
    const lp = Math.max(0, Math.round((valence - a.charge - orderSum) / 2));
    return { symbol: a.symbol, pos: coords[i], lp, single: 0, lpDirs: null, formalCharge: a.charge };
  });
  const counts = smilesCounts(smiles);
  return {
    name: known?.name ?? null,
    note: known?.note ?? null,
    formula: hillKey(counts),
    source: 'forcefield',
    smiles,
    conformers: conformers.map((c) => c.energy - conformers[0].energy),
    conformer: pick,
    hbondEnergy: conformers[pick].hbondEnergy,
    vsepr: null,
    shape: null,
    atoms,
    bonds: graph.bonds.map(({ a, b, order }) => ({ a, b, order })),
  };
}

// ---------- orbitals, lone pairs, angles ----------

const HYBRID = { 1: 's', 2: 'sp', 3: 'sp²', 4: 'sp³', 5: 'sp³d', 6: 'sp³d²' };

function finish(mol) {
  const { atoms, bonds } = mol;
  const centroid = scale(atoms.reduce((s, a) => add(s, a.pos), [0, 0, 0]), 1 / atoms.length);
  for (const a of atoms) a.pos = sub(a.pos, centroid);

  for (const [i, a] of atoms.entries()) {
    a.z = BY_SYMBOL.get(a.symbol).z;
    a.neighbors = [];
    a.sigmaDirs = [];
    a.piDirs = [];
    for (const bd of bonds) {
      const j = bd.a === i ? bd.b : bd.b === i ? bd.a : -1;
      if (j < 0) continue;
      a.neighbors.push(j);
      a.sigmaDirs.push(norm(sub(atoms[j].pos, a.pos)));
    }
  }

  // A reference plane normal, for planar molecules and delocalized π systems.
  let planeNormal = null;
  for (const a of atoms) {
    for (let p = 0; p < a.sigmaDirs.length && !planeNormal; p++) {
      for (let q = p + 1; q < a.sigmaDirs.length; q++) {
        const c = cross(a.sigmaDirs[p], a.sigmaDirs[q]);
        if (len(c) > 0.2) { planeNormal = norm(c); break; }
      }
    }
  }

  // π bonds: each extra bond order is a p orbital pair perpendicular to the bond.
  const sigmaPlane = (a) => {
    if (a.sigmaDirs.length < 2) return null;
    const c = cross(a.sigmaDirs[0], a.sigmaDirs[1]);
    return len(c) > 0.2 ? norm(c) : null;
  };
  for (const bd of bonds) {
    bd.piDirs = [];
    if (bd.ionic) continue;
    const A = atoms[bd.a], B = atoms[bd.b];
    const axis = norm(sub(B.pos, A.pos));
    if (!Number.isInteger(bd.order)) {
      bd.delocalized = true;
      for (const at of [A, B]) {
        if (!at.piDirs.length) { at.piDirs.push(planeNormal ?? perpendicular(axis)); at.delocalized = true; }
      }
      bd.piDirs.push(A.piDirs[0]);
      continue;
    }
    for (let k = 1; k < bd.order; k++) {
      let dir;
      if (k === 1) {
        dir = sigmaPlane(A) ?? sigmaPlane(B) ?? perpendicular(axis, planeNormal ?? [0, 0, 1]);
        const used = [...A.piDirs, ...B.piDirs];
        if (used.some((u) => Math.abs(dot(u, dir)) > 0.5)) dir = norm(cross(axis, used[0]));
      } else {
        dir = norm(cross(axis, bd.piDirs[0]));
      }
      bd.piDirs.push(dir);
      A.piDirs.push(dir);
      B.piDirs.push(dir);
    }
  }

  // Lone-pair directions for atoms the VSEPR builder didn't place.
  for (const a of atoms) {
    const k = a.lp + a.single;
    a.steric = a.sigmaDirs.length + k;
    a.hybrid = mol.ionic ? null : a.symbol === 'H' ? 's' : HYBRID[Math.max(a.steric, 1)];
    if (a.lpDirs) continue;
    a.lpDirs = [];
    if (!k || !a.sigmaDirs.length) continue;
    const s = a.sigmaDirs;
    const sum = s.reduce((acc, d) => add(acc, d), [0, 0, 0]);
    if (s.length >= 2) {
      const u = len(sum) > 0.1 ? norm(scale(sum, -1)) : (sigmaPlane(a) ?? [0, 0, 1]);
      if (k === 1) a.lpDirs.push(u);
      else {
        const w = sigmaPlane(a) ?? perpendicular(u);
        const t = 54.75 * DEG;
        a.lpDirs.push(norm(combo(u, Math.cos(t), w, Math.sin(t))), norm(combo(u, Math.cos(t), w, -Math.sin(t))));
      }
    } else {
      const b = s[0];
      if (a.steric === 2) a.lpDirs.push(scale(b, -1));
      else if (a.steric === 3) {
        const q = a.piDirs.length ? norm(cross(a.piDirs[0], b)) : perpendicular(b, planeNormal ?? [0, 0, 1]);
        for (const sg of [1, -1]) a.lpDirs.push(norm(combo(b, -0.5, q, sg * Math.sqrt(3) / 2)));
      } else {
        const u = perpendicular(b, planeNormal ?? [0, 0, 1]);
        const v = cross(b, u);
        const t = 109.47 * DEG;
        for (let i = 0; i < k; i++) {
          const phi = (i * 2 * Math.PI) / k;
          a.lpDirs.push(norm(add(scale(b, Math.cos(t)), scale(combo(u, Math.cos(phi), v, Math.sin(phi)), Math.sin(t)))));
        }
      }
    }
  }

  // Distinct bond angles at each atom.
  mol.angles = [];
  for (const [i, a] of atoms.entries()) {
    const seen = new Set();
    for (let p = 0; p < a.neighbors.length; p++) {
      for (let q = p + 1; q < a.neighbors.length; q++) {
        const value = Math.acos(Math.max(-1, Math.min(1, dot(a.sigmaDirs[p], a.sigmaDirs[q])))) / DEG;
        const keyV = value.toFixed(1);
        if (seen.has(keyV)) continue;
        seen.add(keyV);
        mol.angles.push({ vertex: i, a: a.neighbors[p], b: a.neighbors[q], value });
      }
    }
  }
  for (const bd of bonds) bd.length = len(sub(atoms[bd.b].pos, atoms[bd.a].pos));
  mol.electrons = atoms.reduce((s, a) => s + a.z, 0);

  // Hydrogen bonds: H on N/O/F pointing (within 50° of straight) at a lone pair on
  // another N/O/F no more than 2.5 Å away.
  const polar = (s) => s === 'N' || s === 'O' || s === 'F';
  mol.hbonds = [];
  for (const [h, H] of atoms.entries()) {
    if (H.symbol !== 'H' || H.neighbors.length !== 1 || !polar(atoms[H.neighbors[0]].symbol)) continue;
    const d = H.neighbors[0];
    for (const [a, A] of atoms.entries()) {
      if (a === d || !polar(A.symbol) || !A.lp || (A.formalCharge ?? 0) > 0) continue;
      if (A.symbol === 'N' && A.hybrid === 'sp²' && A.neighbors.length === 3) continue; // lone pair in the π system
      const ha = sub(A.pos, H.pos), hd = sub(atoms[d].pos, H.pos);
      const r = len(ha);
      if (r > 2.5) continue;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(ha, hd) / (r * len(hd))))) / DEG;
      if (angle < 130) continue;
      mol.hbonds.push({ d, h, a, length: r, angle, da: len(sub(A.pos, atoms[d].pos)) });
    }
  }
  return mol;
}

const entryKeys = new Map();
function entryKey(m) {
  if (!entryKeys.has(m)) {
    entryKeys.set(m, m.smiles
      ? { key: hillKey(smilesCounts(m.smiles)), charge: smilesCharge(m.smiles) }
      : { key: hillKey(parseFormula(m.formula)), charge: m.charge ?? 0 });
  }
  return entryKeys.get(m);
}

/** Every reference entry with this formula and charge (isomers), in library order. */
export function isomersOf(counts, charge = 0) {
  const key = hillKey(counts);
  return KNOWN_MOLECULES.filter((m) => {
    const k = entryKey(m);
    return k.key === key && k.charge === charge;
  });
}

/** Library entries whose name or aliases match the query (exact matches first). */
export function searchLibrary(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const names = (m) => [m.name, ...(m.aliases ?? [])].filter(Boolean).map((n) => n.toLowerCase());
  const exact = KNOWN_MOLECULES.filter((m) => names(m).includes(q));
  const partial = KNOWN_MOLECULES.filter((m) => !exact.includes(m) && names(m).some((n) => n.includes(q)));
  return [...exact, ...partial];
}

export const entryCounts = (m) => (m.smiles ? smilesCounts(m.smiles) : parseFormula(m.formula));
export const entryCharge = (m) => entryKey(m).charge;

function build(counts, charge, { variant = 0, conformer = 0, smiles = null } = {}) {
  let mol;
  if (smiles) {
    const match = KNOWN_MOLECULES.find((m) => m.smiles === smiles);
    mol = fromSmiles(smiles, match, conformer);
    charge = smilesCharge(smiles);
  } else {
    if (charge !== 0 && isIonicCombo(counts)) {
      throw new BuildError('This combination forms a neutral ionic compound; the charges of its ions already cancel. Set the charge back to 0.');
    }
    const matches = isomersOf(counts, charge);
    const known = matches[Math.min(variant, matches.length - 1)];
    if (known?.smiles) mol = fromSmiles(known.smiles, known, conformer);
    else if (known?.zmatrix || known?.coords) mol = fromExplicit(known);
    else if (charge === 0 && isIonicCombo(counts)) mol = fromIonic(counts, known);
    else mol = fromVSEPR(counts, known, charge);
    if (matches.length > 1) {
      mol.isomers = matches.map((m) => m.name);
      mol.variant = matches.indexOf(known);
    }
    mol.note ??= known?.note ?? null;
    mol.crystal = !!known?.crystal;
  }
  mol.charge = charge;
  finish(mol);
  mol.electrons -= charge;
  return mol;
}

/**
 * Build a molecule or ion from element counts and an overall charge.
 * options: { variant: which isomer, conformer, smiles: build this SMILES instead }.
 * Returns a molecule, { error, formula, suggestCharge? }, or null if empty.
 */
export function buildMolecule(counts, charge = 0, options = {}) {
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  if (!total && !options.smiles) return null;
  try {
    return build(counts, charge, options);
  } catch (e) {
    if (e instanceof SmilesError || e instanceof ForceFieldError) return { error: e.message, formula: options.smiles ?? hillKey(counts), charge };
    if (!(e instanceof BuildError)) throw e;
    const result = { error: e.message, formula: hillKey(counts), charge };
    // Many failures are ions entered without their charge (NH₄, CO₃): suggest one that works.
    for (const q of isIonicCombo(counts) ? [] : [1, -1, -2, 2, -3, 3]) {
      if (q === charge) continue;
      try {
        const mol = build(counts, q);
        result.suggestCharge = q;
        result.suggestFormula = mol.formula;
        result.suggestName = mol.name;
        break;
      } catch (err) {
        if (!(err instanceof BuildError)) throw err;
      }
    }
    return result;
  }
}
