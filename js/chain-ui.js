// Chain-reaction mode of the nucleus panel: the controls, the k prediction (from a worker)
// and the live readout while neutrons multiply through the ball.

import { makeSystem, MEV_J, TNT_TON_J } from './chain.js';
import { ChainViewer, NUCLIDE_COLORS, REFLECTOR_COLORS, SPENT_COLOR, fmtTime } from './chain-viewer.js';
import { sci } from './nucleus-data.js';

const $ = (sel) => document.querySelector(sel);
const ENRICH_PRESETS = [['Natural', 0.0072], ['Reactor fuel', 0.04], ['Research reactor', 0.2], ['Weapons grade', 0.937]];
const NUCLIDE_Z = { U235: [92, 235], U238: [92, 238], Pu239: [94, 239] };
const NAME = { U235: 'uranium-235', U238: 'uranium-238', Pu239: 'plutonium-239' };

const big = (x) => (x < 1e4 ? Math.round(x).toLocaleString() : sci(x, 2));
const kg = (m) => (m < 10 ? m.toFixed(2) : m < 1000 ? m.toFixed(1) : Math.round(m).toLocaleString());
const pctText = (e) => `${(100 * e).toFixed(e < 0.1 ? 2 : 1)}%`;

/** Energy with a sense of scale: joules and tons of TNT. */
function energyHTML(MeV) {
  const J = MeV * MEV_J, t = J / TNT_TON_J;
  const tnt = t < 1e-6 ? `${sci(t * 1e6, 2)} g of TNT` : t < 1e-3 ? `${(t * 1e6).toFixed(0)} g of TNT` : t < 1 ? `${(t * 1000).toFixed(1)} kg of TNT` : t < 1000 ? `${t.toFixed(1)} t of TNT` : `${(t / 1000).toFixed(2)} kt of TNT`;
  return `${sci(J, 2)} J <span class="muted">(${tnt})</span>`;
}

/** Neutrons per generation on a log scale, as inline SVG. */
function genChart(gen) {
  const W = 300, H = 120, pad = { l: 34, r: 8, t: 8, b: 20 };
  const pts = gen.map((v, g) => [g, v]).filter(([, v]) => v > 0);
  if (pts.length < 2) return '<p class="muted" style="font-size:12px">The chart fills in as generations go by.</p>';
  const gMax = Math.max(10, pts[pts.length - 1][0]);
  const lv = pts.map(([, v]) => Math.log10(v));
  const lo = Math.floor(Math.min(0, ...lv)), hi = Math.max(lo + 1, Math.ceil(Math.max(...lv)));
  const X = (g) => pad.l + ((W - pad.l - pad.r) * g) / gMax;
  const Y = (l) => H - pad.b - ((H - pad.t - pad.b) * (l - lo)) / (hi - lo);
  const step = Math.max(1, Math.ceil((hi - lo) / 4));
  let grid = '';
  for (let e = lo; e <= hi; e += step) grid += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(e)}" y2="${Y(e)}" opacity="0.4"/><text class="lbl" x="${pad.l - 4}" y="${Y(e) + 3.5}" text-anchor="end">10${String(e).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d])}</text>`;
  const d = pts.map(([g, v], i) => `${i ? 'L' : 'M'}${X(g).toFixed(1)},${Y(Math.log10(v)).toFixed(1)}`).join('');
  return `<svg class="decay-chart chain-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Neutrons per generation">
    ${grid}<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}"/>
    <text class="lbl" x="${W - pad.r}" y="${H - 5}" text-anchor="end">generation ${gMax}</text><text class="lbl" x="${pad.l}" y="${H - 5}">0</text>
    <path class="curve" d="${d}"/></svg>`;
}

export function createChainUI({ addCaption, clearCaptions, onOpenFission }) {
  const viewer = new ChainViewer($('#nuc-chain'));
  const cfg = { fuel: 'U', enrichment: 0.937, R: 8.7, reflector: 'none', T: 10 };
  let count = 1;
  let sys = makeSystem(cfg);
  let pred = null; // { k, Rc } for the current configuration, from the worker
  let stats = null;
  let shown = false;
  let worker = null, jobId = 0, autoSpeed = true;
  viewer.setSystem(sys);

  viewer.onMilestone = (html) => addCaption(html);
  viewer.onStats = (s) => { stats = s; renderLive(); };
  viewer.onEnd = () => renderButtons();
  viewer.onPick = (f) => onOpenFission(...NUCLIDE_Z[f.nuclide], f.E);

  function predict() {
    pred = null;
    const id = ++jobId;
    worker?.terminate();
    worker = new Worker(new URL('./chain-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.id !== id) return;
      pred = { ...pred, ...data };
      if (data.k && autoSpeed) setSpeed(Math.max(0.1, Math.min(1e5, data.k.genTime / 2.5)));
      if (shown) renderStatic();
    };
    worker.postMessage({ id, cfg: { ...cfg } });
  }
  let predictTimer = 0;
  const predictSoon = () => { clearTimeout(predictTimer); predictTimer = setTimeout(predict, 200); };

  function rebuild() {
    sys = makeSystem(cfg);
    viewer.setSystem(sys);
    stats = null;
    clearCaptions();
    predictSoon();
    render();
  }

  function setSpeed(v) {
    viewer.speed = v;
    $('#chain-speed').value = Math.log10(v);
    $('#chain-speed-value').textContent = `${v < 1000 ? `${v < 1 ? v.toFixed(1) : v.toPrecision(2).replace(/\.0$/, '')} ns` : `${(v / 1000).toPrecision(2)} µs`} per second`;
    renderClock();
  }

  // ---------- rendering ----------

  function render() {
    if (!shown) return;
    const u = cfg.fuel === 'U';
    document.querySelectorAll('#chain-fuel button').forEach((b) => b.classList.toggle('on', b.dataset.value === cfg.fuel));
    $('#chain-enrich-wrap').hidden = !u;
    $('#chain-enrich').value = Math.log10(100 * cfg.enrichment);
    $('#chain-enrich-value').textContent = pctText(cfg.enrichment);
    $('#chain-enrich-presets').innerHTML = ENRICH_PRESETS.map(([n, e]) => `<button class="chip${Math.abs(e - cfg.enrichment) < 1e-4 ? ' on' : ''}" data-enrich="${e}">${n}</button>`).join('');
    $('#chain-radius').value = cfg.R;
    $('#chain-radius-value').textContent = `${cfg.R.toFixed(1)} cm · ${kg(sys.mass)} kg`;
    document.querySelectorAll('#chain-ref button').forEach((b) => b.classList.toggle('on', b.dataset.value === cfg.reflector));
    $('#chain-thick-wrap').hidden = cfg.reflector === 'none';
    $('#chain-thick').value = cfg.T;
    $('#chain-thick-value').textContent = `${cfg.T.toFixed(0)} cm${sys.refMat ? ` · ${kg(sys.refMass)} kg` : ''}`;
    document.querySelectorAll('#chain-count button').forEach((b) => b.classList.toggle('on', +b.dataset.value === count));
    renderButtons();

    $('#nuc-title').innerHTML = `<span><strong>Chain reaction</strong><br><span class="muted">${kg(sys.mass)} kg of ${u ? `uranium (${pctText(cfg.enrichment)} ²³⁵U)` : 'plutonium-239'}${sys.refMat ? ` in ${cfg.T.toFixed(0)} cm of ${sys.refMat.name.toLowerCase()}` : ', bare'}</span></span>`;
    const fuelKeys = sys.fuelMat.parts.map((p) => p.key);
    $('#nuc-legend').innerHTML = [
      ...fuelKeys.map((k) => `<span><i style="background:${NUCLIDE_COLORS[k]}"></i>${NAME[k]}</span>`),
      `<span><i style="background:${SPENT_COLOR}"></i>split</span>`,
      sys.refMat ? `<span><i style="background:${REFLECTOR_COLORS[cfg.reflector]}"></i>${sys.refMat.name.toLowerCase()}</span>` : '',
      '<span><i style="background:#f2f8ff"></i>fast neutron</span><span><i style="background:#4073ff"></i>slow neutron</span>',
    ].join('');
    $('#nuc-scale').textContent = `fuel radius ${cfg.R.toFixed(1)} cm`;
    renderClock();
    renderStatic();
  }

  function renderButtons() {
    $('#chain-start').textContent = viewer.running ? '↺ Restart' : '▶ Start chain';
    $('#chain-pause').disabled = !viewer.running;
    $('#chain-pause').textContent = viewer.paused ? '▶ Resume' : '❚❚ Pause';
  }

  function renderClock() {
    if (!shown) return;
    const clock = $('#nuc-clock');
    clock.hidden = false;
    const T = stats?.T ?? 0;
    clock.innerHTML = `t = ${fmtTime(T)} · slowed ${sci(1e9 / viewer.speed, 1)}×${stats?.lagging ? ' · catching up' : ''}`;
  }

  function verdict(k) {
    if (k.k < 0.98) return { cls: 'sub', text: 'Subcritical', line: 'Each generation is smaller than the last, so every chain dies out.' };
    if (k.k <= 1.02) return { cls: 'crit', text: 'About critical', line: 'Each generation about replaces itself: a chain can go on and on, but it doesn’t grow fast. Reactors run here.' };
    return { cls: 'super', text: 'Supercritical', line: 'Each generation outnumbers the last, so a chain grows exponentially, if it survives its first few unlucky steps.' };
  }

  function renderStatic() {
    if (!shown) return;
    const k = pred?.k;
    const u = cfg.fuel === 'U';
    let kHTML = '<p class="muted">Working out k for this ball…</p>';
    if (k) {
      const v = verdict(k);
      const dbl = k.k > 1.005 ? (k.genTime * Math.LN2) / Math.log(k.k) : null;
      kHTML = `<div class="k-card ${v.cls}"><div class="big">k = ${k.k.toFixed(3)}</div><div><b>${v.text}</b><br><span class="muted">${v.line}</span></div></div>
        <ul class="chain-facts">
          <li>Of every 100 neutrons born here, <b>${Math.round(100 * k.fission)}</b> go on to split a nucleus, <b>${Math.round(100 * k.capture)}</b> end up captured and <b>${Math.round(100 * k.escape)}</b> escape.</li>
          <li>Time from a neutron’s birth to the fission it causes (one generation): <b>${fmtTime(k.genTime)}</b>${dbl ? ` · the neutron count doubles every <b>${fmtTime(dbl)}</b>` : ''}</li>
          ${pred.Rc === undefined ? '<li class="muted">Finding the critical size…</li>'
            : pred.Rc === null ? `<li>No size of this ball is ever critical: ${u && cfg.enrichment < 0.05 ? 'too much ²³⁸U soaks up neutrons without splitting' : 'too few of the neutrons go on to cause fissions'}. <span class="muted">(Natural uranium needs a moderator: part 2.)</span></li>`
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
      <p class="explain">Try it: start a chain in a bare ball of weapons-grade uranium a little below and a little above the critical size, then try natural uranium at any size. Near k = 1, a single neutron often dies out by bad luck even when the ball is supercritical; that’s why reactors and weapons use neutron sources. Click a flash to watch that one fission up close in the nucleus view.</p>
      <p class="note">How it’s modeled: Monte Carlo neutron transport, the method used to design real reactors. Each neutron flies a random distance set by the cross sections, then scatters (elastically or inelastically), is captured, splits a nucleus (releasing ν ≈ 2.5–3 neutrons with the measured Watt energy spectrum) or knocks out two neutrons (n,2n). Cross sections are evaluated values averaged over resonances; with them, the benchmark critical experiments Godiva (52 kg of uranium), Jezebel (17 kg of plutonium) and the natural-uranium-reflected Flattop spheres all come out within 2% of k = 1. k and the critical size are worked out separately with 2,000 neutrons per generation. Not modeled: delayed neutrons (0.2–0.65% of neutrons come seconds later, which is what makes reactors controllable), the fuel heating up and expanding, ²⁴⁰Pu and other impurities, and resonance self-shielding, so the water and beryllium results are rougher. Each dot stands for about ${sci(sys.fuelMat.parts.reduce((t, p) => t + p.N, 0) * 1e24 * (4 / 3) * Math.PI * cfg.R ** 3 / 5000, 1)} nuclei, and the dots are spread out so you can see in: in real metal the nuclei are 0.3 nm apart and a neutron passes tens of millions of them between collisions.</p>`;
    renderLive();
  }

  function renderLive() {
    const el = $('#chain-live');
    renderClock();
    if (!el) return;
    if (!stats) { el.innerHTML = '<p class="muted">Press <b>▶ Start chain</b> to send in a neutron.</p>'; $('#chain-chart').innerHTML = ''; return; }
    const s = stats;
    const ends = s.fissions + s.captures + s.escapes;
    el.innerHTML = `<ul class="chain-facts">
      <li>${s.done ? 'Ran for' : 'Time'}: <b>${fmtTime(s.T)}</b> · generation <b>${s.gen.length - 1}</b>${s.done ? ` · <b>${s.reason === 'died' ? 'died out' : s.reason === 'runaway' ? 'stopped (runaway)' : 'stopped'}</b>` : ''}</li>
      <li>Neutrons in flight: <b>${big(s.inFlight)}</b>${s.W > 1 ? ` <span class="muted">(${s.alive.toLocaleString()} drawn, each standing for ${big(s.W)})</span>` : ''}</li>
      <li>Fissions: <b>${big(s.fissions)}</b>${Object.keys(s.fissionBy).length > 1 ? ` <span class="muted">(${Object.entries(s.fissionBy).map(([k, v]) => `${NAME[k]} ${Math.round(100 * v / s.fissions)}%`).join(', ')})</span>` : ''}${s.burn > 1e-6 ? ` · ${(100 * s.burn).toPrecision(2)}% of the fuel` : ''}</li>
      <li>Energy released: <b>${energyHTML(s.energyMeV)}</b></li>
      ${ends ? `<li>Neutron endings so far: ${Math.round(100 * s.fissions / ends)}% fission, ${Math.round(100 * s.captures / ends)}% captured, ${Math.round(100 * s.escapes / ends)}% escaped</li>` : ''}
      ${s.kLive ? `<li>Measured k from finished generations: <b>${s.kLive.toFixed(2)}</b></li>` : ''}
    </ul>`;
    $('#chain-chart').innerHTML = `${genChart(s.gen)}<p class="chart-note">Neutrons born per generation (log scale): a straight line up means exponential growth.</p>`;
  }

  // ---------- controls ----------

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
  $('#chain-count').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    count = +b.dataset.value;
    render();
  });
  $('#chain-start').addEventListener('click', () => {
    clearCaptions();
    viewer.paused = false;
    viewer.start(count);
    renderButtons();
  });
  $('#chain-pause').addEventListener('click', () => { viewer.paused = !viewer.paused; renderButtons(); });
  $('#chain-speed').addEventListener('input', (e) => { autoSpeed = false; setSpeed(10 ** +e.target.value); });
  $('#chain-speed-auto').addEventListener('click', () => {
    autoSpeed = true;
    if (pred?.k) setSpeed(Math.max(0.1, Math.min(1e5, pred.k.genTime / 2.5)));
  });
  $('#chain-cut').addEventListener('change', (e) => viewer.setCutaway(e.target.checked));
  $('#chain-rotate').addEventListener('change', (e) => viewer.setAutoRotate(e.target.checked));
  $('#nuc-info').addEventListener('click', (e) => {
    if (!shown || !e.target.closest('[data-chain-critical]') || !pred?.Rc) return;
    cfg.R = Math.round(pred.Rc * 10) / 10;
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
