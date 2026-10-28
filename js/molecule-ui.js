import { ELEMENTS } from './elements.js';
import { EXAMPLES } from './molecule-data.js';
import {
  buildMolecule, parseFormula, hillKey, formulaHTML, chargeText,
  isomersOf, searchLibrary, entryCounts, entryCharge, smilesCounts, needsConformers, computeConformers,
} from './molecule.js';
import { KNOWN_MOLECULES } from './molecule-data.js';
import { configHTML } from './electron-config.js';
import { computeMOs, moField } from './eht.js';
import { MoleculeViewer, atomColor, SIGMA_COLOR, H1S_COLOR, TRANSFER_COLOR, HBOND_COLOR } from './molecule-viewer.js';
import { PHASE_COLORS } from './viewer.js';

const $ = (sel) => document.querySelector(sel);
const BY_SYMBOL = new Map(ELEMENTS.map((e) => [e.symbol, e]));
const ELEMENT_NAME = (s) => BY_SYMBOL.get(s).name;
const IDEAL_ANGLE = { 2: 180, 3: 120, 4: 109.5 };
const BOND_WORD = { 1: 'single', 2: 'double', 3: 'triple' };
const BOND_SYMBOL = { 1: '–', 2: '=', 3: '≡' };

// Iso slider: 0–100 maps logarithmically onto 0.001–1 e/bohr³.
const isoFromSlider = (v) => 10 ** (-3 + (3 * v) / 100);

const VIEW_TEXT = {
  structure: 'Ball-and-stick model with bond angles. Purple lobes are lone pairs: they repel more strongly than bonding pairs, which is what bends molecules like H₂O while CO₂ stays straight.',
  mo: 'Molecular orbitals spread over the whole molecule, computed here with Extended Hückel theory (valence Slater orbitals, measured ionization energies, H<sub>ij</sub> = 1.75·S<sub>ij</sub>·(H<sub>ii</sub>+H<sub>jj</sub>)/2). Orange and blue are the two signs of the wavefunction. Where the same color joins up between two atoms, electrons there pull the atoms together (bonding); a change of sign between them, a node, pushes them apart (antibonding). Electrons fill the levels from the bottom, two per orbital with opposite spins, and one per orbital across a set of equal-energy orbitals before pairing (Hund’s rule). EHT is qualitative: shapes, orderings and bonding character are reliable, exact energies are not. Use ↑/↓ to step through the orbitals.',
  orbitals: 'Valence-bond picture. Each atom’s hybrid orbitals point along its bonds; where lobes from two atoms overlap head-on they form a σ bond. Orange/blue lobes are p orbitals that overlap side by side (orange with orange) to form π bonds. Lavender lobes are lone pairs.',
  ionicOrbitals: 'Ionic bonding shares no orbitals. The metal hands its valence electrons to the nonmetal (arrows), leaving each ion with a filled, spherical shell like a noble gas. The ions then stick together by electrostatic attraction.',
  ionicDensity: 'Each ion keeps its own nearly spherical cloud, built from the ion’s own electron configuration. Even at low density the clouds barely merge, unlike a covalent molecule such as H₂O, where they fuse into one envelope.',
  density: 'A surface of constant total electron density. Slide toward low density and the atoms’ clouds merge into one envelope around the molecule; slide toward high density and it pinches apart into separate atoms. Colors show which atom contributes most at each point. This adds up isolated-atom clouds, and real bonding pulls a little extra density into the bonds.',
};

export function createMoleculeUI({ onTrayChange }) {
  const viewer = new MoleculeViewer($('#mol-canvas'));
  const tray = new Map();
  let charge = 0;
  let variant = 0; // which isomer, when several share the formula
  let conformer = 0;
  let customSmiles = null; // a typed SMILES that isn't in the library
  let view = 'structure';
  let mol = null;
  const moCache = new WeakMap();
  let moIndex = null; // which molecular orbital is shown (default: the HOMO)
  const moIsoFromSlider = (v) => 0.005 * 40 ** (v / 100); // 0.005–0.2 bohr^−3/2
  const MO_RES = 64;

  $('#examples').innerHTML = EXAMPLES
    .map(({ formula, charge: q = 0, name, label }) => (name
      ? `<button class="chip" data-name="${name}">${label}</button>`
      : `<button class="chip" data-formula="${formula}" data-charge="${q}">${formulaHTML(formula, q)}</button>`))
    .join('');
  $('#library').innerHTML = KNOWN_MOLECULES.filter((m) => m.name)
    .map((m) => `<option value="${m.name}"></option>`).join('');

  function setTray(counts, q = 0, opts = {}) {
    tray.clear();
    for (const [s, n] of counts) if (n > 0) tray.set(s, n);
    charge = q;
    variant = opts.variant ?? 0;
    conformer = opts.conformer ?? 0;
    customSmiles = opts.smiles ?? null;
    update();
  }

  /** Load a library entry: its atoms, and which isomer it is among same-formula entries. */
  function loadEntry(entry, opts = {}) {
    const counts = entryCounts(entry);
    const q = entryCharge(entry);
    setTray(counts, q, { variant: Math.max(0, isomersOf(counts, q).indexOf(entry)), ...opts });
  }

  // Conformer searches run in a worker (a few seconds for pairs of molecules).
  let pending = 0;
  function update() {
    const ticket = ++pending;
    let target = null;
    try { target = customSmiles ?? isomersOf(tray, charge)[variant]?.smiles; } catch { /* reported by render */ }
    if (target && needsConformers(target)) {
      viewer.setMolecule(null);
      renderTray();
      onTrayChange?.(tray);
      const several = target.includes('.');
      $('#mol-empty').innerHTML = `<div>Building 3D structure…<br><span class="muted">${several
        ? 'docking the molecules by their hydrogen bonds (a few seconds)'
        : 'relaxing the geometry with a force field'}</span></div>`;
      computeConformers(target).then(() => { if (ticket === pending) render(); });
      return;
    }
    render();
  }

  function render() {
    renderTray();
    onTrayChange?.(tray);
    mol = buildMolecule(tray, charge, { variant, conformer, smiles: customSmiles });
    const key = hillKey(tray);
    $('#charge-value').textContent = charge ? chargeText(charge) : '0';
    document.querySelectorAll('#examples .chip').forEach((c) => {
      const on = c.dataset.name
        ? mol?.name === c.dataset.name
        : !customSmiles && hillKey(parseFormula(c.dataset.formula)) === key && +c.dataset.charge === charge && tray.size > 0;
      c.classList.toggle('on', !!on);
    });
    renderVariants();
    const q = charge ? `&q=${charge}` : '';
    const extra = `${variant ? `&v=${variant}` : ''}${conformer ? `&c=${conformer}` : ''}`;

    const empty = $('#mol-empty');
    if (!mol) {
      viewer.setMolecule(null);
      empty.innerHTML = '<div>Click elements in the table to add atoms,<br>or pick an example above.</div>';
      $('#mol-title').innerHTML = '';
      $('#mol-info').innerHTML = '<p class="muted">Each click on an element adds one atom. Known molecules use measured bond lengths and angles; other single-center combinations get a VSEPR estimate.</p>';
      history.replaceState(null, '', '#mol');
      return;
    }
    history.replaceState(null, '', customSmiles
      ? `#smiles=${encodeURIComponent(customSmiles)}${conformer ? `&c=${conformer}` : ''}`
      : `#mol=${mol.error ? key : mol.formula}${q}${extra}`);
    if (mol.error) {
      viewer.setMolecule(null);
      empty.innerHTML = `<div class="error">${mol.error}</div>`;
      $('#mol-title').innerHTML = '';
      const suggest = mol.suggestCharge != null
        ? `<p>This works as an ion: <button class="chip" data-set-charge="${mol.suggestCharge}">Try ${mol.suggestName ? `${mol.suggestName}, ` : ''}${formulaHTML(mol.suggestFormula, mol.suggestCharge)}</button></p>`
        : '<p class="muted">Try one of the examples, or adjust the atom counts.</p>';
      $('#mol-info').innerHTML = `<h2>${formulaHTML(mol.formula, charge)}</h2>${suggest}`;
      return;
    }
    empty.innerHTML = '';
    viewer.setMolecule(mol);
    moIndex = null;
    if (view === 'mo') showMO();
    renderTitle();
    renderInfo();
  }

  // ---------- molecular orbitals ----------

  function moData() {
    if (!mol || mol.error) return null;
    if (!moCache.has(mol)) moCache.set(mol, computeMOs(mol));
    return moCache.get(mol);
  }

  function showMO() {
    const r = moData();
    if (!r || r.error) { viewer.setMO(new Float32Array(MO_RES ** 3), MO_RES, 1, 1, null); return; }
    moIndex ??= Math.max(0, r.homo);
    const half = Math.max(...mol.atoms.map((a) => Math.max(...a.pos.map(Math.abs)))) + 3.2;
    viewer.setMO(moField(r, moIndex, MO_RES, half), MO_RES, half, moIsoFromSlider(+$('#mo-iso').value), moIndex);
  }

  /** Share of an MO on each atom's s and p shells (c², normalized). */
  function composition(r, k) {
    const c = r.mos[k].c;
    const parts = new Map();
    let total = 0;
    r.basis.forEach((f, i) => {
      const key = `${mol.atoms[f.atom].symbol}${f.atom + 1} ${f.n}${'sp'[f.l]}`;
      parts.set(key, (parts.get(key) ?? 0) + c[i] * c[i]);
      total += c[i] * c[i];
    });
    return [...parts].map(([k2, w]) => [k2, w / total]).sort((a, b) => b[1] - a[1]);
  }

  /** Energy-level diagram as inline SVG; diatomics get atomic levels and correlation lines. */
  function moDiagram(r) {
    const n = r.mos.length;
    const lo = n <= 24 ? 0 : Math.max(0, r.homo - 11), hi = n <= 24 ? n - 1 : Math.min(n - 1, r.homo + 8);
    const shown = [];
    for (let k = lo; k <= hi; k++) shown.push(k);
    const diatomic = mol.atoms.length === 2;
    const aoE = diatomic ? r.aoLevels.flatMap((a) => a.shells.map((s) => s.energy)) : [];
    const energies = [...shown.map((k) => r.mos[k].energy), ...aoE];
    const eMin = Math.min(...energies) - 1.5, eMax = Math.max(...energies) + 1.5;
    const W = 330;
    let H = Math.min(520, Math.max(260, shown.length * 22));
    const Y = (e) => 14 + ((eMax - e) / (eMax - eMin)) * (H - 34);
    const kindColor = { bonding: '#7ee2a8', antibonding: '#ff8a80', nonbonding: '#c9d3e6' };
    const mid = diatomic ? [125, 205] : [70, 230];
    const out = [];
    // Group equal energies so degenerate orbitals sit side by side.
    const groups = [];
    for (const k of shown) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(r.mos[g[0]].energy - r.mos[k].energy) < 0.01) g.push(k); else groups.push([k]);
    }
    // Keep nearly equal levels at least 16 px apart (order preserved), growing the chart if needed.
    const groupY = new Map();
    let prevY = -Infinity;
    for (const g of [...groups].sort((a, b) => r.mos[b[0]].energy - r.mos[a[0]].energy)) {
      const y = Math.max(Y(r.mos[g[0]].energy), prevY + 16);
      groupY.set(g, y);
      prevY = y;
    }
    H = Math.max(H, prevY + 24);
    const levelX = new Map();
    let lastLabelY = -99;
    for (const g of groups) {
      const span = (mid[1] - mid[0]) / g.length;
      g.forEach((k, j) => {
        const m = r.mos[k];
        const x0 = mid[0] + j * span + 4, x1 = mid[0] + (j + 1) * span - 4;
        const y = groupY.get(g);
        levelX.set(k, [x0, x1, y]);
        const sel = k === moIndex;
        const arrows = m.occ === 2 ? '↑↓' : m.occ === 1 ? '↑' : '';
        out.push(`<g class="mo-level${sel ? ' sel' : ''}" data-mo="${k}">
          <rect x="${x0 - 2}" y="${y - 11}" width="${x1 - x0 + 4}" height="16" fill="transparent"/>
          <line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${sel ? 'var(--accent)' : kindColor[m.kind]}" stroke-width="${sel ? 3.5 : 2.2}"/>
          ${arrows ? `<text x="${(x0 + x1) / 2}" y="${y - 3}" text-anchor="middle" class="mo-e">${arrows}</text>` : ''}
        </g>`);
      });
      const y = groupY.get(g);
      const isKey = g.some((k) => k === r.homo || k === r.lumo || k === moIndex);
      if (isKey || Math.abs(y - lastLabelY) > 13) {
        const m = r.mos[g[0]];
        const tag = g.includes(r.homo) ? ' HOMO' : g.includes(r.lumo) ? ' LUMO' : '';
        out.push(`<text x="${mid[1] + 6}" y="${y + 4}" class="mo-lbl">${m.label}${tag}</text>`);
        lastLabelY = y;
      }
    }
    if (diatomic) {
      // Atomic levels on each side, with dashed lines to the MOs they make up.
      r.aoLevels.forEach((a, side) => {
        const [x0, x1] = side === 0 ? [18, 78] : [252, 312];
        a.shells.forEach((sh) => {
          const y = Y(sh.energy);
          out.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#9aa6bd" stroke-width="2"/><text x="${side === 0 ? x0 : x1}" y="${y + 14}" text-anchor="${side === 0 ? 'start' : 'end'}" class="mo-lbl">${a.symbol} ${sh.name}</text>`);
          for (const k of shown) {
            const comp = composition(r, k).find(([key]) => key === `${a.symbol}${side + 1} ${sh.name}`);
            if (!comp || comp[1] < 0.12) continue;
            const [mx0, mx1, my] = levelX.get(k);
            out.push(side === 0
              ? `<line x1="${x1}" y1="${y}" x2="${mx0}" y2="${my}" class="mo-corr"/>`
              : `<line x1="${x0}" y1="${y}" x2="${mx1}" y2="${my}" class="mo-corr"/>`);
          }
        });
      });
    }
    return `<svg class="mo-diagram" viewBox="0 0 ${W} ${H}" role="img" aria-label="Molecular orbital energy levels">
      <text x="4" y="12" class="mo-lbl">energy ↑ (eV)</text>${out.join('')}</svg>`;
  }

  function renderMOInfo() {
    const r = moData();
    const head = `<div class="info-head"><div><h2>${mol.name ?? unnamed()} <span class="muted">· ${formulaHTML(mol.formula, mol.charge)}</span></h2>
      <div class="muted">Molecular orbitals · Extended Hückel</div></div></div>`;
    if (r.error) {
      $('#mol-info').innerHTML = `${head}<p class="explain">${r.error}</p>`;
      return;
    }
    const m = r.mos[moIndex];
    const comp = composition(r, moIndex).filter(([, w]) => w >= 0.05).slice(0, 5)
      .map(([k, w]) => `${k} ${Math.round(100 * w)}%`).join(', ');
    const homo = r.mos[r.homo], lumo = r.lumo != null ? r.mos[r.lumo] : null;
    const kindText = {
      bonding: 'bonding: the wavefunction keeps the same sign between the atoms, so electrons here hold them together',
      antibonding: 'antibonding: the sign flips between the atoms (a node), so electrons here push them apart',
      nonbonding: 'nonbonding: mostly on one atom or pointing away from the bonds, like a lone pair',
    }[m.kind];
    const which = moIndex === r.homo ? ' (HOMO, highest occupied)' : moIndex === r.lumo ? ' (LUMO, lowest empty)' : '';
    const bo = r.bondOrder != null
      ? (() => {
        const be = r.mos.reduce((t, x) => t + (x.kind === 'bonding' ? x.occ : 0), 0);
        const ae = r.mos.reduce((t, x) => t + (x.kind === 'antibonding' ? x.occ : 0), 0);
        return `<li>Bond order = (bonding − antibonding electrons)/2 = (${be} − ${ae})/2 = <b>${r.bondOrder}</b></li>`;
      })() : '';
    const magnet = r.unpaired
      ? `<li><b>Paramagnetic:</b> ${r.unpaired} unpaired electron${r.unpaired > 1 ? 's' : ''}${mol.formula === 'O2' ? '. That’s why liquid oxygen sticks between the poles of a magnet, something a Lewis structure (all electrons paired) can’t explain.' : ', so it’s attracted to a magnet.'}</li>`
      : '<li>Diamagnetic: every electron is paired.</li>';
    $('#mol-info').innerHTML = `${head}
      <div class="mo-layout">
        <div>${moDiagram(r)}
          <p class="chart-note"><span style="color:#7ee2a8">■</span> bonding <span style="color:#ff8a80">■</span> antibonding <span style="color:#c9d3e6">■</span> nonbonding · click a level to show it</p></div>
        <div>
          <h3>Showing: ${m.label} <span class="muted">· MO ${moIndex + 1} of ${r.mos.length}${which}</span></h3>
          <ul class="mo-facts">
            <li>Energy ${m.energy.toFixed(2)} eV · ${m.occ ? `${m.occ} electron${m.occ > 1 ? 's' : ''}` : 'empty'}</li>
            <li>${kindText[0].toUpperCase() + kindText.slice(1)}.</li>
            <li class="muted">Made of: ${comp}</li>
          </ul>
          <h3>Whole molecule</h3>
          <ul class="mo-facts">
            <li>${r.electrons} valence electrons in ${r.mos.length} orbitals</li>
            <li>HOMO ${homo.label} ${homo.energy.toFixed(2)} eV${lumo ? ` · LUMO ${lumo.label} ${lumo.energy.toFixed(2)} eV · gap ${(lumo.energy - homo.energy).toFixed(2)} eV` : ''}</li>
            ${bo}
            ${magnet}
          </ul>
        </div>
      </div>
      <p class="note">${VIEW_TEXT.mo}</p>`;
    renderLegend();
  }

  function renderVariants() {
    const rows = [];
    if (mol?.isomers) {
      rows.push(`<div class="builder-row"><span class="control-label" title="Same atoms, connected differently">Isomers</span><div class="examples">${
        mol.isomers.map((n, i) => `<button class="chip${i === variant ? ' on' : ''}" data-variant="${i}">${n}</button>`).join('')}</div></div>`);
    }
    if (mol?.conformers?.length > 1) {
      rows.push(`<div class="builder-row"><span class="control-label" title="Same molecule, rotated around single bonds or with a flexed ring">Shapes</span><div class="examples">${
        mol.conformers.map((e, i) => `<button class="chip${i === mol.conformer ? ' on' : ''}" data-conformer="${i}" title="Energy relative to the lowest shape">${i ? `+${e.toFixed(1)}` : 'lowest'}${i ? ' <span class="muted">kcal/mol</span>' : ''}</button>`).join('')}</div></div>`);
    }
    $('#variants').innerHTML = rows.join('');
    $('#variants').hidden = !rows.length;
  }

  function renderTray() {
    $('#tray').innerHTML = tray.size
      ? [...tray].map(([s, n]) => `
          <span class="tray-atom"><i style="background:${atomColor(s)}"></i>${s}${n > 1 ? `<sub>${n}</sub>` : ''}
            <button data-remove="${s}" title="Remove one ${BY_SYMBOL.get(s).name} atom" aria-label="Remove one ${s}">−</button></span>`).join('')
      : '<span class="empty">No atoms yet</span>';
  }

  function renderTitle() {
    $('#mol-title').innerHTML = `
      <span><strong>${mol.name ?? unnamed()}</strong> <span class="muted">${formulaHTML(mol.formula, mol.charge)}</span><br>
      <span class="muted">${[mol.shape, mol.vsepr].filter(Boolean).join(' · ')}</span></span>`;
  }

  const unnamed = () => (mol.ionic ? 'Ionic compound' : mol.charge ? 'Unnamed ion' : 'Unnamed molecule');

  function renderLegend() {
    renderLegendBase();
    if (mol?.hbonds?.length && viewer.options.hbonds) {
      $('#mol-legend').insertAdjacentHTML('beforeend', `<span><i style="background:${HBOND_COLOR}"></i>hydrogen bond</span>`);
    }
  }

  function renderLegendBase() {
    if (view === 'mo') {
      $('#mol-legend').innerHTML = `<span><i style="background:${PHASE_COLORS.pos}"></i>ψ &gt; 0</span><span><i style="background:${PHASE_COLORS.neg}"></i>ψ &lt; 0</span>`;
      return;
    }
    $('#mol-legend').innerHTML = view === 'orbitals' && mol?.ionic
      ? `<span><i style="background:${TRANSFER_COLOR}"></i>electron transfer</span>
         <span><i style="background:${atomColor(mol.anion.symbol)}"></i>filled anion shell</span>`
      : view === 'orbitals'
      ? `<span><i style="background:${SIGMA_COLOR}"></i>σ hybrid</span>
         <span><i style="background:${H1S_COLOR}"></i>H 1s</span>
         <span><i style="background:${PHASE_COLORS.pos}"></i><i style="background:${PHASE_COLORS.neg};margin-left:-3px"></i>π (phase)</span>
         <span><i style="background:#b9a6ff"></i>lone pair</span>`
      : view === 'structure' && mol && !mol.error && mol.ionic
        ? '<span><i style="background:#ffb38a"></i>cation</span><span><i style="background:#8fd0ff"></i>anion</span><span><i style="background:#9aa6bd"></i>ionic attraction</span>'
      : view === 'structure' && viewer.options.lonePairs && mol && !mol.error
        ? '<span><i style="background:#b9a6ff"></i>lone pair</span><span><i style="background:#ffd75e"></i>bond angle</span>'
        : view === 'density' && mol && !mol.error
          ? [...new Set(mol.atoms.map((a) => a.symbol))].map((s) => `<span><i style="background:${atomColor(s)}"></i>${s}</span>`).join('')
          : '';
  }

  function hbondNote() {
    const n = mol.hbonds.length;
    if (!n) return '';
    const fragments = mol.smiles?.split('.').length ?? 1;
    const where = fragments > 1 ? 'between the molecules' : 'within the molecule';
    const energy = mol.hbondEnergy != null ? ` Together they contribute about ${Math.abs(mol.hbondEnergy).toFixed(1)} kcal/mol of attraction in this force field.` : '';
    return `<p class="explain">${n} hydrogen bond${n > 1 ? 's' : ''} ${where} (dashed blue): a hydrogen on N or O, slightly positive, points at a lone pair on another N or O. Each is roughly 5–20 times weaker than a covalent bond, but together they hold DNA’s strands together and make water boil at 100 °C.${energy}</p>`;
  }

  function explainIonic() {
    const { cation: c, anion: a } = mol;
    const cn = ELEMENT_NAME(c.symbol), an = ELEMENT_NAME(a.symbol);
    let text = `Each ${cn.toLowerCase()} atom gives up ${c.charge} electron${c.charge > 1 ? 's' : ''}, becoming ${c.symbol}<sup>${chargeText(c.charge)}</sup>; `
      + `each ${an.toLowerCase()} atom takes ${-a.charge}, becoming ${a.symbol}<sup>${chargeText(a.charge)}</sup>. `
      + 'The ions are held together by the attraction between opposite charges, not by a shared electron pair.';
    if (mol.atoms.length === 3) {
      text += ` The two outer ions repel each other, so they sit on opposite sides (${mol.angles[0].value.toFixed(0)}°).`;
      if (['Ca', 'Sr', 'Ba', 'Ra'].includes(mol.atoms[0].symbol)) {
        text += ' (Measured gas-phase molecules of heavier alkaline-earth halides are actually somewhat bent, because the large cation’s electron cloud gets distorted; this simple charge model can’t capture that.)';
      }
    }
    text += ` In the solid, ${mol.name?.toLowerCase() ?? 'the compound'} is a crystal lattice of many ions; this shows a single unit as found in the vapor.`;
    return text;
  }

  function explainAngle() {
    if (mol.ionic) return explainIonic();
    if (!mol.vsepr) return ''; // only single-center VSEPR shapes get this explanation
    const c = mol.atoms[0];
    const E = c.lp + c.single;
    const ideal = IDEAL_ANGLE[c.steric];
    const angle = mol.angles.find((a) => a.vertex === 0);
    if (!angle || mol.atoms.length < 3) return '';
    if (!E) {
      return `${c.symbol} has no lone pairs, so its ${c.sigmaDirs.length} bonds spread as far apart as possible: ${mol.shape?.toLowerCase()}, ${angle.value.toFixed(1)}°.`;
    }
    const lpWord = E === 1 ? (c.single ? 'one unpaired electron' : 'one lone pair') : `${E} lone pairs`;
    if (ideal && angle.value < ideal - 0.5) {
      return `${c.symbol} has ${lpWord}. Lone pairs take up more room than bonds, squeezing the bond angle from the ideal ${ideal}° down to ${angle.value.toFixed(1)}°.`;
    }
    if (ideal && angle.value > ideal + 0.5) {
      return `${c.symbol} has ${lpWord}; a single electron repels less than the bonds do, so the angle opens past ${ideal}° to ${angle.value.toFixed(1)}°.`;
    }
    const occupy = E === 1 ? 'which takes up its own position' : 'which take up their own positions';
    return `${c.symbol} has ${lpWord}, ${occupy} and give${E === 1 ? 's' : ''} the molecule its ${mol.shape?.toLowerCase()} shape.`;
  }

  function renderInfo() {
    if (view === 'mo') return renderMOInfo();
    const { atoms, bonds } = mol;
    const allAngles = viewer.showsAllAngles;
    const angles = allAngles ? mol.angles : mol.angles.filter((a) => a.vertex === viewer.selected);
    const angleRows = [...new Map(angles.map((a) => {
      const label = `${atoms[a.a].symbol}–${atoms[a.vertex].symbol}–${atoms[a.b].symbol}`;
      return [`${label}${a.value.toFixed(1)}`, `<li>${label} <span class="angle">${a.value.toFixed(1)}°</span></li>`];
    })).values()];
    const bondRows = [...new Map(bonds.map((b) => {
      const [x, y] = [atoms[b.a].symbol, atoms[b.b].symbol];
      if (b.ionic) {
        const [ca, an] = atoms[b.a].charge > 0 ? [atoms[b.a], atoms[b.b]] : [atoms[b.b], atoms[b.a]];
        return [`ionic${b.length.toFixed(2)}`, `<li>${ca.symbol}<sup>${chargeText(ca.charge)}</sup> ··· ${an.symbol}<sup>${chargeText(an.charge)}</sup> <span class="muted">ionic · ${b.length.toFixed(3)} Å</span></li>`];
      }
      // Group bonds of the same kind; show a length range when they differ.
      const rank = (e) => (e === 'C' ? 0 : e === 'H' ? 2 : 1); // C first, H last: C–O, O–H
      const [p, q] = [x, y].sort((m, n) => rank(m) - rank(n) || m.localeCompare(n));
      const key = `${p}${q}${b.order}`;
      const same = bonds.filter((o) => !o.ionic && o.order === b.order && [atoms[o.a].symbol, atoms[o.b].symbol].sort().join() === [x, y].sort().join());
      const lo = Math.min(...same.map((o) => o.length)), hi = Math.max(...same.map((o) => o.length));
      const lengths = hi - lo < 0.005 ? `${lo.toFixed(3)} Å` : `${lo.toFixed(2)}–${hi.toFixed(2)} Å`;
      const count = same.length > 1 ? ` ×${same.length}` : '';
      const sym = b.delocalized ? '⋯' : BOND_SYMBOL[b.order];
      const word = b.delocalized ? `resonance, order ${b.order}` : BOND_WORD[b.order];
      return [key, `<li>${p}${sym}${q}${count} <span class="muted">${word} · ${lengths}</span></li>`];
    })).values()];
    const ionRows = mol.ionic ? [mol.cation, mol.anion].map(({ symbol, charge: q }) => {
      const verb = q > 0 ? `gave up ${q} e⁻` : `gained ${-q} e⁻`;
      const z = BY_SYMBOL.get(symbol).z - q;
      return `<li>${symbol}<sup>${chargeText(q)}</sup>: ${verb} → ${configHTML(z)} <span class="muted">(like ${ELEMENTS[z - 1].name})</span></li>`;
    }) : null;
    const atomRows = [...new Map(atoms.map((a) => {
      const lp = a.lp ? `, ${a.lp} lone pair${a.lp > 1 ? 's' : ''}` : '';
      const se = a.single ? ', 1 unpaired e⁻' : '';
      const text = `${a.symbol}: ${a.hybrid}${lp}${se}`;
      return [text, `<li>${text}</li>`];
    })).values()];

    const badge = mol.source === 'forcefield'
      ? '<span class="badge estimate" title="Built from the bonding pattern (SMILES) and relaxed with a simple force field; angles are typically within a few degrees of measured values">Force-field geometry</span>'
      : mol.source === 'experimental'
      ? `<span class="badge measured" title="${mol.crystal ? 'Typical bond lengths from crystal structures' : 'Bond lengths and angles from gas-phase measurements'}">Measured geometry</span>`
      : mol.source === 'ionic'
        ? '<span class="badge estimate" title="Ions placed as far apart as their charges push them, at a distance estimated from ionic radii">Electrostatic estimate</span>'
        : '<span class="badge estimate" title="Shape from VSEPR rules with typical angles and estimated bond lengths">VSEPR estimate</span>';
    const chargeNote = mol.charge && !mol.ionic
      ? `<p class="explain">Overall charge ${chargeText(mol.charge)}: the ion has ${Math.abs(mol.charge)} ${mol.charge < 0 ? 'more' : 'fewer'} electron${Math.abs(mol.charge) > 1 ? 's' : ''} than its neutral atoms, which changes how many bonds and lone pairs fit.</p>`
      : '';
    const why = explainAngle();

    $('#mol-info').innerHTML = `
      <div class="info-head">
        <div>
          <h2>${mol.name ?? unnamed()} <span class="muted">· ${formulaHTML(mol.formula, mol.charge)}</span></h2>
          <div class="muted">${[mol.shape, mol.vsepr, `${mol.electrons} electrons`].filter(Boolean).join(' · ')}</div>
        </div>
        ${badge}
      </div>
      ${why ? `<p class="explain">${why}</p>` : ''}
      ${mol.note ? `<p class="explain">${mol.note}</p>` : ''}
      ${chargeNote}
      ${hbondNote()}
      ${mol.conformers?.length > 1 ? (mol.smiles?.includes('.')
        ? `<p class="explain muted">The search found ${mol.conformers.length} distinct ways for these molecules to sit together. The lowest has the most and best-aligned hydrogen bonds; pick others under <b>Shapes</b> to see what breaking or shifting them costs.</p>`
        : `<p class="explain muted">This molecule has ${mol.conformers.length} distinct low-energy shapes (conformers), found by relaxing it from different random starts. Pick one under <b>Shapes</b>; they interconvert at room temperature by rotating around single bonds or flexing rings.</p>`) : ''}
      <div class="facts">
        ${angleRows.length ? `<div><h3>Bond angles${allAngles ? '' : ` at ${atoms[viewer.selected].symbol}`}</h3><ul>${angleRows.join('')}</ul></div>`
          : allAngles ? '' : `<div><h3>Bond angles</h3><p class="muted">${viewer.selected == null ? 'Click an atom in the 3D view to show the angles around it.' : 'This atom has only one bond.'}</p></div>`}
        <div><h3>Bonds</h3><ul>${bondRows.join('')}</ul></div>
        ${mol.hbonds.length ? `<div><h3>Hydrogen bonds</h3><ul>${mol.hbonds.map((hb) => `<li>${atoms[hb.d].symbol}–H···${atoms[hb.a].symbol} <span class="muted">${hb.length.toFixed(2)} Å · ${hb.angle.toFixed(0)}°</span></li>`).join('')}</ul></div>` : ''}
        ${ionRows ? `<div><h3>Ions</h3><ul>${ionRows.join('')}</ul></div>` : `<div><h3>Hybridization</h3><ul>${atomRows.join('')}</ul></div>`}
      </div>
      <p class="note">${VIEW_TEXT[mol.ionic && view !== 'structure' ? `ionic${view[0].toUpperCase()}${view.slice(1)}` : view]}</p>
      ${mol.smiles ? `<p class="note">SMILES: <code>${mol.smiles}</code></p>` : ''}`;
    renderLegend();
  }

  // ---------- events ----------

  $('#tray').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const s = btn.dataset.remove;
    const counts = new Map(tray);
    counts.set(s, counts.get(s) - 1);
    setTray(counts, charge);
  });
  $('#tray-clear').addEventListener('click', () => setTray(new Map()));
  $('#examples').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.name) loadEntry(KNOWN_MOLECULES.find((m) => m.name === chip.dataset.name));
    else setTray(parseFormula(chip.dataset.formula), +chip.dataset.charge);
  });
  $('#variants').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    if (chip.dataset.variant != null) { variant = +chip.dataset.variant; conformer = 0; }
    if (chip.dataset.conformer != null) conformer = +chip.dataset.conformer;
    update();
  });
  viewer.onSelectAtom = () => { if (mol && !mol.error) renderInfo(); };

  // Search: a library name (or alias), or else a SMILES string.
  $('#search').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#search-input').value.trim();
    if (!text) return;
    const [hit] = searchLibrary(text);
    if (hit) { loadEntry(hit); return; }
    try {
      const counts = smilesCounts(text);
      const entry = KNOWN_MOLECULES.find((m) => m.smiles === text);
      if (entry) loadEntry(entry);
      else setTray(counts, 0, { smiles: text });
      $('#search-msg').textContent = '';
    } catch (err) {
      $('#search-msg').textContent = `Not a known name, and not valid SMILES: ${err.message}`;
    }
  });
  $('#charge').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-step]');
    if (!btn) return;
    charge = Math.max(-3, Math.min(3, charge + +btn.dataset.step));
    update();
  });
  $('#mol-info').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-set-charge]');
    if (!btn) return;
    charge = +btn.dataset.setCharge;
    update();
  });

  $('#mol-view').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    view = btn.dataset.value;
    document.querySelectorAll('#mol-view button').forEach((b) => b.classList.toggle('on', b === btn));
    $('#iso-wrap').hidden = view !== 'density';
    $('#mo-iso-wrap').hidden = view !== 'mo';
    $('#opt-lp-wrap').hidden = view !== 'structure';
    // Angle overlays clutter the orbital and density views; start those without them.
    $('#opt-angles').checked = view === 'structure';
    viewer.setOption('angles', view === 'structure');
    viewer.setView(view);
    if (view === 'mo') showMO();
    if (mol && !mol.error) renderInfo();
  });

  $('#mol-info').addEventListener('click', (e) => {
    const level = e.target.closest('[data-mo]');
    if (!level) return;
    moIndex = +level.dataset.mo;
    showMO();
    renderInfo();
  });
  const moIso = $('#mo-iso');
  const showMoIso = () => { $('#mo-iso-value').textContent = moIsoFromSlider(+moIso.value).toFixed(3); };
  moIso.addEventListener('input', () => { showMoIso(); if (view === 'mo') showMO(); });
  showMoIso();
  document.addEventListener('keydown', (e) => {
    if (view !== 'mo' || $('#mol-panel').hidden || e.target.matches('input, textarea')) return;
    const r = moData();
    if (!r || r.error || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    moIndex = Math.max(0, Math.min(r.mos.length - 1, moIndex + (e.key === 'ArrowUp' ? 1 : -1)));
    showMO();
    renderInfo();
    e.preventDefault();
  });
  for (const name of ['angles', 'lengths', 'lonePairs', 'hbonds']) {
    $(`#opt-${name}`).addEventListener('change', (e) => {
      viewer.setOption(name, e.target.checked);
      renderLegend();
    });
  }
  $('#mol-rotate').addEventListener('change', (e) => viewer.setAutoRotate(e.target.checked));
  $('#mol-fit').addEventListener('click', () => viewer.fit());

  const iso = $('#iso');
  const showIso = () => {
    const v = isoFromSlider(+iso.value);
    $('#iso-value').textContent = `${v < 0.01 ? v.toFixed(4) : v.toFixed(3)} e/bohr³`;
    return v;
  };
  let isoFrame = 0;
  iso.addEventListener('input', () => {
    const v = showIso();
    cancelAnimationFrame(isoFrame);
    isoFrame = requestAnimationFrame(() => viewer.setIso(v));
  });
  viewer.setIso(showIso());

  return {
    addAtom(symbol) {
      const counts = new Map(tray);
      counts.set(symbol, (counts.get(symbol) || 0) + 1);
      setTray(counts, charge);
    },
    /** From a hash like "mol=CO3&q=-2", "mol=C6H12O6&v=1&c=2" or "smiles=CCO". */
    loadHash(hash) {
      const [head, ...params] = hash.split('&');
      const num = (k, lo, hi) => {
        const p = params.find((x) => x.startsWith(`${k}=`));
        return p ? Math.max(lo, Math.min(hi, Math.trunc(+p.slice(k.length + 1)) || 0)) : 0;
      };
      if (head.startsWith('smiles=')) {
        const smiles = decodeURIComponent(head.slice(7));
        try { setTray(smilesCounts(smiles), 0, { smiles, conformer: num('c', 0, 9) }); } catch { setTray(new Map()); }
        return;
      }
      setTray(parseFormula(head.split('=')[1] || ''), num('q', -3, 3), { variant: num('v', 0, 20), conformer: num('c', 0, 9) });
    },
    setActive(on) {
      viewer.setActive(on);
      if (on) update();
    },
    fit() { viewer.fit(); },
  };
}

