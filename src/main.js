// STILL CULTURE — bootstrap.
//
// Phase 2: proving the core loop. Placeholder presentation, real simulation.

import { createContext, resizeToDisplay } from './core/gl.js';
import { Loop } from './core/loop.js';
import { Input } from './core/input.js';
import { Medium } from './sim/medium.js';
import { Strain } from './sim/strain.js';
import { DishRenderer } from './render/dish.js';

const canvas = document.getElementById('gl');
const hudEl = document.getElementById('hud');
const gl = createContext(canvas);

const input = new Input(canvas);
const medium = new Medium(gl, 512);
const dish = new DishRenderer(gl);

let strain = null;

function newDish(seedName = 'dish-001', regime = 'coral') {
  strain = new Strain(seedName, { size: medium.size, regime });
  strain.applyTo(medium);
  loop.tick = 0;
  loop.simTime = 0;
}

// How fast the chemistry runs, in reaction substeps per second of real time.
//
// Decoupled from the tick rate on purpose. The simulation ticks at 120 Hz for
// input and interpolation reasons that have nothing to do with chemistry, and
// the reaction wants to be far slower than that: at 960 substeps a second the
// dish fills in about five seconds, which is a screensaver on fast-forward. At
// 40 it fills in roughly five minutes, which is a thing you can watch, form a
// theory about, and be wrong about in time to matter.
const SUBSTEPS_PER_SECOND = 40;
let stepAccum = 0;

function update(dt) {
  stepAccum += dt * SUBSTEPS_PER_SECOND;
  const n = Math.floor(stepAccum);
  if (n > 0) {
    stepAccum -= n;
    medium.step(Math.min(n, 8));
  }
  medium.decayParams();
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
  dish.draw(medium, { width: canvas.width, height: canvas.height, time: loop.simTime });
}

const loop = new Loop({ hz: 120, update, render });

let hudTimer = 0;
const baseRender = loop.render;
loop.render = (alpha, frameMs) => {
  baseRender(alpha, frameMs);
  hudTimer += frameMs;
  if (hudTimer < 250) return;
  hudTimer = 0;
  const s = loop.perf.stats();
  const v = loop.perf.violations();
  hudEl.innerHTML =
    `<b>STILL CULTURE</b>  phase 2 prototype\n` +
    `${canvas.width}x${canvas.height}  sim ${medium.size}^2\n` +
    `fps ${s.fps.toFixed(0)}  med ${s.median.toFixed(2)}ms  p95 ${s.p95.toFixed(2)}  p99 ${s.p99.toFixed(2)}\n` +
    `worst ${s.worst.toFixed(1)}ms  hitches ${s.hitches}\n` +
    `t ${loop.simTime.toFixed(1)}s\n` +
    (v.length ? `<span class="bad">BUDGET: ${v.join('; ')}</span>` : `budget ok`);
};

newDish('dish-001', 'coral');

globalThis.GAME = {
  loop, input, gl, canvas, medium, dish,
  get strain() { return strain; },
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

  /** Field statistics — the basis of the audio channel and of scoring. */
  measure() {
    const buf = medium.readState();
    let mass = 0, scar = 0, commit = 0, interfaces = 0, live = 0;
    const n = medium.size;
    for (let i = 0; i < n * n; i++) {
      const V = buf[i * 4 + 1];
      mass += V;
      scar += buf[i * 4 + 2];
      commit += buf[i * 4 + 3];
      if (V > 0.05) live++;
      interfaces += V * (1 - V);
    }
    const total = n * n;
    return {
      mass: mass / total,
      scar: scar / total,
      commit: commit / total,
      coverage: live / total,
      interface: (interfaces * 4) / total,
    };
  },

  ready: true,
};

loop.start();
console.log('[still-culture] prototype running', { strain: strain.describe() });
