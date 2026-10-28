// Powers-of-ten mode: controls, captions and the ladder of scales.

import { ZoomViewer, ZOOM_MAX, ZOOM_MIN } from './zoom-viewer.js';

const $ = (sel) => document.querySelector(sel);

// Stops along the way, from large to small. L = log10(view width in meters).
const STOPS = [
  { L: -8.2, title: 'Liquid water', size: '6 nm',
    text: 'A drop of water up close: about 70 molecules jostling 0.3 nm apart, trading hydrogen bonds trillions of times a second. A glass of water holds about 10<sup>25</sup> of them.' },
  { L: -9.35, title: 'A water molecule', size: '0.4 nm',
    text: 'One H₂O: an oxygen and two hydrogens 0.096 nm away at a 104.5° angle. The balls and sticks are a convenience; a molecule has no hard surface.' },
  { L: -9.95, title: 'The oxygen atom', size: '0.1 nm',
    text: 'What the atom really is: a cloud of eight electrons, each spread through its orbital (colors show the sign of the wavefunction). The two hydrogens’ electrons have been pulled toward the oxygen in the bonds.' },
  { L: -11.0, title: 'Inside the cloud', size: '10 pm',
    text: 'The innermost (1s) electrons sit about 0.01 nm from the center, 8 times closer than hydrogen’s single electron, because they feel nearly all eight protons. Most of the atom’s volume is still ahead of us… and empty.' },
  { L: -12.2, title: 'Empty space', size: '0.6 pm',
    text: 'Still nothing to see. The nucleus is about 20,000 times smaller than the atom: if the atom were a football stadium, the nucleus would be a peppercorn on the center spot. Yet it holds 99.97% of the mass.' },
  { L: -13.65, title: 'The nucleus', size: '20 fm',
    text: 'Oxygen-16: 8 protons (blue) and 8 neutrons (white) packed into a ball 6 fm (6 × 10<sup>−15</sup> m) across, at a density of 200 million tonnes per cubic centimeter. Its stability comes from the strong force, which overwhelms the protons’ electric repulsion at this range.' },
  { L: -14.25, title: 'A proton', size: '6 fm',
    text: 'Zooming into one proton, 1.7 fm across. Neighbors almost touch; the strong force between them reaches only about 1.4 fm, carried by pions.' },
  { L: -14.8, title: 'Inside a proton', size: '1.6 fm',
    text: 'Three valence quarks, up, up and down (charges +⅔ +⅔ −⅓ = +1), joined by gluon flux tubes. The colors are “color charge”, which gluons keep swapping. Quark masses are only about 1% of the proton’s; the rest is the energy of the gluon field and the quarks’ motion.' },
  { L: -16.3, title: 'An up quark', size: '0.05 fm',
    text: 'Closing in on one up quark. It stays a point: we draw it as a dot no matter how far we zoom.' },
  { L: -17.8, title: 'No structure found', size: '0.002 fm',
    text: 'Particle colliders have looked for size or substructure in quarks and electrons down to about 10<sup>−19</sup> m and found none. As far as anyone knows, this is where the zoom ends: about 11 powers of ten below the water molecule.' },
];

/** View width as text in the handiest unit, plus scientific notation. */
function widthText(L) {
  const W = 10 ** L;
  // Below a femtometer, fractions of a fm read better than attometers.
  const units = [[1e-6, 1e-6, 'µm'], [1e-9, 1e-9, 'nm'], [1e-12, 1e-12, 'pm'], [1e-15, 1e-15, 'fm'], [0, 1e-15, 'fm']];
  const [, u, name] = units.find(([v]) => W >= v);
  const x = W / u;
  const digits = x < 0.01 ? 4 : x < 0.1 ? 3 : x < 10 ? 1 + (x < 1) : 0;
  return `${x.toFixed(digits)} ${name} (10<sup>${L.toFixed(1).replace('-', '−')}</sup> m)`;
}

export function createZoomUI() {
  const viewer = new ZoomViewer($('#zoom-canvas'));
  const slider = $('#zoom-slider');
  slider.min = ZOOM_MIN; slider.max = ZOOM_MAX; slider.step = 0.01;
  let current = -1;
  let dragging = false;

  function stopFor(L) {
    let best = 0;
    STOPS.forEach((s, i) => { if (Math.abs(s.L - L) < Math.abs(STOPS[best].L - L)) best = i; });
    return best;
  }

  viewer.onChange = (L, playing) => {
    if (!dragging) slider.value = L;
    $('#zoom-scale').innerHTML = `view width ≈ ${widthText(L)}`;
    $('#zoom-play').textContent = playing ? '❚❚ Pause' : '▶ Zoom in';
    const k = stopFor(L);
    if (k === current) return;
    current = k;
    const s = STOPS[k];
    $('#zoom-caption').innerHTML = `<b>${s.title}</b> · ${s.text}`;
    document.querySelectorAll('#zoom-ladder li').forEach((li, i) => li.classList.toggle('on', i === k));
  };

  $('#zoom-ladder').innerHTML = STOPS.map((s, i) => `<li data-stop="${i}"><span class="ladder-size">${s.size}</span><span><b>${s.title}</b></span><span class="muted">10<sup>${s.L.toFixed(1)}</sup> m</span></li>`).join('');
  $('#zoom-ladder').addEventListener('click', (e) => {
    const li = e.target.closest('[data-stop]');
    if (!li) return;
    viewer.pause();
    viewer.setTarget(STOPS[+li.dataset.stop].L);
  });
  $('#zoom-play').addEventListener('click', () => (viewer.playing ? viewer.pause() : viewer.play()));
  $('#zoom-reset').addEventListener('click', () => { viewer.pause(); viewer.setTarget(STOPS[0].L); });
  slider.addEventListener('input', () => { dragging = true; viewer.pause(); viewer.setTarget(+slider.value); });
  slider.addEventListener('change', () => { dragging = false; });
  $('#zoom-rotate').addEventListener('change', (e) => viewer.setAutoRotate(e.target.checked));

  return {
    setActive(on) { viewer.setActive(on); },
    zoomBy(d) { viewer.pause(); viewer.setTarget(viewer.target + d); },
  };
}
