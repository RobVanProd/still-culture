// Is the hum informative, or only implemented?
//
//   const a = await import('/tests/audio.js');
//   GAME.loop.stop();
//   await a.runAudioTest(GAME);
//
// The hum is specified as the game's primary *free information channel*: a
// trained player is supposed to hear things in it they would otherwise have to
// spend a probe to see. That claim had never been tested. It is a claim about
// discrimination, so it is testable without a person: drive the medium into the
// states a player must tell apart, read the numbers the oscillators would be set
// to, and ask whether the readings differ by more than a listener can resolve.
//
// Two bars, and both have to clear, because they fail in different ways.
//
//   Audibility.    The gap between two states, in just-noticeable differences.
//                  A beat rate that changes by 0.05 Hz has changed by a number
//                  and not by a sound.
//   Reliability.   The same gap divided by how much that reading varies across
//                  dishes in the *same* state. If dish identity moves the
//                  reading further than the state does, the player is hearing
//                  which dish they were given rather than what it is doing.
//
// The second bar is the one that matters and the one that cannot be gamed.
// Rescaling a mapping multiplies the gap and the between-dish spread by the same
// factor, so d' is invariant under every constant in `voicing()`. A mapping can
// only pass it by measuring something that is actually different.
//
// The JND figures are conservative published-ish values for sustained tones, not
// measurements of this game: beat rate 0.3 Hz, pitch one semitone, filter cutoff
// a third of an octave, loudness 1.5 dB. They are the honest kind of wrong —
// they overstate what a player on laptop speakers can hear, so a mapping that
// clears them may still fail in a room, and one that fails them cannot possibly
// work anywhere.

import { Strain } from '../src/sim/strain.js';
import { Hum } from '../src/audio/hum.js';

/** An Audio that never starts, so the Hum analyses and voices but never sounds. */
const SILENT = { started: false };

const dB = (g) => Math.max(-60, 20 * Math.log10(Math.max(g, 1e-6)));
const oct = (hz) => Math.log2(Math.max(hz, 20));
const semi = (hz) => 12 * Math.log2(Math.max(hz, 20));

/**
 * The dimensions a listener actually has, with what counts as a difference.
 *
 * Functions of the voicing rather than of the field statistics, on purpose. The
 * player cannot hear `interface`; they can hear a lowpass move.
 */
const DIMS = [
  { name: 'beat',      unit: 'Hz',  jnd: 0.30, of: (v) => v.beatHz },
  { name: 'register',  unit: 'st',  jnd: 1.00, of: (v) => semi(v.baseHz) },
  { name: 'grainCut',  unit: 'oct', jnd: 0.33, of: (v) => oct(v.grainCut) },
  { name: 'grainGain', unit: 'dB',  jnd: 1.50, of: (v) => dB(v.grainGain) },
  { name: 'lowGain',   unit: 'dB',  jnd: 1.50, of: (v) => dB(v.lowGain) },
  { name: 'lowCut',    unit: 'oct', jnd: 0.33, of: (v) => oct(v.lowCut) },
  { name: 'midCut',    unit: 'oct', jnd: 0.33, of: (v) => oct(v.midCut) },
  { name: 'midGain',   unit: 'dB',  jnd: 1.50, of: (v) => dB(v.midGain) },
];

/**
 * Pairs a player is required to tell apart, and why.
 *
 * Not every pair; these are the discriminations the design document says the
 * free channels have to support. A pair that fails here is a hole in the game,
 * not a shortfall in a metric.
 *
 * `expressingOnly` restricts a pair to dishes whose hidden variant actually
 * expressed within the session. Including a dish where nothing happened in a
 * test of whether you can hear something happen measures the strain generator,
 * not the hum — and the dishes where nothing happens are reported separately,
 * because that is a finding in its own right.
 */
const REQUIRED = [
  ['seeding', 'growth', 'minute one is a flat drone; the dish taking hold is not'],
  ['growth', 'dying', 'a branch and a collapse want opposite interventions'],
  ['variantOff', 'variantOn', 'the variant is what the probe is for', true],
  ['growth', 'hardened', 'authority is gone; late correction is weak'],
  ['growth', 'scarred', 'the price of looking must be audible in the mix'],
  ['hardened', 'dying', 'a finished dish and a failing one are not the same dish'],
];

// --------------------------------------------------------------------- rig

/** Build a strain and install it. `variant:false` zeroes the hidden variant. */
function install(GAME, seedName, { variant = true } = {}) {
  const strain = new Strain(seedName, { size: GAME.medium.size, regime: 'coral' });
  // The A/B that isolates the variant. Every other draw the strain makes — field
  // noise, diffusion, seed placement, target — happens in the constructor and is
  // unaffected, so the two dishes differ in exactly one thing.
  if (!variant) strain.variantStrength = 0;
  strain.applyTo(GAME.medium);
  return strain;
}

/**
 * Advance the chemistry, feeding the hum as the game does.
 *
 * The cadence matters twice over. Actuator decay is a time constant, so a dish
 * driven in different-sized slices is a different dish. And the hum's smoothers
 * are time constants too, so a reading taken from a frozen field is a limit the
 * player never hears — this feeds along the run instead, which is the only way
 * the reading includes the dish's own history.
 */
function advance(GAME, seconds, hum = null, onSecond = null) {
  for (let t = 0; t < seconds; t++) {
    if (onSecond) onSecond(t);
    for (let i = 0; i < 4; i++) {
      GAME.medium.step(8); GAME.medium.step(2);
      GAME.medium.decayParams(0.25);
    }
    if (hum) {
      hum._buf = GAME.medium.reduceStats(hum._buf);
      for (let i = 0; i < 4; i++) hum.analyse(hum._buf, GAME.medium.statsSize, 0.25);
    }
  }
  return hum;
}

/** Snapshot / restore, so several states can branch from one shared history. */
function snapshot(GAME) { return GAME.medium.readState(); }
function restore(GAME, strain, snap) {
  GAME.medium.uploadParams(strain.buildParams());
  GAME.medium.uploadState(snap);
}

function listen(GAME, hum) {
  return {
    readout: hum.readout(),
    legacySplit: legacySplit(hum._buf || GAME.medium.reduceStats(), GAME.medium.statsSize),
  };
}

/**
 * The divergence term as it shipped: interface density, left half against right.
 *
 * Kept here rather than in the hum so the report can state what changed and by
 * how much.
 */
function legacySplit(stats, size) {
  let li = 0, ln = 0, ri = 0, rn = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const f = stats[(y * size + x) * 4 + 1];
      if (x < size / 2) { li += f; ln++; } else { ri += f; rn++; }
    }
  }
  const l = ln ? li / ln : 0, r = rn ? ri / rn : 0;
  return Math.abs(l - r) / Math.max(l + r, 1e-5);
}

/**
 * How much of the hidden variant actually expressed.
 *
 * The variant is inert until local commitment passes a per-pixel threshold, and
 * on some dishes that never happens inside a session: the patch is small, or its
 * threshold is high, or it landed where the culture chose not to build. Those
 * dishes carry a variant in the save file and not in the dish.
 */
function variantExpression(GAME, strain) {
  const latent = strain.buildLatent();
  const state = GAME.medium.readState();
  const n = GAME.medium.size * GAME.medium.size;
  let carrying = 0, expressed = 0;
  for (let i = 0; i < n; i++) {
    if (Math.abs(latent[i * 4]) > 0.0005) {
      carrying++;
      if (state[i * 4 + 3] > latent[i * 4 + 1]) expressed++;
    }
  }
  return {
    carryingFrac: +(carrying / n).toFixed(3),
    expressedFrac: +(carrying ? expressed / carrying : 0).toFixed(3),
  };
}

// ------------------------------------------------------------------ states

/**
 * Drive one dish through every state and read the hum in each.
 *
 * The state ladder is grown on a variant-free clone so that "this dish is
 * scarred" and "this dish carries a variant" are never confounded; the variant
 * is measured on its own, against the identical dish without it. A flooded dish
 * that also carries a variant half dies and half solidifies — a real state, but
 * not the one a player has to recognise as death.
 *
 * Everything after t=200 branches from one snapshot, so a difference between two
 * states is something that happened to the dish rather than a different dish.
 */
function measureDish(GAME, seedName) {
  const out = {};
  const plain = install(GAME, seedName, { variant: false });

  out.seeding = listen(GAME, advance(GAME, 60, new Hum(SILENT)));
  advance(GAME, 140);                                               // t = 200
  const at200 = snapshot(GAME);

  // `growth` and `scarred` are both read at t=240 rather than 200 and 240, so
  // the difference between them is the damage and not the forty seconds of
  // growing the damaged dish also did.
  out.growth = listen(GAME, advance(GAME, 40, new Hum(SILENT)));

  restore(GAME, plain, at200);
  scarHeavily(GAME);
  out.scarred = listen(GAME, advance(GAME, 40, new Hum(SILENT)));

  restore(GAME, plain, at200);
  out.hardened = listen(GAME, advance(GAME, 360, new Hum(SILENT))); // t = 560

  restore(GAME, plain, at200);
  out.dying = listen(GAME, advance(GAME, 120, new Hum(SILENT), () => floodShade(GAME)));

  restore(GAME, plain, at200);
  out.variantOff = listen(GAME, advance(GAME, 220, new Hum(SILENT))); // t = 420

  const carrier = install(GAME, seedName, { variant: true });
  out.variantOn = listen(GAME, advance(GAME, 420, new Hum(SILENT)));
  const expression = variantExpression(GAME, carrier);

  return { states: out, strain: carrier.describe(), expression };
}

/** Four bleaches and two aspirates: the full probe budget, spent. */
function scarHeavily(GAME) {
  for (const [x, y] of [[0.38, 0.42], [0.60, 0.38], [0.45, 0.62], [0.62, 0.60]]) {
    GAME.medium.brush('state', { x, y, inner: 0, outer: 0.115, strength: 0.85, mode: 3 });
  }
  for (const [x, y] of [[0.50, 0.50], [0.55, 0.44]]) {
    GAME.medium.brush('state', { x, y, inner: 0, outer: 0.055, strength: 1.0, mode: 4 });
  }
}

/** Shade over the whole dish, held. Raises K everywhere until nothing survives. */
function floodShade(GAME) {
  for (let i = 0; i < 8; i++) {
    GAME.medium.brush('params', { x: 0.5, y: 0.5, inner: 0, outer: 1.4, strength: 0.07, mode: 6 });
  }
}

// ----------------------------------------------------------------- scoring

function stat(values) {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const varr = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, sd: Math.sqrt(varr), n };
}

/** Mean and spread of every audible dimension, for one state over a set of dishes. */
function profile(dishes, state) {
  const p = {};
  for (const d of DIMS) p[d.name] = stat(dishes.map(x => d.of(x.states[state].readout.voicing)));
  return p;
}

/** Gap between two states on every dimension, in JNDs and in d'. */
function comparePair(dishes, a, b, why) {
  const A = profile(dishes, a), B = profile(dishes, b);
  const dims = DIMS.map(d => {
    const gap = Math.abs(A[d.name].mean - B[d.name].mean);
    // A pooled-sd floor keeps d' finite when both states are pinned to a clamp:
    // two readings that are identical every time are not infinitely
    // discriminable, they are identical.
    const pooled = Math.max(Math.sqrt((A[d.name].sd ** 2 + B[d.name].sd ** 2) / 2), d.jnd * 0.05);
    return {
      dim: d.name, unit: d.unit,
      a: +A[d.name].mean.toFixed(3), b: +B[d.name].mean.toFixed(3),
      gap: +gap.toFixed(3),
      jnds: +(gap / d.jnd).toFixed(2),
      dprime: +(gap / pooled).toFixed(2),
    };
  });
  // Rank by the weaker of the two bars: a dimension that is loud but unreliable
  // and one that is reliable but inaudible do not add up to a channel.
  dims.sort((p, q) => Math.min(q.jnds, q.dprime) - Math.min(p.jnds, p.dprime));
  const best = dims[0];
  return {
    pair: `${a} vs ${b}`,
    why,
    dishes: dishes.length,
    separable: best.jnds >= 1 && best.dprime >= 1,
    carriedBy: best.dim,
    jnds: best.jnds,
    dprime: best.dprime,
    dims,
  };
}

export async function runAudioTest(GAME, {
  seeds = ['audio-a', 'audio-b', 'audio-c', 'audio-d', 'audio-e', 'audio-f'],
  restoreDish = 'dish-001',
} = {}) {
  const wasRunning = GAME.loop.running;
  GAME.loop.stop();

  const dishes = [];
  for (const seed of seeds) dishes.push({ seed, ...measureDish(GAME, seed) });

  const names = Object.keys(dishes[0].states);

  // Dishes whose variant never got out of the save file. Reported rather than
  // quietly dropped: a variant that does not express is a dish on which the
  // probe cannot be worth anything, and that is a fact about the game.
  const inert = dishes.filter(d => d.expression.carryingFrac < 0.10 || d.expression.expressedFrac < 0.10);
  const expressing = dishes.filter(d => !inert.includes(d));

  const table = names.map(s => {
    const v = dishes.map(d => d.states[s].readout);
    const m = (f) => +stat(v.map(f)).mean.toFixed(4);
    const sd = (f) => +stat(v.map(f)).sd.toFixed(4);
    return {
      state: s,
      beatHz: m(r => r.voicing.beatHz), beatSd: sd(r => r.voicing.beatHz),
      // What the same term reported before it was replaced. Reported so the
      // change is auditable rather than asserted.
      legacyBeatHz: +stat(dishes.map(d => Math.min(7, d.states[s].legacySplit * 9))).mean.toFixed(2),
      registerHz: m(r => r.voicing.baseHz),
      grainCut: m(r => r.voicing.grainCut), grainGain: m(r => r.voicing.grainGain),
      lowGain: m(r => r.voicing.lowGain), lowCut: m(r => r.voicing.lowCut),
      midCut: m(r => r.voicing.midCut), midGain: m(r => r.voicing.midGain),
      mass: m(r => r.mass), interface: m(r => r.interface),
      commit: m(r => r.commit), scar: m(r => r.scar),
      occupancy: m(r => r.occupancy), unevenness: m(r => r.split),
    };
  });

  const pairs = REQUIRED.map(([a, b, why, expressingOnly]) =>
    comparePair(expressingOnly ? expressing : dishes, a, b, why));

  const failures = pairs.filter(p => !p.separable).map(p =>
    `${p.pair}: best dimension ${p.carriedBy} at ${p.jnds} JND / d' ${p.dprime} over ${p.dishes} dishes — ${p.why}`);

  // Every pair, not only the required ones: two arbitrary states colliding is
  // still worth knowing about.
  const allPairs = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const c = comparePair(dishes, names[i], names[j], '');
      allPairs.push({ pair: c.pair, separable: c.separable, carriedBy: c.carriedBy, jnds: c.jnds, dprime: c.dprime });
    }
  }

  if (restoreDish) GAME.newDish(restoreDish, 'coral');
  if (wasRunning) GAME.loop.start();

  return {
    ok: failures.length === 0 && expressing.length >= 3,
    failures,
    table,
    pairs,
    allPairs,
    variants: dishes.map(d => ({ seed: d.seed, ...d.strain, ...d.expression, inert: inert.includes(d) })),
    inertDishes: inert.map(d => d.seed),
    seeds,
  };
}
