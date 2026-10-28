// Atom panel extras: radial probability plots, emission spectra, and the
// periodic-trend color scale.

import { radialProbability } from './orbitals.js';
import { SUBSHELL_COLORS } from './viewer.js';
import { L_LETTERS } from './electron-config.js';
import { hydrogenLine, HYDROGEN_SERIES, EMISSION_LINES } from './atom-data.js';

const BOHR_A = 0.529177; // Å

/**
 * r²R² for every subshell, in Å. subshells: [{ key, n, l, count, zeff }].
 * hidden: keys drawn faintly; hover: key drawn bold.
 */
export function radialChart(subshells, { hidden = new Set(), hover = null, weighted = false } = {}) {
  const W = 560, H = 230, ml = 34, mr = 12, mt = 12, mb = 32;
  // Past the second period the shells span a factor of ~100 in size, so use a log axis
  // and plot probability per ln r (r·P), which gives every shell a comparable peak.
  const log = subshells.length > 3;
  const peakBohr = (s) => s.radial?.peak ?? (s.n * s.n) / s.zeff;
  const rMax = Math.min(14, Math.max(...subshells.map((s) => 2.6 * peakBohr(s) + 1.2)));
  const rMin = log ? Math.min(...subshells.map((s) => 0.12 * peakBohr(s))) : 0;
  const steps = 360;
  const rs = Array.from({ length: steps + 1 }, (_, i) => (log ? rMin * (rMax / rMin) ** (i / steps) : (i / steps) * rMax));
  const curves = subshells.map((s) => {
    const P = radialProbability(s.n, s.l, s.zeff, rs, s.radial);
    return { s, P: P.map((p, i) => p * (log ? rs[i] : 1) * (weighted ? s.count : 1)) };
  });
  const yMax = Math.max(...curves.map((c) => Math.max(...c.P))) * 1.08;
  const x = (i) => ml + (i / steps) * (W - ml - mr);
  const xr = (rA) => {
    const r = rA / BOHR_A;
    return ml + (log ? Math.log(r / rMin) / Math.log(rMax / rMin) : r / rMax) * (W - ml - mr);
  };
  const y = (p) => mt + (1 - p / yMax) * (H - mt - mb);
  const out = [`<svg class="radial-chart" viewBox="0 0 ${W} ${H}">`];
  out.push(`<line class="axis" x1="${ml}" y1="${H - mb}" x2="${W - mr}" y2="${H - mb}"/><line class="axis" x1="${ml}" y1="${mt}" x2="${ml}" y2="${H - mb}"/>`);
  const rMaxA = rMax * BOHR_A, rMinA = rMin * BOHR_A;
  const ticks = [];
  if (log) {
    for (const t of [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5]) if (t >= rMinA * 0.999 && t <= rMaxA) ticks.push(t);
  } else {
    const step = rMaxA > 4 ? 1 : rMaxA > 2 ? 0.5 : rMaxA > 0.8 ? 0.2 : 0.1;
    for (let t = 0; t <= rMaxA + 1e-9; t += step) ticks.push(+t.toFixed(2));
  }
  for (const t of ticks) {
    const xx = xr(t);
    out.push(`<line class="grid" x1="${xx}" y1="${mt}" x2="${xx}" y2="${H - mb}"/><text class="lbl" x="${xx}" y="${H - mb + 13}" text-anchor="middle">${t}</text>`);
  }
  out.push(`<text class="lbl" x="${(ml + W - mr) / 2}" y="${H - 4}" text-anchor="middle">distance from nucleus r (Å${log ? ', log scale' : ''})</text>`);
  const yl = weighted ? 'electrons' : log ? 'probability per ln r' : 'probability r²R²';
  out.push(`<text class="lbl" x="12" y="${(mt + H - mb) / 2}" text-anchor="middle" transform="rotate(-90 12 ${(mt + H - mb) / 2})">${yl}</text>`);
  const labels = [];
  for (const { s, P } of curves) {
    const d = Array.from(P, (p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join('');
    const cls = `curve${hidden.has(s.key) ? ' off' : ''}${hover === s.key ? ' hover' : ''}`;
    out.push(`<path class="${cls}" data-key="${s.key}" d="${d}" style="stroke:${SUBSHELL_COLORS[s.l]}"><title>${s.n}${L_LETTERS[s.l]}</title></path>`);
    // Label at the main peak.
    let best = 0;
    for (let i = 1; i < P.length; i++) if (P[i] > P[best]) best = i;
    labels.push({ x: x(best), y: y(P[best]) - 5, text: `${s.n}${L_LETTERS[s.l]}`, color: SUBSHELL_COLORS[s.l] });
  }
  labels.sort((a, b) => a.x - b.x);
  const placed = [];
  for (const lb of labels) {
    while (placed.some((p) => Math.abs(p.x - lb.x) < 18 && Math.abs(p.y - lb.y) < 11)) lb.y -= 11;
    placed.push(lb);
    out.push(`<text class="peak" x="${lb.x}" y="${Math.max(mt + 9, lb.y)}" text-anchor="middle" style="fill:${lb.color}">${lb.text}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}

/** A short note on what the radial plot shows for this configuration. */
export function radialNote(subshells) {
  const has = (n, l) => subshells.some((s) => s.n === n && s.l === l);
  for (const n of [6, 5, 4]) {
    if (has(n, 0) && has(n - 1, 2)) {
      return `Notice that ${n - 1}d peaks well inside ${n}s, even though ${n}s fills first. ${n}s has small inner bumps that dip close to the nucleus, where they feel more of its charge, and that “penetration” lowers its energy. It’s also why transition metals lose their ${n}s electrons first when they form ions: once the d orbitals hold electrons, they sit lower.`;
    }
  }
  if (subshells.length === 1 && subshells[0].n === 1) {
    return 'The 1s curve peaks at 0.529 Å for hydrogen: the Bohr radius, where an electron is most likely to be found at a given distance.';
  }
  return 'Each curve is the chance of finding that electron at distance r. An orbital with n − l − 1 radial nodes has that many zero points before its main peak; the small inner bumps of s and p orbitals let them penetrate close to the nucleus.';
}

/** RGB color for a visible wavelength (nm), after Dan Bruton's approximation. */
export function wavelengthColor(nm) {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = (440 - nm) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = (510 - nm) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = (645 - nm) / 65; }
  else if (nm <= 780) { r = 1; }
  // Fade at the edges of vision.
  const f = nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40 : nm > 700 ? 0.3 + (0.7 * (780 - nm)) / 80 : 1;
  const c = (v) => Math.round(255 * (v * f) ** 0.8);
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

/** Lines to draw for element `symbol`: [{ nm, I, label }], or null if none are tabulated. */
export function emissionLines(symbol) {
  if (symbol === 'H') {
    const lines = [];
    for (let n2 = 3; n2 <= 9; n2++) lines.push({ nm: hydrogenLine(2, n2), I: Math.min(1, 2.2 / (n2 - 1.5)), label: `${n2}→2`, from: n2, to: 2 });
    return lines;
  }
  return EMISSION_LINES[symbol]?.map(([nm, I]) => ({ nm, I, label: `${nm.toFixed(1)} nm` })) ?? null;
}

/** The visible spectrum (380–750 nm) with emission lines; `pick` highlights one line. */
export function spectrumStrip(lines, pick = null) {
  const W = 560, H = 78, ml = 6, mr = 6, top = 6, bar = 44;
  const x = (nm) => ml + ((nm - 380) / 370) * (W - ml - mr);
  const out = [`<svg class="spectrum" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="vis">`];
  for (let nm = 380; nm <= 750; nm += 10) out.push(`<stop offset="${(nm - 380) / 370}" stop-color="${wavelengthColor(nm)}"/>`);
  out.push(`</linearGradient></defs><rect x="${ml}" y="${top}" width="${W - ml - mr}" height="${bar}" fill="url(#vis)" opacity="0.12"/><rect x="${ml}" y="${top}" width="${W - ml - mr}" height="${bar}" fill="none" class="frame"/>`);
  lines.forEach((ln, i) => {
    if (ln.nm < 380 || ln.nm > 750) return;
    const xx = x(ln.nm);
    out.push(`<g class="sline${pick === i ? ' sel' : ''}" data-line="${i}"><title>${ln.nm.toFixed(1)} nm${ln.from ? ` (n = ${ln.from} → 2)` : ''}</title>
      <rect x="${xx - 4}" y="${top}" width="8" height="${bar}" fill="transparent"/>
      <line x1="${xx}" y1="${top}" x2="${xx}" y2="${top + bar}" stroke="${wavelengthColor(ln.nm)}" stroke-width="${pick === i ? 3.5 : 2.2}" opacity="${0.35 + 0.65 * ln.I}"/></g>`);
  });
  for (let nm = 400; nm <= 750; nm += 50) out.push(`<text class="lbl" x="${x(nm)}" y="${top + bar + 14}" text-anchor="middle">${nm}</text>`);
  out.push(`<text class="lbl" x="${W - mr}" y="${H - 2}" text-anchor="end">wavelength (nm)</text></svg>`);
  return out.join('');
}

/** Hydrogen energy levels with the Lyman, Balmer and Paschen transitions; `pick` = [from, to]. */
export function hydrogenLevels(pick = null) {
  const W = 560, H = 250, ml = 44, mr = 64, mt = 14, mb = 18;
  const E = (n) => -13.6057 / (n * n);
  // Compress the scale so the upper levels are readable: depth ∝ (−E)^0.45.
  const yOf = (e) => mt + (-e / 13.6057) ** 0.45 * (H - mt - mb - 16);
  const out = [`<svg class="hlevels" viewBox="0 0 ${W} ${H}">`];
  for (let n = 1; n <= 7; n++) {
    const yy = yOf(E(n));
    out.push(`<line class="level" x1="${ml}" y1="${yy}" x2="${W - mr}" y2="${yy}"/>${n <= 5 ? `<text class="lbl" x="${W - mr + 4}" y="${yy + 3}">n = ${n}${n === 5 ? ', 6, 7…' : ''}</text>` : ''}`);
    if (n <= 4) out.push(`<text class="lbl" x="${ml - 4}" y="${yy + 3}" text-anchor="end">${E(n).toFixed(2)}</text>`);
  }
  out.push(`<line class="level ion" x1="${ml}" y1="${mt}" x2="${W - mr}" y2="${mt}"/><text class="lbl" x="${W - mr + 4}" y="${mt + 3}">n = ∞</text><text class="lbl" x="${ml - 4}" y="${mt + 3}" text-anchor="end">0 eV</text>`);
  const series = [[1, 70, 'Lyman (UV)'], [2, 230, 'Balmer (visible)'], [3, 390, 'Paschen (IR)']];
  for (const [to, x0, name] of series) {
    out.push(`<text class="series" x="${x0 + 30}" y="${H - 4}" text-anchor="middle">${name}</text>`);
    for (let from = to + 1; from <= 7; from++) {
      const xx = x0 + (from - to - 1) * 11;
      const nm = hydrogenLine(to, from);
      const color = nm >= 380 && nm <= 750 ? wavelengthColor(nm) : to === 1 ? '#b18cff' : '#ff7a7a';
      const sel = pick && pick[0] === from && pick[1] === to;
      out.push(`<line class="trans${sel ? ' sel' : ''}" x1="${xx}" y1="${yOf(E(from))}" x2="${xx}" y2="${yOf(E(to)) - 3}" stroke="${color}" style="color:${color}" marker-end="url(#harrow)"><title>n = ${from} → ${to}: ${nm.toFixed(1)} nm, ${(E(from) - E(to)).toFixed(2)} eV</title></line>`);
    }
  }
  out.push('<defs><marker id="harrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="context-stroke" stroke="none"/></marker></defs></svg>');
  return out.join('');
}

export { HYDROGEN_SERIES };

// Sequential color scale for trend overlays (dark blue → teal → yellow).
const RAMP = [[58, 70, 150], [40, 110, 185], [35, 160, 160], [130, 205, 100], [250, 225, 80]];
export function rampColor(t) {
  t = Math.max(0, Math.min(1, t));
  const f = t * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(f)), u = f - i;
  const c = RAMP[i].map((v, k) => Math.round(v + (RAMP[i + 1][k] - v) * u));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
export const RAMP_CSS = `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map(rampColor).join(', ')})`;
