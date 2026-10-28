import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NUCLEONS } from './nucleus-data.js';

// Units: femtometers (fm) and "babyseconds" (bs = 10⁻²³ s), in which light moves 3 fm/bs.
const C = 2.99792458; // fm per babysecond
const NUCLEON_MASS = 938.9; // MeV/c²
const ACC = (C * C) / NUCLEON_MASS; // acceleration (fm/bs²) per unit force (MeV/fm)
const DT = 0.05; // bs per integration step
const MAX_STEPS = 12; // per frame; beyond this the nucleon motion runs slower than the clock

// Mean field: Woods–Saxon well, U(r) = −V₀ / (1 + e^{(r − R(θ))/a}).
const V0 = 50; // MeV
// Langevin thermostat: drag γ plus random kicks, holding the mean kinetic energy near the
// Fermi-gas value (3/5)·E_F ≈ 22 MeV, i.e. kT ≈ 14.7 MeV and v_rms ≈ 0.22c.
const KT = 14.7, KT_HALO = 1.5, GAMMA = 0.4;
// Nucleon–nucleon force from the Volkov V1 potential, 144.86 e^{−(r/0.82)²} − 83.34 e^{−(r/1.6)²} MeV.
// The mean field already holds the attraction (and the measured proton radius already
// includes the Coulomb push), so only the short-range part is kept here: the full
// repulsive core scaled to 12%, and a weak 3% of the attraction.
const VR = 144.86, AR = 0.82, VA = 83.34, AA = 1.6, REP_SCALE = 0.12, ATT_SCALE = 0.03, NN_CUT = 3.2;

export const PROTON_COLOR = '#4f7dff';
export const NEUTRON_COLOR = '#fff3e3';
export const HALO_COLOR = '#7ff0ff';
export const COLOR_CHARGES = ['#ff4d6d', '#3ddc84', '#4d8dff']; // "red", "green", "blue"
// Display radius: a uniform ball with the proton's rms charge radius (0.84 fm) has
// radius √(5/3)·0.84 ≈ 1.08 fm. At nuclear density neighbors sit ~1.8 fm apart, so
// at this size they overlap, as real nucleons do.
const NUCLEON_R = 1.08;
// Pairs closer than this (center to center) are highlighted as close, short-range pairs.
const CLOSE_PAIR = 1.0;
export const PAIR_COLOR = '#ff9f43';

function textSprite(text, color, height) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '700 64px system-ui, -apple-system, sans-serif';
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(text).width) + 24;
  canvas.height = 84;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(8,10,16,0.85)';
  ctx.strokeText(text, canvas.width / 2, 44);
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, 44);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Glowing nucleons drawn as shaded sphere impostors (core pass) plus a soft additive halo.
const GLOW_VERT = /* glsl */ `
  attribute vec3 aColor;
  uniform float uScale;
  uniform float uSize;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uScale / -mv.z;
    vColor = aColor;
  }
`;
const CORE_FRAG = /* glsl */ `
  varying vec3 vColor;
  uniform float uOpacity;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d2 = dot(p, p);
    if (d2 > 1.0) discard;
    vec3 n = vec3(p.x, -p.y, sqrt(1.0 - d2));
    float diff = max(dot(n, normalize(vec3(-0.4, 0.5, 0.8))), 0.0);
    float spec = pow(max(dot(n, normalize(vec3(-0.2, 0.3, 1.0))), 0.0), 24.0);
    vec3 c = vColor * (0.35 + 0.75 * diff) + spec * 0.5;
    // Soft, glowing edge rather than a hard ball.
    float edge = smoothstep(1.0, 0.55, sqrt(d2));
    gl_FragColor = vec4(mix(vColor * 1.15, c, edge), uOpacity * (0.35 + 0.65 * edge));
  }
`;
const HALO_FRAG = /* glsl */ `
  varying vec3 vColor;
  uniform float uOpacity;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = length(p);
    if (d > 1.0) discard;
    float a = exp(-d * d * 3.0) * 0.55 * uOpacity;
    gl_FragColor = vec4(vColor * a, a);
  }
`;

export class NucleusViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(14, -22, 8);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight('#e8eeff', '#1a1e2c', 1.4));
    const key = new THREE.DirectionalLight('#ffffff', 2.4);
    key.position.set(3, 4, 6);
    this.camera.add(key);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.5;

    this.nucleusGroup = new THREE.Group();
    this.nucleonGroup = new THREE.Group(); // single proton / neutron close-up
    this.rulerGroup = new THREE.Group();
    this.scene.add(this.nucleusGroup, this.nucleonGroup, this.rulerGroup);

    this.mode = 'none';
    this.view = 'nucleus';
    this.style = 'glow';
    this.motion = true;
    this.showQuarks = false;
    this.showField = false;
    this.showRuler = true;
    this.showPairs = false;
    this.timeRate = 4; // babyseconds per real second
    this.spin = 10;
    this.t = 0; // clock, in babyseconds
    this.periods = {}; // mode → period in babyseconds
    this.clock = new THREE.Clock();
    this.onClock = null;
    this.onStats = null;
    this.onScaleChange = null;

    new ResizeObserver(() => this.#resize()).observe(container);
    this.#resize();
  }

  setActive(on) {
    this.renderer.setAnimationLoop(on ? () => this.#tick() : null);
    if (on) { this.clock.getDelta(); this.#resize(); }
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pixelScale = this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    for (const m of [this.coreMat, this.haloMat]) if (m) m.uniforms.uScale.value = this.pixelScale;
  }

  #disposeGroup(group) {
    group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
    group.clear();
  }

  /**
   * iso: { Z, N, A, halo }, beta: ground-state β₂, radii: { Rp, Rn, a },
   * periods: { dipole, breathing, quadrupole } in babyseconds, E2: rotational E(2⁺) in MeV.
   */
  setNucleus(iso, beta, radii, periods, E2) {
    this.iso = iso;
    this.beta = beta;
    this.radii = radii;
    this.periods = periods;
    this.E2 = E2;
    this.t = 0;
    this.#disposeGroup(this.nucleusGroup);
    const { Z, A } = iso;
    const rand = mulberry32(Z * 1000 + A);
    this.rand = rand;

    // Which nucleons are protons, and which (for halo nuclei) live in the halo.
    const isProton = new Uint8Array(A);
    const inHalo = new Uint8Array(A);
    const halo = iso.halo;
    const haloCount = halo ? halo.halo : 0;
    const order = [...Array(A).keys()].sort(() => rand() - 0.5);
    let p = 0;
    for (const i of order) if (p < Z) { isProton[i] = 1; p++; }
    if (halo) {
      const pool = order.filter((i) => isProton[i] === (halo.kind === 'p' ? 1 : 0));
      for (let k = 0; k < haloCount; k++) inHalo[pool[k]] = 1;
    }
    this.isProton = isProton;
    this.inHalo = inHalo;

    // Start positions sampled from the (deformed) Woods–Saxon density, then let it settle.
    const pos = new Float32Array(A * 3);
    const vel = new Float32Array(A * 3);
    for (let i = 0; i < A; i++) {
      const w = this.#well(i, 0);
      for (let tries = 0; tries < 200; tries++) {
        const r = (w.core ?? 0) + (w.R + 3 * w.a - (w.core ?? 0)) * Math.cbrt(rand());
        const ct = 2 * rand() - 1, ph = 2 * Math.PI * rand(), st = Math.sqrt(1 - ct * ct);
        const R = w.R * this.#shape(ct, w.beta);
        if (rand() < 1 / (1 + Math.exp((r - R) / w.a))) {
          pos.set([r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct], i * 3);
          break;
        }
      }
      const s = Math.sqrt(KT * ACC);
      for (let k = 0; k < 3; k++) vel[i * 3 + k] = this.#gauss() * s * (inHalo[i] ? 0.3 : 1);
    }
    this.pos = pos;
    this.vel = vel;
    this.force = new Float32Array(A * 3);
    for (let k = 0; k < 80; k++) this.#step(DT, 0);

    // Nucleons: glowing impostors, or solid spheres.
    const colors = new Float32Array(A * 3);
    const pc = new THREE.Color(PROTON_COLOR), nc = new THREE.Color(NEUTRON_COLOR);
    const hc = new THREE.Color(HALO_COLOR);
    for (let i = 0; i < A; i++) (inHalo[i] ? hc : isProton[i] ? pc : nc).toArray(colors, i * 3);
    this.drawPos = new Float32Array(A * 3);
    this.pointGeo = new THREE.BufferGeometry();
    this.pointGeo.setAttribute('position', new THREE.BufferAttribute(this.drawPos, 3));
    this.baseColors = colors.slice();
    this.pointGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    this.pointGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    const uniforms = (size) => ({ uScale: { value: this.pixelScale }, uSize: { value: size }, uOpacity: { value: 1 } });
    this.coreMat = new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: CORE_FRAG, uniforms: uniforms(2 * NUCLEON_R), transparent: true });
    this.haloMat = new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: HALO_FRAG, uniforms: uniforms(4 * NUCLEON_R), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.cores = new THREE.Points(this.pointGeo, this.coreMat);
    this.halos = new THREE.Points(this.pointGeo, this.haloMat);
    this.cores.renderOrder = 1;
    this.halos.renderOrder = 2;

    this.solidMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05, transparent: true, opacity: 1 });
    this.solids = new THREE.InstancedMesh(new THREE.SphereGeometry(NUCLEON_R, 24, 16), this.solidMat, A);
    for (let i = 0; i < A; i++) this.solids.setColorAt(i, inHalo[i] ? hc : isProton[i] ? pc : nc);
    this.solids.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nucleusGroup.add(this.cores, this.halos, this.solids);

    // Quarks: three per nucleon, each orbiting in its own randomly tilted plane.
    this.quarkFrames = [];
    for (let i = 0; i < A; i++) {
      const u = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      const w = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).cross(u).normalize();
      this.quarkFrames.push({ u, w, phase: rand() * Math.PI * 2, rate: 2 + rand() * 2, perm: Math.floor(rand() * 3), next: rand() });
    }
    this.quarks = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 14, 10), new THREE.MeshStandardMaterial({ roughness: 0.3 }), A * 3);
    this.quarks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.gluonGeo = new THREE.BufferGeometry();
    this.gluonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(A * 3 * 2 * 3), 3));
    this.gluons = new THREE.LineSegments(this.gluonGeo, new THREE.LineBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.55 }));
    this.nucleusGroup.add(this.quarks, this.gluons);
    this.#colorQuarks();

    // Mean-field surfaces (optional): proton and neutron wells.
    const shellMat = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.09, depthWrite: false, side: THREE.BackSide });
    const unit = new THREE.SphereGeometry(1, 48, 32);
    this.fieldP = new THREE.Mesh(unit, shellMat(PROTON_COLOR));
    this.fieldN = new THREE.Mesh(unit.clone(), shellMat('#ffd9b0'));
    this.nucleusGroup.add(this.fieldP, this.fieldN);

    // Close pairs: a bright bond between nucleons momentarily closer than CLOSE_PAIR.
    this.pairGeo = new THREE.BufferGeometry();
    this.pairGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(A * 6), 3));
    this.pairGeo.setDrawRange(0, 0);
    this.pairLines = new THREE.LineSegments(this.pairGeo, new THREE.LineBasicMaterial({ color: PAIR_COLOR, depthTest: false, transparent: true, opacity: 0.95 }));
    this.pairLines.renderOrder = 5;
    this.nucleusGroup.add(this.pairLines);
    this.pairStats = { total: 0, pn: 0, frames: 0 };

    this.#buildRuler();
    this.statsTimer = 0;
    this.#applyVisibility();
    this.fit();
  }

  #gauss() {
    const u = 1 - this.rand(), v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** R(θ)/R₀ for a quadrupole shape: 1 + β·Y₂₀(θ), volume-normalized to second order. */
  #shape(cosTheta, beta) {
    const y20 = 0.6307831 * (1.5 * cosTheta * cosTheta - 0.5); // √(5/4π)·P₂
    return (1 + beta * y20) / (1 + (beta * beta) / (4 * Math.PI)) ** (1 / 3);
  }

  // ---------- the collective drive: how the mean field moves at time t ----------

  #drive(t) {
    const d = { scale: 1, beta: this.beta, shift: 0, angle: 0 };
    const T = this.periods[this.mode];
    const phase = T ? (2 * Math.PI * t) / T : 0;
    // Amplitudes are exaggerated so the motion is visible.
    if (this.mode === 'breathing') d.scale = 1 + 0.08 * Math.sin(phase);
    else if (this.mode === 'quadrupole') d.beta = this.beta + 0.18 * Math.sin(phase);
    else if (this.mode === 'dipole') d.shift = 0.9 * Math.sin(phase);
    else if (this.mode === 'rotation' && this.periods.rotation) d.angle = (2 * Math.PI * t) / this.periods.rotation;
    return d;
  }

  /** The well nucleon i feels at drive state d: center offset, radius, diffuseness, depth, β. */
  #well(i, t, d = this.#drive(t)) {
    const { iso, radii } = this;
    const proton = this.isProton[i];
    if (this.inHalo?.[i]) {
      // A shallow, wide well for the loosely bound halo nucleons; the core's states are
      // already filled (Pauli exclusion), so they're kept out of it (see #step).
      const core = (radii.Rp + radii.Rn) / 2;
      return { R: 2.4 * core + 1.5, a: 1.1, V: 10, beta: 0, shift: 0, kT: KT_HALO, core };
    }
    const A = iso.A;
    const R = (proton ? radii.Rp : radii.Rn) * d.scale;
    // Dipole: protons and neutrons move oppositely, keeping the center of mass fixed.
    const shift = proton ? (d.shift * iso.N) / A : (-d.shift * iso.Z) / A;
    return { R, a: radii.a, V: V0, beta: d.beta, shift, kT: KT };
  }

  // ---------- dynamics ----------

  #step(dt, noise = 1) {
    const { pos, vel, force } = this;
    const n = pos.length / 3;
    force.fill(0);
    // Dynamics run in the nucleus's own (body) frame; rotation is applied when drawing.
    const d = this.#drive(this.t);
    const ca = 1, sa = 0;

    // Mean field (radial Woods–Saxon force, in the rotating body frame).
    const wells = [];
    for (let i = 0; i < n; i++) {
      const w = this.#well(i, this.t, d);
      wells.push(w);
      // Body frame: rotate by −angle about x, then remove the dipole shift along body z.
      const x = pos[3 * i], y0 = pos[3 * i + 1], z0 = pos[3 * i + 2];
      const y = ca * y0 + sa * z0, z = -sa * y0 + ca * z0 - w.shift;
      const r = Math.hypot(x, y, z) || 1e-6;
      const s = r - w.R * this.#shape(z / r, w.beta);
      const e = Math.exp(Math.min(40, s / w.a));
      const dUds = (w.V / w.a) * e / ((1 + e) * (1 + e)); // MeV/fm, pulling inward
      // Inward along the body-frame radius, rotated back to the lab frame.
      let push = -dUds;
      if (w.core && r < w.core + 1) push += 25 * (w.core + 1 - r); // halo: Pauli exclusion from the core
      const fx = (push * x) / r, fyb = (push * y) / r, fzb = (push * z) / r;
      force[3 * i] += fx;
      force[3 * i + 1] += ca * fyb - sa * fzb;
      force[3 * i + 2] += sa * fyb + ca * fzb;
      // Outward unit vector (lab frame) and how far past the surface, for the wall below.
      w.out = [x / r, (ca * y - sa * z) / r, (sa * y + ca * z) / r];
      w.past = s;
    }

    // Short-range nucleon–nucleon force (Volkov form): repulsive core, weak attraction.
    const cut2 = NN_CUT * NN_CUT;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[3 * i] - pos[3 * j], dy = pos[3 * i + 1] - pos[3 * j + 1], dz = pos[3 * i + 2] - pos[3 * j + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        if (r2 >= cut2) continue;
        // −dV/dr divided by r
        const f = REP_SCALE * (2 * VR) / (AR * AR) * Math.exp(-r2 / (AR * AR)) - ATT_SCALE * (2 * VA) / (AA * AA) * Math.exp(-r2 / (AA * AA));
        force[3 * i] += f * dx; force[3 * i + 1] += f * dy; force[3 * i + 2] += f * dz;
        force[3 * j] -= f * dx; force[3 * j + 1] -= f * dy; force[3 * j + 2] -= f * dz;
      }
    }

    // Langevin update: v += (F/m − γv)dt + √(2γ kT/m · dt)·ξ.
    for (let i = 0; i < n; i++) {
      const kick = noise * Math.sqrt(2 * GAMMA * wells[i].kT * ACC * dt);
      for (let k = 0; k < 3; k++) {
        const q = 3 * i + k;
        vel[q] += (force[q] * ACC - GAMMA * vel[q]) * dt + kick * this.#gauss();
        pos[q] += vel[q] * dt;
      }
      // A classical gas has a fast tail that a real (quantum, Pauli-blocked) nucleus doesn't:
      // reflect anything that gets more than ~3 diffuseness lengths past the surface.
      const w = wells[i];
      if (w.past > 3 * w.a) {
        const vr = vel[3 * i] * w.out[0] + vel[3 * i + 1] * w.out[1] + vel[3 * i + 2] * w.out[2];
        if (vr > 0) for (let k = 0; k < 3; k++) vel[3 * i + k] -= 2 * vr * w.out[k];
      }
    }
  }

  #colorQuarks() {
    const colors = COLOR_CHARGES.map((c) => new THREE.Color(c));
    for (let i = 0; i < this.quarkFrames.length; i++) {
      const { perm } = this.quarkFrames[i];
      for (let k = 0; k < 3; k++) this.quarks.setColorAt(3 * i + k, colors[(k + perm) % 3]);
    }
    this.quarks.instanceColor.needsUpdate = true;
  }

  // ---------- the light-speed ruler ----------

  #buildRuler() {
    this.#disposeGroup(this.rulerGroup);
    const ext = this.#extent();
    const L = Math.max(6, Math.ceil(2 * ext));
    const z = -ext - 1.6;
    const pts = [new THREE.Vector3(-L / 2, 0, z), new THREE.Vector3(L / 2, 0, z)];
    for (let k = 0; k <= L; k++) {
      const x = -L / 2 + k;
      const h = k % 5 === 0 ? 0.45 : 0.22;
      pts.push(new THREE.Vector3(x, 0, z - h / 2), new THREE.Vector3(x, 0, z + h / 2));
    }
    const ticks = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#c9b46a', transparent: true, opacity: 0.7 }));
    const photon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff6b0' }));
    const label = textSprite(`speed of light: 3 fm per babysecond · ruler in fm`, '#c9b46a', Math.max(0.5, L / 26));
    label.position.set(0, 0, z - 0.9);
    this.rulerGroup.add(ticks, photon, label);
    this.ruler = { L, z, photon };
  }

  #extent() {
    if (!this.radii) return 5;
    const R = Math.max(this.radii.Rp, this.radii.Rn) * (1 + 0.65 * Math.abs(this.beta)) + 2;
    return this.iso.halo ? R * 1.9 : R;
  }

  // ---------- settings ----------

  setMode(mode) { this.mode = mode; this.#applyVisibility(); }
  setMotion(on) { this.motion = on; }
  setTimeRate(r) { this.timeRate = r; }
  setSpin(J) { this.spin = J; }
  setPeriods(periods) { this.periods = periods; }
  setQuarks(on) { this.showQuarks = on; this.#applyVisibility(); }
  setField(on) { this.showField = on; this.#applyVisibility(); }
  setRuler(on) { this.showRuler = on; this.#applyVisibility(); }
  setPairs(on) { this.showPairs = on; this.#applyVisibility(); }
  setStyle(style) { this.style = style; this.#applyVisibility(); }
  setAutoRotate(on) { this.controls.autoRotate = on; }

  setView(view, kind = 'proton') {
    this.view = view;
    if (view === 'nucleon') this.#buildNucleon(kind);
    this.#applyVisibility();
    this.fit();
  }

  #applyVisibility() {
    const nuc = this.view === 'nucleus';
    this.nucleusGroup.visible = nuc;
    this.nucleonGroup.visible = !nuc;
    this.rulerGroup.visible = nuc && this.showRuler;
    if (!this.cores) return;
    const glow = this.style === 'glow';
    const faded = this.showQuarks ? 0.25 : 1;
    this.cores.visible = this.halos.visible = glow;
    this.solids.visible = !glow;
    this.coreMat.uniforms.uOpacity.value = faded;
    this.haloMat.uniforms.uOpacity.value = this.showQuarks ? 0.3 : 1;
    this.coreMat.depthWrite = !this.showQuarks;
    this.solidMat.opacity = faded;
    this.solidMat.depthWrite = !this.showQuarks;
    this.quarks.visible = this.gluons.visible = this.showQuarks;
    this.fieldP.visible = this.fieldN.visible = this.showField;
    this.pairLines.visible = this.showPairs;
  }

  // ---------- single nucleon close-up ----------

  #buildNucleon(kind) {
    this.#disposeGroup(this.nucleonGroup);
    const info = NUCLEONS[kind];
    const R = info.radius;
    const scale = 1; // fm
    const g = this.nucleonGroup;
    const bag = new THREE.Mesh(
      new THREE.SphereGeometry(R * scale, 48, 32),
      new THREE.MeshStandardMaterial({ color: kind === 'proton' ? PROTON_COLOR : NEUTRON_COLOR, transparent: true, opacity: 0.16, depthWrite: false, roughness: 0.6 }),
    );
    g.add(bag);
    this.closeup = { kind, R, quarks: [], tubes: [], sea: [], perm: 0, nextSwap: 0.4 };
    info.quarks.forEach((flavor, k) => {
      const q = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 16), new THREE.MeshStandardMaterial({ roughness: 0.25, emissiveIntensity: 0.35 }));
      const label = textSprite(`${flavor} ${flavor === 'u' ? '+⅔' : '−⅓'}`, '#ffffff', 0.09);
      g.add(q, label);
      this.closeup.quarks.push({ mesh: q, label, flavor, phase: (k * Math.PI * 2) / 3, axis: new THREE.Vector3(Math.sin(k * 2.1), Math.cos(k * 1.3), Math.sin(k + 0.5)).normalize() });
    });
    // Gluon flux tubes between each pair of quarks, redrawn with a wiggle every frame.
    for (let k = 0; k < 3; k++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.85 }));
      g.add(line);
      this.closeup.tubes.push(line);
    }
    // Sea quark–antiquark pairs that briefly appear and vanish.
    for (let k = 0; k < 6; k++) {
      const pair = new THREE.Group();
      for (let s = 0; s < 2; s++) {
        pair.add(new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: s ? '#b9a6ff' : '#9ef0ff', transparent: true, opacity: 0 })));
      }
      g.add(pair);
      this.closeup.sea.push({ pair, life: Math.random(), pos: new THREE.Vector3(), dir: new THREE.Vector3() });
    }
    this.#colorCloseup();
  }

  #colorCloseup() {
    const { quarks, perm } = this.closeup;
    quarks.forEach((q, k) => {
      const c = new THREE.Color(COLOR_CHARGES[(k + perm) % 3]);
      q.mesh.material.color.copy(c);
      q.mesh.material.emissive.copy(c);
    });
  }

  #tickNucleon(dt, t) {
    const cu = this.closeup;
    const R = cu.R;
    const P = cu.quarks.map((q, k) => {
      const base = new THREE.Vector3(Math.cos(q.phase + t * 0.9), Math.sin(q.phase + t * 0.9), 0).multiplyScalar(R * 0.45);
      base.applyAxisAngle(q.axis, Math.sin(t * 1.3 + k) * 0.8);
      base.add(new THREE.Vector3(Math.sin(t * 3.1 + k * 2), Math.cos(t * 2.7 + k), Math.sin(t * 2.3 + k * 4)).multiplyScalar(R * 0.12));
      q.mesh.position.copy(base);
      q.label.position.copy(base).add(new THREE.Vector3(0, 0, 0.17));
      return base;
    });
    cu.tubes.forEach((line, k) => {
      const a = P[k], b = P[(k + 1) % 3];
      const arr = line.geometry.attributes.position.array;
      const dir = b.clone().sub(a);
      const side = dir.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
      const up = dir.clone().cross(side).normalize();
      for (let i = 0; i < 40; i++) {
        const s = i / 39;
        const env = Math.sin(Math.PI * s);
        const p = a.clone().lerp(b, s)
          .addScaledVector(side, env * 0.035 * Math.sin(s * 22 - t * 14 + k))
          .addScaledVector(up, env * 0.035 * Math.cos(s * 22 - t * 14 + k));
        arr.set([p.x, p.y, p.z], i * 3);
      }
      line.geometry.attributes.position.needsUpdate = true;
    });
    cu.nextSwap -= dt;
    if (cu.nextSwap <= 0) { // a gluon carries color from one quark to another
      cu.perm = (cu.perm + 1) % 3;
      cu.nextSwap = 0.35 + Math.random() * 0.5;
      this.#colorCloseup();
    }
    for (const s of cu.sea) {
      s.life += dt * 0.9;
      if (s.life >= 1) {
        s.life = 0;
        s.pos.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(R * (0.2 + Math.random() * 0.6));
        s.dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      }
      const fade = Math.sin(Math.PI * s.life);
      s.pair.children.forEach((m, k) => {
        m.material.opacity = 0.85 * fade;
        m.position.copy(s.pos).addScaledVector(s.dir, (k ? 1 : -1) * 0.07 * fade);
      });
    }
  }


  // ---------- animation ----------

  #tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.view === 'nucleon' && this.closeup) {
      this.tVisual = (this.tVisual ?? 0) + dt;
      this.#tickNucleon(dt, this.tVisual);
    } else if (this.pos) {
      this.#tickNucleus(dt);
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (this.onScaleChange) {
      const dist = this.camera.position.distanceTo(this.controls.target);
      const width = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect;
      if (Math.abs(width - (this.lastWidth || 0)) / width > 0.01) { this.lastWidth = width; this.onScaleChange(width); }
    }
  }

  #tickNucleus(dt) {
    const advance = dt * this.timeRate; // babyseconds this frame
    // The clock (and the collective drive) always run at the chosen rate; the nucleon
    // dynamics take at most MAX_STEPS steps per frame, so at very high rates they lag.
    const steps = this.motion ? Math.min(MAX_STEPS, Math.ceil(advance / DT)) : 0;
    const stepDt = steps ? Math.min(DT, advance / steps) : 0;
    this.lagging = this.motion && advance > MAX_STEPS * DT * 1.01 && this.mode !== 'rotation';
    for (let s = 0; s < steps; s++) {
      this.t += advance / steps;
      this.#step(stepDt);
    }
    if (!steps) this.t += advance;

    // Draw positions: the body-frame simulation, turned by the rotation angle (about x).
    const A = this.iso.A;
    const angle = this.#drive(this.t).angle;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const out = this.drawPos;
    for (let i = 0; i < A; i++) {
      const y = this.pos[3 * i + 1], z = this.pos[3 * i + 2];
      out[3 * i] = this.pos[3 * i];
      out[3 * i + 1] = ca * y - sa * z;
      out[3 * i + 2] = sa * y + ca * z;
    }
    this.pointGeo.attributes.position.needsUpdate = true;

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    if (this.style !== 'glow') {
      for (let i = 0; i < A; i++) {
        p.fromArray(out, 3 * i);
        m.compose(p, q, one);
        this.solids.setMatrixAt(i, m);
      }
      this.solids.instanceMatrix.needsUpdate = true;
    }

    // Mean-field surfaces follow the drive.
    const d = this.#drive(this.t);
    if (this.showField) {
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), d.angle);
      for (const [mesh, proton] of [[this.fieldP, 1], [this.fieldN, 0]]) {
        const R = (proton ? this.radii.Rp : this.radii.Rn) * d.scale;
        const along = R * this.#shape(1, d.beta), across = R * this.#shape(0, d.beta);
        mesh.scale.set(across, across, along);
        const shift = proton ? (d.shift * this.iso.N) / A : (-d.shift * this.iso.Z) / A;
        mesh.position.set(0, 0, shift).applyQuaternion(rot);
        mesh.quaternion.copy(rot);
      }
    }

    if (this.showRuler && this.ruler) {
      const { L, z, photon } = this.ruler;
      photon.position.set(-L / 2 + ((C * this.t) % L), 0, z);
    }

    if (this.showQuarks) {
      const pos = this.gluonGeo.attributes.position.array;
      const qp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      let recolor = false;
      // Quarks inside a nucleon move at nearly light speed: ~0.45 fm orbits, a few per babysecond.
      for (let i = 0; i < A; i++) {
        const f = this.quarkFrames[i];
        const ang = f.phase + this.t * f.rate * 2.5;
        for (let k = 0; k < 3; k++) {
          const tt = ang + (k * 2 * Math.PI) / 3;
          qp[k].fromArray(out, 3 * i).addScaledVector(f.u, Math.cos(tt) * 0.45).addScaledVector(f.w, Math.sin(tt) * 0.45);
          m.compose(qp[k], q, one);
          this.quarks.setMatrixAt(3 * i + k, m);
        }
        for (let k = 0; k < 3; k++) {
          const a0 = qp[k], b0 = qp[(k + 1) % 3];
          pos.set([a0.x, a0.y, a0.z, b0.x, b0.y, b0.z], (3 * i + k) * 6);
        }
        f.next -= advance * 0.6;
        if (f.next <= 0) { f.perm = (f.perm + 1) % 3; f.next = 0.3 + Math.random() * 0.7; recolor = true; }
      }
      this.quarks.instanceMatrix.needsUpdate = true;
      this.gluonGeo.attributes.position.needsUpdate = true;
      if (recolor) this.#colorQuarks();
    }

    this.#updatePairs(out);
    this.onClock?.(this.t, this.lagging);
    this.statsTimer += dt;
    if (this.onStats && this.statsTimer > 0.5) {
      this.statsTimer = 0;
      this.onStats(this.#stats());
    }
  }

  /** Find pairs closer than CLOSE_PAIR; draw them and keep running counts. */
  #updatePairs(out) {
    const { isProton } = this;
    const n = out.length / 3;
    const lines = this.pairGeo.attributes.position.array;
    const c2 = CLOSE_PAIR * CLOSE_PAIR;
    let count = 0, pn = 0;
    const inPair = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = out[3 * i] - out[3 * j], dy = out[3 * i + 1] - out[3 * j + 1], dz = out[3 * i + 2] - out[3 * j + 2];
        if (dx * dx + dy * dy + dz * dz >= c2) continue;
        if (isProton[i] !== isProton[j]) pn++;
        inPair[i] = inPair[j] = 1;
        if (count < n) {
          lines.set([out[3 * i], out[3 * i + 1], out[3 * i + 2], out[3 * j], out[3 * j + 1], out[3 * j + 2]], count * 6);
        }
        count++;
      }
    }
    if (this.showPairs || this.pairsTinted) {
      this.pairGeo.setDrawRange(0, this.showPairs ? Math.min(count, n) * 2 : 0);
      this.pairGeo.attributes.position.needsUpdate = true;
      // Tint nucleons that are in a close pair right now.
      const colors = this.pointGeo.attributes.aColor;
      const pc = new THREE.Color(PAIR_COLOR), c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        c.fromArray(this.baseColors, 3 * i);
        if (this.showPairs && inPair[i]) c.lerp(pc, 0.75);
        c.toArray(colors.array, 3 * i);
        this.solids.setColorAt(i, c);
      }
      colors.needsUpdate = true;
      this.solids.instanceColor.needsUpdate = true;
      this.pairsTinted = this.showPairs; // one more pass after turning off restores the colors
    }
    // Running averages: share of nucleons in a close pair, and the proton–neutron share of pairs.
    const s = this.pairStats;
    const w = 1 / Math.min(++s.frames, 120);
    s.fraction = (s.fraction ?? 0) + ((inPair.reduce((a, b) => a + b, 0) / n) - (s.fraction ?? 0)) * w;
    if (count) s.pnShare = (s.pnShare ?? pn / count) + (pn / count - (s.pnShare ?? pn / count)) * w;
  }

  /** Live measurements from the simulation: rms speed and proton/neutron rms radii. */
  #stats() {
    const { pos, vel, isProton, inHalo } = this;
    const n = pos.length / 3;
    let v2 = 0, rp = 0, rn = 0, np = 0, nn = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += pos[3 * i]; cy += pos[3 * i + 1]; cz += pos[3 * i + 2]; }
    cx /= n; cy /= n; cz /= n;
    for (let i = 0; i < n; i++) {
      v2 += vel[3 * i] ** 2 + vel[3 * i + 1] ** 2 + vel[3 * i + 2] ** 2;
      if (inHalo[i]) continue;
      const r2 = (pos[3 * i] - cx) ** 2 + (pos[3 * i + 1] - cy) ** 2 + (pos[3 * i + 2] - cz) ** 2;
      if (isProton[i]) { rp += r2; np++; } else { rn += r2; nn++; }
    }
    this.statAvg ??= null;
    const now = { v: Math.sqrt(v2 / n) / C, rp: np ? Math.sqrt(rp / np) : 0, rn: nn ? Math.sqrt(rn / nn) : 0 };
    // Running average so the numbers settle instead of flickering.
    if (!this.statAvg || this.statAvg.A !== this.iso.A) this.statAvg = { ...now, A: this.iso.A, k: 1 };
    else {
      const a = this.statAvg, w = 1 / Math.min(++a.k, 300);
      for (const key of ['v', 'rp', 'rn']) a[key] += (now[key] - a[key]) * w;
    }
    this.statAvg.pairFraction = this.pairStats?.fraction ?? 0;
    this.statAvg.pnShare = this.pairStats?.pnShare ?? null;
    return this.statAvg;
  }

  fit() {
    const R = this.view === 'nucleon' ? (this.closeup?.R ?? 0.9) * 1.25 : this.#extent() + 1.5;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = R / Math.sin(Math.min(vfov, hfov) / 2);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir.multiplyScalar(dist));
    this.lastWidth = 0;
  }
}
