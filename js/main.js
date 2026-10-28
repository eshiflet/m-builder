import { ELEMENTS, CATEGORIES } from './elements.js';
import { electronConfig, configHTML, slaterZeff, orbitalOccupancy, L_LETTERS } from './electron-config.js';
import { ANGULAR } from './orbitals.js';
import { AtomViewer, SUBSHELL_COLORS, PHASE_COLORS } from './viewer.js';
import { createMoleculeUI } from './molecule-ui.js';
import { createNucleusUI } from './nucleus-ui.js';
import { createZoomUI } from './zoom-ui.js';
import { radialChart, radialNote, emissionLines, spectrumStrip, hydrogenLevels, rampColor, RAMP_CSS } from './atom-extras.js';
import { TRENDS, trendValue } from './atom-data.js';
import { solveAtom } from './atom-scf.js';

const $ = (sel) => document.querySelector(sel);

const viewer = new AtomViewer($('#canvas'));
const state = { z: null, subshells: [], hidden: new Set(), mode: 'atoms', weighted: false, spectrumPick: null, trend: 'category' };
const molecules = createMoleculeUI({ onTrayChange: showTrayCounts });
// When the Nucleus view moves to another element itself (e.g. a decay's daughter), follow it in the table.
const nucleus = createNucleusUI({ onElementChange: (z) => selectElement(z, { fromNucleus: true }) });
const zoom = createZoomUI();

// ---------- Periodic table ----------

function buildTable() {
  const table = $('#table');
  for (const el of ELEMENTS) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.dataset.z = el.z;
    cell.dataset.cat = el.category;
    cell.style.gridRow = el.row;
    cell.style.gridColumn = el.col;
    cell.style.setProperty('--cat', CATEGORIES[el.category].color);
    cell.title = `${el.name} (${el.z})`;
    cell.innerHTML = `<span class="num">${el.z}</span><span class="sym">${el.symbol}</span>`;
    table.appendChild(cell);
  }
  for (const [row, label, cat] of [[6, '57–71', 'lanthanide'], [7, '89–103', 'actinide']]) {
    const ph = document.createElement('div');
    ph.className = 'cell placeholder';
    ph.style.gridRow = row;
    ph.style.gridColumn = 3;
    ph.style.setProperty('--cat', CATEGORIES[cat].color);
    ph.dataset.cat = cat;
    ph.innerHTML = `<span class="sym">${label}</span>`;
    table.appendChild(ph);
  }

  table.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell[data-z]');
    if (!cell) return;
    if (state.mode === 'molecules') molecules.addAtom(ELEMENTS[cell.dataset.z - 1].symbol);
    else selectElement(+cell.dataset.z);
  });
  table.addEventListener('pointerover', (e) => {
    const cell = e.target.closest('.cell[data-z]');
    if (cell) showReadout(+cell.dataset.z);
  });
  table.addEventListener('pointerleave', () => showReadout(state.z));

  const legend = $('#legend');
  renderLegend();
  const focusCategory = (cat) => {
    table.classList.toggle('focusing', !!cat);
    table.querySelectorAll('.cell').forEach((c) => c.classList.toggle('focus', c.dataset.cat === cat));
  };
  legend.addEventListener('pointerover', (e) => focusCategory(e.target.closest('li')?.dataset.cat));
  legend.addEventListener('pointerleave', () => focusCategory(null));
}

// ---------- Periodic trends ----------

function renderLegend() {
  const legend = $('#legend');
  if (state.trend === 'category') {
    legend.classList.remove('trend');
    legend.innerHTML = Object.entries(CATEGORIES)
      .map(([key, c]) => `<li data-cat="${key}"><span class="swatch" style="background:${c.color}"></span>${c.label}</li>`)
      .join('');
    return;
  }
  const t = TRENDS[state.trend];
  const [lo, hi] = trendRange(t);
  legend.classList.add('trend');
  legend.innerHTML = `<li class="trend-bar"><span>≤ ${lo.toFixed(t.digits ? 1 : 0)}</span><i style="background:${RAMP_CSS}"></i><span>≥ ${hi.toFixed(t.digits ? 1 : 0)} ${t.unit}</span></li>
    <li class="trend-text">${t.text}</li>`;
}

/** Color range: 5th to 95th percentile, so a few extremes (helium) don't wash out the rest. */
function trendRange(t) {
  const v = t.values.filter((x) => x != null).sort((a, b) => a - b);
  return [v[Math.floor(0.05 * (v.length - 1))], v[Math.ceil(0.95 * (v.length - 1))]];
}

function applyTrend(key) {
  state.trend = key;
  document.querySelectorAll('#trend button').forEach((b) => b.classList.toggle('on', b.dataset.value === key));
  const t = TRENDS[key];
  const [lo, hi] = t ? trendRange(t) : [0, 1];
  document.querySelectorAll('#table .cell[data-z]').forEach((cell) => {
    const z = +cell.dataset.z;
    const el = ELEMENTS[z - 1];
    cell.querySelector('.val')?.remove();
    if (!t) { cell.style.setProperty('--cat', CATEGORIES[el.category].color); cell.classList.remove('no-data'); return; }
    const v = trendValue(key, z);
    cell.classList.toggle('no-data', v == null);
    cell.style.setProperty('--cat', v == null ? '#3a4150' : rampColor((v - lo) / (hi - lo)));
    if (v != null) cell.insertAdjacentHTML('beforeend', `<span class="val">${v.toFixed(t.digits ? (v >= 10 ? 1 : t.digits) : 0)}</span>`);
  });
  document.querySelectorAll('#table .placeholder').forEach((ph) => ph.style.setProperty('--cat', t ? '#3a4150' : CATEGORIES[ph.dataset.cat].color));
  $('#table').classList.toggle('trending', !!t);
  renderLegend();
  showReadout(state.z);
}

function showReadout(z) {
  const el = ELEMENTS[z - 1];
  if (!el) { $('#readout').innerHTML = ''; return; }
  const cat = CATEGORIES[el.category];
  $('#readout').innerHTML = `
    <div class="readout-sym" style="--cat:${cat.color}">
      <span class="num">${el.z}</span><span class="sym">${el.symbol}</span>
    </div>
    <div class="readout-text">
      <div class="readout-name">${el.name}</div>
      <div class="readout-meta">${cat.label} · ${el.mass} u${state.trend !== 'category' ? ` · ${TRENDS[state.trend].label.toLowerCase()} ${trendValue(state.trend, z) ?? '—'}${trendValue(state.trend, z) != null ? ` ${TRENDS[state.trend].unit}` : ''}` : ''}</div>
      <div class="readout-config">${configHTML(el.z)}</div>
    </div>`;
}

// ---------- Selection ----------

function selectElement(z, { fromNucleus = false } = {}) {
  z = Math.max(1, Math.min(ELEMENTS.length, z));
  const el = ELEMENTS[z - 1];
  state.z = z;
  state.hidden = new Set();
  state.spectrumPick = null;

  const config = electronConfig(z);
  const scf = solveAtom(z, config); // self-consistent radial functions (~20–200 ms, cached)
  state.subshells = config.map((s) => ({
    ...s,
    zeff: slaterZeff(z, config, s.n, s.l),
    radial: scf.orbitals.get(`${s.n}${s.l}`),
    orbitals: orbitalOccupancy(s.l, s.count).map((occ, k) => ({ id: `${s.n}-${s.l}-${k}`, k, occ })),
  }));

  document.querySelectorAll('.cell.selected').forEach((c) => c.classList.remove('selected'));
  document.querySelector(`.cell[data-z="${z}"]`)?.classList.add('selected');
  showReadout(z);
  if (state.mode === 'atoms') history.replaceState(null, '', `#${el.symbol}`);
  else if (state.mode === 'nucleus' && !fromNucleus) history.replaceState(null, '', `#nuc=${el.symbol}`);

  const cat = CATEGORIES[el.category];
  $('#stage-title').innerHTML = `
    <span class="stage-sym" style="--cat:${cat.color}">${el.symbol}</span>
    <span><strong>${el.name}</strong><br><span class="muted">${z} electron${z > 1 ? 's' : ''} · ${configHTML(z)}</span></span>`;

  viewer.setAtom(state.subshells);
  renderInfo();
  if (state.mode === 'nucleus' && !fromNucleus) nucleus.setElement(z);
}

const outermostN = () => Math.max(...state.subshells.map((s) => s.n));

function isValence(s) {
  const full = s.count === 2 * (2 * s.l + 1);
  return s.n === outermostN() || (s.l >= 2 && !full);
}

function renderInfo() {
  const el = ELEMENTS[state.z - 1];
  const cat = CATEGORIES[el.category];
  const rows = state.subshells.map((s) => {
    const boxes = s.orbitals.map((o) => {
      const ang = ANGULAR[s.l][o.k];
      const arrows = o.occ === 2 ? '↑↓' : o.occ === 1 ? '↑' : '';
      const off = state.hidden.has(o.id) ? ' off' : '';
      const empty = o.occ ? '' : ' empty';
      return `<button class="box${off}${empty}" data-id="${o.id}" ${o.occ ? '' : 'disabled'}
        title="${s.n}${ang.name}: ${o.occ} electron${o.occ === 1 ? '' : 's'}">
        <span class="arrows">${arrows}</span><span class="box-label">${ang.html}</span></button>`;
    }).join('');
    const subOff = s.orbitals.every((o) => !o.occ || state.hidden.has(o.id)) ? ' off' : '';
    return `<div class="sub-row" data-key="${s.key}">
      <button class="sub-toggle${subOff}" data-key="${s.key}" style="--sub:${SUBSHELL_COLORS[s.l]}">
        ${s.n}${L_LETTERS[s.l]}<sup>${s.count}</sup></button>
      <div class="boxes">${boxes}</div>
      <span class="zeff" title="Effective nuclear charge (Slater's rules)">Z<sub>eff</sub> ${s.zeff.toFixed(2)}</span>
    </div>`;
  }).join('');

  $('#info').innerHTML = `
    <div class="info-head">
      <div>
        <h2>${el.name} <span class="muted">· ${cat.label}</span></h2>
        <div class="muted">Atomic number ${el.z} · ${el.mass} u · <span class="config">${configHTML(el.z)}</span></div>
      </div>
      <div class="quick">
        <button class="chip" data-show="all">All</button>
        <button class="chip" data-show="valence">Valence</button>
        <button class="chip" data-show="none">None</button>
      </div>
    </div>
    <p class="hint">Click a subshell or orbital box to hide or show it; hover to highlight it.</p>
    <div class="sub-list">${rows}</div>
    <div class="section-head"><h3>Radial probability</h3>
      <div class="segmented small" id="radial-mode">
        <button data-value="per" class="${state.weighted ? '' : 'on'}">Per electron</button>
        <button data-value="all" class="${state.weighted ? 'on' : ''}">× electrons</button>
      </div></div>
    <div id="radial-wrap">${radialChart(state.subshells, { hidden: subshellHiddenKeys(), weighted: state.weighted })}</div>
    <p class="explain">${radialNote(state.subshells)}</p>
    ${spectrumHTML(el)}
    <p class="note">Radial shapes and sizes come from a self-consistent density-functional (LDA) calculation of
      this atom, solved in your browser; the angular shapes are the usual real spherical harmonics. Orbital energies
      match the NIST LDA reference tables to about 1 mHa; relativity is left out, which matters only for the heaviest
      elements. Z<sub>eff</sub> is from Slater's rules, for reference. Each dot in a cloud is a sampled position from |ψ|²; the bright electron dots hop between
      such samples — they illustrate where an electron may be found, not a path it travels.</p>`;
}

function subshellHiddenKeys() {
  return new Set(state.subshells.filter((s) => s.orbitals.every((o) => !o.occ || state.hidden.has(o.id))).map((s) => s.key));
}

function spectrumHTML(el) {
  const lines = emissionLines(el.symbol);
  if (!lines) {
    return `<div class="section-head"><h3>Emission spectrum</h3></div><p class="muted">No visible lines tabulated here for ${el.name}. Try H, He, Li, Na, Ne, Hg or Cu.</p>`;
  }
  const pick = state.spectrumPick != null ? lines[state.spectrumPick] : null;
  const pickText = pick ? `<p class="spectrum-pick"><b>${pick.nm.toFixed(1)} nm</b>${pick.from ? ` · n = ${pick.from} → 2 · photon energy ${(1239.84 / pick.nm).toFixed(2)} eV` : ` · photon energy ${(1239.84 / pick.nm).toFixed(2)} eV`}</p>` : '';
  if (el.symbol === 'H') {
    return `<div class="section-head"><h3>Emission spectrum</h3></div>
      ${spectrumStrip(lines, state.spectrumPick)}${pickText}
      ${hydrogenLevels(pick ? [pick.from, pick.to] : null)}
      <p class="explain">An electron dropping from a higher level to a lower one emits a photon carrying the energy difference, E = 13.6 eV × (1/n₁² − 1/n₂²). Only the drops to n = 2 (the <b>Balmer series</b>) give visible light: red Hα at 656.3 nm, blue-green Hβ at 486.1 nm, and violet lines crowding toward 364.6 nm. Drops to n = 1 (Lyman) are ultraviolet; drops to n = 3 (Paschen) are infrared. Click a line to see its transition.</p>
      <p class="note">Wavelengths from the Rydberg formula with hydrogen’s reduced-mass Rydberg constant, quoted in air like spectroscopy tables. Brightness is schematic.</p>`;
  }
  return `<div class="section-head"><h3>Emission spectrum</h3></div>
    ${spectrumStrip(lines, state.spectrumPick)}${pickText}
    <p class="explain">The bright lines of glowing ${el.name.toLowerCase()} vapor${el.symbol === 'Na' ? ': the famous yellow doublet at 589.0 and 589.6 nm is what makes sodium streetlights and the flame test yellow' : el.symbol === 'Ne' ? ': dozens of red and orange lines, which is why neon signs glow red-orange' : el.symbol === 'Hg' ? ': violet, blue and green lines that fluorescent tubes convert into white light' : ''}. Each line is an electron dropping between two energy levels; every element has its own pattern, which is how astronomers read the composition of stars.</p>
    <p class="note">Strong visible lines of the neutral atom (NIST), in air. Brightness is approximate.</p>`;
}

function setHidden(ids, hidden) {
  for (const id of ids) {
    if (hidden) state.hidden.add(id); else state.hidden.delete(id);
    viewer.setOrbitalVisible(id, !hidden);
  }
  renderInfo();
  viewer.fit();
}

function subshellIds(key) {
  const s = state.subshells.find((x) => x.key === key);
  return s ? s.orbitals.filter((o) => o.occ).map((o) => o.id) : [];
}

$('#info').addEventListener('click', (e) => {
  const rm = e.target.closest('#radial-mode button');
  if (rm) { state.weighted = rm.dataset.value === 'all'; return renderInfo(); }
  const sl = e.target.closest('.sline[data-line]');
  if (sl) { state.spectrumPick = state.spectrumPick === +sl.dataset.line ? null : +sl.dataset.line; return renderInfo(); }
  const box = e.target.closest('.box[data-id]');
  if (box) return setHidden([box.dataset.id], !state.hidden.has(box.dataset.id));

  const sub = e.target.closest('.sub-toggle');
  if (sub) {
    const ids = subshellIds(sub.dataset.key);
    return setHidden(ids, !ids.every((id) => state.hidden.has(id)));
  }

  const quick = e.target.closest('[data-show]');
  if (quick) {
    const all = state.subshells.flatMap((s) => subshellIds(s.key));
    const shown = quick.dataset.show === 'all' ? all
      : quick.dataset.show === 'valence' ? state.subshells.filter(isValence).flatMap((s) => subshellIds(s.key))
      : [];
    setHidden(all.filter((id) => !shown.includes(id)), true);
    setHidden(shown, false);
  }
});

$('#info').addEventListener('pointerover', (e) => {
  const box = e.target.closest('.box[data-id]');
  const row = e.target.closest('.sub-row');
  if (box) viewer.setHighlight(new Set([box.dataset.id]));
  else if (row) viewer.setHighlight(new Set(subshellIds(row.dataset.key)));
  else viewer.setHighlight(null);
  const curve = e.target.closest('.radial-chart .curve');
  const key = row?.dataset.key ?? curve?.dataset.key ?? null;
  document.querySelectorAll('.radial-chart .curve').forEach((c) => c.classList.toggle('hover', c.dataset.key === key));
  if (curve && !row) viewer.setHighlight(new Set(subshellIds(key)));
});
$('#info').addEventListener('pointerleave', () => viewer.setHighlight(null));

// ---------- Viewer controls ----------

function segmented(id, onChange) {
  const group = $(id);
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    group.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    onChange(btn.dataset.value);
  });
}

segmented('#style', (v) => viewer.setStyle(v));
$('#electrons').addEventListener('change', (e) => viewer.setElectronsVisible(e.target.checked));
segmented('#color-mode', (v) => { viewer.setColorMode(v); renderColorLegend(v); });
$('#density').addEventListener('change', (e) => viewer.setDensity(+e.target.value));
$('#rotate').addEventListener('change', (e) => viewer.setAutoRotate(e.target.checked));
$('#axes').addEventListener('change', (e) => viewer.setAxesVisible(e.target.checked));
$('#fit').addEventListener('click', () => viewer.fit());

function renderColorLegend(mode) {
  $('#color-legend').innerHTML = mode === 'phase'
    ? `<span><i style="background:${PHASE_COLORS.pos}"></i>ψ &gt; 0</span><span><i style="background:${PHASE_COLORS.neg}"></i>ψ &lt; 0</span>`
    : [...L_LETTERS].map((l, i) => `<span><i style="background:${SUBSHELL_COLORS[i]}"></i>${l}</span>`).join('');
}

viewer.onBusy = (text) => { $('#busy').textContent = text; };

viewer.onScaleChange = (widthA) => {
  const text = widthA >= 1 ? `${widthA.toFixed(widthA < 10 ? 1 : 0)} Å` : `${(widthA * 100).toFixed(widthA < 0.1 ? 1 : 0)} pm`;
  $('#scale').textContent = `view width ≈ ${text}`;
};

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (state.mode === 'molecules') {
    if (e.key === 'f' || e.key === 'F') molecules.fit();
    return;
  }
  if (state.mode === 'zoom') {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { zoom.zoomBy(e.key === 'ArrowUp' ? 0.5 : -0.5); e.preventDefault(); }
    return;
  }
  if (e.key === 'ArrowRight') selectElement(state.z + 1);
  else if (e.key === 'ArrowLeft') selectElement(state.z - 1);
  else if (e.key === 'f' || e.key === 'F') (state.mode === 'nucleus' ? nucleus : viewer).fit();
  else return;
  e.preventDefault();
});

// ---------- Atoms / molecules mode ----------

function showTrayCounts(tray) {
  document.querySelectorAll('.cell[data-z]').forEach((cell) => {
    const n = tray.get(ELEMENTS[cell.dataset.z - 1].symbol) || 0;
    cell.classList.toggle('in-tray', n > 0);
    cell.querySelector('.count')?.remove();
    if (n) cell.insertAdjacentHTML('beforeend', `<span class="count">${n}</span>`);
  });
}

const TAGLINES = {
  atoms: 'Pick an element to see its electrons in 3D.',
  molecules: 'Click elements to add atoms and build a molecule.',
  nucleus: 'Pick an element to zoom into its nucleus: protons, neutrons, and the quarks inside them.',
  zoom: 'Zoom from a drop of water down to a single quark, one power of ten at a time.',
};

function setMode(mode) {
  state.mode = mode;
  const mol = mode === 'molecules';
  document.querySelectorAll('#app-mode button').forEach((b) => b.classList.toggle('on', b.dataset.value === mode));
  $('#table').classList.toggle('building', mol);
  $('#atom-panel').hidden = mode !== 'atoms';
  $('#mol-panel').hidden = !mol;
  $('#nuc-panel').hidden = mode !== 'nucleus';
  $('#zoom-panel').hidden = mode !== 'zoom';
  $('#tagline').textContent = TAGLINES[mode];
  document.querySelectorAll('.cell.selected').forEach((c) => c.classList.toggle('dim-select', mol));
  viewer.setActive(mode === 'atoms');
  molecules.setActive(mol);
  nucleus.setActive(mode === 'nucleus');
  zoom.setActive(mode === 'zoom');
  if (mode === 'nucleus') nucleus.setElement(state.z);
  if (state.z && mode === 'atoms') history.replaceState(null, '', `#${ELEMENTS[state.z - 1].symbol}`);
  if (mode === 'zoom') history.replaceState(null, '', '#zoom');
}

$('#app-mode').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn) setMode(btn.dataset.value);
});

// ---------- Start ----------

buildTable();
renderColorLegend('phase');
$('#trend').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) applyTrend(b.dataset.value);
});
const hash = decodeURIComponent(location.hash.slice(1));
const [elementPart, isotopeA] = (hash.startsWith('nuc=') ? hash.slice(4) : hash).split('-');
const fromHash = ELEMENTS.find((el) => el.symbol.toLowerCase() === elementPart.toLowerCase());
selectElement(fromHash ? fromHash.z : 6);
if (hash.startsWith('mol') || hash.startsWith('smiles=')) {
  setMode('molecules');
  molecules.loadHash(hash);
} else if (hash === 'zoom') {
  setMode('zoom');
} else if (hash.startsWith('nuc')) {
  setMode('nucleus');
  if (isotopeA) nucleus.setElement(state.z, +isotopeA);
} else {
  molecules.setActive(false);
  nucleus.setActive(false);
}
