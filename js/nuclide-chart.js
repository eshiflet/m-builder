// The chart of nuclides: every nucleus as a square, neutrons N across and protons Z up.
// Drawn on a canvas with zoom and pan; click a square to pick it.

import { ELEMENTS } from './elements.js';
import { classifyNuclide, bindingOf, MAGIC, halfLifeText } from './nucleus-data.js';

export const MODE_COLORS = {
  stable: '#f2f2f2', 'β⁻': '#4f9dff', 'β⁺': '#ff6b6b', EC: '#ff6b6b', 'α': '#ffd75e', SF: '#57d68d', '2β⁻': '#4f9dff',
};
const MAX_Z = 118, MAX_N = 200;

/** Color for binding energy per nucleon, dark blue (low) → yellow (iron peak). */
function bindingColor(ba) {
  const t = Math.max(0, Math.min(1, (ba - 5) / 3.8));
  const stops = [[30, 40, 110], [40, 120, 180], [60, 180, 140], [190, 220, 80], [255, 230, 90]];
  const f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), u = f - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * u));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export class NuclideChart {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'nuclide-canvas';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.colorMode = 'mode';
    this.selected = null;
    this.hover = null;
    this.onSelect = null;
    this.onOpen = null;
    this.onHover = null;

    // Precompute every nuclide once.
    this.cells = [];
    for (let Z = 1; Z <= MAX_Z; Z++) {
      for (let N = 0; N <= MAX_N; N++) {
        const c = classifyNuclide(Z, N);
        if (c) this.cells.push({ Z, N, A: Z + N, ...c, ba: bindingOf(Z, Z + N) / (Z + N) });
      }
    }
    this.byKey = new Map(this.cells.map((c) => [`${c.Z},${c.N}`, c]));

    this.view = null; // { s: px per cell, ox, oy: screen position of (N=0, Z=0) }
    this.#bindInput();
    new ResizeObserver(() => this.#resize()).observe(container);
  }

  #resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    if (!this.view) this.fit();
    this.draw();
  }

  fit() {
    const s = Math.min((this.w - 50) / (MAX_N + 2), (this.h - 40) / (MAX_Z + 2));
    this.view = { s, ox: 36, oy: this.h - 26 };
    this.draw();
  }

  /** Center on a nuclide, zoomed in. */
  focus(Z, N, s = 16) {
    this.view = { s, ox: this.w / 2 - (N + 0.5) * s, oy: this.h / 2 + (Z + 0.5) * s };
    this.draw();
  }

  setColorMode(m) { this.colorMode = m; this.draw(); }
  setSelected(Z, N) { this.selected = { Z, N }; this.draw(); }

  #cellAt(px, py) {
    const { s, ox, oy } = this.view;
    const N = Math.floor((px - ox) / s), Z = Math.floor((oy - py) / s);
    return this.byKey.get(`${Z},${N}`) ?? null;
  }

  #bindInput() {
    const c = this.canvas;
    let drag = null, moved = false;
    c.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, ox: this.view.ox, oy: this.view.oy }; moved = false; c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        this.view.ox = drag.ox + dx; this.view.oy = drag.oy + dy;
        this.draw();
        return;
      }
      const cell = this.#cellAt(e.clientX - r.left, e.clientY - r.top);
      if (cell !== this.hover) { this.hover = cell; this.draw(); this.onHover?.(cell); }
    });
    c.addEventListener('pointerup', (e) => {
      if (drag && !moved) {
        const r = c.getBoundingClientRect();
        const cell = this.#cellAt(e.clientX - r.left, e.clientY - r.top);
        if (cell) { this.selected = { Z: cell.Z, N: cell.N }; this.draw(); this.onSelect?.(cell); }
      }
      drag = null;
    });
    c.addEventListener('dblclick', (e) => {
      const r = c.getBoundingClientRect();
      const cell = this.#cellAt(e.clientX - r.left, e.clientY - r.top);
      if (cell) this.onOpen?.(cell);
    });
    c.addEventListener('pointerleave', () => { this.hover = null; this.draw(); this.onHover?.(null); });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const k = Math.exp(-e.deltaY * 0.0015);
      const s = Math.max(2, Math.min(60, this.view.s * k));
      const f = s / this.view.s;
      this.view.ox = px - (px - this.view.ox) * f;
      this.view.oy = py - (py - this.view.oy) * f;
      this.view.s = s;
      this.draw();
    }, { passive: false });
  }

  draw() {
    if (!this.view || !this.w) return;
    const { ctx } = this;
    const { s, ox, oy } = this.view;
    ctx.clearRect(0, 0, this.w, this.h);
    const X = (N) => ox + N * s, Y = (Z) => oy - (Z + 1) * s;
    const gap = s > 6 ? 1 : 0;

    for (const c of this.cells) {
      const x = X(c.N), y = Y(c.Z);
      if (x > this.w || y > this.h || x + s < 0 || y + s < 0) continue;
      let color;
      if (this.colorMode === 'binding') color = bindingColor(c.ba);
      else color = MODE_COLORS[c.mode] ?? '#888';
      ctx.globalAlpha = this.colorMode === 'mode' && !c.measured ? 0.4 : c.kind === 'primordial' ? 0.85 : 1;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, s - gap, s - gap);
      if (c.kind === 'primordial' && this.colorMode === 'mode' && s > 5) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#f2f2f2';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1, y + 1, s - gap - 2, s - gap - 2);
      }
    }
    ctx.globalAlpha = 1;

    // Labels inside squares once they're big enough.
    if (s >= 20) {
      ctx.font = `600 ${Math.min(12, s * 0.32)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const c of this.cells) {
        const x = X(c.N), y = Y(c.Z);
        if (x > this.w || y > this.h || x + s < 0 || y + s < 0) continue;
        ctx.fillStyle = c.mode === 'stable' || c.mode === 'α' || this.colorMode === 'binding' ? '#0b0e14' : '#ffffff';
        ctx.fillText(`${c.A}${ELEMENTS[c.Z - 1].symbol}`, x + s / 2, y + s / 2);
      }
    }

    // Magic numbers: lines between N (or Z) = m − 1 and m, edges of the closed shells.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    let lastLabel = -Infinity;
    for (const m of MAGIC) {
      if (m <= MAX_N) {
        const x = X(m) + s / 2;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.h); ctx.stroke();
        if (x - lastLabel > 34) { ctx.textAlign = 'center'; ctx.fillText(`N=${m}`, x, 12); lastLabel = x; }
      }
      if (m <= MAX_Z) {
        const y = Y(m) + s / 2;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.w, y); ctx.stroke();
        ctx.textAlign = 'left'; ctx.fillText(`Z=${m}`, this.w - 44, y - 4);
      }
    }
    // N = Z line.
    ctx.strokeStyle = 'rgba(255,215,94,0.35)';
    ctx.beginPath(); ctx.moveTo(X(0), Y(0) + s); ctx.lineTo(X(MAX_Z + 1), Y(MAX_Z)); ctx.stroke();
    ctx.setLineDash([]);

    // Element symbols down the left edge.
    if (s >= 7) {
      ctx.font = `600 ${Math.min(11, s * 0.7)}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(200,210,230,0.85)';
      for (let Z = 1; Z <= MAX_Z; Z++) {
        const first = this.cells.find((c) => c.Z === Z);
        if (!first) continue;
        const x = Math.max(28, X(first.N) - 3), y = Y(Z) + s / 2;
        if (y < 0 || y > this.h) continue;
        ctx.fillText(ELEMENTS[Z - 1].symbol, x, y);
      }
    }

    for (const [cell, color, width] of [[this.hover, '#ffffff', 1.5], [this.selected, '#ffd75e', 2.5]]) {
      if (!cell) continue;
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.strokeRect(X(cell.N) - 1, Y(cell.Z) - 1, s + 1, s + 1);
    }

    ctx.fillStyle = 'rgba(200,210,230,0.8)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textAlign = 'center'; ctx.fillText('neutrons N →', this.w / 2, this.h - 8);
    ctx.save(); ctx.translate(12, this.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillText('protons Z →', 0, 0); ctx.restore();
  }
}

export function describeCell(c) {
  const el = ELEMENTS[c.Z - 1];
  const life = c.kind === 'stable' ? 'stable' : c.halfLife ? `half-life ${halfLifeText(c.halfLife)}` : '';
  const mode = c.kind === 'stable' ? '' : `${c.mode}${c.measured ? '' : ' (predicted)'}`;
  return { title: `${el.name}-${c.A}`, sup: c.A, symbol: el.symbol, line: [`Z ${c.Z} · N ${c.N}`, mode, life, `B/A ${c.ba.toFixed(2)} MeV`].filter(Boolean).join(' · ') };
}
