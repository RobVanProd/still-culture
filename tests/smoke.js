// Scripted smoke test.
//
// Run from the page console or, more usually, injected by the harness driving
// the browser:
//
//   const { runSmoke } = await import('/tests/smoke.js'); return runSmoke();
//
// It returns a plain object so a caller with no eyes can read the result. Every
// check states what it actually verified, because "12 passed" tells you nothing
// about what was covered when a later change quietly stops exercising something.

import { Rng, seedFrom } from '../src/core/rng.js';
import { Loop } from '../src/core/loop.js';

const results = [];

function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, pass: true, detail: detail ?? null });
  } catch (err) {
    results.push({ name, pass: false, detail: String(err && err.message || err) });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function runSmoke() {
  results.length = 0;

  check('rng: same seed gives the same sequence', () => {
    const a = new Rng(12345), b = new Rng(12345);
    for (let i = 0; i < 1000; i++) {
      assert(a.next() === b.next(), `diverged at ${i}`);
    }
    return '1000 draws identical';
  });

  check('rng: different seeds diverge', () => {
    const a = new Rng(1), b = new Rng(2);
    let same = 0;
    for (let i = 0; i < 1000; i++) if (a.next() === b.next()) same++;
    assert(same < 5, `${same} collisions in 1000 — suspiciously correlated`);
    return `${same} incidental collisions`;
  });

  check('rng: float stays in [0,1)', () => {
    const r = new Rng(seedFrom('range-check'));
    let lo = 1, hi = 0;
    for (let i = 0; i < 100000; i++) {
      const v = r.float();
      assert(v >= 0 && v < 1, `out of range: ${v}`);
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    return `min ${lo.toFixed(6)} max ${hi.toFixed(6)}`;
  });

  check('rng: mean is near 0.5 over 100k', () => {
    const r = new Rng(seedFrom('mean-check'));
    let sum = 0;
    for (let i = 0; i < 100000; i++) sum += r.float();
    const mean = sum / 100000;
    assert(Math.abs(mean - 0.5) < 0.01, `mean ${mean}`);
    return `mean ${mean.toFixed(5)}`;
  });

  check('rng: forked streams are independent of sibling consumption', () => {
    // The property that matters: adding draws to one system must not shift
    // another system's sequence.
    const parentA = new Rng(999);
    const sysA1 = parentA.fork(1), sysB1 = parentA.fork(2);
    for (let i = 0; i < 50; i++) sysA1.next();
    const b1 = sysB1.next();

    const parentB = new Rng(999);
    const sysA2 = parentB.fork(1), sysB2 = parentB.fork(2);
    for (let i = 0; i < 5000; i++) sysA2.next();   // system A got much busier
    const b2 = sysB2.next();

    assert(b1 === b2, 'sibling stream shifted when the other consumed more');
    return 'stream B unaffected by 100x consumption in stream A';
  });

  check('seedFrom: stable and well spread', () => {
    assert(seedFrom('abc') === seedFrom('abc'), 'not stable');
    const seen = new Set();
    for (let i = 0; i < 500; i++) seen.add(seedFrom('scenario-' + i));
    assert(seen.size === 500, `${500 - seen.size} collisions`);
    return '500 distinct names, 0 collisions';
  });

  check('loop: headless stepping advances exactly', () => {
    let ticks = 0;
    const loop = new Loop({ hz: 120, update: () => { ticks++; }, render: () => {} });
    loop.stepHeadless(360);
    assert(ticks === 360, `ticks ${ticks}`);
    assert(Math.abs(loop.simTime - 3.0) < 1e-9, `simTime ${loop.simTime}`);
    return '360 steps = 3.000s at 120Hz';
  });

  check('loop: simulation is a pure function of steps taken', () => {
    const build = () => {
      const r = new Rng(4242);
      let acc = 0;
      const loop = new Loop({ hz: 120, update: (dt) => { acc += r.float() * dt; }, render: () => {} });
      loop.stepHeadless(1000);
      return acc;
    };
    const a = build(), b = build();
    assert(a === b, `${a} !== ${b}`);
    return `identical after 1000 steps (${a.toFixed(9)})`;
  });

  check('loop: catch-up is bounded', () => {
    // A backgrounded tab must not try to simulate the whole gap on return.
    let ticks = 0;
    const loop = new Loop({ hz: 120, maxCatchUp: 5, update: () => { ticks++; }, render: () => {} });
    loop.running = true;
    loop._last = 0;
    loop._frame(10000); // pretend ten seconds passed
    assert(ticks <= 5, `simulated ${ticks} steps for a 10s gap`);
    loop.stop();
    return `${ticks} steps for a 10s stall (cap 5)`;
  });

  const live = globalThis.GAME;
  check('runtime: GAME is exposed and healthy', () => {
    assert(live && live.ready, 'GAME missing');
    assert(live.gl, 'no GL context');
    const fatal = document.getElementById('fatal');
    assert(!fatal || !fatal.textContent, `page reported a fatal error: ${fatal && fatal.textContent}`);
    return 'GAME.ready, GL live, no fatal errors on page';
  });

  check('runtime: WebGL2 capabilities meet requirements', () => {
    const gl = live.gl;
    assert(gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 4096, 'max texture too small');
    assert(gl.getExtension('EXT_color_buffer_float'), 'no float colour buffers — HDR unavailable');
    return `maxTex ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}, float targets available`;
  });

  const passed = results.filter(r => r.pass).length;
  return {
    passed,
    failed: results.length - passed,
    ok: passed === results.length,
    results,
  };
}
