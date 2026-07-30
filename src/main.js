// STILL CULTURE — bootstrap.
//
// Wiring only. Every system this assembles is testable without it, which is the
// point: main.js is the one file with no unit tests, so it must contain no
// decisions worth testing.
//
// The one thing it does own is the mapping from a pointer position to a place in
// the dish, because that mapping has to agree exactly with the inverse mapping
// in the dish shader. When they disagreed, the brush did not land where the
// cursor was and it looked like input lag.

import { createContext, resizeToDisplay } from './core/gl.js';
import { Loop } from './core/loop.js';
import { Input } from './core/input.js';
import { Pointer } from './core/pointer.js';
import { Audio } from './core/audio.js';
import { Medium } from './sim/medium.js';
import { Strain } from './sim/strain.js';
import { DishRenderer } from './render/dish.js';
import { Hum } from './audio/hum.js';
import { Cues } from './audio/cues.js';
import { Session, TOOL_ORDER, TOOL_INFO } from './game/session.js';
import { Shell } from './game/shell.js';
import { Onboarding } from './game/onboarding.js';
import { Hud } from './ui/hud.js';
import { ToolPalette } from './ui/toolpalette.js';
import { settings } from './game/settings.js';
import { Trace } from './game/trace.js';
import { attachRecorder } from './game/save.js';

const canvas = document.getElementById('gl');
const hudEl = document.getElementById('hud');
const gl = createContext(canvas);

const input = new Input(canvas);
const pointer = new Pointer(canvas);
const audio = new Audio();
const medium = new Medium(gl, 512);
const dish = new DishRenderer(gl);
const hum = new Hum(audio);
const cues = new Cues(audio);

let strain = null;
let session = null;
let shell = null;
let trace = null;
// Declared before newDish, which runs during bootstrap and refreshes it.
let palette = null;

function newDish(seedName = 'dish-001', regime = 'coral', duration = 600) {
  strain = new Strain(seedName, { size: medium.size, regime });
  strain.applyTo(medium);
  session = new Session({ medium, strain, hum, durationSeconds: duration });
  dish.setTarget(session.target, medium.size);
  trace = new Trace({ session, seedName, regime, duration });
  loop.tick = 0;
  loop.simTime = 0;
  stepAccum = 0;
  palette?.refresh();
  return session;
}

const SUBSTEPS_PER_SECOND = 40;
let stepAccum = 0;

/**
 * Pointer position to dish coordinates.
 *
 * The dish is a circle of the smaller screen dimension, centred. This is the
 * exact inverse of the mapping in dish.js; if the two ever drift apart the brush
 * stops landing under the cursor, which reads as latency rather than as a bug.
 */
function pointerToDish() {
  const aspect = canvas.width / canvas.height;
  const sx = Math.max(aspect, 1);
  const sy = 1 / Math.min(aspect, 1);
  const px = pointer.x * sx;
  const py = pointer.y * sy;
  return { x: px * 0.5 + 0.5, y: py * 0.5 + 0.5, r: Math.hypot(px, py) };
}

let lastDish = null;

function update(dt) {
  pointer.update(dt);

  // Keyboard tool selection stays for desktop; the palette covers touch.
  for (let i = 0; i < TOOL_ORDER.length; i++) {
    if (input.wasPressed(`Digit${i + 1}`)) {
      session.tool = TOOL_ORDER[i];
      cues.select?.(session.tool);
      palette?.refresh();
    }
  }

  // Brush size: wheel on desktop, pinch on touch. Both arrive as pinchDelta.
  if (pointer.pinchDelta !== 0) {
    const sens = settings.get('brushSensitivity') ?? 1;
    session.brushRadius = Math.max(0.04, Math.min(0.24,
      session.brushRadius * (1 + pointer.pinchDelta * 1.6 * sens)));
  }

  const p = pointerToDish();
  const inDish = p.r <= 1.0;

  if (inDish && !pointer.pinching) {
    const isProbe = TOOL_INFO[session.tool].kind === 'probe';
    if (isProbe) {
      if (pointer.pressed) {
        const r = session.use(p.x, p.y, { held: false });
        if (r?.ok) { cues.probe?.(session.tool); trace?.mark?.('probe', p); }
      }
    } else if (pointer.down) {
      const dx = lastDish ? p.x - lastDish.x : 0;
      const dy = lastDish ? p.y - lastDish.y : 0;
      const r = session.use(p.x, p.y, { dx: dx * 60, dy: dy * 60, held: true });
      if (r?.ok) cues.actuator?.(session.tool, dt);
    }
  }
  lastDish = p;

  stepAccum += dt * SUBSTEPS_PER_SECOND;
  const n = Math.floor(stepAccum);
  if (n > 0) {
    stepAccum -= n;
    medium.step(Math.min(n, 8));
  }
  medium.decayParams(dt);

  session.update(dt);
  if (shell) shell.updatePlaying(dt);

  input.endFrame();
  pointer.endFrame();
}

let forcedSize = null;

function render() {
  if (forcedSize) {
    if (canvas.width !== forcedSize[0] || canvas.height !== forcedSize[1]) {
      canvas.width = forcedSize[0];
      canvas.height = forcedSize[1];
    }
  } else {
    resizeToDisplay(gl, canvas);
  }
  dish.reveal = session.reveal.active;
  dish.revealAt = [session.reveal.x, session.reveal.y];
  dish.revealRadius = session.reveal.radius;
  dish.cursor = lastDish ? [lastDish.x, lastDish.y, session.brushRadius] : null;
  dish.draw(medium, { width: canvas.width, height: canvas.height, time: loop.simTime });
}

const loop = new Loop({ hz: 120, update, render });

newDish('dish-001', 'coral');

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------
const hudView = new Hud({ mount: document.body, legacy: hudEl });
const onboarding = new Onboarding();
palette = new ToolPalette({
  getSession: () => session,
  onSelect: (tool) => cues.select?.(tool),
});

shell = new Shell({
  hud: hudView, loop, input, canvas, audio,
  newDish, getSession: () => session, onboarding,
  seedName: 'dish-001', regime: 'coral', duration: 600,
});

const baseRender = loop.render;
loop.render = (alpha, frameMs) => {
  baseRender(alpha, frameMs);
  shell.frame(frameMs);
  palette.refresh();
};

shell.begin?.();

// ---------------------------------------------------------------------------
// Diagnostics — the evidence pipeline everything in this repo rests on.
//
// Deliberately independent of shell state. capture() and the policy harness use
// stepHeadless, which bypasses pause, so evidence can be gathered from the title
// screen, mid-run or after the assay without the shell having to cooperate.
// ---------------------------------------------------------------------------
globalThis.GAME = {
  loop, input, pointer, gl, canvas, medium, dish, hum, cues, audio,
  hud: hudView, palette, settings,
  get strain() { return strain; },
  get session() { return session; },
  get shell() { return shell; },
  get trace() { return trace; },
  newDish,
  stats: () => loop.perf.stats(),
  violations: () => loop.perf.violations(),

  seek(seconds) {
    const steps = Math.round(seconds / loop.stepSec) - loop.tick;
    if (steps > 0) loop.stepHeadless(steps);
    return loop.simTime;
  },

  hud(on) { hudView.setVisible(on); },

  async capture({ name = 'capture.png', width = 1200, height = 1200, at = null, ui = false } = {}) {
    const wasRunning = loop.running;
    loop.stop();
    if (at !== null) this.seek(at);
    if (!ui) hudView.setVisible(false);
    forcedSize = [width, height];
    render();
    gl.finish();
    const dataUrl = canvas.toDataURL('image/png');
    forcedSize = null;
    if (!ui) hudView.setVisible(true);
    const res = await fetch(`/__evidence/${encodeURIComponent(name)}`, { method: 'POST', body: dataUrl });
    const out = await res.json();
    if (wasRunning) loop.start();
    return out;
  },

  measure() {
    const buf = medium.readState();
    let mass = 0, scar = 0, commit = 0, live = 0;
    const n = medium.size;
    for (let i = 0; i < n * n; i++) {
      const V = buf[i * 4 + 1];
      mass += V; scar += buf[i * 4 + 2]; commit += buf[i * 4 + 3];
      if (V > 0.05) live++;
    }
    const total = n * n;
    return { mass: mass / total, scar: scar / total, commit: commit / total, coverage: live / total };
  },

  ready: true,
};

// Record input for save and replay. Attached after GAME exists, because the
// recorder wraps loop.update and newDish through it — the save is a seed plus an
// input log rather than a snapshot of a 512x512 float field, which is only
// possible because the simulation is a pure function of (seed, tick, input).
attachRecorder(globalThis.GAME);

loop.start();
console.log('[still-culture] running', { strain: strain.describe() });
