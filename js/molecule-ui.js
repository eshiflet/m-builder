import { ELEMENTS } from './elements.js';
import { EXAMPLES } from './molecule-data.js';
import { buildMolecule, parseFormula, hillKey, formulaHTML, chargeText } from './molecule.js';
import { configHTML } from './electron-config.js';
import { MoleculeViewer, atomColor, SIGMA_COLOR, H1S_COLOR, TRANSFER_COLOR } from './molecule-viewer.js';
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
  orbitals: 'Each atom’s hybrid orbitals point along its bonds; where lobes from two atoms overlap head-on they form a σ bond. Orange/blue lobes are p orbitals that overlap side by side (orange with orange) to form π bonds. Lavender lobes are lone pairs.',
  ionicOrbitals: 'Ionic bonding shares no orbitals. The metal hands its valence electrons to the nonmetal (arrows), leaving each ion with a filled, spherical shell like a noble gas. The ions then stick together by electrostatic attraction.',
  ionicDensity: 'Each ion keeps its own nearly spherical cloud, built from the ion’s own electron configuration. Even at low density the clouds barely merge, unlike a covalent molecule such as H₂O, where they fuse into one envelope.',
  density: 'A surface of constant total electron density. Slide toward low density and the atoms’ clouds merge into one envelope around the molecule; slide toward high density and it pinches apart into separate atoms. Colors show which atom contributes most at each point. This adds up isolated-atom clouds, and real bonding pulls a little extra density into the bonds.',
};

export function createMoleculeUI({ onTrayChange }) {
  const viewer = new MoleculeViewer($('#mol-canvas'));
  const tray = new Map();
  let charge = 0;
  let view = 'structure';
  let mol = null;

  $('#examples').innerHTML = EXAMPLES
    .map(({ formula, charge: q }) => `<button class="chip" data-formula="${formula}" data-charge="${q}">${formulaHTML(formula, q)}</button>`)
    .join('');

  function setTray(counts, q = 0) {
    tray.clear();
    for (const [s, n] of counts) if (n > 0) tray.set(s, n);
    charge = q;
    update();
  }

  function update() {
    renderTray();
    onTrayChange?.(tray);
    mol = buildMolecule(tray, charge);
    const key = hillKey(tray);
    $('#charge-value').textContent = charge ? chargeText(charge) : '0';
    document.querySelectorAll('#examples .chip').forEach((c) => {
      c.classList.toggle('on', hillKey(parseFormula(c.dataset.formula)) === key && +c.dataset.charge === charge && tray.size > 0);
    });
    const q = charge ? `&q=${charge}` : '';

    const empty = $('#mol-empty');
    if (!mol) {
      viewer.setMolecule(null);
      empty.innerHTML = '<div>Click elements in the table to add atoms,<br>or pick an example above.</div>';
      $('#mol-title').innerHTML = '';
      $('#mol-info').innerHTML = '<p class="muted">Each click on an element adds one atom. Known molecules use measured bond lengths and angles; other single-center combinations get a VSEPR estimate.</p>';
      history.replaceState(null, '', '#mol');
      return;
    }
    history.replaceState(null, '', `#mol=${mol.error ? key : mol.formula}${q}`);
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
    renderTitle();
    renderInfo();
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
    if (mol.source === 'experimental' && !mol.vsepr) return '';
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
    const { atoms, bonds, angles } = mol;
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
      const sym = b.delocalized ? '⋯' : BOND_SYMBOL[b.order];
      const word = b.delocalized ? `resonance, order ${b.order}` : BOND_WORD[b.order];
      return [`${[x, y].sort()}${b.order}${b.length.toFixed(2)}`, `<li>${x}${sym}${y} <span class="muted">${word} · ${b.length.toFixed(3)} Å</span></li>`];
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

    const badge = mol.source === 'experimental'
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
      ${chargeNote}
      <div class="facts">
        ${angleRows.length ? `<div><h3>Bond angles</h3><ul>${angleRows.join('')}</ul></div>` : ''}
        <div><h3>Bonds</h3><ul>${bondRows.join('')}</ul></div>
        ${ionRows ? `<div><h3>Ions</h3><ul>${ionRows.join('')}</ul></div>` : `<div><h3>Hybridization</h3><ul>${atomRows.join('')}</ul></div>`}
      </div>
      <p class="note">${VIEW_TEXT[mol.ionic && view !== 'structure' ? `ionic${view[0].toUpperCase()}${view.slice(1)}` : view]}</p>`;
    renderLegend();
  }

  // ---------- events ----------

  $('#tray').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    const s = btn.dataset.remove;
    tray.set(s, tray.get(s) - 1);
    if (!tray.get(s)) tray.delete(s);
    update();
  });
  $('#tray-clear').addEventListener('click', () => setTray(new Map()));
  $('#examples').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-formula]');
    if (chip) setTray(parseFormula(chip.dataset.formula), +chip.dataset.charge);
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
    $('#opt-lp-wrap').hidden = view !== 'structure';
    // Angle overlays clutter the orbital and density views; start those without them.
    $('#opt-angles').checked = view === 'structure';
    viewer.setOption('angles', view === 'structure');
    viewer.setView(view);
    if (mol && !mol.error) renderInfo();
  });
  for (const name of ['angles', 'lengths', 'lonePairs']) {
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
      tray.set(symbol, (tray.get(symbol) || 0) + 1);
      update();
    },
    /** From a hash like "CO3&q=-2". */
    loadFormula(str) {
      const [formula, ...params] = str.split('&');
      const q = params.find((p) => p.startsWith('q='));
      setTray(parseFormula(formula), q ? Math.max(-3, Math.min(3, Math.trunc(+q.slice(2)) || 0)) : 0);
    },
    setActive(on) {
      viewer.setActive(on);
      if (on) update();
    },
    fit() { viewer.fit(); },
  };
}

