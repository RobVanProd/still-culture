// The medium.
//
// A Gray-Scott reaction-diffusion system on the GPU, ping-ponged between two
// float textures. Two chemicals, U and V, held in the R and G channels:
//
//   dU/dt = Du*lap(U) - U*V^2 + F*(1 - U)
//   dV/dt = Dv*lap(V) + U*V^2 - (F + K)*V
//
// Gray-Scott is chosen over a hand-rolled growth model for one reason that
// matters to this game specifically: its behaviour is *genuinely* sensitive to
// small changes in F and K, in a way that is structured rather than chaotic.
// Nudge K by 0.002 and a field that was making stable spots starts making
// worms — irreversibly, and after a delay. That is the entire premise of the
// game as a physical fact rather than a scripted one, and no amount of
// hand-authored logic would feel as honest.
//
// F and K are not global constants here. They are a per-pixel field that the
// player's actuators write into, which is what turns a famous toy into an
// instrument the player plays.

import { createProgram, createFullscreenVao, FULLSCREEN_VS } from '../core/gl.js';

const STEP_FS = `#version 300 es
precision highp float;

uniform sampler2D uState;     // R = U, G = V, B = scar, A = age/commitment
uniform sampler2D uParams;    // R = F, G = K, B = thermal, A = shear magnitude
uniform sampler2D uLatent;    // R = dK when expressed, G = expression threshold
uniform vec2  uTexel;
uniform float uDt;
uniform float uDu;
uniform float uDv;

in vec2 vUv;
out vec4 frag;

void main() {
  vec2 uv = vUv;

  vec4 c = texture(uState, uv);
  float U = c.r, V = c.g, scar = c.b, commit = c.a;

  // Nine-point Laplacian. The five-point stencil is cheaper and visibly
  // anisotropic — patterns line up with the texel grid and the dish looks
  // knitted rather than grown, which is fatal for something the player is
  // supposed to read organically.
  vec2 t = uTexel;
  float lapU =
      texture(uState, uv + vec2(-t.x, -t.y)).r * 0.05 +
      texture(uState, uv + vec2( 0.0, -t.y)).r * 0.20 +
      texture(uState, uv + vec2( t.x, -t.y)).r * 0.05 +
      texture(uState, uv + vec2(-t.x,  0.0)).r * 0.20 +
      U * -1.0 +
      texture(uState, uv + vec2( t.x,  0.0)).r * 0.20 +
      texture(uState, uv + vec2(-t.x,  t.y)).r * 0.05 +
      texture(uState, uv + vec2( 0.0,  t.y)).r * 0.20 +
      texture(uState, uv + vec2( t.x,  t.y)).r * 0.05;

  float lapV =
      texture(uState, uv + vec2(-t.x, -t.y)).g * 0.05 +
      texture(uState, uv + vec2( 0.0, -t.y)).g * 0.20 +
      texture(uState, uv + vec2( t.x, -t.y)).g * 0.05 +
      texture(uState, uv + vec2(-t.x,  0.0)).g * 0.20 +
      V * -1.0 +
      texture(uState, uv + vec2( t.x,  0.0)).g * 0.20 +
      texture(uState, uv + vec2(-t.x,  t.y)).g * 0.05 +
      texture(uState, uv + vec2( 0.0,  t.y)).g * 0.20 +
      texture(uState, uv + vec2( t.x,  t.y)).g * 0.05;

  vec4 p = texture(uParams, uv);
  float F = p.r;
  float K = p.g;
  float thermal = p.b;

  // The latent variant.
  //
  // This is the design's answer to its sharpest critique. A hidden constant that
  // differs from dish to dish is not enough: if the player knows *where* to look
  // for it, one probe at that place is correct every session and the central
  // decision dies. So the variant is inert until the medium has committed
  // locally — it expresses itself wherever the culture actually chose to build,
  // which the player influenced but did not dictate.
  //
  // The consequence is that "probe the branch point" requires already knowing
  // where the branch point will be, and that is a read of the free channels
  // rather than a fixed opening. There is no move that answers the question
  // before the question exists.
  vec2 latent = texture(uLatent, uv).rg;
  float expressed = smoothstep(latent.g, latent.g + 0.12, commit);
  K += latent.r * expressed;

  // Heat accelerates the reaction without changing what the reaction is. This
  // is the actuator with the most authority and the least precision, which is
  // exactly the role it should play: it makes things happen sooner, not
  // differently, so it can never be used to steer directly.
  float rate = 1.0 + thermal * 1.6;

  float reaction = U * V * V;
  float dU = (uDu * lapU - reaction + F * (1.0 - U)) * rate;
  float dV = (uDv * lapV + reaction - (F + K) * V) * rate;

  U = clamp(U + dU * uDt, 0.0, 1.0);
  V = clamp(V + dV * uDt, 0.0, 1.0);

  // Commitment. The medium differentiates as it grows and becomes progressively
  // less plastic.
  //
  // This is the answer to the strongest critique of the design: if waiting were
  // free, the optimal policy would be to keep the mass generic, take no action a
  // hidden variant could invert, and commit in the last ninety seconds once
  // everything had resolved for nothing. Commitment makes patience cost
  // authority instead of time. Late certainty buys a medium that no longer
  // listens.
  //
  // It accrues where there is structure to commit to, so a dish held
  // deliberately blank stays plastic — the player can genuinely trade shape for
  // options, which is a decision rather than a punishment.
  float structure = V * (1.0 - V) * 4.0;   // peaks at the interfaces, not the bulk
  commit = min(1.0, commit + structure * uDt * 0.00008);

  // Scar heals, slowly, and never completely.
  //
  // The rate matters more than it looks. At the first value tried, a bleached
  // disc had vanished within three minutes — which quietly refunded the price of
  // every probe and removed the reason to hesitate before taking one. The cost
  // of looking has to still be on the dish at the assay, or the central decision
  // is free and the game is about nothing.
  //
  // The floor is the honest part: tissue that was destroyed does not come back,
  // it is only grown over. Roughly a sixth of the damage fades across a full
  // session; the rest is in the final score.
  float healable = max(0.0, scar - 0.55 * scar);
  scar = scar - min(healable, uDt * 0.000006);

  frag = vec4(U, V, scar, commit);
}`;

// Actuators and probes write into the field with additive brushes. Kept as one
// shader with a mode switch rather than four programs: they differ only in which
// channel they touch and with what falloff.
const BRUSH_FS = `#version 300 es
precision highp float;

uniform sampler2D uSrc;
uniform vec2  uCenter;      // in uv space
uniform float uInner;       // annulus inner radius (0 for a disc)
uniform float uOuter;
uniform float uStrength;
uniform int   uMode;        // 0 nutrient, 1 thermal, 2 shear, 3 bleach, 4 aspirate, 5 seed
uniform float uAspect;

in vec2 vUv;
out vec4 frag;

void main() {
  vec4 src = texture(uSrc, vUv);
  vec2 d = (vUv - uCenter) * vec2(uAspect, 1.0);
  float r = length(d);

  // Smooth on both edges so a ring has no hard rim. A hard edge in the parameter
  // field shows up as a hard edge in the growth, and the dish stops looking grown.
  float band = smoothstep(uOuter, uOuter * 0.82, r) * smoothstep(uInner * 0.82, uInner, r);
  if (uInner <= 0.0) band = smoothstep(uOuter, uOuter * 0.7, r);
  float a = band * uStrength;

  if (a <= 0.0001) { frag = src; return; }

  // Nutrient lowers the kill rate; shade raises it.
  //
  // This is the opposite of the obvious mapping and it was found by measuring
  // the medium rather than by reasoning about it. Raising the feed rate — the
  // intuitive "more food" — actually *kills* this culture: at the constants the
  // coral strain lives at, higher F leaves the pattern-forming region and the
  // dish relaxes to sterile uniform substrate. A sweep of the response surface
  // put the authority almost entirely in K, and steeply: -0.004 multiplies
  // coverage more than fivefold, +0.004 sterilises the dish completely.
  //
  // The steepness is why the per-application delta is small. The player is
  // holding a control with enormous authority and it has to feel like leaning on
  // something, not like flipping a switch.
  if (uMode == 0) {          // nutrient: enrich, lower kill rate
    src.g = clamp(src.g - a * 0.0018, 0.030, 0.075);
    src.r = clamp(src.r - a * 0.0015, 0.004, 0.11);
  } else if (uMode == 1) {   // thermal: raise local rate
    src.b = clamp(src.b + a, 0.0, 1.0);
  } else if (uMode == 2) {   // shear: mark for advection
    src.a = clamp(src.a + a, 0.0, 1.0);
  } else if (uMode == 3) {   // bleach: destroy V, record scar
    src.g = max(0.0, src.g - a * 0.9);
    src.b = min(1.0, src.b + a * 0.75);
  } else if (uMode == 4) {   // aspirate: remove all mass, deep scar
    src.r = mix(src.r, 1.0, a);
    src.g = max(0.0, src.g - a);
    src.b = min(1.0, src.b + a);
  } else if (uMode == 5) {   // seed
    src.g = min(1.0, src.g + a);
    src.r = max(0.0, src.r - a * 0.5);
  } else if (uMode == 6) {   // shade: starve, retract the front
    // Retraction is the verb the scoring demands. The shape score is an
    // intersection over union, so it punishes sprawl as hard as it punishes
    // shortfall — and a player who can only ever add is being marked on
    // something they have no control over.
    // Stronger per application than nutrient, because it is working against
    // structure that already exists. Established growth resists being pushed
    // back in a way that empty substrate does not resist being filled, and
    // matching the two numbers left retraction almost useless in practice.
    src.g = clamp(src.g + a * 0.0034, 0.030, 0.075);
  }

  frag = src;
}`;

// Shear advects the state along a flow field, which is how the player moves mass
// without creating or destroying it.
const SHEAR_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uParams;
uniform vec2  uCenter;
uniform vec2  uDir;
uniform float uAmount;
uniform vec2  uTexel;
uniform float uAspect;
in vec2 vUv;
out vec4 frag;

void main() {
  vec2 d = (vUv - uCenter) * vec2(uAspect, 1.0);
  float r = length(d);
  float falloff = exp(-r * r * 44.0);
  vec2 offset = uDir * uAmount * falloff * uTexel * 60.0;
  // Sample backwards along the flow: semi-Lagrangian advection is
  // unconditionally stable, which matters because the player can shear as hard
  // as they like and the field must not explode.
  frag = texture(uState, vUv - offset);
}`;

const DECAY_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform float uThermalDecay;
uniform float uShearDecay;
uniform sampler2D uBase;
uniform float uReturn;
in vec2 vUv;
out vec4 frag;
void main() {
  vec4 p = texture(uSrc, vUv);
  vec4 b = texture(uBase, vUv);
  // Actuators are held, not permanent: release the control and the dish returns
  // to its own constants. Feed and kill return slowly, heat and shear quickly.
  p.r = mix(p.r, b.r, uReturn);
  p.g = mix(p.g, b.g, uReturn);
  p.b *= uThermalDecay;
  p.a *= uShearDecay;
  frag = p;
}`;

export class Medium {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {number} size square resolution
   */
  constructor(gl, size = 512) {
    this.gl = gl;
    this.size = size;

    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('EXT_color_buffer_float required for the medium simulation');
    gl.getExtension('OES_texture_float_linear');

    this.vao = createFullscreenVao(gl);
    this.stepProgram = createProgram(gl, FULLSCREEN_VS, STEP_FS, 'medium-step');
    this.brushProgram = createProgram(gl, FULLSCREEN_VS, BRUSH_FS, 'medium-brush');
    this.shearProgram = createProgram(gl, FULLSCREEN_VS, SHEAR_FS, 'medium-shear');
    this.decayProgram = createProgram(gl, FULLSCREEN_VS, DECAY_FS, 'medium-decay');

    this.state = [this._target(), this._target()];
    this.params = [this._target(), this._target()];
    this.baseParams = this._target();
    this.latent = this._target();
    this.front = 0;
    this.paramFront = 0;

    // Physical constants of this strain. Set by reset().
    this.Du = 0.16;
    this.Dv = 0.08;
    this.dt = 1.0;
  }

  _target() {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.size, this.size, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // Clamp, not repeat: the dish has an edge, and the meniscus behaviour at
    // that edge is one of the free channels the player reads.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('medium target incomplete — RGBA32F may not be renderable here');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  }

  get stateTex() { return this.state[this.front].tex; }
  get paramTex() { return this.params[this.paramFront].tex; }

  _bindDraw(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, this.size, this.size);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.vao);
  }

  _draw() {
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  /** Advance the reaction. Several sub-steps per call: Gray-Scott needs a small dt. */
  step(substeps = 2) {
    const gl = this.gl;
    gl.useProgram(this.stepProgram.program);
    const u = this.stepProgram.uniforms;
    gl.uniform2f(u.uTexel, 1 / this.size, 1 / this.size);
    gl.uniform1f(u.uDt, this.dt);
    gl.uniform1f(u.uDu, this.Du);
    gl.uniform1f(u.uDv, this.Dv);
    gl.uniform1i(u.uState, 0);
    gl.uniform1i(u.uParams, 1);
    gl.uniform1i(u.uLatent, 2);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.latent.tex);

    for (let i = 0; i < substeps; i++) {
      const src = this.state[this.front];
      const dst = this.state[1 - this.front];
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.paramTex);
      this._bindDraw(dst);
      this._draw();
      this.front = 1 - this.front;
    }
  }

  /**
   * Relax actuator fields back toward the strain's own constants.
   *
   * Rates are time constants in seconds, not per-call factors. The first version
   * used per-call factors and was called once per 120 Hz tick, which gave
   * enrichment a half-life of about a tenth of a second: everything the player
   * did evaporated before the chemistry could respond to it, and every play
   * policy scored identically because none of them were really doing anything.
   *
   * The three channels decay at deliberately different rates, and the difference
   * is most of what distinguishes the actuators from each other. Enrichment is
   * something you have changed about the medium and it persists. Heat is
   * something you are doing to it and stops when you stop. Shear is an event.
   */
  decayParams(dt = 1 / 120, { enrichTau = 30, thermalTau = 2.5, shearTau = 0.4 } = {}) {
    const thermalDecay = Math.exp(-dt / thermalTau);
    const shearDecay = Math.exp(-dt / shearTau);
    const ret = 1 - Math.exp(-dt / enrichTau);
    return this._decay(thermalDecay, shearDecay, ret);
  }

  _decay(thermalDecay, shearDecay, ret) {
    const gl = this.gl;
    const src = this.params[this.paramFront];
    const dst = this.params[1 - this.paramFront];
    gl.useProgram(this.decayProgram.program);
    gl.uniform1f(this.decayProgram.uniforms.uThermalDecay, thermalDecay);
    gl.uniform1f(this.decayProgram.uniforms.uShearDecay, shearDecay);
    gl.uniform1f(this.decayProgram.uniforms.uReturn, ret);
    gl.uniform1i(this.decayProgram.uniforms.uSrc, 0);
    gl.uniform1i(this.decayProgram.uniforms.uBase, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.baseParams.tex);
    this._bindDraw(dst);
    this._draw();
    this.paramFront = 1 - this.paramFront;
  }

  /**
   * Paint into either the state or the parameter field.
   * @param {'state'|'params'} which
   */
  brush(which, { x, y, inner = 0, outer = 0.1, strength = 1, mode = 0 }) {
    const gl = this.gl;
    const pair = which === 'state' ? this.state : this.params;
    const idx = which === 'state' ? this.front : this.paramFront;
    const src = pair[idx];
    const dst = pair[1 - idx];

    gl.useProgram(this.brushProgram.program);
    const u = this.brushProgram.uniforms;
    gl.uniform2f(u.uCenter, x, y);
    gl.uniform1f(u.uInner, inner);
    gl.uniform1f(u.uOuter, outer);
    gl.uniform1f(u.uStrength, strength);
    gl.uniform1i(u.uMode, mode);
    gl.uniform1f(u.uAspect, 1.0);
    gl.uniform1i(u.uSrc, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);

    this._bindDraw(dst);
    this._draw();

    if (which === 'state') this.front = 1 - this.front;
    else this.paramFront = 1 - this.paramFront;
  }

  /** Move mass along a direction, without creating or destroying it. */
  shear(x, y, dx, dy, amount) {
    const gl = this.gl;
    const src = this.state[this.front];
    const dst = this.state[1 - this.front];
    gl.useProgram(this.shearProgram.program);
    const u = this.shearProgram.uniforms;
    gl.uniform2f(u.uCenter, x, y);
    gl.uniform2f(u.uDir, dx, dy);
    gl.uniform1f(u.uAmount, amount);
    gl.uniform2f(u.uTexel, 1 / this.size, 1 / this.size);
    gl.uniform1f(u.uAspect, 1.0);
    gl.uniform1i(u.uState, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
    this._bindDraw(dst);
    this._draw();
    this.front = 1 - this.front;
  }

  /** Upload a full parameter field (F, K, thermal, shear) from a Float32Array. */
  uploadParams(data) {
    const gl = this.gl;
    for (const t of [this.params[0], this.params[1], this.baseParams]) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.size, this.size, 0, gl.RGBA, gl.FLOAT, data);
    }
  }

  /** Upload the hidden variant field (dK, expression threshold). */
  uploadLatent(data) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.latent.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.size, this.size, 0, gl.RGBA, gl.FLOAT, data);
  }

  /** Upload a full state field (U, V, scar, commit). */
  uploadState(data) {
    const gl = this.gl;
    for (const t of this.state) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.size, this.size, 0, gl.RGBA, gl.FLOAT, data);
    }
    this.front = 0;
  }

  /**
   * Downsample the field to a small grid of statistics, and read it back.
   *
   * The audio channel needs the field's shape several times a second, and
   * reading 512x512 floats back per frame is four megabytes across the bus and a
   * full pipeline stall. Reducing on the GPU first and reading back a 16x16 tile
   * costs four kilobytes, which is cheap enough to do continuously.
   *
   * Each output texel carries, for its tile: mean V, interface density
   * (V*(1-V), which peaks at boundaries rather than in the bulk), mean
   * commitment, and mean scar. Those four are exactly what the hum is built
   * from, and what scoring needs.
   */
  reduceStats(out) {
    const gl = this.gl;
    if (!this.statsProgram) {
      this.statsProgram = createProgram(gl, FULLSCREEN_VS, `#version 300 es
        precision highp float;
        uniform sampler2D uState;
        uniform int uTile;
        uniform vec2 uTexel;
        in vec2 vUv;
        out vec4 frag;
        void main() {
          vec4 acc = vec4(0.0);
          float n = 0.0;
          for (int y = 0; y < 32; y++) {
            if (y >= uTile) break;
            for (int x = 0; x < 32; x++) {
              if (x >= uTile) break;
              vec2 uv = vUv + (vec2(float(x), float(y)) - float(uTile) * 0.5) * uTexel;
              vec4 s = texture(uState, uv);
              acc.r += s.g;                    // mass
              acc.g += s.g * (1.0 - s.g) * 4.0; // interface
              acc.b += s.a;                    // commitment
              acc.a += s.b;                    // scar
              n += 1.0;
            }
          }
          frag = acc / max(n, 1.0);
        }`, 'medium-stats');
      this.statsSize = 16;
      this.statsTarget = null;
    }
    if (!this.statsTarget) {
      const size = this.statsSize;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.statsTarget = { tex, fbo };
    }

    const tile = Math.min(32, Math.floor(this.size / this.statsSize));
    gl.useProgram(this.statsProgram.program);
    gl.uniform1i(this.statsProgram.uniforms.uState, 0);
    gl.uniform1i(this.statsProgram.uniforms.uTile, tile);
    gl.uniform2f(this.statsProgram.uniforms.uTexel, 1 / this.size, 1 / this.size);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.state[this.front].tex);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.statsTarget.fbo);
    gl.viewport(0, 0, this.statsSize, this.statsSize);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const n = this.statsSize * this.statsSize * 4;
    const buf = out && out.length >= n ? out : new Float32Array(n);
    gl.readPixels(0, 0, this.statsSize, this.statsSize, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return buf;
  }

  /** Read the whole state back. Expensive — for analysis and scoring only. */
  readState(out) {
    const gl = this.gl;
    const n = this.size * this.size * 4;
    const buf = out && out.length >= n ? out : new Float32Array(n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.state[this.front].fbo);
    gl.readPixels(0, 0, this.size, this.size, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return buf;
  }
}
