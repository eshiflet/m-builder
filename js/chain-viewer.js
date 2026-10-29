// The chain-reaction view: a ball of fuel (optionally inside a reflector) and the neutrons
// multiplying through it, simulated in real units (cm, ns) and played back slowed down.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { nextEvent, collide, speed, rng, pointInFuel, FISSION_MEV } from './chain.js';

const CAP = 1200; // tracked neutrons; above this, half are dropped and the rest count double
const SEGMENTS = 9000; // finished track segments kept for the fading trails
const FLASHES = 160;
const DOTS = 5000; // fuel dots
const REF_DOTS = 2200;
const TRAIL_FADE = 1.6; // seconds of real time
const MAX_EVENTS = 40000; // per frame; beyond this the clock slows to keep up

export const NUCLIDE_COLORS = { U235: '#ffc94d', U238: '#7d8aa6', Pu239: '#7ee08a' };
export const REFLECTOR_COLORS = { natU: '#8a93a8', Be: '#b9d6c4', water: '#4d8dff' };
export const SPENT_COLOR = '#c2452f';

/** Neutron color by energy: fast white-cyan, intermediate sky blue, thermal deep blue. */
function neutronColor(E, c) {
  const t = Math.max(0, Math.min(1, (Math.log10(E) + 7.6) / 7.6)); // thermal (2.5e-8) → 1 MeV
  return c.setRGB(0.25 + 0.7 * t * t, 0.45 + 0.5 * t, 1);
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(16, 16, 14, 0, 2 * Math.PI); ctx.fill();
  return new THREE.CanvasTexture(c);
}

export class ChainViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
    this.camera.position.set(0, -10, 40);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.5;
    this.scene.add(new THREE.HemisphereLight('#e8eeff', '#1a1e2c', 1.2));
    const key = new THREE.DirectionalLight('#ffffff', 1.6);
    key.position.set(3, 4, 6);
    this.camera.add(key);
    this.scene.add(this.camera);

    this.clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    this.cutaway = false;
    this.glowTex = glowTexture();
    this.dotTex = dotTexture();
    this.clock = new THREE.Clock();
    this.speed = 1; // simulated ns per real second
    this.paused = false;
    this.sys = null;
    this.run = null;
    this.onStats = null; // (stats) each few frames while running
    this.onMilestone = null; // (html) notable moments, for the caption log
    this.onEnd = null;
    this.onPick = null; // (fission) when a recent fission flash is clicked
    this.realT = 0;

    this.#buildBuffers();
    this.#bindPick();
    new ResizeObserver(() => this.#resize()).observe(container);
    this.#resize();
  }

  setActive(on) {
    this.renderer.setAnimationLoop(on ? () => this.#tick() : null);
    if (on) { this.clock.getDelta(); this.#resize(); }
  }

  setAutoRotate(on) { this.controls.autoRotate = on; }

  setCutaway(on) {
    this.cutaway = on;
    for (const m of this.clipped) m.clippingPlanes = on ? [this.clip] : [];
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  fit() {
    if (!this.sys) return;
    const R = this.sys.R2;
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (1.25 * R) / Math.sin(Math.min(fov, fov * this.camera.aspect) / 2);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir.multiplyScalar(dist));
    this.camera.near = dist / 100; this.camera.far = dist * 10;
    this.camera.updateProjectionMatrix();
  }

  // ---------- scene ----------

  #buildBuffers() {
    this.clipped = [];
    const pointsMat = (size, opts = {}) => new THREE.PointsMaterial({
      size, sizeAttenuation: false, vertexColors: true, map: this.dotTex, alphaTest: 0.5, transparent: false, ...opts,
    });
    // Fuel and reflector dots.
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DOTS * 3), 3));
    dg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(DOTS * 3), 3));
    this.dots = new THREE.Points(dg, pointsMat(3.2));
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(REF_DOTS * 3), 3));
    rg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(REF_DOTS * 3), 3));
    this.refDots = new THREE.Points(rg, pointsMat(2.2, { opacity: 0.6 }));
    this.clipped.push(this.dots.material, this.refDots.material);
    this.scene.add(this.dots, this.refDots);
    // Surfaces.
    const shell = (color, opacity) => {
      const m = new THREE.MeshStandardMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, roughness: 0.6 });
      this.clipped.push(m);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), m);
      this.scene.add(mesh);
      return mesh;
    };
    this.fuelShell = shell('#ffcf6b', 0.06);
    this.refShell = shell('#8a93a8', 0.1);
    // Neutrons.
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 2 * 3), 3));
    ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(CAP * 2 * 3), 3));
    this.neutronPts = new THREE.Points(ng, new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, map: this.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.neutronPts.renderOrder = 3;
    // Trails: finished segments (fading) and the segment each live neutron is flying now.
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEGMENTS * 6), 3));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SEGMENTS * 6), 3));
    this.trails = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.segBorn = new Float32Array(SEGMENTS).fill(-1e9);
    this.segBase = new Float32Array(SEGMENTS * 3);
    this.segHead = 0;
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 2 * 6), 3));
    hg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(CAP * 2 * 6), 3));
    this.heads = new THREE.LineSegments(hg, this.trails.material);
    this.scene.add(this.trails, this.heads, this.neutronPts);
    // Fission flashes, each with two fragments flying apart.
    this.flashes = [];
    const fragMat = new THREE.SpriteMaterial({ map: this.glowTex, color: '#ff8a4d', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let i = 0; i < FLASHES; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: '#fff2c4', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      const a = new THREE.Sprite(fragMat.clone()), b = new THREE.Sprite(fragMat.clone());
      [s, a, b].forEach((x) => { x.visible = false; x.renderOrder = 4; this.scene.add(x); });
      this.flashes.push({ s, a, b, born: -1e9, dir: new THREE.Vector3(), p: new THREE.Vector3() });
    }
    this.flashNext = 0;
    this.pickable = []; // recent fissions: { p, nuclide, E, t }
  }

  /** Lay out the fuel ball (and reflector) for a system from chain.js. */
  setSystem(sys) {
    const resized = !this.sys || Math.abs(this.sys.R2 - sys.R2) > 1e-6;
    this.stop();
    this.sys = sys;
    const r = rng(12345);
    const c = new THREE.Color();
    // Fuel dots: each colored by which nuclide it stands for.
    const pos = this.dots.geometry.attributes.position.array, col = this.dots.geometry.attributes.color.array;
    const parts = sys.fuelMat.parts, total = parts.reduce((s, p) => s + p.N, 0);
    this.dotKind = new Array(DOTS);
    for (let i = 0; i < DOTS; i++) {
      const p = pointInFuel(sys, r);
      pos.set(p, 3 * i);
      let x = r() * total, k = parts[parts.length - 1].key;
      for (const q of parts) { if ((x -= q.N) <= 0) { k = q.key; break; } }
      this.dotKind[i] = k;
      c.set(NUCLIDE_COLORS[k]).toArray(col, 3 * i);
    }
    this.dotBase = col.slice();
    this.dots.geometry.attributes.position.needsUpdate = this.dots.geometry.attributes.color.needsUpdate = true;
    this.dots.geometry.computeBoundingSphere();
    this.#buildGrid(pos);
    // Reflector: sparser dots in the shell.
    const rp = this.refDots.geometry.attributes.position.array, rc = this.refDots.geometry.attributes.color.array;
    const has = !!sys.refMat;
    this.refDots.visible = this.refShell.visible = has;
    if (has) {
      c.set(REFLECTOR_COLORS[sys.reflector]);
      for (let i = 0; i < REF_DOTS; i++) {
        const u = Math.cbrt(sys.R ** 3 + r() * (sys.R2 ** 3 - sys.R ** 3));
        const z = 2 * r() - 1, ph = 2 * Math.PI * r(), s = Math.sqrt(1 - z * z);
        rp.set([u * s * Math.cos(ph), u * s * Math.sin(ph), u * z], 3 * i);
        c.toArray(rc, 3 * i);
      }
      this.refDots.geometry.attributes.position.needsUpdate = this.refDots.geometry.attributes.color.needsUpdate = true;
      this.refDots.geometry.computeBoundingSphere();
      this.refShell.scale.setScalar(sys.R2);
      this.refShell.material.color.set(REFLECTOR_COLORS[sys.reflector]);
    }
    this.fuelShell.scale.setScalar(sys.R);
    if (resized) this.fit();
  }

  /** Uniform grid over the fuel dots, to find the dot nearest a fission. */
  #buildGrid(pos) {
    const R = this.sys.R, n = 14, cell = (2 * R) / n;
    this.grid = { n, cell, R, bins: Array.from({ length: n ** 3 }, () => []) };
    for (let i = 0; i < DOTS; i++) this.grid.bins[this.#bin(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2])].push(i);
  }

  #bin(x, y, z) {
    const { n, cell, R } = this.grid;
    const f = (v) => Math.max(0, Math.min(n - 1, Math.floor((v + R) / cell)));
    return f(x) + n * (f(y) + n * f(z));
  }

  /** The nearest unspent dot of a nuclide near p (searching the bin and its neighbors). */
  #nearestDot(p, nuclide) {
    const { n, cell, R } = this.grid, pos = this.dots.geometry.attributes.position.array;
    const f = (v) => Math.max(0, Math.min(n - 1, Math.floor((v + R) / cell)));
    const bx = f(p[0]), by = f(p[1]), bz = f(p[2]);
    let best = -1, bd = Infinity;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = bx + dx, y = by + dy, z = bz + dz;
      if (x < 0 || y < 0 || z < 0 || x >= n || y >= n || z >= n) continue;
      for (const i of this.grid.bins[x + n * (y + n * z)]) {
        if (this.spent[i] || this.dotKind[i] !== nuclide) continue;
        const d = (pos[3 * i] - p[0]) ** 2 + (pos[3 * i + 1] - p[1]) ** 2 + (pos[3 * i + 2] - p[2]) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  // ---------- running a chain ----------

  /**
   * Start a chain: `count` neutrons of energy E fly in from outside, aimed at random
   * points of the fuel. Returns nothing; progress comes through onStats/onMilestone/onEnd.
   */
  start(count = 1, seed = (Math.random() * 2 ** 31) | 0, E = 2) {
    if (!this.sys) return;
    this.stop();
    const r = rng(seed), sys = this.sys;
    this.r = r;
    this.spent = new Uint8Array(DOTS);
    this.dots.geometry.attributes.color.array.set(this.dotBase);
    this.dots.geometry.attributes.color.needsUpdate = true;
    const neutrons = [];
    for (let i = 0; i < count; i++) {
      const target = pointInFuel(sys, r);
      const z = 2 * r() - 1, ph = 2 * Math.PI * r(), s = Math.sqrt(1 - z * z);
      const from = [1.6 * sys.R2 * s * Math.cos(ph), 1.6 * sys.R2 * s * Math.sin(ph), 1.6 * sys.R2 * z];
      const d = [target[0] - from[0], target[1] - from[1], target[2] - from[2]];
      const L = Math.hypot(...d);
      neutrons.push(this.#spawn({ p: from, d: d.map((v) => v / L), E, region: -1, gen: 0 }, 0));
    }
    this.run = {
      T: 0, W: 1, neutrons, gen: [count], genAlive: [count], fissions: 0, captures: 0, escapes: 0, born: count,
      fissionBy: {}, capturedBy: {}, peak: count, done: false, reason: null, milestones: new Set(), lagging: false, frames: 0,
      startCount: count, seed, firstFissionT: null,
    };
    this.pickable = [];
    this.flashes.forEach((f) => { f.born = -1e9; f.s.visible = f.a.visible = f.b.visible = false; });
    this.segBorn.fill(-1e9);
    this.onMilestone?.(`${count === 1 ? 'One neutron' : `${count} neutrons`} at ${E} MeV ${count === 1 ? 'flies' : 'fly'} into ${sys.refMat ? `the ${sys.refMat.name.toLowerCase()} reflector` : 'the bare ball of fuel'}.`);
    this.#emitStats(true);
  }

  #surfaceEntry(from, d) {
    // Where the incoming ray first meets the outer surface.
    const R = this.sys.R2;
    const b = from[0] * d[0] + from[1] * d[1] + from[2] * d[2];
    const c = from[0] ** 2 + from[1] ** 2 + from[2] ** 2 - R * R;
    const s = -b - Math.sqrt(Math.max(0, b * b - c));
    return [from[0] + d[0] * (s + 1e-4), from[1] + d[1] * (s + 1e-4), from[2] + d[2] * (s + 1e-4)];
  }

  stop() {
    this.run = null;
    this.#clearNeutrons();
  }

  get running() { return !!this.run && !this.run.done; }

  #spawn(n, t) {
    const nn = { ...n, t0: t, alive: true };
    this.#plan(nn);
    return nn;
  }

  /** Work out the next event of neutron n (its time and where). */
  #plan(n) {
    // Region −1: still flying in from outside, toward the outer surface.
    const ev = n.region < 0
      ? (() => { const point = this.#surfaceEntry(n.p, n.d); return { kind: 'cross', s: Math.hypot(point[0] - n.p[0], point[1] - n.p[1], point[2] - n.p[2]), point, region: this.sys.refMat ? 1 : 0 }; })()
      : nextEvent(this.sys, n, this.r);
    n.ev = ev;
    n.v = speed(n.E);
    n.tEnd = n.t0 + ev.s / n.v;
  }

  #segment(a, b, E) {
    const i = this.segHead;
    this.segHead = (i + 1) % SEGMENTS;
    const pos = this.trails.geometry.attributes.position.array;
    pos.set(a, 6 * i); pos.set(b, 6 * i + 3);
    neutronColor(E, this.tmpC ??= new THREE.Color()).toArray(this.segBase, 3 * i);
    this.segBorn[i] = this.realT;
  }

  #flash(p, fragmentsToo = true) {
    const f = this.flashes[this.flashNext];
    this.flashNext = (this.flashNext + 1) % FLASHES;
    f.born = this.realT;
    f.p.set(...p);
    f.dir.set(this.r() - 0.5, this.r() - 0.5, this.r() - 0.5).normalize();
    f.frag = fragmentsToo;
    f.s.position.copy(f.p);
    f.s.visible = true;
    f.a.visible = f.b.visible = fragmentsToo;
  }

  /** Advance the simulation to time T (ns), handling every event on the way. */
  #advance(T) {
    const run = this.run, sys = this.sys;
    let events = 0;
    const list = run.neutrons;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      while (n.alive && n.tEnd <= T) {
        if (++events > MAX_EVENTS) { run.lagging = true; return false; }
        const ev = n.ev, start = n.p;
        n.p = ev.point;
        this.#segment(start, n.p, n.E);
        const t = n.tEnd;
        if (ev.kind === 'escape') { this.#end(n, 'escape'); continue; }
        if (ev.kind === 'cross') { n.region = ev.region; n.t0 = t; this.#plan(n); continue; }
        const res = collide(sys, n, this.r);
        if (res.kind === 'fission' || res.kind === 'capture') {
          this.#end(n, res.kind, res.nuclide);
          if (res.kind === 'fission') {
            run.fissions += run.W;
            run.fissionBy[res.nuclide] = (run.fissionBy[res.nuclide] ?? 0) + run.W;
            if (run.firstFissionT == null) {
              run.firstFissionT = t;
              this.onMilestone?.(`<b>First fission</b> after ${t.toFixed(2)} ns: a ${res.nuclide.replace(/\d+/, (m) => '-' + m)} nucleus splits and frees ${res.out.length} neutrons.`);
            }
            this.#flash(n.p);
            this.pickable.push({ p: n.p, nuclide: res.nuclide, E: res.E, t: this.realT });
            if (this.pickable.length > 400) this.pickable.splice(0, 100);
            if (n.region === 0) {
              const k = this.#nearestDot(n.p, res.nuclide);
              if (k >= 0) { this.spent[k] = 1; new THREE.Color(SPENT_COLOR).toArray(this.dots.geometry.attributes.color.array, 3 * k); this.dots.geometry.attributes.color.needsUpdate = true; }
            }
            const g = n.gen + 1;
            run.gen[g] = (run.gen[g] ?? 0) + run.W * res.out.length;
            run.genAlive[g] = (run.genAlive[g] ?? 0) + res.out.length;
            run.born += run.W * res.out.length;
            for (const o of res.out) list.push(this.#spawn({ ...o, gen: g }, t));
          }
          continue;
        }
        // A scatter (or (n,2n), which adds a neutron of the same generation).
        Object.assign(n, res.out[0]);
        n.t0 = t;
        this.#plan(n);
        if (res.out[1]) {
          run.genAlive[n.gen]++;
          run.gen[n.gen] += run.W;
          run.born += run.W;
          list.push(this.#spawn({ ...res.out[1], gen: n.gen }, t));
        }
      }
    }
    run.lagging = false;
    return true;
  }

  #end(n, how, nuclide) {
    const run = this.run;
    n.alive = false;
    if (how === 'escape') {
      run.escapes += run.W;
      if (!run.milestones.has('escape')) { run.milestones.add('escape'); this.onMilestone?.('A neutron <b>escapes</b> through the surface. Leakage like this is what a ball too small can’t make up for.'); }
    }
    if (how === 'capture') {
      run.captures += run.W;
      run.capturedBy[nuclide] = (run.capturedBy[nuclide] ?? 0) + run.W;
      if (!run.milestones.has('capture')) { run.milestones.add('capture'); this.onMilestone?.(`A neutron is <b>captured</b> by ${nuclide.replace(/\d+/, (m) => '-' + m)} without splitting it: lost to the chain.`); }
    }
    run.genAlive[n.gen]--;
  }

  /** Russian roulette: past CAP neutrons, keep each with probability ½ and double the weight. */
  #thin() {
    const run = this.run;
    let alive = run.neutrons.filter((n) => n.alive);
    while (alive.length > CAP) {
      alive = alive.filter((n) => {
        if (this.r() < 0.5) return true;
        n.alive = false;
        run.genAlive[n.gen]--;
        return false;
      });
      run.W *= 2;
      if (!run.milestones.has('thin')) { run.milestones.add('thin'); this.onMilestone?.(`Over ${CAP.toLocaleString()} neutrons in flight: from now on each one drawn stands for several (shown below the view).`); }
    }
    run.neutrons = alive;
  }

  #clearNeutrons() {
    this.neutronPts.geometry.setDrawRange(0, 0);
    this.heads.geometry.setDrawRange(0, 0);
  }

  #emitStats(force = false) {
    const run = this.run;
    if (!run || (!force && run.frames % 6)) return;
    const alive = run.neutrons.filter((n) => n.alive).length;
    // k from finished generations. Generation g's count is final once every neutron of
    // the generations before it is gone; each count ÷ the one before is a measurement of k.
    let m = 0;
    while (m < run.genAlive.length && run.genAlive[m] === 0) m++;
    const ratios = [];
    for (let g = 1; g <= Math.min(m, run.gen.length - 1); g++) if (run.gen[g - 1] > 0) ratios.push(run.gen[g] / run.gen[g - 1]);
    const recent = ratios.slice(-6);
    // Milestones as the population passes each factor of a thousand.
    const pop = alive * run.W;
    for (const [n, word] of [[1e3, 'a thousand'], [1e6, 'a million'], [1e9, 'a billion'], [1e12, 'a trillion'], [1e15, 'a quadrillion']]) {
      if (pop >= n && !run.milestones.has(word)) {
        run.milestones.add(word);
        this.onMilestone?.(`<b>Over ${word} neutrons</b> in flight after ${fmtTime(run.T)} (generation ${run.gen.length - 1}).`);
      }
    }
    const kLive = recent.length >= 2 ? recent.reduce((a, b) => a * b, 1) ** (1 / recent.length) : null;
    this.onStats?.({
      T: run.T, W: run.W, alive, inFlight: alive * run.W, fissions: run.fissions, captures: run.captures, escapes: run.escapes,
      gen: run.gen, kLive, done: run.done, reason: run.reason, lagging: run.lagging, energyMeV: run.fissions * FISSION_MEV,
      fissionBy: run.fissionBy, capturedBy: run.capturedBy, burn: run.fissions / this.sys.fissileAtoms,
    });
  }

  #finish(reason) {
    const run = this.run;
    run.done = true; run.reason = reason;
    this.onMilestone?.(reason === 'died'
      ? `The chain <b>died out</b> after ${run.gen.length - 1} generation${run.gen.length === 2 ? '' : 's'} and ${fmtTime(run.T)}.`
      : reason === 'runaway'
        ? `Stopped after ${fmtTime(run.T)}: ${(100 * run.fissions / this.sys.fissileAtoms).toFixed(1)}% of the fuel has split. A real core would have blown itself apart long before this (the heat makes it expand, and the gaps let neutrons leak out), which ends the chain.`
        : `Stopped at ${fmtTime(run.T)}.`);
    this.#emitStats(true);
    this.onEnd?.(reason);
  }

  // ---------- frame loop ----------

  #tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.realT += dt;
    this.controls.update();
    if (this.cutaway) {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.clip.setFromNormalAndCoplanarPoint(dir, this.controls.target);
    }
    const run = this.run;
    if (run && !run.done && !this.paused) {
      const goal = run.T + dt * this.speed;
      if (this.#advance(goal)) run.T = goal;
      else run.T += (goal - run.T) * 0.25; // too many events: let the clock slip
      run.frames++;
      this.#thin();
      if (!run.neutrons.length) this.#finish('died');
      else if (run.fissions >= 0.01 * this.sys.fissileAtoms) this.#finish('runaway');
      else if (run.T > 2e7) this.#finish('time');
      this.#emitStats();
    }
    this.#draw();
    this.renderer.render(this.scene, this.camera);
  }

  #draw() {
    const run = this.run;
    // Live neutrons and the segment each is flying.
    const np = this.neutronPts.geometry.attributes.position.array, nc = this.neutronPts.geometry.attributes.color.array;
    const hp = this.heads.geometry.attributes.position.array, hc = this.heads.geometry.attributes.color.array;
    const c = this.tmpC ??= new THREE.Color();
    let k = 0;
    if (run) {
      for (const n of run.neutrons) {
        if (!n.alive || k >= CAP * 2) continue;
        const s = Math.max(0, (Math.min(run.T, n.tEnd) - n.t0) * n.v);
        const x = n.p[0] + n.d[0] * s, y = n.p[1] + n.d[1] * s, z = n.p[2] + n.d[2] * s;
        np[3 * k] = x; np[3 * k + 1] = y; np[3 * k + 2] = z;
        neutronColor(n.E, c).toArray(nc, 3 * k);
        hp.set(n.p, 6 * k); hp[6 * k + 3] = x; hp[6 * k + 4] = y; hp[6 * k + 5] = z;
        c.multiplyScalar(0.8).toArray(hc, 6 * k); c.toArray(hc, 6 * k + 3);
        k++;
      }
    }
    this.neutronPts.geometry.setDrawRange(0, k);
    this.heads.geometry.setDrawRange(0, 2 * k);
    this.neutronPts.geometry.attributes.position.needsUpdate = this.neutronPts.geometry.attributes.color.needsUpdate = true;
    this.heads.geometry.attributes.position.needsUpdate = this.heads.geometry.attributes.color.needsUpdate = true;
    this.neutronPts.geometry.computeBoundingSphere();
    this.heads.geometry.computeBoundingSphere();
    // Fading trails.
    const tc = this.trails.geometry.attributes.color.array;
    for (let i = 0; i < SEGMENTS; i++) {
      const f = Math.max(0, 1 - (this.realT - this.segBorn[i]) / TRAIL_FADE) * 0.75;
      const r = this.segBase[3 * i] * f, g = this.segBase[3 * i + 1] * f, b = this.segBase[3 * i + 2] * f;
      tc[6 * i] = tc[6 * i + 3] = r; tc[6 * i + 1] = tc[6 * i + 4] = g; tc[6 * i + 2] = tc[6 * i + 5] = b;
    }
    this.trails.geometry.attributes.position.needsUpdate = this.trails.geometry.attributes.color.needsUpdate = true;
    this.trails.geometry.computeBoundingSphere();
    // Flashes: a bright pop, and two fragments that fly apart and fade.
    const size = this.sys ? this.sys.R2 * 0.09 : 1;
    for (const f of this.flashes) {
      const age = this.realT - f.born;
      if (age > 0.9) { if (f.s.visible) f.s.visible = f.a.visible = f.b.visible = false; continue; }
      const u = age / 0.9;
      f.s.scale.setScalar(size * (0.6 + 1.6 * Math.sqrt(u)));
      f.s.material.opacity = (1 - u) ** 2;
      if (f.frag) {
        const off = f.dir.clone().multiplyScalar(size * 1.2 * u);
        f.a.position.copy(f.p).add(off); f.b.position.copy(f.p).sub(off);
        f.a.scale.setScalar(size * 0.35); f.b.scale.setScalar(size * 0.3);
        f.a.material.opacity = f.b.material.opacity = 1 - u;
      }
    }
  }

  // ---------- picking a fission ----------

  #bindPick() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      let best = null, bd = 16 * 16;
      const v = new THREE.Vector3();
      for (const f of this.pickable) {
        if (this.realT - f.t > 6) continue;
        v.set(...f.p).project(this.camera);
        const sx = ((v.x + 1) / 2) * rect.width, sy = ((1 - v.y) / 2) * rect.height;
        const d = (sx - mx) ** 2 + (sy - my) ** 2;
        if (d < bd) { bd = d; best = f; }
      }
      if (best) this.onPick?.(best);
    });
  }
}

export function fmtTime(ns) {
  if (ns < 1) return `${(ns * 1000).toFixed(0)} ps`;
  if (ns < 1000) return `${ns < 10 ? ns.toFixed(1) : ns.toFixed(0)} ns`;
  if (ns < 1e6) return `${(ns / 1000).toFixed(ns < 1e4 ? 2 : 1)} µs`;
  return `${(ns / 1e6).toFixed(2)} ms`;
}
