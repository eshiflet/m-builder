import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { radiusFm, NUCLEONS } from './nucleus-data.js';

// Lengths are in femtometers (1 fm = 10⁻¹⁵ m).
const NUCLEON_R = 0.95; // display radius: nucleons at nuclear density nearly touch
export const PROTON_COLOR = '#ff5a4f';
export const NEUTRON_COLOR = '#9fb6cc';
export const COLOR_CHARGES = ['#ff4d6d', '#3ddc84', '#4d8dff']; // "red", "green", "blue"
const DISPLAY_PERIOD = 1.8; // seconds per oscillation on screen

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

// Seeded random numbers so each element's nucleus is laid out the same way every time.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class NucleusViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(14, -22, 10);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight('#e8eeff', '#1a1e2c', 1.4));
    const key = new THREE.DirectionalLight('#ffffff', 2.4);
    key.position.set(3, 4, 6);
    this.camera.add(key);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.6;

    this.nucleusGroup = new THREE.Group();
    this.nucleonGroup = new THREE.Group(); // single proton / neutron close-up
    this.scene.add(this.nucleusGroup, this.nucleonGroup);

    this.mode = 'dipole';
    this.view = 'nucleus';
    this.motion = true;
    this.showQuarks = false;
    this.speed = 1;
    this.t = 0;
    this.clock = new THREE.Clock();
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
  }

  #disposeGroup(group) {
    group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
    group.clear();
  }

  /** iso: { Z, N, A }, beta: quadrupole deformation. */
  setNucleus(iso, beta) {
    this.iso = iso;
    this.beta = beta;
    this.renderPos = null;
    this.#disposeGroup(this.nucleusGroup);
    const { Z, A } = iso;
    const R = radiusFm(A);
    // Prolate spheroid of the same volume: c along z, a across.
    const eps = 0.95 * beta;
    this.axes = { a: R / Math.sqrt(1 + eps), c: R * (1 + eps) };

    // Pack A nucleons into the spheroid: random placement, then push apart.
    const rand = mulberry32(Z * 1000 + A);
    const pos = new Float32Array(A * 3);
    const { a, c } = this.axes;
    for (let i = 0; i < A; i++) {
      let x, y, z;
      do {
        x = (rand() * 2 - 1) * a; y = (rand() * 2 - 1) * a; z = (rand() * 2 - 1) * c;
      } while ((x * x + y * y) / (a * a) + (z * z) / (c * c) > 1);
      pos.set([x, y, z], i * 3);
    }
    this.pos = pos;
    this.vel = new Float32Array(A * 3);
    for (let k = 0; k < 120; k++) this.#relax(0.5, 0);

    // Protons and neutrons, mixed at random.
    const isProton = new Uint8Array(A);
    const order = [...Array(A).keys()].sort(() => rand() - 0.5);
    for (let i = 0; i < Z; i++) isProton[order[i]] = 1;
    this.isProton = isProton;

    const geo = new THREE.SphereGeometry(NUCLEON_R, 24, 16);
    this.nucleonMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05, transparent: true, opacity: 1 });
    this.nucleons = new THREE.InstancedMesh(geo, this.nucleonMat, A);
    const pc = new THREE.Color(PROTON_COLOR), nc = new THREE.Color(NEUTRON_COLOR);
    for (let i = 0; i < A; i++) this.nucleons.setColorAt(i, isProton[i] ? pc : nc);
    this.nucleons.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nucleusGroup.add(this.nucleons);

    // Quarks: three per nucleon, each orbiting in its own randomly tilted plane.
    this.quarkFrames = [];
    for (let i = 0; i < A; i++) {
      const u = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
      const w = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).cross(u).normalize();
      this.quarkFrames.push({ u, w, phase: rand() * Math.PI * 2, rate: 2 + rand() * 2, perm: Math.floor(rand() * 3), next: rand() });
    }
    this.quarks = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 14, 10), new THREE.MeshStandardMaterial({ roughness: 0.3, emissiveIntensity: 0.4 }), A * 3);
    this.quarks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.gluonGeo = new THREE.BufferGeometry();
    this.gluonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(A * 3 * 2 * 3), 3));
    this.gluons = new THREE.LineSegments(this.gluonGeo, new THREE.LineBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.55 }));
    this.nucleusGroup.add(this.quarks, this.gluons);
    this.#colorQuarks();

    // A faint surface: one shell normally, a proton shell and a neutron shell for the dipole mode.
    const shellMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.BackSide });
    const unit = new THREE.SphereGeometry(1, 48, 32);
    this.shell = new THREE.Mesh(unit, shellMat('#cfd8ea', 0.08));
    this.shellP = new THREE.Mesh(unit.clone(), shellMat(PROTON_COLOR, 0.1));
    this.shellN = new THREE.Mesh(unit.clone(), shellMat(NEUTRON_COLOR, 0.1));
    this.nucleusGroup.add(this.shell, this.shellP, this.shellN);

    this.#applyVisibility();
    this.fit();
  }

  // Soft-sphere repulsion between nucleons plus a spheroidal wall; adds thermal-like kicks.
  #relax(stiffness, kick) {
    const { pos, vel } = this;
    const n = pos.length / 3;
    const { a, c } = this.axes;
    const d0 = 2 * NUCLEON_R * 0.92;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[3 * i] - pos[3 * j], dy = pos[3 * i + 1] - pos[3 * j + 1], dz = pos[3 * i + 2] - pos[3 * j + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= d0 * d0 || d2 < 1e-8) continue;
        const d = Math.sqrt(d2);
        const f = (stiffness * (d0 - d)) / d;
        vel[3 * i] += dx * f; vel[3 * i + 1] += dy * f; vel[3 * i + 2] += dz * f;
        vel[3 * j] -= dx * f; vel[3 * j + 1] -= dy * f; vel[3 * j + 2] -= dz * f;
      }
    }
    for (let i = 0; i < n; i++) {
      const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
      const ia = a - NUCLEON_R * 0.6, ic = c - NUCLEON_R * 0.6;
      const s = Math.sqrt((x * x + y * y) / (ia * ia) + (z * z) / (ic * ic));
      if (s > 1) { // pull back inside the surface
        const k = stiffness * (1 - 1 / s);
        vel[3 * i] -= x * k; vel[3 * i + 1] -= y * k; vel[3 * i + 2] -= z * k;
      }
      for (let k = 0; k < 3; k++) {
        vel[3 * i + k] = (vel[3 * i + k] + (Math.random() - 0.5) * kick) * 0.82;
        pos[3 * i + k] += vel[3 * i + k];
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

  setMode(mode) { this.mode = mode; this.#applyVisibility(); }
  setMotion(on) { this.motion = on; }
  setSpeed(s) { this.speed = s; }
  setQuarks(on) { this.showQuarks = on; this.#applyVisibility(); }
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
    if (!this.nucleons) return;
    this.quarks.visible = this.gluons.visible = this.showQuarks;
    this.nucleonMat.opacity = this.showQuarks ? 0.22 : 1;
    this.nucleonMat.depthWrite = !this.showQuarks;
    const dipole = this.mode === 'dipole';
    this.shell.visible = !dipole;
    this.shellP.visible = this.shellN.visible = dipole;
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
    this.t += dt * this.speed;
    if (this.view === 'nucleon' && this.closeup) {
      this.#tickNucleon(dt * this.speed, this.t);
    } else if (this.nucleons) {
      this.#tickNucleus(dt * this.speed);
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
    const { iso } = this;
    if (this.motion && dt > 0) this.#relax(0.25, 0.09 * Math.min(1, this.speed));
    const phase = (2 * Math.PI * this.t) / DISPLAY_PERIOD;
    const s = Math.sin(phase);
    const { a, c } = this.axes;
    const A = iso.A, Z = iso.Z, N = iso.N;
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);

    // Each mode is a displacement pattern applied to the jostling nucleons (amplitudes exaggerated).
    let sx = 1, sz = 1, shiftP = 0, shiftN = 0;
    if (this.mode === 'breathing') { sx = sz = 1 + 0.12 * s; }
    else if (this.mode === 'quadrupole') { sz = 1 + 0.2 * s; sx = 1 / Math.sqrt(sz); }
    else if (this.mode === 'dipole' && A > 1) {
      const amp = 0.18 * a; // protons one way, neutrons the other; the center of mass stays put
      shiftP = (amp * s * N) / A;
      shiftN = (-amp * s * Z) / A;
    }
    const spin = this.mode === 'rotation' ? this.t * 1.2 : 0;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spin);

    const out = this.renderPos ??= new Float32Array(A * 3);
    for (let i = 0; i < A; i++) {
      p.set(this.pos[3 * i] * sx, this.pos[3 * i + 1] * sx, this.pos[3 * i + 2] * sz);
      p.z += this.isProton[i] ? shiftP : shiftN;
      p.applyQuaternion(rot);
      out.set([p.x, p.y, p.z], i * 3);
      m.compose(p, q, one);
      this.nucleons.setMatrixAt(i, m);
    }
    this.nucleons.instanceMatrix.needsUpdate = true;

    this.shell.scale.set(a * sx + NUCLEON_R * 0.4, a * sx + NUCLEON_R * 0.4, c * sz + NUCLEON_R * 0.4);
    this.shell.quaternion.copy(rot);
    for (const [shell, shift] of [[this.shellP, shiftP], [this.shellN, shiftN]]) {
      shell.scale.set(a + 0.3, a + 0.3, c + 0.3);
      shell.position.set(0, 0, shift);
    }

    if (this.showQuarks) {
      const pos = this.gluonGeo.attributes.position.array;
      const qp = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
      let recolor = false;
      for (let i = 0; i < A; i++) {
        const f = this.quarkFrames[i];
        const ang = f.phase + this.t * f.rate;
        for (let k = 0; k < 3; k++) {
          const t = ang + (k * 2 * Math.PI) / 3;
          qp[k].set(out[3 * i], out[3 * i + 1], out[3 * i + 2])
            .addScaledVector(f.u, Math.cos(t) * 0.45)
            .addScaledVector(f.w, Math.sin(t) * 0.45);
          m.compose(qp[k], q, one);
          this.quarks.setMatrixAt(3 * i + k, m);
        }
        for (let k = 0; k < 3; k++) {
          const a0 = qp[k], b0 = qp[(k + 1) % 3];
          pos.set([a0.x, a0.y, a0.z, b0.x, b0.y, b0.z], (3 * i + k) * 6);
        }
        f.next -= dt * 2;
        if (f.next <= 0) { f.perm = (f.perm + 1) % 3; f.next = 0.3 + Math.random() * 0.7; recolor = true; }
      }
      this.quarks.instanceMatrix.needsUpdate = true;
      this.gluonGeo.attributes.position.needsUpdate = true;
      if (recolor) this.#colorQuarks();
    }
  }

  fit() {
    const R = this.view === 'nucleon' ? (this.closeup?.R ?? 0.9) * 1.25 : this.iso ? Math.max(this.axes.a, this.axes.c) + NUCLEON_R * 1.5 : 5;
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = R / Math.sin(Math.min(vfov, hfov) / 2);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir.multiplyScalar(dist));
    this.lastWidth = 0;
  }
}
