// WebGL2 helpers.
//
// Thin on purpose. This is not a renderer and must not become one — it is the
// small amount of boilerplate that is identical in every WebGL project, with
// the error reporting that the raw API refuses to give you.
//
// The single most valuable thing here is shader compilation that prints the
// offending line. WebGL's default failure is a log referring to a line number in
// a source string you never see, which turns a typo into a ten-minute hunt.

export function createContext(canvas, opts = {}) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    depth: true,
    stencil: false,
    antialias: false,          // we resolve our own AA in post; MSAA on the
                               // default framebuffer costs more and helps less
    premultipliedAlpha: false,
    preserveDrawingBuffer: true, // screenshots must be able to read the buffer
    powerPreference: 'high-performance',
    desynchronized: true,
    ...opts,
  });

  if (!gl) {
    throw new Error('WebGL2 is unavailable. This game requires a WebGL2 browser.');
  }
  return gl;
}

function compile(gl, type, source, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;

  const log = gl.getShaderInfoLog(sh) || '';
  // Point at the actual line. Drivers report "ERROR: 0:37: ..." and expect you
  // to count.
  const lines = source.split('\n');
  const annotated = log.replace(/(\d+):(\d+)/g, (m, _f, ln) => {
    const n = parseInt(ln, 10);
    const src = lines[n - 1];
    return src ? `${m}\n      >>> ${src.trim()}` : m;
  });
  gl.deleteShader(sh);
  throw new Error(`[${label}] ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader failed:\n${annotated}`);
}

export function createProgram(gl, vertexSource, fragmentSource, label = 'program') {
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource, label);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, label);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`[${label}] link failed:\n${log}`);
  }

  // Cache uniform locations up front. Looking them up per draw is a string hash
  // in the hot path for no reason.
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(p, name);
  }

  const attribs = {};
  const an = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < an; i++) {
    const info = gl.getActiveAttrib(p, i);
    if (!info) continue;
    attribs[info.name] = gl.getAttribLocation(p, info.name);
  }

  return { program: p, uniforms, attribs, label };
}

/**
 * A full-screen triangle, not a quad.
 *
 * One triangle covering the viewport beats two: no diagonal seam where
 * derivatives go wrong, and one fewer vertex to no benefit. The vertices are
 * generated in the vertex shader from gl_VertexID, so this needs no buffer at
 * all — just an empty VAO to satisfy the API.
 */
export const FULLSCREEN_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function createFullscreenVao(gl) {
  return gl.createVertexArray();
}

/** Dynamic vertex buffer with a declared layout. */
export function createMesh(gl, layout, { dynamic = false, capacityVerts = 1024 } = {}) {
  const stride = layout.reduce((s, a) => s + a.size, 0) * 4;
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, capacityVerts * stride, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);

  let offset = 0;
  for (const a of layout) {
    gl.enableVertexAttribArray(a.location);
    gl.vertexAttribPointer(a.location, a.size, gl.FLOAT, false, stride, offset);
    if (a.divisor) gl.vertexAttribDivisor(a.location, a.divisor);
    offset += a.size * 4;
  }
  gl.bindVertexArray(null);

  return {
    vao, vbo, stride,
    floatsPerVert: stride / 4,
    upload(data, count) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count);
    },
  };
}

/** Off-screen colour target. Float when available, for HDR before tonemapping. */
export function createTarget(gl, width, height, { float = true, depth = false } = {}) {
  const fbo = gl.createFramebuffer();
  const tex = gl.createTexture();

  const hasFloat = float && gl.getExtension('EXT_color_buffer_float');
  const internal = hasFloat ? gl.RGBA16F : gl.RGBA8;
  const type = hasFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  let depthBuffer = null;
  if (depth) {
    depthBuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
  }

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`render target incomplete: 0x${status.toString(16)}`);
  }

  return { fbo, tex, depthBuffer, width, height, hdr: !!hasFloat };
}

/**
 * Size the drawing buffer to the element, honouring device pixel ratio but
 * capped. An uncapped DPR on a 4K display quadruples the pixel cost for a
 * difference nobody can see at arm's length, and it is the single most common
 * reason a browser game is mysteriously slow on good hardware.
 */
export function resizeToDisplay(gl, canvas, maxDpr = 2) {
  const dpr = Math.min(devicePixelRatio || 1, maxDpr);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    gl.viewport(0, 0, w, h);
    return true;
  }
  return false;
}
