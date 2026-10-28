import { ELEMENTS, CATEGORIES } from './elements.js';
import { electronConfig, configHTML, slaterZeff, orbitalOccupancy, L_LETTERS } from './electron-config.js';
import { ANGULAR } from './orbitals.js';
import { AtomViewer, SUBSHELL_COLORS, PHASE_COLORS } from './viewer.js';
import { createMoleculeUI } from './molecule-ui.js';

const $ = (sel) => document.querySelector(sel);

const viewer = new AtomViewer($('#canvas'));
const state = { z: null, subshells: [], hidden: new Set(), mode: 'atoms' };
const molecules = createMoleculeUI({ onTrayChange: showTrayCounts });

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
  legend.innerHTML = Object.entries(CATEGORIES)
    .map(([key, c]) => `<li data-cat="${key}"><span class="swatch" style="background:${c.color}"></span>${c.label}</li>`)
    .join('');
  const focusCategory = (cat) => {
    table.classList.toggle('focusing', !!cat);
    table.querySelectorAll('.cell').forEach((c) => c.classList.toggle('focus', c.dataset.cat === cat));
  };
  legend.addEventListener('pointerover', (e) => focusCategory(e.target.closest('li')?.dataset.cat));
  legend.addEventListener('pointerleave', () => focusCategory(null));
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
      <div class="readout-meta">${cat.label} · ${el.mass} u</div>
      <div class="readout-config">${configHTML(el.z)}</div>
    </div>`;
}

// ---------- Selection ----------

function selectElement(z) {
  z = Math.max(1, Math.min(ELEMENTS.length, z));
  const el = ELEMENTS[z - 1];
  state.z = z;
  state.hidden = new Set();

  const config = electronConfig(z);
  state.subshells = config.map((s) => ({
    ...s,
    zeff: slaterZeff(z, config, s.n, s.l),
    orbitals: orbitalOccupancy(s.l, s.count).map((occ, k) => ({ id: `${s.n}-${s.l}-${k}`, k, occ })),
  }));

  document.querySelectorAll('.cell.selected').forEach((c) => c.classList.remove('selected'));
  document.querySelector(`.cell[data-z="${z}"]`)?.classList.add('selected');
  showReadout(z);
  if (state.mode === 'atoms') history.replaceState(null, '', `#${el.symbol}`);

  const cat = CATEGORIES[el.category];
  $('#stage-title').innerHTML = `
    <span class="stage-sym" style="--cat:${cat.color}">${el.symbol}</span>
    <span><strong>${el.name}</strong><br><span class="muted">${z} electron${z > 1 ? 's' : ''} · ${configHTML(z)}</span></span>`;

  viewer.setAtom(state.subshells);
  renderInfo();
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
    <p class="note">Shapes are hydrogen-like orbitals scaled by a Slater effective nuclear charge, so sizes are
      approximate. Each dot in a cloud is a sampled position from |ψ|²; the bright electron dots hop between
      such samples — they illustrate where an electron may be found, not a path it travels.</p>`;
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
  if (e.key === 'ArrowRight') selectElement(state.z + 1);
  else if (e.key === 'ArrowLeft') selectElement(state.z - 1);
  else if (e.key === 'f' || e.key === 'F') viewer.fit();
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

function setMode(mode) {
  state.mode = mode;
  const mol = mode === 'molecules';
  document.querySelectorAll('#app-mode button').forEach((b) => b.classList.toggle('on', b.dataset.value === mode));
  $('#table').classList.toggle('building', mol);
  $('#atom-panel').hidden = mol;
  $('#mol-panel').hidden = !mol;
  $('#tagline').textContent = mol
    ? 'Click elements to add atoms and build a molecule.'
    : 'Pick an element to see its electrons in 3D.';
  document.querySelectorAll('.cell.selected').forEach((c) => c.classList.toggle('dim-select', mol));
  viewer.setActive(!mol);
  molecules.setActive(mol);
  if (!mol && state.z) history.replaceState(null, '', `#${ELEMENTS[state.z - 1].symbol}`);
}

$('#app-mode').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn) setMode(btn.dataset.value);
});

// ---------- Start ----------

buildTable();
renderColorLegend('phase');
const hash = decodeURIComponent(location.hash.slice(1));
const fromHash = ELEMENTS.find((el) => el.symbol.toLowerCase() === hash.toLowerCase());
selectElement(fromHash ? fromHash.z : 6);
if (hash.startsWith('mol')) {
  setMode('molecules');
  molecules.loadFormula(hash.split('=')[1] || '');
} else {
  molecules.setActive(false);
}
