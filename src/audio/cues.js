// Discrete cues.
//
// The hum is the information channel; this file is everything that is not
// information. Cues confirm that a thing happened — that the actuator has
// contact, that the probe fired, that the dish just set — and they are held to
// one rule that comes straight from the pillars:
//
//   A cue may tell the player *that*, and may tell them what they themselves
//   just did. It may never tell them something about the dish they would
//   otherwise have to pay to learn.
//
// That rule is why there is no variant-onset cue here, and there will not be
// one. A chime when the hidden variant begins to express would be a free precise
// channel answering the exact question the instruments exist to answer, and it
// would end the game in about four sessions. The hum reports the same event
// ambiguously and continuously, and that is the whole design.
//
// Everything is synthesised. There are no audio files in this project and there
// will not be; see `core/audio.js` for why.
//
// Interface
// ---------
//   cues.engage(tool, {pan})   an actuator took hold      (call on press)
//   cues.release(tool)         it let go                  (call on release)
//   cues.probe(kind, {pan})    an instrument fired
//   cues.scar(delta)           damage appeared
//   cues.threshold(name)       a stated line was crossed
//   cues.assay(result)         the run ended
//   cues.watch({session, hum, dt})  derive the above from state, once per frame
//   cues.stop()                silence, e.g. on a new dish
//
// `engage`/`release` need the input layer, because "the player is pressing" is
// not visible in game state. Everything else `watch` can derive on its own.
//
// Mix
// ---
// The sfx bus is sent to a reverb; the ui bus is not. That is a design decision
// rather than a technicality: damage and countdowns are dry, and dry against a
// wet bed reads as being closer to the listener than the rest of the mix. The
// player's own harm should sound like it is in the room with them.

import { clamp01, lerp } from '../core/math.js';

/** Held beds, one per actuator. Character first, level a long way second. */
const BEDS = {
  nutrient: { freq: 58, type: 'triangle', filter: 340, gain: 0.020, tremolo: 0.0 },
  shade:    { freq: 73, type: 'sine',     filter: 520, gain: 0.013, tremolo: 0.0 },
  // Heat is the actuator with the most authority and the least precision, and it
  // is the only one whose effect the renderer draws as movement. The bed wavers
  // to match; nothing else in the mix does.
  thermal:  { freq: 196, type: 'sawtooth', filter: 780, gain: 0.011, tremolo: 0.55 },
};

export class Cues {
  /** @param {import('../core/audio.js').Audio} audio */
  constructor(audio) {
    this.audio = audio;
    this.beds = {};
    this.gain = 1.0;

    this._last = {};          // cue name -> audio time, for rate limiting
    this._wetHooked = false;
    this._t = 0;              // local clock, for bed movement

    // What `watch` has already reacted to. Kept here rather than on the session
    // so that the audio layer never writes into game state.
    this._seen = { log: 0, scar: 0, charges: null, assayed: false, crossed: {} };
  }

  _ready() {
    if (!this.audio || !this.audio.enabled) return false;
    if (!this.audio.started) return false;
    if (!this._wetHooked) {
      const rev = this.audio.reverb({ seconds: 1.9, decay: 3.0, wet: 0.16 });
      if (rev) {
        this.audio.buses.sfx.connect(rev.node);
        this._wetHooked = true;
      }
    }
    return true;
  }

  /** True if this cue may sound now. Stops a held actuator machine-gunning. */
  _allow(name, minInterval) {
    const t = this.audio.time;
    if (this._last[name] !== undefined && t - this._last[name] < minInterval) return false;
    this._last[name] = t;
    return true;
  }

  // ------------------------------------------------------------ actuators

  /**
   * An actuator took hold.
   *
   * Two parts, because contact has two parts: a transient that says the tool
   * arrived, and a bed that says it is still there. Without the bed a held
   * actuator is silent after the first frame and the player cannot tell whether
   * they are still applying it; with only the bed there is no moment of contact
   * and the control feels like a slider rather than like leaning on something.
   */
  engage(tool, { pan = 0 } = {}) {
    if (!this._ready()) return;
    const a = this.audio;

    if (!this._allow('engage:' + tool, 0.10)) return;

    switch (tool) {
      case 'nutrient':
        // Downward: something is being let into the dish.
        a.noise({ filter: 'lowpass', freq: 1100, sweepTo: 200, q: 0.9, decay: 0.30, gain: 0.10 * this.gain, pan });
        a.tone({ freq: 132, type: 'sine', gain: 0.05 * this.gain, attack: 0.008, decay: 0.30, glideTo: 88, glideTime: 0.28, pan });
        break;
      case 'shade':
        // The same gesture inverted — thinner, rising, a withdrawal rather than
        // a pour. The pair has to be distinguishable with the screen ignored.
        a.noise({ filter: 'bandpass', freq: 240, sweepTo: 1500, q: 1.7, decay: 0.32, gain: 0.055 * this.gain, pan });
        break;
      case 'thermal':
        // A ring, because the actuator is a ring.
        a.tone({ freq: 522, type: 'triangle', gain: 0.045 * this.gain, attack: 0.003, decay: 0.22, pan });
        a.tone({ freq: 783, type: 'triangle', gain: 0.022 * this.gain, attack: 0.003, decay: 0.16, pan });
        break;
      case 'shear':
        // An event, not a hold: a swipe with no bed behind it.
        a.noise({ filter: 'bandpass', freq: 420, sweepTo: 2400, q: 1.1, decay: 0.22, gain: 0.085 * this.gain, pan });
        return;
      default:
        return;
    }

    const spec = BEDS[tool];
    if (spec && !this.beds[tool]) {
      const bed = a.drone({ freq: spec.freq, type: spec.type, bus: 'sfx', gain: 0, filter: spec.filter, q: 1.0 });
      if (bed) {
        bed.setGain(spec.gain * this.gain, 0.05);
        this.beds[tool] = { bed, spec };
      }
    }
  }

  /** The actuator let go. */
  release(tool) {
    const held = this.beds[tool];
    if (!held) return;
    held.bed.stop(0.22);
    delete this.beds[tool];
  }

  // --------------------------------------------------------------- probes

  /**
   * An instrument fired.
   *
   * This one is meant to be unpleasant, and the unpleasantness is doing work.
   * Two inharmonic partials high in the ear's most sensitive region beat against
   * each other into a bright noise transient; nothing about it is nice to hear.
   * The player should flinch slightly, every time, forever — a probe that felt
   * good would be a reward for the act the game is trying to make them think
   * twice about.
   *
   * And it takes the hum away. The music bus is ducked hard and let back slowly,
   * so for about a second after looking, the free channel the player reads by is
   * gone. That is the cost stated as a mechanic rather than as a number: you
   * bought one precise answer and you paid for it in the ambiguous one.
   */
  probe(kind = 'fluoresce', { pan = 0 } = {}) {
    if (!this._ready()) return;
    if (!this._allow('probe', 0.20)) return;
    const a = this.audio;
    const t = a.time;

    if (kind === 'aspirate') {
      // Lower, wetter, more violent. Aspirate takes tissue out and does not give
      // it back, and it should sound like removal rather than like illumination.
      a.duck('music', 0.08, 0.45, 1.25);
      a.noise({ filter: 'bandpass', freq: 1800, sweepTo: 110, q: 1.4, decay: 0.55, gain: 0.16 * this.gain, pan, when: t });
      a.tone({ freq: 148, type: 'square', gain: 0.055 * this.gain, attack: 0.001, decay: 0.42, glideTo: 41, glideTime: 0.40, pan, when: t });
      a.tone({ freq: 1490, type: 'square', gain: 0.030 * this.gain, attack: 0.001, decay: 0.30, glideTo: 1180, glideTime: 0.30, when: t });
      a.noise({ filter: 'lowpass', freq: 220, q: 0.7, decay: 0.7, gain: 0.09 * this.gain, when: t + 0.05 });
      return;
    }

    a.duck('music', 0.12, 0.30, 0.90);
    // The snap.
    a.noise({ filter: 'bandpass', freq: 3300, sweepTo: 950, q: 0.8, decay: 0.10, gain: 0.15 * this.gain, pan, when: t });
    // The pair that will not settle. Roughly a tritone, deliberately: it is the
    // interval the ear refuses to hear as one thing.
    a.tone({ freq: 2050, type: 'square', gain: 0.038 * this.gain, attack: 0.001, decay: 0.45, glideTo: 1980, glideTime: 0.45, pan: -0.25, when: t });
    a.tone({ freq: 2910, type: 'square', gain: 0.026 * this.gain, attack: 0.001, decay: 0.38, glideTo: 2960, glideTime: 0.38, pan: 0.25, when: t });
    // Weight underneath, so it lands in the dish rather than on the glass.
    a.tone({ freq: 72, type: 'sine', gain: 0.085 * this.gain, attack: 0.002, decay: 0.40, glideTo: 44, glideTime: 0.35, when: t });
  }

  // ----------------------------------------------------------------- harm

  /**
   * Damage appearing, as a dry tick.
   *
   * Granular and quiet and completely without pitch, so it carries no
   * information beyond "that just cost you something". It is dry while the rest
   * of the mix is wet, which is the whole reason the ui bus exists here.
   */
  scar(delta = 0) {
    if (!this._ready()) return;
    if (delta <= 0) return;
    if (!this._allow('scar', 0.14)) return;
    const amount = clamp01(delta * 60);
    this.audio.noise({
      bus: 'ui', filter: 'bandpass', freq: lerp(1900, 3100, amount), q: 7,
      decay: 0.035, gain: lerp(0.020, 0.055, amount) * this.gain,
    });
  }

  // ---------------------------------------------------------- thresholds

  /**
   * A line was crossed.
   *
   * The list is short and every entry is something the player already knows or
   * could count. Charges are inventory; the clock is on screen; plasticity is
   * the dish itself setting, and is reported as a felt thud with no pitch and no
   * position — that, never where. Anything that would name a hidden fact belongs
   * to an instrument and has to be paid for.
   */
  threshold(name) {
    if (!this._ready()) return;
    if (!this._allow('thr:' + name, 1.0)) return;
    const a = this.audio;
    const t = a.time;

    switch (name) {
      case 'charges-out':
        // Falling, and small. Losing an option is not an event, it is a door
        // closing somewhere behind you.
        a.tone({ bus: 'ui', freq: 494, type: 'triangle', gain: 0.045 * this.gain, decay: 0.16, when: t });
        a.tone({ bus: 'ui', freq: 330, type: 'triangle', gain: 0.038 * this.gain, decay: 0.30, when: t + 0.13 });
        break;
      case 'last-minute':
        a.tone({ bus: 'ui', freq: 165, type: 'sine', gain: 0.05 * this.gain, attack: 0.02, decay: 0.9, when: t });
        break;
      case 'plasticity-lost':
        // The dish setting. Felt rather than heard, and carrying no pitch, so it
        // cannot be read as a location or as a value.
        a.noise({ filter: 'lowpass', freq: 150, q: 0.6, decay: 0.85, gain: 0.13 * this.gain, when: t });
        a.tone({ freq: 47, type: 'sine', gain: 0.10 * this.gain, attack: 0.03, decay: 1.1, when: t });
        break;
    }
  }

  // ---------------------------------------------------------------- assay

  /**
   * The run ended.
   *
   * No fanfare in either direction. Pass and fail differ in whether the chord
   * resolves, not in whether it congratulates: a dish that failed viability is
   * still a dish somebody grew for ten minutes, and a jingle over it would be
   * the game telling the player how to feel about their own work.
   *
   * Then one dry tick per wasted probe, spaced far enough apart to be counted.
   * That is the line in the report that teaches the game, and it is the one
   * thing here worth making the player sit through.
   */
  assay(result = null) {
    if (!this._ready()) return;
    this.stopBeds();
    const a = this.audio;
    const t = a.time;
    const passed = !!(result && result.passedShape && result.passedViability);

    const root = 55;
    a.tone({ freq: root, type: 'sine', gain: 0.09 * this.gain, attack: 0.6, decay: 3.4, when: t });
    a.tone({ freq: root * 2, type: 'sine', gain: 0.05 * this.gain, attack: 0.8, decay: 3.0, when: t + 0.15 });
    // A fifth resolves; a minor second does not, and holding it unresolved for
    // three seconds is as close to a judgement as this game gets.
    a.tone({
      freq: passed ? root * 3 : root * 2 * 1.0595,
      type: 'triangle', gain: 0.040 * this.gain, attack: 1.0, decay: 2.6, when: t + 0.35,
    });

    const wasted = result ? (result.wasted || 0) : 0;
    for (let i = 0; i < wasted; i++) {
      a.noise({
        bus: 'ui', filter: 'bandpass', freq: 2400, q: 8, decay: 0.05,
        gain: 0.05 * this.gain, when: t + 1.6 + i * 0.42,
      });
    }
  }

  // --------------------------------------------------------------- driving

  /**
   * Derive cues from state, once per frame.
   *
   * Everything here is a *change* in something the game already tracks, which is
   * what keeps the audio layer from having opinions. It reads; it never writes.
   * `engage`/`release` are not derivable this way and stay explicit, because
   * whether a mouse button is down is not part of the dish.
   */
  watch({ session, hum = null, dt = 1 / 120 } = {}) {
    this.tick(dt);
    if (!session || !this._ready()) return;

    // Probes, from the trace rather than from the charge count: the trace says
    // which instrument, and it cannot be desynchronised by a refused use.
    const log = session.log;
    for (let i = this._seen.log; i < log.length; i++) {
      const e = log[i];
      if (e.kind === 'fluoresce' || e.kind === 'aspirate') {
        this.probe(e.kind, { pan: (e.x - 0.5) * 1.4 });
      }
    }
    this._seen.log = log.length;

    if (hum) {
      const s = hum.scar;
      if (s > this._seen.scar) this.scar(s - this._seen.scar);
      this._seen.scar = s;

      // The dish setting. One crossing, with a wide hysteresis band so a value
      // hovering on the line cannot chatter.
      if (!this._seen.crossed.plasticity && hum.commit > 0.45) {
        this._seen.crossed.plasticity = true;
        this.threshold('plasticity-lost');
      }
    }

    const charges = (session.charges.fluoresce || 0) + (session.charges.aspirate || 0);
    if (this._seen.charges !== null && charges === 0 && this._seen.charges > 0) {
      this.threshold('charges-out');
    }
    this._seen.charges = charges;

    if (!this._seen.crossed.lastMinute && session.remaining <= 60 && session.remaining > 0) {
      this._seen.crossed.lastMinute = true;
      this.threshold('last-minute');
    }

    if (!this._seen.assayed && session.state === 'assayed') {
      this._seen.assayed = true;
      this.assay(session.result);
    }
  }

  /** Move the held beds. Only the thermal bed moves, and only a little. */
  tick(dt) {
    this._t += dt;
    for (const key of Object.keys(this.beds)) {
      const { bed, spec } = this.beds[key];
      if (!spec.tremolo) continue;
      const wobble = 1 + Math.sin(this._t * 5.2) * spec.tremolo * 0.5;
      bed.setGain(spec.gain * wobble * this.gain, 0.05);
    }
  }

  stopBeds() {
    for (const key of Object.keys(this.beds)) this.beds[key].bed.stop(0.2);
    this.beds = {};
  }

  /** Silence, and forget what has been reacted to. For a new dish. */
  stop() {
    this.stopBeds();
    this._last = {};
    this._seen = { log: 0, scar: 0, charges: null, assayed: false, crossed: {} };
  }
}
