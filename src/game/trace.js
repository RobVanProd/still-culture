// The after-action trace.
//
// Interface
//   Trace.fromGame(GAME)            -> Trace over the dish being played
//   Trace.fromRecord(record)        -> Trace over a saved or loaded record
//   trace.bands                     -> merged intervention spans, for a timeline
//   trace.probes                    -> each probe, with whether it bought anything
//   trace.at(t)                     -> what was happening at t, and what caused it
//   trace.seek(GAME, t)             -> put the medium back at t, deterministically
//   trace.series(GAME, opts)        -> what the field actually did, sampled
//   trace.summary()                 -> counts a report can lead with
//
// This exists because of one objection, and it is the strongest one anybody has
// made about the design: the player cannot run a controlled experiment. There
// is one dish, no undo, and roughly forty seconds between an action and the
// medium's answer to it. A player who fails therefore cannot say why, and a
// failure you cannot form a theory about is noise rather than a lesson.
//
// The answer is not to make the game more legible while it is being played —
// that would remove the withholding the whole thing is about. It is to make the
// session legible *afterwards*. During the run the player gets nothing extra.
// Afterwards they can scrub, and see their own hand against what the medium did
// with it, at the forty-second offset that made it illegible at the time.
//
// The data model is deliberately two things at once. The bands come from
// `Session.log` and need no simulation, so a timeline can be drawn instantly
// and scrolled freely. The field comes from replaying the input stream, which
// costs real time, so it is fetched only when something actually wants to look
// at the dish. A scrub bar built on the first with the second loaded behind it
// is responsive; one that replays on every pointer move is not.
//
// Nothing here draws. It answers questions about a session in a form a UI can
// render, and it owns the replay cursor so that scrubbing forward is cheap.

import { replay, asEventStream, recorderFor } from './save.js';

/**
 * How long after an intervention the medium is still answering it.
 *
 * The same 45 seconds the assay uses to decide whether a probe was wasted. It
 * is repeated here rather than imported because `Session` does not export it,
 * and it must not drift: the trace exists to explain the score the player was
 * given, and a trace that disagrees with the scoring is worse than no trace.
 */
export const RESPONSE_WINDOW = 45;

/**
 * A gap longer than this ends a run of continuous actuator use.
 *
 * `Session` writes at most one actuator entry per second while a tool is held,
 * so consecutive entries a second apart are one stroke and a gap of more than
 * about one and a half seconds is the player having let go.
 */
const MERGE_GAP = 1.6;

const ACTUATORS = new Set(['nutrient', 'shade', 'thermal', 'shear']);
const PROBES = new Set(['fluoresce', 'aspirate']);

const INITIAL_CHARGES = { fluoresce: 4, aspirate: 2 };

export class Trace {
  /**
   * @param {object} record  a save record: seed, regime, duration, log, events
   */
  constructor(record) {
    this.record = record;
    this.seed = record.seed;
    this.regime = record.regime;
    this.duration = record.duration;
    this.tickCount = record.tickCount || 0;
    this.log = (record.log || []).slice().sort((a, b) => a.t - b.t);

    this.bands = buildBands(this.log);
    this.probes = buildProbes(this.log);

    // Where the medium currently sits, in ticks, if this trace put it there.
    this._cursorTick = -1;
    // Measured, not guessed: the first seek sets it and later ones refine it,
    // so `scrubCost` reports this machine rather than the machine it was
    // written on.
    this._msPerTick = null;
  }

  static fromRecord(record) { return new Trace(record); }

  /** The dish currently being played, whether or not it has been saved. */
  static fromGame(GAME) {
    const rec = recorderFor(GAME);
    if (!rec) throw new Error('no recorder attached — call attachRecorder(GAME) first');
    return new Trace(rec.snapshotRecord());
  }

  get stepSec() { return 1 / 120; }

  // -------------------------------------------------------------------------
  // Reading the timeline — no simulation, safe to call per pointer move
  // -------------------------------------------------------------------------

  /**
   * What was happening at t, and what the dish at t is an answer to.
   *
   * `active` is what the player's hand was doing at that instant. `causedBy` is
   * everything inside the response window before it, which is the part the
   * player could not see at the time and is the reason this screen exists.
   */
  at(t, { window = RESPONSE_WINDOW } = {}) {
    const active = this.bands.filter(b => t >= b.t0 && t <= b.t1);
    const causedBy = this.bands.filter(b => b.t1 >= t - window && b.t0 <= t);
    const charges = { ...INITIAL_CHARGES };
    for (const p of this.probes) {
      if (p.t <= t && charges[p.kind] !== undefined) charges[p.kind]--;
    }

    const spent = { nutrient: 0, shade: 0, thermal: 0, shear: 0 };
    for (const b of this.bands) {
      if (!ACTUATORS.has(b.kind)) continue;
      const overlap = Math.min(b.t1, t) - b.t0;
      if (overlap > 0) spent[b.kind] += overlap;
    }

    return {
      t,
      active,
      causedBy,
      charges,
      spent,
      probesSoFar: this.probes.filter(p => p.t <= t).length,
      scarsOnDish: this.probes.filter(p => p.t <= t).map(p => ({ x: p.x, y: p.y, r: p.r, t: p.t, kind: p.kind })),
      next: this.bands.find(b => b.t0 > t) || null,
      previous: [...this.bands].reverse().find(b => b.t1 < t) || null,
    };
  }

  /** Bands clipped to a range, for drawing a window of the timeline. */
  between(t0, t1) {
    return this.bands.filter(b => b.t1 >= t0 && b.t0 <= t1);
  }

  summary() {
    const spent = { nutrient: 0, shade: 0, thermal: 0, shear: 0 };
    for (const b of this.bands) if (ACTUATORS.has(b.kind)) spent[b.kind] += b.t1 - b.t0;
    const wasted = this.probes.filter(p => p.wasted).length;
    const first = this.bands.length ? this.bands[0].t0 : null;
    return {
      seed: this.seed,
      regime: this.regime,
      duration: this.duration,
      played: +(this.tickCount * this.stepSec).toFixed(1),
      interventions: this.bands.length,
      probes: this.probes.length,
      wastedProbes: wasted,
      spent: Object.fromEntries(Object.entries(spent).map(([k, v]) => [k, +v.toFixed(1)])),
      // How long the player left the dish alone before touching it, which is
      // the one number that distinguishes withholding from not having started.
      firstIntervention: first === null ? null : +first.toFixed(1),
      inputEvents: asEventStream(this.record.events).count,
    };
  }

  // -------------------------------------------------------------------------
  // Reading the field — costs a simulation
  // -------------------------------------------------------------------------

  /**
   * Put the medium back to time t.
   *
   * Forward scrubs continue from wherever the medium already is; a backward
   * scrub has to start the dish again, because the chemistry has no inverse.
   * That asymmetry is real and cannot be engineered away here, so it is
   * reported rather than hidden — see `scrubCost`.
   */
  seek(GAME, t) {
    const stepSec = GAME.loop.stepSec;
    const tick = Math.max(0, Math.min(this.tickCount, Math.round(t / stepSec)));
    const canResume = this._cursorTick >= 0 && GAME.loop.tick === this._cursorTick && tick >= this._cursorTick;

    const r = replay(GAME, this.record, { toTick: tick, resume: canResume });
    const ran = canResume ? tick - this._cursorTick : tick;
    if (ran > 240) {
      // Only trust long runs for the estimate; a scrub of a few ticks measures
      // the call overhead rather than the chemistry.
      const ms = r.ms / ran;
      this._msPerTick = this._msPerTick === null ? ms : this._msPerTick * 0.7 + ms * 0.3;
    }
    this._cursorTick = GAME.loop.tick;
    return { ...r, tick, time: +(tick * stepSec).toFixed(3), resumed: canResume, ticksRun: ran };
  }

  /**
   * What a seek to t would cost, in milliseconds, before doing it.
   *
   * A UI should use this to decide whether to show the scrub as instant or to
   * put a progress state up. Returns null until a seek has been measured.
   */
  scrubCost(t) {
    if (this._msPerTick === null) return null;
    const tick = Math.max(0, Math.min(this.tickCount, Math.round(t * 120)));
    const ran = (this._cursorTick >= 0 && tick >= this._cursorTick) ? tick - this._cursorTick : tick;
    return +(ran * this._msPerTick).toFixed(1);
  }

  /** The medium has been touched by something other than this trace. */
  invalidateCursor() { this._cursorTick = -1; }

  /**
   * What the field actually did, over the whole session.
   *
   * One replay, sampling the medium's own 16x16 reduction rather than reading
   * the full field back: the reduction costs four kilobytes a sample against
   * four megabytes, which is the difference between a hundred and twenty
   * samples being affordable and being the reason nobody uses this screen.
   *
   * Each sample keeps the tile grid as well as the means, so a UI can show
   * where the medium was growing rather than only how much — which is what
   * makes an intervention attributable to a place as well as to a moment.
   */
  series(GAME, { every = 5, grid = true } = {}) {
    const out = [];
    const r = replay(GAME, this.record, {
      sampleEvery: every,
      onSample: (t, stats) => {
        let mass = 0, iface = 0, commit = 0, scar = 0;
        const tiles = stats.length / 4;
        for (let i = 0; i < tiles; i++) {
          mass += stats[i * 4];
          iface += stats[i * 4 + 1];
          commit += stats[i * 4 + 2];
          scar += stats[i * 4 + 3];
        }
        out.push({
          t: +t.toFixed(2),
          mass: mass / tiles,
          interface: iface / tiles,
          commit: commit / tiles,
          scar: scar / tiles,
          // The buffer is reused between samples, so anything kept must be copied.
          grid: grid ? stats.slice() : null,
        });
      },
    });
    this._cursorTick = GAME.loop.tick;
    return { samples: out, gridSize: 16, ms: r.ms, replayed: r };
  }

  /**
   * Interventions and field response side by side.
   *
   * The join a UI actually wants: for each sample, what the player had done in
   * the window the medium is answering. Built from a series that has already
   * been run, so it costs nothing.
   */
  align(series, { window = RESPONSE_WINDOW } = {}) {
    return series.samples.map(s => ({
      ...s,
      causedBy: this.bands.filter(b => b.t1 >= s.t - window && b.t0 <= s.t).map(b => b.kind),
    }));
  }
}

// ---------------------------------------------------------------------------
// Building the model from the log
// ---------------------------------------------------------------------------

/**
 * Merge the per-second actuator entries back into strokes.
 *
 * The log is sampled, not continuous, so a band is a reconstruction: it runs
 * from the first sample to one second past the last, because each entry stands
 * for the second of holding that followed it.
 */
function buildBands(log) {
  const bands = [];
  const open = new Map();

  const close = (kind) => {
    const b = open.get(kind);
    if (!b) return;
    b.t1 = +(b.samples[b.samples.length - 1].t + 1).toFixed(2);
    b.cx = b.samples.reduce((s, p) => s + p.x, 0) / b.samples.length;
    b.cy = b.samples.reduce((s, p) => s + p.y, 0) / b.samples.length;
    open.delete(kind);
  };

  for (const e of log) {
    if (PROBES.has(e.kind) || e.kind === 'seed') {
      bands.push({
        kind: e.kind,
        instant: true,
        t0: e.t, t1: e.t,
        x: e.x, y: e.y, r: e.r ?? null,
        cx: e.x, cy: e.y,
        samples: [{ t: e.t, x: e.x, y: e.y }],
      });
      continue;
    }
    if (!ACTUATORS.has(e.kind)) continue;

    // Any other actuator starting ends this one: the player has one hand.
    for (const k of [...open.keys()]) if (k !== e.kind) close(k);

    const b = open.get(e.kind);
    if (b && e.t - b.samples[b.samples.length - 1].t <= MERGE_GAP) {
      b.samples.push({ t: e.t, x: e.x, y: e.y });
    } else {
      if (b) close(e.kind);
      const fresh = { kind: e.kind, instant: false, t0: e.t, t1: e.t, samples: [{ t: e.t, x: e.x, y: e.y }] };
      open.set(e.kind, fresh);
      bands.push(fresh);
    }
  }
  for (const k of [...open.keys()]) close(k);

  bands.sort((a, b) => a.t0 - b.t0);
  return bands;
}

/**
 * Each probe, and whether it changed anything.
 *
 * This mirrors the rule in `Session.assay` exactly, including its choice of
 * which actuators count as having acted. Note that `shade` is absent from that
 * list in `session.js`; the trace reproduces the omission rather than correcting
 * it, because the trace has to explain the score the player was actually shown.
 * If that list is a mistake it should be fixed in the scoring and here together.
 */
function buildProbes(log) {
  const ACTED = new Set(['thermal', 'nutrient', 'shear', 'seed']);
  const out = [];
  for (const e of log) {
    if (!PROBES.has(e.kind)) continue;
    const following = log.filter(o => ACTED.has(o.kind) && o.t > e.t && o.t <= e.t + RESPONSE_WINDOW);
    out.push({
      kind: e.kind,
      t: e.t,
      x: e.x, y: e.y, r: e.r ?? null,
      wasted: following.length === 0,
      actedAt: following.length ? following[0].t : null,
      // What the player had already spent when they chose to look. A probe at
      // ten seconds and a probe at eight minutes are different decisions and
      // should not read the same in a report.
      followUps: following.length,
    });
  }
  return out;
}

export default Trace;
