// STILL CULTURE — bootstrap.
//
// Phase 2: proving the core loop. The simulation and the rules are real; the
// presentation is deliberately thin, because the gate this build has to pass is
// whether the decision is interesting, not whether it is pretty.

import { createContext, resizeToDisplay } from './core/gl.js';
import { Loop } from './core/loop.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { Medium } from './sim/medium.js';
import { Strain } from './sim/strain.js';
import { DishRenderer } from './render/dish.js';
import { Hum } from './audio/hum.js';
import { Session, TOOL, TOOL_ORDER, TOOL_INFO } from './game/session.js';

const canvas = document.getElementById('gl');
const hudEl = document.getElementById('hud');
const gl = createContext(canvas);

const input = new Input(canvas);
const audio = new Audio();
const medium = new Medium(gl, 512);
const dish = new DishRenderer(gl);
const hum = new Hum(audio);

let strain = null;
let session = null;

function newDish(seedName = 'dish-001', regime = 'coral', duration = 600) {
  strain = new Strain(seedName, { size: medium.size, regime });
  strain.applyTo(medium);
  session = new Session({ medium, strain, hum, durationSeconds: duration });
  dish.setTarget(session.target, medium.size);
  loop.tick = 0;
  loop.simTime = 0;
  stepAccum = 0;
  return session;
}

const SUBSTEPS_PER_SECOND = 40;
let stepAccum = 0;

/** Convert a mouse position in clip space to dish uv. */
function mouseToDish() {
  // The dish is drawn as a centred square of the smaller screen dimension.
  const aspect = canvas.width / canvas.height;
  let mx = input.mouse.x, my = input.mouse.y;
  if (aspect > 1) mx *= aspect; else my /= aspect;
  return { x: mx * 0.5 + 0.5, y: my * 0.5 + 0.5, inside: Math.hypot(mx, my) <= 1.0 };
}

let lastDish = null;

function update(dt) {
  // --- tool selection ---------------------------------------------------
  for (let i = 0; i < TOOL_ORDER.length; i++) {
    if (input.wasPressed(`Digit${i + 1}`)) session.tool = TOOL_ORDER[i];
  }
  if (input.mouse.wheel !== 0) {
    session.brushRadius = Math.max(0.04, Math.min(0.24,
      session.brushRadius * (input.mouse.wheel > 0 ? 1.12 : 0.89)));
  }
  if (input.wasPressed('KeyR')) newDish('dish-' + Math.floor(Math.random() * 1e6), 'coral');

  // --- tool use ---------------------------------------------------------
  const p = mouseToDish();
  if (p.inside) {
    const isProbe = TOOL_INFO[session.tool].kind === 'probe';
    if (isProbe) {
      if (input.mouseWasPressed(0)) session.use(p.x, p.y, { held: false });
    } else if (input.mouseHeld(0)) {
      const dx = lastDish ? p.x - lastDish.x : 0;
      const dy = lastDish ? p.y - lastDish.y : 0;
      session.use(p.x, p.y, { dx: dx * 60, dy: dy * 60, held: true });
    }
  }
  lastDish = p;

  // --- chemistry --------------------------------------------------------
  stepAccum += dt * SUBSTEPS_PER_SECOND;
  const n = Math.floor(stepAccum);
  if (n > 0) {
    stepAccum -= n;
    medium.step(Math.min(n, 8));
  }
  medium.decayParams(dt);

  session.update(dt);
  input.endFrame();
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
  dish.draw(medium, { width: canvas.width, height: canvas.height, time: loop.simTime });
}

const loop = new Loop({ hz: 120, update, render });

newDish('dish-001', 'coral');

let hudTimer = 0;
const baseRender = loop.render;
loop.render = (alpha, frameMs) => {
  baseRender(alpha, frameMs);
  hudTimer += frameMs;
  if (hudTimer < 200) return;
  hudTimer = 0;
  const s = loop.perf.stats();
  const r = hum.readout();
  const mins = Math.floor(session.remaining / 60);
  const secs = Math.floor(session.remaining % 60).toString().padStart(2, '0');

  const tools = TOOL_ORDER.map(t => {
    const info = TOOL_INFO[t];
    const c = session.chargesOf(t);
    const mark = session.tool === t ? '>' : ' ';
    const charge = c === Infinity ? '' : ` x${c}`;
    return `${mark}${info.key} ${info.label}${charge}`;
  }).join('\n');

  hudEl.innerHTML =
    `<b>STILL CULTURE</b>  ${mins}:${secs}\n` +
    `${tools}\n` +
    `radius ${(session.brushRadius * 100).toFixed(0)}\n` +
    `\n` +
    `hum  beat ${r.beatHz.toFixed(2)}Hz  rough ${(r.interface * 3.2).toFixed(2)}\n` +
    `     commit ${r.commit.toFixed(3)}  scar ${r.scar.toFixed(4)}\n` +
    `\n` +
    `fps ${s.fps.toFixed(0)}  med ${s.median.toFixed(2)}  p99 ${s.p99.toFixed(2)}\n` +
    (session.state === 'assayed'
      ? `<span class="bad">ASSAY  shape ${session.result.shape.toFixed(3)}  viability ${session.result.viability.toFixed(3)}  wasted ${session.result.wasted}/${session.result.probes}</span>`
      : `R new dish   wheel resize   drag to act`);
};

globalThis.GAME = {
  loop, input, gl, canvas, medium, dish, hum, audio,
  get strain() { return strain; },
  get session() { return session; },
  newDish,
  stats: () => loop.perf.stats(),
  violations: () => loop.perf.violations(),

  seek(seconds) {
    const steps = Math.round(seconds / loop.stepSec) - loop.tick;
    if (steps > 0) loop.stepHeadless(steps);
    return loop.simTime;
  },

  hud(on) { hudEl.classList.toggle('hidden', !on); },

  async capture({ name = 'capture.png', width = 1200, height = 1200, at = null } = {}) {
    const wasRunning = loop.running;
    loop.stop();
    if (at !== null) this.seek(at);
    forcedSize = [width, height];
    loop.render(1, 16.7);
    gl.finish();
    const dataUrl = canvas.toDataURL('image/png');
    forcedSize = null;
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

loop.start();
console.log('[still-culture] running', { strain: strain.describe() });
