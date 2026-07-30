// Bootstrap.
//
// Phase 0 placeholder: this exists to prove the whole pipeline end to end —
// context creation, shader compilation, the fixed-timestep loop, input, frame
// timing, and the on-screen diagnostics an agent needs in order to verify the
// game from a screenshot. It draws nothing that will survive into the game.

import { createContext, createProgram, createFullscreenVao, resizeToDisplay, FULLSCREEN_VS } from './core/gl.js';
import { Loop } from './core/loop.js';
import { Input } from './core/input.js';
import { Rng, seedFrom } from './core/rng.js';

const canvas = document.getElementById('gl');
const hudEl = document.getElementById('hud');
const gl = createContext(canvas);

const input = new Input(canvas);
const rng = new Rng(seedFrom('phase-0-baseline'));

// A deliberately simple shader: enough to confirm the fragment stage runs, that
// uniforms arrive, and that time is advancing, and nothing more.
const shader = createProgram(gl, FULLSCREEN_VS, `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2  uRes;
uniform float uTime;
uniform vec2  uPoint;
out vec4 frag;

void main() {
  vec2 uv = vUv;
  vec2 p = (uv * 2.0 - 1.0) * vec2(uRes.x / uRes.y, 1.0);

  // Slow field, so a screenshot taken at a known sim time is reproducible.
  float d = length(p - uPoint);
  float ring = smoothstep(0.012, 0.0, abs(d - 0.35 - 0.05 * sin(uTime * 0.7)));
  float glow = 0.06 / (d * d + 0.05);

  vec3 col = vec3(0.02, 0.03, 0.05);
  col += vec3(0.25, 0.55, 0.95) * glow * 0.35;
  col += vec3(0.55, 0.85, 1.00) * ring;

  // Grid, to make resolution and aspect obvious at a glance in a screenshot.
  vec2 g = abs(fract(p * 4.0) - 0.5);
  col += vec3(0.06, 0.08, 0.12) * smoothstep(0.48, 0.5, max(g.x, g.y));

  frag = vec4(pow(col, vec3(0.4545)), 1.0);
}`, 'phase0');

const vao = createFullscreenVao(gl);

const state = {
  point: { x: 0, y: 0 },
  target: { x: 0, y: 0 },
};

function update(dt) {
  // Mouse steers a lagged point, which is enough to confirm input latency is
  // sane by eye and in a capture.
  state.target.x = input.mouse.x * 1.2;
  state.target.y = input.mouse.y * 1.2;
  const k = 1 - Math.exp(-6 * dt);
  state.point.x += (state.target.x - state.point.x) * k;
  state.point.y += (state.target.y - state.point.y) * k;
  input.endFrame();
}

/** When set, render() uses this size instead of the element's. Capture only. */
let forcedSize = null;

function render() {
  if (forcedSize) {
    if (canvas.width !== forcedSize[0] || canvas.height !== forcedSize[1]) {
      canvas.width = forcedSize[0];
      canvas.height = forcedSize[1];
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  } else {
    resizeToDisplay(gl, canvas);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(shader.program);
  gl.uniform2f(shader.uniforms.uRes, canvas.width, canvas.height);
  gl.uniform1f(shader.uniforms.uTime, loop.simTime);
  gl.uniform2f(shader.uniforms.uPoint, state.point.x, state.point.y);
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

const loop = new Loop({ hz: 120, update, render });

// ---------------------------------------------------------------------------
// Diagnostics
//
// Exposed on window so the harness driving the browser can read real numbers
// instead of trying to infer them from a picture.
// ---------------------------------------------------------------------------
let hudTimer = 0;
const origRender = loop.render;
loop.render = (alpha, frameMs) => {
  origRender(alpha, frameMs);
  hudTimer += frameMs;
  if (hudTimer < 250) return;
  hudTimer = 0;
  const s = loop.perf.stats();
  const v = loop.perf.violations();
  hudEl.innerHTML =
    `<b>novel-game</b>  phase 0 harness\n` +
    `${canvas.width}x${canvas.height}  dpr ${Math.min(devicePixelRatio || 1, 2).toFixed(2)}\n` +
    `fps ${s.fps.toFixed(0)}   med ${s.median.toFixed(2)}ms  p95 ${s.p95.toFixed(2)}  p99 ${s.p99.toFixed(2)}\n` +
    `worst ${s.worst.toFixed(1)}ms  hitches ${s.hitches}  frames ${s.frames}\n` +
    `sim ${loop.simTime.toFixed(2)}s  tick ${loop.tick}\n` +
    (v.length ? `<span class="bad">BUDGET: ${v.join('; ')}</span>` : `budget ok`);
};

globalThis.GAME = {
  loop, input, gl, canvas, rng,
  stats: () => loop.perf.stats(),
  violations: () => loop.perf.violations(),
  /** Run the sim to an exact time with no rendering — the basis of a
   *  deterministic capture. */
  seek(seconds) {
    const steps = Math.round(seconds / loop.stepSec) - loop.tick;
    if (steps > 0) loop.stepHeadless(steps);
    return loop.simTime;
  },
  hud(on) { hudEl.classList.toggle('hidden', !on); },

  /**
   * Deterministic screenshot, written to evidence/ on the server.
   *
   * This is the project's eyes. The page is usually not composited while it is
   * being developed, so requestAnimationFrame does not run and a normal
   * screenshot is impossible — but an explicit render into a preserved drawing
   * buffer works regardless, and the result can be posted back to disk and read
   * as a file. Every visual claim in this repository is checked this way.
   *
   * Deterministic because the simulation is seeked to an exact time by whole
   * fixed steps: the same name and time always produce the same image, so two
   * captures can be compared byte for byte to detect a regression.
   */
  async capture({ name = 'capture.png', width = 1600, height = 900, at = null } = {}) {
    const wasRunning = loop.running;
    loop.stop();
    if (at !== null) this.seek(at);

    forcedSize = [width, height];
    loop.render(1, 16.7);
    // The draw is queued, not done. Force completion before reading back, or the
    // capture races the GPU and returns the previous frame.
    gl.finish();

    const dataUrl = canvas.toDataURL('image/png');
    forcedSize = null;

    const res = await fetch(`/__evidence/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: dataUrl,
    });
    const out = await res.json();
    if (wasRunning) loop.start();
    return out;
  },

  ready: true,
};

loop.start();
console.log('[novel-game] phase 0 harness running', {
  renderer: gl.getParameter(gl.RENDERER),
  vendor: gl.getParameter(gl.VENDOR),
  glsl: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
});
