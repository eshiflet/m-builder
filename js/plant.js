// The rest of the plant around a PWR core, for the control panel: fuel and coolant temperatures,
// the steam generators and turbine, the pressurizer, decay heat, the boron makeup system, the
// rod control system and the reactor protection system. Lumped (one node each), in the units the
// control room uses: °F, psig, MW, ppm, steps. The core's neutrons come from point kinetics in
// chain-ui; this adds the temperature feedback and everything the meters show.

const PSIA = 14.7;
// Saturated water/steam, fitted between 500 and 560 °F: ln P(psia) = A − B / T(°R).
const SAT_A = 15.177, SAT_B = 8304;
export const psatF = (T) => Math.exp(SAT_A - SAT_B / (T + 459.67)); // psia
export const tsatF = (P) => SAT_B / (SAT_A - Math.log(Math.max(1e-3, P))) - 459.67; // °F

// Decay heat after long operation, ≈ 6% at shutdown falling as t^−0.2 (Way–Wigner), as six groups
// that charge up with the fission power: [fraction of fission power, time constant s].
const DECAY_HEAT = [[0.022, 3], [0.013, 30], [0.0095, 300], [0.006, 3000], [0.0038, 3e4], [0.006, 3e5]];
const DECAY_SUM = DECAY_HEAT.reduce((s, [f]) => s + f, 0);

const STEP_CM = 1.5875; // a rod step is 5/8 in

/**
 * Per design: rated heat, the Tavg program (no-load and full-load average coolant temperature),
 * full-power ΔT across the core, full-load steam temperature, heat capacities (MJ/°F) of the
 * reactor coolant and of the steam generators' water, coolant pumps and loops, the RCS volume and
 * boric acid tank strength (for boration/dilution), and whether a turbine trip trips the reactor.
 */
export const PLANT = {
  ap1000: {
    name: 'AP1000', MWt: 3400, Tnl: 557, Tfull: 573.6, dTfull: 75, TsFull: 523, Tfuel: 1150,
    Crcs: 720, Csg: 500, pumps: 4, loops: 2, pumpMW: 4, rcsGal: 75000, bat: 4375, eff: 0.34,
    lvlFull: 55, dumpFrac: 0.4, porv: false, turbineTripTrip: false, bankLabels: ['ALL 69'],
  },
  sequoyah: {
    name: 'Sequoyah', MWt: 3455, Tnl: 557, Tfull: 588.2, dTfull: 61, TsFull: 545, Tfuel: 1150,
    Crcs: 880, Csg: 500, pumps: 4, loops: 4, pumpMW: 4.5, rcsGal: 90000, bat: 7000, eff: 0.34,
    lvlFull: 60, dumpFrac: 0.4, porv: true, turbineTripTrip: true,
    bankLabels: ['SA', 'SB', 'SC', 'SD', 'A', 'B', 'C', 'D'],
  },
};

// Trip setpoints (Westinghouse values).
const SR_TRIP = 1e5; // cps
const IR_TRIP = 0.25, PR_LOW = 0.25, PR_HIGH = 1.09, PR_RATE = 0.05; // fraction of rated; rate per 2 s
const PZR_HIGH = 2385, PZR_LOW = 1970, PZR_SET = 2235, PZR_PORV = 2335; // psig
const SG_DUMP_PSIG = 1092, SG_SAFETY_PSIG = 1185;

export const TRIPS = {
  manual: 'Manual reactor trip',
  sr: 'Source range high flux',
  ir: 'Intermediate range high flux',
  prLow: 'Power range high flux, low setpoint',
  prHigh: 'Power range high flux',
  prRate: 'Power range high positive rate',
  otdt: 'Overtemperature ΔT',
  pzrHigh: 'Pressurizer pressure high',
  pzrLow: 'Pressurizer pressure low',
  flow: 'Reactor coolant flow low',
  turbine: 'Turbine trip',
};

export class Plant {
  /** design: 'ap1000' | 'sequoyah'; H: active fuel height (cm); boron: ppm; hot: hot zero power or cold. */
  constructor(design, { H, boron, hot, boronWorth }) {
    const S = (this.spec = PLANT[design]);
    this.design = design;
    this.hot = hot;
    this.steps = Math.round(H / STEP_CM);
    this.rodRate = (spm) => (spm * STEP_CM) / 60 / H; // fraction of travel per second
    this.T0 = hot ? S.Tnl : 68; // the state the Monte Carlo k was worked out at
    this.B0 = boron;
    this.boronWorth = boronWorth; // ln k per ppm (negative)
    this.UA = S.MWt / (S.Tfull - S.TsFull); // MW/°F, steam generators
    this.Wcp = S.MWt / S.dTfull; // MW/°F, coolant flow × heat capacity, all pumps
    this.Rf = (S.Tfuel - S.Tfull) / S.MWt; // °F per MW, fuel to coolant
    this.tauF = 5; // s, fuel
    this.Tdump = tsatF(SG_DUMP_PSIG + PSIA);
    this.Tsafety = tsatF(SG_SAFETY_PSIG + PSIA);
    // State.
    this.t = 0;
    this.boron = boron;
    this.Tavg = this.Tf = this.Ts = this.T0;
    this.Ppzr = hot ? PZR_SET : 350;
    this.flow = Array(S.pumps).fill(1);
    this.decay = DECAY_HEAT.map(() => 0);
    this.load = 0; // turbine load, fraction of rated
    this.frac = 0; // neutron power, fraction of rated
    this.fracLag = 0;
    this.logLag = null;
    this.sur = 0; // decades per minute
    this.sgSteamLag = 0;
    this.dumpArmed = false; // steam dumps on Tavg control after a load rejection
    this.heat = 0;
    this.q = { core: 0, sg: 0, turbine: 0, dump: 0, safety: 0 };
    // Controls, set from the panel.
    this.ctl = {
      rodMode: 'man', lever: 0, // lever −1 in, 0 hold, +1 out
      makeup: 'off', gpm: 100, // 'dilute' | 'borate' | 'off'
      latched: false, loadSet: 0, loadRate: 5, // %/min
      pumps: Array(S.pumps).fill(true),
      srBlock: false, prBlock: false,
    };
    this.trip = { latched: false, firstOut: null };
    this.signals = new Set(); // trip signals present now (whether or not they tripped)
    this.events = []; // short notes for the caption log
  }

  get MW() { return this.frac * this.spec.MWt; }
  get flowFrac() { return Math.max(0.04, this.flow.reduce((a, b) => a + b, 0) / this.flow.length); } // natural circulation floor
  get dT() { return this.q.core / (this.Wcp * this.flowFrac); }
  get Thot() { return this.Tavg + this.dT / 2; }
  get Tcold() { return this.Tavg - this.dT / 2; }
  get Tref() { return this.spec.Tnl + (this.spec.Tfull - this.spec.Tnl) * this.load; }
  get steamPsig() { return Math.max(0, psatF(this.Ts) - PSIA); }
  get pzrLevel() {
    const S = this.spec;
    return this.hot ? Math.max(0, Math.min(100, 25 + ((this.Tavg - S.Tnl) * (S.lvlFull - 25)) / (S.Tfull - S.Tnl))) : 100;
  }
  get pzrLevelProgram() { const S = this.spec; return 25 + (S.lvlFull - 25) * this.load; }
  get sgLevel() { return Math.max(0, Math.min(100, 50 + 60 * (this.steamFrac - this.sgSteamLag))); }
  get steamFrac() { return (this.q.turbine + this.q.dump + this.q.safety) / this.spec.MWt; }
  get MWe() { return this.q.turbine * this.spec.eff; }
  get srCps() { return this.srEnergized ? 1e11 * this.frac + 0.5 : 0; }
  get irAmps() { return 1e-3 * this.frac + 1e-11; }
  get srEnergized() { return !(this.ctl.srBlock && this.P6); }
  get P6() { return this.irAmps > 1e-10; }
  get P10() { return this.frac >= 0.1; }
  get P7() { return this.frac >= 0.1 || this.load >= 0.1; }
  get P8() { return this.frac >= 0.48; }
  get P9() { return this.frac >= 0.5; }
  get C5() { return this.load >= 0.15; }
  /** Moderator temperature coefficient, pcm/°F: near zero with lots of boron, about −30 with none. */
  get mtc() { return -30 + 0.02 * this.boron; }
  get doppler() { return -1.6; } // pcm/°F of average fuel temperature

  /** Reactivity this adds to the core's own k (boron away from the Monte Carlo value, and temperatures), as ln k. */
  reactivity() {
    return this.boronWorth * (this.boron - this.B0) + 1e-5 * (this.doppler * (this.Tf - this.T0) + this.mtc * (this.Tavg - this.T0));
  }

  /**
   * What the rod control system wants, given the rods at `now` (0 out … 1 in): { target, rate }
   * or null when it isn't moving them (the slider is free).
   */
  rodDemand(now) {
    if (this.trip.latched) return null;
    const c = this.ctl;
    if (c.lever) return c.lever > 0 && this.withdrawBlocked() ? { target: now, rate: 0 } : { target: c.lever > 0 ? 0 : 1, rate: this.rodRate(48) };
    if (c.rodMode !== 'auto') return null;
    const e = this.Tavg - this.Tref, a = Math.abs(e);
    if (a < 1.5) return { target: now, rate: 0 };
    const spm = a < 3 ? 8 : Math.min(72, 8 + (a - 3) * 32);
    if (e < 0 && this.withdrawBlocked(true)) return { target: now, rate: 0 };
    return { target: e > 0 ? 1 : 0, rate: this.rodRate(spm) };
  }

  /** Rod withdrawal is blocked by a trip not yet reset, or (auto only) below 15% turbine load (C-5). */
  withdrawBlocked(auto = false) { return this.trip.latched || (auto && !this.C5); }

  /**
   * Advance by h seconds (keep h ≲ 0.1 s) with the core making P watts of fission power.
   * Returns the trip that fired, if any.
   */
  step(h, P, { autoTrip = true } = {}) {
    const S = this.spec, c = this.ctl;
    this.t += h;
    const MWf = P / 1e6;
    const frac = MWf / S.MWt;
    // Neutron instruments.
    this.fracLag += (frac - this.fracLag) * (1 - Math.exp(-h / 2));
    const lg = Math.log10(Math.max(frac, 1e-14));
    if (this.logLag === null) this.logLag = lg;
    const surNow = (60 * (lg - this.logLag)) / 3; // log power over a 3 s lag → decades per minute
    this.logLag += (lg - this.logLag) * (1 - Math.exp(-h / 3));
    this.sur = surNow;
    this.frac = frac;
    if (!this.P6 && c.srBlock) { c.srBlock = false; this.events.push('Below P-6: the source range trip is back in, automatically.'); }
    if (!this.P10 && c.prBlock) { c.prBlock = false; this.events.push('Below P-10: the intermediate range and low power range trips are back in.'); }

    // Heat: fission power less what goes to the fission products, plus their decay heat.
    let heat = MWf * (1 - DECAY_SUM);
    this.decay = this.decay.map((H, i) => {
      const [f, tau] = DECAY_HEAT[i];
      const v = f * MWf + (H - f * MWf) * Math.exp(-h / tau);
      heat += v;
      return v;
    });
    this.heat = heat;

    // Pumps coast down (flywheels) or speed up.
    this.flow = this.flow.map((f, i) => {
      const on = c.pumps[i];
      return (on ? 1 : 0) + (f - (on ? 1 : 0)) * Math.exp(-h / (on ? 15 : 12));
    });
    const flow = this.flowFrac;
    const pumpHeat = S.pumpMW * this.flow.reduce((a, b) => a + b, 0);

    // Fuel relaxes toward the temperature that passes `heat` to the coolant.
    const TfEq = this.Tavg + heat * this.Rf;
    this.Tf = TfEq + (this.Tf - TfEq) * Math.exp(-h / this.tauF);
    const qCore = (this.Tf - this.Tavg) / this.Rf;

    // Turbine load ramps to its setpoint; the steam dumps hold no-load steam pressure; then the safety valves.
    if (c.latched) {
      const d = c.loadSet / 100 - this.load, r = (c.loadRate / 100 / 60) * h;
      this.load += Math.max(-r, Math.min(r, d));
    } else this.load = 0;
    const qSg = this.UA * Math.sqrt(flow) * (this.Tavg - this.Ts);
    const qTurb = this.load * S.MWt * Math.min(1, Math.max(0, (this.Ts - 400) / 100));
    const dumpsOk = !this.hot || this.Tavg >= 553; // P-12: low-low Tavg blocks the dumps
    // After a load rejection the dumps are armed on Tavg: fully open 8 °F above no-load, until it's back down.
    if (this.dumpArmed && this.Tavg < S.Tnl + 1) this.dumpArmed = false;
    const demand = Math.max(100 * (this.Ts - this.Tdump), this.dumpArmed ? (S.dumpFrac * S.MWt * (this.Tavg - S.Tnl)) / 8 : 0);
    const qDump = dumpsOk ? Math.max(0, Math.min(S.dumpFrac * S.MWt, demand)) : 0;
    const qSafe = Math.max(0, 500 * (this.Ts - this.Tsafety));
    const TavgOld = this.Tavg;
    this.Tavg += (h * (qCore + pumpHeat - qSg)) / S.Crcs;
    this.Ts += (h * (qSg - qTurb - qDump - qSafe)) / S.Csg;
    this.q = { core: qCore, sg: qSg, turbine: qTurb, dump: qDump, safety: qSafe, pumps: pumpHeat };
    const steam = this.steamFrac;
    this.sgSteamLag += (steam - this.sgSteamLag) * (1 - Math.exp(-h / 40));

    // Pressurizer: surges with the coolant's expansion; heaters and sprays bring it back.
    const pset = this.hot ? PZR_SET : 350;
    const dTdt = (this.Tavg - TavgOld) / h;
    this.Ppzr += h * (12 * dTdt + Math.max(-10, Math.min(3, (pset - this.Ppzr) / 25)));
    if (S.porv && this.Ppzr > PZR_PORV) this.Ppzr -= h * 20 * (this.Ppzr - PZR_PORV);

    // Boron: dilute with pure water, or borate from the boric acid tank, into the RCS volume.
    if (c.makeup === 'dilute') this.boron -= (h / 60) * this.boron * (c.gpm / S.rcsGal);
    else if (c.makeup === 'borate') this.boron += (h / 60) * (S.bat - this.boron) * (c.gpm / S.rcsGal);

    return this.protect(autoTrip);
  }

  /** The reactor protection system: which trip signals are present, and the one that trips first. */
  protect(autoTrip) {
    const sig = this.signals;
    sig.clear();
    const f = this.frac, c = this.ctl, S = this.spec;
    if (!c.srBlock && this.srCps > SR_TRIP) sig.add('sr');
    if (!c.prBlock && f > IR_TRIP) sig.add('ir');
    if (!c.prBlock && f > PR_LOW) sig.add('prLow');
    if (f > PR_HIGH) sig.add('prHigh');
    if (f - this.fracLag > PR_RATE) sig.add('prRate');
    if (this.Thot > S.Tfull + S.dTfull / 2 + 12) sig.add('otdt');
    if (this.Ppzr > PZR_HIGH) sig.add('pzrHigh');
    if (this.P7 && this.Ppzr < PZR_LOW) sig.add('pzrLow');
    const lowLoops = this.flow.filter((x) => x < 0.9).length;
    if ((this.P8 && lowLoops >= 1) || (this.P7 && lowLoops >= 2)) sig.add('flow');
    if (this.trip.latched || !autoTrip) return null;
    const first = [...sig][0];
    return first ? this.tripReactor(first) : null;
  }

  /** Open the reactor trip breakers: the rods drop and the turbine trips. Returns the reason. */
  tripReactor(key) {
    if (this.trip.latched) return null;
    this.trip = { latched: true, firstOut: key };
    this.tripTurbine(false);
    this.ctl.lever = 0;
    return TRIPS[key];
  }

  tripTurbine(byHand = true) {
    const was = this.ctl.latched;
    if (was && this.load > 0.05) this.dumpArmed = true;
    this.ctl.latched = false;
    this.ctl.loadSet = 0;
    // A turbine trip at high power trips a Westinghouse four-loop reactor (P-9); the AP1000 rides it out on its dumps.
    if (was && byHand && this.spec.turbineTripTrip && this.P9) return this.tripReactor('turbine');
    return null;
  }

  /** Latch the turbine, if there's steam to roll it on and the reactor isn't tripped. */
  latchTurbine() {
    if (this.trip.latched) return 'The reactor is tripped: reset the trip first.';
    if (this.steamPsig < 600) return 'Not enough steam pressure to roll the turbine (it needs about 600 psig).';
    this.ctl.latched = true;
    return null;
  }

  /** Close the trip breakers again, if no trip signal is still present. */
  resetTrip() {
    if (!this.trip.latched) return null;
    const left = [...this.signals].filter((k) => k !== 'prRate');
    if (left.length) return `Can’t reset: ${TRIPS[left[0]].toLowerCase()} is still in.`;
    this.trip = { latched: false, firstOut: null };
    return null;
  }

  takeEvents() { const e = this.events; this.events = []; return e; }
}
