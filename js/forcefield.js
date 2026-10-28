// A small molecular-mechanics force field for turning a bond graph into 3D
// coordinates, in the spirit of UFF/MMFF but much simpler:
//
//   E = Σ kb (r − r₀)²                         bond stretching
//     + Σ ka (cos θ − cos θ₀)²                 angle bending
//     + Σ V/2 · (1 ± cos nφ)                   torsions (staggered sp³, anti > gauche, planar sp²)
//     + Σ ki · V²                              planarity at sp² centers (V = signed volume)
//     + Σ kc · max(0, V₀ − s·V)²               chirality (sign of the neighbors' volume, from @/@@)
//     + Σ kr · max(0, d₀ − d)²                 steric repulsion between non-bonded atoms
//     + Σ D₀ [5(R₀/R)¹² − 6(R₀/R)¹⁰] cos⁴θ · S(R)   hydrogen bonds D–H···A (DREIDING form):
//                                                R = donor–acceptor distance, θ = D–H···A angle,
//                                                S = smooth switch to zero between 3.1 and 3.6 Å
//
// Energies come out roughly in kcal/mol. Coordinates are found by minimizing E
// from several random starts (FIRE minimizer); distinct minima are conformers.

const DEG = Math.PI / 180;

// Typical bond lengths in Å, keyed by "A-B" in alphabetical order plus order.
const BOND_LENGTHS = {
  'C-C1': 1.53, 'C-C1.5': 1.39, 'C-C2': 1.34, 'C-C3': 1.20,
  'C-H1': 1.09, 'H-N1': 1.01, 'H-O1': 0.96, 'H-S1': 1.34, 'H-P1': 1.42,
  'C-O1': 1.43, 'C-O1.5': 1.36, 'C-O2': 1.21,
  'C-N1': 1.47, 'C-N1.5': 1.34, 'C-N2': 1.28, 'C-N3': 1.16,
  'C-S1': 1.82, 'C-S1.5': 1.71, 'C-S2': 1.67,
  'C-F1': 1.35, 'C-Cl1': 1.77, 'Br-C1': 1.94, 'C-I1': 2.14,
  'N-O1': 1.40, 'N-O1.5': 1.24, 'N-O2': 1.21, 'N-N1': 1.45, 'N-N1.5': 1.35, 'N-N2': 1.25, 'N-N3': 1.10,
  'O-O1': 1.48, 'O-P1': 1.60, 'O-P2': 1.48, 'O-S1': 1.58, 'O-S2': 1.45,
};
const COVALENT = { H: 0.32, B: 0.85, C: 0.75, N: 0.71, O: 0.63, F: 0.64, Si: 1.16, P: 1.11, S: 1.03, Cl: 0.99, Br: 1.14, I: 1.33 };
const VDW = { H: 1.10, B: 1.92, C: 1.70, N: 1.55, O: 1.52, F: 1.47, Si: 2.10, P: 1.80, S: 1.80, Cl: 1.75, Br: 1.85, I: 1.98 };

function restLength(a, b, order) {
  const key = [a, b].sort().join('-') + order;
  if (BOND_LENGTHS[key]) return BOND_LENGTHS[key];
  const f = { 1: 1, 1.5: 0.93, 2: 0.87, 3: 0.78 }[order] ?? 1;
  return ((COVALENT[a] ?? 1.2) + (COVALENT[b] ?? 1.2)) * f;
}

// Seeded random numbers so the same molecule gives the same conformers.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class ForceFieldError extends Error {}

/** Hybridization from the bond pattern: 'sp', 'sp2' or 'sp3'. */
export function hybridization(graph) {
  const { atoms, bonds } = graph;
  const orders = atoms.map(() => []);
  for (const b of bonds) { orders[b.a].push(b.order); orders[b.b].push(b.order); }
  const hyb = atoms.map((a, i) => {
    const o = orders[i];
    if (a.symbol === 'H' || a.symbol === 'F' || a.symbol === 'Cl' || a.symbol === 'Br' || a.symbol === 'I') return 'sp3';
    if (o.includes(3) || o.filter((x) => x === 2).length >= 2) return 'sp';
    if (o.includes(2) || o.includes(1.5) || a.aromatic) return 'sp2';
    return 'sp3';
  });
  // Nitrogen next to a π system (amides, anilines) is planar.
  atoms.forEach((a, i) => {
    if (a.symbol === 'N' && hyb[i] === 'sp3' && a.nbrs.length === 3 && a.nbrs.some((j) => hyb[j] !== 'sp3' && atoms[j].symbol !== 'H')) {
      hyb[i] = 'sp2';
    }
  });
  return hyb;
}

/** Bond counts from one atom to every other (Infinity across separate molecules). */
function graphDistances(near, from) {
  const dist = Array(near.length).fill(Infinity);
  dist[from] = 0;
  const queue = [from];
  while (queue.length) {
    const u = queue.shift();
    for (const v of near[u]) if (dist[v] === Infinity) { dist[v] = dist[u] + 1; queue.push(v); }
  }
  return dist;
}

/**
 * Hydrogen-bond donors ({ h, d }: H and the N/O/F it's on) and acceptors
 * (N/O/F with a lone pair free to accept; amide/aniline-type N excluded).
 */
export function hbondSites(graph, hyb = hybridization(graph)) {
  const { atoms } = graph;
  const polar = (s) => s === 'N' || s === 'O' || s === 'F';
  const donors = [];
  const acceptors = [];
  atoms.forEach((a, i) => {
    if (a.symbol === 'H' && a.nbrs.length === 1 && polar(atoms[a.nbrs[0]].symbol)) donors.push({ h: i, d: a.nbrs[0] });
    if (!polar(a.symbol) || a.charge > 0) return;
    if (a.symbol === 'N') {
      const conjugated = hyb[i] === 'sp2' && a.nbrs.length === 3; // lone pair is in the π system
      if (conjugated || a.nbrs.length > 3) return;
    }
    acceptors.push(i);
  });
  return { donors, acceptors };
}

function buildTerms(graph) {
  const { atoms, bonds } = graph;
  const n = atoms.length;
  const hyb = hybridization(graph);
  const bonded = new Set(bonds.map((b) => (b.a < b.b ? `${b.a},${b.b}` : `${b.b},${b.a}`)));
  const isBonded = (i, j) => bonded.has(i < j ? `${i},${j}` : `${j},${i}`);

  for (const a of atoms) {
    if (a.nbrs.length > 4) throw new ForceFieldError(`${a.symbol} with ${a.nbrs.length} bonds isn’t supported when building from SMILES (use the formula builder for hypervalent molecules).`);
  }

  const bondTerms = bonds.map((b) => ({ i: b.a, j: b.b, r0: restLength(atoms[b.a].symbol, atoms[b.b].symbol, b.order), k: 600 }));

  // Smallest ring through a–c–b: shortest path from a to b that avoids c, plus 2.
  const ringSize = (a, c, b) => {
    const dist = new Map([[a, 0]]);
    const queue = [a];
    while (queue.length) {
      const u = queue.shift();
      if (dist.get(u) >= 6) break;
      for (const v of atoms[u].nbrs) {
        if (v === c || dist.has(v)) continue;
        dist.set(v, dist.get(u) + 1);
        if (v === b) return dist.get(v) + 2;
        queue.push(v);
      }
    }
    return Infinity;
  };
  const angleTerms = [];
  for (let c = 0; c < n; c++) {
    const nb = atoms[c].nbrs;
    const pairs = [];
    for (let p = 0; p < nb.length; p++) {
      for (let q = p + 1; q < nb.length; q++) {
        const a = nb[p], b = nb[q];
        const ring = ringSize(a, c, b);
        let theta = null; // null: not set by a small ring
        if (ring === 3) theta = 60;
        else if (ring === 4) theta = 88;
        else if (ring === 5) theta = hyb[c] === 'sp2' ? 108 : 104.5;
        pairs.push({ a, b, theta });
      }
    }
    const ideal = hyb[c] === 'sp' ? 180 : hyb[c] === 'sp2' ? 120
      : { O: 108.5, N: 107.5, S: 99, P: 100 }[atoms[c].symbol] ?? 109.47;
    // A flat atom's three angles add to 360°: what a small ring takes, the others share.
    const fixed = pairs.filter((x) => x.theta != null);
    const free = pairs.filter((x) => x.theta == null);
    const share = hyb[c] === 'sp2' && nb.length === 3 && fixed.length && free.length
      ? (360 - fixed.reduce((sum, x) => sum + x.theta, 0)) / free.length
      : ideal;
    for (const { a, b, theta } of pairs) {
      angleTerms.push({ i: a, j: c, k2: b, cos0: Math.cos((theta ?? share) * DEG), k: 120 });
    }
  }

  const torsionTerms = [];
  for (const bd of bonds) {
    const { a: b, b: c } = bd;
    const flat = bd.order >= 1.5 || (hyb[b] === 'sp2' && hyb[c] === 'sp2');
    if (hyb[b] === 'sp' || hyb[c] === 'sp') continue;
    const outerB = atoms[b].nbrs.filter((x) => x !== c);
    const outerC = atoms[c].nbrs.filter((x) => x !== b);
    if (!outerB.length || !outerC.length) continue;
    let n0, V, sign;
    if (flat) { n0 = 2; V = bd.order >= 1.5 ? 10 : 2.5; sign = -1; } // minima at 0° and 180°
    else if (hyb[b] === 'sp3' && hyb[c] === 'sp3') { n0 = 3; V = 2.8; sign = 1; } // staggered
    else continue;
    const per = V / (outerB.length * outerC.length);
    for (const a of outerB) {
      for (const d of outerC) {
        torsionTerms.push({ i: a, j: b, k2: c, l: d, n: n0, V: per, sign, phase: 0 });
        // Heavy groups prefer anti over gauche (≈0.9 kcal/mol in butane): a 1-fold term.
        if (n0 === 3 && atoms[a].symbol !== 'H' && atoms[d].symbol !== 'H') {
          torsionTerms.push({ i: a, j: b, k2: c, l: d, n: 1, V: 1.2, sign: 1, phase: 0 });
        }
      }
    }
  }

  // cis/trans from / and \ around double bonds.
  for (const bd of bonds) {
    if (bd.order !== 2) continue;
    const ends = [bd.a, bd.b].map((D) => {
      for (const s of bonds) {
        if (!s.dir || (s.a !== D && s.b !== D)) continue;
        const N = s.a === D ? s.b : s.a;
        const sgn = s.b === D ? (s.dir === '/' ? 1 : -1) : (s.dir === '/' ? -1 : 1);
        return { N, sgn };
      }
      return null;
    });
    if (!ends[0] || !ends[1]) continue;
    const trans = ends[0].sgn !== ends[1].sgn;
    // E = V/2 (1 + cos φ) has its minimum at 180° (trans); (1 − cos φ) at 0° (cis).
    torsionTerms.push({ i: ends[0].N, j: bd.a, k2: bd.b, l: ends[1].N, n: 1, V: 40, sign: trans ? 1 : -1, phase: 0 });
  }

  const planarTerms = [];
  const chiralTerms = [];
  atoms.forEach((a, c) => {
    if (hyb[c] === 'sp2' && a.nbrs.length === 3) planarTerms.push({ c, n: a.nbrs, k: 40 });
    if (a.chiral && a.nbrs.length === 4) {
      // Looking from the first neighbor, @ means the other three run counterclockwise,
      // which makes the signed volume of the neighbor tetrahedron,
      // (n1−n0)·((n2−n0)×(n3−n0)), negative. Using all four neighbors (not the
      // center) keeps the center from turning inside out to satisfy it.
      chiralTerms.push({ c, n: a.nbrs, s: a.chiral === '@' ? -1 : 1, v0: 2.5, k: 20 });
    }
  });

  // Non-bonded pairs: everything not 1-2 or 1-3.
  const near = Array.from({ length: n }, () => new Set());
  for (const b of bonds) { near[b.a].add(b.b); near[b.b].add(b.a); }
  const within2 = near.map((s, i) => {
    const out = new Set(s);
    for (const j of s) for (const k of near[j]) out.add(k);
    out.delete(i);
    return out;
  });
  // Hydrogen bonds: H on N/O/F (donor) toward an N/O/F with a lone pair (acceptor),
  // at least four bonds apart (or in a different molecule).
  const { donors, acceptors } = hbondSites(graph, hyb);
  const hbondTerms = [];
  for (const { h, d } of donors) {
    const dist = graphDistances(near, h);
    for (const a of acceptors) {
      if (a === d || dist[a] < 4) continue;
      // Typical donor–acceptor distances: O–H···O 2.85 Å, N–H···O 2.9 Å, N–H···N 3.0 Å.
      const R0 = { OO: 2.85, ON: 2.9, NO: 2.9, NN: 3.0 }[atoms[d].symbol + atoms[a].symbol] ?? 2.85;
      hbondTerms.push({ d, h, a, D0: 4.5, R0 });
    }
  }
  const isHbondPair = (i, j) => hbondTerms.some((t) => (t.h === i && t.a === j) || (t.h === j && t.a === i));
  const isDonorAcceptor = (i, j) => hbondTerms.some((t) => (t.d === i && t.a === j) || (t.d === j && t.a === i));

  const pairTerms = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (within2[i].has(j)) continue;
      const is14 = [...near[i]].some((x) => [...near[x]].some((y) => near[y].has(j)));
      let d0 = ((VDW[atoms[i].symbol] ?? 1.8) + (VDW[atoms[j].symbol] ?? 1.8)) * (is14 ? 0.62 : 0.78);
      if (isHbondPair(i, j)) d0 = 1.55; // let H approach the acceptor's lone pair
      else if (isDonorAcceptor(i, j)) d0 = Math.min(d0, 2.45);
      pairTerms.push({ i, j, d0, k: 12 });
    }
  }
  return { n, hyb, bondTerms, angleTerms, torsionTerms, planarTerms, chiralTerms, pairTerms, hbondTerms };
}

/**
 * Energy and gradient (written into g) for coordinates x (Float64Array of 3n).
 * phase 0: soft angles and strong chirality, so wrongly handed centers can flip;
 * phase 1: full bonds and angles; phase 2: adds torsions and steric repulsion.
 */
function evaluate(T, x, g, phase) {
  const angleScale = phase === 0 ? 0.08 : 1;
  const chiralScale = phase === 0 ? 4 : 1;
  g.fill(0);
  let E = 0;
  const v = (i) => [x[3 * i], x[3 * i + 1], x[3 * i + 2]];
  const addG = (i, a, s) => { g[3 * i] += a[0] * s; g[3 * i + 1] += a[1] * s; g[3 * i + 2] += a[2] * s; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  for (const t of T.bondTerms) {
    const d = sub(v(t.i), v(t.j));
    const r = Math.hypot(...d) || 1e-9;
    const dr = r - t.r0;
    E += t.k * dr * dr;
    const f = (2 * t.k * dr) / r;
    addG(t.i, d, f); addG(t.j, d, -f);
  }

  for (const t of T.angleTerms) {
    const u = sub(v(t.i), v(t.j)), w = sub(v(t.k2), v(t.j));
    const lu = Math.hypot(...u) || 1e-9, lw = Math.hypot(...w) || 1e-9;
    const cos = dot(u, w) / (lu * lw);
    const dc = cos - t.cos0;
    const ka = t.k * angleScale;
    E += ka * dc * dc;
    const f = 2 * ka * dc;
    const da = [w[0] / (lu * lw) - (cos * u[0]) / (lu * lu), w[1] / (lu * lw) - (cos * u[1]) / (lu * lu), w[2] / (lu * lw) - (cos * u[2]) / (lu * lu)];
    const dcv = [u[0] / (lu * lw) - (cos * w[0]) / (lw * lw), u[1] / (lu * lw) - (cos * w[1]) / (lw * lw), u[2] / (lu * lw) - (cos * w[2]) / (lw * lw)];
    addG(t.i, da, f); addG(t.k2, dcv, f);
    addG(t.j, [da[0] + dcv[0], da[1] + dcv[1], da[2] + dcv[2]], -f);
  }

  if (phase >= 2) {
    for (const t of T.torsionTerms) {
      // Dihedral i-j-k-l and its gradient (Blondel & Karplus 1996).
      const F = sub(v(t.i), v(t.j)), G = sub(v(t.j), v(t.k2)), H = sub(v(t.l), v(t.k2));
      const A = cross(F, G), B = cross(H, G);
      const A2 = dot(A, A), B2 = dot(B, B), lG = Math.hypot(...G);
      if (A2 < 1e-8 || B2 < 1e-8 || lG < 1e-8) continue;
      const phi = Math.atan2(dot(cross(B, A), G) / lG, dot(A, B));
      E += (t.V / 2) * (1 + t.sign * Math.cos(t.n * phi));
      const dEdphi = (-t.V / 2) * t.sign * t.n * Math.sin(t.n * phi);
      const FG = dot(F, G), HG = dot(H, G);
      addG(t.i, A, dEdphi * (-lG / A2));
      addG(t.l, B, dEdphi * (lG / B2));
      addG(t.j, A, dEdphi * (lG / A2 + FG / (A2 * lG)));
      addG(t.j, B, dEdphi * (-HG / (B2 * lG)));
      addG(t.k2, B, dEdphi * (HG / (B2 * lG) - lG / B2));
      addG(t.k2, A, dEdphi * (-FG / (A2 * lG)));
    }
  }

  // Signed volume V = a·(b×c) with a,b,c measured from a center.
  const volume = (c, n1, n2, n3) => {
    const pc = v(c), a = sub(v(n1), pc), b = sub(v(n2), pc), d = sub(v(n3), pc);
    const bc = cross(b, d), ca = cross(d, a), ab = cross(a, b);
    return { V: dot(a, bc), ga: bc, gb: ca, gc: ab };
  };
  const addVolumeGrad = (c, n1, n2, n3, vol, s) => {
    addG(n1, vol.ga, s); addG(n2, vol.gb, s); addG(n3, vol.gc, s);
    addG(c, [vol.ga[0] + vol.gb[0] + vol.gc[0], vol.ga[1] + vol.gb[1] + vol.gc[1], vol.ga[2] + vol.gb[2] + vol.gc[2]], -s);
  };

  for (const t of T.planarTerms) {
    const vol = volume(t.c, ...t.n);
    E += t.k * vol.V * vol.V;
    addVolumeGrad(t.c, ...t.n, vol, 2 * t.k * vol.V);
  }
  for (const t of T.chiralTerms) {
    const vol = volume(t.n[0], t.n[1], t.n[2], t.n[3]);
    const gap = t.v0 - t.s * vol.V;
    if (gap > 0) {
      const kc = t.k * chiralScale;
      E += kc * gap * gap;
      addVolumeGrad(t.n[0], t.n[1], t.n[2], t.n[3], vol, -2 * kc * gap * t.s);
    }
  }

  if (phase >= 2) {
    const RON = 3.1, ROFF = 3.6;
    for (const t of T.hbondTerms) {
      const pd = v(t.d), ph = v(t.h), pa = v(t.a);
      const da = sub(pd, pa);
      const R = Math.hypot(...da) || 1e-9;
      if (R >= ROFF) continue;
      // Angle at H between H→D and H→A; linear (cos = −1) is best.
      const u = sub(pd, ph), w = sub(pa, ph);
      const lu = Math.hypot(...u) || 1e-9, lw = Math.hypot(...w) || 1e-9;
      const cos = dot(u, w) / (lu * lw);
      if (cos >= 0) continue; // D–H···A bent past 90°: no bond
      const wAng = cos ** 4;
      const q = t.R0 / R;
      const q10 = q ** 10, q12 = q10 * q * q;
      const U = 5 * q12 - 6 * q10;
      const dU = (-60 * q12 + 60 * q10) / R;
      let S = 1, dS = 0;
      if (R > RON) {
        const r2 = R * R, on2 = RON * RON, off2 = ROFF * ROFF, den = (off2 - on2) ** 3;
        S = ((off2 - r2) ** 2 * (off2 + 2 * r2 - 3 * on2)) / den;
        dS = (12 * R * (off2 - r2) * (on2 - r2)) / den;
      }
      E += t.D0 * U * S * wAng;
      const fR = (t.D0 * (dU * S + U * dS) * wAng) / R; // dE/dR, along D−A
      addG(t.d, da, fR); addG(t.a, da, -fR);
      const fc = t.D0 * U * S * 4 * cos ** 3; // dE/dcos
      const gd = [w[0] / (lu * lw) - (cos * u[0]) / (lu * lu), w[1] / (lu * lw) - (cos * u[1]) / (lu * lu), w[2] / (lu * lw) - (cos * u[2]) / (lu * lu)];
      const ga = [u[0] / (lu * lw) - (cos * w[0]) / (lw * lw), u[1] / (lu * lw) - (cos * w[1]) / (lw * lw), u[2] / (lu * lw) - (cos * w[2]) / (lw * lw)];
      addG(t.d, gd, fc); addG(t.a, ga, fc);
      addG(t.h, [gd[0] + ga[0], gd[1] + ga[1], gd[2] + ga[2]], -fc);
    }
    for (const t of T.pairTerms) {
      const d = sub(v(t.i), v(t.j));
      const r = Math.hypot(...d) || 1e-9;
      if (r >= t.d0) continue;
      const dr = t.d0 - r;
      E += t.k * dr * dr;
      const f = (-2 * t.k * dr) / r;
      addG(t.i, d, f); addG(t.j, d, -f);
    }
  }
  return E;
}

/** FIRE minimization (Bitzek et al. 2006) with a per-atom step cap. */
function minimize(T, x, steps, phase) {
  const g = new Float64Array(x.length);
  const vel = new Float64Array(x.length);
  let dt = 0.01, alpha = 0.1, npos = 0;
  const dtMax = 0.04;
  let E = 0;
  for (let s = 0; s < steps; s++) {
    E = evaluate(T, x, g, phase);
    let P = 0, vn = 0, fn = 0, fmax = 0;
    for (let i = 0; i < x.length; i++) {
      P -= g[i] * vel[i]; vn += vel[i] * vel[i]; fn += g[i] * g[i];
      fmax = Math.max(fmax, Math.abs(g[i]));
    }
    if (fmax < 0.02) break;
    vn = Math.sqrt(vn); fn = Math.sqrt(fn) || 1;
    if (P > 0) {
      for (let i = 0; i < x.length; i++) vel[i] = (1 - alpha) * vel[i] - (alpha * vn * g[i]) / fn;
      if (++npos > 5) { dt = Math.min(dt * 1.1, dtMax); alpha *= 0.99; }
    } else {
      vel.fill(0); dt *= 0.5; alpha = 0.1; npos = 0;
    }
    for (let i = 0; i < x.length; i++) vel[i] -= g[i] * dt;
    for (let a = 0; a < x.length; a += 3) {
      let dx = vel[a] * dt, dy = vel[a + 1] * dt, dz = vel[a + 2] * dt;
      const len = Math.hypot(dx, dy, dz);
      if (len > 0.2) { const s2 = 0.2 / len; dx *= s2; dy *= s2; dz *= s2; }
      x[a] += dx; x[a + 1] += dy; x[a + 2] += dz;
    }
  }
  return E;
}

/** Atom index lists, one per separate molecule. */
function fragmentLists(graph) {
  const seen = new Set();
  const lists = [];
  graph.atoms.forEach((_, i) => {
    if (seen.has(i)) return;
    const list = [];
    const stack = [i];
    while (stack.length) {
      const u = stack.pop();
      if (seen.has(u)) continue;
      seen.add(u);
      list.push(u);
      stack.push(...graph.atoms[u].nbrs);
    }
    lists.push(list);
  });
  return lists;
}

const countFragments = (graph) => fragmentLists(graph).length;

/** Rotation matrix taking unit vector a onto unit vector b, then spinning by `spin` about b. */
function alignRotation(a, b, spin) {
  const rot = (axis, t) => {
    const [x, y, z] = axis, c = Math.cos(t), s = Math.sin(t), C = 1 - c;
    return [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
  };
  const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
  let axis = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sinT = Math.hypot(...axis), cosT = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (sinT < 1e-6) axis = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]];
  const an = Math.hypot(...axis);
  axis = axis.map((v) => v / an);
  return mul(rot(b, spin), rot(axis, Math.atan2(sinT, cosT)));
}

/** Move one molecule so acceptor a sits 1.95 Å out along D→H, lone pair facing the H. */
function dockAcceptor(x, graph, fragAtoms, d, h, a, spin) {
  const P = (i) => [x[3 * i], x[3 * i + 1], x[3 * i + 2]];
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
  const u = norm(P(h).map((c, k) => c - P(d)[k]));
  const nb = graph.atoms[a].nbrs;
  const mid = nb.reduce((acc, i) => acc.map((c, k) => c + P(i)[k] / nb.length), [0, 0, 0]);
  const lonePair = norm(P(a).map((c, k) => c - mid[k])); // points away from the acceptor's bonds
  const R = alignRotation(lonePair, u.map((c) => -c), spin);
  const pa = P(a);
  const target = P(h).map((c, k) => c + 1.95 * u[k]);
  for (const i of fragAtoms) {
    const p = P(i).map((c, k) => c - pa[k]);
    for (let k = 0; k < 3; k++) x[3 * i + k] = target[k] + R[k][0] * p[0] + R[k][1] * p[1] + R[k][2] * p[2];
  }
}

/** Rigidly rotate (up to ~70°) and shift (up to ~1 Å) one molecule about its centroid. */
function perturbFragment(x, atomsIdx, rand) {
  const c = [0, 0, 0];
  for (const i of atomsIdx) for (let k = 0; k < 3; k++) c[k] += x[3 * i + k] / atomsIdx.length;
  const axis = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
  const al = Math.hypot(...axis) || 1;
  const [ux, uy, uz] = axis.map((v) => v / al);
  const t = (rand() - 0.5) * 2.4;
  const cs = Math.cos(t), sn = Math.sin(t), C = 1 - cs;
  const R = [
    [cs + ux * ux * C, ux * uy * C - uz * sn, ux * uz * C + uy * sn],
    [uy * ux * C + uz * sn, cs + uy * uy * C, uy * uz * C - ux * sn],
    [uz * ux * C - uy * sn, uz * uy * C + ux * sn, cs + uz * uz * C],
  ];
  const shift = [rand() - 0.5, rand() - 0.5, rand() - 0.5].map((v) => v * 2);
  for (const i of atomsIdx) {
    const p = [x[3 * i] - c[0], x[3 * i + 1] - c[1], x[3 * i + 2] - c[2]];
    for (let k = 0; k < 3; k++) x[3 * i + k] = c[k] + shift[k] + R[k][0] * p[0] + R[k][1] * p[1] + R[k][2] * p[2];
  }
}

/** Heavy-atom distance-matrix difference, used to tell conformers apart. */
function shapeDistance(x, y, heavy) {
  let sum = 0, count = 0;
  for (let p = 0; p < heavy.length; p++) {
    for (let q = p + 1; q < heavy.length; q++) {
      const i = heavy[p], j = heavy[q];
      const dx = Math.hypot(x[3 * i] - x[3 * j], x[3 * i + 1] - x[3 * j + 1], x[3 * i + 2] - x[3 * j + 2]);
      const dy = Math.hypot(y[3 * i] - y[3 * j], y[3 * i + 1] - y[3 * j + 1], y[3 * i + 2] - y[3 * j + 2]);
      sum += (dx - dy) ** 2; count++;
    }
  }
  return count ? Math.sqrt(sum / count) : 0;
}

/**
 * Generate low-energy conformers for a parsed molecule graph.
 * Returns [{ coords: [[x,y,z], ...], energy }] sorted by energy (kcal/mol, rough).
 */
export function generateConformers(graph, { starts, maxConformers = 6, seed = 7 } = {}) {
  const T = buildTerms(graph);
  const n = T.n;
  const fragments = countFragments(graph);
  starts ??= fragments > 1 ? 6 : n > 30 ? 8 : 14;
  const rand = mulberry32(seed);
  const heavy = graph.atoms.map((a, i) => (a.symbol === 'H' ? -1 : i)).filter((i) => i >= 0);
  const found = [];
  const box = 1.6 * Math.cbrt(n) + 1;

  for (let s = 0; s < starts; s++) {
    const x = new Float64Array(3 * n);
    for (let i = 0; i < x.length; i++) x[i] = (rand() - 0.5) * box;
    minimize(T, x, 500, 0); // get every stereocenter the right way round
    minimize(T, x, 500, 1); // bonds, angles, planarity, chirality
    const E = minimize(T, x, 2500, 2); // everything
    found.push({ x, energy: E });
  }
  found.sort((a, b) => a.energy - b.energy);

  // Several molecules: dock them by their hydrogen bonds. For every donor H and
  // acceptor on another molecule, turn the acceptor's lone pair toward the H at
  // H-bond distance (in two orientations), then relax.
  if (fragments > 1) {
    const frags = fragmentLists(graph);
    const fragOf = new Map(frags.flatMap((list, f) => list.map((i) => [i, f])));
    const base = found[0].x;
    const pairs = new Set(T.hbondTerms.filter((t) => fragOf.get(t.h) !== fragOf.get(t.a)).map((t) => `${t.d},${t.h},${t.a}`));
    for (const key of pairs) {
      const [d, h, a] = key.split(',').map(Number);
      for (const spin of [0, Math.PI]) {
        const y = base.slice();
        dockAcceptor(y, graph, frags[fragOf.get(a)], d, h, a, spin);
        const E = minimize(T, y, 2000, 2);
        found.push({ x: y, energy: E });
      }
    }
    found.sort((p, q) => p.energy - q.energy);

    // Then refine the best few by basin hopping: rotate and shift one molecule at
    // random, re-relax, and keep the result if the energy drops.
    for (const f of found.slice(0, 3)) {
      for (let hop = 0; hop < 25; hop++) {
        const y = f.x.slice();
        perturbFragment(y, frags[Math.floor(rand() * frags.length)], rand);
        const E = minimize(T, y, 1500, 2);
        if (E < f.energy - 1e-3) { f.x = y; f.energy = E; }
      }
    }
    found.sort((a, b) => a.energy - b.energy);
  }

  const unique = [];
  for (const f of found) {
    if (f.energy > found[0].energy + 20) break; // a start that got stuck, not a real conformer
    const dup = (u) => {
      const dE = Math.abs(u.energy - f.energy);
      return dE < 0.1 || (dE < 0.3 && shapeDistance(u.x, f.x, heavy) < 0.15);
    };
    if (unique.some(dup)) continue;
    unique.push(f);
    if (unique.length >= maxConformers) break;
  }
  const hbOnly = { ...T, bondTerms: [], angleTerms: [], torsionTerms: [], planarTerms: [], chiralTerms: [], pairTerms: [] };
  return unique.map(({ x, energy }) => ({
    energy,
    hbondEnergy: evaluate(hbOnly, x, new Float64Array(x.length), 2),
    coords: Array.from({ length: n }, (_, i) => [x[3 * i], x[3 * i + 1], x[3 * i + 2]]),
  }));
}

// Exposed for tests.
export const _internal = { buildTerms, evaluate };
