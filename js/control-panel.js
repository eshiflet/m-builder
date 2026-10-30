// The control room panel under the PWR core view: nuclear instruments, reactor coolant meters,
// annunciators, a plant overview mimic, and the controls an operator uses to start up and load
// the plant (rod control lever, boron makeup, turbine, coolant pumps, reactor protection).
// Two styles: the AP1000's digital workstation screens with a hardwired safety panel, and the
// analog benchboards of a Westinghouse four-loop plant like Sequoyah. It reads a Plant (plant.js)
// and writes the operator's actions back to plant.ctl, or through the hooks for what chain-ui owns.

import { TRIPS } from './plant.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const rad = (a) => (a * Math.PI) / 180;
const supExp = (e) => String(e).replace(/-/g, '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[d]);

// ---------- instruments (SVG strings; each has data-ref hooks that update() moves) ----------

/** A round meter, 240° of sweep. Log scales take exponents for min, max and the ticks. */
function arcGauge(ref, { label, min, max, log = false, ticks, tickLabel = (v) => v, zones = [] }) {
  const cx = 60, cy = 56, r = 42;
  const t = (v) => (v - min) / (max - min);
  const ang = (v) => 150 + 240 * clamp(t(v), 0, 1);
  const xy = (a, rr) => [(cx + rr * Math.cos(rad(a))).toFixed(2), (cy + rr * Math.sin(rad(a))).toFixed(2)];
  const pt = (a, rr) => xy(a, rr).join(',');
  const arc = (a1, a2, rr) => `M${pt(a1, rr)} A${rr},${rr} 0 ${a2 - a1 > 180 ? 1 : 0} 1 ${pt(a2, rr)}`;
  const tick = (a, r2, cls) => { const [x1, y1] = xy(a, r), [x2, y2] = xy(a, r2); return `<line class="g-tick${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`; };
  let s = `<path class="g-scale" d="${arc(150, 390, r)}"/>`;
  for (const [a, b, cls] of zones) s += `<path class="g-zone ${cls}" d="${arc(ang(a), ang(b), r - 3)}"/>`;
  ticks.forEach((v, i) => {
    s += tick(ang(v), r - 7, '');
    if (i < ticks.length - 1) s += tick(ang((v + ticks[i + 1]) / 2), r - 4, ' minor');
    const [lx, ly] = xy(ang(v), r - 15);
    s += `<text class="g-num" x="${lx}" y="${+ly + 3}" text-anchor="middle">${log ? `10${supExp(v)}` : tickLabel(v)}</text>`;
  });
  return `<div class="cp-gauge" data-ref="${ref}" data-min="${min}" data-max="${max}" data-log="${log ? 1 : 0}">
    <svg viewBox="0 0 120 92" aria-hidden="true"><circle class="g-face" cx="${cx}" cy="${cy}" r="${r + 8}"/>${s}
      <text class="g-unit" x="${cx}" y="${cy + 22}" text-anchor="middle">${label.unit}</text>
      <g class="g-needle" style="transform-origin:${cx}px ${cy}px"><line x1="${cx - 8}" y1="${cy}" x2="${cx + r - 4}" y2="${cy}"/></g>
      <circle class="g-hub" cx="${cx}" cy="${cy}" r="3.5"/></svg>
    <div class="cp-name">${label.name}</div><div class="cp-dig" data-dig>—</div></div>`;
}

/** An edgewise (vertical) meter, the classic Westinghouse board instrument, with an optional setpoint pointer. */
function edgewise(ref, { name, unit, min, max, ticks }) {
  const y = (v) => 110 - (100 * (v - min)) / (max - min);
  let s = '';
  for (const v of ticks) s += `<line class="g-tick" x1="25" x2="33" y1="${y(v)}" y2="${y(v)}"/><text class="g-num" x="35" y="${y(v) + 2.5}">${v}</text>`;
  for (let i = 0; i < ticks.length - 1; i++) s += `<line class="g-tick minor" x1="25" x2="29" y1="${y((ticks[i] + ticks[i + 1]) / 2)}" y2="${y((ticks[i] + ticks[i + 1]) / 2)}"/>`;
  return `<div class="cp-edge" data-ref="${ref}" data-min="${min}" data-max="${max}">
    <svg viewBox="0 0 54 120" aria-hidden="true"><rect class="g-face" x="2" y="4" width="50" height="112" rx="3"/>
      <line class="g-scale" x1="25" x2="25" y1="10" y2="110"/>${s}
      <path class="g-set" data-set d="M24 0 l-6 -3.5 v7z" style="display:none"/>
      <path class="g-ptr" data-ptr d="M24 0 l-14 -4 v8z"/></svg>
    <div class="cp-name">${name}</div><div class="cp-dig" data-dig>—</div><div class="cp-unit">${unit}</div></div>`;
}

/** A continuous knob (setpoint dial): drag up/down, scroll, or arrow keys. */
function knob(ref, { name, min, max, step, value, fmt }) {
  let ticks = '';
  for (let i = 0; i <= 10; i++) {
    const a = rad(135 + 27 * i);
    ticks += `<line class="g-tick${i % 5 ? ' minor' : ''}" x1="${32 + 27 * Math.cos(a)}" y1="${32 + 27 * Math.sin(a)}" x2="${32 + (i % 5 ? 24 : 22) * Math.cos(a)}" y2="${32 + (i % 5 ? 24 : 22) * Math.sin(a)}"/>`;
  }
  return `<div class="cp-knob" data-ref="${ref}" data-min="${min}" data-max="${max}" data-step="${step}" data-value="${value}" data-fmt="${fmt}" tabindex="0" role="slider" aria-label="${name}" aria-valuemin="${min}" aria-valuemax="${max}">
    <svg viewBox="0 0 64 64" aria-hidden="true">${ticks}<g class="k-cap"><circle cx="32" cy="32" r="17"/><circle class="k-skirt" cx="32" cy="32" r="12"/><line x1="32" y1="32" x2="32" y2="17"/></g></svg>
    <div class="cp-name">${name}</div><div class="cp-dig small" data-dig>—</div></div>`;
}

/** A rotary selector switch with its positions engraved around it. positions: [[value, label]]. */
function selector(ref, name, positions, value) {
  const n = positions.length, spread = n === 2 ? 70 : 90;
  const angles = positions.map((_, i) => -spread / 2 + (spread * i) / Math.max(1, n - 1));
  const labels = positions.map(([v, l], i) => {
    const a = rad(angles[i] - 90);
    return `<text class="sel-pos" data-pos="${v}" x="${40 + 30 * Math.cos(a)}" y="${36 + 30 * Math.sin(a) + 3}" text-anchor="middle">${l}</text>`;
  }).join('');
  return `<div class="cp-sel" data-ref="${ref}" data-value="${value}" data-positions='${JSON.stringify(positions.map(([v], i) => [v, angles[i]]))}' tabindex="0" role="radiogroup" aria-label="${name}">
    <svg viewBox="0 0 80 64" aria-hidden="true">${labels}<g class="sel-knob"><circle cx="40" cy="38" r="15"/><rect x="37" y="22" width="6" height="32" rx="3"/><circle class="sel-dot" cx="40" cy="25" r="1.6"/></g></svg>
    <div class="cp-name">${name}</div></div>`;
}

/** The rod control IN–HOLD–OUT lever: spring-returns to HOLD when let go. */
function lever(ref) {
  return `<div class="cp-lever" data-ref="${ref}" tabindex="0" role="slider" aria-label="Rod motion lever: up withdraws, down inserts" aria-valuemin="-1" aria-valuemax="1" aria-valuenow="0">
    <svg viewBox="0 0 60 104" aria-hidden="true">
      <text class="lv-lbl" x="30" y="9" text-anchor="middle">OUT</text><text class="lv-lbl" x="30" y="102" text-anchor="middle">IN</text>
      <text class="lv-lbl hold" x="54" y="55" text-anchor="end">HOLD</text>
      <rect class="lv-plate" x="10" y="13" width="40" height="78" rx="6"/><rect class="lv-slot" x="26" y="20" width="8" height="64" rx="4"/>
      <g class="lv-handle"><rect x="27" y="40" width="6" height="12" rx="2"/><rect class="lv-grip" x="14" y="44" width="32" height="12" rx="6"/></g></svg>
    <div class="cp-name">ROD MOTION</div></div>`;
}

function lamp(ref, cls, text) { return `<span class="cp-lamp ${cls}" data-ref="${ref}">${text}</span>`; }

// ---------- the panel ----------

const ANNUNCIATORS = [
  ['rxTrip', 'REACTOR\nTRIP', 'trip'], ['turbTrip', 'TURBINE\nTRIP', 'trip'], ['sr', 'SR HIGH\nFLUX', 'alarm'], ['ir', 'IR HIGH\nFLUX', 'alarm'],
  ['prLow', 'PR HI FLUX\nLOW SP', 'alarm'], ['prHigh', 'PR HI FLUX\nHIGH SP', 'alarm'], ['prRate', 'PR HIGH\nPOS RATE', 'alarm'], ['otdt', 'OVERTEMP\nΔT', 'alarm'],
  ['pzrHigh', 'PZR PRESS\nHIGH', 'alarm'], ['pzrLow', 'PZR PRESS\nLOW', 'alarm'], ['flow', 'RCS LOOP\nFLOW LOW', 'alarm'], ['sur', 'STARTUP\nRATE HIGH', 'alarm'],
  ['tdev', 'TAVG–TREF\nDEVIATION', 'alarm'], ['rwb', 'ROD WITHDR\nBLOCK', 'alarm'], ['dil', 'BORON\nDILUTION', 'alarm'], ['dump', 'STEAM DUMP\nOPEN', 'alarm'],
  ['sgsv', 'SG SAFETY\nVALVE OPEN', 'alarm'], ['sglvl', 'SG LEVEL\nDEVIATION', 'alarm'], ['auto', 'ROD CONTROL\nIN AUTO', 'status'], ['gen', 'GENERATOR\nON LINE', 'status'],
  ['P6', 'P-6\nIR ABOVE', 'status'], ['P7', 'P-7\nAT POWER', 'status'], ['P10', 'P-10\nNIS ABOVE', 'status'], ['C5', 'C-5\nTURB ≥15%', 'status'],
];

export function createControlPanel(root, hooks) {
  let design = null, refs = {}, ann = {}, last = 0, state = null, plant = null;
  const turbWas = { latched: false };

  function build(d, P) {
    design = d;
    const ap = d === 'ap1000';
    const pumps = ap ? ['1A', '1B', '2A', '2B'] : ['1', '2', '3', '4'];
    const banks = P.spec.bankLabels;
    root.className = `cp ${ap ? 'cp-ap1000' : 'cp-sequoyah'}`;
    root.innerHTML = `
      <div class="cp-head">
        <div class="cp-plate">${ap ? 'AP1000 MAIN CONTROL ROOM · REACTOR OPERATOR WORKSTATION' : 'SEQUOYAH UNIT 1 · MAIN CONTROL BOARD'}</div>
        <div class="cp-sim"><span class="cp-clock" data-ref="clock">t = 0 s</span>
          <div class="cp-speed" data-ref="speed">${[1, 10, 100, 1000].map((v) => `<button data-speed="${v}">${v}×</button>`).join('')}</div>
          <button class="cp-run" data-act="run">■ Stop</button></div>
      </div>
      <div class="cp-screen cp-wall"><div class="cp-tag">${ap ? 'WALL PANEL INFORMATION SYSTEM · PLANT OVERVIEW' : 'PLANT MIMIC'}</div>${mimic(ap, P)}</div>
      <div class="cp-screen cp-annbox"><div class="cp-tag">ANNUNCIATORS <span class="cp-firstout" data-ref="firstout"></span>
        <span class="cp-annbtns"><button data-act="ack">ACK</button><button data-act="annreset">RESET</button></span></div>
        <div class="cp-ann">${ANNUNCIATORS.map(([k, t, c]) => `<div class="cp-win ${c}" data-ann="${k}">${t.replace('\n', '<br>')}</div>`).join('')}</div></div>
      <div class="cp-row">
        <div class="cp-screen cp-bay"><div class="cp-tag">NUCLEAR INSTRUMENTATION</div><div class="cp-nis"><div class="cp-gauges">
          ${arcGauge('sr', { label: { name: 'SOURCE RANGE', unit: 'cps' }, min: 0, max: 6, log: true, ticks: [0, 1, 2, 3, 4, 5, 6], zones: [[5, 6, 'red']] })}
          ${arcGauge('ir', { label: { name: 'INTERMEDIATE RANGE', unit: 'amps' }, min: -11, max: -3, log: true, ticks: [-11, -9, -7, -5, -3], zones: [[-3.6, -3, 'red']] })}
          ${arcGauge('pr', { label: { name: 'POWER RANGE', unit: '% power' }, min: 0, max: 120, ticks: [0, 20, 40, 60, 80, 100, 120], zones: [[109, 120, 'red']] })}
          ${arcGauge('sur', { label: { name: 'STARTUP RATE', unit: 'DPM' }, min: -1, max: 5, ticks: [-1, 0, 1, 2, 3, 4, 5], zones: [[1, 5, 'amber']] })}
        </div>
        <div class="cp-reac"><span class="cp-tag2">REACTIVITY<br>COMPUTER</span><span class="cp-dig" data-ref="rho">—</span><span class="cp-dig" data-ref="dollars">—</span><span class="cp-dig" data-ref="keff">—</span></div></div></div>
        <div class="cp-screen cp-bay"><div class="cp-tag">REACTOR COOLANT SYSTEM · STEAM GENERATORS</div><div class="cp-edges">
          ${edgewise('tavg', { name: 'TAVG / TREF', unit: '°F', min: 530, max: 600, ticks: [530, 550, 570, 590] })}
          ${edgewise('thot', { name: 'T HOT', unit: '°F', min: 530, max: 650, ticks: [530, 570, 610, 650] })}
          ${edgewise('tcold', { name: 'T COLD', unit: '°F', min: 500, max: 600, ticks: [500, 540, 580] })}
          ${edgewise('ppzr', { name: 'PZR PRESS', unit: 'psig', min: 1700, max: 2500, ticks: [1700, 1900, 2100, 2300, 2500] })}
          ${edgewise('lpzr', { name: 'PZR LEVEL', unit: '%', min: 0, max: 100, ticks: [0, 25, 50, 75, 100] })}
          ${edgewise('psg', { name: 'STEAM PRESS', unit: 'psig', min: 0, max: 1300, ticks: [0, 400, 800, 1200] })}
          ${edgewise('lsg', { name: 'SG LEVEL NR', unit: '%', min: 0, max: 100, ticks: [0, 25, 50, 75, 100] })}
          ${edgewise('mwe', { name: 'GENERATOR', unit: 'MWe', min: 0, max: 1400, ticks: [0, 400, 800, 1200] })}
        </div></div>
      </div>
      <div class="cp-row cp-desk">
        <div class="cp-bay cp-ctl rodctl"><div class="cp-tag">ROD CONTROL</div><div class="cp-ctlrow">
          ${selector('rodMode', 'BANK SELECT', [['man', 'MAN'], ['auto', 'AUTO']], 'man')}
          ${lever('lever')}
          <div class="cp-stack"><div class="cp-counter" data-ref="steps">000</div><div class="cp-name">STEPS WITHDRAWN</div>
            <div class="cp-drpi" data-ref="drpi">${banks.map((b) => `<div class="drpi-col" data-bank="${b}"><div class="drpi-leds">${'<i></i>'.repeat(12)}</div><span>${b}</span></div>`).join('')}</div>
            <div class="cp-name">${ap ? 'DIGITAL ROD POSITION' : 'DRPI'}</div></div>
        </div></div>
        <div class="cp-bay cp-ctl cvcs"><div class="cp-tag">${ap ? 'CHEMICAL &amp; VOLUME CONTROL' : 'CVCS · REACTOR MAKEUP'}</div><div class="cp-ctlrow">
          ${selector('makeup', 'MAKEUP MODE', [['borate', 'BOR'], ['off', 'OFF'], ['dilute', 'DIL']], 'off')}
          ${knob('gpm', { name: 'MAKEUP FLOW', min: 10, max: 150, step: 5, value: 100, fmt: 'gpm' })}
          <div class="cp-stack"><div class="cp-dig big" data-ref="boron">—</div><div class="cp-name">RCS BORON ppm</div>
            <div class="cp-dig small" data-ref="borRate">—</div></div>
        </div></div>
        <div class="cp-bay cp-ctl"><div class="cp-tag">TURBINE–GENERATOR</div><div class="cp-ctlrow">
          <div class="cp-stack"><button class="cp-pb green" data-act="latch">LATCH</button><button class="cp-pb red small" data-act="turbtrip">TRIP</button></div>
          ${knob('loadSet', { name: 'LOAD SETPOINT', min: 0, max: 100, step: 1, value: 0, fmt: '%' })}
          ${selector('loadRate', 'LOAD RATE %/min', [[1, '1'], [5, '5'], [10, '10']], 5)}
          <div class="cp-stack"><div class="cp-dig" data-ref="load">—</div><div class="cp-name">TURBINE LOAD</div>${lamp('rpm', 'off', 'TURNING GEAR')}</div>
        </div></div>
        <div class="cp-bay cp-ctl pumps"><div class="cp-tag">REACTOR COOLANT PUMPS</div><div class="cp-ctlrow cp-pumps">
          ${pumps.map((n, i) => `<div class="cp-jh" data-pump="${i}" role="switch" tabindex="0" aria-label="Reactor coolant pump ${n}"><div class="jh-lamps"><span class="cp-led g"></span><span class="cp-led r"></span></div><svg viewBox="0 0 40 40" aria-hidden="true"><circle class="jh-base" cx="20" cy="20" r="15"/><g class="jh-handle"><path d="M20 20 L20 6 Q20 3 23 3 L26 3"/><circle cx="20" cy="20" r="5"/></g></svg><div class="cp-name">RCP ${n}</div></div>`).join('')}
        </div></div>
        <div class="cp-bay cp-ctl cp-safety"><div class="cp-tag">${ap ? 'PRIMARY DEDICATED SAFETY PANEL' : 'REACTOR PROTECTION'}</div><div class="cp-ctlrow">
          <div class="cp-stack"><button class="cp-pb red big" data-act="trip">REACTOR<br>TRIP</button><div class="cp-name">MANUAL</div></div>
          <div class="cp-stack"><button class="cp-pb white" data-act="reset">TRIP<br>RESET</button>
            <div class="cp-brk">${lamp('rta', 'red', 'RTA')}${lamp('rtb', 'red', 'RTB')}</div><div class="cp-name">TRIP BREAKERS</div></div>
          <div class="cp-stack"><button class="cp-pb amber" data-act="srblock">SR TRIP<br>BLOCK</button><button class="cp-pb amber" data-act="prblock">IR / PR LO<br>BLOCK</button></div>
        </div></div>
      </div>
      <div class="cp-idle" data-ref="idle"><div><b>Reactor not running.</b> <span data-ref="idleText"></span></div><button class="chip fire" data-act="run">▶ Run the reactor</button></div>`;

    refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => { refs[el.dataset.ref] = el; });
    ann = {};
    root.querySelectorAll('[data-ann]').forEach((el) => { ann[el.dataset.ann] = { el, on: false, state: 'off' }; });
    bindKnobs();
    bindSelectors();
    bindLever();
  }

  /** The plant overview: containment, vessel, pressurizer, a steam generator loop, turbine, generator, condenser. */
  function mimic(ap, P) {
    return `<svg class="cp-mimic" viewBox="0 0 640 170" aria-label="Plant overview">
      <path class="m-cont" d="M14 166 V70 Q14 6 160 6 Q306 6 306 70 V166"/>
      <text class="m-lbl" x="160" y="22" text-anchor="middle">${ap ? 'STEEL CONTAINMENT VESSEL' : 'ICE CONDENSER CONTAINMENT'}</text>
      <path class="m-hot" data-ref="mHot" d="M104 78 H160 Q176 78 182 104 L190 116"/>
      <path class="m-cold" data-ref="mCold" d="M232 128 H250 V150 H180 M164 150 H104"/>
      <g class="m-pump" data-ref="mPump" transform="translate(172 150)"><circle r="9"/><g class="m-blades"><path d="M0 -7 L0 7 M-7 0 L7 0"/></g></g>
      <path class="m-pipe" d="M136 96 V78"/>
      <rect class="m-vessel" x="58" y="44" width="46" height="112" rx="20"/>
      <rect class="m-core" data-ref="mCore" x="68" y="96" width="26" height="46" rx="3"/>
      <g data-ref="mRods">${[73, 79, 85].map((x) => `<line class="m-rod" x1="${x + 1}" x2="${x + 1}" y1="52" y2="96"/>`).join('')}</g>
      <rect class="m-vessel" x="124" y="36" width="24" height="60" rx="11"/>
      <rect class="m-water" data-ref="mPzr" x="127" y="60" width="18" height="33" rx="2"/>
      <rect class="m-vessel" x="188" y="30" width="44" height="112" rx="20"/>
      <rect class="m-water" data-ref="mSg" x="193" y="70" width="34" height="60" rx="4"/>
      <text class="m-val" data-ref="vPwr" x="22" y="164">—</text>
      <text class="m-val" data-ref="vHot" x="166" y="100" text-anchor="end">—</text>
      <text class="m-val" data-ref="vCold" x="215" y="164" text-anchor="middle">—</text>
      <text class="m-val" data-ref="vPzr" x="136" y="32" text-anchor="middle">—</text>
      <text class="m-lbl" x="296" y="140" text-anchor="end">${P.spec.loops} SG</text><text class="m-lbl" x="296" y="150" text-anchor="end">${P.spec.pumps} RCP</text>
      <path class="m-steam" data-ref="mSteam" d="M210 30 V14 H352"/>
      <text class="m-val" data-ref="vSteam" x="282" y="11" text-anchor="middle">—</text>
      <path class="m-steam" d="M326 14 V120 H362"/>
      <g data-ref="mDump" transform="translate(326 66)"><path class="m-valve" d="M-6 -8 L6 8 L-6 8 L6 -8 Z"/></g>
      <text class="m-lbl" x="320" y="92" text-anchor="end">DUMP</text>
      <polygon class="m-turb" data-ref="mTurb" points="352,4 432,0 432,40 352,32"/>
      <text class="m-lbl" x="392" y="22" text-anchor="middle">TURBINE</text>
      <line class="m-shaft" x1="432" x2="452" y1="20" y2="20"/>
      <rect class="m-gen" data-ref="mGen" x="452" y="6" width="56" height="28" rx="4"/>
      <text class="m-lbl" x="480" y="24" text-anchor="middle">GEN</text>
      <path class="m-pipe" data-ref="mOut" d="M508 20 H540"/>
      <text class="m-val big" data-ref="vMwe" x="546" y="25">—</text>
      <text class="m-val" data-ref="vRpm" x="392" y="52" text-anchor="middle">—</text>
      <path class="m-pipe" d="M392 32 V108"/>
      <rect class="m-cond" x="362" y="108" width="96" height="36" rx="4"/>
      <text class="m-lbl" x="410" y="130" text-anchor="middle">CONDENSER</text>
      <path class="m-feed" d="M410 144 V160 H262 V118 H232"/>
      <text class="m-lbl" x="336" y="156" text-anchor="middle">FEEDWATER</text>
      <text class="m-val" data-ref="vMode" x="630" y="160" text-anchor="end">—</text>
    </svg>`;
  }

  // ---------- inputs ----------

  function knobSet(el, v, fire = true) {
    const min = +el.dataset.min, max = +el.dataset.max, step = +el.dataset.step;
    v = clamp(Math.round(v / step) * step, min, max);
    el.dataset.value = v;
    el.setAttribute('aria-valuenow', v);
    el.querySelector('.k-cap').style.transform = `rotate(${-135 + (270 * (v - min)) / (max - min)}deg)`;
    el.querySelector('[data-dig]').textContent = `${v} ${el.dataset.fmt}`;
    if (fire) hooks.control(el.dataset.ref, v);
  }

  function bindKnobs() {
    root.querySelectorAll('.cp-knob').forEach((el) => {
      knobSet(el, +el.dataset.value, false);
      const span = () => +el.dataset.max - +el.dataset.min;
      let y0 = null, v0 = 0;
      el.addEventListener('pointerdown', (e) => { y0 = e.clientY; v0 = +el.dataset.value; el.setPointerCapture(e.pointerId); e.preventDefault(); el.focus(); });
      el.addEventListener('pointermove', (e) => { if (y0 !== null) knobSet(el, v0 + ((y0 - e.clientY) * span()) / 140); });
      const end = () => { y0 = null; };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('wheel', (e) => { e.preventDefault(); knobSet(el, +el.dataset.value - Math.sign(e.deltaY) * +el.dataset.step); }, { passive: false });
      el.addEventListener('keydown', (e) => {
        const d = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
        if (d) { e.preventDefault(); knobSet(el, +el.dataset.value + d * +el.dataset.step); }
      });
    });
  }

  function selSet(el, v, fire = true) {
    const pos = JSON.parse(el.dataset.positions);
    const p = pos.find(([x]) => String(x) === String(v)) ?? pos[0];
    el.dataset.value = p[0];
    el.querySelector('.sel-knob').style.transform = `rotate(${p[1]}deg)`;
    el.querySelectorAll('.sel-pos').forEach((t) => t.classList.toggle('on', t.dataset.pos === String(p[0])));
    if (fire) hooks.control(el.dataset.ref, p[0]);
  }

  function bindSelectors() {
    root.querySelectorAll('.cp-sel').forEach((el) => {
      selSet(el, el.dataset.value, false);
      const pos = () => JSON.parse(el.dataset.positions).map(([x]) => String(x));
      el.addEventListener('click', (e) => {
        const t = e.target.closest('[data-pos]');
        if (t) return selSet(el, t.dataset.pos);
        const p = pos(), i = p.indexOf(el.dataset.value);
        selSet(el, p[(i + 1) % p.length]);
      });
      el.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const p = pos(), i = p.indexOf(el.dataset.value);
        selSet(el, p[clamp(i + d, 0, p.length - 1)]);
      });
    });
  }

  function leverSet(v) {
    const el = refs.lever;
    el.querySelector('.lv-handle').style.transform = `translateY(${-v * 20}px)`;
    el.setAttribute('aria-valuenow', v);
    el.classList.toggle('moving', v !== 0);
    hooks.lever(v);
  }

  function bindLever() {
    const el = refs.lever;
    let held = false;
    const at = (e) => {
      const r = el.querySelector('svg').getBoundingClientRect();
      const y = (e.clientY - r.top) / r.height;
      return y < 0.42 ? 1 : y > 0.58 ? -1 : 0;
    };
    el.addEventListener('pointerdown', (e) => { held = true; el.setPointerCapture(e.pointerId); e.preventDefault(); el.focus(); leverSet(at(e)); });
    el.addEventListener('pointermove', (e) => { if (held) { const v = at(e); if (v !== +el.getAttribute('aria-valuenow')) leverSet(v); } });
    const release = () => { if (held) { held = false; leverSet(0); } };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('keydown', (e) => {
      const d = { ArrowUp: 1, ArrowDown: -1 }[e.key];
      if (d && !e.repeat) { e.preventDefault(); leverSet(d); }
    });
    el.addEventListener('keyup', (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') leverSet(0); });
    el.addEventListener('blur', () => leverSet(0));
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) {
      const act = b.dataset.act;
      if (act === 'ack') Object.values(ann).forEach((a) => { if (a.state === 'alert') a.state = a.on ? 'ack' : 'off'; });
      else if (act === 'annreset') Object.values(ann).forEach((a) => { if (!a.on) a.state = 'off'; });
      else hooks.action(act);
      paint(true);
      return;
    }
    const sp = e.target.closest('[data-speed]');
    if (sp) { hooks.speed(+sp.dataset.speed); paint(true); return; }
    const pump = e.target.closest('[data-pump]');
    if (pump) { hooks.pump(+pump.dataset.pump); paint(true); }
  });
  root.addEventListener('keydown', (e) => {
    const pump = e.target.closest?.('[data-pump]');
    if (pump && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); hooks.pump(+pump.dataset.pump); paint(true); }
  });

  // ---------- output ----------

  function setGauge(el, v, text) {
    const min = +el.dataset.min, max = +el.dataset.max, log = el.dataset.log === '1';
    const x = log ? Math.log10(Math.max(v, 1e-30)) : v;
    const a = 150 + 240 * clamp((x - min) / (max - min), -0.03, 1.03);
    el.querySelector('.g-needle').style.transform = `rotate(${a}deg)`;
    el.querySelector('[data-dig]').textContent = text;
  }

  function setEdge(el, v, text, set = null) {
    const min = +el.dataset.min, max = +el.dataset.max;
    const y = (u) => 110 - 100 * clamp((u - min) / (max - min), -0.04, 1.04);
    el.querySelector('[data-ptr]').setAttribute('transform', `translate(0 ${y(v).toFixed(1)})`);
    const s = el.querySelector('[data-set]');
    s.style.display = set === null ? 'none' : '';
    if (set !== null) s.setAttribute('transform', `translate(0 ${y(set).toFixed(1)})`);
    el.querySelector('[data-dig]').textContent = text;
  }

  const sciTxt = (x, d = 1) => { const e = Math.floor(Math.log10(x)); return `${(x / 10 ** e).toFixed(d)}E${e >= 0 ? '+' : ''}${e}`; };

  function annunciate(P, s) {
    const c = P.ctl;
    const sig = P.signals;
    const cond = {
      rxTrip: P.trip.latched, turbTrip: turbWas.tripped, sr: sig.has('sr'), ir: sig.has('ir'), prLow: sig.has('prLow'), prHigh: sig.has('prHigh'),
      prRate: sig.has('prRate'), otdt: sig.has('otdt'), pzrHigh: P.Ppzr > 2310, pzrLow: P.hot && P.Ppzr < 2185, flow: P.flow.some((f) => f < 0.9),
      sur: P.sur > 1, tdev: P.hot && s.running && Math.abs(P.Tavg - P.Tref) > 5, rwb: P.withdrawBlocked(c.rodMode === 'auto'),
      dil: c.makeup === 'dilute', dump: P.q.dump > 0.05 * P.spec.MWt, sgsv: P.q.safety > 1, sglvl: Math.abs(P.sgLevel - 50) > 10,
      auto: c.rodMode === 'auto', gen: c.latched && P.load > 0.005, P6: P.P6, P7: P.P7, P10: P.P10, C5: P.C5,
    };
    for (const [k, a] of Object.entries(ann)) {
      const on = !!cond[k] && s.running;
      const status = a.el.classList.contains('status');
      if (status) a.state = on ? 'ack' : 'off';
      else if (on && !a.on && a.state === 'off') a.state = 'alert';
      else if (!on && a.state === 'ack') a.state = 'off';
      a.on = on;
      a.el.classList.toggle('alert', a.state === 'alert');
      a.el.classList.toggle('lit', a.state === 'ack' || (a.state === 'alert'));
    }
    refs.firstout.textContent = P.trip.latched ? `FIRST OUT: ${TRIPS[P.trip.firstOut].toUpperCase()}` : '';
  }

  /** Redraw everything from the plant (throttled unless forced). */
  function paint(force = false) {
    if (!state?.plant) return;
    const now = performance.now();
    if (!force && now - last < 70) return;
    last = now;
    const s = state, P = s.plant, c = P.ctl;
    if (c.latched) turbWas.latched = true;
    if (turbWas.latched && !c.latched) { turbWas.latched = false; turbWas.tripped = true; }
    if (c.latched) turbWas.tripped = false;
    root.classList.toggle('running', s.running);
    root.classList.toggle('tripped', P.trip.latched);
    refs.idle.hidden = s.running;
    refs.idleText.textContent = s.ready ? 'Start it here, or with ▶ Run the reactor above. The meters then follow the core over seconds to hours.' : 'Working out the core first…';
    root.querySelectorAll('.cp-idle [data-act="run"]').forEach((b) => { b.disabled = !s.ready; });
    root.querySelector('.cp-run').textContent = s.running ? '■ Stop' : '▶ Run';
    root.querySelector('.cp-run').disabled = !s.running && !s.ready;
    refs.clock.textContent = `t = ${P.t < 600 ? `${P.t.toFixed(0)} s` : P.t < 7200 ? `${(P.t / 60).toFixed(1)} min` : `${(P.t / 3600).toFixed(2)} h`}`;
    refs.speed.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === s.speed));

    // Nuclear instruments.
    const sr = P.srCps;
    setGauge(refs.sr, Math.max(sr, 1), P.srEnergized ? (sr < 1e4 ? `${sr.toFixed(sr < 10 ? 1 : 0)} cps` : `${sciTxt(sr)} cps`) : 'HV OFF');
    refs.sr.classList.toggle('dead', !P.srEnergized);
    setGauge(refs.ir, P.irAmps, `${sciTxt(P.irAmps)} A`);
    setGauge(refs.pr, 100 * P.frac, `${(100 * P.frac).toFixed(P.frac < 0.1 ? 2 : 1)} %`);
    const sur = s.running && Math.abs(P.sur) >= 0.005 ? P.sur : 0;
    setGauge(refs.sur, sur, `${sur >= 0 ? '+' : ''}${sur.toFixed(2)} DPM`);
    refs.rho.textContent = s.rho == null ? 'ρ —' : `ρ ${s.rho >= 0 ? '+' : '−'}${Math.abs(s.rho * 1e5).toFixed(0)} pcm`;
    refs.dollars.textContent = s.rho == null ? '$ —' : `${s.rho >= 0 ? '+' : '−'}${Math.abs(s.rho / s.beta).toFixed(3)} $`;
    refs.keff.textContent = s.k == null ? 'k —' : `k ${s.k.toFixed(5)}`;

    // Coolant and steam.
    setEdge(refs.tavg, P.Tavg, `${P.Tavg.toFixed(1)}`, P.Tref);
    setEdge(refs.thot, P.Thot, `${P.Thot.toFixed(1)}`);
    setEdge(refs.tcold, P.Tcold, `${P.Tcold.toFixed(1)}`);
    setEdge(refs.ppzr, P.Ppzr, `${P.Ppzr.toFixed(0)}`, 2235);
    setEdge(refs.lpzr, P.pzrLevel, `${P.pzrLevel.toFixed(1)}`, P.hot ? P.pzrLevelProgram : null);
    setEdge(refs.psg, P.steamPsig, `${P.steamPsig.toFixed(0)}`);
    setEdge(refs.lsg, P.sgLevel, `${P.sgLevel.toFixed(1)}`, 50);
    setEdge(refs.mwe, P.MWe, `${P.MWe.toFixed(0)}`);

    // Rods.
    const steps = Math.round((1 - s.rods) * P.steps);
    refs.steps.textContent = String(steps).padStart(3, '0');
    refs.drpi.querySelectorAll('.drpi-col').forEach((col) => {
      const moving = !s.banks || s.banks.includes(col.dataset.bank);
      const out = moving ? 1 - s.rods : 1;
      col.querySelectorAll('i').forEach((led, i, all) => {
        const n = all.length - 1 - i; // bottom LED is 0
        led.className = n === 0 ? (out < 0.02 ? 'bot' : '') : out * (all.length - 1) >= n - 0.5 ? 'on' : '';
      });
    });
    refs.lever.classList.toggle('blocked', P.withdrawBlocked());

    // Makeup.
    refs.boron.textContent = P.boron.toFixed(0);
    const rate = c.makeup === 'dilute' ? -P.boron * (c.gpm / P.spec.rcsGal) : c.makeup === 'borate' ? (P.spec.bat - P.boron) * (c.gpm / P.spec.rcsGal) : 0;
    refs.borRate.textContent = rate ? `${rate > 0 ? '+' : '−'}${Math.abs(rate).toFixed(1)} ppm/min · ${rate > 0 ? '+' : '−'}${Math.abs(rate * P.boronWorth * 1e5).toFixed(0)} pcm/min` : 'makeup stopped';

    // Turbine and generator.
    refs.load.textContent = `${(100 * P.load).toFixed(1)} %`;
    root.querySelector('[data-act="latch"]').classList.toggle('lit', c.latched);
    root.querySelector('[data-act="turbtrip"]').classList.toggle('lit', !c.latched);
    refs.rpm.className = `cp-lamp ${c.latched ? 'red' : 'green'}`;
    refs.rpm.textContent = c.latched ? '1800 RPM' : 'TURNING GEAR';
    const ks = root.querySelector('[data-ref="loadSet"]');
    if (+ks.dataset.value !== c.loadSet) knobSet(ks, c.loadSet, false);

    // Pumps: red is running, green is stopped (US convention).
    root.querySelectorAll('[data-pump]').forEach((el) => {
      const i = +el.dataset.pump, on = c.pumps[i];
      el.classList.toggle('on', on);
      el.setAttribute('aria-checked', on);
      el.querySelector('.cp-led.r').classList.toggle('lit', P.flow[i] > 0.5);
      el.querySelector('.cp-led.g').classList.toggle('lit', P.flow[i] <= 0.5);
    });

    // Protection.
    refs.rta.className = refs.rtb.className = `cp-lamp ${P.trip.latched ? 'green' : 'red'}`;
    root.querySelector('[data-act="trip"]').classList.toggle('lit', P.trip.latched);
    const sb = root.querySelector('[data-act="srblock"]'), pb = root.querySelector('[data-act="prblock"]');
    sb.classList.toggle('lit', c.srBlock); sb.disabled = !P.P6 && !c.srBlock;
    pb.classList.toggle('lit', c.prBlock); pb.disabled = !P.P10 && !c.prBlock;
    annunciate(P, s);

    // Mimic.
    const lg = Math.log10(Math.max(P.frac, 1e-14));
    refs.mCore.style.opacity = clamp((lg + 9) / 9, 0.08, 1).toFixed(2);
    refs.mRods.querySelectorAll('line').forEach((l) => l.setAttribute('y2', (52 + 44 * s.rods).toFixed(1)));
    const warm = clamp((P.Thot - 540) / 90, 0, 1);
    refs.mHot.style.stroke = `rgb(${200 + 55 * warm}, ${120 - 80 * warm}, ${80 - 50 * warm})`;
    refs.mPump.classList.toggle('spin', P.flowFrac > 0.3);
    refs.mPzr.setAttribute('y', (60 + 33 * (1 - P.pzrLevel / 100)).toFixed(1));
    refs.mPzr.setAttribute('height', (33 * P.pzrLevel / 100).toFixed(1));
    refs.mSg.setAttribute('y', (70 + 60 * (1 - P.sgLevel / 100)).toFixed(1));
    refs.mSg.setAttribute('height', (60 * P.sgLevel / 100).toFixed(1));
    refs.mDump.classList.toggle('open', P.q.dump > 1 || P.q.safety > 1);
    refs.mTurb.classList.toggle('on', c.latched);
    refs.mGen.classList.toggle('on', P.MWe > 1);
    refs.mOut.classList.toggle('on', P.MWe > 1);
    refs.mSteam.classList.toggle('on', P.steamPsig > 100);
    const pct = 100 * P.frac;
    refs.vPwr.textContent = `${pct >= 0.01 ? `${pct.toFixed(pct < 10 ? 2 : 1)}%` : `${sciTxt(Math.max(pct, 1e-12))}%`} · ${P.heat < 10 ? P.heat.toFixed(1) : P.heat.toFixed(0)} MWt`;
    refs.vHot.textContent = `${P.Thot.toFixed(0)}°F`;
    refs.vCold.textContent = `${P.Tcold.toFixed(0)}°F`;
    refs.vPzr.textContent = `${P.Ppzr.toFixed(0)} psig`;
    refs.vSteam.textContent = `${P.steamPsig.toFixed(0)} psig`;
    refs.vRpm.textContent = c.latched ? `${(100 * P.load).toFixed(0)}% load` : 'tripped';
    refs.vMwe.textContent = `${P.MWe.toFixed(0)} MWe`;
    refs.vMode.textContent = P.trip.latched ? 'REACTOR TRIPPED' : P.frac > 0.02 ? 'POWER OPERATION' : s.k != null && s.k >= 0.9995 && P.frac > 1e-9 ? 'CRITICAL · STARTUP' : P.hot ? 'HOT STANDBY' : 'COLD SHUTDOWN';
  }

  return {
    /** Show the panel for this plant (rebuilding it when the design changes). */
    update(s) {
      state = s;
      if (!s.plant) return;
      if (design !== s.plant.design) { build(s.plant.design, s.plant); last = 0; }
      if (plant !== s.plant) {
        plant = s.plant;
        turbWas.latched = plant.ctl.latched; turbWas.tripped = false;
        Object.values(ann).forEach((a) => { a.state = 'off'; a.on = false; });
      }
      if (s.syncControls) {
        const c = s.plant.ctl;
        selSet(root.querySelector('[data-ref="rodMode"]'), c.rodMode, false);
        selSet(root.querySelector('[data-ref="makeup"]'), c.makeup, false);
        selSet(root.querySelector('[data-ref="loadRate"]'), c.loadRate, false);
        knobSet(root.querySelector('[data-ref="gpm"]'), c.gpm, false);
        knobSet(root.querySelector('[data-ref="loadSet"]'), c.loadSet, false);
      }
      paint(!!s.syncControls);
    },
  };
}
