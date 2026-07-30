// Policy experiments.
//
// The concept's own kill criteria, run as code. Both critics who kept STILL
// CULTURE named a way it could collapse, and both collapses are measurable
// without a human:
//
//   1. If a policy of never probing scores as well as a considered one, the
//      latent state is not doing its job and the central decision is decorative.
//   2. If waiting is free — if a policy of staying generic and committing late
//      beats acting early — the game flattens to a fixed schedule.
//
// These are run headlessly against the real simulation, so they measure the
// game rather than an argument about the game. They are not a substitute for a
// human playtest; they are the thing that says whether a human playtest is worth
// anyone's time yet.

import { Strain } from '../src/sim/strain.js';
import { Session } from '../src/game/session.js';

/** Run one policy against one dish and return its assay. */
function runPolicy(GAME, seedName, policy, { duration = 600, regime = 'coral' } = {}) {
  const g = GAME;
  const session = g.newDish(seedName, regime, duration);
  const stepSec = g.loop.stepSec;

  // Drive the session in slices, applying held actuators several times within
  // each one.
  //
  // The first version of this called the policy once per simulated second, which
  // silently gave the experiment about a hundredth of the actuator authority a
  // real player has — every policy scored the same and it looked as though the
  // controls did nothing. An experiment that under-drives the inputs measures
  // the harness, not the game.
  const SLICE = 0.25;
  const APPLIES_PER_SLICE = 8;
  const slices = Math.floor(duration / SLICE);

  for (let i = 0; i < slices; i++) {
    const t = i * SLICE;
    for (let a = 0; a < APPLIES_PER_SLICE; a++) {
      // Probes must fire once, not eight times: the policy decides by testing
      // the clock, so only offer it the instant on the first application.
      policy(session, a === 0 ? t : t + 0.001, g);
    }
    const substeps = Math.round(40 * SLICE);
    for (let s = 0; s < substeps; s += 8) g.medium.step(Math.min(8, substeps - s));
    g.medium.decayParams(SLICE);
    session.time += SLICE;
    // The harness advances time by hand rather than through Session.update, so
    // anything Session.update drives has to be driven here too. Substrate ageing
    // was silently absent the first time this was run, and the stall policy was
    // measured against a dish that never got old.
    g.medium.ageStiffen = Math.max(0, Math.min(1, (session.time / duration - 0.25) / 0.6));
    if (session.time >= duration) break;
  }

  return session.assay();
}

/** Aim at the centroid of the target, which any player would find immediately. */
function targetCentroid(session) {
  const n = session.medium.size;
  const t = session.target;
  let sx = 0, sy = 0, c = 0;
  for (let y = 0; y < n; y += 4) {
    for (let x = 0; x < n; x += 4) {
      if (t[y * n + x]) { sx += x; sy += y; c++; }
    }
  }
  return c ? { x: sx / c / n, y: sy / c / n } : { x: 0.5, y: 0.5 };
}

/** Pick a point inside the target, spread around by index. */
function targetPoint(session, i) {
  const n = session.medium.size;
  const t = session.target;
  const pts = [];
  for (let y = 0; y < n; y += 16) {
    for (let x = 0; x < n; x += 16) {
      if (t[y * n + x]) pts.push({ x: x / n, y: y / n });
    }
  }
  if (!pts.length) return { x: 0.5, y: 0.5 };
  return pts[(i * 7919) % pts.length];
}

/**
 * A competent-but-blind steering routine: feed inside the target, starve
 * outside it. This is roughly what a player who understood the verbs but read
 * nothing would do, and it is the bar every other policy has to clear.
 */
function steerTowardTarget(session, t) {
  const phase = Math.floor(t / 6) % 2;
  if (phase === 0) {
    session.tool = 'nutrient';
    const p = targetPoint(session, Math.floor(t / 12));
    session.use(p.x, p.y, { held: true });
  } else {
    session.tool = 'shade';
    const p = outsidePoint(session, Math.floor(t / 12));
    session.use(p.x, p.y, { held: true });
  }
}

/**
 * Steering that knows which variant it is dealing with.
 *
 * Inside the target it applies the correction the variant needs; outside it
 * always starves. Believing the wrong variant therefore does active harm inside
 * the shape you are trying to grow, which is the point.
 */
function variantAwareSteer(session, t, believesDissolving) {
  const phase = Math.floor(t / 6) % 3;
  if (phase === 2) {
    session.tool = 'shade';
    const p = outsidePoint(session, Math.floor(t / 12));
    session.use(p.x, p.y, { held: true });
    return;
  }
  // The carrying region metabolises enrichment backwards, so the tool that grows
  // it is the one that would starve normal ground. Getting this the wrong way
  // round is precisely the mistake an unread dish invites, which is why the
  // guessing policy exists.
  session.tool = believesDissolving ? 'shade' : 'nutrient';
  const p = targetPoint(session, Math.floor(t / 12));
  session.use(p.x, p.y, { held: true });
}

/** A point that is outside the target but inside the dish. */
function outsidePoint(session, i) {
  const n = session.medium.size;
  const tgt = session.target;
  const pts = [];
  for (let y = 0; y < n; y += 16) {
    for (let x = 0; x < n; x += 16) {
      const u = x / n, v = y / n;
      if (Math.hypot(u - 0.5, v - 0.5) > 0.46) continue;
      if (!tgt[y * n + x]) pts.push({ x: u, y: v });
    }
  }
  if (!pts.length) return { x: 0.5, y: 0.5 };
  return pts[(i * 7919) % pts.length];
}

export const POLICIES = {
  /** Do nothing at all. The floor: anything that loses to this is broken. */
  passive() {},

  /** Never probe; steer constantly by feel toward the target. */
  blind(session, t) {
    steerTowardTarget(session, t);
  },

  /** Probe early once, then steer. The "expert opening" the critics predicted. */
  probeOnce(session, t) {
    if (Math.abs(t - 60) < 0.51) {
      session.tool = 'fluoresce';
      const c = targetCentroid(session);
      session.use(c.x, c.y, { held: false });
      return;
    }
    steerTowardTarget(session, t);
  },

  /** Probe constantly. Should win on shape and fail viability. */
  probeHeavy(session, t) {
    const probeTimes = [40, 100, 160, 220, 280, 340];
    for (const pt of probeTimes) {
      if (Math.abs(t - pt) < 0.51) {
        session.tool = session.charges.fluoresce > 0 ? 'fluoresce' : 'aspirate';
        const p = targetPoint(session, probeTimes.indexOf(pt));
        session.use(p.x, p.y, { held: false });
        return;
      }
    }
    steerTowardTarget(session, t);
  },

  /**
   * Informed: pays for one early probe, then plays the variant correctly.
   *
   * The variant decides which correction the expressing region needs. A
   * dissolving strain raises the local kill rate and eats itself, so it wants
   * feeding; a ropy strain lowers it and overgrows, so it wants starving. Both
   * are the wrong thing to do to the other.
   *
   * This policy is handed the answer rather than reading it, which is exactly
   * what a probe buys. If it does not beat `blind` by more than the viability a
   * probe costs, the central claim of the design is false.
   */
  informed(session, t, g) {
    if (t >= 90 && !session._probedOnce) {
      session._probedOnce = true;
      session.tool = 'fluoresce';
      const c = targetCentroid(session);
      session.use(c.x, c.y, { held: false });
      return;
    }
    const dissolving = g.strain.variantSign > 0;
    variantAwareSteer(session, t, dissolving);
  },

  /**
   * Guessing: never probes, and assumes the wrong variant.
   *
   * The floor for acting confidently on an unread dish. The gap between this and
   * `informed` is the value of knowing; the gap between this and `blind` is the
   * cost of being wrong rather than merely uncommitted.
   */
  guessing(session, t, g) {
    const dissolving = g.strain.variantSign > 0;
    variantAwareSteer(session, t, !dissolving);
  },

  /**
   * Stall: take no shaping action until late, then commit hard.
   * This is the dominant strategy the second critic predicted. If it wins, the
   * irreversible-differentiation answer has failed.
   */
  stall(session, t) {
    if (t < 420) return;
    session.tool = 'nutrient';
    const p = targetPoint(session, Math.floor(t / 10));
    session.use(p.x, p.y, { held: true });
  },
};

export async function runPolicyExperiment(GAME, { dishes = 4, duration = 600 } = {}) {
  const names = Object.keys(POLICIES);
  const rows = {};
  for (const n of names) rows[n] = [];

  for (let d = 0; d < dishes; d++) {
    const seed = `experiment-${d}`;
    for (const name of names) {
      const r = runPolicy(GAME, seed, POLICIES[name], { duration });
      rows[name].push({
        dish: seed,
        shape: r.shape,
        viability: r.viability,
        scar: r.scarLoad,
        passed: r.passedShape && r.passedViability,
        probes: r.probes,
        wasted: r.wasted,
      });
    }
  }

  const summary = names.map(name => {
    const rs = rows[name];
    const avg = (f) => rs.reduce((s, r) => s + f(r), 0) / rs.length;
    return {
      policy: name,
      shape: +avg(r => r.shape).toFixed(3),
      viability: +avg(r => r.viability).toFixed(3),
      scar: +avg(r => r.scar).toFixed(4),
      passRate: +avg(r => (r.passed ? 1 : 0)).toFixed(2),
      probes: +avg(r => r.probes).toFixed(1),
    };
  });

  return { summary, rows };
}
