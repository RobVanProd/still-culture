// The hum.
//
// This is not ambience. It is the game's primary free information channel, and
// the design only works if a trained player can hear things in it they would
// otherwise have to pay to see. Everything it does is therefore a deliberate
// mapping from a field statistic to something the ear is good at.
//
// The ear is very good at three things and we use exactly those:
//
//   Beating.   Two tones a few Hz apart produce an audible pulse whose rate is
//              their difference. People detect beat rates far below the pitch
//              resolution they can consciously report, which makes this the
//              right way to expose the dish disagreeing with itself.
//   Roughness. Energy in the 20-200 Hz modulation band is heard as texture
//              rather than pitch. Interface density drives it, so a dish full of
//              boundaries sounds grainy and a smooth one sounds pure.
//   Register.  Where the mass sits in the dish maps to pitch, so the player
//              hears the culture's centre of gravity move without looking.
//
// None of the three is decisive alone. That is the point: the expert's skill is
// a joint reading of three ambiguous free channels, which is meant to beat one
// decisive expensive one.
//
// ---------------------------------------------------------------------------
// Structure: analysis, voicing, synthesis — in that order and separable.
//
//   analyse()   field statistics -> smoothed scalars.  No audio involved.
//   voicing()   smoothed scalars -> the numbers the oscillators are set to.
//   apply()     voicing -> Web Audio.
//
// The split is not tidiness. Three things depend on it:
//
//   1. Browsers refuse to create an AudioContext before a gesture, so for the
//      first seconds of every session there is no audio graph. The statistics
//      must still be live, or the HUD reads zero and the accessibility channel
//      (a visual equivalent built from the same numbers) has nothing to draw.
//   2. `voicing()` is what a test can assert on. Asserting on the smoothed
//      statistics would measure the analysis and miss the mapping; asserting on
//      the AudioParams would measure the browser. The voicing is the thing the
//      player actually hears, expressed as numbers.
//   3. There is exactly one mapping. When the readout and the oscillators are
//      computed separately they drift apart, and then the HUD is lying.
//
// `tests/audio.js` is the check that any of this is true. It drives the medium
// into the states a player has to tell apart and asks whether the readings
// differ by more than a listener can resolve, and by more than the reading
// varies between dishes in the same state. Both bars, or the channel is
// decoration with a comment claiming otherwise.

import { clamp, clamp01, lerp, smoothstep } from '../core/math.js';

/** Cutoff a voice may never fall below, in Hz. Below this it is a rumble. */
const FILTER_FLOOR = 190;

// Measured ceilings, not guesses.
//
// The first version scaled roughness by 3.2 and presence by 6.0, which put both
// at full scale from about the fourth minute onward: two of the four voices held
// a constant value for more than half of every session and carried no
// information while doing it. These are the observed tops of the range over
// six dishes taken to 560 s, so the audible range now spans the range the field
// actually occupies.
const INTERFACE_FULL = 0.62;
const MASS_FULL = 0.24;

// Where a settled dish sits on the unevenness statistic, and how much beat a
// unit above that is worth.
//
// Measured: a dish with the variant zeroed settles at 0.26-0.30 once it has
// filled in; the same dish with its variant expressing sits at 0.35-0.43. The
// offset puts the first below the rate at which a beat is heard as a beat at all
// and the second about a hertz above it.
//
// Neither number can manufacture a signal. Scaling and offsetting move the
// reading and the dish-to-dish spread of the reading by the same factor, so the
// reliability bar in tests/audio.js is invariant under both — which is the
// reason that bar exists.
const SETTLED_UNEVENNESS = 0.24;
const BEAT_PER_UNIT = 12;

export class Hum {
  /** @param {{started:boolean, drone?:Function}} audio an Audio, or any object with `started` */
  constructor(audio) {
    this.audio = audio;
    this.voices = null;
    this.started = false;

    // Smoothed statistics. The raw field jitters frame to frame and an unsmoothed
    // mapping sounds like radio static rather than like a living thing.
    this.mass = 0;
    this.interface = 0;
    this.commit = 0;
    this.scar = 0;
    this.split = 0;     // the dish disagreeing with itself — the beating term
    this.centroidY = 0.5;
    /** Live tiles as a fraction of the dish. Distinguishes bare from smooth. */
    this.occupancy = 0;

    this.gain = 0.9;
  }

  start() {
    if (this.started || !this.audio || !this.audio.started) return;
    const a = this.audio;

    // Two near-unison low voices. Their detune is the beat, and the beat is the
    // single most informative thing in the mix.
    this.voices = {
      lowA: a.drone({ freq: 74, type: 'sine', bus: 'music', gain: 0.0, filter: 700 }),
      lowB: a.drone({ freq: 74.6, type: 'sine', bus: 'music', gain: 0.0, filter: 700 }),
      // A triangle an octave up carries register without muddying the beat.
      mid: a.drone({ freq: 148, type: 'triangle', bus: 'music', gain: 0.0, filter: 1100 }),
      // Sawtooth through a moving lowpass is the roughness/texture voice.
      grain: a.drone({ freq: 55, type: 'sawtooth', bus: 'music', gain: 0.0, filter: 300, q: 3.0 }),
    };
    this.started = true;
  }

  stop() {
    if (!this.voices) return;
    for (const v of Object.values(this.voices)) v.stop(0.6);
    this.voices = null;
    this.started = false;
  }

  /**
   * Feed the reduced field statistics.
   * @param {Float32Array} stats 16x16 RGBA: mass, interface, commit, scar
   * @param {number} size grid dimension
   * @param {number} dt
   */
  update(stats, size, dt) {
    this.analyse(stats, size, dt);
    if (!this.started) this.start();
    if (this.voices) this.apply();
  }

  /**
   * Fold the reduced field into the smoothed scalars the voicing reads.
   *
   * Deliberately free of any audio dependency: this runs whether or not the
   * browser has let us have an AudioContext, which is the only way the first
   * thirty seconds of a session are not silently unmeasured.
   */
  analyse(stats, size, dt) {
    let mass = 0, iface = 0, commit = 0, scar = 0, n = 0;
    let wy = 0, wsum = 0;
    let liveSum = 0, liveSq = 0, liveN = 0;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const m = stats[i], f = stats[i + 1];
        mass += m; iface += f; commit += stats[i + 2]; scar += stats[i + 3];
        n++;
        wy += (y / (size - 1)) * m; wsum += m;

        // Bare substrate has no density to disagree about, and it is most of a
        // young dish. The floor is mean V over a 32x32 tile, so it excludes rim
        // and empty ground without excluding thin structure.
        if (m > 0.04) { liveSum += m; liveSq += m * m; liveN++; }
      }
    }

    const k = 1 - Math.exp(-3.5 * dt);   // ~300ms time constant
    const kSlow = 1 - Math.exp(-1.2 * dt);

    this.mass += (mass / n - this.mass) * k;
    this.interface += (iface / n - this.interface) * k;
    this.commit += (commit / n - this.commit) * kSlow;
    this.scar += (scar / n - this.scar) * kSlow;
    this.centroidY += ((wsum > 1e-6 ? wy / wsum : 0.5) - this.centroidY) * k;

    const occ = liveN / n;
    this.occupancy += (occ - this.occupancy) * kSlow;

    // Unevenness: how much the density of colonised ground varies across the
    // dish, as a coefficient of variation.
    //
    // This is the term that carries the hidden variant, and it is the one thing
    // in this file chosen by measurement rather than by argument. Three
    // candidates were tried against the same dishes with the variant zeroed and
    // not zeroed: left/right divergence of interface density (as shipped), the
    // same widened to four axes, and the spread of interface-per-unit-mass.
    // All three moved further between dishes than they moved between conditions,
    // so a listener would have been hearing which dish they were given. This one
    // separates the two conditions on every dish that expresses, with an effect
    // several times the between-dish spread.
    //
    // Why it works is not subtle in hindsight. The variant shifts the local kill
    // rate, and a region at a different kill rate holds a different amount of
    // mass — more if it has gone ropy, less if it has gone spotty. Either way the
    // dish stops being uniformly dense, and it says nothing about *which*, which
    // is the contract the free channels are held to: that something has
    // diverged, never where and never what.
    //
    // Scale-free on purpose. It must not rise merely because the dish grew.
    let uneven = 0;
    if (liveN >= 8) {
      const mu = liveSum / liveN;
      const varr = Math.max(0, liveSq / liveN - mu * mu);
      uneven = mu > 1e-4 ? Math.sqrt(varr) / mu : 0;
    }
    // A dish that is mostly bare is uneven for a reason that is not interesting:
    // the boundary between three seeded colonies and the substrate around them.
    // The statistic is not credible until there is enough dish to compare, and
    // the design says minute one should be a flat drone.
    const credible = smoothstep(0.15, 0.35, occ);
    this.split += (uneven * credible - this.split) * kSlow;
  }

  /**
   * The numbers the oscillators are set to, as a plain object.
   *
   * Everything the player can hear is here and nowhere else, which is what makes
   * "is this channel informative?" a question a test can answer.
   */
  voicing() {
    // --- register: where the mass sits ---------------------------------
    // A fifth of range, no more. Big pitch sweeps read as a synthesiser being
    // played rather than as a substance being observed.
    const baseHz = lerp(64, 96, clamp01(1 - this.centroidY));

    // --- beating: the dish disagreeing with itself ---------------------
    // 0 to ~7 Hz. Below about 0.5 Hz it is inaudible as beating and reads as a
    // slow swell, which is the correct behaviour for a healthy dish.
    const beatHz = clamp((this.split - SETTLED_UNEVENNESS) * BEAT_PER_UNIT, 0, 7);

    // --- roughness: interface density ----------------------------------
    const rough = clamp01(this.interface / INTERFACE_FULL);

    // --- mass: presence -------------------------------------------------
    // Loudness follows how much culture there is, which is *directional* where
    // the beat is not: a variant that has gone ropy is louder than the dish was
    // and one that has gone spotty is quieter. Neither is readable without
    // knowing what the dish sounded like a minute ago, which is the intended
    // kind of ambiguous.
    const presence = clamp01(this.mass / MASS_FULL);

    // --- commitment: the medium hardening -------------------------------
    // Opening the mid voice's filter as the dish commits gives the sound an
    // edge it did not have when it was plastic. It is the quietest of the four
    // cues on purpose — audible if you are listening for it, not otherwise.
    const hard = clamp01(this.commit * 1.6);

    // --- scar: the price, always audible --------------------------------
    // Scar dulls everything. The player hears their own damage accumulating in
    // the tone of the whole mix rather than as a separate warning sound, which
    // is the difference between a cost and a notification.
    //
    // Applied to the target cutoffs, never to the current ones. The first
    // version read each filter's live value and multiplied it down every time it
    // ran, ten times a second, which is a feedback loop rather than a mapping:
    // any scar at all drove all four voices to the floor within a few seconds and
    // left them there, permanently, even as the scar healed. One probe turned the
    // game's primary information channel into a mud pad. It measured as
    // implemented and sounded as broken.
    const dull = clamp01(this.scar * 2.2);
    const dullFactor = lerp(1.0, 0.35, dull);

    const cut = (hz) => Math.max(FILTER_FLOOR, hz * dullFactor);

    return {
      baseHz,
      beatHz,
      rough,
      presence,
      hard,
      dull,
      lowGain: lerp(0.012, 0.085, presence) * this.gain,
      lowCut: cut(700),
      midHz: baseHz * 2,
      midGain: lerp(0.004, 0.030, hard) * this.gain,
      midCut: cut(lerp(700, 2600, hard)),
      grainHz: baseHz * 0.75,
      grainGain: lerp(0.0, 0.055, rough) * this.gain,
      grainCut: cut(lerp(180, 1500, rough)),
    };
  }

  apply() {
    if (!this.voices) return;
    const v = this.voices;
    const s = this.voicing();

    v.lowA.setFreq(s.baseHz, 0.25);
    v.lowB.setFreq(s.baseHz + s.beatHz, 0.25);
    v.lowA.setGain(s.lowGain, 0.3);
    v.lowB.setGain(s.lowGain * 0.88, 0.3);
    v.lowA.setFilter(s.lowCut, 0.8);
    v.lowB.setFilter(s.lowCut, 0.8);

    v.mid.setFreq(s.midHz, 0.3);
    v.mid.setFilter(s.midCut, 0.5);
    v.mid.setGain(s.midGain, 0.5);

    v.grain.setFreq(s.grainHz, 0.3);
    v.grain.setFilter(s.grainCut, 0.3);
    v.grain.setGain(s.grainGain, 0.3);
  }

  /** What the player could in principle hear right now. For tests and the HUD. */
  readout() {
    const v = this.voicing();
    return {
      mass: this.mass,
      interface: this.interface,
      commit: this.commit,
      scar: this.scar,
      split: this.split,
      occupancy: this.occupancy,
      beatHz: v.beatHz,
      centroidY: this.centroidY,
      voicing: v,
    };
  }
}
