// Molecular orbitals by Extended Hückel Theory (Hoffmann 1963).
//
//   Basis: valence Slater-type orbitals, each fit by three Gaussians (STO-3G), so
//          overlap integrals S_ij have exact closed forms.
//   H_ii = −(valence-state ionization energy) of that orbital
//   H_ij = K · S_ij · (H_ii + H_jj) / 2,  K = 1.75 (Wolfsberg–Helmholz)
//   Solve H C = S C E for MO energies E and coefficients C.
//
// It is qualitative (no electron–electron repulsion is computed), but it gets MO
// shapes, orderings, bonding/antibonding character and π systems right for most
// molecules, which is what it's used for in teaching.

const BOHR = 0.529177; // Å
const K_WH = 1.75;

// Hoffmann-style parameters: per valence shell, [n, l, H_ii (eV), Slater exponent ζ].
export const EHT_PARAMS = {
  H: [[1, 0, -13.6, 1.3]],
  He: [[1, 0, -23.4, 1.688]],
  Li: [[2, 0, -5.4, 0.65], [2, 1, -3.5, 0.65]],
  Be: [[2, 0, -10.0, 0.975], [2, 1, -6.0, 0.975]],
  B: [[2, 0, -15.2, 1.3], [2, 1, -8.5, 1.3]],
  C: [[2, 0, -21.4, 1.625], [2, 1, -11.4, 1.625]],
  N: [[2, 0, -26.0, 1.95], [2, 1, -13.4, 1.95]],
  O: [[2, 0, -32.3, 2.275], [2, 1, -14.8, 2.275]],
  F: [[2, 0, -40.0, 2.425], [2, 1, -18.1, 2.425]],
  Ne: [[2, 0, -48.5, 2.879], [2, 1, -21.6, 2.879]],
  Na: [[3, 0, -5.1, 0.733], [3, 1, -3.0, 0.733]],
  Mg: [[3, 0, -9.0, 1.1], [3, 1, -4.5, 1.1]],
  Al: [[3, 0, -12.3, 1.167], [3, 1, -6.5, 1.167]],
  Si: [[3, 0, -17.3, 1.383], [3, 1, -9.2, 1.383]],
  P: [[3, 0, -18.6, 1.6], [3, 1, -14.0, 1.6]],
  S: [[3, 0, -20.0, 1.817], [3, 1, -13.3, 1.817]],
  Cl: [[3, 0, -26.3, 2.183], [3, 1, -14.2, 2.183]],
};

// STO-3G Gaussian fits to Slater orbitals with ζ = 1 (Hehre, Stewart & Pople 1969–70);
// exponents scale as ζ².
const STO3G = {
  1: { alpha: [2.227660584, 0.405771156, 0.109818036], s: [0.154328967, 0.535328142, 0.444634542] },
  2: { alpha: [0.994202729, 0.231031333, 0.075138620], s: [-0.099967230, 0.399512826, 0.700115469], p: [0.155916275, 0.607683719, 0.391957393] },
  3: { alpha: [0.4828540806, 0.1347150629, 0.05272656258], s: [-0.2196203690, 0.2255954336, 0.9003984260], p: [0.01058760429, 0.5951670053, 0.4620010120] },
};

const VALENCE = { H: 1, He: 2, Li: 1, Be: 2, B: 3, C: 4, N: 5, O: 6, F: 7, Ne: 8, Na: 1, Mg: 2, Al: 3, Si: 4, P: 5, S: 6, Cl: 7 };
const AXES = ['x', 'y', 'z'];

/** Build the basis: one function per valence orbital, each a contraction of 3 primitives. */
function buildBasis(atoms) {
  const basis = [];
  atoms.forEach((a, atom) => {
    const center = a.pos.map((c) => c / BOHR);
    for (const [n, l, Hii, zeta] of EHT_PARAMS[a.symbol]) {
      const fit = STO3G[n];
      const alpha = fit.alpha.map((x) => x * zeta * zeta);
      const coef = l === 0 ? fit.s : fit.p;
      const comps = l === 0 ? [-1] : [0, 1, 2]; // −1 = s; 0/1/2 = p_x/p_y/p_z
      for (const axis of comps) {
        const prims = alpha.map((al, k) => {
          const norm = (2 * al / Math.PI) ** 0.75 * (axis < 0 ? 1 : 2 * Math.sqrt(al));
          return { alpha: al, c: coef[k] * norm };
        });
        basis.push({ atom, n, l, axis, Hii, center, prims, label: `${a.symbol}${atom + 1} ${n}${l ? `p${AXES[axis]}` : 's'}` });
      }
    }
  });
  return basis;
}

/** Overlap of two contracted s/p Gaussian functions (Obara–Saika-style closed forms). */
function overlap(f, g) {
  const A = f.center, B = g.center;
  const R2 = (A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2;
  let S = 0;
  for (const pa of f.prims) {
    for (const pb of g.prims) {
      const p = pa.alpha + pb.alpha;
      const mu = (pa.alpha * pb.alpha) / p;
      const ss = (Math.PI / p) ** 1.5 * Math.exp(-mu * R2);
      let val;
      if (f.axis < 0 && g.axis < 0) val = ss;
      else if (f.axis < 0) {
        const P = (pa.alpha * A[g.axis] + pb.alpha * B[g.axis]) / p;
        val = (P - B[g.axis]) * ss;
      } else if (g.axis < 0) {
        const P = (pa.alpha * A[f.axis] + pb.alpha * B[f.axis]) / p;
        val = (P - A[f.axis]) * ss;
      } else {
        const Pi = (pa.alpha * A[f.axis] + pb.alpha * B[f.axis]) / p;
        const Pj = (pa.alpha * A[g.axis] + pb.alpha * B[g.axis]) / p;
        val = ((Pi - A[f.axis]) * (Pj - B[g.axis]) + (f.axis === g.axis ? 1 / (2 * p) : 0)) * ss;
      }
      S += pa.c * pb.c * val;
    }
  }
  return S;
}

/** Eigenvalues and eigenvectors of a symmetric n×n matrix (cyclic Jacobi, Numerical Recipes). */
export function jacobiEigen(A, n) {
  const a = Float64Array.from(A);
  const v = new Float64Array(n * n);
  for (let i = 0; i < n; i++) v[i * n + i] = 1;
  const d = new Float64Array(n), b = new Float64Array(n), z = new Float64Array(n);
  for (let i = 0; i < n; i++) b[i] = d[i] = a[i * n + i];
  let s = 0, tau = 0;
  const rot = (m, i, j, k, l) => {
    const g = m[i * n + j], h = m[k * n + l];
    m[i * n + j] = g - s * (h + g * tau);
    m[k * n + l] = h + s * (g - h * tau);
  };
  for (let sweep = 1; sweep <= 80; sweep++) {
    let sm = 0;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) sm += Math.abs(a[p * n + q]);
    if (sm < 1e-13) break;
    const tresh = sweep < 4 ? (0.2 * sm) / (n * n) : 0;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        const g = 100 * Math.abs(apq);
        if (sweep > 4 && Math.abs(d[p]) + g === Math.abs(d[p]) && Math.abs(d[q]) + g === Math.abs(d[q])) {
          a[p * n + q] = 0;
        } else if (Math.abs(apq) > tresh) {
          let h = d[q] - d[p], t;
          if (Math.abs(h) + g === Math.abs(h)) t = apq / h;
          else {
            const theta = (0.5 * h) / apq;
            t = 1 / (Math.abs(theta) + Math.sqrt(1 + theta * theta));
            if (theta < 0) t = -t;
          }
          const c = 1 / Math.sqrt(1 + t * t);
          s = t * c; tau = s / (1 + c); h = t * apq;
          z[p] -= h; z[q] += h; d[p] -= h; d[q] += h;
          a[p * n + q] = 0;
          for (let j = 0; j < p; j++) rot(a, j, p, j, q);
          for (let j = p + 1; j < q; j++) rot(a, p, j, j, q);
          for (let j = q + 1; j < n; j++) rot(a, p, j, q, j);
          for (let j = 0; j < n; j++) rot(v, j, p, j, q);
        }
      }
    }
    for (let p = 0; p < n; p++) { b[p] += z[p]; d[p] = b[p]; z[p] = 0; }
  }
  return { values: d, vectors: v }; // eigenvector k is column k: v[i*n + k]
}

/** Solve H C = S C E by canonical orthogonalization. Returns energies and coefficient columns. */
function solveGeneralized(H, S, n) {
  const { values: sv, vectors: U } = jacobiEigen(S, n);
  const keep = [];
  for (let k = 0; k < n; k++) if (sv[k] > 1e-7) keep.push(k);
  const m = keep.length;
  const X = new Float64Array(n * m); // X = U s^{-1/2}
  keep.forEach((k, j) => { const f = 1 / Math.sqrt(sv[k]); for (let i = 0; i < n; i++) X[i * m + j] = U[i * n + k] * f; });
  const HX = new Float64Array(n * m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { let t = 0; for (let k = 0; k < n; k++) t += H[i * n + k] * X[k * m + j]; HX[i * m + j] = t; }
  const Hp = new Float64Array(m * m);
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) { let t = 0; for (let k = 0; k < n; k++) t += X[k * m + i] * HX[k * m + j]; Hp[i * m + j] = t; }
  const { values: e, vectors: Cp } = jacobiEigen(Hp, m);
  const order = [...e.keys()].sort((x, y) => e[x] - e[y]);
  const energies = order.map((k) => e[k]);
  const coeffs = order.map((k) => {
    const c = new Float64Array(n);
    for (let i = 0; i < n; i++) { let t = 0; for (let j = 0; j < m; j++) t += X[i * m + j] * Cp[j * m + k]; c[i] = t; }
    return c;
  });
  return { energies, coeffs };
}

/** Fill MOs: two electrons each, Hund's rule within a degenerate set. */
function occupy(energies, electrons) {
  const occ = energies.map(() => 0);
  let left = electrons, i = 0;
  while (left > 0 && i < energies.length) {
    let j = i;
    while (j + 1 < energies.length && Math.abs(energies[j + 1] - energies[i]) < 1e-3) j++;
    const g = j - i + 1;
    const take = Math.min(left, 2 * g);
    for (let k = 0; k < g; k++) occ[i + k] = (take > k ? 1 : 0) + (take > g + k ? 1 : 0);
    left -= take;
    i = j + 1;
  }
  return occ;
}

/** Which atoms aren't covered by the parameter set, if any. */
export const unsupportedElements = (mol) => [...new Set(mol.atoms.map((a) => a.symbol))].filter((s) => !EHT_PARAMS[s]);

/**
 * Molecular orbitals for a molecule ({ atoms: [{symbol, pos (Å)}], bonds, charge }).
 * Each MO: { energy (eV), occ, c (coefficients), kind: 'bonding'|'antibonding'|'nonbonding',
 * sym: 'σ'|'π'|'', label }.
 */
export function computeMOs(mol) {
  const missing = unsupportedElements(mol);
  if (missing.length) return { error: `Molecular orbitals here cover elements up to chlorine; ${missing.join(', ')} ${missing.length > 1 ? 'aren’t' : 'isn’t'} included.` };
  const { atoms, bonds } = mol;
  const basis = buildBasis(atoms);
  const n = basis.length;
  const S = new Float64Array(n * n), H = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const s = overlap(basis[i], basis[j]);
      S[i * n + j] = S[j * n + i] = s;
    }
  }
  // Renormalize the contractions exactly.
  const norm = basis.map((_, i) => 1 / Math.sqrt(S[i * n + i]));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) S[i * n + j] *= norm[i] * norm[j];
  basis.forEach((f, i) => { for (const p of f.prims) p.c *= norm[i]; });
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      H[i * n + j] = i === j ? basis[i].Hii : (K_WH * S[i * n + j] * (basis[i].Hii + basis[j].Hii)) / 2;
    }
  }
  const { energies, coeffs } = solveGeneralized(H, S, n);
  const electrons = atoms.reduce((t, a) => t + VALENCE[a.symbol], 0) - (mol.charge ?? 0);
  const occ = occupy(energies, electrons);

  // Geometry for σ/π labels: a linear axis, or a plane normal.
  const geo = shapeFrame(atoms);
  const bondPairs = bonds.map((b) => [b.a, b.b]);
  const mos = energies.map((energy, k) => {
    const c = coeffs[k];
    // Mulliken overlap population summed over bonds: > 0 bonding, < 0 antibonding.
    let op = 0;
    for (const [A, B] of bondPairs) {
      for (let i = 0; i < n; i++) {
        if (basis[i].atom !== A) continue;
        for (let j = 0; j < n; j++) if (basis[j].atom === B) op += 2 * c[i] * c[j] * S[i * n + j];
      }
    }
    const kind = op > 0.04 ? 'bonding' : op < -0.04 ? 'antibonding' : 'nonbonding';
    return { energy, occ: occ[k], c, op, kind, sym: symmetryOf(c, basis, geo) };
  });
  mos.forEach((m) => { m.label = m.sym ? `${m.sym}${m.kind === 'antibonding' ? '*' : ''}` : m.kind === 'nonbonding' ? 'n' : m.kind === 'antibonding' ? 'σ*' : 'σ'; });
  // n (nonbonding) is clearer than a σ label for lone pairs.
  mos.forEach((m) => { if (m.kind === 'nonbonding') m.label = m.sym === 'π' ? 'π (n)' : 'n'; });

  const homo = occ.reduce((h, o, k) => (o > 0 ? k : h), -1);
  const unpaired = occ.filter((o) => o === 1).length;

  // Same-element diatomics: use inversion symmetry, the textbook classification.
  // Inversion through the bond midpoint maps s on A to s on B and p on A to −p on B.
  // Gerade (g) σ and ungerade (u) π are bonding; σu and πg are antibonding.
  let bondOrder = null;
  if (atoms.length === 2 && atoms[0].symbol === atoms[1].symbol) {
    const half = n / 2;
    for (const m of mos) {
      let par = 0;
      for (let i = 0; i < half; i++) par += m.c[i] * (basis[i].axis < 0 ? 1 : -1) * m.c[i + half];
      const g = par > 0;
      const sym = m.sym || 'σ';
      m.parity = g ? 'g' : 'u';
      m.kind = (sym === 'σ') === g ? 'bonding' : 'antibonding';
      m.label = `${sym}${m.parity}${m.kind === 'antibonding' ? '*' : ''}`;
    }
    const be = mos.reduce((t, m) => t + (m.kind === 'bonding' ? m.occ : 0), 0);
    const ae = mos.reduce((t, m) => t + (m.kind === 'antibonding' ? m.occ : 0), 0);
    bondOrder = (be - ae) / 2;
  }
  // Atomic orbital levels for the correlation diagram (one entry per shell per atom).
  const aoLevels = atoms.map((a, i) => ({ atom: i, symbol: a.symbol, shells: EHT_PARAMS[a.symbol].map(([nn, l, Hii]) => ({ name: `${nn}${'sp'[l]}`, energy: Hii })) }));
  return { basis, mos, homo, lumo: homo + 1 < mos.length ? homo + 1 : null, electrons, unpaired, bondOrder, aoLevels, geo };
}

function shapeFrame(atoms) {
  if (atoms.length < 2) return { kind: 'atom' };
  const P = atoms.map((a) => a.pos);
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = (u) => Math.hypot(...u);
  const axis = sub(P[1], P[0]);
  const ax = axis.map((x) => x / len(axis));
  let normal = null;
  for (let i = 2; i < P.length && !normal; i++) {
    const c = cross(axis, sub(P[i], P[0]));
    if (len(c) > 0.1) normal = c.map((x) => x / len(c));
  }
  if (!normal) return { kind: 'linear', axis: ax };
  const planar = P.every((p) => Math.abs(normal[0] * (p[0] - P[0][0]) + normal[1] * (p[1] - P[0][1]) + normal[2] * (p[2] - P[0][2])) < 0.05);
  return planar ? { kind: 'planar', normal } : { kind: 'other' };
}

/** σ or π: does the MO live on p orbitals perpendicular to a linear axis / to a molecular plane? */
function symmetryOf(c, basis, geo) {
  if (geo.kind !== 'linear' && geo.kind !== 'planar') return '';
  const perAtom = new Map();
  let total = 0;
  basis.forEach((f, i) => {
    total += c[i] * c[i];
    if (f.axis < 0) return;
    const v = perAtom.get(f.atom) ?? [0, 0, 0];
    v[f.axis] = c[i];
    perAtom.set(f.atom, v);
  });
  let piWeight = 0;
  for (const v of perAtom.values()) {
    if (geo.kind === 'planar') piWeight += (v[0] * geo.normal[0] + v[1] * geo.normal[1] + v[2] * geo.normal[2]) ** 2;
    else {
      const along = v[0] * geo.axis[0] + v[1] * geo.axis[1] + v[2] * geo.axis[2];
      piWeight += v[0] ** 2 + v[1] ** 2 + v[2] ** 2 - along * along;
    }
  }
  const frac = total ? piWeight / total : 0;
  return frac > 0.9 ? 'π' : frac < 0.1 ? 'σ' : '';
}

/**
 * Sample MO k on a res³ grid spanning [−half, half) Å about the origin, in the layout
 * three.js MarchingCubes expects. Values are in bohr^(−3/2).
 */
export function moField(result, k, res, half) {
  const { basis, mos } = result;
  const c = mos[k].c;
  const field = new Float32Array(res * res * res);
  const h = res / 2, step = (half / h) / BOHR; // grid step in bohr
  const halfB = half / BOHR;
  basis.forEach((f, i) => {
    if (Math.abs(c[i]) < 1e-4) return;
    const minAlpha = Math.min(...f.prims.map((p) => p.alpha));
    const cut = Math.sqrt(16 / minAlpha); // e^{−16} is negligible
    const [cx, cy, cz] = f.center;
    const lo = (v) => Math.max(0, Math.floor((v - cut + halfB) / step));
    const hi = (v) => Math.min(res - 1, Math.ceil((v + cut + halfB) / step));
    for (let zi = lo(cz); zi <= hi(cz); zi++) {
      const z = zi * step - halfB, dz = z - cz;
      for (let yi = lo(cy); yi <= hi(cy); yi++) {
        const y = yi * step - halfB, dy = y - cy;
        const row = (zi * res + yi) * res;
        for (let xi = lo(cx); xi <= hi(cx); xi++) {
          const x = xi * step - halfB, dx = x - cx;
          const r2 = dx * dx + dy * dy + dz * dz;
          let g = 0;
          for (const p of f.prims) g += p.c * Math.exp(-p.alpha * r2);
          const ang = f.axis < 0 ? 1 : f.axis === 0 ? dx : f.axis === 1 ? dy : dz;
          field[row + xi] += c[i] * g * ang;
        }
      }
    }
  });
  return field;
}
