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
- **Vibrations view:** normal modes from a valence force field
  (`js/vibrations.js`). Bond stretches use measured force constants by bond
  type, or Badger's rule, with stiffer cumulated C=O as in CO₂. Bend, torsion
  and out-of-plane terms are referenced to the molecule's own geometry. The
  mass-weighted Hessian, with translations and rotations projected out, gives
  3N − 6 (or 3N − 5) modes, ν̃ = 1302.79·√λ cm⁻¹. IR intensities ∝ |dμ/dQ|²,
  using Mulliken charges from the molecular-orbital calculation, so symmetry
  rules come out right: N₂, O₂ and CO₂'s symmetric stretch are inactive, and
  benzene has exactly 7 active modes. Typical error vs measured fundamentals is
  1–6%: CO₂ 2%, H₂O 1.4%, CH₄ 1.7%. The spectrum is drawn over Earth's 288 K
  thermal emission, to show why CO₂ (bend at 667 cm⁻¹), H₂O and CH₄ are
  greenhouse gases and N₂ and O₂ aren't. Modes animate (slowed ~10¹³×,
  exaggerated); ↑/↓ steps through them.
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

**Polarity** colors the molecule's surface (the 0.002 e/bohr³ contour of the
promolecule density) by electrostatic potential: red where electrons pile up
(δ−), blue where nuclei are exposed (δ+). Partial charges come from
Gasteiger–Marsili electronegativity equalization, plus a small dipole along
each lone pair (fit to measured dipoles: mean error about 0.3 D over 25
molecules). A gold arrow shows the dipole moment, drawn from + to −, with the
measured value alongside where known. Water is polar and CO₂ isn't, because the
bent shape adds the bond dipoles while the straight one cancels them. Carbon
monoxide is flagged as the case point charges get wrong.

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

Amplitudes are exaggerated so they can be seen. The three giant resonances are **damped**: each
excitation rings down with amplitude e^(−Γt/2ħ) and a new γ-ray re-excites it
every few cycles. Widths come from systematics (GDR Γ ≈ 0.026·E^1.91,
broadened by deformation; GMR ≈ 0.2E; GQR ≈ 0.27E), giving 3.9 MeV for the
²⁰⁸Pb GDR against 4.0 measured, so it dies within about one cycle. Uncheck
**Damped** to see the idealized undamped mode.

**Pear-shaped nuclei.** ²²²⁻²²⁸Ra, ¹⁴⁴,¹⁴⁶Ba and ²²⁰Rn (an octupole vibrator)
carry a measured octupole deformation β₃ ≈ 0.06–0.17 alongside their β₂. Their
mean field is R(θ) = R₀(1 + β₁Y₁₀ + β₂Y₂₀ + β₃Y₃₀), with β₁ solved so the center
of mass stays put. The panel explains why pear shapes matter for electric
dipole moment searches. Their measured α and β decays were added too: Gamow
tunneling gives ²²⁴Ra a half-life of 3.7 days, against 3.63 measured.

**Decay & reactions** plays what the selected isotope does, with captions and
a chart. Q values and half-lives are measured for about 60 well-known nuclides;
others are predicted from the mass formula and labeled as such.

- **α decay:** a 2p+2n cluster forms, rattles against the Coulomb barrier, and
  tunnels out. Gamow's model gives the half-life: G = √(2μc²)/(ħc)·2Z_d e²/√Q·
  [arccos√x − √(x(1−x))], t½ = ln2/(preformation·ν·e^(−2G)), with ~3%
  preformation. It reproduces measured half-lives from ²¹²Po (0.3 µs) to ²³⁸U
  (4.5 billion years) within a factor of a few, across 23 orders of magnitude.
  The chart shows the barrier and the tunneling region.
- **β⁻, β⁺ and electron capture:** a nucleon changes identity (d → u + W⁻ →
  e⁻ ν̄, and so on), emitting a lepton and a (anti)neutrino. The chart shows the
  isobar mass parabola that β decay slides down.
- **Neutron-induced fission** (Z ≥ 90): absorption, stretching, necking,
  scission, fragments and prompt neutrons, using two-center fragment wells. The
  liquid-drop barrier comes from the Cohen–Swiatecki fit to the fissility
  (≈6 MeV for ²³⁶U), and Q ≈ 170–200 MeV from binding energies. The chart shows
  the binding-energy-per-nucleon curve.
- **D + T fusion** (for hydrogen): tunneling through the Coulomb barrier, ⁵He*,
  then ⁴He + n with Q = 17.6 MeV from measured binding energies.

After a decay, **Show** jumps to the daughter nucleus.

**Bombard with** fires one particle straight at the nucleus: a **neutron**, **proton**,
**electron**, **γ ray**, or **α particle** (the projectile Rutherford used for the first
artificial transmutation, ¹⁴N(α,p)¹⁷O, and Chadwick to find the neutron). Pick the energy
with the slider (0.01 eV to 500 MeV, log scale) or a preset such as thermal neutrons,
14 MeV D–T neutrons, or the giant dipole resonance for photons, then **▶ Fire**.

- **Getting in.** Neutrons have no barrier; slow ones have huge wavelengths, so they
  are captured readily. Protons and α particles must cross or tunnel through the
  Coulomb barrier (Gamow), or they turn back far outside (Rutherford scattering, with
  the view zooming out to the turning point). Photons are absorbed in the giant dipole
  resonance (Lorentzian with the Thomas–Reiche–Kuhn sum rule) or, above ~40 MeV, by
  proton–neutron pairs. Electrons nearly always scatter elastically, which is how
  nuclear sizes are measured; rarely they hand over energy through a virtual photon.
- **The compound nucleus.** Once in, the energy E* = separation energy + kinetic energy
  is shared by all the nucleons, which jostle harder (the thermostat runs hotter, with a
  glowing halo), and the nucleus forgets how it formed (Bohr).
- **What it does next** follows the Hauser–Feshbach statistical model: neutron, proton,
  α and γ emission and fission compete in proportion to their open channels
  (transmission × Fermi-gas level density of what's left; Bohr–Wheeler over measured
  barriers for actinides). The residual nucleus keeps emitting until it runs out of
  energy, so you can see (n,γ), (n,p), (n,α), (n,2n), (γ,n), (n,f), photofission and
  spallation-like cascades. Checks: thermal neutrons on ²³⁵U fission 85% of the time
  (measured ≈86%), on ²³⁸U they're captured; ¹⁰B → ⁷Li + α; ¹⁴N(n,p)¹⁴C; ²⁰⁸Pb(γ,n) at
  the giant resonance.
- **Time.** The panel lists every stage with its real duration, from 10⁻²² s for the
  flight in to ~10⁻¹⁴ s for the last γ rays. Each stage is slowed by its own factor
  (shown live under the view), and **Playback** pauses or changes the speed (0.1×–5×).
- **Results:** the odds of every outcome (click a row to watch that one), an energy
  budget (kinetic energy in, Q from the mass difference, every particle and γ ray out,
  plus recoil), and what's left, with whether it's stable or how it decays and a button
  to open it. **Hits only** skips shots that miss, unless getting in is rarer than 0.1%.

Not modeled: individual resonances (real slow-neutron cross sections swing by factors
of 1000), direct one-step reactions, pre-equilibrium emission and pion production, and
the discrete levels of light nuclei, so odds there are rough.

**Shell model** (a View option) shows the Nilsson diagram: the energy of every
proton or neutron orbital versus deformation δ, from the deformed shell model
(a stretched harmonic oscillator plus spin–orbit and l² terms, with
Bengtsson–Ragnarsson κ and μ, diagonalized in each oscillator shell). At δ = 0
the levels bunch into the spherical shells (1s1/2, 1p3/2, …) and the gaps give
the magic numbers 2, 8, 20, 28, 50, 82, 126. Deforming splits each j level into
orbitals labeled by Ω (the spin's projection on the symmetry axis) and parity.
Dots mark the filled orbitals at the nucleus's ground-state deformation. The
Fermi level and the unpaired nucleon's orbital come from BCS pairing
(Δ = 12/√A MeV). For odd-A nuclei the panel predicts the ground-state spin
(Ω if deformed, j if round) and compares it with the measured value for 77
nuclei. It gets 53 right; most misses are cases known to need residual
interactions. Click a line to see that orbital in 3D: the probability density
of one nucleon, colored by its spin-up and spin-down parts, inside the
nuclear surface. Drag **Deformation δ** to watch the orbitals reshape:
low-Ω orbitals gather at the tips of a prolate nucleus, high-Ω ones ring
its waist.

**Chart of nuclides** (a View option) lays out every known and predicted
nucleus as a square: neutrons N across, protons Z up. The ~250 stable nuclei
form the valley of stability, which follows N = Z for light elements and bends
toward extra neutrons for heavy ones. Colors show the decay mode: β⁻ (blue),
β⁺/electron capture (red), α (yellow), spontaneous fission (green). Measured
modes are solid and predicted ones are faded. Outlined squares are primordial
(long-lived enough to survive since the Earth formed). Dashed lines mark the
magic numbers 2, 8, 20, 28, 50, 82, 126. The outer edges are the drip lines,
where the mass formula's two-neutron or two-proton separation energy goes
negative. **Binding energy** recolors by B/A, which peaks near iron. Scroll to
zoom, drag to pan, click a square for details, and double-click to open that
nucleus in 3D.

**Chain reaction** (a View option) has two systems.

*Metal ball*: a 3D ball of fuel, optionally inside a reflector. **▶ Start chain**
sends in 1, 10 or 100 neutrons and follows each one with Monte Carlo neutron
transport, in real centimetres and nanoseconds. Each neutron flies a random
distance set by the cross sections, then scatters, is captured, or splits a
nucleus, which frees 2–3 new neutrons. Fissions flash and turn their dot red,
and trails show neutrons branching and leaking out through the surface.
Controls: **Fuel** (uranium with any ²³⁵U share, or plutonium-239), **Fuel
radius**, and **Reflector** (natural uranium, beryllium or water, with a
thickness). With these cross sections, the Godiva, Jezebel and Flattop
benchmark critical experiments come out within about 1% of k = 1.

*Reactor core*: a sphere holding a cubic lattice of uranium-metal lumps in
**graphite**, **water** or **heavy water**, with nine boron-carbide **control
rods** that drop in from the top. Presets are CP-1 (Chicago 1942), a
water-cooled core with 4% fuel, and a heavy-water core with natural uranium.
Sliders set the lump size, the spacing between lumps and the core radius;
**Mixed evenly** spreads the same fuel uniformly through the moderator.
²³⁸U's resonances below 4 keV are drawn individually and Doppler-broadened,
so lumping really helps, as it did for CP-1. Their dilute resonance integral
comes out at 277 b (measured 275 b). Natural uranium in graphite gives
k∞ = 1.055 in lumps and 0.66 mixed evenly. The panel splits k∞ into the four
factors (η, f, p, ε) and gives the migration length, k at the current rod
position (fitted through three rod positions), the rods' worth in dollars and
the critical size. **▶ Run the reactor** switches to the seconds-to-minutes
clock: point kinetics with six delayed-neutron groups, fed with k, β and the
prompt generation time from the transport runs. Pull the rods out (they move
2% of their travel per second) and watch the power and the period on a log
chart. The panel also says when the core is supercritical on delayed neutrons
or prompt critical. **SCRAM** drops the rods; an automatic SCRAM trips on a
period under 10 s or power above 10 MW.

*AP1000* (a reactor-core preset): Westinghouse's pressurized-water reactor,
rod by rod, from its Design Control Document (Rev. 19). The core has 157
fuel assemblies of 17×17 rods: 41,448 UO₂ fuel rods in zirconium-alloy
cladding, with guide tubes and an instrument tube. They sit in borated water
inside the core barrel. The first core's three enrichments are 2.35%, 3.40%
and 4.45%. It has 53 black and 16 gray rod clusters (silver–indium–cadmium
rodlets), plus its burnable absorbers: borosilicate-glass rods and
boride-coated fuel. Controls set the dissolved boron, hot zero power
(557 °F) or cold (68 °F), the burnable absorbers on or off, and the rods.
All 69 clusters move together at the real 45 inches per minute. The panel
gives k∞ for one assembly, k for the core, rod worth, prompt neutron
lifetime and the estimated critical boron, each next to the published
design value. Temperature enters the physics: ²³⁸U's resonances are
Doppler-broadened, and thermal neutrons take on a Maxwell spread at the
water's temperature. Silver, indium and cadmium have their main capture
resonances drawn individually. Checks:

- ORNL's VERA benchmark for this fuel at 565 K (a fuel-rod cell, an
  assembly, and an assembly with 24 Ag–In–Cd rods) agrees within 0.4%.
- At 1,382 ppm, hot, with the rods out, the core gives k = 1.000 ± 0.005.
  The design's critical boron is 1,382 ppm.
- The boron worth comes out at −8.2 pcm/ppm (design range −6.9 to −10.5).
- The prompt neutron lifetime comes out at 21 µs (design 19.8 µs).

Which assemblies hold rod clusters and burnable absorbers is a symmetric
reconstruction that matches the published counts. The 69 clusters come out
worth about 10–11%, against the design's 12.7%.

*Sequoyah* (a reactor-core preset): TVA's Sequoyah Nuclear Plant near
Chattanooga, two Westinghouse four-loop PWRs, rod by rod. The core has 193
assemblies of 17×17 fuel (50,952 fuel rods), 12 ft of active fuel, and a
steel baffle round it. Its 53 silver–indium–cadmium rod clusters sit at the
positions and in the banks (A–D, SA–SD) that TVA gave the NRC in 2019.
**Rods that move** switches between all banks and bank D only; bank D is the
bank operators bring the reactor critical on. Sequoyah now runs on
part-burned fuel, which needs burn-up to model. So the fuel is a fresh first
core: that of its identical twin, Watts Bar Unit 1 (2.11%, 2.62% and 3.10%,
with 1,712 borosilicate-glass absorber rods), as ORNL published it in the VERA
benchmark along with the measured startup physics. Against those
measurements:

- With the rods out at 1,291 ppm, k = 1.010 ± 0.002, so critical boron comes
  out near 1,375 ppm (measured 1,291).
- Bank D is worth 1,305 ± 300 pcm (measured 1,342).
- The boron worth is about −9 pcm/ppm (measured −10.8).

The panel shows the statistical uncertainty on the critical boron and rod
worths, which comes from separate Monte Carlo runs.

In both systems a bar at the top of the view shows the **neutrons produced**
so far (by fission, delayed emission and (n,2n), not counting the source), the
**production rate** per second, and the **trend**: speeding up, steady or
slowing down, with the doubling or halving time. While watching neutrons the
trend compares the last two stretches of the run and only calls a change once
it is well beyond the counting noise; when running the reactor it comes from
the last ten seconds of power.

Both systems: every fission frees a measured fraction of delayed neutrons,
which wait as orange precursor dots and appear seconds later. A Web Worker
works out k and the critical size. The live readout shows neutrons in flight,
fissions, energy in joules and TNT, the measured prompt k, and a log chart of
neutrons per generation. Playback runs in simulated time per second
(**Auto** aims for one generation every 2.5 s), with a cutaway option. Click a
flash to watch that fission in the nucleus view. Above 1,200 neutrons in
flight, half are dropped at random and the rest count double (Russian
roulette). Not modeled: temperature feedback, cladding and coolant channels,
xenon, burn-up, and the fuel heating up and expanding.

**Quarks** shows three quarks inside every nucleon, with gluon lines and color
charges that keep swapping. **Inside a proton / neutron** zooms into one
nucleon: valence quarks (uud or udd) with their charges, wiggling gluon flux
tubes, and flickering sea quark pairs. It also explains that the quarks' own
masses are only about 1% of the nucleon's mass.

Inspired by MIT's [Visualizing the Nucleus](https://www.youtube.com/watch?v=ach9JLGs2Yc).

## Zoom (powers of ten)

One continuous zoom over eleven powers of ten: liquid water (about 70 molecules
at liquid density), one water molecule, the oxygen atom's electron cloud
(sampled from |ψ|²), the empty space inside the atom, the oxygen-16 nucleus,
one proton, its three quarks and gluon flux tubes, and finally a single up
quark that never resolves, since no quark size has been measured down to
10⁻¹⁹ m. Each layer is built in its own unit (Å or fm) and rescaled every
frame, so the view spans 10⁻⁷·⁶ to 10⁻¹⁸·⁵ m without losing floating-point
precision. Scroll or use the slider to zoom, press **Zoom in** to fly the whole
way, or click a step in the ladder. Everything is to scale except the
stand-ins for things too small to draw (the nucleus glint and the quarks).

## What you're looking at

- **Configurations** follow the Madelung (aufbau) rule, with the known exceptions
  (Cr, Cu, Pd, Au, the early actinides, and others) listed in `js/electron-config.js`.
- **Orbital shapes** combine real spherical harmonics (the angular part) with
  numerical radial functions from a self-consistent density-functional
  calculation of each atom (`js/atom-scf.js`): LDA with Slater exchange and
  Perdew–Zunger correlation, solved by Numerov shooting on a log grid with
  density mixing, in 20–200 ms per element. Orbital energies match the NIST LDA
  reference tables to about 1 mHa, and orbital sizes are close to Hartree–Fock,
  so 4s really is about four times larger than 3d in iron. Anions in ionic
  compounds get a Watson sphere at their ionic radius, standing in for the
  crystal field that binds their extra electrons. Relativity is not included.
  Slater's-rules Z_eff is still shown for reference.
- **Cloud** style draws points sampled from |ψ|². **Surface** style draws the
  isosurface that encloses ~85% of the probability (built with marching cubes).
- **Phase** coloring shows the sign of ψ, so lobes of opposite sign and radial
  nodes are visible.
- The **electron dots** hop between sampled positions. They show where an
  electron might be found, not a trajectory.

- **Radial probability** plots r²R² for each occupied subshell (on a log-r axis,
  as probability per ln r, past the second period). It shows radial nodes,
  penetration, and why 3d sits inside 4s even though 4s fills first. Hover a
  curve or a subshell to highlight it in 3D.
- **Emission spectrum**: hydrogen's Balmer lines come from the Rydberg formula
  (reduced-mass Rydberg constant, air wavelengths), with an energy-level
  diagram of the Lyman, Balmer and Paschen series. Click a line to see its
  transition. About 20 other elements show their strong visible lines from NIST
  (the sodium doublet, neon's reds, mercury's blue and green).
- **Color by** recolors the table by atomic radius (Cordero covalent radii),
  first ionization energy (NIST), or Pauling electronegativity. The color range
  spans the 5th to 95th percentile so helium doesn't wash out the rest. Hover an
  element for its value.

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
- `js/vibrations.js`: valence force field, normal modes, IR intensities, measured reference frequencies
- `js/nilsson.js`: Nilsson diagram, BCS filling, orbital wavefunctions and sampling, measured spins
- `js/nuclide-chart.js`: chart of nuclides canvas (zoom, pan, pick)
- `js/atom-data.js`: ionization energies, electronegativities, radii, emission lines
- `js/atom-extras.js`: radial plots, spectrum strip, hydrogen level diagram, trend colors
- `js/polarity.js`: Gasteiger charges, lone-pair dipoles, dipole moment, electrostatic potential, measured dipoles
- `js/zoom-viewer.js`, `js/zoom-ui.js`: powers-of-ten zoom (layers, fades, captions)
- `js/eht.js`: Extended Hückel molecular orbitals (STO-3G overlaps, Jacobi eigensolver)
- `js/molecule-viewer.js`: three.js molecule scene (structure, orbitals, density)
- `js/molecule-ui.js`: molecule builder UI
- `js/nucleus-data.js`: isotopes, radii and neutron skins, halos, mass formula, and collective mode energies
- `js/nuclear-shape.js`: Nilsson–Strutinsky ground-state deformation (liquid drop + shell + pairing)
- `js/nucleus-viewer.js`: nucleon dynamics (mean field, NN force, thermostat) and the three.js nucleus and nucleon scenes
- `js/reactions.js`: compound-nucleus reactions (Coulomb tunneling, photoabsorption, level densities, decay widths, cascades, fission splits)
- `js/bombard.js`: turns one collision into animation stages, captions, real timings, odds, energy budget and products
- `js/chain.js`: neutron transport for chain reactions (cross sections, resonances with Doppler broadening, delayed neutrons, ball, reactor-lattice and rod-by-rod PWR geometry (AP1000, Sequoyah), k and four factors by power iteration, critical size, point kinetics)
- `js/chain-worker.js`: computes k and the critical size off the main thread (the page runs several at once, one task each)
- `js/chain-viewer.js`: the 3D chain-reaction scene and live simulation
- `js/chain-ui.js`: chain-reaction controls and readout
- `js/nucleus-ui.js`: Nucleus mode controls and info
- `js/main.js`: UI wiring and mode switching
