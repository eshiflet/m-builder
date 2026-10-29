// Chain-reaction mode of the nucleus panel: the controls, the k prediction (from a worker),
// the live readout while neutrons multiply, and for a reactor core the seconds-long
// "run the reactor" mode, where delayed neutrons and the control rods take over.

import { makeSystem, MEV_J, TNT_TON_J, FISSION_MEV, PointKinetics } from './chain.js';
import { ChainViewer, NUCLIDE_COLORS, REFLECTOR_COLORS, MODERATOR_COLORS, SPENT_COLOR, PRECURSOR_COLOR, ROD_COLOR, uraniumColor, fmtTime } from './chain-viewer.js';
import { sci } from './nucleus-data.js';

const $ = (sel) => document.querySelector(sel);
const ENRICH_PRESETS = [['Natural', 0.0072], ['Reactor fuel', 0.04], ['Research reactor', 0.2], ['Weapons grade', 0.937]];
const NUCLIDE_Z = { U235: [92, 235], U238: [92, 238], Pu239: [94, 239] };
const NAME = { U235: 'uranium-235', U238: 'uranium-238', Pu239: 'plutonium-239' };
const MOD_NAME = { graphite: 'graphite', water: 'water', heavy: 'heavy water' };
const REACTOR_PRESETS = {
  cp1: { label: 'CP-1, Chicago 1942', cfg: { enrichment: 0.0072, moderator: 'graphite', lumps: true, a: 3.0, pitch: 21, R: 420 } },
  water: { label: 'Water-cooled (4% fuel)', cfg: { enrichment: 0.04, moderator: 'water', lumps: true, a: 0.59, pitch: 1.5, R: 26 } },
  heavy: { label: 'Heavy water, natural uranium', cfg: { enrichment: 0.0072, moderator: 'heavy', lumps: true, a: 3.8, pitch: 20, R: 130 } },
};
const ROD_SPEED = 0.02; // fraction of full travel per second, as real rod drives move
const SCRAM_SPEED = 1.0; // a SCRAM drops the rods in about a second
const NU = 2.45; // neutrons per fission, for turning the neutron population into power

const big = (x) => (x < 1e4 ? Math.round(x).toLocaleString() : sci(x, 2));
const kg = (m) => (m < 10 ? m.toFixed(2) : m < 1000 ? m.toFixed(1) : Math.round(m).toLocaleString());
const tons = (m) => (m < 1000 ? `${kg(m)} kg` : `${(m / 1000).toFixed(m < 1e4 ? 1 : 0)} t`);
const pctText = (e) => `${(100 * e).toFixed(e < 0.1 ? 2 : 1)}%`;
const supExp = (e) => String(e).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);

/** Energy with a sense of scale: joules and tons of TNT. */
function energyHTML(MeV) {
  const J = MeV * MEV_J, t = J / TNT_TON_J;
  const tnt = t < 1e-6 ? `${sci(t * 1e6, 2)} g of TNT` : t < 1e-3 ? `${(t * 1e6).toFixed(0)} g of TNT` : t < 1 ? `${(t * 1000).toFixed(1)} kg of TNT` : t < 1000 ? `${t.toFixed(1)} t of TNT` : `${(t / 1000).toFixed(2)} kt of TNT`;
  return `${sci(J, 2)} J <span class="muted">(${tnt})</span>`;
}

function powerText(W) {
  if (W < 1e-3) return `${sci(W, 2)} W`;
  if (W < 1) return `${(W * 1000).toPrecision(3)} mW`;
  if (W < 1e3) return `${W.toPrecision(3)} W`;
  if (W < 1e6) return `${(W / 1e3).toPrecision(3)} kW`;
  if (W < 1e9) return `${(W / 1e6).toPrecision(3)} MW`;
  return `${(W / 1e9).toPrecision(3)} GW`;
}

/** A log-scale line chart as inline SVG: pts [[x, y]], x labeled by xLabel(x). */
function logChart(pts, { xMax, xLabel, label, cls = '' }) {
  const W = 300, H = 120, pad = { l: 34, r: 8, t: 8, b: 20 };
  pts = pts.filter(([, v]) => v > 0);
  if (pts.length < 2) return '';
  const lv = pts.map(([, v]) => Math.log10(v));
  const lo = Math.floor(Math.min(...lv)), hi = Math.max(lo + 1, Math.ceil(Math.max(...lv)));
  const X = (g) => pad.l + ((W - pad.l - pad.r) * g) / xMax;
  const Y = (l) => H - pad.b - ((H - pad.t - pad.b) * (l - lo)) / (hi - lo);
  const step = Math.max(1, Math.ceil((hi - lo) / 4));
  let grid = '';
  for (let e = lo; e <= hi; e += step) grid += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(e)}" y2="${Y(e)}" opacity="0.4"/><text class="lbl" x="${pad.l - 4}" y="${Y(e) + 3.5}" text-anchor="end">10${supExp(e)}</text>`;
  const d = pts.map(([g, v], i) => `${i ? 'L' : 'M'}${X(g).toFixed(1)},${Y(Math.log10(v)).toFixed(1)}`).join('');
  return `<svg class="decay-chart chain-chart ${cls}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}">
    ${grid}<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}"/>
    <text class="lbl" x="${W - pad.r}" y="${H - 5}" text-anchor="end">${xLabel(xMax)}</text><text class="lbl" x="${pad.l}" y="${H - 5}">0</text>
    <path class="curve" d="${d}"/></svg>`;
}

/**
 * k as a smooth function of rod insertion s, fitted to the worker's samples with the classic
 * integral rod-worth shape k(s) = k₀ − W·(s − sin 2πs / 2π): rods do little at the very top
 * and bottom of their travel and most in the middle.
 */
function rodFit(curve) {
  const f = (s) => s - Math.sin(2 * Math.PI * s) / (2 * Math.PI);
  if (!curve?.length) return null;
  if (curve.length === 1) return () => curve[0][1];
  let sf = 0, sff = 0, sk = 0, skf = 0;
  for (const [s, k] of curve) { sf += f(s); sff += f(s) ** 2; sk += k; skf += k * f(s); }
  const n = curve.length, det = n * sff - sf * sf;
  const W = Math.max(0, -(n * skf - sf * sk) / det), k0 = (sk + W * sf) / n;
  return (s) => k0 - W * f(s);
}

export function createChainUI({ addCaption, clearCaptions, onOpenFission }) {
  const viewer = new ChainViewer($('#nuc-chain'));
  let mode = 'ball';
  const cfgs = {
    ball: { kind: 'ball', fuel: 'U', enrichment: 0.937, R: 8.7, reflector: 'none', T: 10 },
    reactor: { kind: 'reactor', ...REACTOR_PRESETS.cp1.cfg },
  };
  let cfg = cfgs.ball;
  let rods = { now: 1, target: 1, scram: false };
  let count = 1;
  let sys = makeSystem(cfg);
  let pred = null; // worker results for the current configuration
  let stats = null;
  let shown = false;
  let worker = null, jobId = 0, autoSpeed = true;
  let kin = null; // the reactor running on point kinetics
  let kSpeed = 1;
  viewer.setSystem(sys);

  viewer.onMilestone = (html) => addCaption(html);
  viewer.onStats = (s) => { stats = s; renderLive(); };
  viewer.onEnd = () => renderButtons();
  viewer.onPick = (f) => onOpenFission(...NUCLIDE_Z[f.nuclide], f.E);
  viewer.onFrame = (dt) => tickKinetics(dt);

  const reactor = () => mode === 'reactor';

  function predict() {
    pred = null;
    const id = ++jobId;
    worker?.terminate();
    worker = new Worker(new URL('./chain-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.id !== id) return;
      pred = { ...pred, ...data };
      if (data.k) {
        if (autoSpeed) autoSetSpeed();
        viewer.setSites(data.k.sites);
      }
      if (shown) { renderStatic(); renderButtons(); }
    };
    worker.postMessage({ id, cfg: { ...cfg } });
  }
  let predictTimer = 0;
  const predictSoon = () => { clearTimeout(predictTimer); predictTimer = setTimeout(predict, 250); };

  function rebuild() {
    stopKinetics();
    sys = makeSystem(cfg);
    viewer.setSystem(sys);
    viewer.setRods(rods.now);
    stats = null;
    clearCaptions();
    predictSoon();
    render();
  }

  function autoSetSpeed() { if (pred?.k?.genTime) setSpeed(Math.max(0.1, Math.min(1e7, pred.k.genTime / 2.5))); }

  function setSpeed(v) {
    viewer.speed = v;
    $('#chain-speed').value = Math.log10(v);
    $('#chain-speed-value').textContent = `${fmtTime(v).replace(/\.0+ /, ' ')} per second`;
    renderClock();
  }

  /** k at the current rod position (reactor), from the fitted rod curve. */
  function kNow() {
    if (!reactor()) return pred?.k?.k ?? null;
    const fit = rodFit(pred?.rodCurve);
    return fit ? fit(rods.now) : null;
  }

  // ---------- running the reactor (point kinetics) ----------

  function startKinetics() {
    if (!pred?.k || !pred.rodCurve) return;
    viewer.stop();
    stats = null;
    kin = {
      pk: new PointKinetics({ beta: pred.k.beta, Lambda: pred.k.genTime * 1e-9, nuclide: pred.k.dominant }),
      history: [], period: Infinity, tripped: false, frames: 0, notes: new Set(),
    };
    const k = kNow();
    kin.pk.equilibrate((k - 1) / k);
    kin.P0 = kin.pk.fissionRate(NU) * FISSION_MEV * MEV_J;
    clearCaptions();
    addCaption(`The reactor starts with the rods ${Math.round(100 * rods.now)}% in and a neutron source of 10⁵ neutrons per second. Drag <b>Control rods</b> to pull them out slowly; they move at ${Math.round(100 * ROD_SPEED)}% of their travel per second.`);
    renderButtons();
    renderStatic();
  }

  function stopKinetics() {
    kin = null;
    viewer.glowRate = 0;
    renderButtons();
  }

  function scram(why) {
    rods.target = 1;
    rods.scram = true;
    $('#chain-rods').value = 100;
    if (kin && !kin.tripped) {
      kin.tripped = true;
      addCaption(`<b>SCRAM</b>${why ? ` (${why})` : ''}: every rod drops in. The power falls fast at first (the prompt neutrons die out within milliseconds) and then slowly, over a minute or more, as the last delayed neutrons trickle out.`);
    }
    renderRods();
  }

  function moveRods(dt) {
    if (rods.now === rods.target) { rods.scram = false; return false; }
    const v = (rods.scram ? SCRAM_SPEED : ROD_SPEED) * dt;
    rods.now = rods.target > rods.now ? Math.min(rods.target, rods.now + v) : Math.max(rods.target, rods.now - v);
    viewer.setRods(rods.now);
    return true;
  }

  function tickKinetics(dt) {
    if (!shown || !reactor()) return;
    const simDt = kin && !viewer.paused ? dt * kSpeed : dt;
    const moved = moveRods(kin ? simDt : 10 * dt); // without a run, rods just glide to the slider
    if (!kin) { if (moved) renderRods(); return; }
    if (viewer.paused) return;
    const k = kNow();
    const rho = (k - 1) / k;
    const pk = kin.pk;
    pk.step(simDt, rho);
    const P = pk.fissionRate(NU) * FISSION_MEV * MEV_J;
    kin.history.push([pk.t, P, rods.now]);
    if (kin.history.length > 3000) kin.history = kin.history.filter((_, i) => i % 2 === 0);
    // Period from the last few seconds of power.
    const back = kin.history.find(([t]) => t >= pk.t - Math.max(1, 0.05 * pk.t)) ?? kin.history[0];
    kin.period = pk.t > back[0] && back[1] > 0 ? (pk.t - back[0]) / Math.log(P / back[1]) : Infinity;
    kin.P = P; kin.rho = rho; kin.k = k;
    viewer.glowRate = Math.min(60, Math.max(0, 6 * (Math.log10(P) + 3)));
    // Notable moments, and the safety system.
    const note = (key, html) => { if (!kin.notes.has(key)) { kin.notes.add(key); addCaption(html); } };
    if (rho > 0.0005 && rho < pk.beta) note('delayed', `<b>Supercritical on delayed neutrons</b> (k = ${k.toFixed(4)}, ρ = ${(rho / pk.beta).toFixed(2)} dollars). The prompt neutrons alone can’t keep it going, so the power rises only as fast as the precursors decay: a period of ${Math.abs(kin.period) < 1e4 ? `${kin.period.toFixed(0)} s` : 'many seconds'}.`);
    if (rho >= pk.beta) note('prompt', `<b>Prompt critical</b> (ρ = ${(rho / pk.beta).toFixed(2)} dollars): prompt neutrons alone now multiply, and the power climbs every ${fmtTime(pred.k.genTime * Math.LN2 / Math.max(1e-6, rho - pk.beta) * (1 - rho))} rather than every few seconds. No mechanical system can react that fast.`);
    if (P > 0.5) note('half', `The power passes 0.5 W, about what CP-1 made when it first went critical on 2 December 1942.`);
    if ($('#chain-trip').checked && !kin.tripped) {
      if (kin.period > 0 && kin.period < 10 && P > 100 * kin.P0) scram('period shorter than 10 s');
      else if (P > 1e7) scram('power above 10 MW');
    }
    if (P > 1e12) { addCaption('Stopped: past a terawatt. Nothing here models the fuel heating up, which in a real reactor would push k down (or destroy the core).'); stopKinetics(); }
    if (++kin.frames % 6 === 0 || moved) { renderKinetics(); renderRods(); }
  }

  // ---------- rendering ----------

  function render() {
    if (!shown) return;
    const r = reactor();
    document.querySelectorAll('#chain-system button').forEach((b) => b.classList.toggle('on', b.dataset.value === mode));
    $('#chain-ball-controls').hidden = $('#chain-ball-controls-2').hidden = r;
    $('#chain-reactor-controls').hidden = $('#chain-reactor-controls-2').hidden = !r;
    const u = cfg.fuel === 'U';
    document.querySelectorAll('#chain-fuel button').forEach((b) => b.classList.toggle('on', b.dataset.value === cfg.fuel));
    $('#chain-enrich-wrap').hidden = !u;
    $('#chain-enrich').value = Math.log10(100 * cfg.enrichment);
    $('#chain-enrich-value').textContent = pctText(cfg.enrichment);
    $('#chain-enrich-presets').innerHTML = ENRICH_PRESETS.map(([n, e]) => `<button class="chip${Math.abs(e - cfg.enrichment) < 1e-4 ? ' on' : ''}" data-enrich="${e}">${n}</button>`).join('');
    if (r) {
      $('#chain-presets').innerHTML = Object.entries(REACTOR_PRESETS).map(([key, p]) => {
        const on = Object.entries(p.cfg).every(([k, v]) => cfg[k] === v);
        return `<button class="chip${on ? ' on' : ''}" data-preset="${key}">${p.label}</button>`;
      }).join('');
      document.querySelectorAll('#chain-mod button').forEach((b) => b.classList.toggle('on', b.dataset.value === cfg.moderator));
      document.querySelectorAll('#chain-layout button').forEach((b) => b.classList.toggle('on', (b.dataset.value === 'lumps') === cfg.lumps));
      $('#chain-lump').value = Math.log10(cfg.a);
      $('#chain-lump-value').textContent = `${sys.a.toFixed(sys.a < 1 ? 2 : 1)} cm`;
      $('#chain-pitch').value = Math.log10(cfg.pitch);
      $('#chain-pitch-value').textContent = `${cfg.pitch.toFixed(cfg.pitch < 3 ? 2 : 1)} cm apart · ${(100 * sys.v).toFixed(sys.v < 0.1 ? 1 : 0)}% fuel by volume`;
      $('#chain-core').value = Math.log10(cfg.R);
      $('#chain-core-value').textContent = `${cfg.R.toFixed(cfg.R < 20 ? 1 : 0)} cm · ${tons(sys.mass)} of uranium${cfg.lumps ? ` in ${sys.lumpCount.toLocaleString()} lumps` : ''}`;
      renderRods();
    } else {
      $('#chain-radius').value = cfg.R;
      $('#chain-radius-value').textContent = `${cfg.R.toFixed(1)} cm · ${kg(sys.mass)} kg`;
      document.querySelectorAll('#chain-ref button').forEach((b) => b.classList.toggle('on', b.dataset.value === cfg.reflector));
      $('#chain-thick-wrap').hidden = cfg.reflector === 'none';
      $('#chain-thick').value = cfg.T;
      $('#chain-thick-value').textContent = `${cfg.T.toFixed(0)} cm${sys.refMat ? ` · ${kg(sys.refMass)} kg` : ''}`;
    }
    document.querySelectorAll('#chain-count button').forEach((b) => b.classList.toggle('on', +b.dataset.value === count));
    document.querySelectorAll('#chain-kspeed button').forEach((b) => b.classList.toggle('on', +b.dataset.value === kSpeed));
    renderButtons();

    $('#nuc-title').innerHTML = r
      ? `<span><strong>Reactor core</strong><br><span class="muted">${tons(sys.mass)} of uranium (${pctText(cfg.enrichment)} ²³⁵U) ${cfg.lumps ? 'in lumps' : 'mixed'} in ${MOD_NAME[cfg.moderator]}</span></span>`
      : `<span><strong>Chain reaction</strong><br><span class="muted">${kg(sys.mass)} kg of ${u ? `uranium (${pctText(cfg.enrichment)} ²³⁵U)` : 'plutonium-239'}${sys.refMat ? ` in ${cfg.T.toFixed(0)} cm of ${sys.refMat.name.toLowerCase()}` : ', bare'}</span></span>`;
    const fuelKeys = sys.fuelMat.parts.map((p) => p.key);
    $('#nuc-legend').innerHTML = [
      ...(r ? [`<span><i style="background:#${uraniumColor(cfg.enrichment).getHexString()}"></i>uranium</span>`, `<span><i style="background:${MODERATOR_COLORS[cfg.moderator]}"></i>${MOD_NAME[cfg.moderator]}</span>`, `<span><i style="background:${ROD_COLOR};outline:1px solid #888"></i>control rod</span>`]
        : [...fuelKeys.map((k) => `<span><i style="background:${NUCLIDE_COLORS[k]}"></i>${NAME[k]}</span>`), `<span><i style="background:${SPENT_COLOR}"></i>split</span>`,
          sys.refMat ? `<span><i style="background:${REFLECTOR_COLORS[cfg.reflector]}"></i>${sys.refMat.name.toLowerCase()}</span>` : '']),
      '<span><i style="background:#f2f8ff"></i>fast neutron</span><span><i style="background:#4073ff"></i>slow neutron</span>',
      `<span><i style="background:${PRECURSOR_COLOR}"></i>delayed-neutron precursor</span>`,
    ].join('');
    $('#nuc-scale').textContent = r ? `core radius ${cfg.R < 100 ? `${cfg.R.toFixed(0)} cm` : `${(cfg.R / 100).toFixed(2)} m`}` : `fuel radius ${cfg.R.toFixed(1)} cm`;
    renderClock();
    renderStatic();
  }

  function renderRods() {
    if (!reactor()) return;
    $('#chain-rods-value').textContent = `${(100 * rods.now).toFixed(1)}% in${rods.now !== rods.target ? ` → ${(100 * rods.target).toFixed(1)}%` : ''}`;
    const k = kNow(), el = $('#chain-know');
    if (el && k != null) el.innerHTML = kCardHTML(k);
  }

  function renderButtons() {
    $('#chain-start').textContent = viewer.running ? '↺ Restart' : '▶ Start chain';
    $('#chain-pause').disabled = !viewer.running && !kin;
    $('#chain-pause').textContent = viewer.paused ? '▶ Resume' : '❚❚ Pause';
    $('#chain-run').textContent = kin ? '■ Stop the reactor' : '▶ Run the reactor';
    $('#chain-run').disabled = !kin && !(pred?.k && pred?.rodCurve?.length === 3);
  }

  function renderClock() {
    if (!shown) return;
    const clock = $('#nuc-clock');
    clock.hidden = false;
    if (kin) { clock.innerHTML = `t = ${kin.pk.t.toFixed(1)} s · ${kSpeed === 1 ? 'real time' : `${kSpeed}× real time`}`; return; }
    const T = stats?.T ?? 0;
    clock.innerHTML = `t = ${fmtTime(T)} · slowed ${sci(1e9 / viewer.speed, 1)}×${stats?.lagging ? ' · catching up' : ''}`;
  }

  /** How a multiplication factor behaves, given the delayed fraction β and the statistical error sd. */
  function verdict(k, beta = 0.0065, sd = 0) {
    const tol = Math.max(0.002, 2 * sd), rho = (k - 1) / k;
    if (k < 1 - tol) return { cls: 'sub', text: 'Subcritical', line: 'Each generation is smaller than the last, so every chain dies out.' };
    if (k <= 1 + tol) return { cls: 'crit', text: 'About critical', line: `Each generation about replaces itself: a chain can go on and on${sd ? ` (k is known to ±${sd.toFixed(3)} here)` : ''}. Reactors run here.` };
    if (rho < beta) return { cls: 'delayed', text: 'Supercritical on delayed neutrons', line: `It grows, but only because of the delayed neutrons (${(100 * beta).toFixed(2)}% of all), so slowly, over seconds: controllable.` };
    return { cls: 'super', text: 'Prompt critical', line: 'The prompt neutrons alone multiply, so a chain grows every few generation times: far too fast for anything to stop it.' };
  }

  function kCardHTML(k) {
    const beta = pred?.k?.beta || 0.0065, sd = pred?.k?.sd ?? 0;
    const v = verdict(k, beta, sd), rho = (k - 1) / k;
    return `<div class="k-card ${v.cls}"><div class="big">k = ${k.toFixed(3)}</div><div><b>${v.text}</b><br><span class="muted">${v.line}</span>${reactor() ? `<br><span class="muted">Reactivity ρ = ${rho >= 0 ? '+' : '−'}${Math.abs(rho / beta).toFixed(2)} dollars (1 dollar = β = ${(100 * beta).toFixed(2)}%)</span>` : ''}</div></div>`;
  }

  function renderStatic() {
    if (!shown) return;
    return reactor() ? renderReactor() : renderBall();
  }

  function renderBall() {
    const k = pred?.k;
    const u = cfg.fuel === 'U';
    let kHTML = '<p class="muted">Working out k for this ball…</p>';
    if (k) {
      const dbl = k.k > 1.005 ? (k.genTime * Math.LN2) / Math.log(k.k) : null;
      kHTML = `${kCardHTML(k.k)}
        <ul class="chain-facts">
          <li>Of every 100 neutrons born here, <b>${Math.round(100 * k.fission)}</b> go on to split a nucleus, <b>${Math.round(100 * k.capture)}</b> end up captured and <b>${Math.round(100 * k.escape)}</b> escape.</li>
          <li>Time from a neutron’s birth to the fission it causes (one generation): <b>${fmtTime(k.genTime)}</b>${dbl ? ` · the neutron count doubles every <b>${fmtTime(dbl)}</b>` : ''}</li>
          ${pred.Rc === undefined ? '<li class="muted">Finding the critical size…</li>'
            : pred.Rc === null ? `<li>No size of this ball is ever critical: ${u && cfg.enrichment < 0.05 ? 'too much ²³⁸U soaks up neutrons without splitting. Natural uranium needs a moderator: try <b>Reactor core</b>.' : 'too few of the neutrons go on to cause fissions.'}</li>`
              : `<li>Critical size for this fuel${sys.refMat ? ' and reflector' : ''}: radius <b>${pred.Rc.toFixed(1)} cm</b>, <b>${kg(makeSystem({ ...cfg, R: pred.Rc }).mass)} kg</b> <button class="chip" data-chain-critical>Make it critical</button></li>`}
        </ul>`;
    }
    $('#nuc-info').innerHTML = `<div class="info-head"><div><h2>Chain reaction</h2>
      <div class="muted">Each fission frees 2–3 neutrons. If on average more than one of them goes on to split another nucleus, the count multiplies.</div></div></div>
      <div class="beam-grid">
        <div><h3>Prediction for this ball</h3>${kHTML}</div>
        <div><h3>This chain</h3><div id="chain-live"></div><div id="chain-chart"></div></div>
      </div>
      <p class="explain"><b>k</b>, the multiplication factor, is the average number of new fissions each fission leads to. Neutrons are lost two ways: they <b>escape</b> through the surface, or they’re <b>captured</b> by a nucleus that doesn’t split (mostly ²³⁸U). A bigger ball loses fewer through its surface, because its volume grows faster than its area: that’s why there’s a <b>critical mass</b>. A <b>reflector</b> bounces escaping neutrons back in, so less fuel is needed: natural uranium works by heavy-nucleus scattering (and adds a few fissions of its own), beryllium also knocks loose extra neutrons, and water slows them down so they come back late but very likely to cause fission.</p>
      <p class="explain">A fraction of a percent of fission neutrons are <b>delayed</b>: they come seconds later, from fission fragments that β-decay. A bare metal ball above critical doesn’t need them: its prompt neutrons alone multiply in nanoseconds (“prompt critical”), which is what a bomb is. Near k = 1, a single neutron often dies out by bad luck even when the ball is supercritical; that’s why reactors and weapons use neutron sources. Click a flash to watch that one fission up close in the nucleus view.</p>
      <p class="note">How it’s modeled: Monte Carlo neutron transport, the method used to design real reactors. Each neutron flies a random distance set by the cross sections, then scatters (elastically or inelastically), is captured, splits a nucleus (releasing ν ≈ 2.5–3 neutrons with the measured Watt energy spectrum, a measured fraction of them delayed) or knocks out two neutrons (n,2n). Cross sections are evaluated values averaged over resonances; with them, the benchmark critical experiments Godiva (52 kg of uranium), Jezebel (17 kg of plutonium) and the natural-uranium-reflected Flattop spheres all come out within 2% of k = 1. k and the critical size are worked out separately with 2,000 neutrons per generation. Not modeled: the fuel heating up and expanding, ²⁴⁰Pu and other impurities, so the water and beryllium results are rougher. Each dot stands for about ${sci(sys.fuelMat.parts.reduce((t, p) => t + p.N, 0) * 1e24 * (4 / 3) * Math.PI * cfg.R ** 3 / 5000, 1)} nuclei, and the dots are spread out so you can see in: in real metal the nuclei are 0.3 nm apart and a neutron passes tens of millions of them between collisions.</p>`;
    renderLive();
  }

  function renderReactor() {
    const L = pred?.lattice, k = pred?.k;
    const f = L?.fourFactor;
    const latticeHTML = !L ? '<p class="muted">Working out the lattice (an infinitely large core of it)…</p>' : `
      <div class="k-card ${L.kInf > 1 ? 'crit' : 'sub'}"><div class="big">k∞ = ${L.kInf.toFixed(3)}</div><div>${L.kInf > 1 ? 'Big enough, this lattice could go critical.' : '<b>Never critical</b>, however big: too many neutrons are lost inside it.'}</div></div>
      ${f ? `<p class="four">k∞ = η × f × p × ε = ${f.eta.toFixed(3)} × ${f.f.toFixed(3)} × ${f.p.toFixed(3)} × ${f.eps.toFixed(3)}</p>
      <ul class="chain-facts">
        <li><b>η = ${f.eta.toFixed(2)}</b>: neutrons made for each thermal neutron the fuel absorbs (set by the enrichment: ²³⁸U absorbs without splitting).</li>
        <li><b>f = ${f.f.toFixed(2)}</b>: share of thermal neutrons absorbed by the fuel rather than the ${MOD_NAME[cfg.moderator]} (thermal utilization).</li>
        <li><b>p = ${f.p.toFixed(2)}</b>: share that slow down without being caught in ²³⁸U’s resonances on the way (resonance escape).${cfg.lumps ? ' Lumping helps: neutrons at a resonance energy are caught at a lump’s surface, so its inside is shielded.' : ' Mixed evenly, every ²³⁸U nucleus is exposed. Try <b>Lumps</b>.'}</li>
        <li><b>ε = ${f.eps.toFixed(2)}</b>: extra from fissions by neutrons that haven’t slowed down yet (fast fission).</li>
        <li>Migration length M = ${Math.sqrt(L.M2).toFixed(1)} cm: how far a neutron typically wanders from birth to absorption.</li>
      </ul>` : ''}`;
    const kn = kNow();
    let coreHTML = '<p class="muted">Working out k for this core…</p>';
    if (k && kn != null) {
      const worth = pred.rodCurve?.length === 3 ? pred.rodCurve[0][1] - pred.rodCurve[2][1] : null;
      coreHTML = `<div id="chain-know">${kCardHTML(kn)}</div>
        <ul class="chain-facts">
          <li>With the rods out, of every 100 neutrons born: <b>${Math.round(100 * k.fission)}</b> cause a fission, <b>${Math.round(100 * k.capture)}</b> are captured, <b>${Math.round(100 * k.escape)}</b> escape.</li>
          <li>Prompt generation time: <b>${fmtTime(k.genTime)}</b> · delayed neutrons β = <b>${(100 * k.beta).toFixed(2)}%</b>, the last of them about a minute after their fission.</li>
          ${worth != null ? `<li>The rods are worth <b>${(100 * worth).toFixed(1)}%</b> in k from fully out to fully in (${(worth / k.beta).toFixed(0)} dollars).</li>` : '<li class="muted">Working out what the rods are worth…</li>'}
          ${pred.Rc === undefined ? '<li class="muted">Finding the critical size…</li>'
            : pred.Rc === null ? '<li>No size of this core is ever critical.</li>'
              : `<li>Critical size with the rods out: radius <b>${pred.Rc < 100 ? `${pred.Rc.toFixed(1)} cm` : `${(pred.Rc / 100).toFixed(2)} m`}</b>, ${tons(makeSystem({ ...cfg, R: pred.Rc }).mass)} of uranium <button class="chip" data-chain-critical>Make it a bit bigger than critical</button></li>`}
        </ul>`;
    }
    $('#nuc-info').innerHTML = `<div class="info-head"><div><h2>Reactor core</h2>
      <div class="muted">A moderator slows the fission neutrons down, because slow neutrons are hundreds of times more likely to split ²³⁵U. That lets even natural uranium sustain a chain.</div></div></div>
      <div class="beam-grid">
        <div><h3>The lattice</h3>${latticeHTML}</div>
        <div><h3>This core</h3>${coreHTML}</div>
      </div>
      <div class="beam-grid">
        <div><h3>Running the reactor (seconds)</h3><div id="chain-kin"></div><div id="chain-kin-chart"></div></div>
        <div><h3>Watching the neutrons (microseconds)</h3><div id="chain-live"></div><div id="chain-chart"></div></div>
      </div>
      <p class="explain"><b>Delayed neutrons</b> make reactors controllable. Thermal-reactor neutrons live about a millisecond, so if every neutron were prompt, k = 1.001 would multiply the power by e every second. But about 0.65% of ²³⁵U’s neutrons come seconds later from decaying fission fragments. As long as k − 1 is smaller than that fraction (less than “one dollar” of reactivity), the chain can only grow as fast as those fragments decay, and the power changes over tens of seconds. <b>Control rods</b> of boron carbide soak up neutrons; pulling them out a little makes the core just supercritical, and pushing them in shuts it down. Try it: press <b>Run the reactor</b> with the rods in, then pull them out slowly until the power starts to climb.</p>
      <p class="note">How it’s modeled: the same Monte Carlo transport as the metal ball, now through a cubic lattice of uranium-metal lumps (or the same amounts mixed evenly) in graphite, light water or heavy water, with nine boron-carbide rods. ²³⁸U’s first ~200 resonances are drawn individually and Doppler-broadened to room temperature (their dilute resonance integral comes out at 277 b; measured 275 b); neutrons that slow to thermal energies take on the moderator’s room-temperature Maxwell spread. For the CP-1 lattice (natural-uranium lumps 6 cm across, 21 cm apart in graphite) k∞ comes out at 1.054, as Fermi estimated. Running the reactor uses the point-kinetics equations with six groups of delayed neutrons, fed with k (fitted through the rod positions), β and the prompt generation time from the transport runs. Not modeled: temperature feedback (real reactors push k down as they heat up), fuel cladding and coolant channels, xenon poisoning, and burn-up; graphite’s capture includes typical impurities. The critical size uses one-group diffusion theory, corrected once with a full-core run.</p>`;
    renderLive();
    renderKinetics();
  }

  function renderKinetics() {
    const el = $('#chain-kin');
    renderClock();
    if (!el) return;
    if (!kin) {
      el.innerHTML = `<p class="muted">${pred?.rodCurve?.length === 3 ? 'Press <b>▶ Run the reactor</b> to follow the whole core over seconds to minutes, with the delayed neutrons and the control rods.' : 'Waiting for the rod calculation…'}</p>`;
      $('#chain-kin-chart').innerHTML = '';
      return;
    }
    const p = kin.period;
    el.innerHTML = `<ul class="chain-facts">
      <li>Power: <b>${powerText(kin.P ?? 0)}</b> <span class="muted">(${sci((kin.P ?? 0) / (FISSION_MEV * MEV_J), 2)} fissions per second)</span></li>
      <li>Period: <b>${!isFinite(p) || Math.abs(p) > 3600 ? 'steady' : `${p > 0 ? 'rising' : 'falling'}, ×e every ${Math.abs(p) < 1 ? `${(Math.abs(p) * 1000).toFixed(0)} ms` : `${Math.abs(p).toFixed(0)} s`}`}</b></li>
      <li>k = <b>${(kin.k ?? 0).toFixed(4)}</b> · rods ${(100 * rods.now).toFixed(1)}% in${kin.tripped ? ' · <b>SCRAMed</b>' : ''}</li>
      <li class="muted">Delayed-neutron precursors waiting: ${sci(kin.pk.C.reduce((a, b) => a + b, 0) + 1e-30, 2)}</li>
    </ul>`;
    const h = kin.history, tMax = Math.max(10, h[h.length - 1][0]);
    $('#chain-kin-chart').innerHTML = `${logChart(h.map(([t, P]) => [t, P]), { xMax: tMax, xLabel: (x) => `${x.toFixed(0)} s`, label: 'Reactor power over time', cls: 'kin' })}<p class="chart-note">Power in watts (log scale) against time.</p>`;
  }

  function renderLive() {
    const el = $('#chain-live');
    renderClock();
    if (!el) return;
    if (!stats) { el.innerHTML = `<p class="muted">Press <b>▶ Start chain</b> to ${reactor() ? 'release neutrons from a source in the core and follow every one' : 'send in a neutron'}.</p>`; $('#chain-chart').innerHTML = ''; return; }
    const s = stats;
    const ends = s.fissions + s.captures + s.escapes;
    el.innerHTML = `<ul class="chain-facts">
      <li>${s.done ? 'Ran for' : 'Time'}: <b>${fmtTime(s.T)}</b> · generation <b>${s.gen.length - 1}</b>${s.done ? ` · <b>${s.reason === 'died' ? 'died out' : s.reason === 'runaway' ? 'stopped (runaway)' : 'stopped'}</b>` : ''}</li>
      <li>Neutrons in flight: <b>${big(s.inFlight)}</b>${s.W > 1 ? ` <span class="muted">(${s.alive.toLocaleString()} drawn, each standing for ${big(s.W)})</span>` : ''}</li>
      <li>Fissions: <b>${big(s.fissions)}</b>${Object.keys(s.fissionBy).length > 1 ? ` <span class="muted">(${Object.entries(s.fissionBy).map(([k, v]) => `${NAME[k]} ${Math.round(100 * v / s.fissions)}%`).join(', ')})</span>` : ''}${s.burn > 1e-6 ? ` · ${(100 * s.burn).toPrecision(2)}% of the fuel` : ''}</li>
      <li>Energy released: <b>${energyHTML(s.energyMeV)}</b></li>
      ${ends ? `<li>Neutron endings so far: ${Math.round(100 * s.fissions / ends)}% fission, ${Math.round(100 * s.captures / ends)}% captured, ${Math.round(100 * s.escapes / ends)}% escaped</li>` : ''}
      ${s.kLive ? `<li>Measured prompt k (without delayed neutrons): <b>${s.kLive.toFixed(2)}</b></li>` : ''}
      ${s.waiting ? `<li>Delayed neutrons still to come: <b>${big(s.waiting)}</b>${s.delayedOut ? ` · ${big(s.delayedOut)} so far` : ''}</li>` : ''}
    </ul>`;
    const pts = s.gen.map((v, g) => [g, v]);
    $('#chain-chart').innerHTML = pts.filter(([, v]) => v > 0).length < 2 ? '<p class="muted" style="font-size:12px">The chart fills in as generations go by.</p>'
      : `${logChart(pts, { xMax: Math.max(10, s.gen.length - 1), xLabel: (x) => `generation ${x}`, label: 'Neutrons per generation' })}<p class="chart-note">Prompt neutrons born per generation (log scale): a straight line up means exponential growth.</p>`;
  }

  // ---------- controls ----------

  $('#chain-system').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.value === mode) return;
    mode = b.dataset.value;
    cfg = cfgs[mode];
    autoSpeed = true;
    rebuild();
  });
  $('#chain-fuel').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    cfg.fuel = b.dataset.value;
    rebuild();
  });
  $('#chain-enrich').addEventListener('input', (e) => { cfg.enrichment = Math.min(1, 10 ** +e.target.value / 100); rebuild(); });
  $('#chain-enrich-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-enrich]');
    if (b) { cfg.enrichment = +b.dataset.enrich; rebuild(); }
  });
  $('#chain-radius').addEventListener('input', (e) => { cfg.R = +e.target.value; rebuild(); });
  $('#chain-ref').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    cfg.reflector = b.dataset.value;
    rebuild();
  });
  $('#chain-thick').addEventListener('input', (e) => { cfg.T = +e.target.value; rebuild(); });
  $('#chain-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    Object.assign(cfg, REACTOR_PRESETS[b.dataset.preset].cfg);
    rods = { now: 1, target: 1, scram: false };
    $('#chain-rods').value = 100;
    autoSpeed = true;
    rebuild();
  });
  $('#chain-mod').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    cfg.moderator = b.dataset.value;
    rebuild();
  });
  $('#chain-layout').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    cfg.lumps = b.dataset.value === 'lumps';
    rebuild();
  });
  $('#chain-lump').addEventListener('input', (e) => { cfg.a = 10 ** +e.target.value; rebuild(); });
  $('#chain-pitch').addEventListener('input', (e) => { cfg.pitch = 10 ** +e.target.value; rebuild(); });
  $('#chain-core').addEventListener('input', (e) => { cfg.R = 10 ** +e.target.value; rebuild(); });
  $('#chain-rods').addEventListener('input', (e) => {
    rods.target = +e.target.value / 100;
    rods.scram = false;
    if (kin) kin.tripped = false; // re-armed
    renderRods();
  });
  $('#chain-scram').addEventListener('click', () => scram(kin ? 'by hand' : null));
  $('#chain-run').addEventListener('click', () => (kin ? stopKinetics() : startKinetics()));
  $('#chain-kspeed').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    kSpeed = +b.dataset.value;
    render();
  });
  $('#chain-count').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    count = +b.dataset.value;
    render();
  });
  $('#chain-start').addEventListener('click', () => {
    stopKinetics();
    clearCaptions();
    viewer.paused = false;
    viewer.start(count);
    renderButtons();
  });
  $('#chain-pause').addEventListener('click', () => { viewer.paused = !viewer.paused; renderButtons(); });
  $('#chain-speed').addEventListener('input', (e) => { autoSpeed = false; setSpeed(10 ** +e.target.value); });
  $('#chain-speed-auto').addEventListener('click', () => { autoSpeed = true; autoSetSpeed(); });
  $('#chain-cut').addEventListener('change', (e) => viewer.setCutaway(e.target.checked));
  $('#chain-rotate').addEventListener('change', (e) => viewer.setAutoRotate(e.target.checked));
  $('#nuc-info').addEventListener('click', (e) => {
    if (!shown || !e.target.closest('[data-chain-critical]') || !pred?.Rc) return;
    // A reactor gets a little margin over critical, for the rods to hold down.
    cfg.R = reactor() ? Math.round(pred.Rc * 1.06 * 10) / 10 : Math.round(pred.Rc * 10) / 10;
    rebuild();
  });

  setSpeed(1);

  return {
    /** Show or hide the chain view (its canvas, controls and readout). */
    show(on, active) {
      shown = on;
      $('#nuc-chain').hidden = !on;
      $('#nuc-chain-controls').hidden = !on;
      viewer.setActive(on && active);
      if (on && !pred && !worker) predict();
    },
    setActive(on) { viewer.setActive(on && shown); },
    render,
    fit() { viewer.fit(); },
  };
}
