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
//              right way to expose a small divergence between two regions —
//              precisely the signature of a variant beginning to express.
//   Roughness. Energy in the 20-200 Hz modulation band is heard as texture
//              rather than pitch. Interface density drives it, so a dish full of
//              boundaries sounds grainy and a smooth one sounds pure.
//   Register.  Where the mass sits in the dish maps to pitch, so the player
//              hears the culture's centre of gravity move without looking.
//
// None of the three is decisive alone. That is the point: the expert's skill is
// a joint reading of three ambiguous free channels, which is meant to beat one
// decisive expensive one.

import { clamp, clamp01, lerp } from '../core/math.js';

export class Hum {
  /** @param {import('../core/audio.js').Audio} audio */
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
    this.split = 0;     // divergence between dish halves — the beating term
    this.centroidY = 0.5;

    this.gain = 0.9;
  }

  start() {
    if (this.started || !this.audio.started) return;
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
    if (!this.started) { this.start(); if (!this.started) return; }

    let mass = 0, iface = 0, commit = 0, scar = 0, n = 0;
    let wy = 0, wsum = 0;
    // Left/right halves, for the divergence term.
    let li = 0, ln = 0, ri = 0, rn = 0;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const m = stats[i], f = stats[i + 1];
        mass += m; iface += f; commit += stats[i + 2]; scar += stats[i + 3];
        n++;
        wy += (y / (size - 1)) * m; wsum += m;
        if (x < size / 2) { li += f; ln++; } else { ri += f; rn++; }
      }
    }

    const k = 1 - Math.exp(-3.5 * dt);   // ~300ms time constant
    const kSlow = 1 - Math.exp(-1.2 * dt);

    this.mass += (mass / n - this.mass) * k;
    this.interface += (iface / n - this.interface) * k;
    this.commit += (commit / n - this.commit) * kSlow;
    this.scar += (scar / n - this.scar) * kSlow;
    this.centroidY += ((wsum > 1e-6 ? wy / wsum : 0.5) - this.centroidY) * k;

    // Divergence between halves. When a variant begins to express on one side,
    // the two halves stop agreeing about interface density before anything is
    // visible as a shape — this is the earliest free warning in the game.
    const lAvg = ln ? li / ln : 0, rAvg = rn ? ri / rn : 0;
    const denom = Math.max(lAvg + rAvg, 1e-5);
    this.split += (Math.abs(lAvg - rAvg) / denom - this.split) * kSlow;

    this.apply();
  }

  apply() {
    if (!this.voices) return;
    const v = this.voices;

    // --- register: where the mass sits ---------------------------------
    // A fifth of range, no more. Big pitch sweeps read as a synthesiser being
    // played rather than as a substance being observed.
    const base = lerp(64, 96, clamp01(1 - this.centroidY));
    v.lowA.setFreq(base, 0.25);

    // --- beating: divergence between halves ----------------------------
    // 0 to ~7 Hz. Below about 0.5 Hz it is inaudible as beating and reads as a
    // slow swell, which is the correct behaviour for a healthy dish.
    const beat = clamp(this.split * 9.0, 0, 7);
    v.lowB.setFreq(base + beat, 0.25);

    // --- roughness: interface density ----------------------------------
    const rough = clamp01(this.interface * 3.2);
    v.grain.setFreq(base * 0.75, 0.3);
    v.grain.setFilter(lerp(180, 1500, rough), 0.3);
    v.grain.setGain(lerp(0.0, 0.055, rough) * this.gain, 0.3);

    // --- mass: presence -------------------------------------------------
    const presence = clamp01(this.mass * 6.0);
    v.lowA.setGain(lerp(0.012, 0.085, presence) * this.gain, 0.3);
    v.lowB.setGain(lerp(0.010, 0.075, presence) * this.gain, 0.3);

    // --- commitment: the medium hardening -------------------------------
    // Opening the mid voice's filter as the dish commits gives the sound an
    // edge it did not have when it was plastic. It is the quietest of the four
    // cues on purpose — audible if you are listening for it, not otherwise.
    v.mid.setFreq(base * 2, 0.3);
    v.mid.setFilter(lerp(700, 2600, clamp01(this.commit * 1.6)), 0.5);
    v.mid.setGain(lerp(0.004, 0.030, clamp01(this.commit * 1.6)) * this.gain, 0.5);

    // --- scar: the price, always audible --------------------------------
    // Scar dulls everything. The player hears their own damage accumulating in
    // the tone of the whole mix rather than as a separate warning sound, which
    // is the difference between a cost and a notification.
    const dull = clamp01(this.scar * 2.2);
    for (const voice of [v.lowA, v.lowB, v.mid, v.grain]) {
      voice.setFilter(Math.max(160, voice.filterNode.frequency.value * (1 - dull * 0.45)), 0.8);
    }
  }

  /** What the player could in principle hear right now. For tests and the HUD. */
  readout() {
    return {
      mass: this.mass,
      interface: this.interface,
      commit: this.commit,
      scar: this.scar,
      split: this.split,
      beatHz: clamp(this.split * 9.0, 0, 7),
      centroidY: this.centroidY,
    };
  }
}
