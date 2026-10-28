import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { NUCLEONS, haloKappa, HBAR_MEV_S } from './nucleus-data.js';

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

// Pions, the lightest mesons, carry the strong force between nucleons (Yukawa).
// A virtual pion lives about ħ/(m_π c²) = 6.58×10⁻²² MeV·s / 139.6 MeV ≈ 0.47 bs and
// reaches about ħ/(m_π c) ≈ 1.4 fm, so only near neighbors exchange them.
export const PION_COLORS = { '+': '#ff6bd6', '-': '#7dff6b', 0: '#e6e6e6' };
const PION_RANGE = 2.0; // fm, center to center, for picking an exchange partner
const PION_FLIGHT = 0.7; // seconds on screen per exchange (real: ~0.5 bs, slowed to be visible)

function dotTexture() { // fresh each time: #disposeGroup disposes material maps
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

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
    this.orbitalGroup = new THREE.Group(); // one shell-model orbital
    this.scene.add(this.nucleusGroup, this.nucleonGroup, this.rulerGroup, this.orbitalGroup);

    this.mode = 'none';
    this.view = 'nucleus';
    this.style = 'glow';
    this.motion = true;
    this.showQuarks = false;
    this.showField = false;
    this.showRuler = true;
    this.showPairs = false;
    this.showMesons = false;
    this.timeRate = 4; // babyseconds per real second
    this.spin = 10;
    this.flow = 'mixed'; // rotation: 'rigid', 'fluid' (irrotational), or the measured 'mixed'
    this.damped = true; // giant resonances ring down and get re-excited
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
    for (const m of [this.coreMat, this.haloMat, this.mesonCoreMat, this.mesonHaloMat]) if (m) m.uniforms.uScale.value = this.pixelScale;
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
  setNucleus(iso, beta, radii, periods, E2, beta3 = 0) {
    this.iso = iso;
    this.beta = beta;
    this.beta3 = beta3;
    this.beta1 = beta3 ? this.#centerShift(beta, beta3) : 0;
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
      if (w.halo) {
        // Start halo nucleons already in their equilibrium distribution, radial density ∝ e^{−2κ(r − core)}.
        const r = w.core - Math.log(1 - rand()) / (2 * w.kappa);
        const ct = 2 * rand() - 1, ph = 2 * Math.PI * rand(), st = Math.sqrt(1 - ct * ct);
        pos.set([r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct], i * 3);
        const s = Math.sqrt(KT_HALO * ACC);
        for (let k = 0; k < 3; k++) vel[i * 3 + k] = this.#gauss() * s;
        continue;
      }
      for (let tries = 0; tries < 200; tries++) {
        const r = (w.R + 3 * w.a) * Math.cbrt(rand());
        const ct = 2 * rand() - 1, ph = 2 * Math.PI * rand(), st = Math.sqrt(1 - ct * ct);
        const R = w.R * this.#shape(ct, w.beta, w.beta3, w.beta1);
        if (rand() < 1 / (1 + Math.exp((r - R) / w.a))) {
          pos.set([r * st * Math.cos(ph), r * st * Math.sin(ph), r * ct], i * 3);
          break;
        }
      }
      const s = Math.sqrt(KT * ACC);
      for (let k = 0; k < 3; k++) vel[i * 3 + k] = this.#gauss() * s;
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

    // Mesons in flight: glowing points between the nucleons exchanging them.
    const maxMesons = Math.max(8, Math.ceil(A / 2));
    this.mesonGeo = new THREE.BufferGeometry();
    this.mesonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxMesons * 3), 3));
    this.mesonGeo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(maxMesons * 3), 3));
    this.mesonGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 100);
    this.mesonGeo.setDrawRange(0, 0);
    const mesonUniforms = (size) => ({ uScale: { value: this.pixelScale }, uSize: { value: size }, uOpacity: { value: 1 } });
    this.mesonCoreMat = new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: CORE_FRAG, uniforms: mesonUniforms(0.7), transparent: true, depthTest: false });
    this.mesonHaloMat = new THREE.ShaderMaterial({ vertexShader: GLOW_VERT, fragmentShader: HALO_FRAG, uniforms: mesonUniforms(2.6), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    this.mesonPoints = new THREE.Group();
    const mc = new THREE.Points(this.mesonGeo, this.mesonCoreMat), mh = new THREE.Points(this.mesonGeo, this.mesonHaloMat);
    mc.renderOrder = 7; mh.renderOrder = 6;
    this.mesonPoints.add(mh, mc);
    this.nucleusGroup.add(this.mesonPoints);
    this.mesons = [];
    this.busy = new Uint8Array(A);
    this.mesonCount = { '+': 0, '-': 0, 0: 0, halo: 0, haloInv: 0, coreInv: 0 };

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
  /**
   * R(θ)/R₀ = 1 + β₁Y₁₀ + β₂Y₂₀ + β₃Y₃₀, normalized to constant volume. The octupole
   * term β₃ makes a pear; β₁ (set by #centerShift) keeps its center of mass at the origin.
   */
  #shape(cosTheta, beta, beta3 = 0, beta1 = 0) {
    const c = cosTheta;
    const y20 = 0.6307831 * (1.5 * c * c - 0.5); // √(5/4π)·P₂
    const y30 = beta3 ? 0.7463527 * (2.5 * c * c * c - 1.5 * c) : 0; // √(7/4π)·P₃
    const y10 = 0.4886025 * c; // √(3/4π)·P₁
    return (1 + beta * y20 + beta3 * y30 + beta1 * y10) / (1 + (beta * beta + beta3 * beta3) / (4 * Math.PI)) ** (1 / 3);
  }

  /** β₁ that puts the center of mass of the β₂, β₃ shape at the origin. */
  #centerShift(beta, beta3) {
    const zc = (b1) => { // ∫ R⁴ cosθ dΩ, proportional to the center of mass
      let t = 0;
      for (let i = 0; i < 200; i++) { const c = -1 + (2 * (i + 0.5)) / 200; t += this.#shape(c, beta, beta3, b1) ** 4 * c; }
      return t;
    };
    let b1 = 0;
    for (let k = 0; k < 8; k++) { const f = zc(b1), d = (zc(b1 + 1e-4) - f) / 1e-4; b1 -= f / d; }
    return b1;
  }

  // ---------- the collective drive: how the mean field moves at time t ----------

  /**
   * Giant resonances are damped: each excitation rings down with amplitude e^{−t/τ},
   * τ = 2ħ/Γ, and a new γ-ray re-excites it every few periods. Returns the phase and
   * amplitude envelope at time t (babyseconds).
   */
  #ring(t) {
    const T = this.periods[this.mode];
    const tau = this.damped ? this.dampTimes?.[this.mode] : null;
    if (!T) return { phase: 0, env: 0 };
    if (!tau) return { phase: (2 * Math.PI * t) / T, env: 1 };
    const every = Math.max(4 * T, 5 * tau);
    const local = t % every;
    this.excitation = Math.floor(t / every);
    return { phase: (2 * Math.PI * local) / T, env: Math.exp(-local / tau) };
  }

  #drive(t) {
    const d = { scale: 1, beta: this.beta, shift: 0, angle: 0 };
    const { phase, env } = this.#ring(t);
    // Amplitudes are exaggerated so the motion is visible.
    if (this.mode === 'breathing') d.scale = 1 + 0.08 * env * Math.sin(phase);
    else if (this.mode === 'quadrupole') d.beta = this.beta + 0.18 * env * Math.sin(phase);
    else if (this.mode === 'dipole') d.shift = 0.9 * env * Math.sin(phase);
    else if (this.mode === 'rotation' && this.periods.rotation) d.angle = (2 * Math.PI * t) / this.periods.rotation;
    return d;
  }

  /** The well nucleon i feels at drive state d: center offset, radius, diffuseness, depth, β. */
  #well(i, t, d = this.#drive(t)) {
    const { iso, radii } = this;
    const proton = this.isProton[i];
    const ev = this.event;
    if (ev && ev.cluster[i] >= 0) {
      // During a decay or reaction, each fragment has its own spherical well that can move.
      const c = ev.clusters[ev.cluster[i]];
      return { R: c.R, a: 0.5, V: V0, beta: 0, shift: 0, kT: KT, center: c.center };
    }
    if (this.inHalo?.[i]) {
      // A loosely bound halo nucleon (see #step): its density outside the core falls off as
      // e^{−2κr}/r², set by how weakly it's bound; the core's interior is mostly Pauli-blocked.
      const core = (radii.Rp + radii.Rn) / 2;
      const kappa = haloKappa(iso);
      // Little drag: a halo nucleon coasts through its wide, nearly empty region.
      return { halo: true, R: core + 1 / (2 * kappa), a: 1 / (2 * kappa), V: 0, beta: 0, shift: 0, kT: KT_HALO, gamma: 0.05, core, kappa };
    }
    const A = iso.A;
    const R = (proton ? radii.Rp : radii.Rn) * d.scale;
    // Dipole: protons and neutrons move oppositely, keeping the center of mass fixed.
    const shift = proton ? (d.shift * iso.N) / A : (-d.shift * iso.Z) / A;
    return { R, a: radii.a, V: V0, beta: d.beta, beta3: this.beta3, beta1: this.beta1, shift, kT: KT };
  }

  // ---------- decays and reactions ----------

  /**
   * Play a decay or reaction. info.type: 'α', 'β⁻', 'β⁺', 'EC', 'fission', 'fusion'.
   * Extra fields: fission { labels: [heavy, light], neutrons, split: fraction of A in the
   * heavy fragment }, fusion { scene: { iso, radii } }. Captions go to onEventCaption;
   * onEventEnd fires when it's over.
   */
  startEvent(info) {
    if (this.event) this.stopEvent(true);
    this.savedNucleus = [this.iso, this.beta, this.radii, this.periods, this.E2];
    if (info.type === 'fusion') this.setNucleus(info.scene.iso, 0, info.scene.radii, {}, null);
    const A = this.iso.A;
    this.savedMode = this.mode;
    this.mode = 'none';
    this.savedRate = this.timeRate;
    this.timeRate = Math.min(this.timeRate, 6); // the event is scripted in real time; keep the jostling natural
    // Directions across the screen, so emitted particles and fragments stay in view.
    this.camera.updateMatrixWorld();
    this.screenRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    this.screenUp = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    this.event = {
      ...info, stage: 0, stageT: 0,
      cluster: new Int8Array(A).fill(-1), clusters: [], scripted: new Uint8Array(A),
      group: new THREE.Group(), particles: [],
    };
    this.nucleusGroup.add(this.event.group);
    ({ 'α': () => this.#setupAlpha(), 'β⁻': () => this.#setupBeta(-1), 'β⁺': () => this.#setupBeta(1), EC: () => this.#setupBeta(1, true),
      fission: () => this.#setupFission(), fusion: () => this.#setupFusion() })[info.type]();
    this.#enterStage();
  }

  /** End the event; with restore, go back to the original nucleus. */
  stopEvent(restore = true) {
    const ev = this.event;
    if (!ev) return;
    this.#disposeGroup(ev.group);
    this.nucleusGroup.remove(ev.group);
    this.event = null;
    this.mode = this.savedMode ?? 'none';
    if (this.savedRate) this.timeRate = this.savedRate;
    if (restore && this.savedNucleus) this.setNucleus(...this.savedNucleus);
    this.savedNucleus = null;
    this.onEventCaption?.('');
  }

  get eventPlaying() { return !!this.event; }

  #enterStage() {
    const ev = this.event;
    const st = ev.stages[ev.stage];
    if (!st) { this.onEventCaption?.(ev.endCaption ?? ''); this.onEventEnd?.(ev); ev.finished = true; return; }
    ev.stageT = 0;
    st.enter?.();
    this.onEventCaption?.(st.caption ?? '');
  }

  #tickEvent(dt) {
    const ev = this.event;
    if (ev.finished) { ev.idle?.(dt); return; }
    const st = ev.stages[ev.stage];
    ev.stageT += dt;
    const u = Math.min(1, ev.stageT / st.duration);
    st.update?.(u, dt);
    if (u >= 1) { ev.stage++; this.#enterStage(); }
  }

  /** A small glowing particle (electron, neutrino, free neutron…) with a fading trail. */
  #particle(color, radius = 0.35) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), new THREE.MeshBasicMaterial({ color }));
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30 * 3), 3));
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }));
    trail.frustumCulled = false;
    this.event.group.add(mesh, trail);
    const p = { mesh, trail, history: [] };
    p.moveTo = (v) => {
      mesh.position.copy(v);
      p.history.push(v.clone());
      if (p.history.length > 30) p.history.shift();
      const arr = trailGeo.attributes.position.array;
      p.history.forEach((h, k) => arr.set([h.x, h.y, h.z], k * 3));
      trailGeo.setDrawRange(0, p.history.length);
      trailGeo.attributes.position.needsUpdate = true;
    };
    return p;
  }

  #label(text, color = '#ffffff') {
    const sprite = textSprite(text, color, 1.6);
    this.event.group.add(sprite);
    return sprite;
  }

  #tint(i, color) {
    const c = color ? new THREE.Color(color) : new THREE.Color().fromArray(this.baseColors, 3 * i);
    c.toArray(this.pointGeo.attributes.aColor.array, 3 * i);
    this.pointGeo.attributes.aColor.needsUpdate = true;
    this.solids.setColorAt(i, c);
    this.solids.instanceColor.needsUpdate = true;
  }

  /** Nucleons of one kind nearest a point, excluding ones already taken. */
  #nearest(point, proton, count, taken) {
    const { pos, isProton, inHalo } = this;
    const idx = [];
    for (let i = 0; i < pos.length / 3; i++) if (isProton[i] === proton && !taken.has(i) && !inHalo[i]) idx.push(i);
    idx.sort((a, b) => Math.hypot(pos[3 * a] - point.x, pos[3 * a + 1] - point.y, pos[3 * a + 2] - point.z)
      - Math.hypot(pos[3 * b] - point.x, pos[3 * b + 1] - point.y, pos[3 * b + 2] - point.z));
    return idx.slice(0, count);
  }

  #zoom(factor) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, factor);
  }

  // α decay: a 2p+2n cluster forms, rattles against the Coulomb barrier, tunnels out.
  #setupAlpha() {
    const ev = this.event;
    const R = this.radii.Rp;
    const u = this.screenRight.clone().multiplyScalar(0.9).addScaledVector(this.screenUp, 0.4).normalize();
    const taken = new Set();
    const members = [...this.#nearest(u.clone().multiplyScalar(R - 1), 1, 2, taken), ...this.#nearest(u.clone().multiplyScalar(R - 1), 0, 2, taken)];
    members.forEach((i) => { ev.scripted[i] = 1; });
    const start = members.map((i) => new THREE.Vector3().fromArray(this.pos, 3 * i));
    const offsets = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map((o) => new THREE.Vector3(...o).multiplyScalar(0.62));
    const center = new THREE.Vector3();
    let spin = 0;
    const place = (blend) => members.forEach((i, k) => {
      const target = offsets[k].clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), spin).add(center);
      const p = blend < 1 ? start[k].clone().lerp(target, blend) : target;
      this.pos.set([p.x, p.y, p.z], 3 * i);
    });
    // The Coulomb barrier, drawn as a faint glowing shell just outside the surface.
    const shell = new THREE.Mesh(new THREE.SphereGeometry(R + 1.2, 48, 32), new THREE.MeshBasicMaterial({ color: '#ff9f43', transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false }));
    ev.group.add(shell);
    const r = (x) => center.copy(u).multiplyScalar(x);
    const knocks = 4;
    ev.stages = [
      { duration: 1.8, caption: ev.captions[0], update: (s) => { r(R - 1.6); spin += 0.02; place(s * s * (3 - 2 * s)); } },
      { duration: 3.4, caption: ev.captions[1], enter: () => { shell.material.opacity = 0.18; },
        update: (s) => { const ph = s * knocks * Math.PI * 2; r(R - 2.6 + 1.9 * (0.5 - 0.5 * Math.cos(ph))); spin += 0.04; place(1); } },
      { duration: 1.4, caption: ev.captions[2], enter: () => members.forEach((i) => this.#tint(i, '#ffd75e')),
        update: (s) => { r(R - 0.7 + 3.8 * s); spin += 0.04; place(1); shell.material.opacity = 0.18 + 0.25 * Math.sin(Math.PI * s); } },
      { duration: 2.8, caption: ev.captions[3], enter: () => { shell.material.opacity = 0.05; members.forEach((i) => this.#tint(i, null)); },
        update: (s) => { r(R + 3.1 + 30 * s * s); spin += 0.03; place(1); this.#zoom(1 + 0.004); } },
    ];
  }

  // β decay: one nucleon changes identity, emitting a lepton and a (anti)neutrino.
  // sign −1: β⁻ (n → p + e⁻ + ν̄); +1: β⁺ (p → n + e⁺ + ν); EC: p + e⁻ → n + ν.
  #setupBeta(sign, capture = false) {
    const ev = this.event;
    const proton = sign > 0 ? 1 : 0;
    const [i] = this.#nearest(new THREE.Vector3(0.3, 0.2, 0.4), proton, 1, new Set());
    ev.scripted[i] = 0; // it stays in the nucleus
    const at = () => new THREE.Vector3().fromArray(this.pos, 3 * i);
    const lepton = this.#particle(sign < 0 ? '#7dff6b' : '#ff6bd6', 0.4);
    const neutrino = this.#particle('#d8e4ff', 0.25);
    lepton.mesh.visible = neutrino.mesh.visible = false;
    const d1 = this.screenRight.clone().addScaledVector(this.screenUp, 0.3).normalize();
    const d2 = this.screenRight.clone().negate().addScaledVector(this.screenUp, 0.5).normalize();
    const R = this.radii.Rp;
    const incoming = this.screenRight.clone().negate().addScaledVector(this.screenUp, -0.4).normalize();
    ev.stages = [
      ...(capture ? [{ duration: 1.8, caption: ev.captions[0], enter: () => { lepton.mesh.visible = true; },
        update: (s) => { lepton.moveTo(at().addScaledVector(incoming, (R + 14) * (1 - s))); this.#tint(i, s > 0.5 ? '#ffd75e' : null); } }] : []),
      { duration: 1.4, caption: ev.captions[capture ? 1 : 0], update: (s) => this.#tint(i, Math.sin(s * Math.PI * 6) > 0 ? '#ffd75e' : null) },
      { duration: 1.0, caption: ev.captions[capture ? 2 : 1], enter: () => {
        this.#setIdentity(i, !proton);
        this.#tint(i, '#ffd75e');
        if (!capture) { lepton.mesh.visible = true; lepton.moveTo(at()); }
        else lepton.mesh.visible = false;
        neutrino.mesh.visible = true; neutrino.moveTo(at());
      }, update: (s) => {
        if (!capture) lepton.moveTo(at().addScaledVector(d1, 6 * s));
        neutrino.moveTo(at().addScaledVector(d2, 9 * s));
      } },
      { duration: 2.6, caption: ev.captions[capture ? 3 : 2], enter: () => this.#tint(i, null), update: (s) => {
        if (!capture) lepton.moveTo(at().addScaledVector(d1, 6 + 26 * s));
        neutrino.moveTo(at().addScaledVector(d2, 9 + 40 * s));
        this.#zoom(1.003);
      } },
    ];
  }

  // Neutron-induced fission: absorb, stretch, neck, snap, fly apart (+ prompt neutrons).
  #setupFission() {
    const ev = this.event;
    const { pos, isProton } = this;
    const A = this.iso.A;
    const R = (this.radii.Rp + this.radii.Rn) / 2;
    // Split the nucleons along z into a heavy and a light fragment (by count).
    const ax = this.screenRight.clone();
    const along = (i) => pos[3 * i] * ax.x + pos[3 * i + 1] * ax.y + pos[3 * i + 2] * ax.z;
    const order = [...Array(A).keys()].filter((i) => !this.inHalo[i]).sort((a, b) => along(a) - along(b));
    const nHeavy = Math.round(order.length * ev.split);
    const heavy = order.slice(0, nHeavy), light = order.slice(nHeavy);
    const Rh = 1.15 * Math.cbrt(heavy.length), Rl = 1.15 * Math.cbrt(light.length);
    ev.clusters = [{ center: ax.clone().multiplyScalar(-0.35 * Rl).toArray(), R: Rh }, { center: ax.clone().multiplyScalar(0.35 * Rh).toArray(), R: Rl }];
    heavy.forEach((i) => { ev.cluster[i] = 0; });
    light.forEach((i) => { ev.cluster[i] = 1; });
    // Prompt neutrons: taken from where the neck will be.
    const neckNeutrons = order.filter((i) => !isProton[i]).sort((a, b) => Math.abs(along(a)) - Math.abs(along(b))).slice(0, ev.neutrons);
    const incoming = this.#particle('#f2f2f2', 0.55);
    const dirIn = this.screenUp.clone().multiplyScalar(-1).addScaledVector(this.screenRight, -0.3).normalize();
    const labels = [this.#label(ev.labels[0]), this.#label(ev.labels[1])];
    labels.forEach((l) => { l.visible = false; });
    let sep = 0; // extra separation of the two centers, fm
    const setSep = (d) => {
      const dz = d - sep;
      sep = d;
      // Each fragment's center moves; carry its nucleons along so they keep up.
      const shiftH = (-dz * light.length) / order.length, shiftL = (dz * heavy.length) / order.length;
      for (let k = 0; k < 3; k++) {
        ev.clusters[0].center[k] += shiftH * ax.getComponent(k);
        ev.clusters[1].center[k] += shiftL * ax.getComponent(k);
      }
      return [shiftH, shiftL];
    };
    const carry = ([sh, sl], fraction) => {
      for (const [members, shift] of [[heavy, sh], [light, sl]]) {
        members.forEach((i) => {
          if (ev.scripted[i]) return;
          for (let k = 0; k < 3; k++) pos[3 * i + k] += shift * fraction * ax.getComponent(k);
        });
      }
    };
    const perp = this.screenUp.clone();
    const free = neckNeutrons.map((i, k) => ({ i, dir: perp.clone().multiplyScalar(k % 2 ? 1 : -1).applyAxisAngle(ax, k * 0.9).addScaledVector(ax, 0.2 * (k - 1)).normalize() }));
    ev.stages = [
      { duration: 1.6, caption: ev.captions[0], enter: () => incoming.moveTo(dirIn.clone().multiplyScalar(R + 22)),
        update: (s) => incoming.moveTo(dirIn.clone().multiplyScalar((R + 22) * (1 - s) + 0.5)) },
      { duration: 1.6, caption: ev.captions[1], enter: () => { incoming.mesh.visible = false; incoming.trail.visible = false; },
        update: (s) => { const target = 0.6 * R * s; carry(setSep(target), 0.25); } },
      { duration: 2.2, caption: ev.captions[2], update: (s) => { const target = 0.6 * R + (Rh + Rl - 0.6 * R + 0.5) * s * s; carry(setSep(target), 0.35); } },
      { duration: 0.8, caption: ev.captions[3], enter: () => {
        free.forEach(({ i }) => { ev.scripted[i] = 1; ev.cluster[i] = -1; this.#tint(i, '#f2f2f2'); });
      }, update: (s) => {
        carry(setSep(Rh + Rl + 0.5 + 2 * s), 1);
        free.forEach(({ i, dir }) => { const v = dir.clone().multiplyScalar(0.25); pos[3 * i] += v.x; pos[3 * i + 1] += v.y; pos[3 * i + 2] += v.z; });
      } },
      { duration: 3.2, caption: ev.captions[4], enter: () => labels.forEach((l) => { l.visible = true; }), update: (s, dt) => {
        carry(setSep(Rh + Rl + 2.5 + 55 * s * s), 1);
        free.forEach(({ i, dir }) => { const v = dir.clone().multiplyScalar(0.5); pos[3 * i] += v.x; pos[3 * i + 1] += v.y; pos[3 * i + 2] += v.z; });
        labels[0].position.fromArray(ev.clusters[0].center).addScaledVector(this.screenUp, Rh + 2.5);
        labels[1].position.fromArray(ev.clusters[1].center).addScaledVector(this.screenUp, Rl + 2.5);
        this.#zoom(1 + 0.25 * dt);
      } },
    ];
  }

  // D + T fusion: approach, tunnel, merge into ⁵He*, split into ⁴He + n.
  #setupFusion() {
    const ev = this.event;
    const { pos, isProton } = this;
    const p = [], n = [];
    for (let i = 0; i < 5; i++) (isProton[i] ? p : n).push(i);
    const D = [p[0], n[0]], T = [p[1], n[1], n[2]];
    ev.clusters = [{ center: [-16, 0, 0], R: 1.4 }, { center: [16, 0, 0], R: 1.6 }];
    D.forEach((i) => { ev.cluster[i] = 0; });
    T.forEach((i) => { ev.cluster[i] = 1; });
    const place = (members, c) => members.forEach((i, k) => pos.set([c[0] + Math.cos(k * 2.1) * 0.7, c[1] + Math.sin(k * 2.1) * 0.7, c[2] + (k - 1) * 0.4], 3 * i));
    place(D, ev.clusters[0].center); place(T, ev.clusters[1].center);
    const labels = [this.#label('²H'), this.#label('³H')];
    const moveCluster = (k, members, x) => {
      const dx = x - ev.clusters[k].center[0];
      ev.clusters[k].center[0] = x;
      members.forEach((i) => { if (!ev.scripted[i]) pos[3 * i] += dx; });
    };
    const neutron = T[2];
    const he4 = [p[0], p[1], n[0], n[1]];
    ev.stages = [
      { duration: 2.6, caption: ev.captions[0], update: (s) => {
        const e = 1 - (1 - s) ** 2; // decelerating as the Coulomb barrier pushes back
        moveCluster(0, D, -16 + 14 * e); moveCluster(1, T, 16 - 14 * e);
        labels[0].position.set(ev.clusters[0].center[0], 0, 3); labels[1].position.set(ev.clusters[1].center[0], 0, 3);
      } },
      { duration: 1.4, caption: ev.captions[1], enter: () => { labels.forEach((l) => { l.visible = false; }); [...D, ...T].forEach((i) => this.#tint(i, '#ffd75e')); },
        update: (s) => { moveCluster(0, D, -2 + 2 * s); moveCluster(1, T, 2 - 2 * s); ev.clusters[0].R = ev.clusters[1].R = 1.6 + 0.4 * s; } },
      { duration: 3.0, caption: ev.captions[2], enter: () => {
        [...D, ...T].forEach((i) => this.#tint(i, null));
        ev.scripted[neutron] = 1; ev.cluster[neutron] = -1;
        he4.forEach((i) => { ev.cluster[i] = 0; });
        ev.clusters[0].center[0] = 0; ev.clusters[0].R = 1.7;
        const lab = this.#label('⁴He');
        const nl = this.#label('n  14.1 MeV');
        ev.splitLabels = [lab, nl];
      }, update: (s) => {
        moveCluster(0, he4, -12 * s);
        pos[3 * neutron] = 2 + 26 * s; pos[3 * neutron + 1] = 0.5; pos[3 * neutron + 2] = 0;
        this.#zoom(1.0025);
        ev.splitLabels[0].position.set(ev.clusters[0].center[0], 0, 3);
        ev.splitLabels[1].position.set(pos[3 * neutron], 0, 2.5);
      } },
    ];
  }

  // ---------- rotation as a flow ----------

  /**
   * How much of the rotation is rigid. A rigid body moves with v = Ω × r; an ideal
   * (irrotational) fluid inside a rotating spheroid flows with v = Ωk·(0, z, y) in the
   * body frame, k = (b² − c²)/(b² + c²) (Lamb, Hydrodynamics §110), so its bulge travels
   * around while the fluid mostly sloshes. Their moments of inertia are I_rig = A·m(b² + c²)/5
   * and I_irr = k²·I_rig. The value from the rotational energy, I = 3ħ²/E(2⁺), lies in between; the
   * rigid share λ is chosen so λ·I_rig + (1 − λ)·I_irr = I.
   */
  #rotationFlow() {
    const R = (this.radii.Rp + this.radii.Rn) / 2;
    const c = R * this.#shape(1, this.beta), b = R * this.#shape(0, this.beta);
    const k = (b * b - c * c) / (b * b + c * c);
    const qIrr = k * k;
    let q = null, lambda = 1;
    if (this.E2) {
      const iMeasured = (3 * 41.47) / this.E2; // ħ²/m = (ħc)²/(mc²) = 41.47 MeV·fm²
      const iRigid = (this.iso.A * (b * b + c * c)) / 5;
      q = iMeasured / iRigid;
      lambda = Math.min(1, Math.max(0, (q - qIrr) / (1 - qIrr)));
    }
    return { k, q, qIrr, lambda };
  }

  get rotationFlowInfo() { return this.iso ? this.#rotationFlow() : null; }

  setFlow(flow) { this.flow = flow; }

  /** Carry the nucleons with the rotational flow from clock time t0 to t1. */
  #advect(t0, t1) {
    const { k, lambda } = this.#rotationFlow();
    const L = this.flow === 'rigid' ? 1 : this.flow === 'fluid' ? 0 : lambda;
    const omega = (2 * Math.PI) / this.periods.rotation;
    const span = t1 - t0;
    const n = Math.min(60, Math.max(1, Math.ceil((omega * span) / 0.03)));
    const h = span / n;
    const { pos, inHalo } = this;
    const flow = (y, z, phi) => {
      const ca = Math.cos(phi), sa = Math.sin(phi);
      const yb = ca * y + sa * z, zb = -sa * y + ca * z; // body frame
      const vy = omega * (L * -zb + (1 - L) * k * zb);
      const vz = omega * (L * yb + (1 - L) * k * yb);
      return [ca * vy - sa * vz, sa * vy + ca * vz]; // back to the lab frame
    };
    for (let s = 0; s < n; s++) {
      const ta = omega * (t0 + s * h), tm = omega * (t0 + (s + 0.5) * h);
      for (let i = 0; i < pos.length / 3; i++) {
        if (inHalo[i]) continue;
        const y = pos[3 * i + 1], z = pos[3 * i + 2];
        const [vy1, vz1] = flow(y, z, ta);
        const [vy2, vz2] = flow(y + vy1 * h / 2, z + vz1 * h / 2, tm); // midpoint (RK2)
        pos[3 * i + 1] = y + vy2 * h;
        pos[3 * i + 2] = z + vz2 * h;
      }
    }
  }

  // ---------- dynamics ----------

  #step(dt, noise = 1) {
    const { pos, vel, force } = this;
    const n = pos.length / 3;
    force.fill(0);
    // The well is turned by the rotation angle; the nucleons are carried by the flow (#advect).
    const d = this.#drive(this.t);
    const ca = Math.cos(d.angle), sa = Math.sin(d.angle);

    // Mean field (radial Woods–Saxon force, in the rotating body frame).
    const wells = [];
    const scripted = this.event?.scripted;
    for (let i = 0; i < n; i++) {
      const w = this.#well(i, this.t, d);
      wells.push(w);
      if (scripted?.[i]) continue;
      // Body frame: rotate by −angle about x, then remove the dipole shift along body z.
      // (Fragment wells during events are simple spheres around their own centers.)
      const cw = w.center ?? [0, 0, 0];
      const cr = w.center ? 1 : ca, sr = w.center ? 0 : sa;
      const x = pos[3 * i] - cw[0], y0 = pos[3 * i + 1] - cw[1], z0 = pos[3 * i + 2] - cw[2];
      const y = cr * y0 + sr * z0, z = -sr * y0 + cr * z0 - w.shift;
      const r = Math.hypot(x, y, z) || 1e-6;
      const s = r - w.R * this.#shape(z / r, w.beta, w.beta3, w.beta1);
      const e = Math.exp(Math.min(40, s / w.a));
      const dUds = (w.V / w.a) * e / ((1 + e) * (1 + e)); // MeV/fm, pulling inward
      // Inward along the body-frame radius, rotated back to the lab frame.
      let push = -dUds;
      if (w.halo) {
        // A thermal distribution e^{−U/kT} matches the quantum halo density e^{−2κr}/r² when
        // U = kT(2κr + 2 ln r): an inward force kT(2κ + 2/r). Inside the core, whose states are
        // full (Pauli), it's pushed back out, but it still reaches the core's surface.
        push = r > w.core ? -w.kT * (2 * w.kappa + 2 / r) : 10 * (w.core - r);
        w.past = r - (w.core + 8 / w.kappa) - 3 * w.a; // far wall, only for rare stragglers
      }
      const fx = (push * x) / r, fyb = (push * y) / r, fzb = (push * z) / r;
      force[3 * i] += fx;
      force[3 * i + 1] += cr * fyb - sr * fzb;
      force[3 * i + 2] += sr * fyb + cr * fzb;
      // Outward unit vector (lab frame) and how far past the surface, for the wall below.
      w.out = [x / r, (cr * y - sr * z) / r, (sr * y + cr * z) / r];
      if (!w.halo) w.past = s;
    }

    // Short-range nucleon–nucleon force (Volkov form): repulsive core, weak attraction.
    const cut2 = NN_CUT * NN_CUT;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (scripted && (scripted[i] || scripted[j])) continue;
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
      if (scripted?.[i]) continue;
      const g = wells[i].gamma ?? GAMMA;
      const kick = noise * Math.sqrt(2 * g * wells[i].kT * ACC * dt);
      for (let k = 0; k < 3; k++) {
        const q = 3 * i + k;
        vel[q] += (force[q] * ACC - g * vel[q]) * dt + kick * this.#gauss();
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
  /** widths: { mode: Γ in MeV } for the damped giant resonances. */
  setWidths(widths) {
    this.dampTimes = Object.fromEntries(Object.entries(widths).map(([k, G]) => [k, (2 * HBAR_MEV_S) / G / 1e-23]));
  }
  setDamped(on) { this.damped = on; }
  setQuarks(on) { this.showQuarks = on; this.#applyVisibility(); }
  setField(on) { this.showField = on; this.#applyVisibility(); }
  setRuler(on) { this.showRuler = on; this.#applyVisibility(); }
  setPairs(on) { this.showPairs = on; this.#applyVisibility(); }

  setMesons(on) {
    if (!on) this.#finishMesons(); // complete exchanges in flight so the charge adds up
    this.showMesons = on;
    this.#applyVisibility();
  }
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
    this.nucleonGroup.visible = this.view === 'nucleon';
    this.orbitalGroup.visible = this.view === 'orbital';
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
    this.mesonPoints.visible = this.showMesons;
  }

  // ---------- shell-model orbital ----------

  /**
   * Show one orbital's density as a point cloud. sample: { pos, spin, count } in fm with
   * z the symmetry axis; surface: { a, c } semi-axes (fm) of the nucleus, drawn faintly.
   */
  setOrbital(sample, surface, colors, refit = false) {
    this.#disposeGroup(this.orbitalGroup);
    const g = this.orbitalGroup;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(sample.pos, 3));
    const col = new Float32Array(sample.count * 3);
    const up = new THREE.Color(colors.up), down = new THREE.Color(colors.down);
    for (let i = 0; i < sample.count; i++) (sample.spin[i] ? up : down).toArray(col, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.add(new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.22, map: dotTexture(), vertexColors: true, transparent: true, opacity: 0.8,
      depthWrite: false, blending: THREE.AdditiveBlending,
    })));
    // The nuclear surface (half-density radius) and the symmetry axis, for scale.
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 12),
      new THREE.MeshBasicMaterial({ color: '#8fa3c8', wireframe: true, transparent: true, opacity: 0.07, depthWrite: false }),
    );
    shell.rotation.x = Math.PI / 2; // the sphere's poles (local y) onto z
    shell.scale.set(surface.a, surface.c, surface.a);
    g.add(shell);
    const L = Math.max(surface.c, sample.extent ?? 0) * 1.15;
    const axis = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -L), new THREE.Vector3(0, 0, L)]),
      new THREE.LineDashedMaterial({ color: '#c9b46a', dashSize: 0.4, gapSize: 0.3, transparent: true, opacity: 0.6 }),
    );
    axis.computeLineDistances();
    const label = textSprite('symmetry axis', '#c9b46a', Math.max(0.35, L / 18));
    label.position.set(0, 0, L + 0.6);
    g.add(axis, label);
    this.orbitalExtent = Math.max(surface.c, surface.a, sample.extent * 0.6);
    if (refit && this.view === 'orbital') this.fit();
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
    } else if (this.pos && this.view === 'nucleus') {
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
    const t0 = this.t;
    for (let s = 0; s < steps; s++) {
      this.t += advance / steps;
      this.#step(stepDt);
    }
    if (!steps) this.t += advance;
    // Rotation is a flow that carries the nucleons along at the full clock rate.
    if (this.mode === 'rotation' && this.periods.rotation) this.#advect(t0, this.t);

    if (this.event) this.#tickEvent(dt);
    const A = this.iso.A;
    const out = this.drawPos;
    out.set(this.pos);
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

    if (this.showMesons) this.#updateMesons(out, dt);
    this.#updatePairs(out);
    this.onClock?.(this.t, this.lagging);
    this.statsTimer += dt;
    if (this.onStats && this.statsTimer > 0.5) {
      this.statsTimer = 0;
      this.onStats(this.#stats());
    }
  }

  // ---------- pion exchange ----------

  /** Make nucleon i a proton or a neutron (charge exchange), and recolor it. */
  #setIdentity(i, proton) {
    this.isProton[i] = proton ? 1 : 0;
    const c = new THREE.Color(proton ? PROTON_COLOR : NEUTRON_COLOR);
    c.toArray(this.baseColors, 3 * i);
    c.toArray(this.pointGeo.attributes.aColor.array, 3 * i);
    this.pointGeo.attributes.aColor.needsUpdate = true;
    this.solids.setColorAt(i, c);
    this.solids.instanceColor.needsUpdate = true;
  }

  /** Start a pion exchange between two neighbors, choosing its charge. */
  #emit(out) {
    const n = out.length / 3;
    const i = Math.floor(Math.random() * n);
    if (this.busy[i] || this.event?.scripted[i]) return;
    const r2max = PION_RANGE * PION_RANGE;
    let j = -1;
    for (let tries = 0; tries < 40; tries++) {
      const k = Math.floor(Math.random() * n);
      if (k === i || this.busy[k] || this.event?.scripted[k]) continue;
      const dx = out[3 * i] - out[3 * k], dy = out[3 * i + 1] - out[3 * k + 1], dz = out[3 * i + 2] - out[3 * k + 2];
      if (dx * dx + dy * dy + dz * dz < r2max) { j = k; break; }
    }
    if (j < 0) return;
    // Proton → neutron + π⁺, or neutron → proton + π⁻, swaps a p–n pair's identities;
    // π⁰ leaves them alone. For a p–n pair, charged exchange is twice as likely (isospin).
    const pi = this.isProton[i], pj = this.isProton[j];
    // A halo nucleon trades only π⁰ here: a charged exchange would just relabel which
    // identical neutron counts as "the halo", which this picture can't show meaningfully.
    const halo = this.inHalo[i] || this.inHalo[j];
    let type = 0;
    if (!halo && pi !== pj && Math.random() < 2 / 3) type = pi ? '+' : '-';
    if (type === '+') this.#setIdentity(i, false);
    if (type === '-') this.#setIdentity(i, true);
    this.busy[i] = this.busy[j] = 1;
    this.mesons.push({ i, j, type, halo, age: 0, lift: (Math.random() - 0.5) * 0.9 });
  }

  #updateMesons(out, dt) {
    // Keep roughly a quarter of the nucleons busy exchanging at any moment.
    const target = Math.max(1, Math.round(out.length / 3 / 4));
    for (let k = 0; k < 4 && this.mesons.length < target; k++) this.#emit(out);

    const pos = this.mesonGeo.attributes.position.array;
    const col = this.mesonGeo.attributes.aColor.array;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), side = new THREE.Vector3(), c = new THREE.Color();
    const still = [];
    for (const m of this.mesons) {
      m.age += dt / PION_FLIGHT;
      if (m.age >= 1) { this.#absorb(m); continue; }
      still.push(m);
    }
    this.mesons = still;
    still.forEach((m, k) => {
      if (k >= pos.length / 3) return;
      a.fromArray(out, 3 * m.i);
      b.fromArray(out, 3 * m.j);
      // A gentle arc from emitter to absorber.
      side.subVectors(b, a).cross(new THREE.Vector3(0.3, 0.5, 0.8)).normalize();
      const s = m.age;
      a.lerp(b, s).addScaledVector(side, m.lift * Math.sin(Math.PI * s));
      a.toArray(pos, 3 * k);
      c.set(PION_COLORS[m.type]).toArray(col, 3 * k);
    });
    this.mesonGeo.setDrawRange(0, Math.min(still.length, pos.length / 3));
    this.mesonGeo.attributes.position.needsUpdate = true;
    this.mesonGeo.attributes.aColor.needsUpdate = true;
  }

  #absorb(m) {
    if (m.type === '+') this.#setIdentity(m.j, true);
    if (m.type === '-') this.#setIdentity(m.j, false);
    this.busy[m.i] = this.busy[m.j] = 0;
    this.mesonCount[m.type]++;
    if (m.halo) this.mesonCount.halo++;
    for (const k of [m.i, m.j]) this.mesonCount[this.inHalo[k] ? 'haloInv' : 'coreInv']++;
  }

  #finishMesons() {
    for (const m of this.mesons ?? []) this.#absorb(m);
    this.mesons = [];
    this.mesonGeo?.setDrawRange(0, 0);
  }

  /** Exchanges completed so far, by pion charge. */
  get pionExchanges() { return this.mesonCount ?? { '+': 0, '-': 0, 0: 0, halo: 0, haloInv: 0, coreInv: 0 }; }

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
    const R = this.view === 'nucleon' ? (this.closeup?.R ?? 0.9) * 1.25
      : this.view === 'orbital' ? (this.orbitalExtent ?? 6) : this.#extent() + 1.5;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = R / Math.sin(Math.min(vfov, hfov) / 2);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir.multiplyScalar(dist));
    this.lastWidth = 0;
  }
}
