import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { ATOM_COLORS, COVALENT_RADIUS, IONIC_RADIUS } from './molecule-data.js';
import { ELEMENTS, CATEGORIES } from './elements.js';
import { electronConfig, slaterZeff } from './electron-config.js';
import { atomDensityTable } from './orbitals.js';
import { solveAtom } from './atom-scf.js';
import { PHASE_COLORS } from './viewer.js';
import { chargeText } from './molecule.js';

const BOHR = 0.529177; // Å
const DENSITY_RES = 64;
const ANGLE_COLOR = '#ffd75e';
const LONE_PAIR_COLOR = '#b9a6ff';
export const HBOND_COLOR = '#56d8ff';
export const SIGMA_COLOR = '#45d6b0';
export const H1S_COLOR = '#cfe3ff';
const Y = new THREE.Vector3(0, 1, 0);

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export function atomColor(symbol) {
  if (ATOM_COLORS[symbol]) return ATOM_COLORS[symbol];
  const el = ELEMENTS.find((e) => e.symbol === symbol);
  return CATEGORIES[el.category].color;
}

export const TRANSFER_COLOR = '#ffb347';

// Ions are drawn at their ionic size (small cations, large anions); atoms at covalent size.
const ballRadius = (a) => (a.charge
  ? 0.45 * (IONIC_RADIUS[a.symbol] ?? 1.4)
  : 0.2 + 0.18 * (COVALENT_RADIUS[a.symbol] ?? 1.4));

function textSprite(text, { color = '#ffffff', height = 0.22, weight = 600 } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = `${weight} 64px system-ui, -apple-system, sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 28;
  canvas.width = w;
  canvas.height = 88;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(8, 10, 16, 0.85)';
  ctx.strokeText(text, w / 2, 46);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, 46);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set((height * w) / canvas.height, height, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function cylinder(p, q, radius, color) {
  const dir = new THREE.Vector3().subVectors(q, p);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, dir.length(), 16, 1),
    new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.05 }),
  );
  mesh.position.addVectors(p, q).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(Y, dir.normalize());
  return mesh;
}

/**
 * Polar plot of an orbital's angular part, |f(θ)|³ (sharper than |f|² so
 * neighboring lobes stay distinguishable), as a surface of revolution
 * about +Y. kind: 'p' (pure p), or n for an spⁿ hybrid. The back lobe (f < 0)
 * gets backColor.
 */
function lobeMesh(kind, frontColor, backColor, opacity) {
  const N = 64;
  const pts = [];
  const signs = [];
  let max = 0;
  for (let i = 0; i <= N; i++) {
    const t = (Math.PI * i) / N;
    const f = kind === 'p' ? Math.cos(t) : (1 + Math.sqrt(3 * kind) * Math.cos(t)) / Math.sqrt(1 + kind);
    const r = Math.abs(f) ** 3;
    max = Math.max(max, r);
    pts.push(new THREE.Vector2(r * Math.sin(t), r * Math.cos(t)));
    signs.push(f >= 0 ? 1 : -1);
  }
  pts.forEach((p) => p.divideScalar(max));
  const geom = new THREE.LatheGeometry(pts, 40);
  const colors = new Float32Array(geom.attributes.position.count * 3);
  const fc = new THREE.Color(frontColor), bc = new THREE.Color(backColor);
  for (let v = 0; v < geom.attributes.position.count; v++) {
    (signs[v % pts.length] > 0 ? fc : bc).toArray(colors, v * 3);
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
    vertexColors: true, transparent: true, opacity, side: THREE.DoubleSide,
    depthWrite: false, roughness: 0.5,
  }));
}

function orient(mesh, pos, dir, size) {
  mesh.position.copy(pos);
  mesh.quaternion.setFromUnitVectors(Y, dir);
  mesh.scale.setScalar(size);
  return mesh;
}

export class MoleculeViewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 500);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(3.5, -6, 4.8);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight('#e8eeff', '#1a1e2c', 1.5));
    const key = new THREE.DirectionalLight('#ffffff', 2.2);
    key.position.set(3, 4, 6);
    this.camera.add(key);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 1.0;

    this.groups = {};
    for (const name of ['structure', 'skeleton', 'angles', 'lengths', 'lonePairs', 'orbitals', 'density', 'charges', 'hbonds', 'mo', 'vib', 'polarity']) {
      this.groups[name] = new THREE.Group();
      this.scene.add(this.groups[name]);
    }
    this.view = 'structure';
    this.options = { angles: true, lengths: false, lonePairs: true, hbonds: true };
    this.iso = 0.1;
    this.mc = null;

    this.selected = null;
    this.onSelectAtom = null;
    this.raycaster = new THREE.Raycaster();
    let down = null;
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const balls = [...this.groups.structure.children, ...this.groups.skeleton.children].filter((o) => o.userData.atom != null && o.parent.visible);
      const hit = this.raycaster.intersectObjects(balls)[0];
      this.selectAtom(hit ? hit.object.userData.atom : null);
    });

    new ResizeObserver(() => this.#resize()).observe(container);
    this.#resize();
  }

  setActive(on) {
    this.clock ??= new THREE.Clock();
    this.renderer.setAnimationLoop(on ? () => {
      const dt = Math.min(this.clock.getDelta(), 0.05);
      if (this.view === 'vib') this.#tickVibration(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    } : null);
    if (on) { this.clock.getDelta(); this.#resize(); }
  }

  // ---------- vibrations ----------

  /** Animate a normal mode: disp is the Cartesian displacement (max 1), period in seconds. */
  setVibration(disp, period) {
    const g = this.groups.vib;
    const { atoms, bonds } = this.mol;
    if (this.vibMol !== this.mol) {
      this.#clear(g);
      this.vibMol = this.mol;
      const n = atoms.length;
      this.vibBalls = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.05 }), n);
      atoms.forEach((a, i) => this.vibBalls.setColorAt(i, new THREE.Color(atomColor(a.symbol))));
      this.vibSticks = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 12), new THREE.MeshStandardMaterial({ roughness: 0.4 }), Math.max(1, bonds.length * 2));
      bonds.forEach((b, k) => {
        this.vibSticks.setColorAt(2 * k, new THREE.Color(atomColor(atoms[b.a].symbol)));
        this.vibSticks.setColorAt(2 * k + 1, new THREE.Color(atomColor(atoms[b.b].symbol)));
      });
      for (const m of [this.vibBalls, this.vibSticks]) m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.vibPaths = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffd75e', transparent: true, opacity: 0.6 }));
      g.add(this.vibBalls, this.vibSticks, this.vibPaths);
    }
    this.vibDisp = disp;
    this.vibPeriod = period;
    this.vibPhase = 0;
    // Each atom's path: a short line through its rest position along its motion.
    const AMP = 0.25; // Å at the most-displaced atom (exaggerated)
    const pts = [];
    atoms.forEach((a, i) => {
      const d = new THREE.Vector3(disp[3 * i], disp[3 * i + 1], disp[3 * i + 2]).multiplyScalar(AMP);
      if (d.length() < 0.01) return;
      const p = v3(a.pos);
      pts.push(p.clone().sub(d), p.clone().add(d));
    });
    this.vibPaths.geometry.dispose();
    this.vibPaths.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.#tickVibration(0);
  }

  #tickVibration(dt) {
    if (!this.vibDisp || this.vibMol !== this.mol) return;
    this.vibPhase += (2 * Math.PI * dt) / this.vibPeriod;
    const s = 0.25 * Math.sin(this.vibPhase);
    const { atoms, bonds } = this.mol;
    const P = atoms.map((a, i) => new THREE.Vector3(
      a.pos[0] + s * this.vibDisp[3 * i], a.pos[1] + s * this.vibDisp[3 * i + 1], a.pos[2] + s * this.vibDisp[3 * i + 2]));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    atoms.forEach((a, i) => {
      const r = ballRadius(a) * 0.8;
      m.compose(P[i], q.identity(), sc.set(r, r, r));
      this.vibBalls.setMatrixAt(i, m);
    });
    bonds.forEach((b, k) => {
      const A = P[b.a], B = P[b.b], mid = A.clone().lerp(B, 0.5);
      const dir = B.clone().sub(A);
      const L = dir.length() / 2;
      q.setFromUnitVectors(Y, dir.normalize());
      const rad = b.ionic ? 0.03 : 0.07;
      m.compose(A.clone().lerp(mid, 0.5), q, sc.set(rad, L, rad));
      this.vibSticks.setMatrixAt(2 * k, m);
      m.compose(mid.clone().lerp(B, 0.5), q, sc.set(rad, L, rad));
      this.vibSticks.setMatrixAt(2 * k + 1, m);
    });
    this.vibBalls.instanceMatrix.needsUpdate = true;
    this.vibSticks.instanceMatrix.needsUpdate = true;
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #clear(group) {
    group.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    group.clear();
  }

  setMolecule(mol) {
    this.mol = mol;
    this.selected = null;
    for (const [name, g] of Object.entries(this.groups)) {
      if (name === 'density' && this.mc) { g.remove(this.mc); }
      if (name === 'polarity' && this.espMC) { g.remove(this.espMC); }
      if (name === 'mo') this.moKey = null;
      if (name === 'vib') { this.vibMol = null; this.vibDisp = null; }
      this.#clear(g);
    }
    if (!mol) return;
    // Labels are sized in Å; enlarge them for big molecules so they stay readable when zoomed out.
    const extent = Math.max(...mol.atoms.map((a) => Math.hypot(...a.pos)));
    this.labelScale = Math.max(1, extent / 2.5);
    this.#buildStructure();
    this.#buildSkeleton();
    this.#buildAngles();
    this.#buildLengths();
    this.#buildLonePairs();
    this.#buildCharges();
    this.#buildHbonds();
    this.#buildOrbitals();
    this.densityBuilt = false;
    this.#applyView();
    this.fit();
  }

  #buildStructure() {
    const { atoms, bonds } = this.mol;
    const g = this.groups.structure;
    for (const a of atoms) {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(ballRadius(a), 32, 20),
        new THREE.MeshStandardMaterial({ color: atomColor(a.symbol), roughness: 0.35, metalness: 0.05 }),
      );
      ball.position.copy(v3(a.pos));
      ball.userData.atom = atoms.indexOf(a);
      g.add(ball);
    }
    for (const bd of bonds) {
      const A = atoms[bd.a], B = atoms[bd.b];
      const p = v3(A.pos), q = v3(B.pos);
      if (bd.ionic) { // electrostatic attraction, not a shared pair: a thin dashed line
        const dir = q.clone().sub(p).normalize();
        const s = p.clone().addScaledVector(dir, ballRadius(A)), e = q.clone().addScaledVector(dir, -ballRadius(B));
        const n = Math.max(3, Math.round(s.distanceTo(e) / 0.14));
        for (let i = 0; i < n; i++) {
          g.add(cylinder(s.clone().lerp(e, (i + 0.25) / n), s.clone().lerp(e, (i + 0.75) / n), 0.025, '#9aa6bd'));
        }
        continue;
      }
      const axis = new THREE.Vector3().subVectors(q, p).normalize();
      // Offset multiple bonds within the σ plane (perpendicular to the π orbitals).
      const pi = bd.piDirs[0] ? v3(bd.piDirs[0]) : new THREE.Vector3(0, 0, 1);
      let off = new THREE.Vector3().crossVectors(axis, pi);
      if (off.lengthSq() < 1e-4) off = new THREE.Vector3(0, 1, 0).cross(axis);
      off.normalize();

      const strands = bd.delocalized ? [[-0.07, true], [0.07, false]]
        : bd.order === 2 ? [[-0.08, true], [0.08, true]]
        : bd.order === 3 ? [[-0.12, true], [0, true], [0.12, true]]
        : [[0, true]];
      const radius = bd.order === 1 ? 0.075 : 0.05;
      for (const [o, solid] of strands) {
        const s = p.clone().addScaledVector(off, o), e = q.clone().addScaledVector(off, o);
        const mid = s.clone().lerp(e, 0.5);
        if (solid) {
          g.add(cylinder(s, mid, radius, atomColor(A.symbol)), cylinder(mid, e, radius, atomColor(B.symbol)));
        } else {
          const n = 7;
          for (let i = 0; i < n; i++) {
            const t0 = (i + 0.2) / n, t1 = (i + 0.8) / n;
            const c = t0 < 0.5 ? atomColor(A.symbol) : atomColor(B.symbol);
            g.add(cylinder(s.clone().lerp(e, t0), s.clone().lerp(e, t1), radius * 0.8, c));
          }
        }
      }
    }
  }

  // Small atoms and thin bond lines shown under orbitals and density.
  #buildSkeleton() {
    const { atoms, bonds } = this.mol;
    const g = this.groups.skeleton;
    for (const a of atoms) {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(ballRadius(a) * (a.charge ? 0.25 : 0.38), 20, 12),
        new THREE.MeshStandardMaterial({ color: atomColor(a.symbol), roughness: 0.3 }),
      );
      ball.position.copy(v3(a.pos));
      ball.userData.atom = atoms.indexOf(a);
      g.add(ball);
    }
    const pts = bonds.flatMap((bd) => [v3(atoms[bd.a].pos), v3(atoms[bd.b].pos)]);
    g.add(new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 }),
    ));
  }

  /** Large molecules show angles only at the selected atom, to avoid a thicket of arcs. */
  get showsAllAngles() { return this.mol && this.mol.atoms.length <= 10; }

  selectAtom(i) {
    this.selected = i;
    this.#clear(this.groups.angles);
    this.#buildAngles();
    this.#applyView();
    this.onSelectAtom?.(i);
  }

  #buildAngles() {
    const { atoms } = this.mol;
    const angles = this.showsAllAngles ? this.mol.angles : this.mol.angles.filter((a) => a.vertex === this.selected);
    if (this.selected != null) {
      const ring = new THREE.Mesh(
        new THREE.SphereGeometry(ballRadius(atoms[this.selected]) * 1.35, 24, 16),
        new THREE.MeshBasicMaterial({ color: ANGLE_COLOR, wireframe: true, transparent: true, opacity: 0.6, depthTest: false }),
      );
      ring.position.copy(v3(atoms[this.selected].pos));
      ring.renderOrder = 8;
      this.groups.angles.add(ring);
    }
    const g = this.groups.angles;
    const lineMat = new THREE.LineBasicMaterial({ color: ANGLE_COLOR, depthTest: false, transparent: true });
    const placed = [];
    const perVertex = new Map();
    for (const ang of angles) {
      const nth = perVertex.get(ang.vertex) ?? 0; // stagger arcs that share a vertex
      perVertex.set(ang.vertex, nth + 1);
      const V = v3(atoms[ang.vertex].pos);
      const PA = v3(atoms[ang.a].pos), PB = v3(atoms[ang.b].pos);
      const u = PA.clone().sub(V), w = PB.clone().sub(V);
      const shortest = Math.min(u.length(), w.length());
      const ra = Math.min(0.8 * shortest, Math.max(ballRadius(atoms[ang.vertex]) + 0.25, 0.45 * shortest)) + 0.12 * nth;
      u.normalize(); w.normalize();
      let k = new THREE.Vector3().crossVectors(u, w);
      if (k.lengthSq() < 1e-6) { // 180°: pick any plane containing the bond
        k = new THREE.Vector3(0, 0, 1).cross(u);
        if (k.lengthSq() < 1e-6) k = new THREE.Vector3(0, 1, 0).cross(u);
      }
      k.normalize();
      const theta = ang.value * Math.PI / 180;
      const arc = [];
      const steps = Math.max(8, Math.round(ang.value / 4));
      for (let i = 0; i <= steps; i++) {
        arc.push(V.clone().addScaledVector(u.clone().applyAxisAngle(k, (theta * i) / steps), ra));
      }
      // The two rays along the bonds, the arc between them, and a light fill.
      const rays = [V, PA, V, PB];
      const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(rays), lineMat.clone());
      lines.material.opacity = 0.55;
      const arcLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(arc), lineMat);
      const fan = [];
      for (let i = 0; i < arc.length - 1; i++) fan.push(V, arc[i], arc[i + 1]);
      const fill = new THREE.Mesh(
        new THREE.BufferGeometry().setFromPoints(fan),
        new THREE.MeshBasicMaterial({ color: ANGLE_COLOR, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
      );
      const label = textSprite(`${ang.value.toFixed(1)}°`, { color: ANGLE_COLOR, height: 0.2 * this.labelScale });
      const mid = u.clone().applyAxisAngle(k, theta / 2);
      let lr = ra + 0.3 * this.labelScale;
      label.position.copy(V).addScaledVector(mid, lr);
      for (let tries = 0; tries < 6 && placed.some((p) => p.distanceTo(label.position) < 0.4); tries++) {
        lr += 0.28;
        label.position.copy(V).addScaledVector(mid, lr);
      }
      placed.push(label.position.clone());
      for (const o of [lines, arcLine, fill]) o.renderOrder = 9;
      g.add(lines, arcLine, fill, label);
    }
  }

  #buildLengths() {
    const { atoms, bonds } = this.mol;
    for (const bd of bonds) {
      const p = v3(atoms[bd.a].pos), q = v3(atoms[bd.b].pos);
      const label = textSprite(`${bd.length.toFixed(3)} Å`, { color: '#c9d3e6', height: 0.15 * this.labelScale, weight: 500 });
      const axis = q.clone().sub(p).normalize();
      const side = new THREE.Vector3(0, 0, 1).cross(axis);
      if (side.lengthSq() < 1e-4) side.set(0, 1, 0);
      label.position.copy(p).lerp(q, 0.5).addScaledVector(side.normalize(), 0.16);
      this.groups.lengths.add(label);
    }
  }

  #buildLonePairs() {
    const g = this.groups.lonePairs;
    for (const a of this.mol.atoms) {
      const pos = v3(a.pos);
      const r = ballRadius(a);
      a.lpDirs.forEach((d, i) => {
        const dir = v3(d);
        const isSingle = a.single && i === a.lpDirs.length - 1;
        const lobe = lobeMesh(3, LONE_PAIR_COLOR, LONE_PAIR_COLOR, 0.32);
        orient(lobe, pos, dir, r + 0.42);
        g.add(lobe);
        const side = new THREE.Vector3().crossVectors(dir, Math.abs(dir.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
        const center = pos.clone().addScaledVector(dir, r + 0.22);
        const offsets = isSingle ? [0] : [-0.06, 0.06];
        for (const o of offsets) {
          const dot = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
          dot.position.copy(center).addScaledVector(side, o);
          g.add(dot);
        }
      });
    }
  }

  // Hydrogen bonds: dashed lines from H to the acceptor, labeled with the distance.
  #buildHbonds() {
    const { atoms, hbonds } = this.mol;
    const g = this.groups.hbonds;
    const mat = new THREE.MeshBasicMaterial({ color: HBOND_COLOR, transparent: true, opacity: 0.9 });
    for (const hb of hbonds ?? []) {
      const p = v3(atoms[hb.h].pos), q = v3(atoms[hb.a].pos);
      const n = 7;
      for (let i = 0; i < n; i++) {
        const s = p.clone().lerp(q, (i + 0.2) / n), e = p.clone().lerp(q, (i + 0.65) / n);
        const seg = cylinder(s, e, 0.035, HBOND_COLOR);
        seg.material.dispose();
        seg.material = mat;
        g.add(seg);
      }
      const label = textSprite(`${hb.length.toFixed(2)} Å`, { color: HBOND_COLOR, height: 0.16 * this.labelScale, weight: 600 });
      const side = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3(0, 0, 1));
      if (side.lengthSq() < 1e-4) side.set(0, 1, 0);
      label.position.copy(p).lerp(q, 0.5).addScaledVector(side.normalize(), 0.18 * this.labelScale);
      label.userData.isLengthLabel = true;
      g.add(label);
    }
  }

  // "+", "2−" labels above each ion.
  #buildCharges() {
    for (const a of this.mol.atoms) {
      if (!a.charge) continue;
      const label = textSprite(chargeText(a.charge), { color: a.charge > 0 ? '#ffb38a' : '#8fd0ff', height: 0.3, weight: 700 });
      label.position.copy(v3(a.pos)).add(new THREE.Vector3(0, 0, ballRadius(a) + 0.22));
      this.groups.charges.add(label);
    }
  }

  // Ionic bonding: each ion's (filled) valence shell, and arrows for the electrons transferred.
  #buildIonicOrbitals() {
    const { atoms, bonds } = this.mol;
    const g = this.groups.orbitals;
    for (const a of atoms) {
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(0.9 * (IONIC_RADIUS[a.symbol] ?? 1.4), 40, 24),
        new THREE.MeshStandardMaterial({
          color: atomColor(a.symbol), transparent: true, opacity: a.charge < 0 ? 0.42 : 0.2,
          depthWrite: false, roughness: 0.5,
        }),
      );
      shell.position.copy(v3(a.pos));
      g.add(shell);
    }
    const mat = new THREE.MeshStandardMaterial({ color: TRANSFER_COLOR, emissive: TRANSFER_COLOR, emissiveIntensity: 0.35 });
    for (const bd of bonds) {
      const [ci, ai] = atoms[bd.a].charge > 0 ? [bd.a, bd.b] : [bd.b, bd.a];
      const C = v3(atoms[ci].pos), A = v3(atoms[ai].pos);
      const axis = A.clone().sub(C);
      const up = new THREE.Vector3(0, 0, 1).cross(axis).cross(axis).normalize().negate();
      if (up.lengthSq() < 1e-4) up.set(0, 1, 0);
      const lift = 0.35 * axis.length() + 0.4;
      const start = C.clone().addScaledVector(up, ballRadius(atoms[ci]) + 0.1);
      const end = A.clone().addScaledVector(axis.clone().normalize(), -0.15).addScaledVector(up, ballRadius(atoms[ai]) * 0.9);
      const ctrl = C.clone().lerp(A, 0.5).addScaledVector(up, lift + 0.5);
      const curve = new THREE.QuadraticBezierCurve3(start, ctrl, end);
      g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.03, 8), mat));
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.24, 16), mat);
      head.position.copy(end);
      head.quaternion.setFromUnitVectors(Y, curve.getTangent(1).normalize());
      g.add(head);
      const n = bd.transfer;
      const label = textSprite(`${n} e⁻`, { color: TRANSFER_COLOR, height: 0.22, weight: 700 });
      label.position.copy(curve.getPoint(0.5)).addScaledVector(up, 0.2);
      g.add(label);
    }
  }

  // σ hybrid lobes toward each bond, lone-pair lobes, and p orbitals for π bonds.
  #buildOrbitals() {
    if (this.mol.ionic) return this.#buildIonicOrbitals();
    const { atoms, bonds } = this.mol;
    const g = this.groups.orbitals;
    const pChar = { 'sp': 1, 'sp²': 2, 'sp³': 3, 'sp³d': 3, 'sp³d²': 3 };
    for (const [i, a] of atoms.entries()) {
      const pos = v3(a.pos);
      const color = new THREE.Color(a.symbol === 'H' ? H1S_COLOR : SIGMA_COLOR);
      const back = color.clone().multiplyScalar(0.35);
      const myBonds = bonds.filter((bd) => bd.a === i || bd.b === i);
      const avgLen = myBonds.reduce((s, bd) => s + bd.length, 0) / (myBonds.length || 1);
      if (a.symbol === 'H' || a.hybrid === 's') {
        const s = new THREE.Mesh(
          new THREE.SphereGeometry(0.38 * avgLen, 32, 20),
          new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false, roughness: 0.5 }),
        );
        s.position.copy(pos);
        g.add(s);
        continue;
      }
      const n = pChar[a.hybrid] ?? 3;
      a.sigmaDirs.forEach((d, k) => {
        g.add(orient(lobeMesh(n, color, back, 0.5), pos, v3(d), 0.8 * myBonds[k].length));
      });
      for (const d of a.lpDirs) {
        g.add(orient(lobeMesh(n, LONE_PAIR_COLOR, '#4a3f75', 0.35), pos, v3(d), 0.6 * avgLen));
      }
      for (const d of a.piDirs) {
        g.add(orient(lobeMesh('p', PHASE_COLORS.pos, PHASE_COLORS.neg, 0.5), pos, v3(d), 0.75 * avgLen));
      }
    }
  }

  /**
   * Promolecule density on a res³ grid over [−half, half) Å: the sum of each atom's own
   * (spherical) electron density, in e/bohr³. owner[i] is the atom contributing most.
   */
  #densityGrid(res) {
    const { atoms } = this.mol;
    const tableCache = new Map();
    const tables = atoms.map((a) => {
      const key = `${a.z},${a.charge ?? 0}`;
      if (!tableCache.has(key)) {
        const config = electronConfig(a.z - (a.charge ?? 0)); // ions: add or remove valence electrons
        // Anions are held by their crystal neighbors: a Watson sphere at the ionic radius.
        const ionic = (a.charge ?? 0) < 0 ? (IONIC_RADIUS[`${a.symbol}${a.charge}`] ?? IONIC_RADIUS[a.symbol] ?? 1.4) / BOHR : null;
        const scf = solveAtom(a.z, config, { watsonRadius: ionic });
        tableCache.set(key, atomDensityTable(config.map((s) => ({ ...s, zeff: slaterZeff(a.z, config, s.n, s.l), radial: scf.orbitals.get(`${s.n}${s.l}`) }))));
      }
      return tableCache.get(key);
    });
    const half = Math.max(...atoms.map((a) => Math.max(...a.pos.map(Math.abs)))) + 2.6;
    const h = res / 2, step = half / h;
    const field = new Float32Array(res * res * res);
    const best = new Float32Array(res * res * res);
    const owner = new Int16Array(res * res * res).fill(-1);
    const CUTOFF = 4.5; // Å; atomic densities are negligible beyond this
    // Add each atom's density only over the grid cells near it.
    atoms.forEach((atom, a) => {
      const [px, py, pz] = atom.pos;
      const t = tables[a];
      const lo = (c) => Math.max(0, Math.floor((c - CUTOFF) / step + h));
      const hi = (c) => Math.min(res - 1, Math.ceil((c + CUTOFF) / step + h));
      for (let zi = lo(pz); zi <= hi(pz); zi++) {
        const z = (zi - h) * step;
        for (let yi = lo(py); yi <= hi(py); yi++) {
          const y = (yi - h) * step;
          const row = (zi * res + yi) * res;
          for (let xi = lo(px); xi <= hi(px); xi++) {
            const x = (xi - h) * step;
            const idx = Math.hypot(x - px, y - py, z - pz) / BOHR / t.dr;
            if (idx >= t.table.length - 1) continue;
            const v = t.table[Math.floor(idx)];
            const i = row + xi;
            field[i] += v;
            if (v > best[i]) { best[i] = v; owner[i] = a; }
          }
        }
      }
    });
    return { field, owner, half, step, res };
  }

  #buildDensity() {
    const colors = this.mol.atoms.map((a) => new THREE.Color(atomColor(a.symbol)));
    if (!this.mc) {
      this.mc = new MarchingCubes(DENSITY_RES, new THREE.MeshStandardMaterial({
        vertexColors: true, transparent: true, opacity: 0.55, roughness: 0.35, side: THREE.DoubleSide, depthWrite: false,
      }), false, true, 160000);
    }
    const mc = this.mc;
    mc.reset();
    const { field, owner, half } = this.#densityGrid(DENSITY_RES);
    mc.field.set(field);
    for (let i = 0; i < owner.length; i++) if (owner[i] >= 0) colors[owner[i]].toArray(mc.palette, i * 3);
    mc.scale.setScalar(half);
    mc.isolation = this.iso;
    mc.update();
    this.groups.density.add(mc);
    this.densityBuilt = true;
  }

  /**
   * Electrostatic potential mapped on the molecule's surface (the 0.002 e/bohr³
   * density contour, about where neighbors touch), plus the dipole arrow.
   * potential(p) → kcal/mol; dipole: { debye, vector, center } with vector toward δ−.
   * Returns the color range used (kcal/mol).
   */
  setPolarity(potential, dipole, charges) {
    const g = this.groups.polarity;
    if (this.espMC) g.remove(this.espMC); // reused; don't dispose it
    this.#clear(g);
    if (!this.espMC) {
      this.espMC = new MarchingCubes(DENSITY_RES, new THREE.MeshStandardMaterial({
        vertexColors: true, transparent: true, opacity: 0.62, roughness: 0.4, side: THREE.DoubleSide, depthWrite: false,
      }), false, true, 160000);
    }
    const mc = this.espMC;
    mc.reset();
    const ISO = 0.002;
    const { field, half, step, res } = this.#densityGrid(DENSITY_RES);
    mc.field.set(field);
    // Potential only near the surface, where the colors are read.
    const h = res / 2;
    const near = [];
    for (let i = 0; i < field.length; i++) if (field[i] > ISO / 4 && field[i] < ISO * 4) near.push(i);
    const V = new Float32Array(near.length);
    near.forEach((i, k) => {
      const xi = i % res, yi = Math.floor(i / res) % res, zi = Math.floor(i / (res * res));
      V[k] = potential([(xi - h) * step, (yi - h) * step, (zi - h) * step]);
    });
    const sorted = Float32Array.from(V, Math.abs).sort();
    const range = Math.max(8, sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 8);
    const neg = new THREE.Color('#ff3b3b'), mid = new THREE.Color('#f4f4f4'), pos = new THREE.Color('#2f7dff');
    const c = new THREE.Color();
    near.forEach((i, k) => {
      const t = Math.max(-1, Math.min(1, V[k] / range));
      c.copy(mid).lerp(t < 0 ? neg : pos, Math.abs(t) ** 0.8);
      c.toArray(mc.palette, i * 3);
    });
    mc.scale.setScalar(half);
    mc.isolation = ISO;
    mc.update();
    g.add(mc);

    // δ+ / δ− labels on atoms with a sizable partial charge.
    this.mol.atoms.forEach((a, i) => {
      const q = charges[i];
      if (Math.abs(q) < 0.08) return;
      const label = textSprite(`δ${q > 0 ? '+' : '−'}${Math.abs(q).toFixed(2)}`, { color: q > 0 ? '#9cc4ff' : '#ff9c9c', height: 0.17 * this.labelScale, weight: 700 });
      label.position.copy(v3(a.pos)).add(new THREE.Vector3(0, 0, ballRadius(a) + 0.2));
      g.add(label);
    });

    // Dipole arrow, drawn the chemist's way: toward the negative end, with a + at the tail.
    if (dipole.debye >= 0.05) {
      const dir = v3(dipole.vector);
      const L = 0.9 + 0.55 * Math.min(dipole.debye, 6);
      const start = v3(dipole.center).addScaledVector(dir, -L / 2);
      const arrow = new THREE.ArrowHelper(dir, start, L, 0xffd75e, 0.32, 0.2);
      for (const part of [arrow.line, arrow.cone]) { part.material.depthTest = false; part.renderOrder = 10; }
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, L - 0.3, 12),
        new THREE.MeshBasicMaterial({ color: 0xffd75e, depthTest: false }));
      shaft.position.copy(start).addScaledVector(dir, (L - 0.3) / 2);
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      shaft.renderOrder = 10;
      // The cross stroke at the tail: the "+" end.
      const perp = new THREE.Vector3().crossVectors(dir, Math.abs(dir.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
      const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.32, 10), shaft.material);
      cross.position.copy(start).addScaledVector(dir, 0.22);
      cross.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), perp);
      cross.renderOrder = 10;
      const label = textSprite(`μ = ${dipole.debye.toFixed(2)} D`, { color: '#ffd75e', height: 0.2 * this.labelScale, weight: 700 });
      label.position.copy(start).addScaledVector(dir, L + 0.35);
      g.add(arrow, shaft, cross, label);
      mc.renderOrder = 1;
    }
    return range;
  }

  /**
   * Show one molecular orbital: field sampled on a res³ grid over [−half, half) Å,
   * drawn as its +iso surface (one phase color) and −iso surface (the other).
   */
  setMO(field, res, half, iso, key) {
    const g = this.groups.mo;
    this.#clear(g);
    this.moKey = key;
    this.moMC ??= new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 120000);
    const mc = this.moMC;
    for (const [sign, color] of [[1, PHASE_COLORS.pos], [-1, PHASE_COLORS.neg]]) {
      mc.reset();
      for (let i = 0; i < field.length; i++) mc.field[i] = sign * field[i];
      mc.isolation = iso;
      mc.update();
      if (!mc.count) continue;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(mc.positionArray.slice(0, mc.count * 3), 3));
      geom.setAttribute('normal', new THREE.BufferAttribute(mc.normalArray.slice(0, mc.count * 3), 3));
      const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
        color, transparent: true, opacity: 0.72, roughness: 0.35, side: THREE.DoubleSide, depthWrite: false,
      }));
      mesh.scale.setScalar(half);
      g.add(mesh);
    }
  }

  setIso(value) {
    this.iso = value;
    if (this.mc && this.densityBuilt) {
      this.mc.isolation = value;
      this.mc.update();
    }
  }

  setView(view) {
    this.view = view;
    this.#applyView();
    this.fit();
  }

  setOption(name, on) {
    this.options[name] = on;
    this.#applyView();
  }

  setAutoRotate(on) { this.controls.autoRotate = on; }

  #applyView() {
    if (!this.mol) return;
    if (this.view === 'density' && !this.densityBuilt) this.#buildDensity();
    const v = this.view;
    const G = this.groups;
    G.structure.visible = v === 'structure';
    G.skeleton.visible = v !== 'structure' && v !== 'vib';
    G.lonePairs.visible = v === 'structure' && this.options.lonePairs;
    G.orbitals.visible = v === 'orbitals';
    G.density.visible = v === 'density';
    G.polarity.visible = v === 'polarity';
    G.mo.visible = v === 'mo';
    G.vib.visible = v === 'vib';
    G.angles.visible = this.options.angles && v !== 'vib';
    G.hbonds.visible = this.options.hbonds && v !== 'vib';
    for (const o of G.hbonds.children) if (o.userData.isLengthLabel) o.visible = this.options.lengths;
    G.lengths.visible = this.options.lengths && v !== 'vib';
    G.charges.visible = v !== 'vib' && v !== 'polarity'; // static labels wouldn't follow the vibrating atoms
  }

  fit() {
    if (!this.mol) return;
    const r = Math.max(...this.mol.atoms.map((a) => Math.hypot(...a.pos) + ballRadius(a))) + (this.view === 'structure' ? 0.45 : this.view === 'polarity' ? 1.5 : 0.75);
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const dist = r / Math.sin(Math.min(vfov, hfov) / 2);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(dir.multiplyScalar(dist));
  }
}
