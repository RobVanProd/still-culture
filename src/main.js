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
import { Primer } from './ui/primer.js';
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
let briefEl = null;

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
  refreshBrief();
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

// The HUD draws its own read-only tool list, and the palette draws an
// interactive one. Two tool lists on a phone is what the first playtest saw.
// The interactive one wins; the HUD's is hidden rather than deleted, because it
// is the better display on a desktop and may come back behind a setting.
const dupTools = document.querySelector('.sc-tools');
if (dupTools) dupTools.style.display = 'none';

shell.begin?.();

// The opening card. Six lines: the goal, the controls, and the catch. Shown once
// per browser; `GAME.primer()` brings it back.
let primer = new Primer({ onDismiss: () => audio.start() });

// The brief, always on screen.
//
// Texture is half the assay and it is the half a player will not think to ask
// about, so it cannot live only in the results. One line, top-left, under the
// clock: what this dish is supposed to become.
// `let`, not `const`, and the refresh guards on it. newDish runs during
// bootstrap and calls refreshBrief, which is hoisted — a const here is in the
// temporal dead zone at that moment and throws. Second time this exact shape has
// bitten in this file.
briefEl = document.createElement('div');
briefEl.style.cssText = 'position:fixed;top:calc(34px + env(safe-area-inset-top,0px));left:12px;' +
  'z-index:15;pointer-events:none;font:400 11px/1.5 ui-monospace,Menlo,Consolas,monospace;' +
  'color:#8ea6c4;text-shadow:0 1px 3px rgba(0,0,0,.9);letter-spacing:.03em;';
document.body.appendChild(briefEl);
function refreshBrief() {
  if (!briefEl) return;
  const c = session?.character;
  // The texture brief was reverted; this line is left wired but silent so the
  // slot exists for whatever replaces it.
  briefEl.textContent = '';
}
refreshBrief();

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

  /** Re-show the opening card. */
  primer() {
    if (!primer || !primer.visible) primer = new Primer({ onDismiss: () => audio.start() });
    else primer.show();
    return true;
  },

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
