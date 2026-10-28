# Orbital Table

An interactive periodic table. Click an element to see its electrons and
orbitals in 3D.

## Run

ES modules need to be served over HTTP, so start any static server from this folder:

```bash
python3 -m http.server 8742
```

Then open <http://localhost:8742>. Link to an element with a hash, such as `#Fe`.

## Molecules

Switch to **Molecules** at the top, then click elements to add atoms (or pick an example).

- **Geometry:** about 45 common molecules use measured gas-phase bond lengths
  and angles (`js/molecule-data.js`), marked "Measured geometry." Any other
  combination with a single central atom gets a Lewis structure and a VSEPR
  shape with typical angles, marked "VSEPR estimate." Molecules with several
  central atoms (C₂H₆, C₂H₄, C₆H₆, CH₃OH, …) are supported only when they're in
  the reference list.
- **Structure view:** a ball-and-stick model. Bond angles are drawn as arcs with
  labels, and lone pairs (purple) show why H₂O is bent while CO₂ is straight.
- **Hybrid orbitals view** (valence-bond picture): hybrid orbitals (σ) point along the bonds and overlap
  head-on. p orbitals (orange/blue by phase) overlap side by side to form π
  bonds. Lone pairs are shown in lavender.
- **Molecular orbitals view:** MOs spread over the whole molecule, computed
  with Extended Hückel theory (`js/eht.js`). The basis is valence Slater
  orbitals, each fit by three Gaussians (STO-3G), so overlaps S are exact; Hᵢᵢ
  are measured valence ionization energies, and Hᵢⱼ = 1.75·Sᵢⱼ(Hᵢᵢ + Hⱼⱼ)/2. The
  view shows an energy-level diagram (with atomic levels and correlation lines
  for diatomics), bonding/antibonding/nonbonding and σ/π labels, the HOMO/LUMO
  gap, and each MO as a 3D surface colored by sign. Same-element diatomics get
  textbook bond orders from inversion symmetry: H₂ 1, B₂ 1, C₂ 2, N₂ 3, O₂ 2,
  F₂ 1. O₂ and B₂ come out paramagnetic with two unpaired electrons, which a
  Lewis structure can't explain. Covers H through Cl. Use ↑/↓ to step through
  orbitals.
- **Electron density view:** a surface of constant total electron density
  (the sum of the atoms' own clouds). The slider shows the clouds merging into
  one envelope at low density and separating into atoms at high density.

**Ionic compounds.** A group 1–2 metal combined with a nonmetal (NaCl, MgCl₂,
CaO) is built as ions held together by charge, not as shared-pair bonds. The
ions are drawn at their ionic sizes with their charges. The Orbitals view shows
the electrons moving from metal to nonmetal, and the density view uses each
ion's own electron configuration. Charges must balance (NaCl₂ is refused with
the formula that does balance). Gas-phase bond lengths are measured where known
and otherwise estimated from ionic radii. The solid is a crystal lattice; the
view shows a single unit.

**Charged ions.** Use the **Charge** control for polyatomic ions such as NH₄⁺,
NO₃⁻, CO₃²⁻ and SO₄²⁻. If a formula only works as an ion (for example C + 3 O),
the panel offers the charge that does.

**Bigger molecules, isomers and conformers.** A formula alone doesn't say how
atoms connect: glucose and fructose are both C₆H₁₂O₆. These molecules are
described by **SMILES**, a text notation for the bonding pattern, including 3D
handedness (`@`/`@@`) and cis/trans (`/` `\`). `js/smiles.js` parses it, and
`js/forcefield.js` turns it into 3D by minimizing a small molecular-mechanics
energy:

```
E = Σ kb(r − r₀)²                bond stretching
  + Σ ka(cos θ − cos θ₀)²        angle bending (109.5°/120°/180° by hybridization)
  + Σ V/2 (1 ± cos nφ)           torsions (staggered sp³, anti over gauche, flat sp²)
  + Σ ki V²                      planarity at sp² atoms
  + Σ kc max(0, V₀ − sV)²        chirality (signed volume of the four neighbors)
  + Σ kr max(0, d₀ − d)²         steric repulsion
  + Σ D₀[5(R₀/R)¹² − 6(R₀/R)¹⁰] cos⁴θ · S(R)
                                 hydrogen bonds D–H···A (DREIDING form; R = D···A,
                                 θ = D–H···A angle, S switches off between 3.1 and 3.6 Å)
```

It is minimized with the FIRE algorithm from several random starts. Distinct
minima are the molecule's **conformers** (shapes it flexes between), shown
under **Shapes** with their relative energies. Checks: cyclohexane gives a chair,
with the twist-boat 5.6 kcal/mol higher; butane's gauche form is +0.9 kcal/mol
above anti; and β-glucose comes out as a chair with every OH equatorial.
Force-field geometries are approximate, typically within a few degrees.

When several library molecules share a formula, they appear under
**Isomers**, e.g. C₆H₁₂O₆: β- and α-glucose, open-chain glucose, galactose,
and fructose (ring and open chain). Sucrose (table sugar), caffeine, aspirin and
others are in the library, and **Search** also accepts any SMILES string
(e.g. `CCCCC` for pentane). In big molecules, click an atom to see its bond
angles.

**Hydrogen bonds.** Hydrogen bonds are drawn as dashed blue lines, with their
lengths and angles listed. SMILES with `.` puts several molecules in one scene;
they're docked by turning each acceptor's lone pair toward each donor H, relaxing,
and refining by basin hopping. Examples: water dimer and trimer, acetic acid
dimer, and the Watson–Crick G–C (three H-bonds) and A–T (two) base pairs. This
runs in a Web Worker and takes a few seconds for base pairs.

Link to a molecule with `#mol=H2O`, to an ion with `#mol=CO3&q=-2`, to a
specific isomer and conformer with `#mol=C6H12O6&v=1&c=2`, or to any SMILES
with `#smiles=CCO`.

## Nucleus

Switch to **Nucleus** and pick an element. The electrons are left behind, and
the view zooms into the nucleus of the element's most common isotope (or
longest-lived, for radioactive elements). Use the **Isotope** stepper for other
isotopes, including halo nuclei like ¹¹Li. Blue spheres are protons, cream ones
are neutrons, and cyan ones are halo nucleons. Link with `#nuc=U` or
`#nuc=Li-11`.

**Time** runs in babyseconds (1 bs = 10⁻²³ s, the time light takes to cross
3 fm). A photon on the femtometer ruler moves at light speed for comparison.
Choosing a motion sets a time rate that makes it visible.

**Nucleon motion** is a small simulation in physical units. Each nucleon is a
classical particle in a deformed Woods–Saxon mean field (separate proton and
neutron wells, so a neutron skin emerges), with the short-range part of the
Volkov nucleon–nucleon force (repulsive core, weak attraction). A Langevin
thermostat holds the speeds at Fermi-motion values (rms ≈ 0.22c). The panel
measures the live rms speed, the proton and neutron radii, and the neutron skin
(≈ 0.17 fm in ²⁰⁸Pb and ¹⁸⁰Hf). In halo nuclei the outer nucleons follow
the quantum halo density outside the core, ρ ∝ e^(−2κr)/r², with κ = √(2μS)/ħ
from each halo's measured separation energy S (0.37 MeV for ¹¹Li). They're
mostly kept out of the core's interior, whose states are full (Pauli exclusion),
but they still reach its surface.

**Nucleon size and overlap.** Nucleons are drawn at 1.08 fm, the radius of a
uniform ball with the proton's rms charge radius (√(5/3)·0.84 fm). At nuclear
density (~1.8 fm between centers) neighbors overlap, as in reality. **Close
pairs** tints nucleons that are momentarily under 1 fm apart, and the panel
reports how often that happens. In real nuclei about 20% of nucleons are in such
short-range correlated pairs, ~90% of them proton–neutron because of the tensor
force. This simulation has no tensor force, so its pairs follow simple
combinatorics, and the panel says so.

**Mesons** shows the strong force at work. Neighboring nucleons (within
~2 fm) toss pions back and forth: π⁺ (pink), π⁻ (green) and π⁰ (white). A
virtual pion lives about ħ/m_πc² ≈ 0.5 babyseconds and reaches about 1.4 fm.
Charged pions swap identities (p → n + π⁺, then π⁺ + n → p), so protons and
neutrons keep trading places while the total charge stays fixed. For a p–n pair,
charged exchange is twice as likely as π⁰ (isospin). Exchanges are slowed down to
be visible, and the panel counts them. Halo nucleons exchange pions too, but
only when they come within reach of the core. In ¹¹Li that works out to roughly
a quarter as often per nucleon as core nucleons, which is why they're so loosely
bound.

**Ground-state shape** comes from the Nilsson–Strutinsky
(macroscopic–microscopic) method in `js/nuclear-shape.js`:

```
E(β) = E_liquid-drop(β) + δE_shell(β) + δE_pairing(β)
```

- **Liquid drop:** deforming costs surface energy and gains Coulomb energy.
- **Shell correction:** Nilsson single-particle levels (deformed oscillator
  with l·s and l² terms, κ/μ from Bengtsson & Ragnarsson), minus their
  Strutinsky-smoothed average.
- **Pairing:** a BCS correction, minus its smooth average.

The minimum gives β₂: for example Dy-164 0.29, Hf-176 0.26, U-238 0.24, and
Pt-195 oblate at −0.13. Pb-208, Sn-120 and Ca-40 come out spherical. The panel
plots the energy-vs-shape curve and says whether the nucleus is rigid or soft.
Very light nuclei (A < 40) are less reliable, so a couple use measured values.

**Oscillations** drive the mean field, and the nucleons follow:

- Dipole: the proton and neutron wells slosh against each other.
  31.2A^-⅓ + 20.6A^-⅙ MeV (Berman–Fultz).
- Breathing: 80A^-⅓ MeV.
- Quadrupole: 63A^-⅓ MeV.
- Rotation of deformed nuclei: E(2⁺) from the Grodzins relation, with the turn
  period at spin J from a rigid rotor, ω = (2J+1)E(2⁺)/6ħ. Nuclei don't rotate
  rigidly: pairing makes them partly superfluid. The nucleons are carried by a
  blend of rigid rotation (v = Ω × r) and the irrotational flow inside a rotating
  spheroid (v = Ωk·(0, z, y), k = (b² − c²)/(b² + c²), Lamb §110), in which the
  bulge travels around while the nucleons slosh. The blend is chosen so the moment
  of inertia matches I = 3ħ²/E(2⁺): about 40% of rigid for ²³⁸U, versus 5% for an
  ideal fluid. **Flow** switches between Rigid, Measured mix and Superfluid.

Amplitudes are exaggerated so they can be seen.

**Quarks** shows three quarks inside every nucleon, with gluon lines and color
charges that keep swapping. **Inside a proton / neutron** zooms into one
nucleon: valence quarks (uud or udd) with their charges, wiggling gluon flux
tubes, and flickering sea quark pairs. It also explains that the quarks' own
masses are only about 1% of the nucleon's mass.

Inspired by MIT's [Visualizing the Nucleus](https://www.youtube.com/watch?v=ach9JLGs2Yc).

## What you're looking at

- **Configurations** follow the Madelung (aufbau) rule, with the known exceptions
  (Cr, Cu, Pd, Au, the early actinides, and others) listed in `js/electron-config.js`.
- **Orbital shapes** are hydrogen-like wavefunctions (real spherical harmonics ×
  hydrogenic radial functions). They're scaled by an effective nuclear charge from
  Slater's rules, so relative sizes across shells are realistic but approximate.
- **Cloud** style draws points sampled from |ψ|². **Surface** style draws the
  isosurface that encloses ~85% of the probability (built with marching cubes).
- **Phase** coloring shows the sign of ψ, so lobes of opposite sign and radial
  nodes are visible.
- The **electron dots** hop between sampled positions. They show where an
  electron might be found, not a trajectory.

## Controls

- Drag to rotate, scroll to zoom, press **F** to refit the view.
- Press **← / →** to step through the elements.
- Click a subshell or orbital box in the panel to hide or show it, and hover
  over it to highlight it.

## Files

- `js/elements.js`: element data, categories, and table layout
- `js/electron-config.js`: configurations, Slater Z_eff, and Hund's-rule occupancy
- `js/orbitals.js`: wavefunction math, sampling, and isosurface fields
- `js/viewer.js`: three.js scene
- `js/molecule-data.js`: covalent radii, electronegativity, and measured molecule geometries
- `js/molecule.js`: Lewis structures, VSEPR geometry, ionic compounds, Z-matrix conversion, SMILES molecules, and π and lone-pair orientation
- `js/smiles.js`: SMILES parser (rings, branches, charges, implicit H, stereo)
- `js/forcefield.js`: force field (including H-bonds), FIRE minimizer, conformer search, and docking
- `js/conformer-worker.js`: runs the conformer search off the main thread
- `js/eht.js`: Extended Hückel molecular orbitals (STO-3G overlaps, Jacobi eigensolver)
- `js/molecule-viewer.js`: three.js molecule scene (structure, orbitals, density)
- `js/molecule-ui.js`: molecule builder UI
- `js/nucleus-data.js`: isotopes, radii and neutron skins, halos, mass formula, and collective mode energies
- `js/nuclear-shape.js`: Nilsson–Strutinsky ground-state deformation (liquid drop + shell + pairing)
- `js/nucleus-viewer.js`: nucleon dynamics (mean field, NN force, thermostat) and the three.js nucleus and nucleon scenes
- `js/nucleus-ui.js`: Nucleus mode controls and info
- `js/main.js`: UI wiring and mode switching
