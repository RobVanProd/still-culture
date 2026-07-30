// The session shell: title, play, pause, assay, next dish.
//
// Everything around the ten minutes lives here. The shell decides what state
// the game is in, builds the snapshot the display draws, and converts the
// onboarding's dish-space anchors into screen positions. It owns no DOM and no
// simulation; ui/hud.js draws what this describes, exactly as render/ draws
// what sim/ describes.
//
// Pause, and why it is done this way
// ----------------------------------
// Pausing sets `loop.paused`, which stops `update` being called at all. That
// freezes the fixed step, the session clock, the chemistry and the parameter
// decay together, in one place, so there is no arrangement of held keys or
// clicks that advances anything while the overlay is up. A pause implemented as
// a flag tested inside `update` would have to be tested by every future caller
// and would eventually be missed.
//
// Two consequences are deliberate:
//
//   - `loop.stepHeadless` bypasses `paused`, so `GAME.capture` and the policy
//     experiments still work from any shell state. The evidence pipeline is
//     what every claim in this repository rests on and the shell must not be
//     able to break it.
//   - While frozen, nothing calls `input.endFrame()`, so key and button edges
//     would latch and then all fire on the frame play resumes — a click on the
//     resume button would land in the dish as a probe. `frame()` flushes them
//     instead, which is why shell input is bound to its own listener rather
//     than read through Input.
//
// Interface
// ---------
//   const shell = new Shell({ hud, loop, input, canvas, audio, newDish,
//                             getSession, onboarding, seedName, duration });
//   shell.frame(frameMs)     // every rendered frame, from loop.render
//   shell.updatePlaying(dt)  // from the fixed step, after session.update(dt)
//   shell.begin() / pause() / resume() / togglePause() / restart() / nextDish()
//   shell.state              // 'title' | 'playing' | 'paused' | 'assay'

import { clamp01, approach } from '../core/math.js';
import { TOOL_ORDER, TOOL_INFO , THRESHOLDS } from './session.js';

export const SHELL_STATE = {
  TITLE: 'title',
  PLAYING: 'playing',
  PAUSED: 'paused',
  ASSAY: 'assay',
};

const ACTUATORS = new Set(['nutrient', 'shade', 'thermal', 'shear', 'seed']);

/** Seconds to m:ss. */
function mmss(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

/**
 * One plain sentence about how the dish went.
 *
 * This is where restraint is finally taught. During a run, withholding and
 * being lost look identical and no prompt can honestly separate them; here they
 * can be separated, because the log knows which probes were followed by a
 * change of plan and which were not. The ordering below is a priority list —
 * the worst thing that happened is the thing worth saying.
 */
export function readAssay(result) {
  const { shape, probes, wasted, coverage, passedShape, passedViability,
          passedCharacter, characterRatio, characterWanted, characterName } = result;
  const acted = result.log.some(e => ACTUATORS.has(e.kind));

  if (!acted) return 'You did not touch it. The dish did what it was going to do.';
  if (probes > 0 && wasted === probes) {
    return 'Every probe you took changed nothing you did afterwards.';
  }
  if (!passedViability) {
    return probes >= 3
      ? 'You found out, and there was not enough dish left for it to be worth knowing.'
      : 'There is more damage on the plate than the shape is worth.';
  }
  if (passedShape) {
    if (probes === 0) return 'You never looked, and you did not need to.';
    if (wasted === 0) return 'Every question you asked changed what you did next.';
    return `${wasted} of ${probes} probes bought nothing, and the dish survived it anyway.`;
  }
  if (coverage < 0.06) return 'Intact and nearly empty. Restraint is not the same as absence.';
  if (shape >= 0.20) return 'Close. The culture settled just outside the outline.';
  return 'The culture went somewhere other than the outline.';
}

/**
 * The quiet detail under the scores: what was asked of the dish, and when.
 *
 * Not the scrubbable after-action trace the design eventually wants — that is a
 * larger thing — but the part of it that carries the lesson, which is the count
 * of questions that bought nothing.
 */
export function describeRun(result) {
  const counts = new Map();
  const probeTimes = [];
  for (const e of result.log) {
    if (e.kind === 'fluoresce' || e.kind === 'aspirate') { probeTimes.push(mmss(e.t)); continue; }
    counts.set(e.kind, (counts.get(e.kind) || 0) + 1);
  }
  // Actuator entries are logged once per second of continuous use, so these
  // read as seconds spent rather than as clicks.
  const worked = TOOL_ORDER
    .filter(t => counts.has(t))
    .map(t => `${TOOL_INFO[t].label} ${counts.get(t)}s`)
    .join('  ');

  // Wording matters more than it looks. The first version read
  // "waste 0 of 4 changed no later action", which a player reasonably parsed as
  // "0 of 4" being the score for something, and could not tell whether 0 was
  // good. Each line now says what happened in a sentence that survives being
  // read once, at a glance, by someone who has just finished a ten-minute dish.
  const used = result.probes;
  const wasted = result.wasted;
  const wasteLine = used === 0
    ? 'you never used an instrument'
    : wasted === 0
      ? `all ${used} reading${used === 1 ? '' : 's'} changed what you did next`
      : wasted === used
        ? (used === 1
            ? 'your one reading changed nothing you did next'
            : `none of your ${used} readings changed what you did next`)
        : `${wasted} of ${used} readings changed nothing you did afterwards`;

  return [
    `spent on   ${worked || 'nothing — the dish was left alone'}`,
    `looked at  ${probeTimes.length ? probeTimes.join('  ') : 'never'}`,
    `verdict    ${wasteLine}`,
  ];
}

export class Shell {
  constructor({
    hud, loop, input, canvas, audio = null,
    newDish, getSession, onboarding = null,
    seedName = 'dish-001', regime = 'coral', duration = 600,
  }) {
    this.hud = hud;
    this.loop = loop;
    this.input = input;
    this.canvas = canvas;
    this.audio = audio;
    this.newDish = newDish;
    this.getSession = getSession;
    this.onboarding = onboarding;

    this.regime = regime;
    this.duration = duration;
    this.seedName = seedName;
    this.dishIndex = 1;

    this.state = SHELL_STATE.TITLE;

    // The trace's statistics are smoothed here rather than taken from the hum.
    //
    // The hum only accumulates once the browser has granted an audio context,
    // so a trace driven by it is blank for a player with the sound off — which
    // is the exact player the visual channel exists for. Same field reduction,
    // same time constants, no dependency on audio being alive.
    this._trace = { mass: 0, iface: 0, scar: 0, split: 0, centroidY: 0.5 };

    this._toolHint = null;
    this._toolHintFor = null;
    this._toolHintLeft = 0;

    // Snapshotted from the session rather than written down again here. The
    // probe budget is a design number that belongs to the rules; a copy of it
    // in the display is a copy that will eventually disagree.
    this._maxCharges = {};
    this._snapshotCharges();

    /** Field statistics as figures. Off, and not on a key.
     *
     *  The frame-timing panel is a developer tool and belongs behind a toggle.
     *  Beat frequency and interface roughness as numbers are something else:
     *  a channel that is both free and precise, which pillar 1 forbids. Leaving
     *  it one keypress from the player would put the cheat in the game. It stays
     *  reachable from the console for development, where `GAME.hum.readout()`
     *  already gives the same figures. */
    this.devFieldReadout = false;

    this.hud.onAction = (name) => this._action(name);
    this._onKey = (e) => this._key(e);
    addEventListener('keydown', this._onKey);

    if (this.onboarding) {
      this.onboarding.onPrompt = (p) => this._prompt(p);
      this.onboarding.setEnabled(true);
      this.onboarding.begin(this.getSession());
    }

    this._enter(SHELL_STATE.TITLE);
  }

  // ------------------------------------------------------------- transitions

  _enter(state) {
    this.state = state;
    // One place decides whether time passes, so there is no second path that
    // could let it pass while an overlay is up.
    this.loop.paused = state !== SHELL_STATE.PLAYING;
    // The title is the wordmark and the dish, nothing else. A clock and a tool
    // list under it would be furniture for a run that has not started.
    this.hud.setVisible(state !== SHELL_STATE.TITLE);

    if (state === SHELL_STATE.PLAYING) { this.hud.setOverlay(null); return; }
    this.hud.setOverlay(this._overlayFor(state));
  }

  _snapshotCharges() {
    const session = this.getSession();
    this._maxCharges = session ? { ...session.charges } : {};
  }

  begin() {
    if (this.state !== SHELL_STATE.TITLE) return;
    // The click that dismisses the title is also the gesture the browser
    // requires before it will start an audio context, which is why the title
    // exists at all: the hum has to be present from the first frame of the run,
    // and it cannot be until the player has touched something.
    if (this.audio) this.audio.start();
    this._enter(SHELL_STATE.PLAYING);
  }

  pause() {
    if (this.state !== SHELL_STATE.PLAYING) return;
    this._enter(SHELL_STATE.PAUSED);
  }

  resume() {
    if (this.state !== SHELL_STATE.PAUSED) return;
    this._enter(SHELL_STATE.PLAYING);
  }

  togglePause() {
    if (this.state === SHELL_STATE.PLAYING) this.pause();
    else if (this.state === SHELL_STATE.PAUSED) this.resume();
  }

  /** The same dish again. Only reachable from pause or the assay, so a run
   *  cannot be thrown away by brushing a key. */
  restart() {
    if (this.state === SHELL_STATE.TITLE) return;
    this._start(this.seedName, this.dishIndex);
  }

  /** A fresh dish, named in sequence so it can be shared and grown again. */
  nextDish() {
    const index = this.dishIndex + 1;
    this._start(`dish-${String(index).padStart(3, '0')}`, index);
  }

  _start(seedName, dishIndex) {
    this.seedName = seedName;
    this.dishIndex = dishIndex;
    this.hud.clearPrompts();
    this.newDish(seedName, this.regime, this.duration);
    this._snapshotCharges();
    this._toolHintFor = null;
    if (this.onboarding) {
      // Only the first dish teaches. By the second the player has the verbs and
      // a prompt would be noise over a decision they are already making.
      this.onboarding.setEnabled(dishIndex === 1);
      this.onboarding.begin(this.getSession());
    }
    this._trace = { mass: 0, iface: 0, scar: 0, split: 0, centroidY: 0.5 };
    this._enter(SHELL_STATE.PLAYING);
  }

  // ------------------------------------------------------------------ input

  _action(name) {
    if (name === 'begin') this.begin();
    else if (name === 'resume') this.resume();
    else if (name === 'restart') this.restart();
    else if (name === 'next') this.nextDish();
  }

  _key(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Backquote' || e.code === 'F1') {
      this.hud.setDiagnostics(!this.hud.diagnostics);
      return;
    }
    switch (this.state) {
      case SHELL_STATE.TITLE:
        this.begin();
        break;
      case SHELL_STATE.PLAYING:
        if (e.code === 'Escape' || e.code === 'KeyP') this.pause();
        break;
      case SHELL_STATE.PAUSED:
        if (e.code === 'Escape' || e.code === 'KeyP') this.resume();
        else if (e.code === 'KeyR') this.restart();
        break;
      case SHELL_STATE.ASSAY:
        if (e.code === 'KeyR') this.restart();
        else if (e.code === 'KeyN' || e.code === 'Enter' || e.code === 'Space') this.nextDish();
        break;
    }
  }

  // ------------------------------------------------------------------ frames

  /**
   * Called from the fixed step, after the session has been updated.
   * @param {number} dt seconds
   */
  updatePlaying(dt) {
    const session = this.getSession();
    if (!session) return;
    if (this.state !== SHELL_STATE.PLAYING) return;

    if (this.onboarding) this.onboarding.update(dt, session);

    // The session assays itself when the clock runs out; the shell notices on
    // the same step rather than polling a timer of its own.
    if (session.state === 'assayed') {
      this.hud.clearPrompts();
      this._enter(SHELL_STATE.ASSAY);
    }
  }

  /**
   * Called every rendered frame, including while frozen.
   * @param {number} frameMs
   */
  frame(frameMs) {
    const session = this.getSession();
    const running = this.state === SHELL_STATE.PLAYING;
    // Presentation time, not simulation time. Zero while frozen, so fades and
    // the trace hold rather than running on under a pause.
    const dt = running ? Math.min(frameMs, 100) / 1000 : 0;

    // Nothing consumed the input this frame because `update` never ran. Flush
    // the latched edges so they do not all arrive at once on resume.
    if (this.loop.paused && this.input) this.input.endFrame();

    if (session) {
      this._updateTrace(session, dt);
      this._updateToolHint(session, dt);
    }
    this.hud.update(this._model(session, dt));
  }

  _model(session, dt) {
    const tools = TOOL_ORDER.map(t => {
      const info = TOOL_INFO[t];
      const charges = session ? session.chargesOf(t) : Infinity;
      return {
        key: info.key,
        label: info.label,
        kind: info.kind,
        selected: !!session && session.tool === t,
        charges,
        maxCharges: this._maxCharges[t] ?? Infinity,
      };
    });

    const tr = this._trace;
    return {
      dt,
      clock: {
        remaining: session ? session.remaining : this.duration,
        duration: this.duration,
      },
      tools,
      toolHint: this._toolHintLeft > 0 ? this._toolHint : null,
      trace: {
        // The same mapping and the same ceiling the hum uses, so the two
        // channels agree about what is happening without either being precise.
        beatHz: Math.min(7, Math.max(0, tr.split * 9)),
        rough: clamp01(tr.iface * 3.2),
        scar: tr.scar,
        presence: clamp01(tr.mass * 6),
        register: tr.centroidY,
      },
      diagnostics: this.hud.diagnostics ? this._diagnostics(session) : null,
    };
  }

  /**
   * The visual twin of the hum, from the same 16x16 reduction the audio uses.
   *
   * Deliberately the same four quantities and the same time constants, so the
   * two channels are equally ambiguous. This is not a readout of what the hum
   * would have said — nothing here is a number and nothing here is decisive —
   * it is the same evidence offered to a different sense.
   */
  _updateTrace(session, dt) {
    const buf = session.statsBuf;
    if (!buf || dt <= 0) return;
    const n = (session.medium && session.medium.statsSize) || 16;

    let mass = 0, iface = 0, scar = 0, wy = 0, wsum = 0;
    let left = 0, ln = 0, right = 0, rn = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        const m = buf[i], f = buf[i + 1];
        mass += m; iface += f; scar += buf[i + 3];
        wy += (y / (n - 1)) * m; wsum += m;
        if (x < n / 2) { left += f; ln++; } else { right += f; rn++; }
      }
    }
    const count = n * n;
    const lAvg = ln ? left / ln : 0, rAvg = rn ? right / rn : 0;
    const split = Math.abs(lAvg - rAvg) / Math.max(lAvg + rAvg, 1e-5);

    const t = this._trace;
    t.mass = approach(t.mass, mass / count, 3.5, dt);
    t.iface = approach(t.iface, iface / count, 3.5, dt);
    t.scar = approach(t.scar, scar / count, 1.2, dt);
    t.split = approach(t.split, split, 1.2, dt);
    t.centroidY = approach(t.centroidY, wsum > 1e-6 ? wy / wsum : 0.5, 3.5, dt);
  }

  /**
   * A line about the selected control, for a few seconds after it is selected.
   *
   * This is a legend for the instrument, not information about the dish, so it
   * stays available on every dish rather than expiring with the onboarding. The
   * general rule it states is the one the hidden variant can invert, which is
   * the point: the player is told what the control does, and the dish is under
   * no obligation to agree.
   */
  _updateToolHint(session, dt) {
    if (session.tool !== this._toolHintFor) {
      this._toolHintFor = session.tool;
      this._toolHint = TOOL_INFO[session.tool] ? TOOL_INFO[session.tool].hint : null;
      this._toolHintLeft = 3.5;
      return;
    }
    this._toolHintLeft = Math.max(0, this._toolHintLeft - dt);
  }

  _diagnostics(session) {
    const s = this.loop.perf.stats();
    const lines = [
      `${s.fps.toFixed(0)} fps`,
      `med ${s.median.toFixed(2)}  p95 ${s.p95.toFixed(2)}`,
      `p99 ${s.p99.toFixed(2)}  worst ${s.worst.toFixed(2)}`,
      `hitches ${s.hitches}  frames ${s.frames}`,
      `tick ${this.loop.tick}  sim ${this.loop.simTime.toFixed(1)}s`,
      `${this.seedName}  dish ${this.dishIndex}  ${this.state}`,
    ];
    const violations = this.loop.perf.violations();
    if (violations.length) lines.push('', ...violations);
    if (this.devFieldReadout && session) {
      const t = this._trace;
      lines.push('', `mass ${t.mass.toFixed(4)}  iface ${t.iface.toFixed(4)}`,
        `split ${t.split.toFixed(4)}  scar ${t.scar.toFixed(5)}`);
    }
    return lines;
  }

  // ------------------------------------------------------------- the prompts

  _prompt({ text, anchor, ttl }) {
    const p = this._anchorToScreen(anchor);
    this.hud.showPrompt({ text, x: p.x, y: p.y, ttl });
  }

  /**
   * Dish space to screen.
   *
   * Two mappings, because the game has two and they do not agree on a canvas
   * that is not square. Cursor anchors go through the input's own clip-space
   * position, so a remark about what the player just did lands under their
   * hand. Dish anchors go through the mapping the dish shader uses — uv across
   * the whole viewport, v measured from the bottom — so a remark about the
   * culture lands on the culture as drawn.
   */
  _anchorToScreen(anchor) {
    const rect = this.canvas.getBoundingClientRect();
    if (!anchor || anchor.kind === 'cursor') {
      const mx = this.input ? this.input.mouse.x : 0;
      const my = this.input ? this.input.mouse.y : 0;
      return {
        x: rect.left + (mx * 0.5 + 0.5) * rect.width,
        y: rect.top + (0.5 - my * 0.5) * rect.height,
      };
    }
    return {
      x: rect.left + clamp01(anchor.x) * rect.width,
      y: rect.top + (1 - clamp01(anchor.y)) * rect.height,
    };
  }

  // ------------------------------------------------------------- the screens

  _overlayFor(state) {
    if (state === SHELL_STATE.TITLE) {
      return {
        kind: 'title',
        title: 'STILL CULTURE',
        subtitle: 'every instrument that tells you what it is doing also damages it',
        actions: [{ name: 'begin', key: 'click', label: 'begin' }],
      };
    }
    if (state === SHELL_STATE.PAUSED) {
      return {
        kind: 'paused',
        title: 'HELD',
        // Said plainly because it is the thing a player needs to trust: the
        // pause is not costing them and cannot be used to buy time either.
        subtitle: 'the clock is stopped. so is the dish.',
        actions: [
          { name: 'resume', key: 'esc', label: 'carry on' },
          { name: 'restart', key: 'r', label: 'this dish again' },
        ],
      };
    }
    return this._assayOverlay();
  }

  _assayOverlay() {
    const session = this.getSession();
    const result = session && session.result;
    if (!result) {
      return { kind: 'assay', title: 'ASSAY', reading: 'No result.',
        actions: [{ name: 'next', key: 'n', label: 'next dish' }] };
    }
    return {
      kind: 'assay',
      title: result.passed ? 'ASSAY  ·  ACCEPTED' : 'ASSAY  ·  NOT ACCEPTED',
      subtitle: `${this.seedName}  ·  ${mmss(this.duration)}`,
      rows: [
        // Thresholds come from session.js so the notch and the rule cannot
        // disagree.
        //
        // Scaled to 0.40 rather than to 1. Intersection over union on a culture
        // grown with these actuators does not reach anywhere near 1, and a bar
        // that is always a quarter full tells the player they failed when they
        // did not.
        { label: 'shape', value: result.shape, threshold: THRESHOLDS.shape, pass: result.passedShape, scale: 0.40 },
        { label: 'viability', value: result.viability, threshold: THRESHOLDS.viability, pass: result.passedViability, scale: 1.0 },
      ],
      notes: describeRun(result),
      reading: readAssay(result),
      actions: [
        { name: 'next', key: 'n', label: 'next dish' },
        { name: 'restart', key: 'r', label: 'this dish again' },
      ],
    };
  }

  destroy() {
    removeEventListener('keydown', this._onKey);
    this.loop.paused = false;
  }
}
