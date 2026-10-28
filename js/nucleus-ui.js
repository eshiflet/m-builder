import { ELEMENTS } from './elements.js';
import { COVALENT_RADIUS } from './molecule-data.js';
import {
  isotopeFor, bindingEnergy, deformation, collectiveModes, radiusFm, isMagic, sci,
  NUCLEONS, QUARKS,
} from './nucleus-data.js';
import { NucleusViewer, PROTON_COLOR, NEUTRON_COLOR, COLOR_CHARGES } from './nucleus-viewer.js';

const $ = (sel) => document.querySelector(sel);
const DISPLAY_PERIOD = 1.8;

const MODE_TEXT = {
  dipole: 'Giant dipole resonance: all the protons slosh back and forth against all the neutrons, like two fluids passing through each other. It’s what happens when a nucleus absorbs a high-energy gamma ray.',
  breathing: 'Breathing (giant monopole) mode: the whole nucleus swells and shrinks. How much energy this takes measures how hard nuclear matter is to compress.',
  quadrupole: 'Quadrupole mode: the surface stretches into an egg shape along one axis and then flattens, like a vibrating liquid drop.',
  rotation: 'Rotation: a deformed (egg-shaped) nucleus can spin as a whole. Round nuclei can’t rotate in a way that changes anything, so this only appears for deformed ones.',
  none: 'No collective oscillation: just the individual nucleons jostling.',
};

/** A rough atomic radius in fm: the covalent radius where known, else 1.5 Å. */
const atomRadiusFm = (z) => (COVALENT_RADIUS[ELEMENTS[z - 1].symbol] ?? 1.5) * 1e5;

/** Round to two significant figures for "about" numbers. */
const about = (x) => {
  const p = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1);
  return (Math.round(x / p) * p).toLocaleString();
};

const isoLabel = (iso) => `<sup>${iso.A}</sup>${iso.symbol}`;

export function createNucleusUI() {
  const viewer = new NucleusViewer($('#nuc-canvas'));
  let iso = null, modes = null, shape = null;
  let mode = 'dipole';
  let preferred = 'dipole'; // what the user picked; used again once a nucleus supports it
  let view = 'nucleus';

  viewer.onScaleChange = (fm) => { $('#nuc-scale').textContent = `view width ≈ ${fm < 10 ? fm.toFixed(1) : fm.toFixed(0)} fm (10⁻¹⁵ m)`; };

  function setElement(z) {
    iso = isotopeFor(z);
    shape = deformation(iso.Z, iso.N);
    modes = collectiveModes(iso.Z, iso.A, shape.beta);
    viewer.setNucleus(iso, shape.beta);
    // Use the chosen mode if this nucleus has it; otherwise fall back.
    if (preferred === 'none' || modes[preferred]) setMode(preferred);
    else setMode(modes.dipole ? 'dipole' : modes.rotation ? 'rotation' : 'none');
    render();
  }

  function setMode(m) {
    mode = m;
    viewer.setMode(m);
    document.querySelectorAll('#nuc-mode button').forEach((b) => b.classList.toggle('on', b.dataset.value === m));
  }

  function render() {
    // Mode buttons only for modes this nucleus has.
    document.querySelectorAll('#nuc-mode button').forEach((b) => {
      const m = b.dataset.value;
      b.disabled = m !== 'none' && !modes[m];
      b.title = m === 'none' ? '' : modes[m] ? `${modes[m].E < 1 ? `${(modes[m].E * 1000).toFixed(0)} keV` : `${modes[m].E.toFixed(1)} MeV`} · period ${sci(modes[m].T)} s`
        : m === 'rotation' ? 'Only deformed nuclei rotate' : 'Needs at least 4 nucleons';
    });
    $('#nuc-mode-wrap').hidden = view !== 'nucleus';
    $('#nuc-quarks-wrap').hidden = view !== 'nucleus';
    $('#nuc-motion-wrap').hidden = view !== 'nucleus';
    $('#nuc-legend').innerHTML = view === 'nucleus'
      ? `<span><i style="background:${PROTON_COLOR}"></i>proton</span><span><i style="background:${NEUTRON_COLOR}"></i>neutron</span>${
        viewer.showQuarks ? COLOR_CHARGES.map((c, k) => `<span><i style="background:${c}"></i>${['red', 'green', 'blue'][k]} quark</span>`).join('') : ''}`
      : `${COLOR_CHARGES.map((c, k) => `<span><i style="background:${c}"></i>${['red', 'green', 'blue'][k]}</span>`).join('')}<span><i style="background:#ffe9a8"></i>gluon</span><span><i style="background:#9ef0ff"></i>sea quark pair</span>`;

    if (view !== 'nucleus') return renderNucleon();

    const el = ELEMENTS[iso.Z - 1];
    const R = radiusFm(iso.A);
    const ratio = atomRadiusFm(iso.Z) / R;
    const B = bindingEnergy(iso.Z, iso.A);
    const roundness = iso.A === 1 ? 'A single proton'
      : shape.beta < 0.02 ? 'Spherical'
      : shape.beta < 0.1 ? `Nearly spherical (β₂ ≈ ${shape.beta.toFixed(2)})`
        : `Prolate (egg-shaped), β₂ ≈ ${shape.beta.toFixed(2)}`;
    const magic = [isMagic(iso.Z) && `${iso.Z} protons`, isMagic(iso.N) && `${iso.N} neutrons`].filter(Boolean);
    const magicText = iso.A === 1 ? 'Hydrogen’s nucleus is just one proton, with no neutrons.'
      : magic.length
      ? `${magic.join(' and ')} ${magic.length > 1 ? 'are both magic numbers (doubly magic)' : 'is a magic number'}: a closed nuclear shell, which makes the nucleus round and extra stable.`
      : `${shape.np} protons and ${shape.nn} neutrons away from the nearest closed shells (magic numbers 2, 8, 20, 28, 50, 82, 126). Nuclei midway between shells tend to deform.`;

    const m = modes[mode];
    const slow = m ? m.T / DISPLAY_PERIOD : null;
    const modeLine = m
      ? `<p class="explain">${MODE_TEXT[mode]} For ${isoLabel(iso)}: <b>${m.E < 1 ? `${(m.E * 1000).toFixed(0)} keV` : `${m.E.toFixed(1)} MeV`}</b>, one cycle every <b>${sci(m.T)} s</b> (${sci(1 / m.T)} times per second). The animation is slowed down about ${sci(1 / slow, 1)} times, and the motion is exaggerated so you can see it.</p>`
      : `<p class="explain">${MODE_TEXT.none}</p>`;

    const modeRows = Object.entries({ dipole: 'Dipole (p vs n)', breathing: 'Breathing', quadrupole: 'Quadrupole', rotation: 'Rotation (2⁺)' })
      .map(([k, label]) => `<li>${label}: ${modes[k] ? `${modes[k].E < 1 ? `${(modes[k].E * 1000).toFixed(0)} keV` : `${modes[k].E.toFixed(1)} MeV`} <span class="muted">· ${sci(modes[k].T)} s</span>` : `<span class="muted">${k === 'rotation' ? 'not deformed' : '—'}</span>`}</li>`).join('');

    $('#nuc-title').innerHTML = `<span><strong>${el.name}-${iso.A}</strong> <span class="muted">${isoLabel(iso)}</span><br><span class="muted">${iso.Z} p · ${iso.N} n</span></span>`;
    $('#nuc-info').innerHTML = `
      <div class="info-head">
        <div>
          <h2>${el.name}-${iso.A} <span class="muted">· ${isoLabel(iso)}</span></h2>
          <div class="muted">${iso.Z} proton${iso.Z > 1 ? 's' : ''} · ${iso.N} neutron${iso.N === 1 ? '' : 's'} · ${iso.stability}</div>
        </div>
      </div>
      ${modeLine}
      <p class="explain">The electrons are left behind: the atom’s electron cloud is roughly <b>${about(ratio)} times wider</b> than this nucleus. If the nucleus were a 1 cm marble, the atom would be about ${about(ratio / 100)} m across, with almost all of its mass in the marble.</p>
      <div class="facts">
        <div><h3>Size &amp; shape</h3><ul>
          <li>Radius ≈ ${R.toFixed(2)} fm <span class="muted">(1.2·A<sup>⅓</sup>)</span></li>
          <li>${roundness}</li>
          <li class="muted">${magicText}</li>
        </ul></div>
        <div><h3>Binding energy</h3><ul>
          <li>${B.B.toFixed(0)} MeV total · <b>${B.perNucleon.toFixed(2)} MeV</b> per nucleon</li>
          <li class="muted">volume +${B.volume.toFixed(0)}, surface −${B.surface.toFixed(0)}, Coulomb −${B.coulomb.toFixed(0)}, asymmetry −${B.asymmetry.toFixed(0)}, pairing ${B.pairing >= 0 ? '+' : '−'}${Math.abs(B.pairing).toFixed(1)} MeV</li>
          ${iso.A < 12 ? '<li class="muted">The mass formula is rough for very light nuclei.</li>' : ''}
        </ul></div>
        <div><h3>Oscillations</h3><ul>${modeRows}</ul></div>
      </div>
      <p class="note">Nucleons don’t sit still: confined to a few femtometers, they move at roughly a quarter of the speed of light (the Fermi motion), shown here as jostling. Protons are colored red and neutrons gray-blue; inside, each is three quarks bound by gluons (turn on <b>Quarks</b>, or look inside a proton). Energies use standard systematics: semi-empirical mass formula, Berman–Fultz dipole energies, and E(2⁺) from the Grodzins relation; the shape is estimated from valence nucleon numbers.</p>`;
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

  $('#nuc-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    preferred = b.dataset.value;
    setMode(preferred);
    render();
  });
  $('#nuc-view').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    view = b.dataset.value;
    document.querySelectorAll('#nuc-view button').forEach((x) => x.classList.toggle('on', x === b));
    viewer.setView(view === 'nucleus' ? 'nucleus' : 'nucleon', view);
    render();
  });
  $('#nuc-motion').addEventListener('change', (e) => viewer.setMotion(e.target.checked));
  $('#nuc-quarks').addEventListener('change', (e) => { viewer.setQuarks(e.target.checked); render(); });
  $('#nuc-rotate').addEventListener('change', (e) => viewer.setAutoRotate(e.target.checked));
  $('#nuc-speed').addEventListener('input', (e) => viewer.setSpeed(+e.target.value));
  $('#nuc-fit').addEventListener('click', () => viewer.fit());

  return {
    setElement,
    setActive(on) { viewer.setActive(on); },
    fit() { viewer.fit(); },
  };
}
