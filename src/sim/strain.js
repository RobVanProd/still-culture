// Strains.
//
// A strain is the medium's constants: the F/K field it grows in, the hidden
// variant it carries, and where it starts. Everything here is deterministic from
// a seed, so a dish can be named, shared, and replayed exactly.
//
// The important design content is in the latent field. A hidden constant that is
// merely *unknown* would be answered by one probe in a known place; a hidden
// constant that expresses itself only where the culture chooses to build cannot
// be probed before the culture has chosen. That is what keeps "do I look" a live
// question past session five, and it is the whole reason this file is not three
// lines of random numbers.

import { Rng, seedFrom } from '../core/rng.js';
import { makeNoise2D, fbm2D, clamp, lerp, smoothstep } from '../core/math.js';

/**
 * Gray-Scott lives in a narrow, structured region of (F, K). These are the
 * corners of it that produce recognisably different growth, chosen by
 * inspection rather than theory — the player learns them as characters, not as
 * numbers.
 */
export const REGIMES = {
  //                F       K      what it does
  coral:     { F: 0.0545, K: 0.0620, name: 'coral',   note: 'branching, fills space, forgiving' },
  spots:     { F: 0.0300, K: 0.0620, name: 'spots',   note: 'discrete colonies, stable, slow' },
  worms:     { F: 0.0580, K: 0.0630, name: 'worms',   note: 'ropy, wandering, hard to steer' },
  maze:      { F: 0.0290, K: 0.0570, name: 'maze',    note: 'labyrinthine, dense, greedy' },
  waves:     { F: 0.0140, K: 0.0450, name: 'waves',   note: 'travelling fronts, fast, unstable' },
  holes:     { F: 0.0390, K: 0.0580, name: 'holes',   note: 'negative growth, eats inward' },
};

export class Strain {
  /**
   * @param {string} seedName human-readable, so dishes can be named
   * @param {object} opts
   */
  constructor(seedName, { size = 512, regime = 'coral', drift = 0 } = {}) {
    this.seedName = seedName;
    this.size = size;
    this.rng = new Rng(seedFrom(seedName));
    this.regime = REGIMES[regime] || REGIMES.coral;

    const r = this.rng;

    // Diffusion. Small per-strain variation, enough to change the feel of the
    // growth without leaving the region where Gray-Scott is interesting.
    //
    // 0.8/0.4 was found by sweeping, not chosen from a paper. Below about 0.4
    // the seeds settle into a stable spot and never spread — the dish looks
    // dead and the game has nothing to be about. At 1.2 the explicit integrator
    // goes unstable and the dish saturates to solid mass within seconds. The
    // usable band is narrow and this sits in the middle of it.
    this.Du = 0.80 * lerp(0.96, 1.04, r.float());
    this.Dv = 0.40 * lerp(0.96, 1.04, r.float());

    // Base constants, drifted. `drift` is how far this strain has wandered from
    // its parent — the lineage mechanic — so an inherited strain feels like the
    // same animal with different reflexes.
    const d = drift;
    this.baseF = this.regime.F * lerp(1 - 0.05 * d, 1 + 0.05 * d, r.float());
    this.baseK = this.regime.K * lerp(1 - 0.03 * d, 1 + 0.03 * d, r.float());

    // The hidden variant.
    //
    // Sign matters more than magnitude: a positive dK pushes the local field
    // toward spots and dissolution, a negative dK toward worms and runaway
    // growth. The two demand opposite responses from the same actuator, which is
    // what makes an unread variant genuinely lethal rather than merely
    // unfortunate.
    this.variantSign = r.chance(0.5) ? 1 : -1;
    this.variantStrength = lerp(0.0035, 0.0075, r.float()) * this.variantSign;

    // How much of the dish carries it, and how committed the medium must be
    // before it shows. A low threshold expresses early and is survivable; a high
    // one waits until the player has built something worth losing.
    this.variantCoverage = lerp(0.35, 0.8, r.float());
    this.variantThreshold = lerp(0.18, 0.42, r.float());

    this.noise = makeNoise2D(seedFrom(seedName + ':field'));
    this.variantNoise = makeNoise2D(seedFrom(seedName + ':variant'));
  }

  /** Human-readable summary. Never shown to the player during a run. */
  describe() {
    return {
      seed: this.seedName,
      regime: this.regime.name,
      F: this.baseF.toFixed(4),
      K: this.baseK.toFixed(4),
      variant: this.variantSign > 0 ? 'dissolving' : 'ropy',
      variantStrength: this.variantStrength.toFixed(4),
      coverage: this.variantCoverage.toFixed(2),
      threshold: this.variantThreshold.toFixed(2),
    };
  }

  /**
   * The F/K field the dish grows in. Not uniform: a perfectly even field
   * produces a perfectly even pattern, which reads as a screensaver. Gentle
   * large-scale structure gives the dish regions with characters, so the player
   * can learn *this dish* rather than the general rule.
   */
  buildParams() {
    const n = this.size;
    const data = new Float32Array(n * n * 4);
    const inv = 1 / n;

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const u = x * inv, v = y * inv;
        const i = (y * n + x) * 4;

        const fx = fbm2D(this.noise, u * 2.6, v * 2.6, 3) * 0.5 + 0.5;
        const kx = fbm2D(this.noise, u * 2.1 + 31.7, v * 2.1 - 12.3, 3) * 0.5 + 0.5;

        // Radial term: the dish is a dish. Conditions fall off toward the rim,
        // which gives the meniscus its distinct behaviour — one of the free
        // channels the player is meant to learn to read.
        const dx = u - 0.5, dy = v - 0.5;
        const r = Math.hypot(dx, dy) * 2;
        const rim = smoothstep(0.86, 1.02, r);

        data[i]     = clamp(this.baseF * lerp(0.94, 1.06, fx) * (1 - rim * 0.55), 0.001, 0.11);
        data[i + 1] = clamp(this.baseK * lerp(0.985, 1.015, kx) + rim * 0.004, 0.03, 0.075);
        data[i + 2] = 0; // thermal
        data[i + 3] = 0; // shear
      }
    }
    return data;
  }

  /** The latent variant field: (dK, expression threshold, 0, 0). */
  buildLatent() {
    const n = this.size;
    const data = new Float32Array(n * n * 4);
    const inv = 1 / n;

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const u = x * inv, v = y * inv;
        const i = (y * n + x) * 4;

        // Large, soft patches. The variant is regional, not per-pixel: the
        // player must be able to discover that "the south-west is different"
        // and act on it, which requires the difference to have a shape.
        const m = fbm2D(this.variantNoise, u * 1.7, v * 1.7, 2) * 0.5 + 0.5;
        const carries = smoothstep(1 - this.variantCoverage - 0.12, 1 - this.variantCoverage + 0.12, m);

        data[i] = this.variantStrength * carries;
        // Threshold varies slightly across the patch so expression creeps rather
        // than switching on all at once — a front the player can notice.
        data[i + 1] = this.variantThreshold * lerp(0.85, 1.15, m);
        data[i + 2] = 0;
        data[i + 3] = 0;
      }
    }
    return data;
  }

  /** Starting state: U saturated, V seeded in a few places. */
  buildState({ seeds = 3, radius = 0.045 } = {}) {
    const n = this.size;
    const data = new Float32Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      data[i * 4] = 1;      // U
      data[i * 4 + 1] = 0;  // V
      data[i * 4 + 2] = 0;  // scar
      data[i * 4 + 3] = 0;  // commitment
    }

    const r = this.rng.fork(7);
    for (let s = 0; s < seeds; s++) {
      // Seeds are placed within the inner dish, never against the rim, where
      // the falloff would strangle them before the player could do anything.
      const angle = r.float() * Math.PI * 2;
      const dist = Math.sqrt(r.float()) * 0.3;
      const cx = 0.5 + Math.cos(angle) * dist;
      const cy = 0.5 + Math.sin(angle) * dist;
      const rad = radius * lerp(0.7, 1.3, r.float());

      const x0 = Math.max(0, Math.floor((cx - rad) * n));
      const x1 = Math.min(n - 1, Math.ceil((cx + rad) * n));
      const y0 = Math.max(0, Math.floor((cy - rad) * n));
      const y1 = Math.min(n - 1, Math.ceil((cy + rad) * n));

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const du = x / n - cx, dv = y / n - cy;
          const d = Math.hypot(du, dv);
          if (d > rad) continue;
          const f = smoothstep(rad, rad * 0.3, d);
          const i = (y * n + x) * 4;
          data[i + 1] = Math.min(1, data[i + 1] + f * 0.85);
          data[i] = Math.max(0, data[i] - f * 0.4);
        }
      }
    }
    return data;
  }

  /** Install this strain into a Medium. */
  applyTo(medium) {
    medium.Du = this.Du;
    medium.Dv = this.Dv;
    medium.uploadParams(this.buildParams());
    medium.uploadLatent(this.buildLatent());
    medium.uploadState(this.buildState());
  }
}
