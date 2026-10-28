import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { sampleOrbital, orbitalRadius, psiField } from './orbitals.js';

export const SUBSHELL_COLORS = ['#7dd3fc', '#f472b6', '#a3e635', '#fbbf24'];
export const PHASE_COLORS = { pos: '#ff9a4d', neg: '#3fb5ff' };

const BOHR_TO_ANGSTROM = 0.529177;
const SURFACE_RES = 48;

const CLOUD_VERT = /* glsl */ `
  attribute float aSign;
  uniform float uSize;
  uniform float uScale;
  uniform float uPhase;
  uniform vec3 uBase;
  uniform vec3 uPos;
  uniform vec3 uNeg;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSize * uScale / -mv.z, 1.0, 48.0);
    vColor = mix(uBase, aSign > 0.0 ? uPos : uNeg, uPhase);
  }
`;

const CLOUD_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c);
    if (d2 > 0.25) discard;
    gl_FragColor = vec4(vColor, exp(-d2 * 14.0) * uOpacity);
  }
`;

const ELECTRON_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  uniform float uScale;
  varying vec3 vColor;
  varying float vHidden;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vHidden = aSize <= 0.0 ? 1.0 : 0.0;
    gl_PointSize = aSize <= 0.0 ? 0.0 : clamp(aSize * uScale / -mv.z, 6.0, 30.0);
    vColor = aColor;
  }
`;

const ELECTRON_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vHidden;
  void main() {
    if (vHidden > 0.5) discard;
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = smoothstep(0.2, 0.05, d);
    float halo = exp(-d * d * 18.0) * 0.7;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), core), max(core, halo));
  }
`;

function textSprite(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 32, 34);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), depthWrite: false, transparent: true,
  }));
  return sprite;
}

export class AtomViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.0005, 5000);
    this.camera.up.set(0, 0, 1); // chemistry convention: z is up
    this.camera.position.set(14, -22, 10);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.8;
    this.controls.minDistance = 0.001;
    this.userMoved = false;
    this.controls.addEventListener('start', () => { this.userMoved = true; this.fitAnim = null; });
    this.pixelScale = 1000;

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.scene.add(new THREE.HemisphereLight('#dfe8ff', '#202436', 1.6));
    const key = new THREE.DirectionalLight('#ffffff', 1.8);
    key.position.set(3, -4, 6);
    this.camera.add(key); // light follows the camera
    this.scene.add(this.camera);

    this.nucleus = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.MeshBasicMaterial({ color: '#ff5d5d' }),
    );
    this.scene.add(this.nucleus);

    this.axes = this.#buildAxes();
    this.axes.visible = false;
    this.scene.add(this.axes);

    this.orbitals = new Map(); // id -> { points, material, samples, radius, l, visible }
    this.electrons = null;
    this.style = 'cloud';
    this.showElectrons = true;
    this.surfaces = new Map(); // id -> [mesh, ...], built on demand
    this.surfaceQueue = [];
    this.onBusy = null;
    this.colorMode = 'phase';
    this.density = 1;
    this.highlightIds = null;
    this.fitAnim = null;
    this.onScaleChange = null;
    this.clock = new THREE.Clock();

    new ResizeObserver(() => this.#resize()).observe(container);
    this.#resize();
    this.renderer.setAnimationLoop(() => this.#tick());
  }

  #buildAxes() {
    const group = new THREE.Group();
    const dirs = [
      ['x', new THREE.Vector3(1, 0, 0), '#ff6b6b'],
      ['y', new THREE.Vector3(0, 1, 0), '#6bff8f'],
      ['z', new THREE.Vector3(0, 0, 1), '#6bb5ff'],
    ];
    for (const [label, dir, color] of dirs) {
      const geom = new THREE.BufferGeometry().setFromPoints([dir.clone().multiplyScalar(-1), dir]);
      const line = new THREE.Line(geom, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 }));
      const sprite = textSprite(label, color);
      sprite.position.copy(dir).multiplyScalar(1.1);
      sprite.scale.setScalar(0.12);
      group.add(line, sprite);
    }
    return group;
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pixelScale = this.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    for (const o of this.orbitals.values()) o.material.uniforms.uScale.value = this.pixelScale;
    if (this.electrons) this.electrons.material.uniforms.uScale.value = this.pixelScale;
    if (!this.userMoved && this.orbitals.size) this.fit(false);
  }

  /**
   * subshells: [{ n, l, zeff, orbitals: [{ id, k, occ }] }]
   */
  setAtom(subshells) {
    this.subshells = subshells;
    this.#clear(); // drop visibility carried over from the previous atom
    this.#clearSurfaces();
    this.userMoved = false;
    this.#rebuild();
    this.fit(false);
  }

  #clear() {
    for (const o of this.orbitals.values()) {
      o.points.geometry.dispose();
      o.material.dispose();
      this.root.remove(o.points);
    }
    this.orbitals.clear();
    if (this.electrons) {
      this.electrons.points.geometry.dispose();
      this.electrons.material.dispose();
      this.root.remove(this.electrons.points);
      this.electrons = null;
    }
  }

  #rebuild() {
    const prevVisible = new Map([...this.orbitals].map(([id, o]) => [id, o.visible]));
    this.#clear();
    const electronList = [];

    for (const sub of this.subshells) {
      const radius = orbitalRadius(sub.n, sub.l, sub.zeff, 0.9);
      for (const orb of sub.orbitals) {
        if (!orb.occ) continue;
        const count = Math.round(3200 * this.density * (orb.occ === 2 ? 1 : 0.6));
        const { positions, signs } = sampleOrbital(sub.n, sub.l, orb.k, sub.zeff, count);
        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geom.setAttribute('aSign', new THREE.BufferAttribute(signs, 1));
        geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 3);

        const material = new THREE.ShaderMaterial({
          vertexShader: CLOUD_VERT,
          fragmentShader: CLOUD_FRAG,
          uniforms: {
            uSize: { value: radius * 0.045 },
            uScale: { value: this.pixelScale },
            uPhase: { value: this.colorMode === 'phase' ? 1 : 0 },
            uBase: { value: new THREE.Color(SUBSHELL_COLORS[sub.l]) },
            uPos: { value: new THREE.Color(PHASE_COLORS.pos) },
            uNeg: { value: new THREE.Color(PHASE_COLORS.neg) },
            uOpacity: { value: 0.5 },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const points = new THREE.Points(geom, material);
        this.root.add(points);
        const visible = prevVisible.get(orb.id) ?? true;
        this.orbitals.set(orb.id, {
          points, material, positions, radius, visible,
          n: sub.n, l: sub.l, k: orb.k, zeff: sub.zeff,
        });

        for (let e = 0; e < orb.occ; e++) electronList.push({ id: orb.id, radius, l: sub.l, positions });
      }
    }

    this.#buildElectrons(electronList);
    this.#applyVisibility();
  }

  #buildElectrons(list) {
    const n = list.length;
    const pos = new Float32Array(n * 3);
    const color = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const state = list.map((e, i) => {
      const c = new THREE.Color(SUBSHELL_COLORS[e.l]);
      color.set([c.r, c.g, c.b], i * 3);
      const s = {
        ...e,
        from: this.#randomSample(e.positions),
        to: this.#randomSample(e.positions),
        t: Math.random(),
        dur: 0.6 + Math.random() * 0.9,
      };
      return s;
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
    geom.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    const material = new THREE.ShaderMaterial({
      vertexShader: ELECTRON_VERT,
      fragmentShader: ELECTRON_FRAG,
      uniforms: { uScale: { value: this.pixelScale } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geom, material);
    points.renderOrder = 1;
    this.root.add(points);
    this.electrons = { points, material, state };
  }

  #randomSample(positions) {
    const i = Math.floor(Math.random() * (positions.length / 3)) * 3;
    return new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
  }

  #clearSurfaces() {
    for (const meshes of this.surfaces.values()) {
      for (const m of meshes) {
        m.geometry.dispose();
        m.material.dispose();
        this.root.remove(m);
      }
    }
    this.surfaces.clear();
    this.surfaceQueue = [];
  }

  // Build queued surfaces a few at a time so heavy atoms don't freeze the page.
  #drainSurfaceQueue() {
    if (!this.surfaceQueue.length) return;
    const start = performance.now();
    while (this.surfaceQueue.length && performance.now() - start < 14) {
      const id = this.surfaceQueue.shift();
      const o = this.orbitals.get(id);
      if (o && !this.surfaces.has(id)) this.surfaces.set(id, this.#buildSurface(o));
    }
    this.#applyVisibility();
    this.onBusy?.(this.surfaceQueue.length ? `Building surfaces… ${this.surfaceQueue.length} left` : '');
  }

  // Isosurfaces enclosing ~85% of each lobe's probability, one mesh per phase.
  #buildSurface(o) {
    this.mc ??= new MarchingCubes(SURFACE_RES, new THREE.MeshBasicMaterial(), false, false, 60000);
    const mc = this.mc;
    const extent = orbitalRadius(o.n, o.l, o.zeff, 0.97) * 1.05;
    const { field, iso } = psiField(o.n, o.l, o.k, o.zeff, SURFACE_RES, extent);
    const meshes = [];
    for (const sign of [1, -1]) {
      mc.reset();
      for (let i = 0; i < field.length; i++) mc.field[i] = sign * field[i];
      mc.isolation = iso;
      mc.update();
      if (!mc.count) continue;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(mc.positionArray.slice(0, mc.count * 3), 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(mc.normalArray.slice(0, mc.count * 3), 3));
      const material = new THREE.MeshStandardMaterial({
        transparent: true, roughness: 0.4, metalness: 0.05, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geom, material);
      mesh.userData.sign = sign;
      mesh.userData.l = o.l;
      mesh.scale.setScalar(extent);
      mesh.renderOrder = -1 / o.radius; // inner orbitals first so outer ones blend over them
      this.root.add(mesh);
      meshes.push(mesh);
    }
    this.#colorSurface(meshes);
    return meshes;
  }

  #colorSurface(meshes) {
    for (const m of meshes) {
      const { sign, l } = m.userData;
      const color = this.colorMode === 'phase'
        ? new THREE.Color(sign > 0 ? PHASE_COLORS.pos : PHASE_COLORS.neg)
        : new THREE.Color(SUBSHELL_COLORS[l]).multiplyScalar(sign > 0 ? 1 : 0.6);
      m.material.color.copy(color);
    }
  }

  #applyVisibility() {
    const surface = this.style === 'surface';
    for (const [id, o] of this.orbitals) {
      const dim = this.highlightIds && !this.highlightIds.has(id);
      o.points.visible = !surface && o.visible;
      o.material.uniforms.uOpacity.value = dim ? 0.06 : 0.45;

      if (surface && o.visible && !this.surfaces.has(id) && !this.surfaceQueue.includes(id)) {
        this.surfaceQueue.push(id);
      }
      for (const m of this.surfaces.get(id) || []) {
        m.visible = surface && o.visible;
        // s shells are closed spheres that would hide everything inside them
        m.material.opacity = dim ? 0.06 : o.l === 0 ? 0.22 : 0.62;
        m.material.depthWrite = !dim;
      }
    }
    if (this.electrons) {
      this.electrons.points.visible = this.showElectrons;
      const size = this.electrons.points.geometry.attributes.aSize;
      this.electrons.state.forEach((e, i) => {
        const o = this.orbitals.get(e.id);
        const dim = this.highlightIds && !this.highlightIds.has(e.id);
        size.array[i] = o.visible && !dim ? e.radius * 0.09 : 0;
      });
      size.needsUpdate = true;
    }
  }

  setOrbitalVisible(id, visible) {
    const o = this.orbitals.get(id);
    if (o) o.visible = visible;
    this.#applyVisibility();
  }

  setHighlight(ids) {
    this.highlightIds = ids && ids.size ? ids : null;
    this.#applyVisibility();
  }

  setStyle(style) {
    this.style = style;
    this.#applyVisibility();
    this.fit();
  }

  setElectronsVisible(on) {
    this.showElectrons = on;
    this.#applyVisibility();
  }

  setColorMode(mode) {
    this.colorMode = mode;
    for (const o of this.orbitals.values()) o.material.uniforms.uPhase.value = mode === 'phase' ? 1 : 0;
    for (const meshes of this.surfaces.values()) this.#colorSurface(meshes);
  }

  setDensity(d) {
    this.density = d;
    if (this.subshells) this.#rebuild();
  }

  setAutoRotate(on) { this.controls.autoRotate = on; }

  setAxesVisible(on) { this.axes.visible = on; }

  /** Frame the visible orbitals. */
  fit(animate = true) {
    let r = 0;
    for (const o of this.orbitals.values()) if (o.visible) r = Math.max(r, o.radius);
    if (!r) r = Math.max(...[...this.orbitals.values()].map(o => o.radius), 1);

    this.nucleus.scale.setScalar(r * 0.018);
    this.axes.scale.setScalar(r * 1.25);

    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const pad = this.style === 'surface' ? 1.4 : 1.15; // surfaces reach past the 90% radius along lobes
    const dist = (r * pad) / Math.sin(Math.min(vfov, hfov) / 2);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const to = dir.multiplyScalar(dist);

    if (!animate) {
      this.controls.target.set(0, 0, 0);
      this.camera.position.copy(to);
      this.fitAnim = null;
      return;
    }
    this.fitAnim = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      to,
      t: 0,
    };
  }

  #tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);

    if (this.fitAnim) {
      const a = this.fitAnim;
      a.t = Math.min(a.t + dt / 0.6, 1);
      const k = 1 - Math.pow(1 - a.t, 3);
      // Interpolate distance on a log scale so large zoom changes feel even.
      const d0 = a.fromPos.distanceTo(a.fromTarget);
      const d1 = a.to.length();
      const d = Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * k);
      this.controls.target.lerpVectors(a.fromTarget, new THREE.Vector3(), k);
      const dir = a.fromPos.clone().sub(a.fromTarget).normalize().lerp(a.to.clone().normalize(), k).normalize();
      this.camera.position.copy(this.controls.target).addScaledVector(dir, d);
      if (a.t >= 1) this.fitAnim = null;
    }

    if (this.electrons && this.electrons.points.visible) {
      const pos = this.electrons.points.geometry.attributes.position;
      this.electrons.state.forEach((e, i) => {
        e.t += dt / e.dur;
        if (e.t >= 1) {
          e.t = 0;
          e.from = e.to;
          e.to = this.#randomSample(e.positions);
          e.dur = 0.6 + Math.random() * 0.9;
        }
        const k = e.t * e.t * (3 - 2 * e.t);
        pos.array[i * 3] = e.from.x + (e.to.x - e.from.x) * k;
        pos.array[i * 3 + 1] = e.from.y + (e.to.y - e.from.y) * k;
        pos.array[i * 3 + 2] = e.from.z + (e.to.z - e.from.z) * k;
      });
      pos.needsUpdate = true;
    }

    this.#drainSurfaceQueue();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    if (this.onScaleChange) {
      const dist = this.camera.position.distanceTo(this.controls.target);
      const height = 2 * dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
      const widthA = height * this.camera.aspect * BOHR_TO_ANGSTROM;
      if (Math.abs(widthA - (this.lastWidth || 0)) / widthA > 0.01) {
        this.lastWidth = widthA;
        this.onScaleChange(widthA);
      }
    }
  }
}
