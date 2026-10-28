// "Powers of ten": one continuous zoom from liquid water down to a quark.
//
// Each layer is built in its own natural unit (Å for molecules and electron clouds,
// fm for the nucleus and the proton) and rescaled every frame so the view always spans
// the current width W. Layers fade in and out as they come into range, and layers far
// out of range are hidden so their coordinates never get huge.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { electronConfig, slaterZeff, orbitalOccupancy } from './electron-config.js';
import { sampleOrbital } from './orbitals.js';
import { solveAtom } from './atom-scf.js';
import { ATOM_COLORS } from './molecule-data.js';
import { PROTON_COLOR, NEUTRON_COLOR, COLOR_CHARGES } from './nucleus-viewer.js';
import { PHASE_COLORS } from './viewer.js';

const ANGSTROM = 1e-10, FM = 1e-15, BOHR_A = 0.529177;
export const ZOOM_MAX = -7.6, ZOOM_MIN = -18.5; // log10 of the view width in meters

// A small seeded random generator, so the scene is the same every time.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function textSprite(text, color, height) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '600 48px system-ui, sans-serif';
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + 16; c.height = 64;
  ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'middle';
  ctx.fillText(text, 8, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  s.scale.set((height * c.width) / c.height, height, 1);
  return s;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Smooth 0→1 ramp of log10(W) between a and b (a > b means fading in while zooming in). */
function ramp(L, a, b) {
  const t = Math.max(0, Math.min(1, (L - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class ZoomViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(9, -16, 6);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight('#e8eeff', '#1a1e2c', 1.4));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(3, 4, 6);
    this.camera.add(key);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enableZoom = false; // the wheel changes the power of ten instead
    this.controls.enablePan = false;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.4;

    this.L = -8.2; // log10(view width / m)
    this.target = this.L;
    this.playing = false;
    this.clock = new THREE.Clock();
    this.t = 0;
    this.onChange = null;
    this.glowTex = glowTexture();

    this.layers = {};
    this.#buildWater();
    this.#buildCloud();
    this.#buildNucleusMarker();
    this.#buildNucleus();
    this.#buildProton();

    this.renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.playing = false;
      this.setTarget(this.target - e.deltaY * 0.0025);
    }, { passive: false });
    new ResizeObserver(() => this.#resize()).observe(container);
    this.#resize();
  }

  setActive(on) {
    this.renderer.setAnimationLoop(on ? () => this.#tick() : null);
    if (on) { this.clock.getDelta(); this.#resize(); }
  }

  setTarget(L) { this.target = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, L)); }
  jump(L) { this.setTarget(L); this.L = this.target; }
  play() { this.playing = true; if (this.target <= ZOOM_MIN + 0.05) this.jump(ZOOM_MAX); }
  pause() { this.playing = false; }
  setAutoRotate(on) { this.controls.autoRotate = on; }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Register a layer: a group in `unit` meters whose materials fade together. */
  #layer(name, unit) {
    const group = new THREE.Group();
    this.scene.add(group);
    const layer = { group, unit, mats: [] };
    this.layers[name] = layer;
    return layer;
  }

  #track(layer, mat, base = mat.opacity ?? 1) {
    mat.transparent = true;
    mat.userData.base = base;
    layer.mats.push(mat);
    return mat;
  }

  // ---------- layers ----------

  // Liquid water around one molecule whose oxygen sits at the origin (Å).
  #buildWater() {
    const L = this.#layer('water', ANGSTROM);
    const near = this.#layer('waterNear', ANGSTROM); // the central molecule, which stays longest
    const rand = rng(7);
    const ballGeo = new THREE.SphereGeometry(1, 20, 14);
    const stickGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 10);
    const mats = (layer) => ({
      O: this.#track(layer, new THREE.MeshStandardMaterial({ color: ATOM_COLORS.O, roughness: 0.35 })),
      H: this.#track(layer, new THREE.MeshStandardMaterial({ color: ATOM_COLORS.H, roughness: 0.35 })),
      bond: this.#track(layer, new THREE.MeshStandardMaterial({ color: '#c9d3e6', roughness: 0.5 })),
    });
    const farMats = mats(L), nearMats = mats(near);
    const half = (104.52 * Math.PI) / 360, r = 0.9572;
    const addMolecule = (layer, m, origin, q) => {
      const H1 = new THREE.Vector3(Math.sin(half) * r, 0, Math.cos(half) * r).applyQuaternion(q).add(origin);
      const H2 = new THREE.Vector3(-Math.sin(half) * r, 0, Math.cos(half) * r).applyQuaternion(q).add(origin);
      const o = new THREE.Mesh(ballGeo, m.O); o.scale.setScalar(0.36); o.position.copy(origin);
      layer.group.add(o);
      for (const h of [H1, H2]) {
        const b = new THREE.Mesh(ballGeo, m.H); b.scale.setScalar(0.24); b.position.copy(h);
        const st = new THREE.Mesh(stickGeo, m.bond);
        st.position.copy(origin).lerp(h, 0.5);
        st.scale.set(1, r, 1);
        st.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), h.clone().sub(origin).normalize());
        layer.group.add(b, st);
      }
      return [H1, H2];
    };
    this.hydrogens = addMolecule(near, nearMats, new THREE.Vector3(), new THREE.Quaternion());
    // Neighbors at liquid density (~33 molecules per nm³), at least 2.7 Å apart.
    const centers = [new THREE.Vector3()];
    for (let tries = 0; centers.length < 70 && tries < 20000; tries++) {
      const p = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).multiplyScalar(11);
      if (p.length() > 11 || centers.some((c) => c.distanceTo(p) < 2.75)) continue;
      centers.push(p);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6.3, rand() * 6.3, rand() * 6.3));
      addMolecule(L, farMats, p, q);
    }
  }

  // The oxygen atom's electrons (and the two hydrogens' 1s clouds), as |ψ|² samples (Å).
  #buildCloud() {
    const L = this.#layer('cloud', ANGSTROM);
    const z = 8;
    const config = electronConfig(z);
    const scf = solveAtom(z, config);
    const pos = [], col = [];
    const pc = new THREE.Color(PHASE_COLORS.pos), nc = new THREE.Color(PHASE_COLORS.neg);
    for (const s of config) {
      const zeff = slaterZeff(z, config, s.n, s.l);
      orbitalOccupancy(s.l, s.count).forEach((occ, k) => {
        if (!occ) return;
        const { positions, signs } = sampleOrbital(s.n, s.l, k, zeff, 2600 * occ, scf.orbitals.get(`${s.n}${s.l}`));
        for (let i = 0; i < signs.length; i++) {
          pos.push(positions[i * 3] * BOHR_A, positions[i * 3 + 1] * BOHR_A, positions[i * 3 + 2] * BOHR_A);
          (signs[i] > 0 ? pc : nc).toArray(col, col.length);
        }
      });
    }
    for (const h of this.hydrogens) {
      const { positions } = sampleOrbital(1, 0, 0, 1, 2200);
      for (let i = 0; i < positions.length; i += 3) {
        pos.push(h.x + positions[i] * BOHR_A, h.y + positions[i + 1] * BOHR_A, h.z + positions[i + 2] * BOHR_A);
        pc.toArray(col, col.length);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mat = this.#track(L, new THREE.PointsMaterial({
      size: 2.4, sizeAttenuation: false, vertexColors: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    L.group.add(new THREE.Points(geo, mat));
  }

  // While the nucleus is far too small to draw, a fixed-size glint marks where it is.
  #buildNucleusMarker() {
    const L = this.#layer('marker', null); // fixed screen size: never rescaled
    const s = new THREE.Sprite(this.#track(L, new THREE.SpriteMaterial({ map: this.glowTex, color: '#ffd75e', depthTest: false, sizeAttenuation: false })));
    s.scale.set(0.035, 0.035, 1);
    s.renderOrder = 5;
    L.group.add(s);
    this.markerLabel = textSprite('nucleus (not to scale)', '#ffd75e', 0.03);
    this.markerLabel.material.sizeAttenuation = false;
    this.markerLabel.center.set(-0.08, 0.5);
    this.#track(L, this.markerLabel.material);
    L.group.add(this.markerLabel);
  }

  // Oxygen-16: 8 protons and 8 neutrons (fm), with one proton at the origin.
  #buildNucleus() {
    const L = this.#layer('nucleus', FM);
    const rand = rng(16);
    const pts = [new THREE.Vector3(0.35, -0.2, 0.15)];
    for (let tries = 0; pts.length < 16 && tries < 50000; tries++) {
      const p = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).multiplyScalar(2.7);
      if (p.length() > 2.7 || pts.some((q) => q.distanceTo(p) < 1.45)) continue;
      pts.push(p);
    }
    // Shift so the first proton sits exactly at the center of the zoom.
    const shift = pts[0].clone();
    pts.forEach((p) => p.sub(shift));
    const geo = new THREE.SphereGeometry(0.84, 32, 20);
    const protonMat = this.#track(L, new THREE.MeshStandardMaterial({ color: PROTON_COLOR, roughness: 0.4 }));
    const neutronMat = this.#track(L, new THREE.MeshStandardMaterial({ color: NEUTRON_COLOR, roughness: 0.4 }));
    pts.forEach((p, i) => {
      if (i === 0) return; // the central proton belongs to the proton layer
      const m = new THREE.Mesh(geo, i < 8 ? protonMat : neutronMat);
      m.position.copy(p);
      L.group.add(m);
    });
  }

  // The proton at the origin: a bag around three valence quarks joined by gluon
  // flux tubes. The zoom centers on one up quark (fm).
  #buildProton() {
    const Q = this.#layer('quarks', FM);
    this.bagMat = this.#track(Q, new THREE.MeshStandardMaterial({ color: PROTON_COLOR, roughness: 0.4, depthWrite: false }));
    const bag = new THREE.Mesh(new THREE.SphereGeometry(0.84, 40, 26), this.bagMat);
    bag.renderOrder = 2;
    Q.group.add(bag);
    this.quarks = ['u', 'u', 'd'].map((flavor, k) => {
      const mat = this.#track(Q, new THREE.MeshStandardMaterial({ color: COLOR_CHARGES[k], emissive: COLOR_CHARGES[k], emissiveIntensity: 0.5, roughness: 0.3 }));
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
      const glow = new THREE.Sprite(this.#track(Q, new THREE.SpriteMaterial({ map: this.glowTex, color: COLOR_CHARGES[k], depthWrite: false, blending: THREE.AdditiveBlending }), 0.8));
      const label = textSprite(`${flavor} ${flavor === 'u' ? '+⅔' : '−⅓'}`, '#ffffff', 1);
      this.#track(Q, label.material);
      Q.group.add(mesh, glow, label);
      return { mesh, glow, label, mat, flavor, phase: (k * 2 * Math.PI) / 3 };
    });
    this.tubes = [0, 1, 2].map(() => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(40 * 3), 3));
      const line = new THREE.Line(geo, this.#track(Q, new THREE.LineBasicMaterial({ color: '#ffe9a8' }), 0.85));
      Q.group.add(line);
      return line;
    });
    this.colorPerm = 0;
    this.nextSwap = 0.5;
  }

  // ---------- animation ----------

  #tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.t += dt;
    if (this.playing) {
      // Slow down near the interesting scales, speed through the empty ones.
      const empty = this.L < -10.6 && this.L > -13.4;
      this.setTarget(this.target - dt * (empty ? 0.9 : 0.42));
      if (this.target <= ZOOM_MIN) this.playing = false;
    }
    this.L += (this.target - this.L) * Math.min(1, dt * 6);
    this.#layout();
    this.#animateQuarks(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.onChange?.(this.L, this.playing);
  }

  #layout() {
    const L = this.L, W = 10 ** L;
    const dist = this.camera.position.length();
    const viewW = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
    const unitsPerMeter = viewW / W;
    // Opacity of each layer as a function of log10(W).
    const fade = {
      water: ramp(L, -9.15, -8.75),
      waterNear: ramp(L, -9.75, -9.4),
      cloud: ramp(L, -9.0, -9.6) * ramp(L, -12.9, -12.4),
      marker: ramp(L, -9.7, -10.3) * ramp(L, -13.3, -12.7),
      nucleus: ramp(L, -13.0, -13.5) * ramp(L, -14.6, -14.3),
      quarks: ramp(L, -13.0, -13.5),
    };
    for (const [name, layer] of Object.entries(this.layers)) {
      const k = layer.unit ? unitsPerMeter * layer.unit : 1;
      const a = fade[name] ?? 0;
      // Skip layers that are invisible or whose coordinates would be enormous.
      layer.group.visible = a > 0.003 && k < 1e5;
      if (!layer.group.visible) continue;
      layer.group.scale.setScalar(k);
      for (const m of layer.mats) m.opacity = m.userData.base * a;
    }
    // The central proton's bag turns see-through to reveal its quarks.
    this.bagMat.opacity = fade.quarks * (0.12 + 0.88 * ramp(L, -14.7, -14.4));
    // Quarks: drawn small, and never bigger than a dot on screen, since no size has been found.
    const Wfm = W / FM;
    this.quarkRadius = Math.min(0.07, 0.012 * Wfm);
    this.markerLabel.visible = L > -12.4;
  }

  #animateQuarks(dt) {
    if (!this.layers.quarks.group.visible) return;
    const t = this.t;
    const P = this.quarks.map((q, k) => {
      if (k === 0) { // the up quark we zoom into: a jitter that shrinks with the view so it stays in frame
        const j = Math.min(0.012, 0.08 * 10 ** this.L / FM);
        return new THREE.Vector3(j * Math.sin(t * 3), j * Math.cos(t * 2.3), 0);
      }
      const a = q.phase + t * 0.7;
      return new THREE.Vector3(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.18 * Math.sin(t * 1.1 + k)).add(new THREE.Vector3(-0.25, 0, 0));
    });
    const W = 10 ** this.L / FM;
    this.quarks.forEach((q, k) => {
      q.mesh.position.copy(P[k]);
      q.mesh.scale.setScalar(this.quarkRadius);
      q.glow.position.copy(P[k]);
      q.glow.scale.setScalar(this.quarkRadius * 6);
      q.label.position.copy(P[k]).add(new THREE.Vector3(0, 0, this.quarkRadius + 0.03 * W));
      q.label.visible = this.L < -14.55; // only once the bag is see-through
      const h = 0.045 * W;
      q.label.scale.set(h * (q.label.scale.x / q.label.scale.y), h, 1);
    });
    this.tubes.forEach((line, k) => {
      const a = P[k], b = P[(k + 1) % 3];
      const arr = line.geometry.attributes.position.array;
      const dir = b.clone().sub(a);
      const side = dir.clone().cross(new THREE.Vector3(0, 0, 1)).normalize();
      for (let i = 0; i < 40; i++) {
        const s = i / 39;
        const p = a.clone().lerp(b, s).addScaledVector(side, Math.sin(Math.PI * s) * 0.03 * Math.sin(s * 20 - t * 12 + k));
        arr.set([p.x, p.y, p.z], i * 3);
      }
      line.geometry.attributes.position.needsUpdate = true;
    });
    this.nextSwap -= dt;
    if (this.nextSwap <= 0) { // a gluon carries color from one quark to another
      this.colorPerm = (this.colorPerm + 1) % 3;
      this.nextSwap = 0.4 + Math.random() * 0.5;
      this.quarks.forEach((q, k) => {
        const c = COLOR_CHARGES[(k + this.colorPerm) % 3];
        q.mat.color.set(c); q.mat.emissive.set(c); q.glow.material.color.set(c);
      });
    }
  }
}
