// Bombarding a nucleus: turns one sampled collision (reactions.js) into an animation plan
// for the viewer (stages, captions, real physical times) and the info panel (odds, energy
// budget, products).

import { ELEMENTS } from './elements.js';
import { isotopeFor, densityRadii, deformation, collectiveModes, classifyNuclide, halfLifeText, sci, allowedNeutrons } from './nucleus-data.js';
import { PROJECTILES, entrance, cascade, firstChance, sampleVirtual, rng, qValue, beta, separation } from './reactions.js';

const C_FM = 2.998e23; // speed of light, fm/s
const HBARC = 197.327;

export const BEAM_PRESETS = {
  n: [['Thermal', 2.53e-8], ['1 eV', 1e-6], ['1 MeV', 1], ['14 MeV (D–T)', 14], ['150 MeV', 150]],
  p: [['1 MeV', 1], ['10 MeV', 10], ['50 MeV', 50], ['150 MeV', 150]],
  e: [['10 MeV', 10], ['100 MeV', 100], ['500 MeV', 500]],
  g: [['2 MeV', 2], ['GDR peak', 'gdr'], ['30 MeV', 30], ['100 MeV', 100]],
  a: [['5 MeV', 5], ['7.7 MeV (Rutherford)', 7.69], ['30 MeV', 30], ['100 MeV', 100]],
};
export const BEAM_DEFAULT = { n: 2.53e-8, p: 10, e: 100, g: 'gdr', a: 7.69 };
/** log₁₀(E/MeV) limits for each projectile's energy slider. */
export const BEAM_RANGE = { n: [-8, 2.3], p: [-1, 2.3], e: [0, 2.7], g: [-1, 2.3], a: [-0.3, 2.3] };

const sup = (n) => String(n).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);
const symbolOf = (Z) => (Z === 0 ? 'n' : ELEMENTS[Z - 1]?.symbol ?? '?');
export const nucText = (Z, A) => (Z === 0 && A === 1 ? 'n' : Z === 1 && A === 1 ? 'p' : `${sup(A)}${symbolOf(Z)}`);
const nucHTML = (Z, A) => `<sup>${A}</sup>${symbolOf(Z)}`;

/** "0.025 eV", "14 keV", "6.5 MeV", "1.2 GeV". */
export function energyText(E) {
  if (E >= 1000) return `${(E / 1000).toPrecision(3)} GeV`;
  if (E >= 1) return `${E < 10 ? E.toFixed(2) : E < 100 ? E.toFixed(1) : E.toFixed(0)} MeV`;
  if (E >= 1e-3) return `${(E * 1e3).toPrecision(3)} keV`;
  return `${(E * 1e6).toPrecision(2)} eV`;
}

function speedText(E, mass) {
  const b = beta(E, mass);
  if (b > 0.9999) return 'the speed of light';
  if (b > 0.01) return `${(b * 100).toFixed(b > 0.1 ? 0 : 1)}% of light speed`;
  const ms = b * 2.998e8;
  return ms > 1e4 ? `${about(ms / 1000)} km/s` : `${about(ms)} m/s`;
}
const about = (x) => { const p = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1); return (Math.round(x / p) * p).toLocaleString(); };
export const pct = (p) => (p >= 0.995 ? `${(100 * p).toFixed(p > 0.9999 ? 0 : 1)}%` : p >= 0.01 ? `${(100 * p).toFixed(p > 0.1 ? 0 : 1)}%`
  : p >= 1e-4 ? `${(100 * p).toPrecision(2)}%` : p > 0 ? `${sci(100 * p, 1)}%` : '0%');
const an = (word) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);
const times = (x) => (x < 1e4 ? about(x) : sci(x, 1));
const secText = (t) => `${sci(t, 1)} s`;

const PARTICLE = {
  n: { name: 'neutron', sym: 'n', color: '#f2f2f2' },
  p: { name: 'proton', sym: 'p', color: '#9cc4ff' },
  a: { name: 'α particle', sym: 'α', color: '#ffb347' },
  'γ': { name: 'γ ray', sym: 'γ', color: '#ffe066' },
  fission: { name: 'fission', sym: 'f', color: '#7ee0a8' },
};
export const CHANNEL_NAMES = { n: 'Emits a neutron', p: 'Emits a proton', a: 'Emits an α particle', 'γ': 'Emits a γ ray (usually: captured)', fission: 'Fissions' };

/** Color of a photon by energy, from soft (orange) to hard (violet-white). */
const gammaColor = (E) => (E < 1 ? '#ffb35c' : E < 3 ? '#ffe066' : E < 8 ? '#b5ff9e' : '#c9b8ff');

const sceneFor = (Z, A) => {
  const iso = isotopeFor(Z, A - Z);
  const shape = deformation(Z, A - Z);
  const modes = collectiveModes(Z, A, shape.beta);
  const periods = {};
  for (const k of ['dipole', 'breathing', 'quadrupole']) if (modes[k]) periods[k] = modes[k].T / 1e-23;
  return { iso, beta: shape.beta, beta3: shape.beta3, radii: densityRadii(Z, A - Z), periods };
};

/**
 * One shot of projectile x at energy E (lab, MeV) on nucleus iso. force: 'miss', or a
 * channel ('n', 'p', 'a', 'γ', 'fission') for the first decay; seed makes it repeatable.
 */
export function bombard(iso, modes, x, E, { force = null, seed = 1 } = {}) {
  const P = PROJECTILES[x];
  const r = rng(seed);
  const gdr = modes?.dipole ?? null;
  const ent = entrance(x, iso.Z, iso.A, E, gdr);
  // force 'hit': it gets in (if it can at all), and the outcome is left to chance.
  // force 'hit' skips misses, unless getting in is so unlikely (<0.1%) that a miss is the honest picture.
  if (force === 'hit' && ent.pIn < 1e-3) force = null;
  let hit = ent.pIn > 0 && (force ? force !== 'miss' : r() < ent.pIn);
  if (force === 'hit') force = null;
  const target = nucText(iso.Z, iso.A);
  const R = 1.2 * Math.cbrt(iso.A);
  const pLabel = `${P.sym} ${energyText(E)}`;
  const projectile = { key: x, color: P.color, sym: P.sym, label: pLabel, radius: x === 'a' ? 0.9 : x === 'e' ? 0.35 : 0.55, charged: P.Z > 0 };
  const stages = [];
  const lam = x === 'g' || x === 'e' ? HBARC / E : HBARC / Math.sqrt(2 * P.mass * E); // reduced wavelength ƛ
  const approachPhys = 34 / (beta(E, P.mass) * C_FM);

  // ---------- approach ----------
  let approach = `${an(P.name.toLowerCase()).replace(/^a/, 'A')} at ${energyText(E)} (${speedText(E, P.mass)}) heads for ${target}.`;
  if (x === 'n') approach += lam > 4 * R
    ? ` It has no charge, so nothing pushes it away. It's so slow that its quantum wavelength (ƛ ≈ ${about(lam)} fm) dwarfs the nucleus (${R.toFixed(0)} fm radius): it effectively hits the whole thing.`
    : ' It has no charge, so nothing pushes it away.';
  else if (P.Z > 0) approach += ` The nucleus's ${iso.Z} protons repel it: the Coulomb barrier is ${ent.barrier.toFixed(1)} MeV${ent.Ecm < ent.barrier ? ', more than it has' : ''}.`;
  else if (x === 'g') approach += ' It feels no strong force; it can only be absorbed by the nucleus’s charges.';
  else approach += ' Electrons feel no strong force, only the protons’ electric charge.';

  let steps = [], electronOut = null, Estar = null;
  const absorbed = hit && P.A > 0 ? { p: P.Z, n: P.A - P.Z } : null;
  let scene = null;
  const compound = ent.compound;

  if (!hit) {
    if (x === 'n') {
      stages.push({ kind: 'approach', to: 'surface', caption: approach, phys: approachPhys });
      stages.push({ kind: 'bounce', caption: `It bounces off (elastic scattering: ${pct(1 - ent.pIn)} of head-on shots at this energy). The nucleus just recoils; nothing inside changes.`, phys: approachPhys });
    } else if (P.Z > 0) {
      const turn = ent.closest;
      const touching = ent.Ecm >= ent.barrier;
      stages.push({ kind: 'approach', to: touching ? 'surface' : 'turn', turnAt: Math.min(R + 22, Math.max(R + 1.5, turn * 0.6)), caption: approach, phys: approachPhys });
      stages.push({ kind: 'turnBack', caption: touching
        ? `It reaches the surface but bounces off (${pct(1 - ent.pIn)} of head-on shots at this energy).`
        : `Electric repulsion stops it ${turn < 1000 ? `${turn.toFixed(0)} fm` : `${sci(turn * 1e-15)} m`} away (the nucleus is only ${R.toFixed(0)} fm in radius) and sends it back: Rutherford scattering. ${ent.pIn > 1e-12 ? `Only ${pct(ent.pIn)} tunnel through the barrier.` : 'At this energy tunneling through is hopeless.'}`,
      phys: approachPhys });
    } else if (x === 'g') {
      stages.push({ kind: 'approach', to: 'through', caption: approach, phys: approachPhys / 2 });
      stages.push({ kind: 'pass', deflect: 0, speed: 55, caption: `It passes straight through. Only ${pct(ent.pIn)} of photons aimed at the nucleus are absorbed at ${energyText(E)} (cross section ${(ent.sigma * 1000).toPrecision(2)} mb); ${E < (gdr?.E ?? 14) - 3 * (gdr?.width ?? 4) ? 'the absorption peak (the giant dipole resonance) is at ' + energyText(gdr?.E ?? 14) : 'the giant dipole resonance peaks at ' + energyText(gdr?.E ?? 14)}.`, phys: approachPhys / 2 });
    } else {
      const deg = (ent.thetaMin * 180) / Math.PI;
      stages.push({ kind: 'approach', to: 'through', caption: approach, phys: approachPhys / 2 });
      stages.push({ kind: 'pass', deflect: Math.min(1.2, ent.thetaMin * 0.6), speed: 40, caption: `It scatters elastically off the nuclear charge (${pct(1 - ent.pIn)} of the time), losing almost no energy. Scattered electrons form a diffraction pattern, with the first minimum near ${deg < 90 ? deg.toFixed(0) : '>90'}° at this energy, which measures the charge radius (≈ ${ent.chargeRadius.toFixed(1)} fm): Hofstadter’s Nobel-winning method.`, phys: approachPhys / 2 });
    }
  } else {
    if (x === 'e') {
      Estar = sampleVirtual(ent.virtual, r);
      electronOut = E - Estar;
    } else Estar = compound.E;
    const cZ = compound.Z, cA = compound.A;
    const cText = `${nucText(cZ, cA)}*`;
    if (P.A > 0) scene = sceneFor(cZ, cA);
    steps = cascade(cZ, cA, Estar, r, force && force !== 'miss' ? force : null);
    const first = firstChance(cZ, cA, Estar);
    const heat = (U) => 1 + 0.12 * Math.sqrt(Math.max(0, U));
    const glow = (U) => (U > 0.05 ? Math.min(0.38, 0.06 + 0.045 * Math.sqrt(U)) : 0);
    const nearGDR = gdr && (x === 'g' || x === 'e') && Math.abs(Estar - gdr.E) < 2 * gdr.width;

    stages.push({ kind: 'approach', to: 'surface', caption: approach, phys: approachPhys });
    let absorbText;
    if (P.A > 0) {
      absorbText = `Absorbed! ${target} + ${P.sym} → ${cText}, a compound nucleus with ${Estar.toFixed(2)} MeV of excitation: ${ent.S.toFixed(2)} MeV released as the ${P.name.toLowerCase()} binds, plus ${energyText(ent.Ecm)} of motion.`;
      if (P.Z > 0 && ent.Ecm < ent.barrier) absorbText += ` It tunneled through the Coulomb barrier (a ${pct(ent.pIn)} chance head-on).`;
    } else if (x === 'g') {
      absorbText = nearGDR
        ? `Absorbed. The photon's electric field shoves the protons one way and the neutrons the other: the giant dipole resonance, sloshing at ${sci(gdr.E / 4.1357e-21, 1)} times a second. ${target} now has ${Estar.toFixed(1)} MeV of excitation.`
        : E > 40 ? `Absorbed by a single proton–neutron pair (the “quasi-deuteron” process), which shares ${Estar.toFixed(0)} MeV with the rest.` : `Absorbed (only a ${pct(ent.pIn)} chance at this energy). ${target} now has ${Estar.toFixed(1)} MeV of excitation.`;
    } else {
      absorbText = `As it flies past, the electron trades a virtual photon with the nucleus (it happens ${pct(ent.pIn)} of the time), handing over ${Estar.toFixed(1)} MeV. The electron leaves with ${energyText(electronOut)}.${nearGDR ? ' The nucleus rings in its giant dipole resonance.' : ''}`;
    }
    stages.push({ kind: 'absorb', caption: absorbText, heat: heat(Estar), glow: glow(Estar), gdr: nearGDR, electronLabel: x === 'e' ? `e⁻ ${energyText(electronOut)}` : null, phys: (2 * R) / (0.25 * C_FM) });

    const odds = Object.entries(first.probs).filter(([, p]) => p > 0.005).sort((a, b) => b[1] - a[1]).map(([k, p]) => `${k === 'fission' ? 'fission' : k === 'γ' ? 'γ ray' : PARTICLE[k].sym} ${pct(p)}`).join(', ');
    const crossings = first.lifetime / ((2 * R) / (0.25 * C_FM));
    const s0 = steps[0];
    const waitWhat = s0?.kind === 'fission' ? 'until it happens to stretch past the fission barrier' : s0?.kind === 'γ' ? 'until it radiates' : 'until, by chance, enough energy gathers on one particle near the surface for it to escape';
    stages.push({ kind: 'wait', caption: `Within ~10⁻²¹ s the energy is shared by all ${cA} nucleons, and the nucleus forgets how it was made (Bohr’s compound nucleus). It lives about ${secText(first.lifetime)}, ${crossings > 10 ? `${times(crossings)} times as long as a nucleon takes to cross it,` : ''} ${waitWhat}. Odds for its first move: ${odds}.`, phys: first.lifetime, duration: 2.6 });

    // ---------- decay steps ----------
    steps.forEach((s, k) => {
      const next = steps[k + 1]?.lifetime ?? 1e-20;
      if (s.kind === 'fission') {
        const f = s.fission;
        const h = nucText(f.heavy.Z, f.heavy.A), l = nucText(f.light.Z, f.light.A);
        const nE = f.neutrons.map((e) => e.toFixed(1)).join(', ');
        stages.push({
          kind: 'fission', split: f.heavy.A / (f.heavy.A + f.light.A), neutrons: f.neutrons.length, labels: [h, l],
          heat: heat(s.from.E), phys: [5e-21, 3e-21, 2e-20, 1e-19],
          captions: [
            `${nucText(s.from.Z, s.from.A)}* (${s.from.E.toFixed(1)} MeV of excitation; fission barrier ${f.Bf.toFixed(1)} MeV) stretches. Surface tension pulls it back; the protons’ repulsion pushes the ends apart.`,
            'Past the saddle point Coulomb wins: a neck forms and thins…',
            `Scission! ${f.neutrons.length ? `${f.neutrons.length} prompt neutron${f.neutrons.length > 1 ? 's' : ''} (${nE} MeV) boil off the hot fragments.` : 'No neutrons this time.'}`,
            `${h} and ${l} fly apart with ${f.tke.toFixed(0)} MeV between them, pushed by their electric repulsion: most of the energy of fission.`,
          ],
        });
        stages.push({ kind: 'fragmentGammas', gammas: Array.from({ length: Math.max(2, Math.min(8, Math.round(f.gammaE / 1))) }, () => 1),
          caption: `Within ~10⁻¹⁴ s the fragments shed another ${f.gammaE.toFixed(1)} MeV as prompt γ rays. Both are neutron-rich, so over the following seconds to years they β-decay several times (that is nuclear waste, and another ~20 MeV, much of it carried off by antineutrinos).`, phys: 1e-14 });
      } else if (s.kind === 'γ') {
        const toE = s.to.E;
        stages.push({ kind: 'gamma', E: s.E, label: `γ ${energyText(s.E)}`, color: gammaColor(s.E), heat: heat(toE), glow: glow(toE),
          caption: `A ${energyText(s.E)} γ ray carries off energy${toE > 0.05 ? `: ${toE.toFixed(2)} MeV left` : ': the nucleus reaches its ground state'}. ${nucText(s.from.Z, s.from.A)}${toE > 0.05 ? '*' : ''}.`, phys: next });
      } else {
        const toE = s.to.E;
        const p = PARTICLE[s.kind];
        stages.push({ kind: 'emit', particle: s.kind, E: s.E, label: `${p.sym} ${energyText(s.E)}`, heat: heat(toE), glow: glow(toE),
          caption: `Out goes ${an(p.name)} with ${energyText(s.E)} (it cost ${separation(s.kind, s.from.Z, s.from.A).toFixed(2)} MeV to pull it free). ${nucText(s.from.Z, s.from.A)}* → ${nucText(s.to.Z, s.to.A)}${toE > 0.05 ? `* with ${toE.toFixed(2)} MeV left` : ' in its ground state'}.`, phys: next });
      }
    });
  }

  // ---------- results ----------
  const out = []; // emitted particles and radiation
  let finals = [];
  if (!hit) {
    out.push({ what: `${P.sym} (scattered)`, E: x === 'n' || P.Z > 0 ? ent.Ecm * 0.995 : E, kind: x });
    finals = [{ Z: iso.Z, A: iso.A }];
  } else {
    if (electronOut != null) out.push({ what: 'e⁻ (scattered)', E: electronOut, kind: 'e' });
    let last = { Z: compound.Z, A: compound.A };
    for (const s of steps) {
      if (s.kind === 'fission') {
        const f = s.fission;
        out.push({ what: nucText(f.heavy.Z, f.heavy.A), E: f.heavy.E, kind: 'frag' }, { what: nucText(f.light.Z, f.light.A), E: f.light.E, kind: 'frag' });
        f.neutrons.forEach((e) => out.push({ what: 'n (prompt)', E: e, kind: 'n' }));
        out.push({ what: 'prompt γ rays', E: f.gammaE, kind: 'γ' });
        finals = [f.heavy, f.light];
        last = null;
      } else {
        out.push({ what: s.kind === 'γ' ? 'γ' : PARTICLE[s.kind].sym, E: s.E, kind: s.kind });
        last = s.to;
      }
    }
    if (last) finals = [{ Z: last.Z, A: last.A }];
  }
  // Q from the masses: what came in versus what's left.
  const emitted = out.filter((o) => ['n', 'p', 'a'].includes(o.kind)).map((o) => ({ x: o.kind }));
  const initial = [{ Z: iso.Z, A: iso.A }, ...(P.A > 0 ? [{ x }] : [])];
  const Q = hit ? qValue(initial, [...finals, ...emitted]) : 0;
  const listed = out.reduce((t, o) => t + o.E, 0);
  const Ein = E;
  const recoil = Ein + Q - listed;

  // Reaction notation, e.g. ²³⁵U(n,f) or ²⁰⁸Pb(n,2n)²⁰⁷Pb.
  let notation;
  if (!hit) notation = `${target}(${P.sym},${P.sym})${target}`;
  else if (steps.some((s) => s.kind === 'fission')) notation = `${target}(${P.sym},f)`;
  else {
    const counts = {};
    for (const o of out) if (['n', 'p', 'a'].includes(o.kind)) counts[o.kind] = (counts[o.kind] ?? 0) + 1;
    const parts = Object.entries(counts).map(([k, c]) => `${c > 1 ? c : ''}${PARTICLE[k].sym}`);
    const ins = x === 'e' ? "e,e′" : P.sym;
    notation = `${target}(${ins}${parts.length ? `,${parts.join('')}` : x === 'e' ? '' : ',γ'})${nucText(finals[0].Z, finals[0].A)}`;
    if (x === 'e') notation = `${target}(e,e′${parts.join('')})${nucText(finals[0].Z, finals[0].A)}`;
  }
  stages.push({ kind: 'end', caption: `${notation}. ${hit ? `Energy released: Q = ${Q >= 0 ? '+' : ''}${Q.toFixed(2)} MeV.` : 'Nothing changed.'}`, phys: null });

  return {
    plan: { projectile, absorbed, stages }, scene, hit, ent, steps, Estar, out, finals, Q, Ein, recoil, notation,
    first: hit || ent.pIn > 0 ? firstChance(compound.Z, compound.A, x === 'e' ? (Estar ?? Math.min(E, gdr?.E ?? 15)) : (Estar ?? compound.E)) : null,
    seed, x, E,
  };
}

/** What becomes of a product nucleus: stable, or how it decays. */
export function fateOf(Z, A) {
  if (A === 1) return Z === 0 ? 'free neutrons β-decay in ~15 minutes, unless absorbed first' : 'stable';
  const c = classifyNuclide(Z, A - Z);
  if (!c) return 'unbound: falls apart at once';
  if (c.mode === 'stable') return 'stable';
  const t = c.halfLife ? `, half-life ${halfLifeText(c.halfLife)}` : '';
  return `radioactive (${c.mode}${t})${c.measured ? '' : ', predicted'}`;
}

export const canShow = (Z, A) => Z >= 1 && allowedNeutrons(Z).includes(A - Z);
export { nucHTML };
