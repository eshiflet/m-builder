// Chain-reaction mode of the nucleus panel: the controls, the k prediction (from workers),
// the live readout while neutrons multiply, and for a reactor core the seconds-long
// "run the reactor" mode, where delayed neutrons and the control rods take over.

import { makeSystem, MEV_J, TNT_TON_J, FISSION_MEV, PointKinetics, AP1000, SEQUOYAH } from './chain.js';
import { ChainViewer, NUCLIDE_COLORS, REFLECTOR_COLORS, MODERATOR_COLORS, SPENT_COLOR, PRECURSOR_COLOR, ROD_COLOR, uraniumColor, pwrFuelColor, fmtTime } from './chain-viewer.js';
import { sci } from './nucleus-data.js';
import { Plant } from './plant.js';
import { createControlPanel } from './control-panel.js';

const $ = (sel) => document.querySelector(sel);
const ENRICH_PRESETS = [['Natural', 0.0072], ['Reactor fuel', 0.04], ['Research reactor', 0.2], ['Weapons grade', 0.937]];
const NUCLIDE_Z = { U235: [92, 235], U238: [92, 238], Pu239: [94, 239] };
const NAME = { U235: 'uranium-235', U238: 'uranium-238', Pu239: 'plutonium-239' };
const MOD_NAME = { graphite: 'graphite', water: 'water', heavy: 'heavy water' };
const REACTOR_PRESETS = {
  cp1: { label: 'CP-1, Chicago 1942', cfg: { design: null, enrichment: 0.0072, moderator: 'graphite', lumps: true, a: 3.0, pitch: 21, R: 420 } },
  water: { label: 'Water-cooled (4% fuel)', cfg: { design: null, enrichment: 0.04, moderator: 'water', lumps: true, a: 0.59, pitch: 1.5, R: 26 } },
  heavy: { label: 'Heavy water, natural uranium', cfg: { design: null, enrichment: 0.0072, moderator: 'heavy', lumps: true, a: 3.8, pitch: 20, R: 130 } },
  ap1000: { label: 'AP1000 (Westinghouse PWR)', cfg: { design: 'ap1000', boron: AP1000.criticalBoronHot, hot: true, absorbers: true, banks: null } },
  sequoyah: { label: 'TVA Sequoyah (Westinghouse PWR)', cfg: { design: 'sequoyah', boron: SEQUOYAH.criticalBoronHot, hot: true, absorbers: true, banks: null } },
};
const PWR_SPECS = { ap1000: AP1000, sequoyah: SEQUOYAH };
const ROD_SPEED = 0.02; // fraction of full travel per second, as real rod drives move
const SCRAM_SPEED = 1.0; // a SCRAM drops the rods in about a second
const NU = 2.45; // neutrons per fission, for turning the neutron population into power
const PWR_SOURCE = 2e9; // neutrons/s from a PWR's start-up sources (antimony–beryllium): a few counts a second

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

/**
 * Critical radius of a reactor core with the rods out: one-group diffusion, k = k∞ / (1 + M²(π/R)²),
 * with M² taken from this core's own k at radius R (so it also knows about the rod channels and
 * the curved edge, and agrees with the k shown for this core). Null if it never goes critical.
 */
function coreCriticalRadius(kInf, k, R) {
  if (kInf <= 1) return null;
  const M2 = Math.max(1, ((kInf / k - 1) * R * R) / (Math.PI * Math.PI));
  const Rc = (Math.PI * Math.sqrt(M2)) / Math.sqrt(kInf - 1);
  return Rc < 2000 ? Rc : null;
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
  let workers = [], jobId = 0, autoSpeed = true;
  let kin = null; // the reactor running on point kinetics
  let kSpeed = 1;
  let plant = null; // the rest of a PWR plant, for the control panel
  let panelSync = true; // the panel's knobs need setting from the plant
  viewer.setSystem(sys);

  viewer.onMilestone = (html) => addCaption(html);
  viewer.onStats = (s) => { stats = s; renderLive(); };
  viewer.onEnd = () => renderButtons();
  viewer.onPick = (f) => onOpenFission(...NUCLIDE_Z[f.nuclide], f.E);
  viewer.onFrame = (dt) => tickKinetics(dt);

  const reactor = () => mode === 'reactor';
  const pwr = () => reactor() && !!PWR_SPECS[cfg.design];
  const spec = () => PWR_SPECS[cfg.design];

  /**
   * Start the worker tasks for this setup, all at once (each in its own worker). For a reactor
   * the rods move freely afterwards, so k is worked out at three rod positions; rods out also
   * gives the escape fractions, timings and fission sites.
   */
  function predict() {
    pred = null;
    const id = ++jobId;
    for (const w of workers) w.terminate();
    const c = { ...cfg };
    const tasks = reactor()
      ? [['lattice', c], ['core', { ...c, rods: 0 }], ['core', { ...c, rods: 0.5 }], ['core', { ...c, rods: 1 }]]
      : [['ball-k', c], ['ball-Rc', c]];
    const rodK = new Map(), rodSd = new Map();
    workers = tasks.map(([task, tc]) => {
      const w = new Worker(new URL('./chain-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = ({ data }) => {
        w.terminate();
        if (data.id !== id) return;
        const { task: t, rods: r, ...res } = data;
        delete res.id;
        if (t === 'core') {
          rodK.set(r, res.k.k);
          rodSd.set(r, res.k.sd / res.k.k);
          if (rodSd.has(0) && rodSd.has(1)) res.worthSd = Math.hypot(rodSd.get(0), rodSd.get(1)); // of ln(k_out / k_in)
          if (r !== 0) delete res.k; // only rods out gives the core's numbers
          if (rodK.has(0)) res.rodCurve = [...rodK].sort((x, y) => x[0] - y[0]);
        }
        pred = { ...pred, ...res };
        if (PWR_SPECS[c.design]) {
          // Critical boron, to first order: each ppm removes (the share of neutrons boron absorbs) ÷ ppm of ln k.
          if (pred.k && pred.critBoron === undefined) {
            pred.critBoron = pred.k.boron > 0 ? c.boron + Math.log(pred.k.k) / (pred.k.boron / c.boron) : null;
            pred.critBoronSd = pred.k.boron > 0 ? pred.k.sd / pred.k.k / (pred.k.boron / c.boron) : 0;
          }
        } else if (reactor() && pred.lattice && pred.k && pred.Rc === undefined) pred.Rc = coreCriticalRadius(pred.lattice.kInf, pred.k.k, c.R);
        if (res.k) {
          if (autoSpeed) autoSetSpeed();
          viewer.setSites(res.k.sites);
        }
        if (shown) { renderStatic(); renderButtons(); }
      };
      w.postMessage({ id, task, cfg: tc });
      return w;
    });
  }
  let predictTimer = 0;
  const predictSoon = () => { clearTimeout(predictTimer); predictTimer = setTimeout(predict, 250); };

  function rebuild() {
    stopKinetics();
    pred = null; // until the new numbers come in
    sys = makeSystem(cfg);
    viewer.setSystem(sys);
    viewer.setRods(rods.now);
    plant = pwr() ? newPlant() : null;
    panelSync = true;
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

  /** k with the plant's own reactivity too (boron changes and temperatures), while a PWR runs. */
  function kTotal() {
    const k = kNow();
    return k != null && kin && plant ? k * Math.exp(plant.reactivity()) : k;
  }

  /** The plant around a PWR core, at hot standby (or cold), with the boron worth from the core run. */
  function newPlant() {
    const share = pred?.k?.boron;
    const boronWorth = share > 0 && cfg.boron > 0 ? -share / cfg.boron : -9e-5;
    return new Plant(cfg.design, { H: spec().H, boron: cfg.boron, hot: cfg.hot, boronWorth });
  }

  // ---------- running the reactor (point kinetics) ----------

  function startKinetics() {
    if (!pred?.k || !pred.rodCurve) return;
    viewer.stop();
    stats = null;
    if (pwr()) { plant = newPlant(); panelSync = true; }
    kin = {
      pk: new PointKinetics({ beta: pred.k.beta, Lambda: pred.k.genTime * 1e-9, nuclide: pred.k.dominant, source: pwr() ? PWR_SOURCE : 1e5 }),
      history: [], period: Infinity, tripped: false, frames: 0, notes: new Set(), produced: 0,
    };
    const k = kNow();
    kin.pk.equilibrate((k - 1) / k);
    kin.P0 = kin.pk.fissionRate(NU) * FISSION_MEV * MEV_J;
    clearCaptions();
    if (pwr()) {
      addCaption(`The plant starts at ${cfg.hot ? 'hot standby: 557 °F, 2,235 psig, all four coolant pumps running, the turbine tripped and the steam dumps holding the steam at 1,092 psig' : 'cold shutdown, 68 °F, with the pressurizer full of water'}, rods ${Math.round(100 * rods.now)}% in. The start-up sources give the source range a few counts a second. At ${Math.round(cfg.boron)} ppm boron the core is critical with the rods ${pred?.critBoron != null && pred.critBoron < cfg.boron ? 'never quite out: dilute the boron' : 'nearly all the way out'}.`);
      if (cfg.hot) addCaption('<b>To start up from the control panel:</b> hold the <b>ROD MOTION</b> lever up to withdraw (48 steps a minute) until the startup rate holds near +0.5 DPM. When <b>P-6</b> lights, press <b>SR TRIP BLOCK</b> before the source range reaches 10⁵ cps. Level off at 1–3% power, where the core starts heating the coolant. <b>LATCH</b> the turbine and turn up the <b>LOAD SETPOINT</b>; when <b>P-10</b> lights press <b>IR / PR LO BLOCK</b> before 25%; as soon as <b>C-5</b> lights (15% load) put the rods in <b>AUTO</b>, before Tavg sags below its program. Dilute the boron to make room for the rods. 10× during the startup, 100× or more for loading. Here every rod cluster moves together, so each step is worth several times what one bank’s step is in a real plant: go gently.');
    } else addCaption(`The reactor starts with the rods ${Math.round(100 * rods.now)}% in and a neutron source of 10⁵ neutrons per second. Drag <b>Control rods</b> to pull them out slowly; they move at ${Math.round(100 * ROD_SPEED)}% of their travel per second.`);
    renderButtons();
    renderStatic();
    panelUpdate();
  }

  function stopKinetics() {
    kin = null;
    viewer.glowRate = 0;
    if (plant) plant.ctl.lever = 0;
    renderButtons();
    panelUpdate();
  }

  function scram(why) {
    rods.target = 1;
    rods.scram = true;
    rods.rate = null;
    $('#chain-rods').value = 100;
    if (kin && !kin.tripped) {
      kin.tripped = true;
      addCaption(plant
        ? `<b>Reactor trip</b>${why ? ` (${why})` : ''}: the trip breakers open and every rod cluster falls in under gravity, and the turbine trips with it. Within seconds the power is down to the decay heat of the fission products (about 6% of what the core was making, if it ran for a while), which the steam dumps carry away. To restart: clear the cause, press <b>TRIP RESET</b>, and withdraw the rods again.`
        : `<b>SCRAM</b>${why ? ` (${why})` : ''}: every rod drops in. The power falls fast at first (the prompt neutrons die out within milliseconds) and then slowly, over a minute or more, as the last delayed neutrons trickle out.`);
    }
    renderRods();
  }

  /** A trip by hand: through the plant's protection system when there is one. */
  function manualTrip() {
    if (plant && kin) plant.tripReactor('manual');
    scram(kin ? (plant ? 'manual trip' : 'by hand') : null);
  }

  function moveRods(dt) {
    if (rods.now === rods.target) { rods.scram = false; return false; }
    const v = (rods.scram ? SCRAM_SPEED : rods.rate ?? (pwr() ? spec().rodSpeed / spec().H : ROD_SPEED)) * dt;
    rods.now = rods.target > rods.now ? Math.min(rods.target, rods.now + v) : Math.max(rods.target, rods.now - v);
    viewer.setRods(rods.now);
    return true;
  }

  function tickKinetics(dt) {
    if (!shown || !reactor()) return;
    if (!kin || viewer.paused) {
      if (moveRods(kin ? dt : 10 * dt)) renderRods(); // without a run, rods just glide to the slider
      panelUpdate();
      return;
    }
    const simDt = dt * kSpeed, pk = kin.pk;
    // With a plant, step in tenths of a second so the temperatures and the neutrons keep in step.
    const steps = plant ? Math.max(1, Math.ceil(simDt / 0.1)) : 1, h = simDt / steps;
    let moved = false, k = 1, rho = 0, P = 0;
    for (let i = 0; i < steps && kin; i++) {
      if (plant && !rods.scram) {
        const d = plant.rodDemand(rods.now);
        if (d) { rods.target = d.target; rods.rate = d.rate; }
      }
      moved = moveRods(h) || moved;
      k = kTotal();
      rho = (k - 1) / k;
      const n0 = pk.n;
      pk.step(h, rho);
      kin.produced += ((n0 + pk.n) / 2 / pk.Lambda) * h;
      P = pk.fissionRate(NU) * FISSION_MEV * MEV_J;
      if (plant) {
        const why = plant.step(h, P, { autoTrip: $('#chain-trip').checked });
        if (why) scram(why);
      }
    }
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
    if (plant) {
      for (const e of plant.takeEvents()) addCaption(e);
      if (plant.P6 && !plant.ctl.srBlock && !plant.trip.latched) note('p6', '<b>P-6</b> is lit: the intermediate range is on scale. Press <b>SR TRIP BLOCK</b> now, or the source range trips the reactor at 10⁵ counts a second.');
      if (plant.hot && plant.q.core > plant.q.pumps) note('heat', `The core now makes more heat than the coolant pumps put in (${plant.q.pumps.toFixed(0)} MW): the <b>point of adding heat</b>. The fuel and the water warm up, their negative temperature coefficients take reactivity away, and the power levels off by itself.`);
      if (plant.P10 && !plant.ctl.prBlock && !plant.trip.latched) note('p10', '<b>P-10</b> is lit (10% power): press <b>IR / PR LO BLOCK</b> before 25%, or the low-setpoint trips fire.');
      if (plant.C5 && plant.ctl.rodMode !== 'auto') note('c5', '<b>C-5</b> is lit (turbine above 15%): the rods can now go in <b>AUTO</b>, which moves them to hold Tavg on its program (the amber pointer).');
      if (plant.frac > 0.98) note('full', `<b>Full power</b>: ${plant.MW.toFixed(0)} MW of heat and about ${plant.MWe.toFixed(0)} MW of electricity.`);
    } else if ($('#chain-trip').checked && !kin.tripped) {
      if (kin.period > 0 && kin.period < 10 && P > 100 * kin.P0) scram('period shorter than 10 s');
      else if (P > 1e7) scram('power above 10 MW');
    }
    if (P > 1e12) { addCaption(`Stopped: past a terawatt.${plant ? '' : ' Nothing here models the fuel heating up, which in a real reactor would push k down (or destroy the core).'}`); stopKinetics(); }
    if (++kin.frames % 6 === 0 || moved) { renderKinetics(); renderRods(); }
    panelUpdate();
  }

  // ---------- the control room panel (AP1000 and Sequoyah) ----------

  const panel = createControlPanel($('#chain-panel'), {
    control(ref, v) {
      if (!plant) return;
      const c = plant.ctl;
      if (ref === 'rodMode') { c.rodMode = v; rods.target = rods.now; rods.rate = null; }
      else if (ref === 'makeup') c.makeup = v;
      else if (ref === 'gpm') c.gpm = v;
      else if (ref === 'loadSet') c.loadSet = v;
      else if (ref === 'loadRate') c.loadRate = +v;
    },
    lever(v) {
      if (!plant) return;
      plant.ctl.lever = v;
      if (!v) { rods.target = rods.now; rods.rate = null; }
      if (v > 0 && kin && plant.trip.latched) addCaption('Rod withdrawal is blocked: the reactor trip breakers are open. Press <b>TRIP RESET</b> first.');
    },
    pump(i) {
      if (!plant) return;
      plant.ctl.pumps[i] = !plant.ctl.pumps[i];
      if (kin) addCaption(`Reactor coolant pump ${plant.ctl.pumps[i] ? 'started' : 'stopped: it coasts down over about half a minute'}.`);
    },
    speed(v) { kSpeed = v; render(); },
    action(a) {
      if (a === 'run') { kin ? stopKinetics() : startKinetics(); return; }
      if (a === 'trip') { manualTrip(); return; }
      if (!plant || !kin) return;
      const c = plant.ctl;
      if (a === 'reset') {
        const err = plant.resetTrip();
        if (err) addCaption(err);
        else if (kin.tripped) { kin.tripped = false; addCaption('Trip reset: the trip breakers are closed and the rods can be withdrawn again.'); }
      } else if (a === 'latch') {
        const err = plant.latchTurbine();
        addCaption(err ?? 'Turbine latched and rolled to 1,800 rpm, generator synchronized. Turn up <b>LOAD SETPOINT</b>; the load follows at the <b>LOAD RATE</b>.');
      } else if (a === 'turbtrip') {
        const why = plant.tripTurbine(true);
        if (why) scram(why);
        else addCaption('Turbine tripped. The steam dumps open to carry the core’s heat to the condenser.');
      } else if (a === 'srblock') {
        if (c.srBlock || plant.P6) c.srBlock = !c.srBlock;
      } else if (a === 'prblock') {
        if (c.prBlock || plant.P10) c.prBlock = !c.prBlock;
      }
    },
  });

  // In the chain reaction view the periodic table makes way: the AP1000 and Sequoyah put their control
  // panel in its place, and the metal ball and the other reactors their controls. The captions leave
  // the 3D view for a panel of their own: under the core view with a control panel, under the controls without.
  const sidePane = $('#side-pane'), tablePane = document.querySelector('.table-pane');
  const cpEl = $('#chain-panel'), ctrlEl = $('#nuc-panel > .controls'), capEl = $('#nuc-caption');
  const stageEl = $('#nuc-panel > .stage');
  const cpHome = document.createComment('chain-panel'), ctrlHome = document.createComment('controls'), capHome = document.createComment('caption');
  cpEl.before(cpHome);
  ctrlEl.before(ctrlHome);
  capEl.before(capHome);
  let active = false;
  function layoutSide() {
    const sim = shown && active;
    const want = sim ? (pwr() ? cpEl : ctrlEl) : null;
    for (const [el, home] of [[cpEl, cpHome], [ctrlEl, ctrlHome]]) {
      if (el === want) { if (el.parentElement !== sidePane) sidePane.append(el); } else if (el.parentElement === sidePane) home.after(el);
    }
    sidePane.hidden = !want;
    tablePane.hidden = !!want;
    if (!sim) { if (capEl.previousSibling !== capHome) capHome.after(capEl); }
    else if (pwr()) { if (stageEl.nextSibling !== capEl) stageEl.after(capEl); }
    else if (ctrlEl.nextSibling !== capEl) ctrlEl.after(capEl);
    capEl.classList.toggle('caption-panel', sim);
  }

  function panelUpdate() {
    layoutSide();
    const show = shown && pwr() && !!plant;
    $('#chain-panel').hidden = !show;
    if (!show) return;
    panel.update({
      plant, running: !!kin, ready: !!(pred?.k && pred?.rodCurve?.length === 3), rods: rods.now, banks: cfg.banks,
      k: kin ? kin.k : null, rho: kin ? kin.rho : null, beta: pred?.k?.beta || 0.0075, speed: kSpeed, syncControls: panelSync,
    });
    panelSync = false;
  }

  // ---------- rendering ----------

  function render() {
    layoutSide();
    if (!shown) return;
    const r = reactor();
    document.querySelectorAll('#chain-system button').forEach((b) => b.classList.toggle('on', b.dataset.value === mode));
    $('#chain-ball-controls').hidden = $('#chain-ball-controls-2').hidden = r;
    $('#chain-reactor-controls').hidden = $('#chain-reactor-controls-2').hidden = !r;
    const u = cfg.fuel === 'U';
    document.querySelectorAll('#chain-fuel button').forEach((b) => b.classList.toggle('on', b.dataset.value === cfg.fuel));
    $('#chain-enrich-wrap').hidden = !u || pwr();
    document.querySelectorAll('.lattice-only').forEach((el) => { el.hidden = pwr(); });
    $('#chain-pwr-controls').hidden = !pwr();
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
      if (pwr()) {
        $('#chain-boron').value = cfg.boron;
        $('#chain-boron-value').textContent = `${Math.round(cfg.boron)} ppm`;
        document.querySelectorAll('#chain-temp button').forEach((b) => b.classList.toggle('on', (b.dataset.value === 'hot') === cfg.hot));
        $('#chain-ba').checked = cfg.absorbers;
        $('#chain-ba-note').textContent = cfg.design === 'sequoyah' ? 'first-core borosilicate glass rods' : 'first-core glass rods and coated fuel';
        $('#chain-banks-wrap').hidden = cfg.design !== 'sequoyah';
        document.querySelectorAll('#chain-banks button').forEach((b) => b.classList.toggle('on', (b.dataset.value === 'D') === !!cfg.banks));
        renderRods();
      } else {
      $('#chain-lump').value = Math.log10(cfg.a);
      $('#chain-lump-value').textContent = `${sys.a.toFixed(sys.a < 1 ? 2 : 1)} cm`;
      $('#chain-pitch').value = Math.log10(cfg.pitch);
      $('#chain-pitch-value').textContent = `${cfg.pitch.toFixed(cfg.pitch < 3 ? 2 : 1)} cm apart · ${(100 * sys.v).toFixed(sys.v < 0.1 ? 1 : 0)}% fuel by volume`;
      $('#chain-core').value = Math.log10(cfg.R);
      $('#chain-core-value').textContent = `${cfg.R.toFixed(cfg.R < 20 ? 1 : 0)} cm · ${tons(sys.mass)} of uranium${cfg.lumps ? ` in ${sys.lumpCount.toLocaleString()} lumps` : ''}`;
      renderRods();
      }
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

    $('#nuc-title').innerHTML = pwr()
      ? `<span><strong>${cfg.design === 'sequoyah' ? 'Sequoyah core' : 'AP1000 core'}</strong><br><span class="muted">${tons(sys.mass)} of uranium in ${sys.lumpCount.toLocaleString()} fuel rods · ${Math.round(cfg.boron)} ppm boron · ${cfg.hot ? 'hot' : 'cold'}</span></span>`
      : r
      ? `<span><strong>Reactor core</strong><br><span class="muted">${tons(sys.mass)} of uranium (${pctText(cfg.enrichment)} ²³⁵U) ${cfg.lumps ? 'in lumps' : 'mixed'} in ${MOD_NAME[cfg.moderator]}</span></span>`
      : `<span><strong>Chain reaction</strong><br><span class="muted">${kg(sys.mass)} kg of ${u ? `uranium (${pctText(cfg.enrichment)} ²³⁵U)` : 'plutonium-239'}${sys.refMat ? ` in ${cfg.T.toFixed(0)} cm of ${sys.refMat.name.toLowerCase()}` : ', bare'}</span></span>`;
    const fuelKeys = sys.fuelMat.parts.map((p) => p.key);
    $('#nuc-legend').innerHTML = [
      ...(pwr() ? [...spec().enrich.map((e) => `<span><i style="background:#${pwrFuelColor(e).getHexString()}"></i>${pctText(e)} fuel</span>`), `<span><i style="background:${MODERATOR_COLORS.water}"></i>water</span>`, `<span><i style="background:${ROD_COLOR};outline:1px solid #888"></i>${cfg.design === 'ap1000' ? 'black rods' : 'control rods'}</span>`, cfg.design === 'ap1000' ? '<span><i style="background:#7a808c"></i>gray rods</span>' : '']
        : r ? [`<span><i style="background:#${uraniumColor(cfg.enrichment).getHexString()}"></i>uranium</span>`, `<span><i style="background:${MODERATOR_COLORS[cfg.moderator]}"></i>${MOD_NAME[cfg.moderator]}</span>`, `<span><i style="background:${ROD_COLOR};outline:1px solid #888"></i>control rod</span>`]
        : [...fuelKeys.map((k) => `<span><i style="background:${NUCLIDE_COLORS[k]}"></i>${NAME[k]}</span>`), `<span><i style="background:${SPENT_COLOR}"></i>split</span>`,
          sys.refMat ? `<span><i style="background:${REFLECTOR_COLORS[cfg.reflector]}"></i>${sys.refMat.name.toLowerCase()}</span>` : '']),
      '<span><i style="background:#f2f8ff"></i>fast neutron</span><span><i style="background:#4073ff"></i>slow neutron</span>',
      `<span><i style="background:${PRECURSOR_COLOR}"></i>delayed-neutron precursor</span>`,
    ].join('');
    $('#nuc-scale').textContent = pwr() ? `core ${(2 * spec().equivalentR / 100).toFixed(2)} m across, ${(spec().H / 100).toFixed(2)} m tall` : r ? `core radius ${cfg.R < 100 ? `${cfg.R.toFixed(0)} cm` : `${(cfg.R / 100).toFixed(2)} m`}` : `fuel radius ${cfg.R.toFixed(1)} cm`;
    renderClock();
    renderStatic();
    $('#chain-trip').parentElement.title = pwr()
      ? 'The reactor protection system: trip on the real setpoints (source range 10⁵ cps, power range 109%, pressurizer pressure, coolant flow, …)'
      : 'Drop the rods automatically if the power rises faster than ×e in 10 s, or passes 10 MW';
    panelSync = true;
    panelUpdate();
  }

  function renderRods() {
    if (!reactor()) return;
    $('#chain-rods-value').textContent = `${(100 * rods.now).toFixed(1)}% in${rods.now !== rods.target ? ` → ${(100 * rods.target).toFixed(1)}%` : ''}`;
    const k = kTotal(), el = $('#chain-know');
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
    renderHud();
    if (!shown) return;
    const clock = $('#nuc-clock');
    clock.hidden = false;
    if (kin) { clock.innerHTML = `t = ${kin.pk.t.toFixed(1)} s · ${kSpeed === 1 ? 'real time' : `${kSpeed}× real time`}`; return; }
    const T = stats?.T ?? 0;
    clock.innerHTML = `t = ${fmtTime(T)} · slowed ${sci(1e9 / viewer.speed, 1)}×${stats?.lagging ? ' · catching up' : ''}`;
  }

  // ---------- neutron-production readout (top of the view) ----------

  let hudSamples = []; // [wall ms, T ns, produced, producedDrawn] from the running chain

  /**
   * Production rate (neutrons/s) over the latest stretch of the run, and whether it's rising or
   * falling compared with the stretch before. A stretch is at least a second of watching, longer
   * (up to four) until it holds 100 drawn neutrons; the trend counts only when the change is
   * well beyond the counting noise (3σ), so random bunching doesn't read as a trend.
   */
  function productionTrend() {
    const h = hudSamples;
    const back = (end) => {
      for (let i = end - 1; i >= 0; i--) {
        const wall = h[end][0] - h[i][0];
        if (wall >= 1000 && (h[end][3] - h[i][3] >= 100 || wall >= 4000)) return i;
      }
      return -1;
    };
    const rate = (a, b) => (h[b][2] - h[a][2]) / ((h[b][1] - h[a][1]) * 1e-9);
    const last = h.length - 1, a = last > 0 ? back(last) : -1;
    if (a < 0) return null;
    const now = rate(a, last), b = back(a);
    if (b < 0) return { now };
    const before = rate(b, a);
    const cNow = h[last][3] - h[a][3], cBefore = h[a][3] - h[b][3];
    if (cNow + cBefore < 20) return { now }; // too few to tell
    if (!cNow) return { now, alpha: -Infinity, trend: 'down' };
    if (!cBefore) return { now, trend: 'up' };
    // Growth rate α between the two stretches' midpoints: rate ∝ e^(αt).
    const lr = Math.log(now / before), dt = ((h[last][1] - h[b][1]) / 2) * 1e-9;
    const sigma = Math.sqrt(1 / cNow + 1 / cBefore);
    const trend = lr > 3 * sigma && lr > 0.1 ? 'up' : lr < -3 * sigma && lr < -0.1 ? 'down' : 'steady';
    return { now, alpha: lr / dt, trend };
  }

  function renderHud() {
    const el = $('#chain-hud');
    if (!shown) { el.hidden = true; return; }
    let produced, rate, trend, alpha, secs; // alpha in 1/s
    if (kin) {
      produced = kin.produced;
      rate = kin.pk.n / kin.pk.Lambda; // every neutron is born and dies once per generation time
      // Growth rate over the last ten seconds of reactor time (power ∝ production rate).
      const h = kin.history, last = h[h.length - 1];
      const from = last && (h.find(([t]) => t >= last[0] - 10) ?? h[0]);
      const a = last && last[0] > from[0] && from[1] > 0 ? Math.log(last[1] / from[1]) / (last[0] - from[0]) : 0;
      alpha = Math.abs(a) > Math.LN2 / 3600 ? a : 0; // slower than doubling in an hour reads as steady
      trend = alpha > 0 ? 'up' : alpha < 0 ? 'down' : 'steady';
      secs = true;
    } else {
      if (!stats) { hudSamples = []; el.hidden = true; return; }
      const prev = hudSamples[hudSamples.length - 1];
      if (prev && (stats.T < prev[1] || stats.produced < prev[2])) hudSamples = [];
      if (!prev || stats.T > prev[1]) hudSamples.push([performance.now(), stats.T, stats.produced, stats.producedDrawn]);
      if (hudSamples.length > 600) hudSamples.splice(0, 300);
      produced = stats.produced;
      const t = productionTrend();
      if (stats.done) { rate = 0; trend = stats.reason === 'died' ? 'died' : 'stopped'; }
      else { rate = t?.now; trend = t?.trend; alpha = t?.alpha; }
    }
    const fmtT = (s) => (secs ? (s < 100 ? `${s.toFixed(s < 10 ? 1 : 0)} s` : `${(s / 60).toFixed(0)} min`) : fmtTime(s * 1e9));
    const TREND = {
      up: ['▲', 'Speeding up', Number.isFinite(alpha) && alpha > 0 ? `doubling every ${fmtT(Math.LN2 / alpha)}` : ''],
      steady: ['●', 'Steady', ''],
      down: ['▼', 'Slowing down', Number.isFinite(alpha) && alpha < 0 ? `halving every ${fmtT(-Math.LN2 / alpha)}` : 'dying out'],
      stopped: ['■', 'Stopped', ''],
      died: ['■', 'Died out', 'no neutrons left'],
    };
    const [icon, word, detail] = TREND[trend] ?? ['…', 'Measuring', ''];
    el.hidden = false;
    el.innerHTML = `<div><span class="muted">Neutrons produced</span><b>${big(produced)}</b></div>
      <div><span class="muted">Production rate</span><b>${rate == null ? '…' : `${sci(rate, 2)} /s`}</b></div>
      <div class="trend ${trend === 'died' ? 'down' : trend ?? ''}"><span class="muted">Trend</span><b>${icon} ${word}</b>${detail ? `<small>${detail}</small>` : ''}</div>`;
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
            : pred.Rc === null ? `<li>No size of this ball is ever critical: ${u && cfg.enrichment < 0.05 ? 'too much ²³⁸U soaks up neutrons without splitting. Natural uranium needs a moderator: try <b>Reactor simulation</b>.' : 'too few of the neutrons go on to cause fissions.'}</li>`
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

  /** A PWR (the AP1000 or Sequoyah): one assembly as a lattice, then the whole core, compared with published values. */
  function renderPwr() {
    const L = pred?.lattice, k = pred?.k, f = L?.fourFactor, A = spec(), sqn = cfg.design === 'sequoyah';
    const latticeHTML = !L ? '<p class="muted">Working out one assembly, repeated forever…</p>' : `
      <div class="k-card ${L.kInf > 1 ? 'crit' : 'sub'}"><div class="big">k∞ = ${L.kInf.toFixed(3)}</div><div>A ${pctText(A.enrich[1])} assembly, rods out, ${Math.round(cfg.boron)} ppm boron, repeated forever.</div></div>
      ${f ? `<p class="four">k∞ = η × f × p × ε = ${f.eta.toFixed(3)} × ${f.f.toFixed(3)} × ${f.p.toFixed(3)} × ${f.eps.toFixed(3)}</p>
      <ul class="chain-facts">
        <li><b>η = ${f.eta.toFixed(2)}</b>: neutrons made per thermal neutron the fuel absorbs.</li>
        <li><b>f = ${f.f.toFixed(2)}</b>: share of thermal neutrons the fuel gets, rather than the water, its boron and the cladding.</li>
        <li><b>p = ${f.p.toFixed(2)}</b>: share that slow down past ²³⁸U’s resonances. Water slows neutrons in a few centimetres, so thin rods close together work.</li>
        <li><b>ε = ${f.eps.toFixed(2)}</b>: extra from fissions before reaching thermal energy (in a PWR, a good share are in ²³⁵U’s resonances).</li>
      </ul>` : ''}
      <p class="muted" style="font-size:12px">Each assembly: 264 fuel rods 9.5 mm across, 12.6 mm apart, with 24 guide tubes for control or absorber rods and a central instrument tube.</p>`;
    const kn = kNow();
    let coreHTML = '<p class="muted">Working out k for this core…</p>';
    if (k && kn != null) {
      const worth = pred.rodCurve?.length === 3 ? Math.log(pred.rodCurve[0][1] / pred.rodCurve[2][1]) : null;
      const cb = pred.critBoron;
      const pub = sqn
        ? (cfg.hot ? `Measured at the first startup of Sequoyah’s twin, Watts Bar Unit 1 (hot, rods out): critical at <b>${A.criticalBoronHot} ppm</b>, each ppm worth ${A.boronWorth} pcm.` : 'No cold measurement was published; hot zero power is the reference state.')
        : cfg.hot
          ? `Westinghouse’s design: hot, rods out, burnable absorbers in: critical at <b>${A.criticalBoronHot} ppm</b>.`
          : `Westinghouse’s design: cold, rods out: k = 0.99 at <b>${A.criticalBoronCold099} ppm</b>.`;
      const worthHTML = worth == null ? '<li class="muted">Working out what the rods are worth…</li>'
        : sqn && cfg.banks ? `<li>Bank D (9 clusters, the one operators use to reach critical) is worth <b>${Math.round(1e5 * worth / 10) * 10} ± ${Math.round(1e5 * (pred.worthSd ?? 0) / 10) * 10} pcm</b> (${(worth / k.beta).toFixed(1)} dollars; measured at Watts Bar 1: ${A.bankDWorth.toLocaleString()} pcm). Separate Monte Carlo runs, so the ± is large for a small worth.</li>`
          : sqn ? `<li>All 53 rod clusters together are worth <b>${(100 * worth).toFixed(1)} ± ${(100 * (pred.worthSd ?? 0)).toFixed(1)}%</b> in reactivity (${(worth / k.beta).toFixed(0)} dollars). At Watts Bar 1 each bank was measured on its own: 435–1,342 pcm, ${A.allBanksSum.toLocaleString()} pcm added up.</li>`
            : `<li>All 69 rod clusters are worth <b>${(100 * worth).toFixed(1)} ± ${(100 * (pred.worthSd ?? 0)).toFixed(1)}%</b> in reactivity (${(worth / k.beta).toFixed(0)} dollars; design: ${(100 * A.allRodsWorth).toFixed(1)}%).</li>`;
      coreHTML = `<div id="chain-know">${kCardHTML(kn)}</div>
        <ul class="chain-facts">
          <li>With the rods out, of every 100 neutrons born: <b>${Math.round(100 * k.fission)}</b> cause a fission, <b>${Math.round(100 * k.capture)}</b> are captured (<b>${Math.round(100 * k.boron)}</b> by the boron), <b>${Math.round(100 * k.escape)}</b> escape.</li>
          <li>Prompt neutron lifetime: <b>${fmtTime(k.genTime)}</b>${A.lifetime ? ` (design: ${(A.lifetime * 1e6).toFixed(1)} µs)` : ''} · delayed neutrons β = <b>${(100 * k.beta).toFixed(2)}%</b></li>
          ${worthHTML}
          ${cb === undefined ? '' : cb == null ? '' : `<li>Critical with the rods out at about <b>${Math.max(0, Math.round(cb / 10) * 10)} ± ${Math.max(10, Math.round(pred.critBoronSd / 10) * 10)} ppm</b> boron <button class="chip" data-chain-critical>Set the boron there</button></li>`}
          <li class="muted">${pub}${cfg.absorbers ? '' : ' (Without the burnable absorbers, more boron is needed.)'}</li>
        </ul>`;
    }
    const head = sqn
      ? `<h2>Sequoyah Nuclear Plant</h2>
      <div class="muted">TVA’s plant on Chickamauga Lake near Soddy-Daisy, north of Chattanooga: two Westinghouse four-loop pressurized-water reactors (1981 and 1982), 3,455 MW of heat each. 193 fuel assemblies in a core 3.4 m across and 3.7 m tall, in water at 2,250 psi.</div>`
      : `<h2>AP1000 pressurized-water reactor</h2>
      <div class="muted">Westinghouse’s 1,100-megawatt design, running at Vogtle in Georgia and at Sanmen and Haiyang in China: 157 fuel assemblies in a core 3 m across and 4.3 m tall, in water at 2,250 psi.</div>`;
    const explain = sqn
      ? `A PWR controls its chain three ways. <b>Boron dissolved in the water</b> (as boric acid) evens out slow changes: the plant dilutes it month by month as the fuel burns. <b>Burnable absorbers</b> (here borosilicate-glass rods in the guide tubes of fresh fuel) soak up neutrons early on and burn away. <b>Rod clusters</b> handle fast changes: Sequoyah has 53, each of 24 silver–indium–cadmium rodlets, in four shutdown banks (SA–SD, kept out while running) and four control banks (A–D). To start up, operators pull the shutdown banks, then the control banks in turn, and reach critical on <b>bank D</b>; pick <b>Bank D only</b> to do that last step with the others already out. The drives move 72 steps of ⅝ inch a minute, so a full pull takes about three minutes. In 2019 Unit 1’s centre rod (H-8, bank D) kept dropping in, and the unit ran a whole cycle with 52.`
      : `A PWR controls its chain three ways. <b>Boron dissolved in the water</b> (as boric acid) evens out slow changes: the plant dilutes it month by month as the fuel burns. <b>Burnable absorbers</b> in fresh fuel soak up neutrons early on and burn away as the fuel does. <b>Rod clusters</b> handle fast changes: 53 “black” clusters of 24 silver–indium–cadmium rodlets, and 16 “gray” ones with half the absorber, used to follow the load. Here all 69 move together at the real drives’ top speed of 45 inches a minute, so a full pull takes about four minutes. The water is also the moderator: its hydrogen slows the neutrons, and boron in it catches some of them, so each ppm of boron takes away about 0.008% of k.`;
    const note = sqn
      ? `How it’s modeled: every fuel rod (UO₂ pellet, helium gap, Zircaloy cladding), guide tube, rodlet and glass absorber rod of a fresh first core, in borated water, with the steel baffle round the core and water out to the core barrel. The rod-cluster positions and banks are Sequoyah’s, from TVA’s 2019 filing with the NRC; the 17 × 17 fuel, the 12 ft core and the hot-zero-power state (557 °F, water at 0.743 g/cm³) are those of its twin, Watts Bar Unit 1, whose first-core loading (2.11%, 2.62% and 3.10% fuel, 1,712 Pyrex rods) and startup measurements ORNL published as the VERA benchmark; Sequoyah’s own first core was of the same Westinghouse design. Checks against those measurements: rods out at 1,291 ppm this model gives k = 1.010 ± 0.002 (so critical near 1,375 ppm, 85 ppm high); bank D is worth 1,305 ± 300 pcm (measured 1,342); boron worth about −9 pcm/ppm (measured −10.8). Approximate: which guide tubes hold the glass rods (the counts are right), the baffle (two rod cells of steel), and the gap between assemblies (shared out among the rod cells); spacer grids and nozzles are left out. Sequoyah today runs on part-burned fuel (Framatome, now changing to Westinghouse), which needs burn-up to model. Not modeled: xenon and burn-up.`
      : `How it’s modeled: every fuel rod (UO₂ pellet, helium gap, zirconium-alloy cladding), guide tube, rodlet and burnable absorber of the first core, in borated water inside the core barrel, from Westinghouse’s Design Control Document (Rev. 19). Hot zero power is 557 °F, water at 0.743 g/cm³, with ²³⁸U’s resonances Doppler-broadened and thermal neutrons in a Maxwell spread at that temperature. Checked against ORNL’s VERA benchmark for this fuel (a fuel-rod cell, an assembly, and an assembly with 24 Ag–In–Cd rods), all within 0.4%; at 1,382 ppm the whole core comes out at k = 1.000 ± 0.005, as published. Reconstructed, not published: which assemblies hold the rod clusters and burnable absorbers (symmetric, matching the published counts), so the rods come out worth less than the design’s 12.7%. The gap between assemblies is shared out among the rod cells; spacer grids, nozzles and the steel core shroud are left out (water instead). Not modeled: xenon and burn-up.`;
    $('#nuc-info').innerHTML = `<div class="info-head"><div>${head}</div></div>
      <div class="beam-grid">
        <div><h3>One fuel assembly</h3>${latticeHTML}</div>
        <div><h3>The whole core</h3>${coreHTML}</div>
      </div>
      <div class="beam-grid">
        <div><h3>Running the reactor (seconds)</h3><div id="chain-kin"></div><div id="chain-kin-chart"></div></div>
        <div><h3>Watching the neutrons (microseconds)</h3><div id="chain-live"></div><div id="chain-chart"></div></div>
      </div>
      <p class="explain">${explain}</p>
      <p class="explain"><b>The control panel</b> under the core is laid out like ${sqn ? 'the analog main control board of a Westinghouse four-loop plant such as Sequoyah: edgewise meters, an IN–HOLD–OUT rod lever, mechanical step counters, J-handle pump switches and windows of annunciators' : 'the AP1000’s main control room, where the reactor operator works at screens (soft controls) under a wall panel showing the whole plant, with a small set of hardwired switches on the dedicated safety panel for tripping the reactor'}. Red lamps mean running or closed, green stopped or open, as in US plants. The meters follow the plant over seconds to hours: start up on the rods, block the source-range trip at P-6 and the low-power trips at P-10, heat the coolant, load the turbine, and let automatic rod control hold Tavg on its program while you dilute the boron.</p>
      <p class="note">How the plant is modeled: the core’s power comes from the point-kinetics run (six delayed-neutron groups), with k from the Monte Carlo rod curve, the boron worth from the same run, a Doppler coefficient of −1.6 pcm/°F of fuel temperature and a moderator coefficient that runs from ${(-30 + 0.02 * cfg.boron).toFixed(1).replace('-', '−')} pcm/°F at ${Math.round(cfg.boron)} ppm to −30 with no boron. Lumped heat balances follow the fuel, the reactor coolant (Thot and Tcold from the flow of four pumps, which coast down when stopped) and the steam generators, which feed the turbine, the steam dumps (40% of full steam flow, holding 1,092 psig at no load, or on Tavg after a load rejection) and the safety valves (1,185 psig). Decay heat builds up and dies away in six groups (about 6% just after a trip from long operation). Design values: ${sqn ? '3,455 MW of heat, Tavg 557 °F at no load (this core’s reference state) to 588 °F at full load, and 61 °F across the core: a typical four-loop program, approximate for Sequoyah' : '3,400 MW of heat, Tavg 557 → 573.6 °F, Thot 610 °F and Tcold 535 °F at full power'}. The protection system trips on the standard Westinghouse setpoints: source range 10⁵ cps (blockable above P-6), intermediate range and low power range 25% (blockable above P-10), power range 109%, a positive rate of 5% in 2 s, pressurizer pressure 2,385 psig high and 1,970 psig low, coolant flow, a simplified overtemperature ΔT${sqn ? ', and a turbine trip above 50% power (P-9)' : '; the AP1000 rides out a turbine trip on its steam dumps and rod control, as designed'}. Rod control moves all the clusters together, 48 steps a minute by hand and 8–72 in automatic. Simplified: the pressurizer (pressure from the coolant’s swell, with heaters and sprays; level on program), the steam generator level (swell and shrink only), the turbine (no warm-up, synchronizing or valve testing) and the instrument ranges. Not modeled: xenon, burn-up, and the safety-injection and passive cooling systems.</p>`;
    renderLive();
    renderKinetics();
  }

  function renderReactor() {
    if (pwr()) return renderPwr();
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
      <li>Power: <b>${powerText(kin.P ?? kin.P0)}</b> <span class="muted">(${sci((kin.P ?? kin.P0) / (FISSION_MEV * MEV_J), 2)} fissions per second)</span></li>
      <li>Period: <b>${!isFinite(p) || Math.abs(p) > 3600 ? 'steady' : `${p > 0 ? 'rising' : 'falling'}, ×e every ${Math.abs(p) < 1 ? `${(Math.abs(p) * 1000).toFixed(0)} ms` : `${Math.abs(p).toFixed(0)} s`}`}</b></li>
      <li>k = <b>${(kin.k ?? kNow()).toFixed(4)}</b> · rods ${(100 * rods.now).toFixed(1)}% in${kin.tripped ? ' · <b>SCRAMed</b>' : ''}</li>
      <li class="muted">Delayed-neutron precursors waiting: ${sci(kin.pk.C.reduce((a, b) => a + b, 0) + 1e-30, 2)}</li>
    </ul>`;
    const h = kin.history;
    if (!h.length) { $('#chain-kin-chart').innerHTML = ''; return; }
    const tMax = Math.max(10, h[h.length - 1][0]);
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
  $('#chain-boron').addEventListener('input', (e) => { cfg.boron = +e.target.value; rebuild(); });
  $('#chain-temp').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    cfg.hot = b.dataset.value === 'hot';
    rebuild();
  });
  $('#chain-ba').addEventListener('change', (e) => { cfg.absorbers = e.target.checked; rebuild(); });
  $('#chain-banks').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    cfg.banks = b.dataset.value === 'D' ? ['D'] : null;
    rebuild();
  });
  $('#chain-lump').addEventListener('input', (e) => { cfg.a = 10 ** +e.target.value; rebuild(); });
  $('#chain-pitch').addEventListener('input', (e) => { cfg.pitch = 10 ** +e.target.value; rebuild(); });
  $('#chain-core').addEventListener('input', (e) => { cfg.R = 10 ** +e.target.value; rebuild(); });
  $('#chain-rods').addEventListener('input', (e) => {
    const target = +e.target.value / 100;
    if (kin && plant?.trip.latched && target < rods.now) {
      e.target.value = 100 * rods.target;
      addCaption('Rod withdrawal is blocked: the reactor trip breakers are open. Press <b>TRIP RESET</b> on the panel first.');
      return;
    }
    rods.target = target;
    rods.rate = null;
    rods.scram = false;
    if (kin && !plant) kin.tripped = false; // re-armed
    renderRods();
  });
  $('#chain-scram').addEventListener('click', manualTrip);
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
    if (!shown || !e.target.closest('[data-chain-critical]')) return;
    if (pwr()) {
      if (pred?.critBoron == null) return;
      cfg.boron = Math.max(0, Math.round(pred.critBoron / 10) * 10);
      rebuild();
      return;
    }
    if (!pred?.Rc) return;
    // A reactor gets a little margin over critical, for the rods to hold down.
    cfg.R = reactor() ? Math.round(pred.Rc * 1.06 * 10) / 10 : Math.round(pred.Rc * 10) / 10;
    rebuild();
  });

  setSpeed(1);

  return {
    /** Show or hide the chain view (its canvas, controls and readout). */
    show(on, isActive) {
      shown = on;
      active = isActive;
      $('#nuc-chain').hidden = !on;
      $('#nuc-chain-controls').hidden = !on;
      panelUpdate();
      viewer.setActive(on && isActive);
      renderHud();
      if (on && !pred && !workers.length) predict();
    },
    setActive(on) { active = on; layoutSide(); viewer.setActive(on && shown); },
    render,
    fit() { viewer.fit(); },
  };
}
