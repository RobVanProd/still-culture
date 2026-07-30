// Dark-field render of the medium.
//
// Dark-field is the right microscopy metaphor and also the right art direction:
// the background is black, and what you see is light *scattered* by structure.
// That means edges glow and flat areas vanish, which is exactly the emphasis the
// game wants — the player cares about interfaces, fronts and boundaries, not
// about bulk concentration.
//
// Everything is computed from the state texture. There are no art assets, and
// the entire visual identity of the game is this shader plus the simulation
// feeding it.

import { createProgram, createFullscreenVao, FULLSCREEN_VS } from '../core/gl.js';

const FS = `#version 300 es
precision highp float;

uniform sampler2D uState;    // R=U G=V B=scar A=commit
uniform sampler2D uParams;   // R=F G=K B=thermal A=shear
uniform vec2  uTexel;
uniform vec2  uRes;
uniform float uTime;
uniform float uExposure;
uniform float uReveal;       // 0..1 fluorescence overlay strength
uniform vec2  uRevealAt;
uniform float uRevealRadius;
uniform sampler2D uTarget;   // R = wanted (0 or 1)
uniform float uTargetShow;

in vec2 vUv;
out vec4 frag;

// Screen-space derivative of V gives us the structure. Sampled explicitly rather
// than with dFdx so the look does not change with resolution.
vec3 gradV(vec2 uv) {
  float l = texture(uState, uv - vec2(uTexel.x, 0.0)).g;
  float r = texture(uState, uv + vec2(uTexel.x, 0.0)).g;
  float d = texture(uState, uv - vec2(0.0, uTexel.y)).g;
  float u = texture(uState, uv + vec2(0.0, uTexel.y)).g;
  return vec3((r - l), (u - d), 0.0) * 0.5;
}

void main() {
  vec2 uv = vUv;
  vec4 s = texture(uState, uv);
  float V = s.g, scar = s.b, commit = s.a;

  vec3 g = gradV(uv);
  float slope = length(g.xy);

  // The dish. A circular vignette that is part of the fiction rather than a
  // post-process: outside the rim there is glass, not game.
  vec2 p = (uv - 0.5) * 2.0;
  float r = length(p);
  float inDish = smoothstep(1.005, 0.985, r);

  // ---- dark-field scattering -------------------------------------------
  // Structure scatters light. The exponent controls how selective it is: too
  // low and the bulk glows into mush, too high and only razor edges survive.
  float scatter = pow(slope * 26.0, 1.35);

  // A raking light from the upper left, so the structure has a direction and
  // the dish reads as a physical object rather than a heat map.
  vec2 lightDir = normalize(vec2(-0.55, 0.83));
  float rake = dot(normalize(g.xy + vec2(1e-6)), lightDir) * 0.5 + 0.5;
  scatter *= mix(0.55, 1.45, rake);

  // ---- colour ------------------------------------------------------------
  // Thin-film iridescence: the hue shifts with local thickness, which is what
  // makes a biological film look wet rather than painted. Cheap, and it does
  // more for the image than any amount of extra simulation.
  float thickness = V * 2.2 + commit * 0.8;
  vec3 film = 0.5 + 0.5 * cos(6.2831853 * (thickness * vec3(0.98, 1.06, 1.16) + vec3(0.0, 0.12, 0.26)));

  vec3 col = vec3(0.0);
  col += film * scatter * 0.9;

  // A faint volume term so mass is visible where it is flat, otherwise a solid
  // lobe is invisible and the player cannot see what they have grown.
  col += vec3(0.05, 0.13, 0.18) * smoothstep(0.06, 0.5, V) * 0.55;

  // Commitment reads as a cooling and hardening of the colour. This is a free
  // channel and a deliberately quiet one: the player should be able to see that
  // a region has stopped listening, but only if they are looking for it.
  col = mix(col, col * vec3(0.72, 0.86, 1.12) + vec3(0.015, 0.02, 0.03) * commit, commit * 0.75);

  // Scar. Bleached and aspirated ground is dull, grey and slightly warm — it
  // reads as damage rather than as pattern, and it accumulates in plain sight.
  col = mix(col, vec3(0.15, 0.135, 0.125) * (0.35 + scatter * 0.5), min(scar * 1.25, 0.88));

  // ---- thermal actuator, shown as heat rather than as UI -----------------
  float thermal = texture(uParams, uv).b;
  if (thermal > 0.001) {
    float shimmer = sin(uv.y * 220.0 + uTime * 5.0) * sin(uv.x * 190.0 - uTime * 3.7);
    col += vec3(0.30, 0.10, 0.03) * thermal * (0.55 + 0.45 * shimmer) * 0.5;
  }

  // ---- fluorescence probe -------------------------------------------------
  // The probe is beautiful, which is the point: it should be tempting.
  if (uReveal > 0.001) {
    float d = length((uv - uRevealAt) * vec2(uRes.x / uRes.y, 1.0));
    float disc = smoothstep(uRevealRadius, uRevealRadius * 0.75, d);
    float edge = smoothstep(uRevealRadius, uRevealRadius * 0.95, d) -
                 smoothstep(uRevealRadius * 0.95, uRevealRadius * 0.86, d);
    vec3 fluoro = vec3(0.15, 1.0, 0.55) * pow(V, 0.6) * 2.4;
    col = mix(col, col * 0.25 + fluoro, disc * uReveal);
    col += vec3(0.2, 1.0, 0.6) * edge * uReveal * 0.8;
  }

  // ---- the target stencil -------------------------------------------------
  // Drawn as an engraved outline on the glass rather than as an overlay on the
  // culture. It is a mark on the dish the player is working toward, not a
  // heads-up display element, and it must never be mistaken for something the
  // medium is doing.
  if (uTargetShow > 0.001) {
    float tc = texture(uTarget, uv).r;
    float tl = texture(uTarget, uv - vec2(uTexel.x, 0.0) * 2.0).r;
    float tr = texture(uTarget, uv + vec2(uTexel.x, 0.0) * 2.0).r;
    float td = texture(uTarget, uv - vec2(0.0, uTexel.y) * 2.0).r;
    float tu = texture(uTarget, uv + vec2(0.0, uTexel.y) * 2.0).r;
    float edge = abs(tl - tr) + abs(td - tu);
    col += vec3(0.30, 0.40, 0.52) * edge * uTargetShow * 0.85;
    // A very faint fill, so the region reads as an area and not only a line.
    col += vec3(0.020, 0.030, 0.045) * tc * uTargetShow;
  }

  col *= inDish;

  // Glass beyond the rim.
  float glass = smoothstep(0.985, 1.02, r) * smoothstep(1.14, 1.03, r);
  col += vec3(0.05, 0.07, 0.10) * glass * 0.5;

  // ---- grade -------------------------------------------------------------
  col *= uExposure;
  // Reinhard-ish shoulder: the scatter term has a very long tail and will blow
  // out to white without one, losing exactly the structure it is drawing.
  col = col / (1.0 + col);
  col = pow(col, vec3(0.4545));

  // Slight cool lift in the blacks so the dish sits in a room rather than in a void.
  col += vec3(0.012, 0.016, 0.024) * inDish;

  frag = vec4(col, 1.0);
}`;

export class DishRenderer {
  constructor(gl) {
    this.gl = gl;
    this.program = createProgram(gl, FULLSCREEN_VS, FS, 'dish');
    this.vao = createFullscreenVao(gl);
    this.exposure = 1.0;
    this.reveal = 0;
    this.revealAt = [0.5, 0.5];
    this.revealRadius = 0.12;
    this.targetShow = 1.0;
    this.targetTex = null;
  }

  /** Upload the target stencil as a single-channel texture. */
  setTarget(mask, size) {
    const gl = this.gl;
    if (!this.targetTex) this.targetTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.targetTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, size, size, 0, gl.RED, gl.UNSIGNED_BYTE, mask);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  draw(medium, { width, height, time }) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    gl.useProgram(this.program.program);
    const u = this.program.uniforms;
    gl.uniform1i(u.uState, 0);
    gl.uniform1i(u.uParams, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, medium.stateTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, medium.paramTex);

    gl.uniform2f(u.uTexel, 1 / medium.size, 1 / medium.size);
    gl.uniform2f(u.uRes, width, height);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uExposure, this.exposure);
    gl.uniform1f(u.uReveal, this.reveal);
    gl.uniform2f(u.uRevealAt, this.revealAt[0], this.revealAt[1]);
    gl.uniform1f(u.uRevealRadius, this.revealRadius);

    gl.uniform1i(u.uTarget, 2);
    gl.uniform1f(u.uTargetShow, this.targetTex ? this.targetShow : 0);
    if (this.targetTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.targetTex);
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
