// Hydrogen-like orbital math: real spherical harmonics, radial functions,
// and Monte Carlo sampling of |ψ|² for the point-cloud rendering.

// Real spherical harmonics (unnormalized) as polynomials of a unit vector.
// Order within each l is the Hund's-rule fill order used for partial subshells.
export const ANGULAR = [
  [
    { name: 's', html: 's', f: () => 1 },
  ],
  [
    { name: 'px', html: 'p<sub>x</sub>', f: (x) => x },
    { name: 'py', html: 'p<sub>y</sub>', f: (x, y) => y },
    { name: 'pz', html: 'p<sub>z</sub>', f: (x, y, z) => z },
  ],
  [
    { name: 'dxy', html: 'd<sub>xy</sub>', f: (x, y) => x * y },
    { name: 'dyz', html: 'd<sub>yz</sub>', f: (x, y, z) => y * z },
    { name: 'dz²', html: 'd<sub>z²</sub>', f: (x, y, z) => 3 * z * z - 1 },
    { name: 'dxz', html: 'd<sub>xz</sub>', f: (x, y, z) => x * z },
    { name: 'dx²−y²', html: 'd<sub>x²−y²</sub>', f: (x, y) => x * x - y * y },
  ],
  [
    { name: 'fy(3x²−y²)', html: 'f<sub>y(3x²−y²)</sub>', f: (x, y) => y * (3 * x * x - y * y) },
    { name: 'fxyz', html: 'f<sub>xyz</sub>', f: (x, y, z) => x * y * z },
    { name: 'fyz²', html: 'f<sub>yz²</sub>', f: (x, y, z) => y * (5 * z * z - 1) },
    { name: 'fz³', html: 'f<sub>z³</sub>', f: (x, y, z) => z * (5 * z * z - 3) },
    { name: 'fxz²', html: 'f<sub>xz²</sub>', f: (x, y, z) => x * (5 * z * z - 1) },
    { name: 'fz(x²−y²)', html: 'f<sub>z(x²−y²)</sub>', f: (x, y, z) => z * (x * x - y * y) },
    { name: 'fx(x²−3y²)', html: 'f<sub>x(x²−3y²)</sub>', f: (x, y) => x * (x * x - 3 * y * y) },
  ],
];

// Upper bound of |Y|² for each angular function, used for rejection sampling.
for (const group of ANGULAR) {
  for (const a of group) {
    let max = 0;
    const N = 6000;
    for (let i = 0; i < N; i++) {
      const z = 1 - (2 * (i + 0.5)) / N;
      const s = Math.sqrt(1 - z * z);
      const phi = i * Math.PI * (3 - Math.sqrt(5));
      const v = a.f(s * Math.cos(phi), s * Math.sin(phi), z);
      max = Math.max(max, v * v);
    }
    a.max2 = max * 1.08;
  }
}

// Generalized Laguerre polynomial L_k^α(x).
function laguerre(k, alpha, x) {
  if (k === 0) return 1;
  let prev = 1;
  let cur = 1 + alpha - x;
  for (let i = 1; i < k; i++) {
    const next = ((2 * i + 1 + alpha - x) * cur - (i + alpha) * prev) / (i + 1);
    prev = cur;
    cur = next;
  }
  return cur;
}

// Hydrogenic radial function in terms of ρ = 2Zr/n (unnormalized).
const radial = (n, l, rho) => rho ** l * Math.exp(-rho / 2) * laguerre(n - l - 1, 2 * l + 1, rho);

const GRID = 2000;
const radialCache = new Map();

// Cumulative radial probability ∫ρ²R² on a ρ grid; independent of Z.
function radialCDF(n, l) {
  const key = `${n},${l}`;
  if (radialCache.has(key)) return radialCache.get(key);
  const rhoMax = 4 * n + 24;
  const cdf = new Float64Array(GRID + 1);
  for (let i = 1; i <= GRID; i++) {
    const rho = (i / GRID) * rhoMax;
    const R = radial(n, l, rho);
    cdf[i] = cdf[i - 1] + rho * rho * R * R;
  }
  const total = cdf[GRID];
  for (let i = 0; i <= GRID; i++) cdf[i] /= total;
  const quantile = (p) => {
    let lo = 0, hi = GRID;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < p) lo = mid; else hi = mid;
    }
    const frac = (p - cdf[lo]) / (cdf[hi] - cdf[lo] || 1);
    return ((lo + frac) / GRID) * rhoMax;
  };
  const entry = { quantile };
  radialCache.set(key, entry);
  return entry;
}

/** Radius (bohr) containing the given fraction of the electron probability. */
export function orbitalRadius(n, l, zeff, fraction = 0.9) {
  return radialCDF(n, l).quantile(fraction) * n / (2 * zeff);
}

/**
 * Draw `count` positions from |ψ_nlk|² for a hydrogen-like orbital with
 * effective charge `zeff`. Returns positions (bohr) and the sign of ψ at each.
 */
export function sampleOrbital(n, l, k, zeff, count) {
  const ang = ANGULAR[l][k];
  const { quantile } = radialCDF(n, l);
  const scale = n / (2 * zeff);
  const positions = new Float32Array(count * 3);
  const signs = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const rho = quantile(Math.random());
    let x, y, z, a;
    do {
      z = 2 * Math.random() - 1;
      const s = Math.sqrt(1 - z * z);
      const phi = 2 * Math.PI * Math.random();
      x = s * Math.cos(phi);
      y = s * Math.sin(phi);
      a = ang.f(x, y, z);
    } while (Math.random() * ang.max2 > a * a);

    const r = rho * scale;
    positions[i * 3] = x * r;
    positions[i * 3 + 1] = y * r;
    positions[i * 3 + 2] = z * r;
    signs[i] = Math.sign(laguerre(n - l - 1, 2 * l + 1, rho)) * Math.sign(a) || 1;
  }
  return { positions, signs };
}

/**
 * Sample ψ on a res³ grid spanning [-extent, extent) (the layout three.js
 * MarchingCubes expects), and find the |ψ| isovalue whose surface encloses
 * `fraction` of the probability.
 */
export function psiField(n, l, k, zeff, res, extent, fraction = 0.85) {
  const ang = ANGULAR[l][k];
  const field = new Float32Array(res * res * res);
  const half = res / 2;
  const toRho = (2 * zeff) / n;
  let i = 0;
  for (let zi = 0; zi < res; zi++) {
    const z = ((zi - half) / half) * extent;
    for (let yi = 0; yi < res; yi++) {
      const y = ((yi - half) / half) * extent;
      for (let xi = 0; xi < res; xi++, i++) {
        const x = ((xi - half) / half) * extent;
        const r = Math.hypot(x, y, z) || 1e-9;
        field[i] = radial(n, l, r * toRho) * ang.f(x / r, y / r, z / r);
      }
    }
  }

  const density = field.map((v) => v * v).sort(); // ascending
  let total = 0;
  for (const p of density) total += p;
  let acc = 0;
  let iso = 0;
  for (let j = density.length - 1; j >= 0; j--) {
    acc += density[j];
    if (acc >= total * fraction) { iso = Math.sqrt(density[j]); break; }
  }
  return { field, iso };
}

/**
 * Spherically averaged electron density of a neutral atom, tabulated on
 * r ∈ [0, rMax] bohr: ρ(r) = Σ count · R_nl(r)² / 4π with each R normalized.
 * subshells: [{ n, l, count, zeff }]
 */
export function atomDensityTable(subshells, rMax = 14, steps = 1400) {
  const dr = rMax / steps;
  const table = new Float64Array(steps + 1);
  const R = new Float64Array(steps + 1);
  for (const { n, l, count, zeff } of subshells) {
    let normSq = 0;
    for (let i = 0; i <= steps; i++) {
      const r = i * dr;
      R[i] = radial(n, l, (2 * zeff * r) / n);
      normSq += R[i] * R[i] * r * r * dr;
    }
    for (let i = 0; i <= steps; i++) table[i] += (count * R[i] * R[i]) / normSq / (4 * Math.PI);
  }
  return { table, dr, rMax };
}
