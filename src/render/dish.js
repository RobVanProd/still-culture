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
//
// The shader writes **linear radiance with no ceiling**. Exposure, the tone
// curve and the veiling glare all live in render/post.js, which needs a pixel's
// neighbours and therefore needs its own passes.
//
// What changed, and why, because the previous version was striking and wrong:
//
//   Hue. A full cosine sweep of the spectrum per unit thickness turned every
//   ridge into a soap bubble. Colour here comes from how finely divided the
//   scattering structure is — cold where it is fine, straw where it is massed —
//   which is a ninety-degree arc through neutral instead of the whole wheel.
//
//   Depth. The field is one layer of chemistry, so depth has to be constructed:
//   a sharp near layer at the glass, a soft displaced echo of the same field
//   beneath it, and a low haze of scattered light in the fluid between.
//
//   The rim. A grey vignette became a meniscus — a fillet of fluid that lenses
//   what is under it, a dark contact line, and a lit glass wall. The design
//   names meniscus behaviour as one of the free channels the player learns to
//   read, so the fillet also answers to the culture that reaches it.

import { createProgram, createFullscreenVao, FULLSCREEN_VS } from '../core/gl.js';
import { Post } from './post.js';

const FS = `#version 300 es
precision highp float;

uniform sampler2D uState;    // R=U G=V B=scar A=commit
uniform sampler2D uParams;   // R=F G=K B=thermal A=shear
uniform vec2  uTexel;
uniform vec2  uRes;
uniform float uTime;
uniform float uReveal;       // 0..1 fluorescence overlay strength
uniform vec2  uRevealAt;
uniform float uRevealRadius;
uniform sampler2D uTarget;   // R = wanted (0 or 1)
uniform float uTargetShow;

in vec2 vUv;
out vec4 frag;

// A raking light from the upper left. Everything that needs a direction — the
// scatter anisotropy, the specular on the meniscus, the lit side of the glass
// wall, the bevel on the engraved stencil — takes it from here, so the whole
// image agrees about where the illuminator is.
const vec2 LIGHT = vec2(-0.5525, 0.8336);

// The palette, and the one decision held to everywhere below.
//
// Colour is a function of how finely divided the scattering structure is, not of
// an arbitrary sweep of hue. Fine filaments scatter the short wavelengths and
// read cold; accumulated mass scatters everything and washes toward a pale
// straw; the densest ridges give up their colour entirely at the top of the tone
// curve. That is a narrow arc through neutral, which is why it reads as material
// — the rainbow it replaced read as an oil slick because no material does that.
// The mid stop is a cool white rather than anything with a hue of its own, and
// the mass stop is bone rather than gold. Both were more saturated first, and
// at the luminance most of this image actually sits at, a saturated straw goes
// olive — the culture read as mud rather than as material.
const vec3 SCATTER_FINE = vec3(0.30, 0.56, 0.74);
const vec3 SCATTER_MID  = vec3(0.72, 0.78, 0.82);
const vec3 SCATTER_MASS = vec3(1.00, 0.92, 0.78);

// Depth of the dish, in the only units available: how far the deep layer is
// displaced by parallax, and how much cooler it is for the fluid above it.
const float PARALLAX  = 0.014;
const vec3  DEEP_TINT = vec3(0.64, 0.84, 1.02);

// Where the fluid starts climbing the wall.
const float MENISC_IN   = 0.900;
const float MENISC_PULL = 0.050;

void main() {
  // ---- dish space --------------------------------------------------------
  // The dish is a circle of the smaller screen dimension, not a stretched oval
  // filling the viewport. This mapping is the exact inverse of the one main.js
  // uses to turn a mouse position into a dish coordinate; before, the two
  // disagreed on any non-square canvas and the cursor did not land where the
  // brush did.
  float aspect = uRes.x / uRes.y;
  vec2 pd = (vUv * 2.0 - 1.0) * vec2(max(aspect, 1.0), 1.0 / min(aspect, 1.0));
  float r = length(pd);

  // Everything beyond the outside of the glass is off. On a 16:9 canvas that is
  // most of the screen, and it is by far the cheapest optimisation available.
  if (r > 1.09) { frag = vec4(0.0, 0.0, 0.0, 1.0); return; }

  vec2 dir = pd / max(r, 1e-5);
  vec2 duv = pd * 0.5 + 0.5;              // dish space and state space coincide

  float fluid = smoothstep(1.002, 0.984, r);

  // ---- what the fluid does to the sample coordinate ----------------------
  // The meniscus is a lens. What is underneath the fillet is not merely shaded
  // differently, it is magnified and smeared radially into the ring, which is
  // why a real dish has that band of stretched, doubled detail at its edge.
  // Displacing the sample coordinate *is* the effect; everything later in this
  // file about the rim is only the light on the surface of the fillet.
  float fill = clamp((r - MENISC_IN) / (1.0 - MENISC_IN), 0.0, 1.0);
  float lens = fill * fill * MENISC_PULL;

  // Heat, shown as convection rather than as a red overlay.
  //
  // The previous version multiplied two sine waves at two hundred cycles across
  // the dish. At any real output size that is under the sampling limit, so it
  // aliased into a crawling moire exactly where the player was working. This is
  // three cycles and a quarter of a hertz, it displaces the image by about a
  // texel instead of painting on top of it, and it decays with the actuator —
  // so a dish nobody is heating is perfectly still.
  float thermal = texture(uParams, clamp(duv, 0.0, 1.0)).b;
  vec2 warp = vec2(0.0);
  float convect = 0.0;
  if (thermal > 0.002) {
    float a = duv.x * 19.0 + uTime * 1.5;
    float b = duv.y * 16.0 - uTime * 1.1;
    convect = sin(a) * cos(b);
    warp = vec2(sin(b + cos(a * 0.7)), cos(a + sin(b * 0.6))) * thermal * uTexel.x * 1.4;
  }

  vec2 suv = duv - dir * (lens * 0.5) + warp;

  // ---- the field ---------------------------------------------------------
  // Four taps at one texel give the near layer's gradient; the same four taps
  // give the scar's gradient for free, which is what draws the hard edge of a
  // bleached disc.
  vec4 c  = texture(uState, suv);
  vec4 sL = texture(uState, suv - vec2(uTexel.x, 0.0));
  vec4 sR = texture(uState, suv + vec2(uTexel.x, 0.0));
  vec4 sD = texture(uState, suv - vec2(0.0, uTexel.y));
  vec4 sU = texture(uState, suv + vec2(0.0, uTexel.y));

  float V = c.g, scar = c.b, commit = c.a;
  vec2 gNear = vec2(sR.g - sL.g, sU.g - sD.g) * 0.5;
  vec2 gScar = vec2(sR.b - sL.b, sU.b - sD.b) * 0.5;

  // The deep layer: the same field, sampled off-axis and with a wide stencil.
  //
  // There is only one layer of chemistry, so this is a fiction — but it is the
  // honest fiction. Something below the glass and off the optical axis projects
  // slightly closer to the axis than the thing above it, and arrives softened by
  // the fluid it was seen through; sampling further out is how you draw that.
  // Giving the render a second plane is the difference between a culture with
  // body and a print on a slide.
  vec2 deepUv = suv + (duv - 0.5) * PARALLAX;
  vec2 dt = uTexel * 2.8;
  float dL = texture(uState, deepUv - vec2(dt.x, 0.0)).g;
  float dR = texture(uState, deepUv + vec2(dt.x, 0.0)).g;
  float dD = texture(uState, deepUv - vec2(0.0, dt.y)).g;
  float dU = texture(uState, deepUv + vec2(0.0, dt.y)).g;
  vec2  gDeep = vec2(dR - dL, dU - dD) * 0.5 / 2.8;
  float vDeep = (dL + dR + dD + dU) * 0.25;

  // Four wide taps for the haze — light scattered by the fluid itself, which is
  // what fills the black between branches and stops the dish reading as a
  // cut-out.
  vec2 ht = uTexel * 9.0;
  float vHaze = (texture(uState, suv + vec2( ht.x,  ht.y)).g +
                 texture(uState, suv + vec2(-ht.x,  ht.y)).g +
                 texture(uState, suv + vec2( ht.x, -ht.y)).g +
                 texture(uState, suv + vec2(-ht.x, -ht.y)).g) * 0.25;

  // ---- scattering --------------------------------------------------------
  // Structure scatters light. The exponent controls how selective it is: too low
  // and the bulk glows into mush, too high and only razor edges survive.
  float slope = length(gNear);
  float scatter = pow(slope * 23.0, 1.58);

  // Anisotropy. A front facing the illuminator throws more light at the
  // objective than one facing away, which is what gives the structure a
  // direction and the dish the reading of a physical object rather than a heat
  // map.
  //
  // The normal is minus the gradient: V increases *into* the structure, so the
  // surface's outward face points down the gradient. Using the gradient itself
  // lit every front from behind, which is invisible until something with a tight
  // exponent depends on it and then it is the only thing you can see.
  vec2 normal = -normalize(gNear + vec2(1e-6));
  float facing = dot(normal, LIGHT);
  scatter *= mix(0.34, 1.55, facing * 0.5 + 0.5);

  float scatterDeep = pow(length(gDeep) * 23.0, 1.58) *
                      mix(0.52, 1.30, dot(-normalize(gDeep + vec2(1e-6)), LIGHT) * 0.5 + 0.5);

  // Extinction.
  //
  // Light returning from the far side of a crowded patch has been through the
  // culture twice, so a dense region is dimmer than an isolated filament of the
  // same thickness. This is what gives the dish large-scale tone. Without it
  // every worm in the field is lit identically and the image is flat in the
  // specific way that reads as a pattern rather than as a photograph.
  float extinct = exp(-vHaze * 2.6);

  // ---- colour ------------------------------------------------------------
  // Fineness drives hue. A three-stop ramp, evaluated as two mixes so there is
  // no branch and no discontinuity at the join.
  float density = smoothstep(0.04, 0.40, V * 0.72 + vHaze * 0.28);
  vec3 tint = mix(mix(SCATTER_FINE, SCATTER_MID, clamp(density * 2.0, 0.0, 1.0)),
                  SCATTER_MASS, clamp(density * 2.0 - 1.0, 0.0, 1.0));

  // A film, not a rainbow.
  //
  // Thin-film colour is real and worth keeping, because it is what makes a wet
  // thing look wet. What was wrong before was the range. A film of this
  // thickness shifts along one axis — steel toward gold — over about one cycle
  // across the whole span of concentrations present, and it does it faintly.
  // Commitment and scarring both suppress it, because both describe a surface
  // that has stopped being wet.
  float wet = (1.0 - commit * 0.85) * (1.0 - min(scar * 1.6, 1.0));
  float fringe = sin(6.2831853 * (V * 2.4 + vDeep * 1.1));
  tint *= 1.0 + vec3(0.15, 0.01, -0.19) * fringe * 0.55 * wet;

  // Commitment reads as the medium hardening, and hardening is mostly a loss of
  // wetness: the film stops shifting (above), the highlight tightens, and the
  // colour moves a few degrees toward mineral. Deliberately quiet — a player
  // looking for it can see it; a player who is not will only notice that a
  // region stopped changing.
  scatter = pow(scatter, 1.0 + commit * 0.30) * (1.0 + commit * 0.22);
  tint = mix(tint, tint * vec3(0.84, 0.92, 1.02) + 0.015, commit * 0.55);

  vec3 col = vec3(0.0);

  // Deep first, occluded by whatever is above it. This is what makes one branch
  // pass in front of another instead of the two merging into one silhouette.
  float occlude = 1.0 - 0.72 * smoothstep(0.05, 0.40, V);
  col += tint * DEEP_TINT * scatterDeep * 0.17 * occlude * extinct;

  // Haze in the fluid: no structure of its own, just a cold glow where there is
  // a lot of material nearby. Kept low deliberately — the black between the
  // branches has to stay black, because in dark-field the emptiness is the
  // measurement.
  col += vec3(0.055, 0.105, 0.150) * smoothstep(0.04, 0.34, vHaze) * 0.19;

  // Body.
  //
  // Scatter alone lights the flanks of a filament and leaves its middle black,
  // because the middle has no gradient — which is true of dark-field and reads,
  // at this scale, as a field of hollow piping. A little bulk return puts a dim
  // warm body inside the structure so it has substance, and it is also the only
  // thing that shows a lobe the player has grown flat: a dark-field image is
  // selective, not blind.
  col += vec3(0.26, 0.25, 0.23) * smoothstep(0.06, 0.42, V) * 0.16 * extinct;

  // The near layer, at the glass, sharp.
  col += tint * scatter * 0.22 * extinct;

  // A tight glint on the steepest faces. Dark-field return is mostly diffuse,
  // but a front lying square to the illuminator throws back something much
  // harder and whiter than the rest — and it is those few glints that stop a
  // field of filaments reading as piped icing.
  float glint = pow(max(facing, 0.0), 9.0) * smoothstep(0.020, 0.075, slope);
  col += vec3(0.92, 0.96, 1.0) * glint * 0.42 * extinct;

  // ---- scar --------------------------------------------------------------
  // This has to survive every other decision in the file. Bleached and aspirated
  // ground is dead: it does not scatter, it does not shift colour, it does not
  // catch the raking light. What it holds instead is a flat, dry, slightly warm
  // stain that is legible against the black field as well as against the
  // culture, and a hard edge, because a photobleached disc has one. The player
  // must never have to hunt for the price they paid.
  float scarMask = min(scar * 1.35, 0.90);
  col = mix(col, col * vec3(0.30, 0.28, 0.26), scarMask);
  col += vec3(0.085, 0.070, 0.056) * scarMask;
  col += vec3(0.22, 0.18, 0.13) * clamp(length(gScar) * 22.0, 0.0, 1.1);

  // ---- thermal -----------------------------------------------------------
  col += vec3(0.26, 0.11, 0.045) * thermal * (0.62 + 0.38 * convect) * 0.42;

  col *= fluid;

  // ---- fluorescence probe -------------------------------------------------
  // The probe is beautiful, which is the point: it should be tempting. It is
  // also the one place in this image where saturated colour is allowed, because
  // it is the one place where the colour is not the specimen's — it is a
  // fluorophore being driven by an excitation source.
  if (uReveal > 0.001) {
    float d = length(duv - uRevealAt);
    float disc = smoothstep(uRevealRadius, uRevealRadius * 0.75, d);
    float edge = smoothstep(uRevealRadius, uRevealRadius * 0.95, d) -
                 smoothstep(uRevealRadius * 0.95, uRevealRadius * 0.86, d);
    vec3 fluoro = vec3(0.12, 1.0, 0.46) * pow(max(V, 0.0), 0.6) * 3.2;
    // The excitation beam scatters in the fluid whether or not it finds anything
    // to excite, so the disc is a lit field rather than a hole. Without this
    // term the probe reads as pure damage the instant it fires — which it partly
    // is, but the tempting half of the bargain has to be on screen too or there
    // is no bargain.
    col = mix(col, col * 0.22 + fluoro + vec3(0.008, 0.048, 0.026), disc * uReveal * fluid);
    col += vec3(0.16, 1.0, 0.52) * edge * uReveal * fluid * 1.1;
  }

  // ---- the target stencil -------------------------------------------------
  // Scribed into the glass rather than overlaid on the culture: sampled at the
  // undistorted coordinate, so it stays sharp and flat while the medium under it
  // is lensed and soft. That difference in plane is most of what stops it being
  // mistaken for something the medium is doing. The line is bevelled by the same
  // raking light as everything else, which is what makes it read as cut into a
  // surface rather than drawn on one.
  if (uTargetShow > 0.001) {
    vec2 to = uTexel * 2.0;
    float tc = texture(uTarget, duv).r;
    float tl = texture(uTarget, duv - vec2(to.x, 0.0)).r;
    float tr = texture(uTarget, duv + vec2(to.x, 0.0)).r;
    float td = texture(uTarget, duv - vec2(0.0, to.y)).r;
    float tu = texture(uTarget, duv + vec2(0.0, to.y)).r;
    vec2 gT = vec2(tr - tl, tu - td);
    float bevel = dot(normalize(gT + vec2(1e-6)), LIGHT) * 0.5 + 0.5;
    col += mix(vec3(0.06, 0.09, 0.13), vec3(0.38, 0.48, 0.60), bevel) * length(gT) * uTargetShow * 1.9;
    col += vec3(0.016, 0.023, 0.033) * tc * uTargetShow;
  }

  // ---- the rim -----------------------------------------------------------
  // Three separate things, and the grey vignette this replaced was none of them.
  //
  //   The fillet of fluid climbing the wall, which is wet and catches a specular
  //   arc on the side the light comes from.
  //   The contact line where fluid meets glass, which is dark, because at that
  //   angle the surface is reflecting the black field rather than the lamp.
  //   The wall itself, which is a lit cylinder — bright on the lit side, nearly
  //   black opposite — and not a uniform ring of grey.
  //
  // The fillet also carries information. Where the culture has reached the wall
  // it wets it differently and the ring thickens and brightens there, which is
  // the meniscus channel the design asks the player to learn to read, expressed
  // as a change in the picture rather than as a number.
  float lit = dot(dir, LIGHT);
  float rimV = texture(uState, clamp(0.5 + dir * 0.465, 0.0, 1.0)).g;
  float wetting = smoothstep(0.08, 0.34, rimV);

  // The fillet. Squared so it is steep only in the last few per cent, which is
  // what a wetting contact angle actually looks like from above.
  float fillet = fill * fill * fill * (0.55 + 0.45 * wetting) * smoothstep(1.010, 0.996, r);
  float spec = pow(max(lit, 0.0), 5.0) + pow(max(-lit, 0.0), 14.0) * 0.30;
  col += vec3(0.30, 0.40, 0.50) * fillet * (0.020 + 0.55 * spec);
  // A second, tighter highlight riding the very top of the fillet: the thin
  // bright line that says "this is a curved water surface" rather than "this is
  // a soft edge". It never goes fully dark, even on the side facing away from
  // the lamp, because the fillet turns through ninety degrees and something on
  // it is always square to the light.
  float crest = exp(-pow((r - 0.9895) / 0.0050, 2.0));
  col += vec3(0.46, 0.58, 0.70) * crest * (0.24 + 0.80 * max(lit, 0.0)) * (0.5 + 0.7 * wetting);

  // The contact line, where the fluid meets the glass. Multiplicative, not
  // subtractive: subtracting punched the ring to absolute black on the unlit
  // side, which read as a gap in the dish rather than as a dark line on it.
  col *= 1.0 - 0.55 * exp(-pow((r - 1.0015) / 0.0038, 2.0));
  // The groove just inside the contact, which is what makes the meniscus read
  // as a channel cut round the edge rather than as a bright ring stuck on.
  col *= 1.0 - 0.28 * exp(-pow((r - 0.9735) / 0.0085, 2.0));

  // The glass wall. Dim, and narrow: it is the frame of the picture and it has
  // no business competing with the specimen for attention.
  float wall = smoothstep(1.000, 1.012, r) * smoothstep(1.075, 1.020, r);
  col += vec3(0.026, 0.036, 0.050) * wall * (0.08 + 0.90 * max(lit, 0.0));
  // The outside edge of the glass picks up a thin, dim line all the way round,
  // because it is a ground cylinder and every ground edge does.
  col += vec3(0.055, 0.072, 0.090) * exp(-pow((r - 1.072) / 0.005, 2.0)) * (0.15 + 0.60 * max(lit, 0.0));

  // Stray light in the condenser. A true zero field reads as a hole punched in
  // the monitor; a very slightly lifted, very slightly cool one reads as an
  // instrument in a dark room.
  col += vec3(0.0016, 0.0022, 0.0034) * smoothstep(1.06, 0.98, r);

  frag = vec4(max(col, 0.0), 1.0);
}`;

export class DishRenderer {
  constructor(gl) {
    this.gl = gl;
    this.program = createProgram(gl, FULLSCREEN_VS, FS, 'dish');
    this.vao = createFullscreenVao(gl);
    this.post = new Post(gl);

    this.exposure = 1.0;
    /** Veiling glare strength. 0 turns the post chain's contribution off. */
    this.glare = 0.45;
    this.reveal = 0;
    this.revealAt = [0.5, 0.5];
    this.revealRadius = 0.12;
    this.targetShow = 1.0;
    this.targetTex = null;

    // The medium's textures are NEAREST, because its own passes sample at exact
    // texel centres and want no filtering. This renderer samples between them,
    // and without interpolation every branch is drawn with a staircase along its
    // edge. A sampler object overrides the filter for these texture units only,
    // so the simulation is untouched — the alternative would be reaching into
    // sim/medium.js to change a parameter that renderer taste has no business
    // owning.
    //
    // Guarded, because a 32-bit float texture is only filterable with the
    // extension. Asking for LINEAR without it does not degrade, it makes the
    // texture incomplete, and every sample comes back black — a blank dish with
    // no error anywhere, which is the worst way for a renderer to fail.
    this.linear = null;
    if (gl.getExtension('OES_texture_float_linear')) {
      this.linear = gl.createSampler();
      gl.samplerParameteri(this.linear, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.samplerParameteri(this.linear, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.samplerParameteri(this.linear, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.samplerParameteri(this.linear, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
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
    this.post.begin(width, height);

    gl.useProgram(this.program.program);
    const u = this.program.uniforms;
    gl.uniform1i(u.uState, 0);
    gl.uniform1i(u.uParams, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, medium.stateTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, medium.paramTex);
    if (this.linear) { gl.bindSampler(0, this.linear); gl.bindSampler(1, this.linear); }

    gl.uniform2f(u.uTexel, 1 / medium.size, 1 / medium.size);
    gl.uniform2f(u.uRes, width, height);
    gl.uniform1f(u.uTime, time);
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

    // Hand the units back exactly as they were found. Leaving a sampler bound
    // would silently apply this renderer's filtering to the simulation's own
    // passes, which share these units — a defect that would show up as a subtly
    // wrong Laplacian and be blamed on the chemistry.
    if (this.linear) { gl.bindSampler(0, null); gl.bindSampler(1, null); }

    this.post.finish({ exposure: this.exposure, glare: this.glare });
  }
}
