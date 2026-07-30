// Veiling glare, tone and dither — everything the dish shader cannot do with
// one pixel.
//
// Interface:
//
//   const post = new Post(gl);
//   post.begin(width, height);          // HDR scene target bound and cleared
//   ...draw the scene, as linear radiance with no ceiling...
//   post.finish({ exposure, glare });   // resolves to the default framebuffer
//
// Two jobs live here, and neither belongs in the dish shader.
//
// Glare. In a real dark-field microscope the bright scatterers bleed into the
// black around them — stray light in the condenser, scatter in the immersion
// fluid, flare in the objective. Without it the structure sits on the black like
// a decal cut out with scissors. With it the black between the branches carries
// a little light and the dish reads as something seen through a column of fluid.
// It needs a pixel's neighbourhood, so it needs its own passes.
//
// Tone. The dish shader writes radiance; deciding what "white" means is a
// separate decision, and it has to be made *after* the glare has been added or
// the glare is computed from numbers that have already been squashed.
//
// The chain is three half-steps of blur rather than one wide one. A single
// Gaussian wide enough to read as a veil is either expensive or visibly
// polygonal at the tails; three octaves summed give a tight halo and a wide
// haze at once, which is what real flare looks like and costs almost nothing
// because the wide term is computed at an eighth of the resolution.

import { createProgram, createFullscreenVao, FULLSCREEN_VS, createTarget } from '../core/gl.js';

const PREFILTER_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2  uTexel;       // texel size of the SOURCE
uniform float uThreshold;
uniform float uKnee;
in vec2 vUv;
out vec4 frag;

void main() {
  // Four bilinear taps at the source's half-texel diagonals: a box downsample
  // that costs four fetches instead of sixteen and does not alias into the
  // blur chain, which would show up as the glare crawling when the dish moves.
  vec2 o = uTexel;
  vec3 c = texture(uSrc, vUv + vec2(-o.x, -o.y)).rgb
         + texture(uSrc, vUv + vec2( o.x, -o.y)).rgb
         + texture(uSrc, vUv + vec2(-o.x,  o.y)).rgb
         + texture(uSrc, vUv + vec2( o.x,  o.y)).rgb;
  c *= 0.25;

  // Soft knee. A hard threshold makes the glare switch on along a contour, and
  // that contour is visible as a hard ring around every bright ridge.
  float b = max(c.r, max(c.g, c.b));
  float soft = clamp(b - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-5);
  float w = max(soft, b - uThreshold) / max(b, 1e-5);
  frag = vec4(c * w, 1.0);
}`;

const DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2  uTexel;
in vec2 vUv;
out vec4 frag;
void main() {
  vec2 o = uTexel;
  vec3 c = texture(uSrc, vUv + vec2(-o.x, -o.y)).rgb
         + texture(uSrc, vUv + vec2( o.x, -o.y)).rgb
         + texture(uSrc, vUv + vec2(-o.x,  o.y)).rgb
         + texture(uSrc, vUv + vec2( o.x,  o.y)).rgb;
  frag = vec4(c * 0.25, 1.0);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2  uStep;        // one axis, in uv
in vec2 vUv;
out vec4 frag;
void main() {
  // Nine-tap Gaussian folded into five fetches by sampling between texels and
  // letting the bilinear unit do the pairwise weighting.
  vec3 c = texture(uSrc, vUv).rgb * 0.2270270270;
  c += texture(uSrc, vUv + uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture(uSrc, vUv - uStep * 1.3846153846).rgb * 0.3162162162;
  c += texture(uSrc, vUv + uStep * 3.2307692308).rgb * 0.0702702703;
  c += texture(uSrc, vUv - uStep * 3.2307692308).rgb * 0.0702702703;
  frag = vec4(c, 1.0);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uL0;
uniform sampler2D uL1;
uniform sampler2D uL2;
uniform float uExposure;
uniform float uGlare;
uniform float uAberration;
uniform vec2  uAspect;      // scales uv offsets so they are circular on screen
in vec2 vUv;
out vec4 frag;

// Tone curve.
//
// A plain Reinhard shoulder was doing this job before and it is a large part of
// why the render read as plastic: it compresses luminance and leaves chroma
// alone, so the brightest ridge kept full saturation right up to clipping and
// the image looked painted rather than photographed. Real optics does the
// opposite. A scatterer bright enough to clip clips to *white*, because it has
// saturated every channel. Bleaching chroma toward the shoulder is therefore not
// a stylistic flourish, it is the missing half of the exposure — and it is what
// lets the palette below stay saturated in the mid-tones without the whole
// picture turning to sweets.
vec3 tonemap(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(l), smoothstep(1.00, 3.4, l) * 0.88);
  // Extended Reinhard: white is a value we chose rather than infinity, so the
  // mid-tones keep their contrast instead of being dragged down by one hot pixel.
  const float W = 3.1;
  return c * (1.0 + c / (W * W)) / (1.0 + c);
}

// Interleaved-gradient dither.
//
// Nearly all of this image lives in the bottom few per cent of the 8-bit range,
// and the glare lays wide, slow gradients exactly there — the worst case for
// banding, which shows up as concentric contours around every bright region.
// The pattern is a pure function of gl_FragCoord: anything animated would be a
// crawling grain over a picture the player is asked to watch for ten minutes,
// and anything random would break byte-identical captures.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  // Lateral colour.
  //
  // No objective is corrected at the edge of its field: the three wavelengths
  // land at slightly different heights, and away from the axis a hard white edge
  // splits. It is a fault, and putting it in is what tells the eye it is looking
  // *through* something. Radial, growing with the square of the field height,
  // and about a pixel at the rim of the dish — enough to soften a hard white
  // edge, never enough to read as a colour fringe on its own account.
  vec2 off = (vUv - 0.5) * uAspect;
  float field = dot(off, off);
  vec2 shift = off * field * uAberration;
  vec3 c = vec3(
    texture(uScene, vUv + shift).r,
    texture(uScene, vUv).g,
    texture(uScene, vUv - shift).b);

  // Three octaves. The tight one sits on the structure, the wide one is the
  // veil that says there is fluid between the specimen and the lens.
  vec3 g = texture(uL0, vUv).rgb * 0.42
         + texture(uL1, vUv).rgb * 0.34
         + texture(uL2, vUv).rgb * 0.24;
  // Flare in a wet optic is very slightly warm, because the fluid takes the
  // short end out of the light on its way through.
  c += g * uGlare * vec3(1.0, 0.96, 0.88);

  c = tonemap(c * uExposure);
  c = pow(max(c, 0.0), vec3(0.4545));
  c += (ign(gl_FragCoord.xy) - 0.5) / 255.0;
  frag = vec4(c, 1.0);
}`;

const LEVELS = 3;

export class Post {
  constructor(gl) {
    this.gl = gl;
    this.vao = createFullscreenVao(gl);
    this.pPrefilter = createProgram(gl, FULLSCREEN_VS, PREFILTER_FS, 'post-prefilter');
    this.pDown = createProgram(gl, FULLSCREEN_VS, DOWN_FS, 'post-down');
    this.pBlur = createProgram(gl, FULLSCREEN_VS, BLUR_FS, 'post-blur');
    this.pComposite = createProgram(gl, FULLSCREEN_VS, COMPOSITE_FS, 'post-composite');

    this.scene = null;
    this.levels = [];      // [{ a, b }] ping-pong pairs, each half the previous
    this.width = 0;
    this.height = 0;

    /** Brightness at which structure starts to flare. */
    this.threshold = 0.52;
    this.knee = 0.28;
    /** Radial lateral colour, in uv at the corner of the field. */
    this.aberration = 0.0055;
  }

  _ensure(width, height) {
    if (this.width === width && this.height === height) return;
    const gl = this.gl;
    for (const t of this._all()) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    this.levels = [];
    this.scene = createTarget(gl, width, height, { float: true });
    let w = width, h = height;
    for (let i = 0; i < LEVELS; i++) {
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
      this.levels.push({
        a: createTarget(gl, w, h, { float: true }),
        b: createTarget(gl, w, h, { float: true }),
      });
    }
    this.width = width;
    this.height = height;
  }

  _all() {
    const out = this.scene ? [this.scene] : [];
    for (const l of this.levels) out.push(l.a, l.b);
    return out;
  }

  _pass(target, program, setup) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.width : this.width, target ? target.height : this.height);
    gl.useProgram(program.program);
    setup(program.uniforms);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _bind(unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  /** Bind the HDR scene target. Everything drawn until finish() lands here. */
  begin(width, height) {
    const gl = this.gl;
    this._ensure(width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fbo);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Build the glare, grade, and resolve to the default framebuffer. */
  finish({ exposure = 1, glare = 1 } = {}) {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // Bright pass into the first level.
    this._bind(0, this.scene.tex);
    this._pass(this.levels[0].a, this.pPrefilter, (u) => {
      gl.uniform1i(u.uSrc, 0);
      gl.uniform2f(u.uTexel, 1 / this.width, 1 / this.height);
      gl.uniform1f(u.uThreshold, this.threshold);
      gl.uniform1f(u.uKnee, this.knee);
    });

    for (let i = 0; i < LEVELS; i++) {
      const lv = this.levels[i];
      if (i > 0) {
        const prev = this.levels[i - 1].a;
        this._bind(0, prev.tex);
        this._pass(lv.a, this.pDown, (u) => {
          gl.uniform1i(u.uSrc, 0);
          gl.uniform2f(u.uTexel, 1 / prev.width, 1 / prev.height);
        });
      }
      // Separable Gaussian, horizontal then vertical, ending back in `a` so the
      // next level and the composite both read from the same slot.
      this._bind(0, lv.a.tex);
      this._pass(lv.b, this.pBlur, (u) => {
        gl.uniform1i(u.uSrc, 0);
        gl.uniform2f(u.uStep, 1 / lv.a.width, 0);
      });
      this._bind(0, lv.b.tex);
      this._pass(lv.a, this.pBlur, (u) => {
        gl.uniform1i(u.uSrc, 0);
        gl.uniform2f(u.uStep, 0, 1 / lv.b.height);
      });
    }

    this._bind(0, this.scene.tex);
    this._bind(1, this.levels[0].a.tex);
    this._bind(2, this.levels[1].a.tex);
    this._bind(3, this.levels[2].a.tex);
    this._pass(null, this.pComposite, (u) => {
      gl.uniform1i(u.uScene, 0);
      gl.uniform1i(u.uL0, 1);
      gl.uniform1i(u.uL1, 2);
      gl.uniform1i(u.uL2, 3);
      gl.uniform1f(u.uExposure, exposure);
      gl.uniform1f(u.uGlare, glare);
      gl.uniform1f(u.uAberration, this.aberration);
      const a = this.width / this.height;
      gl.uniform2f(u.uAspect, Math.max(a, 1), 1 / Math.min(a, 1));
    });

    gl.bindVertexArray(null);
  }
}
