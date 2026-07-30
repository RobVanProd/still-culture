// Immediate-mode batch renderer for lines, triangles and points.
//
// Every concept in this project is a field, a network or a substance rather than
// a world of sprites, so what is actually needed is the ability to throw a large
// number of coloured primitives at the screen each frame without thinking about
// buffers. One dynamic buffer per primitive type, refilled and uploaded once,
// drawn once.
//
// Deliberately not a scene graph, not a sprite system, and not retained. Retained
// renderers are faster in theory and slower to work with in practice, and this
// project's bottleneck is iteration speed, not draw calls.

import { createProgram, createMesh } from '../core/gl.js';

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aColor;
uniform vec2 uViewPos;
uniform vec2 uViewScale;
out vec4 vColor;
void main() {
  vColor = aColor;
  vec2 p = (aPos - uViewPos) * uViewScale;
  gl_Position = vec4(p, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;

const FS = `#version 300 es
precision highp float;
in vec4 vColor;
out vec4 frag;
void main() { frag = vColor; }`;

const FLOATS_PER_VERT = 6; // x y r g b a

export class Batch {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {number} maxVerts per primitive type
   */
  constructor(gl, maxVerts = 65536) {
    this.gl = gl;
    this.maxVerts = maxVerts;

    this.shader = createProgram(gl, VS, FS, 'batch');

    const layout = [
      { location: 0, size: 2 },
      { location: 1, size: 4 },
    ];

    this.tri = {
      mesh: createMesh(gl, layout, { dynamic: true, capacityVerts: maxVerts }),
      data: new Float32Array(maxVerts * FLOATS_PER_VERT),
      count: 0,
    };
    this.line = {
      mesh: createMesh(gl, layout, { dynamic: true, capacityVerts: maxVerts }),
      data: new Float32Array(maxVerts * FLOATS_PER_VERT),
      count: 0,
    };

    // View in world units. Set by the game each frame.
    this.viewX = 0;
    this.viewY = 0;
    this.scaleX = 1;
    this.scaleY = 1;

    this.dropped = 0;
  }

  /** Half-extents of the visible world, centred on (x, y). */
  setView(x, y, halfWidth, halfHeight) {
    this.viewX = x;
    this.viewY = y;
    this.scaleX = 1 / halfWidth;
    this.scaleY = 1 / halfHeight;
  }

  begin() {
    this.tri.count = 0;
    this.line.count = 0;
    this.dropped = 0;
  }

  _push(target, x, y, r, g, b, a) {
    if (target.count >= this.maxVerts) { this.dropped++; return; }
    const i = target.count * FLOATS_PER_VERT;
    const d = target.data;
    d[i] = x; d[i + 1] = y;
    d[i + 2] = r; d[i + 3] = g; d[i + 4] = b; d[i + 5] = a;
    target.count++;
  }

  triangle(x0, y0, x1, y1, x2, y2, c) {
    this._push(this.tri, x0, y0, c[0], c[1], c[2], c[3]);
    this._push(this.tri, x1, y1, c[0], c[1], c[2], c[3]);
    this._push(this.tri, x2, y2, c[0], c[1], c[2], c[3]);
  }

  /** Axis-aligned quad. */
  quad(x, y, w, h, c) {
    const x1 = x + w, y1 = y + h;
    this.triangle(x, y, x1, y, x1, y1, c);
    this.triangle(x, y, x1, y1, x, y1, c);
  }

  /** Quad with a per-corner colour, for gradients without a shader. */
  quadShaded(x, y, w, h, c00, c10, c11, c01) {
    const x1 = x + w, y1 = y + h;
    this._push(this.tri, x, y, c00[0], c00[1], c00[2], c00[3]);
    this._push(this.tri, x1, y, c10[0], c10[1], c10[2], c10[3]);
    this._push(this.tri, x1, y1, c11[0], c11[1], c11[2], c11[3]);
    this._push(this.tri, x, y, c00[0], c00[1], c00[2], c00[3]);
    this._push(this.tri, x1, y1, c11[0], c11[1], c11[2], c11[3]);
    this._push(this.tri, x, y1, c01[0], c01[1], c01[2], c01[3]);
  }

  /**
   * Thick line as a quad. GL's own line width is capped at 1 on essentially
   * every modern driver, so any line that must be visible at a glance has to be
   * geometry.
   */
  thickLine(x0, y0, x1, y1, width, c) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const nx = (-dy / len) * width * 0.5;
    const ny = (dx / len) * width * 0.5;
    this.triangle(x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, c);
    this.triangle(x0 + nx, y0 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny, c);
  }

  /** Tapered line — width and colour interpolate along it. */
  taperedLine(x0, y0, x1, y1, w0, w1, c0, c1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const ux = -dy / len, uy = dx / len;
    const a0x = x0 + ux * w0 * 0.5, a0y = y0 + uy * w0 * 0.5;
    const b0x = x0 - ux * w0 * 0.5, b0y = y0 - uy * w0 * 0.5;
    const a1x = x1 + ux * w1 * 0.5, a1y = y1 + uy * w1 * 0.5;
    const b1x = x1 - ux * w1 * 0.5, b1y = y1 - uy * w1 * 0.5;

    this._push(this.tri, a0x, a0y, c0[0], c0[1], c0[2], c0[3]);
    this._push(this.tri, a1x, a1y, c1[0], c1[1], c1[2], c1[3]);
    this._push(this.tri, b1x, b1y, c1[0], c1[1], c1[2], c1[3]);
    this._push(this.tri, a0x, a0y, c0[0], c0[1], c0[2], c0[3]);
    this._push(this.tri, b1x, b1y, c1[0], c1[1], c1[2], c1[3]);
    this._push(this.tri, b0x, b0y, c0[0], c0[1], c0[2], c0[3]);
  }

  /** Hairline, for grids and diagnostics where exactly one pixel is wanted. */
  line2(x0, y0, x1, y1, c) {
    this._push(this.line, x0, y0, c[0], c[1], c[2], c[3]);
    this._push(this.line, x1, y1, c[0], c[1], c[2], c[3]);
  }

  circle(cx, cy, radius, c, segments = 0) {
    const n = segments || Math.max(8, Math.min(64, Math.ceil(radius * 0.8) + 8));
    let px = cx + radius, py = cy;
    for (let i = 1; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * radius;
      const y = cy + Math.sin(a) * radius;
      this.triangle(cx, cy, px, py, x, y, c);
      px = x; py = y;
    }
  }

  ring(cx, cy, radius, width, c, segments = 0) {
    const n = segments || Math.max(12, Math.min(96, Math.ceil(radius) + 12));
    let px = cx + radius, py = cy;
    for (let i = 1; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * radius;
      const y = cy + Math.sin(a) * radius;
      this.thickLine(px, py, x, y, width, c);
      px = x; py = y;
    }
  }

  /** Upload and draw. Triangles first, so hairlines read on top. */
  flush() {
    const gl = this.gl;
    gl.useProgram(this.shader.program);
    gl.uniform2f(this.shader.uniforms.uViewPos, this.viewX, this.viewY);
    gl.uniform2f(this.shader.uniforms.uViewScale, this.scaleX, this.scaleY);

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    for (const [target, mode] of [[this.tri, gl.TRIANGLES], [this.line, gl.LINES]]) {
      if (target.count === 0) continue;
      target.mesh.upload(target.data, target.count * FLOATS_PER_VERT);
      gl.bindVertexArray(target.mesh.vao);
      gl.drawArrays(mode, 0, target.count);
    }
    gl.bindVertexArray(null);
  }

  stats() {
    return { triVerts: this.tri.count, lineVerts: this.line.count, dropped: this.dropped };
  }
}

/** Additive blending, for anything that should read as light rather than paint. */
export function additive(gl, on = true) {
  gl.enable(gl.BLEND);
  if (on) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  else gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
}
