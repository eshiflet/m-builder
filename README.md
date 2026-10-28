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
- **Orbitals view:** hybrid orbitals (σ) point along the bonds and overlap
  head-on. p orbitals (orange/blue by phase) overlap side by side to form π
  bonds. Lone pairs are shown in lavender.
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

Link to a molecule with `#mol=H2O`, to an ion with `#mol=CO3&q=-2`, to a
specific isomer and conformer with `#mol=C6H12O6&v=1&c=2`, or to any SMILES
with `#smiles=CCO`.

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
- `js/forcefield.js`: force field, FIRE minimizer, and conformer search
- `js/molecule-viewer.js`: three.js molecule scene (structure, orbitals, density)
- `js/molecule-ui.js`: molecule builder UI
- `js/main.js`: UI wiring and mode switching
