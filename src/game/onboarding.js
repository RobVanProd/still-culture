// First-dish onboarding.
//
// The vision forbids a tutorial text wall and forbids the game handing out
// attribution during a run. Both constraints are kept here, and they shape
// everything below:
//
//   - Nothing is explained. Every line states something the player can see on
//     screen at the moment it appears, or states a property of a control. No
//     line names a cause, names the variant, or says what to do about it.
//   - Lessons are provoked by the dish's state wherever a state can carry them
//     — mass appearing, the culture becoming large enough to compare against
//     the stencil, a fed region measurably shrinking. A time is attached to
//     each one only as a fallback, for the player whose dish never provokes it.
//   - One short line at a time, near where the player is already looking, on a
//     layer that cannot be clicked. Play is never interrupted and never gated.
//
// The one lesson deliberately absent is restraint. Doing nothing and doing the
// right nothing look identical during a run, so no prompt can distinguish them
// honestly; that lesson belongs to the end-of-run assay, which counts probes
// that changed no subsequent action. See game/shell.js.
//
// Interface
// ---------
//   const ob = new Onboarding();
//   ob.onPrompt = ({ text, anchor, ttl }) => {}   // anchor: {kind:'cursor'}
//                                                 //      or {kind:'dish',x,y}
//   ob.setEnabled(bool)      // first dish only
//   ob.begin(session)        // bind to a fresh dish
//   ob.update(dt, session)   // from the fixed step, only while play is running
//
// It reads the session and never writes to it. Everything it needs is already
// recorded: `session.log` carries the player's interventions, and
// `session.statsBuf` is the 16x16 field reduction the hum is driven from, which
// is refreshed ten times a second and costs nothing extra to read.

const PROMPT_TTL = 7.5;
const PROMPT_GAP = 6.0;      // never two lines close enough to read as a wall
const ANSWER_DELAY = 40;     // how long this medium takes to answer an actuator

/**
 * The lessons, in the order they are meant to land.
 *
 * `ordered: true` lessons form the opening sequence and wait for each other.
 * The rest are reactive: they fire whenever the player provokes them, which may
 * be never, and that is a legitimate way for a dish to go.
 */
const LESSONS = [
  {
    id: 'growth',
    ordered: true,
    // The first thing to understand is that the dish has its own agenda.
    text: () => 'it is growing without you.',
    ready: (o) => o.meanMass() > 0.030,
    fallback: 20,
    // A player who is already acting has been told this by the dish itself.
    skip: (o) => o.actionCount > 0,
    anchor: (o) => o.massCentroid(),
  },
  {
    id: 'verbs',
    ordered: true,
    // The non-obvious half of the control scheme. Which key does what is on the
    // HUD; that an actuator is leaned on rather than clicked is not.
    text: () => 'hold the button to act.',
    ready: () => false,          // the provoking state is the player's inaction
    fallback: 8,                 // measured from the previous ordered lesson
    relative: true,
    skip: (o) => o.actionCount > 0,
    anchor: () => ({ kind: 'cursor' }),
  },
  {
    id: 'target',
    ordered: true,
    text: () => 'the outline is what is wanted.',
    // Only worth saying once there is a culture on screen to compare with it.
    ready: (o) => o.meanMass() > 0.055,
    fallback: 80,
    anchor: (o) => o.targetCentroid(),
  },
  {
    id: 'latency',
    // The largest untested risk in the design is that a player reads a
    // forty-second response time as broken controls, gives up on forming a
    // theory, and starts hammering the actuators. This is the only line in the
    // game that heads that off, and it is a fact about the medium rather than
    // about anything the player did.
    text: () => 'the medium is slow to answer.',
    ready: (o, s) => o.firstAction && s.time >= o.firstAction.t + ANSWER_DELAY,
    fallback: null,
    anchor: (o) => ({ kind: 'dish', x: o.firstAction.x, y: o.firstAction.y }),
  },
  {
    id: 'probeCost',
    // Fires once the reveal has faded, so the line arrives with the scar still
    // on the plate rather than while the pretty part is still on screen.
    text: () => 'that disc will not grow back.',
    ready: (o, s) => o.firstProbe && s.time >= o.firstProbe.t + 6,
    fallback: null,
    anchor: (o) => ({ kind: 'dish', x: o.firstProbe.x, y: o.firstProbe.y }),
  },
  {
    id: 'probesExist',
    // Withholding is only a decision if the player knows what they are
    // declining. This states the price and says nothing about the value, so it
    // informs without recommending.
    text: () => 'the instruments cost tissue.',
    ready: (o, s) => o.actionCount > 0 && o.probeCount === 0 && s.time > 200,
    fallback: null,
    anchor: () => ({ kind: 'cursor' }),
  },
  {
    id: 'inversion',
    // The hard one. Some ground metabolises enrichment backwards, and no amount
    // of staring at the stencil can tell you which. The line reports only the
    // measurement that was actually taken — the mass in the tile the player fed
    // is lower than when they started feeding it — so it cannot be wrong, and
    // it does not say why, where the region ends, or what to do instead.
    text: (o) => o.inversionText,
    ready: (o) => !!o.inversionText,
    fallback: null,
    anchor: (o) => ({ kind: 'dish', x: o.inversionAt.x, y: o.inversionAt.y }),
  },
];

export class Onboarding {
  constructor({ enabled = true } = {}) {
    this.enabled = enabled;
    /** @type {(p: {text:string, anchor:object, ttl:number}) => void} */
    this.onPrompt = () => {};
    this.begin(null);
  }

  setEnabled(on) { this.enabled = !!on; }

  /** Bind to a fresh dish. Safe to call with null. */
  begin(session) {
    this.session = session;
    this.fired = new Set();
    this.logSeen = 0;
    this.actionCount = 0;
    this.probeCount = 0;
    this.firstAction = null;
    this.firstProbe = null;
    this.watches = [];
    this.inversionText = null;
    this.inversionAt = null;
    this._targetCentroid = null;   // a new dish is a new stencil
    this.cooldown = 0;
    this.orderedAt = 0;        // when the last ordered lesson resolved
    this.orderedIndex = 0;
  }

  /**
   * @param {number} dt seconds
   * @param {object} session the live session
   */
  update(dt, session) {
    if (!this.enabled || !session || session.state !== 'running') return;
    // A dish can be replaced without this module being told — the policy
    // harness does exactly that. Rebinding on identity rather than trusting the
    // caller means a stale log cursor can never silently swallow every lesson.
    if (session !== this.session) this.begin(session);
    this.cooldown = Math.max(0, this.cooldown - dt);

    this._readLog(session);
    this._checkWatches(session);

    // Ordered lessons gate on each other so the opening cannot arrive as a
    // stack of three lines the player scrolls past.
    for (let i = 0; i < LESSONS.length; i++) {
      const lesson = LESSONS[i];
      if (this.fired.has(lesson.id)) continue;
      if (lesson.ordered) {
        if (this._orderedBlockedBy(lesson)) continue;
        if (lesson.skip && lesson.skip(this, session)) { this._resolve(lesson, session); continue; }
      }
      const due = lesson.fallback != null &&
        session.time >= (lesson.relative ? this.orderedAt : 0) + lesson.fallback;
      if (!lesson.ready(this, session) && !due) continue;
      if (this.cooldown > 0) continue;

      const anchor = lesson.anchor(this, session);
      if (!anchor) continue;
      const text = lesson.text(this, session);
      if (!text) continue;

      this._resolve(lesson, session);
      this.cooldown = PROMPT_GAP;
      this.onPrompt({ text, anchor, ttl: PROMPT_TTL });
    }
  }

  _resolve(lesson, session) {
    this.fired.add(lesson.id);
    if (lesson.ordered) this.orderedAt = session.time;
  }

  /** True while an earlier ordered lesson is still outstanding. */
  _orderedBlockedBy(lesson) {
    for (const other of LESSONS) {
      if (other === lesson) return false;
      if (other.ordered && !this.fired.has(other.id)) return true;
    }
    return false;
  }

  // ------------------------------------------------------- reading the run

  /**
   * Consume new intervention records.
   *
   * The session already logs one entry per second of continuous actuator use
   * and one per probe, which is exactly the resolution this needs — watching
   * the input device directly would mean duplicating the throttle and would
   * couple onboarding to main.js.
   */
  _readLog(session) {
    const log = session.log;
    for (; this.logSeen < log.length; this.logSeen++) {
      const e = log[this.logSeen];
      if (e.kind === 'fluoresce' || e.kind === 'aspirate') {
        this.probeCount++;
        if (!this.firstProbe) this.firstProbe = e;
        continue;
      }
      this.actionCount++;
      if (!this.firstAction) this.firstAction = e;
      if (e.kind === 'nutrient' || e.kind === 'shade') this._watch(e, session);
    }
  }

  /**
   * Remember what the ground was doing when the player started working it, so
   * that forty seconds later there is something to compare against.
   */
  _watch(e, session) {
    for (const w of this.watches) {
      if (w.tool === e.kind && Math.hypot(w.x - e.x, w.y - e.y) < 0.12) { w.hits++; return; }
    }
    if (this.watches.length >= 6) return;
    this.watches.push({
      tool: e.kind, x: e.x, y: e.y, t0: e.t, hits: 1,
      m0: this.massAt(e.x, e.y),
    });
  }

  _checkWatches(session) {
    if (this.inversionText) return;
    for (let i = this.watches.length - 1; i >= 0; i--) {
      const w = this.watches[i];
      if (session.time < w.t0 + ANSWER_DELAY) continue;
      this.watches.splice(i, 1);

      // Only judge ground that had something on it and was worked for long
      // enough that this is the player's doing rather than the dish's weather.
      if (w.hits < 5 || w.m0 < 0.015) continue;
      const m1 = this.massAt(w.x, w.y);

      if (w.tool === 'nutrient' && m1 < w.m0 * 0.80) {
        this.inversionText = 'it shrank where you fed it.';
        this.inversionAt = w;
      } else if (w.tool === 'shade' && m1 > w.m0 * 1.30) {
        this.inversionText = 'it grew where you starved it.';
        this.inversionAt = w;
      }
      if (this.inversionText) return;
    }
  }

  // ------------------------------------------------- reading the field free

  _stats() {
    const s = this.session;
    if (!s || !s.statsBuf) return null;
    return { buf: s.statsBuf, n: (s.medium && s.medium.statsSize) || 16 };
  }

  /** Mean mass across the dish, from the reduction the hum already pays for. */
  meanMass() {
    const st = this._stats();
    if (!st) return 0;
    let sum = 0;
    const count = st.n * st.n;
    for (let i = 0; i < count; i++) sum += st.buf[i * 4];
    return sum / count;
  }

  /** Mass in the tile at a dish position, averaged over its neighbours. */
  massAt(x, y) {
    const st = this._stats();
    if (!st) return 0;
    const n = st.n;
    const cx = Math.max(0, Math.min(n - 1, Math.floor(x * n)));
    const cy = Math.max(0, Math.min(n - 1, Math.floor(y * n)));
    let sum = 0, taken = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = cx + dx, ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
        sum += st.buf[(ty * n + tx) * 4];
        taken++;
      }
    }
    return taken ? sum / taken : 0;
  }

  /** Where the culture actually is, so a remark about it lands on it. */
  massCentroid() {
    const st = this._stats();
    if (!st) return { kind: 'dish', x: 0.5, y: 0.5 };
    const n = st.n;
    let sx = 0, sy = 0, w = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const m = st.buf[(y * n + x) * 4];
        sx += (x + 0.5) / n * m; sy += (y + 0.5) / n * m; w += m;
      }
    }
    if (w < 1e-5) return { kind: 'dish', x: 0.5, y: 0.5 };
    return { kind: 'dish', x: sx / w, y: sy / w };
  }

  /** Where the stencil is. Computed once per dish; the target never moves. */
  targetCentroid() {
    if (this._targetCentroid) return this._targetCentroid;
    const s = this.session;
    if (!s || !s.target) return { kind: 'dish', x: 0.5, y: 0.5 };
    const n = s.medium.size;
    let sx = 0, sy = 0, c = 0;
    for (let y = 0; y < n; y += 4) {
      for (let x = 0; x < n; x += 4) {
        if (s.target[y * n + x]) { sx += x; sy += y; c++; }
      }
    }
    this._targetCentroid = c
      ? { kind: 'dish', x: sx / c / n, y: sy / c / n }
      : { kind: 'dish', x: 0.5, y: 0.5 };
    return this._targetCentroid;
  }
}
