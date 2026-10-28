import { ELEMENTS } from './elements.js';
import { COVALENT_RADIUS } from './molecule-data.js';
import {
  isotopeFor, bindingEnergy, deformation, collectiveModes, radiusFm, isMagic, sci, densityRadii,
  allowedNeutrons, rotationPeriod, valenceCounts, BABYSECOND, NUCLEONS, QUARKS, HBAR_MEV_S,
  decayInfo, alphaTunneling, fissionBarrier, fissionSplit, halfLifeText, bindingOf, AMU_MEV,
} from './nucleus-data.js';
import { NuclideChart, MODE_COLORS, describeCell } from './nuclide-chart.js';
import { nilssonDiagram, fillLevels, orbital, samplePoints, shellsFor, omegaText, MEASURED_SPIN } from './nilsson.js';
import { bombard, BEAM_PRESETS, BEAM_DEFAULT, BEAM_RANGE, CHANNEL_NAMES, energyText as beamEnergyText, fateOf, canShow, nucHTML, pct } from './bombard.js';
import { PROJECTILES } from './reactions.js';
import { NucleusViewer, PROTON_COLOR, NEUTRON_COLOR, HALO_COLOR, PAIR_COLOR, PION_COLORS, COLOR_CHARGES } from './nucleus-viewer.js';

const $ = (sel) => document.querySelector(sel);

const MODE_TEXT = {
  dipole: 'Giant dipole resonance: the proton and neutron wells slosh against each other, and the nucleons follow. It’s what happens when a nucleus absorbs a high-energy gamma ray.',
  breathing: 'Breathing (giant monopole) mode: the well swells and shrinks, and the nucleons crowd in and spread out with it. Its energy measures how hard nuclear matter is to compress.',
  quadrupole: 'Quadrupole mode: the surface stretches into an egg shape and then flattens, like a vibrating liquid drop.',
  rotation: 'Rotation: a deformed nucleus turns as a whole about an axis perpendicular to its long axis, with the nucleons carried along in lockstep. (A round nucleus has no orientation, so it can’t rotate in a measurable way.)',
  none: 'No collective oscillation: just the nucleons moving around inside the nucleus.',
};

/** A rough atomic radius in fm: the covalent radius where known, else 1.5 Å. */
const atomRadiusFm = (z) => (COVALENT_RADIUS[ELEMENTS[z - 1].symbol] ?? 1.5) * 1e5;

/** Round to two significant figures for "about" numbers. */
const about = (x) => {
  const p = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1);
  return (Math.round(x / p) * p).toLocaleString();
};

const energyText = (E) => (E < 1 ? `${(E * 1000).toFixed(0)} keV` : `${E.toFixed(1)} MeV`);
const bsText = (T) => {
  const bs = T / BABYSECOND;
  return `${bs < 100 ? bs.toFixed(0) : about(bs)} babyseconds`;
};
const isoLabel = (iso) => `<sup>${iso.A}</sup>${iso.symbol}`;

// ---------- shell model (Nilsson diagram) ----------

const DELTAS = Array.from({ length: 71 }, (_, i) => Math.round(i - 30) / 100); // −0.30 … 0.40
const I0 = DELTAS.indexOf(0);
const OMEGA_COLORS = ['#9ad1ff', '#7ee0a8', '#ffd75e', '#ff9f6b', '#ff6b9a', '#c78bff', '#6bd6ff', '#e6e6e6', '#b5ff6b', '#ffb3e6'];
const SPIN_COLORS = { up: '#ffb35c', down: '#5cc8ff' };
const supParity = (p) => (p === '+' ? '⁺' : '⁻');
const diagramCache = new Map();
function diagramFor(kind, Nmax) {
  const key = `${kind}${Nmax}`;
  if (!diagramCache.has(key)) diagramCache.set(key, nilssonDiagram(kind, Nmax, DELTAS));
  return diagramCache.get(key);
}

/** Single-particle energy E(δ) for every orbital, with the filled ones marked at δ. */
function nilssonSVG(diag, fill, delta, delta0, pickId) {
  const W = 560, H = 430, ml = 62, mr = 34, mt = 14, mb = 34;
  const dmin = DELTAS[0], dmax = DELTAS[DELTAS.length - 1];
  const x = (d) => ml + ((d - dmin) / (dmax - dmin)) * (W - ml - mr);
  const lowest = Math.min(...diag.lines.map((l) => Math.min(...l.E)));
  const emin = Math.max(lowest - 0.08, fill.fermi - 1.45), emax = fill.fermi + 1.1;
  const y = (E) => mt + ((emax - E) / (emax - emin)) * (H - mt - mb);
  const parts = [];
  parts.push(`<defs><clipPath id="nil-clip"><rect x="${ml}" y="${mt}" width="${W - ml - mr}" height="${H - mt - mb}"/></clipPath></defs>`);
  // Axes and ticks.
  parts.push(`<line class="axis" x1="${ml}" y1="${H - mb}" x2="${W - mr}" y2="${H - mb}"/><line class="axis" x1="${ml}" y1="${mt}" x2="${ml}" y2="${H - mb}"/>`);
  for (let d = -0.3; d <= 0.401; d += 0.1) parts.push(`<text class="lbl" x="${x(d)}" y="${H - mb + 13}" text-anchor="middle">${d.toFixed(1)}</text>`);
  parts.push(`<text class="lbl" x="${x(-0.15)}" y="${H - 4}" text-anchor="middle">← oblate</text><text class="lbl" x="${x(0)}" y="${H - 4}" text-anchor="middle">δ</text><text class="lbl" x="${x(0.25)}" y="${H - 4}" text-anchor="middle">prolate →</text>`);
  for (let e = Math.ceil(emin * 2) / 2; e <= emax; e += 0.5) parts.push(`<text class="lbl" x="${W - mr + 4}" y="${y(e) + 3}">${e.toFixed(1)}</text>`);
  parts.push(`<text class="lbl" x="${W - 4}" y="${mt + 2}" text-anchor="end">ħω₀</text>`);
  parts.push(`<line class="zero" x1="${x(0)}" y1="${mt}" x2="${x(0)}" y2="${H - mb}"/>`);
  // Ground-state and current deformation.
  parts.push(`<line class="gs" x1="${x(delta0)}" y1="${mt}" x2="${x(delta0)}" y2="${H - mb}"/><text class="hl" x="${x(delta0) + 3}" y="${mt + 10}">ground state</text>`);
  if (Math.abs(delta - delta0) > 0.004) parts.push(`<line class="cur" x1="${x(delta)}" y1="${mt}" x2="${x(delta)}" y2="${H - mb}"/>`);
  // Orbitals.
  const lines = [];
  for (const l of diag.lines) {
    if (Math.max(...l.E) < emin || Math.min(...l.E) > emax) continue;
    const d = l.E.map((E, i) => `${i ? 'L' : 'M'}${x(DELTAS[i]).toFixed(1)},${y(E).toFixed(1)}`).join('');
    const color = OMEGA_COLORS[((l.twoOmega - 1) / 2) % OMEGA_COLORS.length];
    const tip = `${omegaText(l.twoOmega)}${supParity(l.parity)} from ${l.label}`;
    lines.push(`<g class="nil-line${l.id === pickId ? ' sel' : ''}" data-line="${l.id}"><title>${tip}</title>
      <path class="hit" d="${d}"/><path class="orb${l.parity === '−' ? ' neg' : ''}" d="${d}" style="stroke:${l.id === pickId ? '#ffffff' : color}"/></g>`);
  }
  parts.push(`<g clip-path="url(#nil-clip)">${lines.join('')}`);
  // Filled orbitals at the current δ.
  for (const lv of fill.levels) {
    if (!lv.occ || lv.E < emin || lv.E > emax) continue;
    parts.push(`<circle class="occ${lv.occ === 1 ? ' half' : ''}" cx="${x(delta)}" cy="${y(lv.E)}" r="3.6"/>`);
  }
  parts.push(`<line class="fermi" x1="${ml}" y1="${y(fill.fermi)}" x2="${W - mr}" y2="${y(fill.fermi)}"/></g>`);
  parts.push(`<text class="hl" x="${W - mr - 2}" y="${y(fill.fermi) - 4}" text-anchor="end">Fermi level</text>`);
  // Spherical labels at δ = 0, and the magic numbers in the gaps.
  const sph = new Map();
  for (const l of diag.lines) if (!sph.has(l.label)) sph.set(l.label, l.E[I0]);
  let lastY = Infinity;
  for (const [label, E] of [...sph].sort((a, b) => a[1] - b[1])) {
    const yy = y(E);
    if (E < emin || E > emax || lastY - yy < 11) continue;
    parts.push(`<text class="lbl sph" x="${ml - 5}" y="${yy + 3}" text-anchor="end">${label}</text>`);
    lastY = yy;
  }
  const at0 = diag.lines.map((l) => l.E[I0]).sort((a, b) => a - b);
  let filled = 0;
  for (let i = 0; i < at0.length - 1; i++) {
    filled += 2;
    const gap = at0[i + 1] - at0[i];
    const mid = (at0[i] + at0[i + 1]) / 2;
    if (gap > 0.3 && mid > emin && mid < emax) parts.push(`<text class="magic" x="${x(0) - 4}" y="${y(mid) + 4}" text-anchor="end">${filled}</text>`);
  }
  return `<svg class="nilsson-chart" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

// Time-rate slider: 0–100 ↦ 0.5 to 2000 babyseconds per real second (log scale).
const rateFromSlider = (v) => 0.5 * 4000 ** (v / 100);
const sliderFromRate = (r) => Math.max(0, Math.min(100, (100 * Math.log(r / 0.5)) / Math.log(4000)));

/** Energy-vs-deformation chart from the shape calculation, as inline SVG. */
function shapeChart(shape) {
  if (!shape.curve) return '';
  const W = 260, H = 110, pad = 22;
  const xs = shape.curve.map((c) => c.beta), ys = shape.curve.map((c) => c.E);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys, -1), y1 = Math.max(Math.min(Math.max(...ys), 12), 2);
  const X = (b) => pad + ((b - x0) / (x1 - x0)) * (W - pad - 6);
  const Y = (e) => 6 + ((y1 - Math.min(e, y1)) / (y1 - y0)) * (H - pad - 6);
  const path = shape.curve.map((c, i) => `${i ? 'L' : 'M'}${X(c.beta).toFixed(1)},${Y(c.E).toFixed(1)}`).join('');
  const min = shape.curve.reduce((b, c) => (c.E < b.E ? c : b));
  return `<svg class="shape-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Energy versus deformation">
    <line x1="${X(0)}" y1="6" x2="${X(0)}" y2="${H - pad}" class="axis-zero"/>
    <line x1="${pad}" y1="${Y(0)}" x2="${W - 6}" y2="${Y(0)}" class="axis-zero"/>
    <path d="${path}" class="curve"/>
    <circle cx="${X(min.beta)}" cy="${Y(min.E)}" r="4" class="min"/>
    <text x="${pad}" y="${H - 6}" class="lbl">oblate</text>
    <text x="${X(0)}" y="${H - 6}" class="lbl" text-anchor="middle">round</text>
    <text x="${W - 6}" y="${H - 6}" class="lbl" text-anchor="end">prolate</text>
    <text x="4" y="12" class="lbl">E</text>
  </svg>`;
}

const symbolOf = (Z) => ELEMENTS[Z - 1]?.symbol ?? '?';
const nuclideHTML = (Z, A) => `<sup>${A}</sup>${symbolOf(Z)}`;
const nuclideText = (Z, A) => `${String(A).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])}${symbolOf(Z)}`;
const MODE_NAMES = { 'α': 'α decay', 'β⁻': 'β⁻ decay', 'β⁺': 'β⁺ decay', EC: 'electron capture', '2β⁻': 'double β⁻ decay', SF: 'spontaneous fission' };
const daughterOf = (Z, A, type) => ({ 'α': [Z - 2, A - 4], 'β⁻': [Z + 1, A], 'β⁺': [Z - 1, A], EC: [Z - 1, A], '2β⁻': [Z + 2, A] })[type];

/** Potential energy of an α vs distance: nuclear well inside R, Coulomb 2Z_d·e²/r outside. */
function barrierChart(g, Q) {
  const W = 520, H = 190, x0 = 40, x1 = W - 12, yb = H - 30, yt = 12;
  const rMax = Math.min(g.b * 1.15, 140);
  const vMax = g.barrier * 1.1, vMin = -12;
  const X = (r) => x0 + (r / rMax) * (x1 - x0);
  const Y = (v) => yt + ((vMax - v) / (vMax - vMin)) * (yb - yt);
  let d = `M${X(0)},${Y(-10)}L${X(g.R)},${Y(-10)}L${X(g.R)},${Y(g.barrier)}`;
  for (let r = g.R; r <= rMax; r += rMax / 200) d += `L${X(r).toFixed(1)},${Y((2 * (g.barrier * g.R)) / (2 * r)).toFixed(1)}`;
  let tunnel = `M${X(g.R)},${Y(Q)}`;
  for (let r = g.R; r <= Math.min(g.b, rMax); r += (g.b - g.R) / 80) tunnel += `L${X(r).toFixed(1)},${Y((g.barrier * g.R) / r).toFixed(1)}`;
  tunnel += `L${X(Math.min(g.b, rMax))},${Y(Q)}Z`;
  return `<svg class="decay-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Coulomb barrier for alpha decay">
    <path d="${tunnel}" class="tunnel"/><path d="${d}" class="curve"/>
    <line x1="${X(0)}" x2="${x1}" y1="${Y(Q)}" y2="${Y(Q)}" class="qline"/>
    <line x1="${x0}" x2="${x1}" y1="${Y(0)}" y2="${Y(0)}" class="axis"/>
    <text x="${X(g.R) + 6}" y="${Y(g.barrier) + 4}" class="hl">barrier ≈ ${g.barrier.toFixed(0)} MeV</text>
    <text x="${x1}" y="${Y(Q) - 6}" text-anchor="end" class="hl">α energy Q = ${Q.toFixed(2)} MeV</text>
    <text x="${(X(g.R) + X(Math.min(g.b, rMax))) / 2}" y="${Y(Q) + 16}" text-anchor="middle" class="lbl">tunnels through ${(g.b - g.R).toFixed(0)} fm of “forbidden” region</text>
    <text x="${X(g.R / 2)}" y="${Y(-10) - 6}" text-anchor="middle" class="lbl">inside</text>
    <text x="${x0}" y="${H - 8}" class="lbl">0</text><text x="${x1}" y="${H - 8}" text-anchor="end" class="lbl">${rMax.toFixed(0)} fm from the center</text>
    <text x="4" y="${yt + 4}" class="lbl">MeV</text>
  </svg>`;
}

/** Energy of the isobars (same A) vs Z: β decay runs downhill toward the valley of stability. */
function parabolaChart(Z, A, toZ) {
  const zs = [];
  for (let z = Z - 4; z <= Z + 4; z++) if (z >= 1 && z < A) zs.push(z);
  // Atomic mass energy relative to Z: E(z) = −B(z, A) − z·(m_n − m_H)c².
  const E = (z) => -bindingOf(z, A) - z * 0.782;
  const es = zs.map(E), lo = Math.min(...es), hi = Math.max(...es);
  const W = 520, H = 190, x0 = 30, x1 = W - 20, yb = H - 34, yt = 14;
  const X = (z) => x0 + ((z - zs[0]) / Math.max(1, zs.at(-1) - zs[0])) * (x1 - x0);
  const Y = (e) => yt + ((e - lo) / Math.max(1e-6, hi - lo)) * (yb - yt);
  const pts = zs.map((z, k) => `<circle cx="${X(z)}" cy="${Y(es[k])}" r="${z === Z || z === toZ ? 6 : 4}" class="dot${z === Z || z === toZ ? ' hi' : ''}"/><text x="${X(z)}" y="${H - 14}" text-anchor="middle" class="lbl">${nuclideText(z, A)}</text>`).join('');
  return `<svg class="decay-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mass parabola">
    <defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0L8,4L0,8Z" fill="#ffd75e"/></marker></defs>
    <path d="${zs.map((z, k) => `${k ? 'L' : 'M'}${X(z)},${Y(es[k])}`).join('')}" class="curve" opacity="0.5"/>${pts}
    <line x1="${X(Z)}" y1="${Y(E(Z))}" x2="${X(toZ)}" y2="${Y(E(toZ)) - 6}" class="arrow"/>
    <text x="4" y="${yt + 2}" class="lbl">mass (energy) ↓ lower is more stable</text>
  </svg>`;
}

/** Binding energy per nucleon vs A, with arrows for a fission split or a fusion. */
function bindingChart(marks) {
  const W = 520, H = 200, x0 = 36, x1 = W - 12, yb = H - 30, yt = 12;
  const X = (a) => x0 + (a / 250) * (x1 - x0);
  const Y = (b) => yt + ((9 - b) / 9) * (yb - yt);
  let d = '';
  for (let a = 12; a <= 250; a += 2) {
    const z = Math.round(a / (1.98 + 0.0155 * a ** (2 / 3)));
    d += `${d ? 'L' : 'M'}${X(a).toFixed(1)},${Y(bindingOf(z, a) / a).toFixed(1)}`;
  }
  const light = [[1, 2], [1, 3], [2, 3], [2, 4], [3, 6], [3, 7], [4, 9], [6, 12], [8, 16]];
  const dots = light.map(([z, a]) => `<circle cx="${X(a)}" cy="${Y(bindingOf(z, a) / a)}" r="3" class="dot"/>`).join('');
  const markSvg = marks.map(({ Z, A, label }) => `<circle cx="${X(A)}" cy="${Y(bindingOf(Z, A) / A)}" r="5" class="dot hi"/><text x="${X(A) + 6}" y="${Y(bindingOf(Z, A) / A) + (A < 20 ? 14 : -8)}" class="hl">${label}</text>`).join('');
  const arrows = marks.filter((m) => m.from).map(({ Z, A, from }) => `<line x1="${X(from.A)}" y1="${Y(bindingOf(from.Z, from.A) / from.A)}" x2="${X(A)}" y2="${Y(bindingOf(Z, A) / A) + 6}" class="arrow"/>`).join('');
  return `<svg class="decay-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Binding energy per nucleon">
    <defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0L8,4L0,8Z" fill="#ffd75e"/></marker></defs>
    <path d="${d}" class="curve"/>${dots}${arrows}${markSvg}
    <line x1="${x0}" x2="${x1}" y1="${yb}" y2="${yb}" class="axis"/>
    ${[0, 50, 100, 150, 200, 250].map((a) => `<text x="${X(a)}" y="${H - 12}" text-anchor="middle" class="lbl">${a}</text>`).join('')}
    <text x="${x1}" y="${H - 1}" text-anchor="end" class="lbl">mass number A</text>
    ${[2, 4, 6, 8].map((b) => `<text x="${x0 - 6}" y="${Y(b) + 4}" text-anchor="end" class="lbl">${b}</text>`).join('')}
    <text x="4" y="${yt}" class="lbl">MeV per nucleon</text>
    <text x="${X(56)}" y="${Y(8.8) - 8}" text-anchor="middle" class="lbl">iron peak</text>
  </svg>`;
}

export function createNucleusUI({ onElementChange } = {}) {
  const viewer = new NucleusViewer($('#nuc-canvas'));
  let z = 6, neutrons = null;
  let iso = null, modes = null, shape = null, radii = null;
  let mode = 'none', preferred = 'auto', view = 'nucleus';
  let spin = 10;
  let stats = null;
  let eventInfo = null; // the decay or reaction playing, if any
  let chart = null; // the chart of nuclides, built the first time it's shown
  let chartPick = null; // the square picked on the chart
  let shellPref = 'n', shellKind = 'n', shellDelta = null, shellPick = null; // shell model: δ null = ground state, pick null = valence
  let shellKey = '';
  let active = false;
  let beam = 'n'; // projectile for bombarding
  const beamE = { ...BEAM_DEFAULT }; // energy per projectile (MeV, or 'gdr')
  let physClock = null; // { t, slow } while a bombardment plays

  viewer.onScaleChange = (fm) => { $('#nuc-scale').textContent = `view width ≈ ${fm < 10 ? fm.toFixed(1) : fm.toFixed(0)} fm`; };
  viewer.onClock = (t, lagging) => {
    if (eventInfo?.type === 'bombard' && physClock) {
      const { t: tp, slow } = physClock;
      $('#nuc-clock').innerHTML = `real time since launch: ${sci(tp, 2)} s${slow ? ` · slowed down ${sci(slow, 1)}×` : ' · paused'}`;
      return;
    }
    $('#nuc-clock').textContent = `t = ${t < 1000 ? t.toFixed(1) : about(t)} babyseconds (${sci(t * BABYSECOND)} s)${lagging ? ' · nucleon motion slowed to keep up' : ''}`;
  };
  viewer.onStats = (s) => { stats = s; renderStats(); };
  viewer.onEventCaption = (text) => { $('#nuc-caption').innerHTML = text; };
  viewer.onEventEnd = () => { if (eventInfo) { eventInfo.done = true; render(); } };
  viewer.onEventTime = (t, slow) => { physClock = { t, slow }; };
  viewer.onEventStage = (k) => {
    if (eventInfo) eventInfo.stage = k;
    document.querySelectorAll('#beam-timeline li').forEach((li, i) => { li.classList.toggle('now', i === k); li.classList.toggle('past', i < k); });
  };

  /** Show element z, optionally a specific isotope by mass number. */
  function setElement(zNew, A = null) {
    z = zNew;
    neutrons = A && allowedNeutrons(z).includes(A - z) ? A - z : null;
    load();
  }

  function load() {
    if (viewer.eventPlaying) viewer.stopEvent(false);
    eventInfo = null;
    $('#nuc-caption').innerHTML = '';
    iso = isotopeFor(z, neutrons);
    shape = deformation(iso.Z, iso.N);
    modes = collectiveModes(iso.Z, iso.A, shape.beta);
    // Halo nuclei: the wells describe the compact core; halo nucleons get their own wide well.
    radii = iso.halo ? densityRadii(iso.Z - (iso.halo.kind === 'p' ? iso.halo.halo : 0), iso.halo.core) : densityRadii(iso.Z, iso.N);
    viewer.setNucleus(iso, shape.beta, radii, periods(), modes.rotation?.E ?? null, shape.beta3);
    viewer.setWidths(Object.fromEntries(['dipole', 'breathing', 'quadrupole'].filter((k) => modes[k]).map((k) => [k, modes[k].width])));
    stats = null;
    shellDelta = null; shellPick = null;
    if (preferred === 'auto') setMode(suggestedMode().mode);
    else if (preferred === 'none' || modes[preferred]) setMode(preferred);
    else setMode('none');
    autoRate();
    history.replaceState(null, '', `#nuc=${iso.symbol}${iso.isDefault ? '' : `-${iso.A}`}`);
    if (chart) {
      chart.setSelected(iso.Z, iso.N);
      chartPick = chart.byKey.get(`${iso.Z},${iso.N}`) ?? null;
      if (view === 'chart') chart.focus(iso.Z, iso.N, 14); // picking an element in the table jumps there
    }
    render();
  }

  function periods() {
    const p = {};
    for (const k of ['dipole', 'breathing', 'quadrupole']) if (modes[k]) p[k] = modes[k].T / BABYSECOND;
    if (modes.rotation) p.rotation = rotationPeriod(modes.rotation.E, spin) / BABYSECOND;
    return p;
  }

  /** The motion that best shows off this nucleus, and why. */
  function suggestedMode() {
    const ab = Math.abs(shape.beta);
    const magic = isMagic(iso.Z) || isMagic(iso.N);
    if (!modes.dipole) return { mode: 'none', why: 'too few nucleons to move together as a whole' };
    if (modes.rotation && ab >= 0.1 && shape.depth > 2) {
      return { mode: 'rotation', why: `it’s rigidly deformed (deforming saves ${shape.depth.toFixed(1)} MeV), so it can turn as a whole` };
    }
    if (ab >= 0.05) return { mode: 'quadrupole', why: 'it’s deformed but soft, so its shape wobbles instead of holding steady' };
    if (!magic && shape.curve) return { mode: 'quadrupole', why: 'it’s round but between closed shells, so its surface vibrates easily' };
    return { mode: 'dipole', why: magic ? 'a closed shell keeps it round and stiff; its signature motion is protons sloshing against neutrons'
      : 'it’s round, and every nucleus has this proton-vs-neutron vibration' };
  }

  function setMode(m) {
    mode = m;
    viewer.setMode(m);
    const auto = preferred === 'auto';
    document.querySelectorAll('#nuc-mode button').forEach((b) => {
      b.classList.toggle('on', auto ? b.dataset.value === 'auto' : b.dataset.value === m);
      b.classList.toggle('picked', auto && b.dataset.value === m); // what Auto chose
    });
    $('#nuc-spin-wrap').hidden = m !== 'rotation' || view !== 'nucleus';
    $('#nuc-flow-wrap').hidden = m !== 'rotation' || view !== 'nucleus';
  }

  function renderStats() {
    const pc = $('#nuc-pion-count');
    if (pc && viewer.showMesons) {
      const c = viewer.pionExchanges;
      const total = c['+'] + c['-'] + c[0];
      // Per nucleon, how often halo nucleons trade pions compared with core nucleons.
      let haloNote = '';
      if (iso.halo && c.coreInv > 0) {
        const h = iso.halo.halo;
        const ratio = (c.haloInv / h) / (c.coreInv / (iso.A - h));
        const who = iso.halo.kind === 'n' ? 'neutron' : 'proton';
        haloNote = ` ${c.halo} involved a halo ${who}. Per nucleon, halo ${who}s trade pions ${ratio < 0.95 ? `only ${ratio.toFixed(2)}×` : `${ratio.toFixed(2)}×`} as often as core nucleons:`
          + (ratio < 0.95
            ? ' they’re within the pion’s ~1.4 fm reach of the core only part of the time, which is why they’re so loosely bound.'
            : ' while a halo nucleon is at the core’s surface it trades as often as any neighbor; the long trips outside, where it trades nothing, are what keep it loosely bound. (This number settles down over a minute or so.)');
      }
      pc.textContent = total ? `Exchanges so far: ${total} (π⁺ ${c['+']}, π⁻ ${c['-']}, π⁰ ${c[0]}): ${c['+'] + c['-']} of them swapped a proton and a neutron.${haloNote}` : '';
    }
    const el = $('#nuc-live');
    if (!el || !stats || view !== 'nucleus') return;
    const skin = stats.rn - stats.rp;
    el.innerHTML = `<li>Nucleon speed (rms): <b>${stats.v.toFixed(2)}c</b></li>
      ${iso.Z && iso.N && !iso.halo ? `<li>Proton radius (rms): ${stats.rp.toFixed(2)} fm</li><li>Neutron radius (rms): ${stats.rn.toFixed(2)} fm</li>
      ${iso.A >= 40 ? `<li>Neutron skin: <b>${skin >= 0 ? '+' : ''}${skin.toFixed(2)} fm</b> <span class="muted">(input ${radii.skin.toFixed(2)})</span></li>`
        : '<li class="muted">Neutron skin: too few nucleons to measure reliably</li>'}` : ''}
      ${iso.A > 2 ? `<li>Nucleons in a close pair (&lt; 1 fm): <b>${Math.round(100 * stats.pairFraction)}%</b>${stats.pnShare != null ? ` <span class="muted">· ${Math.round(100 * stats.pnShare)}% proton–neutron</span>` : ''}</li>` : ''}`;
  }

  function render() {
    document.querySelectorAll('#nuc-mode button').forEach((b) => {
      const m = b.dataset.value;
      b.disabled = m !== 'none' && m !== 'auto' && !modes[m];
      b.title = m === 'auto' ? 'Pick the motion that suits each nucleus' : m === 'none' ? '' : modes[m] ? `${energyText(modes[m].E)} · ${m === 'rotation' ? 'see spin' : bsText(modes[m].T)}`
        : m === 'rotation' ? 'Only deformed nuclei rotate' : 'Needs at least 4 nucleons';
    });
    for (const id of ['nuc-mode-wrap', 'nuc-quarks-wrap', 'nuc-mesons-wrap', 'nuc-motion-wrap', 'nuc-rate-wrap', 'nuc-extra-wrap']) $(`#${id}`).hidden = view !== 'nucleus';
    $('#nuc-iso-wrap').hidden = view !== 'nucleus' && view !== 'shell';
    $('#nuc-shell-wrap').hidden = $('#nuc-delta-wrap').hidden = view !== 'shell';
    $('#nuc-spin-wrap').hidden = mode !== 'rotation' || view !== 'nucleus';
    $('#nuc-flow-wrap').hidden = mode !== 'rotation' || view !== 'nucleus';
    $('#nuc-clock').hidden = view !== 'nucleus';
    const ns = allowedNeutrons(iso.Z);
    $('#nuc-iso').innerHTML = isoLabel(iso);
    $('#nuc-iso-down').disabled = !ns.some((n) => n < iso.N);
    $('#nuc-iso-up').disabled = !ns.some((n) => n > iso.N);
    $('#nuc-legend').innerHTML = view === 'nucleus'
      ? `<span><i style="background:${PROTON_COLOR}"></i>proton</span><span><i style="background:${NEUTRON_COLOR}"></i>neutron</span>${
        iso.halo ? `<span><i style="background:${HALO_COLOR}"></i>halo ${iso.halo.kind === 'n' ? 'neutron' : 'proton'}</span>` : ''}${
        viewer.showPairs ? `<span><i style="background:${PAIR_COLOR}"></i>close pair</span>` : ''}${
        viewer.showMesons ? `<span><i style="background:${PION_COLORS['+']}"></i>π⁺</span><span><i style="background:${PION_COLORS['-']}"></i>π⁻</span><span><i style="background:${PION_COLORS[0]}"></i>π⁰</span>` : ''}${
        viewer.showQuarks ? COLOR_CHARGES.map((c, k) => `<span><i style="background:${c}"></i>${['red', 'green', 'blue'][k]} quark</span>`).join('') : ''}`
      : `${COLOR_CHARGES.map((c, k) => `<span><i style="background:${c}"></i>${['red', 'green', 'blue'][k]}</span>`).join('')}<span><i style="background:#ffe9a8"></i>gluon</span><span><i style="background:#9ef0ff"></i>sea quark pair</span>`;

    renderDecayButtons();
    $('#nuc-chart-wrap').hidden = view !== 'chart';
    if (view === 'chart') return renderChart();
    if (view === 'shell') return renderShell();
    if (view !== 'nucleus') return renderNucleon();
    if (eventInfo?.type === 'bombard') return renderBombard();
    if (eventInfo) return renderEvent();

    const el = ELEMENTS[iso.Z - 1];
    const R = radiusFm(iso.A);
    const ratio = atomRadiusFm(iso.Z) / R;
    const B = bindingEnergy(iso.Z, iso.A);
    const b = shape.beta;
    const kind = Math.abs(b) < 0.05 ? 'Spherical' : `${b > 0 ? 'Prolate (cigar-shaped)' : 'Oblate (flattened)'}, β₂ = ${b.toFixed(2)}`;
    // R(θ) = R₀(1 + β·Y₂₀): Y₂₀ is +0.631 along the symmetry axis and −0.315 at the equator.
    const ab = Math.abs(b);
    const ratioAxes = b > 0 ? (1 + 0.6308 * ab) / (1 - 0.3154 * ab) : (1 + 0.3154 * ab) / (1 - 0.6308 * ab);
    const axisRatio = ab >= 0.05 ? ` · long/short axis ≈ ${ratioAxes.toFixed(2)}` : '';
    const stiffness = !shape.curve ? '' : shape.depth > 2 ? `Deforming saves ${shape.depth.toFixed(1)} MeV, so the shape is rigid.`
      : Math.abs(b) >= 0.05 ? `Deforming saves only ${shape.depth.toFixed(1)} MeV: a soft nucleus whose shape fluctuates.` : 'The energy is lowest when round.';
    const { np, nn } = valenceCounts(iso.Z, iso.N);
    const magic = [isMagic(iso.Z) && `${iso.Z} protons`, isMagic(iso.N) && `${iso.N} neutrons`].filter(Boolean);
    const magicText = iso.A === 1 ? 'Hydrogen’s nucleus is just one proton.'
      : magic.length ? `${magic.join(' and ')} ${magic.length > 1 ? 'are both magic numbers (doubly magic)' : 'is a magic number'}: a closed shell, which makes the nucleus round and extra stable.`
        : `${np} proton${np === 1 ? '' : 's'} and ${nn} neutron${nn === 1 ? '' : 's'} from the nearest closed shells. Mid-shell nuclei tend to deform.`;

    const m = modes[mode];
    const T = mode === 'rotation' && modes.rotation ? rotationPeriod(modes.rotation.E, spin) : m?.T;
    const autoLine = preferred === 'auto' ? `<b>Auto</b> picked ${mode === 'none' ? 'no motion' : mode} for ${isoLabel(iso)}: ${suggestedMode().why}. ` : '';
    const modeLine = m
      ? `<p class="explain">${autoLine}${MODE_TEXT[mode]} For ${isoLabel(iso)}: ${mode === 'rotation' ? `E(2⁺) = <b>${energyText(m.E)}</b>; at spin ${spin}ħ one turn takes` : `<b>${energyText(m.E)}</b>, one cycle every`} <b>${bsText(T)}</b> (${sci(T)} s). Amplitudes are exaggerated so you can see them.</p>${dampText()}`
      : `<p class="explain">${autoLine}${MODE_TEXT.none}</p>`;

    const modeRows = Object.entries({ dipole: 'Dipole (p vs n)', breathing: 'Breathing', quadrupole: 'Quadrupole' })
      .map(([k, label]) => `<li>${label}: ${modes[k] ? `${energyText(modes[k].E)} <span class="muted">· ${bsText(modes[k].T)}</span>` : '<span class="muted">—</span>'}</li>`).join('')
      + `<li>Rotation: ${modes.rotation ? `E(2⁺) ${energyText(modes.rotation.E)} <span class="muted">· ${bsText(rotationPeriod(modes.rotation.E, spin))} per turn at spin ${spin}</span>` : '<span class="muted">not deformed</span>'}</li>`;

    const flowInfo = mode === 'rotation' ? viewer.rotationFlowInfo : null;
    const flowText = flowInfo?.q != null
      ? `<p class="explain"><b>How a nucleus rotates.</b> Not like a rigid ball. Its paired nucleons behave partly like a superfluid, which can’t swirl: in a perfect fluid the <i>bulge</i> would travel around while the nucleons mostly slosh in place, like a tide moving around the Earth. From E(2⁺), this nucleus’s moment of inertia is <b>${Math.round(100 * flowInfo.q)}%</b> of a rigid body’s; an ideal fluid would give only ${Math.round(100 * flowInfo.qIrr)}%. So <b>Measured mix</b> moves the nucleons with ${Math.round(100 * flowInfo.lambda)}% rigid rotation and ${Math.round(100 * (1 - flowInfo.lambda))}% irrotational flow. Try <b>Rigid</b> and <b>Superfluid</b> to compare: watch a single nucleon, not the shape.</p>`
      : '';
    const haloText = iso.halo
      ? `<p class="explain"><b>Halo nucleus.</b> ${iso.A}${iso.symbol} is a compact core with ${iso.halo.halo} loosely bound ${iso.halo.kind === 'n' ? 'neutron' : 'proton'}${iso.halo.halo > 1 ? 's' : ''} roaming far outside it, in a shallow, wide well. That makes it far larger than its mass suggests: ¹¹Li is about as big as ²⁰⁸Pb.</p>` : '';

    $('#nuc-title').innerHTML = `<span><strong>${el.name}-${iso.A}</strong> <span class="muted">${isoLabel(iso)}</span><br><span class="muted">${iso.Z} p · ${iso.N} n</span></span>`;
    $('#nuc-info').innerHTML = `
      <div class="info-head">
        <div>
          <h2>${el.name}-${iso.A} <span class="muted">· ${isoLabel(iso)}</span></h2>
          <div class="muted">${iso.Z} proton${iso.Z > 1 ? 's' : ''} · ${iso.N} neutron${iso.N === 1 ? '' : 's'} · ${iso.stability}</div>
        </div>
      </div>
      ${radioactivityText()}
      ${modeLine}
      ${flowText}
      ${haloText}
      <p class="explain">The nucleons move on their own: confined to a few femtometers, they travel at about a fifth to a third of the speed of light, crossing this nucleus in roughly ${Math.max(1, Math.round((2 * R) / (0.25 * 3))).toLocaleString()} babyseconds (1 babysecond = 10⁻²³ s, the time light takes to cross 3 fm). The ruler’s photon moves at light speed for comparison.</p>
      <p class="explain"><b>Nucleons overlap.</b> They’re drawn at 1.08 fm, the size of a uniform ball with the proton’s measured charge radius (0.84 fm). Neighbors sit only ~1.8 fm apart, so their fuzzy edges overlap; they have no hard surface. The strong force between them is carried by pions, with a range of about 1.4 fm (ħ/m<sub>π</sub>c), so each nucleon really only feels the few it touches.</p>
      ${viewer.showMesons ? `<p class="explain"><b>Mesons: how the strong force works between nucleons.</b> Nucleons attract by tossing pions back and forth (Hideki Yukawa’s 1935 idea). A pion is a quark–antiquark pair: π⁺ = u d̄, π⁻ = d ū, π⁰ = a mix of u ū and d d̄. Its mass (140 MeV/c²) sets the force’s reach: a borrowed pion can only exist for about ħ/m<sub>π</sub>c² ≈ 4.7×10⁻²⁴ s (half a babysecond), long enough to travel ħ/m<sub>π</sub>c ≈ 1.4 fm, so only touching neighbors trade them. Watch the charged ones: when a proton throws a π⁺ it becomes a neutron, and the neutron that catches it becomes a proton (p → n + π⁺, then π⁺ + n → p). So protons and neutrons are constantly swapping identities, and the total charge never changes. Heavier mesons do other jobs, e.g. the ω meson makes the short-range repulsion that keeps nucleons from merging. Exchanges here are slowed down a lot so you can follow them.</p>
      <p class="explain muted" id="nuc-pion-count"></p>` : ''}
      <p class="explain"><b>Short-range correlated pairs.</b> About 20% of the time, two nucleons get much closer than their size, deep into each other, before the strong repulsive core below ~0.5 fm pushes them apart. Electron-scattering experiments (Jefferson Lab, with MIT’s nuclear physics group) find these pairs are ~90% proton–neutron, because of the tensor part of the nuclear force, and they’re linked to quarks behaving differently inside nuclei (the EMC effect). Turn on <b>Close pairs</b> to highlight nucleons closer than 1 fm. This simulation has no tensor force, so its pairs come out roughly as often for any combination; the live share it reports shows that difference from the real ~90%.</p>
      ${shape.beta3 ? `<p class="explain"><b>A pear-shaped nucleus.</b> ${isoLabel(iso)} is one of the few nuclei with an octupole (pear) shape: one end fatter than the other${iso.Z === 86 ? '. In radon-220 the pear shape is soft, a vibration rather than a fixed shape' : ''}. It happens when orbitals of opposite parity that differ by 3 units of angular momentum sit right at the Fermi level (j15/2 and g9/2 neutrons, i13/2 and f7/2 protons near Z ≈ 88, N ≈ 134), so mixing them pays. A pear shape has a built-in direction, which makes these nuclei sensitive amplifiers in searches for an electric dipole moment of the atom, a sign of new physics that violates time-reversal symmetry. Experiments with radium-225, a neighbor of this pear-shaped family, are doing exactly that.</p>` : ''}
      <div class="facts">
        <div><h3>Shape</h3><ul>
          <li>${iso.A < 5 ? 'Too few nucleons for a meaningful shape' : kind}${axisRatio}</li>
          ${shape.beta3 ? `<li><b>Pear-shaped</b>: octupole deformation β₃ ≈ ${shape.beta3.toFixed(2)} <span class="muted">(measured)</span></li>` : ''}
          ${shape.curve ? `<li class="muted">${stiffness}</li>` : ''}
          <li class="muted">${magicText}</li>
        </ul>${shapeChart(shape)}${shape.curve ? `<p class="chart-note">Energy vs. deformation (${shape.source}); dot = ground state.</p>` : ''}</div>
        <div><h3>Live from the simulation</h3><ul id="nuc-live"><li class="muted">measuring…</li></ul>
          <h3 style="margin-top:10px">Size</h3><ul>
          <li>R ≈ ${R.toFixed(2)} fm <span class="muted">(1.2·A<sup>⅓</sup>)</span></li>
          <li class="muted">The atom is roughly ${about(ratio)}× wider. If the nucleus were a 1 cm marble, the atom would be about ${about(ratio / 100)} m across.</li>
        </ul></div>
        <div><h3>Oscillations</h3><ul>${modeRows}</ul>
          <h3 style="margin-top:10px">Binding energy</h3><ul>
          <li>${B.B.toFixed(0)} MeV · <b>${B.perNucleon.toFixed(2)} MeV</b>/nucleon</li>
          ${iso.A < 12 ? '<li class="muted">(mass formula is rough for light nuclei)</li>' : ''}
        </ul></div>
      </div>
      <p class="note">How it’s modeled: each nucleon is a classical particle in a Woods–Saxon mean field (separate proton and neutron wells, with a neutron skin), feeling the short-range part of the Volkov nucleon–nucleon force (a repulsive core and weak attraction), plus a Langevin thermostat (random kicks and drag) that keeps their speeds at Fermi-motion values. Oscillations move the wells; the nucleons follow. The ground-state shape is computed with the Nilsson–Strutinsky method (liquid drop + shell + pairing corrections). Real nucleons are quantum waves, so this is a picture of the motion, not a full quantum calculation.</p>`;
    renderStats();
  }

    // ---------- decays and reactions ----------

  /** The decays and reactions this nucleus can show. */
  function availableEvents() {
    const d = decayInfo(iso);
    const list = d.modes.filter((m) => ['α', 'β⁻', 'β⁺', 'EC'].includes(m.type)).map((m) => ({ type: m.type, Q: m.Q, label: MODE_NAMES[m.type] }));
    if (iso.Z >= 90) list.push({ type: 'fission', label: 'Fission (neutron-induced)' });
    if (iso.Z === 1) list.push({ type: 'fusion', label: 'D + T fusion' });
    return { d, list };
  }

  function renderDecayButtons() {
    const { list } = availableEvents();
    $('#nuc-decay-wrap').hidden = view !== 'nucleus';
    renderBeam();
    $('#nuc-decay').innerHTML = (eventInfo
      ? `<button class="chip" data-event-stop>■ Back to ${isoLabel(iso)}</button>${eventInfo.done ? '<button class="chip" data-event-replay>↻ Replay</button>' : ''}${
        eventInfo.done && eventInfo.daughter ? `<button class="chip" data-event-daughter>Show ${nuclideHTML(...eventInfo.daughter)}</button>` : ''}`
      : list.length ? list.map((e) => `<button class="chip" data-event="${e.type}">▶ ${e.label}</button>`).join('')
        : '<span class="muted">Stable: no decay. Use the Isotope stepper to find unstable isotopes.</span>');
  }

  function radioactivityText() {
    const { d } = availableEvents();
    if (!d.modes.length) return '';
    const modesText = d.modes.map((m) => `${MODE_NAMES[m.type] ?? m.type}${m.Q ? ` (Q = ${m.Q < 0.1 ? `${(m.Q * 1000).toFixed(1)} keV` : `${m.Q.toFixed(m.Q < 1 ? 3 : 2)} MeV`})` : ''}`).join(', then ');
    let gamow = '';
    const a = d.modes.find((m) => m.type === 'α');
    if (a && a.Q > 0) {
      const g = alphaTunneling(iso.Z, iso.A, a.Q);
      gamow = ` Gamow’s tunneling model predicts a half-life of ${halfLifeText(g.halfLife)}${d.halfLife ? ` (measured: ${halfLifeText(d.halfLife)})` : ''}.`;
    }
    return `<p class="explain"><b>Radioactivity:</b> ${d.predicted ? 'predicted from the mass formula: ' : ''}${modesText}${d.halfLife ? `; half-life ${halfLifeText(d.halfLife)}` : ''}.${gamow} Press ▶ above to watch it happen.</p>`;
  }

  function startEvent(type) {
    const { d } = availableEvents();
    const sym = (Z, A) => nuclideText(Z, A);
    const parent = sym(iso.Z, iso.A);
    const mode = d.modes.find((m) => m.type === type);
    const Q = mode?.Q ?? 0;
    const info = { type };
    const fmtQ = Q < 0.1 ? `${(Q * 1000).toFixed(1)} keV` : `${Q.toFixed(2)} MeV`;
    if (type === 'α') {
      const g = alphaTunneling(iso.Z, iso.A, Q);
      const v = Math.sqrt((2 * Q) / (4 * AMU_MEV)) * 100;
      const [dz, da] = daughterOf(iso.Z, iso.A, type);
      info.captions = [
        'Two protons and two neutrons near the surface come together as an α particle (a ⁴He nucleus).',
        `It rattles around inside, hitting the Coulomb barrier about ${sci(g.nu)} times a second. The barrier is ${g.barrier.toFixed(0)} MeV high, but the α has only ${fmtQ}.`,
        `Each hit there’s a 1-in-${sci(1 / g.P)} chance it tunnels straight through: quantum mechanics lets it pass a wall it can’t climb.`,
        `Outside, Coulomb repulsion flings it away with ${fmtQ} (about ${v.toFixed(1)}% of light speed). ${parent} has become ${sym(dz, da)}.`,
      ];
      info.daughter = [dz, da];
      info.gamow = g;
    } else if (type === 'β⁻' || type === 'β⁺' || type === 'EC') {
      const [dz, da] = daughterOf(iso.Z, iso.A, type);
      info.captions = type === 'β⁻' ? [
        'A neutron (quarks u d d)…',
        'One down quark turns into an up quark by emitting a W⁻ boson (d → u + W⁻), which instantly becomes an electron and an antineutrino. The neutron is now a proton (u u d).',
        `The electron (the “β particle”) and the antineutrino share ${fmtQ} and fly off. ${parent} → ${sym(dz, da)}.`,
      ] : type === 'β⁺' ? [
        'A proton (quarks u u d)…',
        'One up quark turns into a down quark (u → d + W⁺ → d + e⁺ + ν). The proton is now a neutron (u d d).',
        `The positron and the neutrino share the energy and fly off; the positron soon meets an electron and both vanish into two 511 keV gamma rays (this is how PET scans work). ${parent} → ${sym(dz, da)}.`,
      ] : [
        'An inner (1s) electron of the atom, whose orbital overlaps the nucleus, wanders in…',
        '…and a proton captures it.',
        'p + e⁻ → n + ν: the proton becomes a neutron.',
        `Only the neutrino leaves, carrying ${fmtQ}; the atom then gives off X-rays as its electrons refill the hole. ${parent} → ${sym(dz, da)}.`,
      ];
      info.daughter = [dz, da];
    } else if (type === 'fission') {
      const Ac = iso.A + 1;
      const split = fissionSplit(iso.Z, Ac);
      const fb = fissionBarrier(iso.Z, Ac);
      info.split = split.heavy.A / (split.heavy.A + split.light.A);
      info.neutrons = split.neutrons;
      info.labels = [nuclideText(split.heavy.Z, split.heavy.A), nuclideText(split.light.Z, split.light.A)];
      info.captions = [
        `A neutron is absorbed: ${parent} + n → ${sym(iso.Z, Ac)}*. The ~6 MeV of binding energy it brings sets the nucleus quivering.${iso.A % 2 === 0 ? ' (For even-A nuclei like this one a fast neutron is needed; ²³⁵U and ²³⁹Pu split with slow ones.)' : ''}`,
        'The excited drop stretches. Surface tension pulls it back; the protons’ Coulomb repulsion pushes the ends apart.',
        `It gets past the fission barrier (about ${fb.Bf.toFixed(1)} MeV in the liquid-drop model) and Coulomb wins: a neck forms…`,
        `Scission! The neck snaps and ${split.neutrons} neutrons are released. Each can split another nucleus: a chain reaction.`,
        `The fragments ${info.labels.join(' and ')} fly apart at about 3–4% of light speed. Total energy released ≈ ${split.Q.toFixed(0)} MeV, around 50 million times more than burning one carbon atom.`,
      ];
      info.splitData = split;
      info.barrier = fb;
    } else if (type === 'fusion') {
      const Qf = bindingOf(2, 4) - bindingOf(1, 2) - bindingOf(1, 3);
      info.scene = { iso: { Z: 2, N: 3, A: 5, symbol: 'He', name: 'Helium', halo: null }, radii: densityRadii(2, 3) };
      info.captions = [
        'Deuterium (p + n) and tritium (p + 2n) approach. Their Coulomb barrier is about 0.4 MeV, but even at 150 million °C in a fusion reactor they carry only ~0.02 MeV…',
        '…so they tunnel through the barrier, and the strong force grabs them: a ⁵He nucleus forms for an instant.',
        `It splits into ⁴He (3.5 MeV) and a neutron (14.1 MeV): Q = ${Qf.toFixed(1)} MeV, about 4× more energy per kilogram than fission. This is what powers hydrogen-bomb and fusion-reactor designs; the Sun fuses hydrogen by a slower chain.`,
      ];
      info.Q = Qf;
    }
    info.Q ??= Q;
    eventInfo = info;
    viewer.startEvent(info);
    render();
  }

  function renderEvent() {
    const e = eventInfo;
    if (e.type === 'fusion') $('#nuc-title').innerHTML = '<span><strong>D + T fusion</strong><br><span class="muted">²H + ³H → ⁴He + n</span></span>';
    let body = '';
    if (e.type === 'α') {
      const g = e.gamow;
      body = `${barrierChart(g, e.Q)}
        <p class="explain"><b>Why α decay is so slow, and so varied.</b> Inside the nucleus the α has ${e.Q.toFixed(2)} MeV, but the Coulomb wall it must cross is ${g.barrier.toFixed(0)} MeV high and ${(g.b - g.R).toFixed(0)} fm thick. Classically it could never leave. Quantum mechanically, its wavefunction leaks through with probability e<sup>−2G</sup> = ${sci(g.P)} per hit (Gamow factor G = ${g.G.toFixed(1)}). Hitting ${sci(g.nu)} times a second, and existing as a cluster only ~3% of the time, gives a half-life of ${halfLifeText(g.halfLife)}${availableEvents().d.halfLife ? ` (measured: ${halfLifeText(availableEvents().d.halfLife)})` : ''}. Because G depends on 1/√Q, a few MeV more makes decay billions of times faster: ²¹²Po (8.95 MeV) lives 0.3 µs, ²³⁸U (4.27 MeV) 4.5 billion years.</p>`;
    } else if (e.type === 'β⁻' || e.type === 'β⁺' || e.type === 'EC') {
      body = `${parabolaChart(iso.Z, iso.A, e.daughter[0])}
        <p class="explain"><b>Sliding down the valley of stability.</b> Nuclei with the same number of nucleons (isobars) have different masses; by E = mc², lighter is more stable. β decay changes a neutron into a proton (or back) to move downhill toward the bottom of this parabola. It’s driven by the <i>weak</i> force, which is why it’s slow: free neutrons take about 10 minutes, ${availableEvents().d.halfLife ? `and this nucleus ${halfLifeText(availableEvents().d.halfLife)}` : 'and nuclei anywhere from milliseconds to billions of years'}. The energy is shared randomly between the ${e.type === 'β⁻' ? 'electron and antineutrino' : e.type === 'β⁺' ? 'positron and neutrino' : 'neutrino and the atom'}, so β particles come out with a spread of energies; that missing energy is how Pauli predicted the neutrino in 1930.</p>`;
    } else if (e.type === 'fission') {
      const sp = e.splitData;
      body = `${bindingChart([{ Z: iso.Z, A: iso.A + 1, label: nuclideText(iso.Z, iso.A + 1) }, { ...sp.heavy, label: nuclideText(sp.heavy.Z, sp.heavy.A), from: { Z: iso.Z, A: iso.A + 1 } }, { ...sp.light, label: nuclideText(sp.light.Z, sp.light.A), from: { Z: iso.Z, A: iso.A + 1 } }])}
        <p class="explain"><b>Where the energy comes from.</b> Nucleons in mid-sized nuclei are bound more tightly (≈8.5 MeV each) than in very heavy ones (≈7.6 MeV). Splitting a ${iso.A + 1}-nucleon nucleus into two mid-sized ones gains about 0.8 MeV per nucleon, ≈ ${sp.Q.toFixed(0)} MeV in all. Most of it appears as the fragments’ speed, then heat. The barrier (≈${e.barrier.Bf.toFixed(1)} MeV here; fissility x = ${e.barrier.x.toFixed(2)}) is the hump between “surface tension wins” and “Coulomb wins”. The fragments are neutron-rich, so they go on to β-decay many times: that’s nuclear waste.</p>`;
    } else if (e.type === 'fusion') {
      body = `${bindingChart([{ Z: 1, A: 2, label: '²H' }, { Z: 1, A: 3, label: '³H' }, { Z: 2, A: 4, label: '⁴He', from: { Z: 1, A: 3 } }])}
        <p class="explain"><b>Fusion climbs the steep side of the curve.</b> ⁴He is exceptionally tightly bound (7.07 MeV per nucleon, versus 1.1 for deuterium and 2.8 for tritium), so joining light nuclei releases ${e.Q.toFixed(1)} MeV. The catch is the Coulomb barrier: both nuclei are positive, so they must be extremely hot (≈150 million °C) and still rely on tunneling. That’s why fusion power is so hard to achieve, and why the Sun, at 15 million °C, burns its hydrogen slowly over billions of years.</p>`;
    }
    $('#nuc-info').innerHTML = `<div class="info-head"><div><h2>${e.type === 'fusion' ? 'D + T fusion' : `${MODE_NAMES[e.type] ?? 'Fission'} of ${isoLabel(iso)}`}</h2>
      <div class="muted">${e.done ? 'Finished. Replay it, look at the result, or go back.' : 'Playing… (captions in the view above)'}</div></div></div>${body}
      <p class="note">The animation is schematic: real α decay waits ${e.type === 'α' ? 'on average the half-life for each nucleus' : 'its turn'}, scission takes ~10⁻²⁰ s, and the particles here move far slower than real ones.</p>`;
  }

  // ---------- bombardment ----------

  const beamEnergy = () => (beamE[beam] === 'gdr' ? modes.dipole?.E ?? 14 : beamE[beam]);

  function renderBeam() {
    $('#nuc-beam-wrap').hidden = view !== 'nucleus';
    $('#nuc-playback-wrap').hidden = view !== 'nucleus' || !eventInfo;
    document.querySelectorAll('#nuc-beam button').forEach((b) => b.classList.toggle('on', b.dataset.value === beam));
    const [lo, hi] = BEAM_RANGE[beam];
    const slider = $('#nuc-beam-energy');
    slider.min = lo; slider.max = hi;
    const E = beamEnergy();
    slider.value = Math.log10(E);
    $('#nuc-beam-energy-value').textContent = beamEnergyText(E);
    $('#nuc-beam-presets').innerHTML = BEAM_PRESETS[beam].filter(([, v]) => v !== 'gdr' || modes.dipole).map(([name, v]) => {
      const on = v === beamE[beam] || (typeof v === 'number' && typeof beamE[beam] === 'number' && Math.abs(Math.log10(v / beamE[beam])) < 0.01);
      return `<button class="chip${on ? ' on' : ''}" data-preset="${v}">${name}</button>`;
    }).join('');
    $('#nuc-pause').textContent = viewer.eventPaused ? '▶ Resume' : '❚❚ Pause';
  }

  /** Fire one projectile; force picks the outcome ('miss' or a decay channel), seed replays one. */
  function fire(force = null, seed = null) {
    if (view !== 'nucleus') return;
    if (viewer.eventPlaying) viewer.stopEvent(true);
    seed ??= (Math.random() * 2 ** 31) | 0;
    const E = beamEnergy();
    // "Hits only": a miss is shown only when asked for, or when nothing can get in.
    if (!force && $('#nuc-hits-only').checked) force = 'hit';
    const b = bombard(iso, modes, beam, E, { force, seed });
    const fin = b.finals.length === 1 ? b.finals[0] : null;
    eventInfo = { type: 'bombard', bomb: b, plan: b.plan, scene: b.scene, force, seed, beam, E,
      daughter: fin && (fin.Z !== iso.Z || fin.A !== iso.A) && canShow(fin.Z, fin.A) ? [fin.Z, fin.A] : null };
    physClock = null;
    viewer.startEvent(eventInfo);
    render();
  }

  /** Viewer stages in order (a fission step plays as four), for the timeline. */
  function timelineOf(plan) {
    const out = [];
    const name = { approach: 'Flies in', bounce: 'Bounces off', turnBack: 'Turned back', pass: 'Flies on', absorb: 'Absorbed', wait: 'Compound nucleus', fragmentGammas: 'Prompt γ rays', end: 'Done' };
    for (const st of plan.stages) {
      if (st.kind === 'fission') ['Stretches', 'Neck forms', 'Scission', 'Fragments fly apart'].forEach((l, k) => out.push({ label: l, phys: st.phys[k] }));
      else if (st.kind === 'emit') out.push({ label: `Emits ${st.label}`, phys: st.phys });
      else if (st.kind === 'gamma') out.push({ label: `Emits ${st.label}`, phys: st.phys });
      else out.push({ label: name[st.kind], phys: st.phys });
    }
    return out;
  }

  function renderBombard() {
    const e = eventInfo, b = e.bomb, P = PROJECTILES[b.x];
    const target = isoLabel(iso);
    $('#nuc-title').innerHTML = `<span><strong>${target} + ${P.sym}</strong><br><span class="muted">${b.notation}</span></span>`;
    const ent = b.ent;
    // Getting in.
    let inText;
    if (b.x === 'n') inText = `<p>No electric charge, so no barrier. Whether it sticks depends on matching waves: ${ent.Ecm < 1e-4 ? 'slow neutrons have huge wavelengths, so their capture cross section is enormous (resonances, not modeled here, make real values swing by factors of 1000)' : 'faster neutrons often just bounce off'}.</p>
      <p>Head-on chance of being absorbed: <b>${pct(ent.pIn)}</b> · average cross section ${ent.sigma < 10 ? ent.sigma.toFixed(2) : about(ent.sigma)} b (the nucleus’s own area is ${(Math.PI * (1.2 * Math.cbrt(iso.A)) ** 2 / 100).toFixed(2)} b)</p>`;
    else if (P.Z > 0) inText = `<p>It must climb or tunnel through a <b>${ent.barrier.toFixed(1)} MeV</b> Coulomb barrier with ${beamEnergyText(ent.Ecm)} (centre-of-mass energy).${ent.Ecm < ent.barrier ? ` Head-on, it would stop ${ent.closest.toFixed(0)} fm from the centre if it couldn’t tunnel.` : ' That’s enough to go over the top.'}</p>
      <p>Head-on chance of getting in: <b>${pct(ent.pIn)}</b>${ent.pIn < 1e-3 && ent.pIn > 0 ? ' (too rare to show by default: click a row below to watch one that makes it)' : ''}</p>`;
    else if (b.x === 'g') inText = `<p>Photons are absorbed mainly in the giant dipole resonance (${modes.dipole ? `${modes.dipole.E.toFixed(1)} MeV, ${modes.dipole.width.toFixed(1)} MeV wide` : 'none in so light a nucleus'}), where the protons and neutrons slosh against each other; above ~40 MeV by proton–neutron pairs.</p>
      <p>Absorption cross section ${(ent.sigma * 1000).toPrecision(3)} mb · chance a photon aimed at the nucleus is absorbed: <b>${pct(ent.pIn)}</b></p>`;
    else inText = `<p>Electrons only feel the electric charge. Nearly always they scatter elastically (how nuclear sizes are measured); rarely they hand over energy through a virtual photon, which then acts like a γ ray.</p>
      <p>Chance of exciting the nucleus: <b>${pct(ent.pIn)}</b>${b.hit ? ` · this one transferred ${b.Estar.toFixed(1)} MeV` : ''}</p>`;

    // Odds once inside.
    let oddsHTML = '';
    const f = b.first;
    if (f) {
      const cz = ent.compound.Z, ca = ent.compound.A;
      const thisFirst = b.hit ? (b.steps[0]?.kind ?? null) : 'miss';
      const rows = Object.entries(f.probs).filter(([, p]) => p > 0).sort((a, c) => c[1] - a[1]);
      oddsHTML = `<p>${b.x === 'e' ? 'With' : 'Once inside, '}${nucHTML(cz, ca)}* ${b.x === 'e' && !b.hit ? `(at ${(b.Estar ?? Math.min(b.E, modes.dipole?.E ?? 15)).toFixed(1)} MeV)` : `has ${(b.Estar ?? ent.compound.E).toFixed(2)} MeV`} and lives ${sci(f.lifetime, 1)} s. Its first move:</p>
        <table class="odds"><tbody>
        ${rows.map(([k, p]) => `<tr data-force="${k}" class="${thisFirst === k ? 'this' : ''}" title="Watch this happen"><td>${CHANNEL_NAMES[k]}</td><td class="num"><span class="bar" style="width:${Math.max(1, 70 * p).toFixed(0)}px"></span>${pct(p)}</td><td class="watch">▶</td></tr>`).join('')}
        <tr data-force="miss" class="${thisFirst === 'miss' ? 'this' : ''}" title="Watch a miss"><td>${b.x === 'n' ? 'Doesn’t get in (bounces off)' : P.Z > 0 ? 'Doesn’t get in (scattered)' : 'Doesn’t interact'}</td><td class="num">${pct(1 - ent.pIn)} of shots</td><td class="watch">▶</td></tr>
        </tbody></table>
        ${f.Bf != null && f.Bf < 40 ? `<p class="muted" style="margin-top:6px">Fission barrier ${f.Bf.toFixed(1)} MeV${(b.Estar ?? ent.compound.E) > f.Bf ? ': the excitation is above it, so it can split' : ': the excitation is below it, so splitting would need tunneling'}.</p>` : ''}`;
    } else oddsHTML = '<p class="muted">It can’t get in at this energy.</p>';

    // Timeline.
    const tl = timelineOf(b.plan);
    let tsum = 0;
    const tlHTML = tl.map((s, i) => {
      if (s.phys != null) tsum += s.phys;
      return `<li class="${i === e.stage ? 'now' : i < (e.stage ?? 0) ? 'past' : ''}"><span class="k">${i + 1}</span><span>${s.label}</span><span class="t">${s.phys != null ? `${sci(s.phys, 1)} s` : ''}</span></li>`;
    }).join('');

    // Energy budget.
    const row = (a, v, cls = '') => `<tr class="${cls}"><td>${a}</td><td class="num">${v >= 0 ? '' : '−'}${beamEnergyText(Math.abs(v))}</td></tr>`;
    const budget = `<table class="budget"><tbody>
      <tr class="head"><td colspan="2">In</td></tr>
      ${row(`${P.name} (${b.x === 'g' ? 'photon energy' : 'kinetic energy'})`, b.Ein)}
      ${b.hit && Math.abs(b.Q) > 1e-6 ? row(b.Q >= 0 ? `Mass turned into energy (Q; Δm = ${(b.Q / 931.494 * 1000).toFixed(2)} milli-u)` : `Energy turned into mass (Q; Δm = ${(-b.Q / 931.494 * 1000).toFixed(2)} milli-u)`, b.Q) : ''}
      ${row('Total to share', b.Ein + b.Q, 'sum')}
      <tr class="head"><td colspan="2">Out</td></tr>
      ${b.out.map((o) => row(o.kind === 'frag' ? `${o.what} fragment (kinetic)` : o.kind === 'γ' ? `${o.what} (radiation)` : `${o.what} (kinetic)`, o.E)).join('')}
      ${Math.abs(b.recoil) > 5e-4 ? row(b.out.some((o) => o.kind === 'frag') ? 'Fragments’ other motion' : 'Recoil of the nucleus', b.recoil) : ''}
      ${row('Total', b.out.reduce((t, o) => t + o.E, 0) + (Math.abs(b.recoil) > 5e-4 ? b.recoil : 0), 'sum')}
    </tbody></table>`;

    // Products.
    const products = b.finals.map((n) => `<li><b>${nucHTML(n.Z, n.A)}</b><span class="muted">${fateOf(n.Z, n.A)}</span>${canShow(n.Z, n.A) && (n.Z !== iso.Z || n.A !== iso.A) ? `<button class="chip" data-open-nuc="${n.Z},${n.A}">Show</button>` : ''}</li>`).join('');
    const freeN = b.out.filter((o) => o.kind === 'n').length;

    const sumLine = !b.hit ? 'Nothing inside the nucleus changed.' : Math.abs(b.Q) < 1e-6
      ? `It went in and the same kind of particle came back out (“compound elastic”): no mass changed, but the energy was shared out differently.`
      : (b.Q > 0 ? `It released <b>${b.Q.toFixed(2)} MeV</b>, about ${about(b.Q / 1e-5)} times the energy of one molecule of TNT exploding (≈10 eV).` : `It cost ${(-b.Q).toFixed(2)} MeV of the projectile’s energy to rearrange the nucleus.`);
    $('#nuc-info').innerHTML = `<div class="info-head"><div><h2>${b.notation}</h2>
      <div class="muted">${e.done ? 'Finished. Fire again for another roll of the dice, or click a row to watch that outcome.' : 'Playing… captions are in the view above. Use Playback to slow down or pause.'}</div></div></div>
      <p class="explain">${sumLine}</p>
      <div class="beam-grid"><div><h3>Getting in</h3>${inText}</div><div><h3>What the compound nucleus does</h3>${oddsHTML}</div></div>
      <div class="beam-grid">
        <div><h3>This shot, step by step (real durations)</h3><ol class="timeline" id="beam-timeline">${tlHTML}</ol>
          <p class="muted" style="font-size:11.5px;margin-top:6px">From launch to the end: ${sci(tsum, 1)} s, spanning ${Math.max(1, Math.round(Math.log10(Math.max(...tl.filter((s) => s.phys).map((s) => s.phys)) / Math.min(...tl.filter((s) => s.phys).map((s) => s.phys)))))} powers of ten. Each stage is slowed by a different factor (shown at the bottom of the view) so you can watch them all.</p></div>
        <div><h3>Energy budget</h3>${budget}</div>
      </div>
      <div class="beam-section"><h3>What’s left</h3><ul class="products">${products}${freeN ? `<li><b>${freeN} free neutron${freeN > 1 ? 's' : ''}</b><span class="muted">${b.steps.some((st) => st.kind === 'fission') ? 'each can split another nucleus: a chain reaction' : 'free neutrons β-decay in ~15 minutes unless captured first'}</span></li>` : ''}</ul></div>
      <p class="note">How it’s modeled: Bohr’s compound-nucleus picture with the Hauser–Feshbach statistical model. The projectile gets in with an optical-model (neutron), Coulomb-tunneling (charged) or giant-dipole (photon) probability; the compound nucleus then decays by neutron, proton, α or γ emission or by fission, each in proportion to its number of open channels (transmission × Fermi-gas level density of what’s left; Bohr–Wheeler over the measured fission barrier). Masses are measured for about 70 key nuclei and from the mass formula otherwise. Not modeled: individual resonances, direct (one-step) reactions, pre-equilibrium emission, pion production above ~150 MeV, and the discrete levels of light nuclei, so treat odds there as rough. In the animation, the nucleons are simulated but the projectile and emitted particles are scripted, and speeds are compressed.</p>`;
  }

  // ---------- chart of nuclides ----------

  function showChart(on) {
    $('#nuc-canvas').hidden = on;
    $('#nuc-chart').hidden = !on;
    viewer.setActive(active && !on);
    if (!on) return;
    if (!chart) {
      chart = new NuclideChart($('#nuc-chart'));
      chart.onSelect = (cell) => { chartPick = cell; render(); };
      chart.onOpen = (cell) => openInNucleus(cell);
    }
    chart.setSelected(iso.Z, iso.N);
    chartPick = chart.byKey.get(`${iso.Z},${iso.N}`) ?? null;
  }

  function openInNucleus(cell) {
    view = 'nucleus';
    document.querySelectorAll('#nuc-view button').forEach((x) => x.classList.toggle('on', x.dataset.value === 'nucleus'));
    showChart(false);
    viewer.setView('nucleus');
    setElement(cell.Z, cell.A);
    onElementChange?.(cell.Z);
  }

  function renderChart() {
    $('#nuc-title').innerHTML = '<span><strong>Chart of nuclides</strong><br><span class="muted">scroll to zoom · drag to pan · click to pick</span></span>';
    $('#nuc-caption').innerHTML = '';
    $('#nuc-clock').hidden = true;
    $('#nuc-scale').textContent = '';
    $('#nuc-legend').innerHTML = chart?.colorMode === 'binding'
      ? '<span><i style="background:rgb(30,40,110)"></i>5 MeV</span><span><i style="background:rgb(60,180,140)"></i>7 MeV</span><span><i style="background:rgb(255,230,90)"></i>8.8 MeV per nucleon</span>'
      : Object.entries({ stable: 'stable', 'β⁻': 'β⁻', 'β⁺': 'β⁺ / EC', 'α': 'α', SF: 'fission' }).map(([k, l]) => `<span><i style="background:${MODE_COLORS[k]}"></i>${l}</span>`).join('');
    const c = chartPick;
    const card = c ? (() => {
      const d = describeCell(c);
      return `<div class="chart-card"><div class="big"><sup>${d.sup}</sup>${d.symbol}</div><div><b>${d.title}</b><br><span class="muted">${d.line}</span><br>
        <button class="chip" data-open-chart>View this nucleus in 3D ▶</button></div></div>`;
    })() : '<p class="muted">Click a square to see that nucleus; double-click to open it in 3D.</p>';
    const total = chart ? chart.cells.length : 0;
    $('#nuc-info').innerHTML = `
      <div class="info-head"><div><h2>Chart of nuclides</h2>
        <div class="muted">${total.toLocaleString()} nuclei shown · 250 stable</div></div></div>
      ${card}
      <p class="explain">Every nucleus is a square: neutrons N across, protons Z up. The ~250 <b>stable</b> ones (white) form a narrow <b>valley of stability</b>. It starts along N = Z (dashed gold line) for light elements and bends toward extra neutrons for heavy ones (lead-208 has 126 neutrons for 82 protons), because extra neutrons dilute the protons’ Coulomb repulsion.</p>
      <p class="explain">Off the valley, nuclei decay back toward it: neutron-rich ones by <b>β⁻</b> (blue), proton-rich ones by <b>β⁺ or electron capture</b> (red), heavy ones by <b>α</b> (yellow), and the heaviest by <b>spontaneous fission</b> (green). The colored region ends at the <b>drip lines</b>, where the next neutron or proton wouldn’t even be bound. Outlined squares are primordial: radioactive but long-lived enough to survive since before the Earth formed (²³⁸U, ²³²Th, ⁴⁰K…).</p>
      <p class="explain">Dashed lines mark the <b>magic numbers</b> 2, 8, 20, 28, 50, 82, 126: closed shells where nuclei are extra stable and stable isotopes cluster (tin, Z = 50, has ten). Theory predicts an “island of stability” near Z ≈ 114, N = 184, which today’s superheavy-element experiments are trying to reach.</p>
      <p class="note">Brighter squares are measured (stable lists, plus decay data for about 60 nuclides here); faded ones are predicted from the semi-empirical mass formula, including the drip lines. About 3,300 nuclei have been observed so far; models predict roughly 6,000–7,000 bound ones in all. Color by <b>Binding energy</b> to see the iron–nickel peak that makes both fusion of light nuclei and fission of heavy ones release energy.</p>`;
  }

  function renderShell() {
    shellKind = (shellPref === 'p' ? iso.Z : iso.N) === 0 ? (shellPref === 'p' ? 'n' : 'p') : shellPref;
    document.querySelectorAll('#nuc-shell-kind button').forEach((b) => {
      b.classList.toggle('on', b.dataset.value === shellKind);
      b.disabled = (b.dataset.value === 'p' ? iso.Z : iso.N) === 0;
    });
    const count = shellKind === 'p' ? iso.Z : iso.N;
    const who = shellKind === 'p' ? 'proton' : 'neutron';
    const delta0 = Math.max(-0.3, Math.min(0.4, Math.round(95 * shape.beta) / 100));
    const delta = shellDelta ?? delta0;
    $('#nuc-delta').value = delta;
    $('#nuc-delta-value').textContent = `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(2)}`;
    const Nmax = shellsFor(count);
    const diag = diagramFor(shellKind, Nmax);
    const fill = fillLevels(shellKind, count, delta, Nmax, iso.A);
    const pickId = shellPick ?? fill.valence.id;
    const lv = fill.levels.find((l) => l.id === pickId) ?? fill.valence;
    const [N, twoOmega, k] = lv.id.split(',').map(Number);
    const orb = orbital(delta, shellKind, N, twoOmega, k);

    // 3D cloud, resampled only when something it depends on changes.
    const key = `${iso.Z},${iso.A},${shellKind},${lv.id},${delta}`;
    if (key !== shellKey) {
      const refit = shellKey.split(',').slice(0, 3).join() !== key.split(',').slice(0, 3).join();
      shellKey = key;
      const sample = samplePoints(orb, delta, iso.A, iso.A > 100 ? 22000 : 16000);
      const R = radiusFm(iso.A), beta = delta / 0.95;
      viewer.setOrbital(sample, { a: R * (1 - 0.3154 * beta), c: R * (1 + 0.6308 * beta) }, SPIN_COLORS, refit);
    }

    const hw = 41 / Math.cbrt(iso.A);
    const sym = `${omegaText(twoOmega)}${supParity(lv.parity)}`;
    const status = lv.occ === 2 ? 'filled (two nucleons, Ω and −Ω)' : lv.occ === 1 ? 'half filled: one unpaired nucleon' : 'empty';
    const rel = (lv.E - fill.fermi) * hw;
    const lName = 'spdfghij';
    const mix = orb.lMix.filter(([, w]) => w > 0.02).map(([l, w]) => `${Math.round(100 * w)}% ${lName[l]}`).join(' · ');
    $('#nuc-title').innerHTML = `<span><strong>${lv.label} · Ω<sup>π</sup> = ${sym}</strong><br><span class="muted">${who} orbital in ${isoLabel(iso)} · δ = ${delta.toFixed(2)}</span></span>`;
    $('#nuc-caption').innerHTML = '';
    $('#nuc-scale').textContent = '';
    $('#nuc-legend').innerHTML = `<span><i style="background:${SPIN_COLORS.up}"></i>spin up (Λ = Ω − ½)</span><span><i style="background:${SPIN_COLORS.down}"></i>spin down (Λ = Ω + ½)</span><span><i style="background:#8fa3c8"></i>nuclear surface</span>`;

    // Ground-state spin from the odd nucleon (even–even nuclei are always 0⁺).
    const oddKind = iso.Z % 2 ? (iso.N % 2 ? 'both' : 'p') : iso.N % 2 ? 'n' : null;
    let predict = '';
    if (iso.A === 1) predict = '';
    else if (!oddKind) predict = `<p class="explain"><b>Ground-state spin:</b> with even numbers of protons and of neutrons, every orbital holds a pair with opposite Ω, so the spins cancel: 0⁺, as for every even–even nucleus.</p>`;
    else if (oddKind === 'both') predict = '<p class="explain"><b>Ground-state spin:</b> an odd proton and an odd neutron both contribute, so the spin depends on how they couple (odd–odd nuclei are the hardest case).</p>';
    else {
      const f0 = fillLevels(oddKind, oddKind === 'p' ? iso.Z : iso.N, delta0, shellsFor(oddKind === 'p' ? iso.Z : iso.N), iso.A);
      const v = f0.valence;
      const deformed = Math.abs(delta0) >= 0.05;
      const spin = `${deformed ? v.twoOmega : +v.label.match(/(\d+)\/2$/)[1]}/2${v.parity === '+' ? '+' : '-'}`;
      const meas = MEASURED_SPIN[`${iso.Z},${iso.A}`];
      const fmt = (t) => t.replace('+', '⁺').replace('-', '⁻');
      predict = `<p class="explain"><b>Ground-state spin:</b> the paired nucleons cancel, so the spin comes from the one unpaired ${oddKind === 'p' ? 'proton' : 'neutron'}, which sits in the orbital nearest the Fermi level (pairing smears the filling there), the ${v.label}${deformed ? ` Ω = ${omegaText(v.twoOmega)}` : ''} orbital. ${deformed
        ? 'In a deformed nucleus the spin equals Ω, the projection on the symmetry axis'
        : 'In a round nucleus the spin is the orbital’s j'}: predicted <b>${fmt(spin)}</b>${meas ? `, measured <b>${fmt(meas)}</b> ${meas === spin ? '✓' : '✗ (the simple model misses this one: residual interactions or a different shape reorder nearby levels)'}` : ''}.</p>`;
    }

    $('#nuc-info').innerHTML = `
      <div class="info-head"><div><h2>Shell model <span class="muted">· ${who}s of ${isoLabel(iso)}</span></h2>
        <div class="muted">${count} ${who}s · ground-state δ = ${delta0.toFixed(2)} · ħω₀ = 41/A<sup>1/3</sup> = ${hw.toFixed(1)} MeV</div></div></div>
      <div class="chart-card"><div class="big">${sym}</div><div><b>${lv.label}${Math.abs(delta) >= 0.005 ? `, Ω = ${omegaText(twoOmega)}` : `, m = ${omegaText(twoOmega)}`}</b>${lv.id === fill.valence.id ? ' <span class="badge">valence</span>' : ''}<br>
        <span class="muted">${status} · ${rel >= 0 ? '+' : '−'}${Math.abs(rel).toFixed(1)} MeV from the Fermi level · ${mix} · ${Math.round(100 * orb.weightUp)}% spin up</span></div></div>
      ${nilssonSVG(diag, fill, delta, delta0, lv.id)}
      <p class="chart-note">Each line is one orbital holding two ${who}s (Ω and −Ω). Color: Ω. Solid: positive parity; dashed: negative. Dots: filled at the current δ (gold: the unpaired nucleon). Dashed gold: the Fermi level with pairing. Numbers at δ = 0: magic numbers. Click a line to see that orbital; drag δ to deform.</p>
      ${predict}
      <p class="explain">Each nucleon moves in the average pull of all the others: roughly a <b>harmonic-oscillator well</b> with a strong <b>spin–orbit</b> force. In a round nucleus the orbitals group into shells (1s1/2, 1p3/2, 1p1/2, …). Spin–orbit pulls the highest-j orbital of each shell down into the one below (1f7/2, 1g9/2, 1h11/2, 1i13/2: the “intruders”, with the opposite parity), and that's what makes the magic numbers 28, 50, 82 and 126 instead of the oscillator's 40, 70, 112.</p>
      <p class="explain">Deforming the nucleus splits each level of spin j into j + ½ orbitals, labeled by <b>Ω</b>, the spin's projection on the symmetry axis. In a <b>prolate</b> (cigar) nucleus, low-Ω orbitals run along the long axis, stay deeper in the well and drop in energy; high-Ω orbitals circle the waist and rise. Oblate is the reverse. Where the dropping and rising lines leave a gap at the Fermi level, the nucleus gains energy by deforming. That's how mid-shell nuclei like ¹⁶⁶Er and ²³⁸U end up cigar-shaped.</p>
      <p class="explain">The 3D view shows where one nucleon in the chosen orbital is likely to be. The two colors are its spin-up and spin-down parts, which orbit the axis with Λ = Ω ∓ ½ units of orbital angular momentum. The faint shell is the nucleus's surface.</p>
      <p class="note">Nilsson model: stretched oscillator with Bengtsson–Ragnarsson κ, μ, diagonalized within each oscillator shell (no ΔN = 2 mixing), without pairing or residual interactions. Level orders are realistic, and energies are good to a few hundred keV near the Fermi level.</p>`;
  }

  /** How fast the chosen giant resonance dies out. */
  function dampText() {
    const m = modes[mode];
    if (!m?.width) return '';
    const tau = (2 * HBAR_MEV_S) / m.width; // amplitude decay time, s
    const cycles = tau / m.T;
    return `<p class="explain"><b>Damping.</b> A real giant resonance isn’t a clean bell: its width Γ ≈ <b>${m.width.toFixed(1)} MeV</b> means it rings down within about ${cycles < 1.5 ? 'one cycle' : `${cycles.toFixed(1)} cycles`} (amplitude falls by e every ${bsText(tau)}). The ordered motion dissolves into more complicated motion of individual nucleons, which heats the nucleus until it boils off a neutron or emits a γ-ray. ${$('#nuc-damped').checked ? 'Here a new γ-ray re-excites it every few cycles. Uncheck <b>Damped</b> to see the idealized undamped mode.' : 'Damping is off: this is the idealized, undamped mode.'}</p>`;
  }

  function renderNucleon() {
      const kind = view;
      const info = NUCLEONS[kind];
      const quarkMass = info.quarks.reduce((s, q) => s + QUARKS[q].mass, 0);
      const pct = (100 * quarkMass) / info.mass;
      const chargeSum = info.quarks.map((q) => QUARKS[q].charge).join(' ');
      const name = kind[0].toUpperCase() + kind.slice(1);
      $('#nuc-title').innerHTML = `<span><strong>Inside a ${kind}</strong><br><span class="muted">${info.quarks.join('')} · charge ${info.charge}</span></span>`;
      $('#nuc-info').innerHTML = `
        <div class="info-head"><div>
          <h2>${name} <span class="muted">· ${info.quarks.join('')}</span></h2>
          <div class="muted">${info.mass.toFixed(3)} MeV/c² · radius ≈ ${info.radius} fm · charge ${info.charge}</div>
        </div></div>
        <p class="explain">A ${kind} is two ${info.quarks[0] === info.quarks[1] ? 'up' : ''}${kind === 'neutron' ? 'down quarks and one up' : ' quarks and one down'} quark: charges ${chargeSum} add up to ${info.charge}. Each quark carries a “color” charge (red, green or blue, unrelated to real color). Gluons constantly carry color between the quarks, which is why the colors keep swapping, but the three together always stay colorless.</p>
        <p class="explain">The quarks’ own masses add up to only about ${quarkMass.toFixed(1)} MeV/c², ${pct.toFixed(1)}% of the ${kind}’s ${info.mass.toFixed(1)} MeV/c². The other ${(100 - pct).toFixed(0)}% is the energy of the gluon field and the quarks’ motion (E = mc²). Most of the mass of everything around you comes from this.</p>
        <div class="facts">
          <div><h3>Valence quarks</h3><ul>${info.quarks.map((q) => `<li>${QUARKS[q].name} (${q}) <span class="muted">· charge ${QUARKS[q].charge} · ${QUARKS[q].mass} MeV/c²</span></li>`).join('')}</ul></div>
          <div><h3>Also inside</h3><ul>
            <li>Gluons <span class="muted">· carriers of the strong force, massless</span></li>
            <li>Sea quarks <span class="muted">· quark–antiquark pairs that flicker in and out of existence</span></li>
          </ul></div>
        </div>
        <p class="note">Quarks are never found alone (confinement): pulling one out stretches the gluon field until it has enough energy to create a new quark–antiquark pair. The picture is schematic; quarks aren’t little balls with sharp positions.</p>`;
    }

  // ---------- controls ----------

  // Pick a time rate that makes the chosen motion visible: ~4 s per vibration, ~6 s per turn.
  function autoRate() {
    const p = periods()[mode];
    $('#nuc-rate').value = p ? sliderFromRate(p / (mode === 'rotation' ? 6 : 4)) : 25; // 25 ≈ 4 bs/s
    showRate();
  }

  $('#nuc-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    preferred = b.dataset.value;
    setMode(preferred === 'auto' ? suggestedMode().mode : preferred);
    autoRate();
    render();
  });
  $('#nuc-view').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (eventInfo) { viewer.stopEvent(true); eventInfo = null; $('#nuc-caption').innerHTML = ''; }
    view = b.dataset.value;
    document.querySelectorAll('#nuc-view button').forEach((x) => x.classList.toggle('on', x === b));
    showChart(view === 'chart');
    if (view !== 'chart') viewer.setView(view === 'nucleus' ? 'nucleus' : view === 'shell' ? 'orbital' : 'nucleon', view);
    if (view === 'shell') shellKey = ''; // refit to the orbital
    render();
  });
  $('#nuc-style').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    document.querySelectorAll('#nuc-style button').forEach((x) => x.classList.toggle('on', x === b));
    viewer.setStyle(b.dataset.value);
  });
  const stepIsotope = (dir) => {
    const ns = allowedNeutrons(iso.Z);
    const next = dir > 0 ? ns.find((n) => n > iso.N) : [...ns].reverse().find((n) => n < iso.N);
    if (next == null) return;
    neutrons = next;
    load();
  };
  $('#nuc-iso-down').addEventListener('click', () => stepIsotope(-1));
  $('#nuc-iso-up').addEventListener('click', () => stepIsotope(1));
  $('#nuc-motion').addEventListener('change', (e) => viewer.setMotion(e.target.checked));
  $('#nuc-quarks').addEventListener('change', (e) => { viewer.setQuarks(e.target.checked); render(); });
  $('#nuc-field').addEventListener('change', (e) => viewer.setField(e.target.checked));
  $('#nuc-ruler').addEventListener('change', (e) => viewer.setRuler(e.target.checked));
  $('#nuc-pairs').addEventListener('change', (e) => { viewer.setPairs(e.target.checked); render(); });
  $('#nuc-mesons').addEventListener('change', (e) => { viewer.setMesons(e.target.checked); render(); });
  $('#nuc-rotate').addEventListener('change', (e) => viewer.setAutoRotate(e.target.checked));
  $('#nuc-damped').addEventListener('change', (e) => { viewer.setDamped(e.target.checked); render(); });
  const rate = $('#nuc-rate');
  function showRate() {
    const r = rateFromSlider(+rate.value);
    viewer.setTimeRate(r);
    $('#nuc-rate-value').textContent = `${r < 10 ? r.toFixed(1) : Math.round(r).toLocaleString()} bs/s`;
  }
  rate.addEventListener('input', showRate);
  showRate();
  $('#nuc-spin').addEventListener('input', (e) => {
    spin = +e.target.value;
    $('#nuc-spin-value').textContent = `${spin}ħ`;
    viewer.setPeriods(periods());
    autoRate();
    render();
  });
  $('#nuc-flow').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    document.querySelectorAll('#nuc-flow button').forEach((x) => x.classList.toggle('on', x === b));
    viewer.setFlow(b.dataset.value);
  });
  $('#nuc-shell-kind').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    shellPref = b.dataset.value;
    shellPick = null;
    render();
  });
  let deltaFrame = 0;
  $('#nuc-delta').addEventListener('input', (e) => {
    shellDelta = +e.target.value;
    cancelAnimationFrame(deltaFrame);
    deltaFrame = requestAnimationFrame(render);
  });
  $('#nuc-delta-reset').addEventListener('click', (e) => { e.preventDefault(); shellDelta = null; render(); });
  $('#nuc-info').addEventListener('click', (e) => {
    const g = e.target.closest('[data-line]');
    if (!g) return;
    shellPick = g.dataset.line;
    render();
  });
  $('#nuc-fit').addEventListener('click', () => (view === 'chart' ? chart?.fit() : viewer.fit()));
  $('#nuc-chart-color').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    document.querySelectorAll('#nuc-chart-color button').forEach((x) => x.classList.toggle('on', x === b));
    chart?.setColorMode(b.dataset.value);
    render();
  });
  $('#nuc-info').addEventListener('click', (e) => {
    if (e.target.closest('[data-open-chart]') && chartPick) openInNucleus(chartPick);
  });
  $('#nuc-decay').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.event) startEvent(b.dataset.event);
    else if (b.dataset.eventReplay != null && eventInfo.type === 'bombard') fire(eventInfo.force, eventInfo.seed);
    else if (b.dataset.eventReplay != null) startEvent(eventInfo.type);
    else if (b.dataset.eventStop != null) { viewer.stopEvent(true); eventInfo = null; $('#nuc-caption').innerHTML = ''; render(); }
    else if (b.dataset.eventDaughter != null) {
      const [dz, da] = eventInfo.daughter;
      viewer.stopEvent(false);
      setElement(dz, da);
      onElementChange?.(dz);
    }
  });

  $('#nuc-beam').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    beam = b.dataset.value;
    renderBeam();
  });
  $('#nuc-beam-energy').addEventListener('input', (e) => {
    beamE[beam] = 10 ** +e.target.value;
    renderBeam();
  });
  $('#nuc-beam-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    beamE[beam] = b.dataset.preset === 'gdr' ? 'gdr' : +b.dataset.preset;
    renderBeam();
  });
  $('#nuc-fire').addEventListener('click', () => fire());
  $('#nuc-info').addEventListener('click', (e) => {
    const row = e.target.closest('[data-force]');
    if (row && eventInfo?.type === 'bombard') { fire(row.dataset.force); return; }
    const open = e.target.closest('[data-open-nuc]');
    if (open) {
      const [zz, aa] = open.dataset.openNuc.split(',').map(Number);
      viewer.stopEvent(false);
      setElement(zz, aa);
      onElementChange?.(zz);
    }
  });
  $('#nuc-pause').addEventListener('click', () => { viewer.eventPaused = !viewer.eventPaused; renderBeam(); });
  $('#nuc-speed').addEventListener('input', (e) => {
    viewer.eventSpeed = 10 ** +e.target.value;
    const v = viewer.eventSpeed;
    $('#nuc-speed-value').textContent = `${v < 1 ? v.toFixed(2) : v.toFixed(1)}× speed`;
  });

  return {
    setElement,
    setActive(on) { active = on; viewer.setActive(on && view !== 'chart'); },
    fit() { viewer.fit(); },
  };
}
