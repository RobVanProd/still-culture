// A session: one dish, one target, one clock.
//
// The rules live here and nowhere else. The medium does not know it is being
// scored, and the renderer does not know what a probe costs.
//
// Two scores, deliberately not combined into one number. A single score would
// let the player trade restraint against shape at a fixed exchange rate and
// optimise the sum; two scores with independent thresholds mean the player has
// to satisfy both, and "I got the shape by interrogating it to death" stays a
// distinct, legible way to lose.

import { clamp, clamp01, lerp, smoothstep } from '../core/math.js';
import { Rng, seedFrom } from '../core/rng.js';

/** Actuator and probe identifiers. */
export const TOOL = {
  NUTRIENT: 'nutrient',
  SHADE: 'shade',
  THERMAL: 'thermal',
  SHEAR: 'shear',
  FLUORESCE: 'fluoresce',
  ASPIRATE: 'aspirate',
};

/**
 * The two bars a dish must clear.
 *
 * Exported because the results screen draws a notch at each of them, and when it
 * carried its own copy the two could drift — a player would be told they were
 * short of a bar they had actually cleared, which is worse than no bar at all.
 */
export const THRESHOLDS = { shape: 0.240, viability: 0.700 };

/**
 * ABANDONED as a scoring criterion. Retained only as a measurement, and as a
 * record of a mechanism that was tried and does not work.
 *
 * The idea: ask the brief for a texture as well as an outline, so that filling
 * the stencil is not the whole game. It came from a playtester's intuition —
 * "the idea is to have the squiggles match the shape? but the shape isn't
 * telling the whole story?" — and the measurements agreed with them: a policy
 * that ignored everything interesting and pushed mass toward the outline scored
 * 0.220 against 0.254 for reading the dish properly.
 *
 * Why it failed: interface per unit mass is **not controllable**, and very
 * nearly not variable. Measured across every actuator, held for 300 seconds:
 * 2.867 with no input, 2.834 under nutrient, 2.867 under shade, 2.866 under
 * thermal. A sweep of the diffusion ratio — which is what actually sets pattern
 * wavelength — moved it from 2.78 to 2.88 and killed the culture outside that
 * band. Gray-Scott makes stripes whose boundary and mass scale together, so the
 * ratio is close to a constant of the system. The metric did not measure what it
 * was chosen to measure.
 *
 * A score the player cannot influence is worse than no score: it fails them for
 * nothing and teaches them the game is arbitrary. Two mechanisms were tried
 * (target ratios, then a diffusion lever) and the project rule is to stop after
 * two and change direction rather than tune. The player's diagnosis stands and
 * is still open; this particular answer to it does not work.
 *
 * ---
 *
 * What the culture is supposed to *be*, as distinct from where it is supposed to
 * be.
 *
 * The first playtest arrived at the real defect by intuition — "the idea is to
 * have the squiggles match the shape? but the shape isn't telling the whole
 * story?" — and the measurements agreed: a policy that ignored everything
 * interesting and simply pushed mass toward the outline scored 0.220 against
 * 0.254 for reading the dish properly. When the target is a stencil, the correct
 * action everywhere is deducible from the stencil, and the game's actual subject
 * becomes optional.
 *
 * So the brief now asks for a texture as well as an outline. Character is
 * interface per unit mass: how finely divided the growth is. Fine filaments have
 * a great deal of boundary for their mass, fat lobes have very little, and the
 * two are reached by different treatment of the same region.
 *
 * The player is told which is wanted, in words. What they are not told — and
 * what the stencil cannot tell them — is what the dish is *currently* doing,
 * because at a glance dense filaments and coarse worms look much alike in
 * motion. That reading is exactly what the hum carries and what a probe buys.
 */
export const CHARACTERS = {
  fine:   { name: 'fine',   ratio: 3.05, blurb: 'fine, densely divided filaments' },
  even:   { name: 'even',   ratio: 2.35, blurb: 'an even, moderately divided mat' },
  coarse: { name: 'coarse', ratio: 1.70, blurb: 'coarse, heavy, thick-walled growth' },
};

export const TOOL_ORDER = [TOOL.NUTRIENT, TOOL.SHADE, TOOL.THERMAL, TOOL.SHEAR, TOOL.FLUORESCE, TOOL.ASPIRATE];

// `verb` is the whole reason this table has three name fields.
//
// The first playtest ended with "I was confused what things do". The labels were
// the fiction's names for the instruments — nutrient, shade, aspirate — and the
// explanation of what each one *does* was in a tooltip, which does not exist on
// a phone, and in an aria-label, which a sighted player never hears. So the
// player was given six nouns and no verbs.
//
// `verb` is what the tool does to the dish, in one word, printed on the control.
// `cost` is what it takes, printed next to it in red when there is one. Neither
// is a tutorial: they are the label the control should always have had.
export const TOOL_INFO = {
  [TOOL.NUTRIENT]:  { label: 'nutrient',  verb: 'grow',   cost: '',        kind: 'actuator', key: '1', hint: 'enriches the medium — the culture spreads and thickens here' },
  [TOOL.SHADE]:     { label: 'shade',     verb: 'shrink', cost: '',        kind: 'actuator', key: '2', hint: 'starves the medium — the edge pulls back here' },
  [TOOL.THERMAL]:   { label: 'warm',      verb: 'hasten', cost: '',        kind: 'actuator', key: '3', hint: 'makes whatever is already happening here happen sooner' },
  [TOOL.SHEAR]:     { label: 'shear',     verb: 'push',   cost: '',        kind: 'actuator', key: '4', hint: 'drags existing growth sideways — moves it, never makes it' },
  [TOOL.FLUORESCE]: { label: 'stain',     verb: 'reveal', cost: 'kills it', kind: 'probe',   key: '5', hint: 'shows exactly what is here, and destroys this patch doing it' },
  [TOOL.ASPIRATE]:  { label: 'sample',    verb: 'extract', cost: 'leaves a hole', kind: 'probe', key: '6', hint: 'exact reading, and a permanent hole in the culture' },
};

export class Session {
  /**
   * @param {object} deps { medium, strain, hum }
   */
  constructor({ medium, strain, hum = null, durationSeconds = 600 }) {
    this.medium = medium;
    this.strain = strain;
    this.hum = hum;

    this.duration = durationSeconds;
    this.time = 0;
    this.state = 'running';         // running | assayed

    this.tool = TOOL.THERMAL;
    this.brushRadius = 0.10;

    // Probe charges. Deliberately few. A generous budget turns the central
    // decision into an inventory-management chore; a tight one keeps every use
    // a real choice.
    this.charges = { [TOOL.FLUORESCE]: 4, [TOOL.ASPIRATE]: 2 };

    // The reveal is transient: the probe shows you the truth for a few seconds
    // and then it is gone, so knowledge has to be carried in the player's head
    // rather than left on screen.
    this.reveal = { active: 0, x: 0.5, y: 0.5, radius: 0.14, decay: 0 };

    this.log = [];                  // the after-action trace
    this.scarSpend = 0;

    this.target = makeTarget(strain.seedName, medium.size, strain.seedPoints);

    // Deterministic from the dish name, like everything else.
    const cr = new Rng(seedFrom(strain.seedName + ':character'));
    const keys = Object.keys(CHARACTERS);
    this.character = CHARACTERS[keys[cr.int(0, keys.length - 1)]];

    this.stats = null;
    this.statsBuf = null;
    this._statsTimer = 0;
    this._lastMeasure = { shape: 0, scar: 0, coverage: 0 };
  }

  get remaining() { return Math.max(0, this.duration - this.time); }
  get finished() { return this.time >= this.duration; }

  chargesOf(tool) { return this.charges[tool] ?? Infinity; }

  /** Record an intervention for the after-action trace. */
  _record(kind, detail) {
    this.log.push({ t: +this.time.toFixed(2), kind, ...detail });
  }

  /**
   * Apply the currently selected tool at a dish position.
   * @param {number} x 0..1
   * @param {number} y 0..1
   * @param {object} opts
   */
  use(x, y, { dx = 0, dy = 0, held = false, strength = 1 } = {}) {
    if (this.state !== 'running') return null;
    const m = this.medium;

    // Held actuators fire every frame; logging each one would bury the trace and
    // make the waste calculation meaningless. One entry per second of continuous
    // use is enough to reconstruct what the player did and when.
    if (TOOL_INFO[this.tool].kind === 'actuator') {
      const last = this._lastActuatorLog ?? -99;
      if (this.time - last >= 1.0) {
        this._lastActuatorLog = this.time;
        this._record(this.tool, { x: +x.toFixed(3), y: +y.toFixed(3) });
      }
    }

    switch (this.tool) {
      case TOOL.THERMAL:
        // A ring, not a disc. Heat applied as an annulus is the only actuator
        // that can act on a lobe's edge without cooking its middle, and learning
        // to place the ring rather than the centre is the first real skill.
        m.brush('params', {
          x, y, inner: this.brushRadius * 0.45, outer: this.brushRadius,
          strength: strength * 0.10, mode: 1,
        });
        return { ok: true };

      case TOOL.NUTRIENT:
        m.brush('params', {
          x, y, inner: 0, outer: this.brushRadius * 0.7,
          strength: strength * 0.07, mode: 0,
        });
        return { ok: true };

      case TOOL.SHADE:
        m.brush('params', {
          x, y, inner: 0, outer: this.brushRadius * 0.8,
          strength: strength * 0.07, mode: 6,
        });
        return { ok: true };

      case TOOL.SHEAR:
        if (dx === 0 && dy === 0) return { ok: false, why: 'drag to shear' };
        m.shear(x, y, dx, dy, strength * 0.9);
        return { ok: true };

      case TOOL.FLUORESCE:
        if (held) return { ok: false, why: 'single use' };
        return this._probeFluoresce(x, y);

      case TOOL.ASPIRATE:
        if (held) return { ok: false, why: 'single use' };
        return this._probeAspirate(x, y);
    }
    return null;
  }

  /**
   * Fluorescence: shows exact concentration in a disc, and bleaches it.
   *
   * The cost is paid in the substrate, immediately and visibly, and it is the
   * same substrate the player is graded on. That equivalence is the whole game
   * and it is why the cost is not a cooldown or a currency.
   */
  _probeFluoresce(x, y) {
    if (this.charges[TOOL.FLUORESCE] <= 0) return { ok: false, why: 'no charges' };
    this.charges[TOOL.FLUORESCE]--;

    const radius = this.brushRadius * 1.15;
    this.medium.brush('state', { x, y, inner: 0, outer: radius, strength: 0.85, mode: 3 });

    this.reveal = { active: 1, x, y, radius, decay: 0.35 };
    this._record('fluoresce', { x: +x.toFixed(3), y: +y.toFixed(3), r: +radius.toFixed(3) });
    return { ok: true, probe: true };
  }

  /** Aspirate: exact numbers, permanent hole. */
  _probeAspirate(x, y) {
    if (this.charges[TOOL.ASPIRATE] <= 0) return { ok: false, why: 'no charges' };
    this.charges[TOOL.ASPIRATE]--;

    const radius = this.brushRadius * 0.55;
    this.medium.brush('state', { x, y, inner: 0, outer: radius, strength: 1.0, mode: 4 });

    this.reveal = { active: 1, x, y, radius: radius * 2.2, decay: 0.5 };
    this._record('aspirate', { x: +x.toFixed(3), y: +y.toFixed(3), r: +radius.toFixed(3) });
    return { ok: true, probe: true };
  }

  /** Seed new mass — used by onboarding and by recovery play. */
  seedAt(x, y, strength = 0.6) {
    this.medium.brush('state', { x, y, inner: 0, outer: this.brushRadius * 0.4, strength, mode: 5 });
    this._record('seed', { x: +x.toFixed(3), y: +y.toFixed(3) });
  }

  update(dt) {
    if (this.state !== 'running') return;
    this.time += dt;
    // Ramped rather than linear: the first third of a session should feel
    // genuinely open, and the last third should feel like it is closing.
    this.medium.ageStiffen = clamp01((this.time / this.duration - 0.25) / 0.6);

    if (this.reveal.active > 0) {
      this.reveal.active = Math.max(0, this.reveal.active - dt * this.reveal.decay);
    }

    // Statistics for the hum, several times a second rather than every frame.
    this._statsTimer += dt;
    if (this._statsTimer >= 0.1) {
      this._statsTimer = 0;
      this.statsBuf = this.medium.reduceStats(this.statsBuf);
      if (this.hum) this.hum.update(this.statsBuf, this.medium.statsSize, 0.1);
    }

    if (this.finished) this.assay();
  }

  /**
   * Score the dish.
   *
   * Shape is compared against the target as a coverage overlap rather than a
   * pixel difference: the player is growing a living thing with an actuator set
   * that could never produce an exact stencil, so demanding pixel accuracy would
   * be demanding something impossible and would read as the game being unfair.
   */
  assay() {
    if (this.state === 'assayed') return this.result;

    const m = this.medium;
    const n = m.size;
    const buf = m.readState();
    const target = this.target;

    let inBoth = 0, inTarget = 0, inCulture = 0;
    let scarSum = 0, commitSum = 0, mass = 0;
    // Character is measured only inside the target. Structure the player was
    // never asked for should not be able to drag the texture score either way.
    let massIn = 0, ifaceIn = 0;

    for (let i = 0; i < n * n; i++) {
      const V = buf[i * 4 + 1];
      const scar = buf[i * 4 + 2];
      const live = V > 0.18 ? 1 : 0;
      const want = target[i];

      if (live && want) inBoth++;
      if (want) inTarget++;
      if (live) inCulture++;

      if (want) { massIn += V; ifaceIn += V * (1 - V) * 4; }

      scarSum += scar;
      commitSum += buf[i * 4 + 3];
      mass += V;
    }

    // Intersection over union: penalises both missing the target and sprawling
    // beyond it, which are different mistakes with the same remedy.
    const union = inTarget + inCulture - inBoth;
    const shape = union > 0 ? inBoth / union : 0;

    const scarLoad = scarSum / (n * n);
    // Viability: a dish can match the stencil perfectly and still fail, which is
    // the second, epistemic way to lose.
    const viability = clamp01(1 - scarLoad * 5.5);

    // Character: how finely divided the growth actually came out, against what
    // the brief asked for. Scored on a tolerance rather than exactly, because
    // these actuators are far too blunt to hit a ratio on the nose and demanding
    // it would be demanding something impossible.
    const ratio = massIn > 1e-6 ? ifaceIn / massIn : 0;
    const wanted = this.character.ratio;
    const character = clamp01(1 - Math.abs(ratio - wanted) / 1.05);

    // Waste: probes that changed no subsequent action.
    //
    // This is how restraint gets taught. During the run, withholding and being
    // confused look identical; in the report they do not. A probe followed by no
    // intervention within the window bought nothing.
    const WINDOW = 45;
    let wasted = 0, probes = 0;
    for (let i = 0; i < this.log.length; i++) {
      const e = this.log[i];
      if (e.kind !== 'fluoresce' && e.kind !== 'aspirate') continue;
      probes++;
      const acted = this.log.some(o =>
        (o.kind === 'thermal' || o.kind === 'nutrient' || o.kind === 'shear' || o.kind === 'seed') &&
        o.t > e.t && o.t <= e.t + WINDOW);
      if (!acted) wasted++;
    }

    this.state = 'assayed';
    this.result = {
      shape: +shape.toFixed(4),
      character: +character.toFixed(4),
      characterRatio: +ratio.toFixed(3),
      characterWanted: wanted,
      characterName: this.character.name,
      scarLoad: +scarLoad.toFixed(4),
      viability: +viability.toFixed(4),
      coverage: inCulture / (n * n),
      commitment: commitSum / (n * n),
      mass: mass / (n * n),
      probes,
      wasted,
      // Calibrated from measured play, not guessed.
      //
      // These were 0.55 and 0.5, written before anything worked, and nothing
      // ever came close — which makes a pass/fail signal meaningless rather than
      // demanding. Across five policies on multiple dishes, skilled play (one
      // probe, variant read correctly) averages 0.254 shape at 0.92 viability;
      // ignoring the variant averages 0.220; acting on a wrong belief averages
      // 0.151. The shape bar sits just under skilled play so a good session
      // passes and a careless one does not, and the viability bar sits where
      // roughly three probes' worth of damage fails.
      passedShape: shape >= THRESHOLDS.shape,
      passedViability: viability >= THRESHOLDS.viability,
      // Kept as a measurement, not a criterion. See CHARACTERS above for why.
      passedCharacter: true,
      get passed() { return this.passedShape && this.passedViability; },
      log: this.log.slice(),
    };
    return this.result;
  }
}

/**
 * The target morphology.
 *
 * A soft organic shape rather than a geometric one: the player must be able to
 * believe the medium could get there, and a circle or a star would read as an
 * instruction rather than an intention. Built from summed radial lobes, which
 * gives shapes a culture can plausibly reach.
 */
export function makeTarget(seedName, size, seedPoints = null) {
  const rng = new Rng(seedFrom(seedName + ':target'));
  const lobes = [];

  if (seedPoints && seedPoints.length) {
    // Grow the target out of the seeds.
    //
    // The first version drew the target independently and it was frequently
    // somewhere the culture could not reach in ten minutes. That does not read
    // as a hard dish; it reads as the actuators being fake, because nothing the
    // player does closes the distance. Anchoring each lobe near a seed and
    // offsetting it means the shape is always *nearly* what the culture would do
    // on its own — so the work is steering rather than teleporting, which is the
    // game this is supposed to be.
    for (const s of seedPoints) {
      const a = rng.float() * Math.PI * 2;
      const off = lerp(0.05, 0.14, rng.float());
      lobes.push({
        x: clamp(s.x + Math.cos(a) * off, 0.2, 0.8),
        y: clamp(s.y + Math.sin(a) * off, 0.2, 0.8),
        r: lerp(0.15, 0.23, rng.float()),
      });
    }
    // One further lobe, deliberately off the seeds, so a perfect score always
    // requires the player to have taken the culture somewhere it was not going.
    const a = rng.float() * Math.PI * 2;
    lobes.push({
      x: clamp(0.5 + Math.cos(a) * 0.26, 0.2, 0.8),
      y: clamp(0.5 + Math.sin(a) * 0.26, 0.2, 0.8),
      r: lerp(0.13, 0.18, rng.float()),
    });
  } else {
    const count = rng.int(3, 5);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rng.spread(0.5);
      const d = lerp(0.10, 0.30, rng.float());
      lobes.push({
        x: 0.5 + Math.cos(a) * d,
        y: 0.5 + Math.sin(a) * d,
        r: lerp(0.13, 0.24, rng.float()),
      });
    }
  }

  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let f = 0;
      for (const l of lobes) {
        const d = Math.hypot(u - l.x, v - l.y);
        f += smoothstep(l.r, l.r * 0.35, d);
      }
      // 255, not 1.
      //
      // This array is read two ways and they disagree about units. The scoring
      // code tests it for truthiness, where 1 is fine; the renderer uploads it
      // as an R8 texture, where the sampler normalises by 255 — so a mask full
      // of 1s arrives in the shader as 0.004 and the engraved outline was
      // invisible at any brightness. It looked like the stencil was not being
      // drawn; it was being drawn at a four-hundredth of its intended value.
      out[y * size + x] = f > 0.55 ? 255 : 0;
    }
  }
  return out;
}
