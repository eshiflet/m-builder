import { ELEMENTS } from './elements.js';
import { COVALENT_RADIUS } from './molecule-data.js';
import {
  isotopeFor, bindingEnergy, deformation, collectiveModes, radiusFm, isMagic, sci, densityRadii,
  allowedNeutrons, rotationPeriod, valenceCounts, BABYSECOND, NUCLEONS, QUARKS,
} from './nucleus-data.js';
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

export function createNucleusUI() {
  const viewer = new NucleusViewer($('#nuc-canvas'));
  let z = 6, neutrons = null;
  let iso = null, modes = null, shape = null, radii = null;
  let mode = 'none', preferred = 'auto', view = 'nucleus';
  let spin = 10;
  let stats = null;

  viewer.onScaleChange = (fm) => { $('#nuc-scale').textContent = `view width ≈ ${fm < 10 ? fm.toFixed(1) : fm.toFixed(0)} fm`; };
  viewer.onClock = (t, lagging) => {
    $('#nuc-clock').textContent = `t = ${t < 1000 ? t.toFixed(1) : about(t)} babyseconds (${sci(t * BABYSECOND)} s)${lagging ? ' · nucleon motion slowed to keep up' : ''}`;
  };
  viewer.onStats = (s) => { stats = s; renderStats(); };

  /** Show element z, optionally a specific isotope by mass number. */
  function setElement(zNew, A = null) {
    z = zNew;
    neutrons = A && allowedNeutrons(z).includes(A - z) ? A - z : null;
    load();
  }

  function load() {
    iso = isotopeFor(z, neutrons);
    shape = deformation(iso.Z, iso.N);
    modes = collectiveModes(iso.Z, iso.A, shape.beta);
    // Halo nuclei: the wells describe the compact core; halo nucleons get their own wide well.
    radii = iso.halo ? densityRadii(iso.Z - (iso.halo.kind === 'p' ? iso.halo.halo : 0), iso.halo.core) : densityRadii(iso.Z, iso.N);
    viewer.setNucleus(iso, shape.beta, radii, periods(), modes.rotation?.E ?? null);
    stats = null;
    if (preferred === 'auto') setMode(suggestedMode().mode);
    else if (preferred === 'none' || modes[preferred]) setMode(preferred);
    else setMode('none');
    autoRate();
    history.replaceState(null, '', `#nuc=${iso.symbol}${iso.isDefault ? '' : `-${iso.A}`}`);
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
    for (const id of ['nuc-mode-wrap', 'nuc-quarks-wrap', 'nuc-mesons-wrap', 'nuc-motion-wrap', 'nuc-iso-wrap', 'nuc-rate-wrap', 'nuc-extra-wrap']) $(`#${id}`).hidden = view !== 'nucleus';
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

    if (view !== 'nucleus') return renderNucleon();

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
      ? `<p class="explain">${autoLine}${MODE_TEXT[mode]} For ${isoLabel(iso)}: ${mode === 'rotation' ? `E(2⁺) = <b>${energyText(m.E)}</b>; at spin ${spin}ħ one turn takes` : `<b>${energyText(m.E)}</b>, one cycle every`} <b>${bsText(T)}</b> (${sci(T)} s). Amplitudes are exaggerated so you can see them.</p>`
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
      ${modeLine}
      ${flowText}
      ${haloText}
      <p class="explain">The nucleons move on their own: confined to a few femtometers, they travel at about a fifth to a third of the speed of light, crossing this nucleus in roughly ${Math.max(1, Math.round((2 * R) / (0.25 * 3))).toLocaleString()} babyseconds (1 babysecond = 10⁻²³ s, the time light takes to cross 3 fm). The ruler’s photon moves at light speed for comparison.</p>
      <p class="explain"><b>Nucleons overlap.</b> They’re drawn at 1.08 fm, the size of a uniform ball with the proton’s measured charge radius (0.84 fm). Neighbors sit only ~1.8 fm apart, so their fuzzy edges overlap; they have no hard surface. The strong force between them is carried by pions, with a range of about 1.4 fm (ħ/m<sub>π</sub>c), so each nucleon really only feels the few it touches.</p>
      ${viewer.showMesons ? `<p class="explain"><b>Mesons: how the strong force works between nucleons.</b> Nucleons attract by tossing pions back and forth (Hideki Yukawa’s 1935 idea). A pion is a quark–antiquark pair: π⁺ = u d̄, π⁻ = d ū, π⁰ = a mix of u ū and d d̄. Its mass (140 MeV/c²) sets the force’s reach: a borrowed pion can only exist for about ħ/m<sub>π</sub>c² ≈ 4.7×10⁻²⁴ s (half a babysecond), long enough to travel ħ/m<sub>π</sub>c ≈ 1.4 fm, so only touching neighbors trade them. Watch the charged ones: when a proton throws a π⁺ it becomes a neutron, and the neutron that catches it becomes a proton (p → n + π⁺, then π⁺ + n → p). So protons and neutrons are constantly swapping identities, and the total charge never changes. Heavier mesons do other jobs, e.g. the ω meson makes the short-range repulsion that keeps nucleons from merging. Exchanges here are slowed down a lot so you can follow them.</p>
      <p class="explain muted" id="nuc-pion-count"></p>` : ''}
      <p class="explain"><b>Short-range correlated pairs.</b> About 20% of the time, two nucleons get much closer than their size, deep into each other, before the strong repulsive core below ~0.5 fm pushes them apart. Electron-scattering experiments (Jefferson Lab, with MIT’s nuclear physics group) find these pairs are ~90% proton–neutron, because of the tensor part of the nuclear force, and they’re linked to quarks behaving differently inside nuclei (the EMC effect). Turn on <b>Close pairs</b> to highlight nucleons closer than 1 fm. This simulation has no tensor force, so its pairs come out roughly as often for any combination; the live share it reports shows that difference from the real ~90%.</p>
      <div class="facts">
        <div><h3>Shape</h3><ul>
          <li>${iso.A < 5 ? 'Too few nucleons for a meaningful shape' : kind}${axisRatio}</li>
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
    view = b.dataset.value;
    document.querySelectorAll('#nuc-view button').forEach((x) => x.classList.toggle('on', x === b));
    viewer.setView(view === 'nucleus' ? 'nucleus' : 'nucleon', view);
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
  $('#nuc-fit').addEventListener('click', () => viewer.fit());

  return {
    setElement,
    setActive(on) { viewer.setActive(on); },
    fit() { viewer.fit(); },
  };
}
