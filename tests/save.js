// Save, replay and trace checks.
//
//   const t = await import('/tests/save.js'); await t.runSaveTests(GAME);
//
// Returns the same shape as smoke.js so a caller with no eyes can read it.
//
// The claim under test is narrow and total: a dish restored from a save is the
// same dish, to the bit. Anything short of that — "close enough", "looks the
// same" — would mean the field is no longer a pure function of the input
// stream, and every determinism claim in this repository rests on that one
// property. So the check is a hash of all four channels of all 262,144 texels,
// not a summary statistic that could agree by accident.
//
// These tests replace the dish being played. The last one puts a fresh
// `dish-001` back.

import {
  attachRecorder, recorderFor, replay, restore, saveSession, loadSave, deleteSave,
  listSaves, encodeToString, decodeFromString, measureReplayCost, asEventStream,
} from '../src/game/save.js';
import { Trace, RESPONSE_WINDOW } from '../src/game/trace.js';
import { Settings } from '../src/game/settings.js';

const results = [];

function check(name, fn) {
  try {
    const detail = fn();
    results.push({ name, pass: true, detail: detail ?? null });
  } catch (err) {
    results.push({ name, pass: false, detail: String((err && err.message) || err) });
  }
}

async function checkAsync(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, pass: true, detail: detail ?? null });
  } catch (err) {
    results.push({ name, pass: false, detail: String((err && err.message) || err) });
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---------------------------------------------------------------------------

let hashBuf = null;

/**
 * FNV-1a over the raw bits of the whole state field.
 *
 * Over the bits rather than the values: two floats that print the same can
 * differ, and the point of this test is to catch exactly that.
 */
function fieldHash(GAME) {
  const buf = GAME.medium.readState(hashBuf);
  hashBuf = buf;
  const words = new Uint32Array(buf.buffer, buf.byteOffset, buf.length);
  let h = 0x811c9dc5;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    h = Math.imul(h ^ (w & 0xffff), 0x01000193);
    h = Math.imul(h ^ (w >>> 16), 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A scripted session, standing in for a player.
 *
 * It has to exercise the held path rather than only single clicks, because
 * held input is the case that is a hundred and twenty events a second and the
 * case a naive recorder gets one tick out of place.
 */
function scriptedPlay(GAME, { seed = 'save-test', seconds = 40 } = {}) {
  const loop = GAME.loop;
  const session = GAME.newDish(seed, 'coral', 600);
  const ticks = Math.round(seconds / loop.stepSec);
  const STRIDE = 6;   // twenty applications a second, as a hand would produce

  for (let t = 0; t < ticks; t += STRIDE) {
    const now = t * loop.stepSec;

    if (Math.abs(now - 12) < loop.stepSec * STRIDE * 0.5) {
      session.tool = 'fluoresce';
      session.brushRadius = 0.12;
      session.use(0.46, 0.52, { held: false });
    } else if (Math.abs(now - 30) < loop.stepSec * STRIDE * 0.5) {
      session.tool = 'aspirate';
      session.use(0.58, 0.44, { held: false });
    } else {
      const phase = Math.floor(now / 6) % 2;
      session.tool = phase === 0 ? 'nutrient' : 'shade';
      session.brushRadius = 0.09 + phase * 0.03;
      const a = now * 0.21;
      session.use(0.5 + Math.cos(a) * 0.17, 0.5 + Math.sin(a) * 0.17, { held: true });
    }

    loop.stepHeadless(Math.min(STRIDE, ticks - t));
  }
  return session;
}

// ---------------------------------------------------------------------------

export async function runSaveTests(GAME, { cost = true, costDuration = 600 } = {}) {
  results.length = 0;
  assert(GAME && GAME.ready, 'GAME not ready');

  const rec = attachRecorder(GAME);

  // --- recording ----------------------------------------------------------

  const session = scriptedPlay(GAME);
  const original = {
    hash: fieldHash(GAME),
    measure: GAME.measure(),
    log: JSON.stringify(session.log),
    tick: GAME.loop.tick,
  };
  const record = rec.snapshotRecord();

  check('recorder: captured the scripted input stream', () => {
    assert(record.seed === 'save-test', `seed ${record.seed}`);
    assert(record.events.count > 100, `only ${record.events.count} events captured`);
    assert(record.tickCount <= GAME.loop.tick + 1, `tickCount ${record.tickCount} past the clock ${GAME.loop.tick}`);
    return `${record.events.count} events, ${record.tickCount} ticks, ${(record.events.count * 56 / 1024).toFixed(1)} KiB`;
  });

  check('recorder: ticks are non-decreasing and inside the session', () => {
    const ev = asEventStream(record.events);
    let last = -1;
    for (let i = 0; i < ev.count; i++) {
      const t = ev.tickAt(i);
      assert(t >= last, `event ${i} went backwards: ${t} after ${last}`);
      assert(t <= record.tickCount, `event ${i} at tick ${t}, past ${record.tickCount}`);
      last = t;
    }
    return `${ev.count} events ordered, last at tick ${last}`;
  });

  // --- the central claim --------------------------------------------------

  check('replay: the restored field is bit-identical', () => {
    const r = replay(GAME, record);
    const after = fieldHash(GAME);
    assert(after === original.hash, `field hash ${after} != ${original.hash}`);
    return `${r.ticks} ticks, ${r.events} events, ${r.ms} ms, hash ${after}`;
  });

  check('replay: the derived measurements agree exactly', () => {
    const m = GAME.measure();
    for (const k of ['mass', 'scar', 'commit', 'coverage']) {
      assert(m[k] === original.measure[k], `${k}: ${m[k]} != ${original.measure[k]}`);
    }
    return `mass ${m.mass.toFixed(6)} scar ${m.scar.toFixed(6)} coverage ${m.coverage.toFixed(6)}`;
  });

  check('replay: the intervention log is reproduced entry for entry', () => {
    const now = JSON.stringify(GAME.session.log);
    assert(now === original.log,
      `log differs: ${GAME.session.log.length} entries against ${JSON.parse(original.log).length}`);
    return `${GAME.session.log.length} entries identical`;
  });

  check('replay: probe charges are spent the same way', () => {
    const c = GAME.session.charges;
    assert(c.fluoresce === 3, `fluoresce ${c.fluoresce}, expected 3`);
    assert(c.aspirate === 1, `aspirate ${c.aspirate}, expected 1`);
    return `fluoresce ${c.fluoresce}, aspirate ${c.aspirate}`;
  });

  check('replay: a partial replay lands on the same field as a resumed one', () => {
    // The scrub bar depends on this. Continuing forward from where the medium
    // already is must produce what starting over would have produced.
    const half = Math.floor(record.tickCount / 2);
    replay(GAME, record, { toTick: half });
    const direct = fieldHash(GAME);
    replay(GAME, record, { toTick: record.tickCount, resume: true });
    const resumed = fieldHash(GAME);

    replay(GAME, record);
    const fresh = fieldHash(GAME);
    assert(resumed === fresh, `resumed ${resumed} != fresh ${fresh}`);
    return `halfway ${direct}, resumed to end ${resumed}, matches fresh replay`;
  });

  // --- storage ------------------------------------------------------------

  check('save: the text form round-trips the stream exactly', () => {
    const text = encodeToString(record);
    const back = decodeFromString(text);
    const a = asEventStream(record.events), b = asEventStream(back.events);
    assert(b.count === a.count, `${b.count} events against ${a.count}`);
    for (let i = 0; i < a.count * 2; i++) assert(a.meta[i] === b.meta[i], `meta[${i}] differs`);
    for (let i = 0; i < a.count * 6; i++) {
      // Bit-exact, not near: a brush centre that has been through a lossy
      // encoder is a different dish ten minutes later.
      assert(a.geo[i] === b.geo[i], `geo[${i}] ${a.geo[i]} != ${b.geo[i]}`);
    }
    assert(back.seed === record.seed && back.tickCount === record.tickCount, 'header lost');
    return `${(text.length / 1024).toFixed(1)} KiB of text, ${a.count} events exact`;
  });

  await checkAsync('save: persisted and loaded from IndexedDB, then replayed identically', async () => {
    await saveSession(GAME, { slot: 'test-slot', label: 'save test' });
    // The index is what a title screen reads to decide whether to offer a
    // "continue", and it must not need IndexedDB opened to answer that.
    assert(listSaves().some(s => s.slot === 'test-slot'), 'the save is not in the index');
    const loaded = await loadSave('test-slot');
    assert(loaded, 'nothing came back from storage');
    assert(loaded.seed === record.seed, `seed ${loaded.seed}`);

    // Disturb the game first, so a pass cannot come from nothing having moved.
    GAME.newDish('some-other-dish', 'coral', 600);
    GAME.loop.stepHeadless(600);
    assert(fieldHash(GAME) !== original.hash, 'the disturbance did nothing — the test proves nothing');

    await restore(GAME, loaded);
    const after = fieldHash(GAME);
    assert(after === original.hash, `restored hash ${after} != ${original.hash}`);
    await deleteSave('test-slot');
    assert(!listSaves().some(s => s.slot === 'test-slot'), 'deleting left the index entry behind');
    return `round trip through IndexedDB, hash ${after}`;
  });

  check('save: restoring leaves the recorder able to carry on', () => {
    const live = recorderFor(GAME);
    assert(live, 'recorder detached');
    assert(live.record.seed === record.seed, `recorder holds ${live.record.seed}`);
    const before = live.record.events.count;
    GAME.session.tool = 'thermal';
    GAME.session.use(0.5, 0.5, { held: true });
    assert(live.record.events.count === before + 1,
      `recording stopped: ${live.record.events.count} against ${before}`);
    return `record continues at ${live.record.events.count} events`;
  });

  // --- the trace ----------------------------------------------------------

  const trace = Trace.fromRecord(record);

  check('trace: strokes are merged into bands and probes stay instants', () => {
    assert(trace.bands.length > 0, 'no bands built');
    const probes = trace.bands.filter(b => b.kind === 'fluoresce' || b.kind === 'aspirate');
    assert(probes.length === 2, `${probes.length} probe bands, expected 2`);
    assert(probes.every(b => b.instant), 'a probe was merged into a span');
    const held = trace.bands.filter(b => !b.instant);
    assert(held.length > 0, 'no held bands');
    assert(held.every(b => b.t1 > b.t0), 'a held band has no duration');
    return `${trace.bands.length} bands, ${held.length} strokes, ${probes.length} probes`;
  });

  check('trace: at(t) returns what was happening then, and what caused it', () => {
    // Pick a moment inside a known stroke and check the band covering it is the
    // one the log says was in use.
    const stroke = trace.bands.find(b => !b.instant && b.t1 - b.t0 > 2);
    assert(stroke, 'no stroke long enough to probe');
    const mid = (stroke.t0 + stroke.t1) / 2;
    const a = trace.at(mid);
    assert(a.active.some(b => b === stroke), `active at ${mid.toFixed(1)} did not include the stroke`);
    assert(a.active.every(b => mid >= b.t0 && mid <= b.t1), 'active band does not span t');

    // Nothing outside the response window may be offered as a cause.
    assert(a.causedBy.every(b => b.t1 >= mid - RESPONSE_WINDOW && b.t0 <= mid),
      'causedBy reached outside the response window');
    assert(a.causedBy.length >= a.active.length, 'causedBy is narrower than active');

    // Before the first probe, both charges are untouched.
    const early = trace.at(1);
    assert(early.charges.fluoresce === 4 && early.charges.aspirate === 2,
      `charges at t=1 were ${JSON.stringify(early.charges)}`);
    const late = trace.at(35);
    assert(late.charges.fluoresce === 3 && late.charges.aspirate === 1,
      `charges at t=35 were ${JSON.stringify(late.charges)}`);
    return `at ${mid.toFixed(1)}s: ${a.active.map(b => b.kind).join(',')} active, ` +
           `${a.causedBy.length} in the ${RESPONSE_WINDOW}s window`;
  });

  check('trace: the waste verdict agrees with the assay', () => {
    // The trace exists to explain the score. A trace that disagrees with the
    // scoring is worse than no trace, so the two are compared rather than
    // assumed to match. Scored against the live log, which by now carries the
    // extra intervention the previous check made.
    const scored = GAME.session.assay();
    const live = Trace.fromRecord({ ...record, log: GAME.session.log.slice() });
    const traceWasted = live.probes.filter(p => p.wasted).length;
    assert(live.probes.length === scored.probes, `${live.probes.length} probes, assay counted ${scored.probes}`);
    assert(traceWasted === scored.wasted, `assay says ${scored.wasted} wasted, trace says ${traceWasted}`);
    return `${scored.probes} probes, ${scored.wasted} bought nothing — assay and trace agree`;
  });

  check('trace: seeking forward resumes, seeking back starts over, both land right', () => {
    trace.invalidateCursor();
    const stepSec = GAME.loop.stepSec;
    const midTick = Math.floor(record.tickCount * 0.6);

    const a = trace.seek(GAME, midTick * stepSec);
    const hashMid = fieldHash(GAME);
    assert(!a.resumed, 'the first seek should not have resumed');

    const b = trace.seek(GAME, record.tickCount * stepSec);
    assert(b.resumed, 'a forward seek did not resume');
    assert(b.ticksRun < record.tickCount, `forward seek re-ran ${b.ticksRun} of ${record.tickCount} ticks`);
    assert(fieldHash(GAME) === original.hash, 'seeking to the end did not reproduce the end');

    // Backwards there is no resume to be had, and it must still land exactly
    // where the first seek did.
    const c = trace.seek(GAME, midTick * stepSec);
    assert(!c.resumed, 'a backward seek claimed to resume');
    assert(fieldHash(GAME) === hashMid, 'backward seek landed somewhere else');
    return `forward ${b.ticksRun} ticks in ${b.ms} ms (resumed), ` +
           `backward ${c.ticksRun} ticks in ${c.ms} ms (restarted)`;
  });

  check('trace: the field series samples what the medium did', () => {
    const s = trace.series(GAME, { every: 5, grid: true });
    assert(s.samples.length >= 5, `${s.samples.length} samples`);
    assert(s.samples[0].t === 0, `first sample at ${s.samples[0].t}`);
    assert(s.samples.every(x => x.grid && x.grid.length === 16 * 16 * 4), 'a sample lost its grid');
    // Distinct grids: a reused buffer that was not copied would make every
    // sample identical, and the graph would be a flat line nobody questioned.
    const first = s.samples[0].grid, last = s.samples[s.samples.length - 1].grid;
    assert(first !== last, 'samples share one buffer');
    let differs = false;
    for (let i = 0; i < first.length && !differs; i++) if (first[i] !== last[i]) differs = true;
    assert(differs, 'first and last samples are identical — the buffer was not copied');
    const aligned = trace.align(s);
    assert(aligned.length === s.samples.length, 'align dropped samples');
    return `${s.samples.length} samples in ${s.ms} ms, mass ${s.samples[0].mass.toFixed(4)} -> ` +
           `${s.samples[s.samples.length - 1].mass.toFixed(4)}`;
  });

  check('trace: the summary counts what the session contained', () => {
    const sum = trace.summary();
    assert(sum.probes === 2, `${sum.probes} probes`);
    assert(sum.seed === record.seed, 'wrong dish');
    assert(sum.spent.nutrient > 0 && sum.spent.shade > 0, `spent ${JSON.stringify(sum.spent)}`);
    assert(sum.firstIntervention !== null && sum.firstIntervention < 5, `first at ${sum.firstIntervention}`);
    return JSON.stringify(sum.spent) + `, first at ${sum.firstIntervention}s`;
  });

  // --- the other half of the recording problem -----------------------------
  //
  // Last of the replay checks rather than first, because it replaces the dish
  // and the recorder's record, and everything above still needs the scripted
  // session.

  check('recorder: input arriving inside the fixed step lands on the right tick', () => {
    // The scripted play above drives the session from outside `loop.update`,
    // which is how the policy harness works but not how a player does. A held
    // mouse is read inside the step, by which point the loop has already
    // incremented its tick, and an input stream one step out of place replays
    // as a subtly different dish. Both conventions have to work, so this one
    // goes through main.js's own update rather than around it.
    // Driven through GAME.pointer, not GAME.input.mouse. Mouse, touch and pen
    // were unified onto Pointer Events when the game had to run on a phone, and
    // the pointer is now the live path — this test asserts that the *live* path
    // is recorded, so it has to use whichever one that currently is.
    const pointer = GAME.pointer;
    const live = GAME.newDish('live-path', 'coral', 600);
    live.tool = 'nutrient';
    live.brushRadius = 0.11;
    pointer.x = 0.12; pointer.y = -0.08;
    pointer.down = true;
    GAME.loop.stepHeadless(1200);      // ten seconds of a held actuator
    pointer.down = false;
    GAME.loop.stepHeadless(600);       // and ten seconds of the dish left alone

    const liveRecord = recorderFor(GAME).snapshotRecord();
    assert(liveRecord.events.count > 1000,
      `${liveRecord.events.count} events from 1200 held ticks — the live path was not captured`);
    const expected = fieldHash(GAME);

    replay(GAME, liveRecord);
    assert(fieldHash(GAME) === expected, 'the live input path did not replay identically');

    // A control. If a stream shifted by one tick replayed to the same field,
    // the check above would be passing for free and would carry on passing
    // after the attribution broke.
    const shifted = {
      ...liveRecord,
      events: {
        count: liveRecord.events.count,
        meta: liveRecord.events.meta.slice(),
        geo: liveRecord.events.geo,
      },
    };
    for (let i = 0; i < shifted.events.count; i++) shifted.events.meta[i * 2] += 1;
    replay(GAME, shifted);
    assert(fieldHash(GAME) !== expected,
      'a one-tick shift produced the same field — this test cannot detect an off-by-one');

    return `${liveRecord.events.count} events through main.js's update, replayed identically; ` +
           'a one-tick shift is detected';
  });

  // --- settings -----------------------------------------------------------

  check('settings: values are clamped, rubbish is refused, defaults survive', () => {
    const key = 'still-culture:settings:selftest';
    try { localStorage.removeItem(key); } catch { /* nothing to clear */ }
    const s = new Settings({ storageKey: key });

    s.set('masterVolume', 5);
    assert(s.get('masterVolume') === 1, `clamped to ${s.get('masterVolume')}`);
    s.set('masterVolume', -3);
    assert(s.get('masterVolume') === 0, `clamped to ${s.get('masterVolume')}`);

    const before = s.get('actuatorMode');
    s.set('actuatorMode', 'wobble');
    assert(s.get('actuatorMode') === before, 'an invalid enum was accepted');

    s.set('brushSensitivity', 2);
    const wider = s.brushRadiusAfterWheel(0.10, 1);
    const normal = new Settings({ storageKey: key + ':b' }).brushRadiusAfterWheel(0.10, 1);
    assert(wider > normal, `sensitivity did nothing: ${wider} against ${normal}`);
    assert(s.brushRadiusAfterWheel(0.24, 1) <= 0.24, 'brush radius escaped its ceiling');
    assert(s.brushRadiusAfterWheel(0.04, -1) >= 0.04, 'brush radius escaped its floor');

    try { localStorage.removeItem(key + ':b'); } catch { /* nothing to clear */ }
    return `clamped, enum guarded, sensitivity ${normal.toFixed(4)} -> ${wider.toFixed(4)}`;
  });

  check('settings: persist across instances and announce once per update', () => {
    const key = 'still-culture:settings:selftest2';
    try { localStorage.removeItem(key); } catch { /* nothing to clear */ }
    const s = new Settings({ storageKey: key });

    let calls = 0, changed = null;
    const off = s.subscribe((keys) => { calls++; changed = keys; });
    s.update({ musicVolume: 0.25, sfxVolume: 0.5, colourBlindSafe: true });
    assert(calls === 1, `${calls} announcements for one update`);
    assert(changed.length === 3, `announced ${changed.length} keys`);

    // Setting the same values again is not a change.
    s.update({ musicVolume: 0.25 });
    assert(calls === 1, 'a no-op update was announced');
    off();
    s.set('musicVolume', 0.9);
    assert(calls === 1, 'unsubscribe did not take');

    const reloaded = new Settings({ storageKey: key });
    assert(reloaded.get('musicVolume') === 0.9, `reloaded ${reloaded.get('musicVolume')}`);
    assert(reloaded.get('colourBlindSafe') === true, 'flag did not persist');

    // A corrupt store must not take the game down with it.
    localStorage.setItem(key, '{not json');
    const survived = new Settings({ storageKey: key });
    assert(survived.get('musicVolume') === 0.7, 'corrupt storage was not replaced by defaults');

    try { localStorage.removeItem(key); } catch { /* nothing to clear */ }
    return 'persisted, announced once, survived corruption';
  });

  // --- the number the design depends on -----------------------------------

  if (cost) {
    check(`load cost: a full ${costDuration}s session, actuator held throughout`, () => {
      const c = measureReplayCost(GAME, { duration: costDuration, held: true });
      // Not asserted against a threshold. What is acceptable is a judgement
      // about players, not about code, and inventing a limit here would turn a
      // measurement into a rubber stamp.
      return `${(c.wallMs / 1000).toFixed(2)} s for ${c.simulatedSeconds} s of play ` +
             `(${c.speedup}x real time, ${c.perTickMs} ms/tick, ` +
             `${c.events} events, ${(c.recordBytes / 1024 / 1024).toFixed(2)} MiB worst-case record)`;
    });

    check('load cost: the floor, with no player input at all', () => {
      const c = measureReplayCost(GAME, { duration: costDuration, held: false });
      return `${(c.wallMs / 1000).toFixed(2)} s of chemistry alone (${c.speedup}x real time) — ` +
             `everything above this is the cost of the player's own hand`;
    });
  }

  // Leave the game somewhere sane.
  //
  // Detaching matters more than it looks. A recorder left attached keeps
  // capturing, and the policy experiment makes about two million actuator calls
  // across its dishes — which would quietly accumulate a hundred megabytes and
  // be blamed on the simulation.
  const attached = recorderFor(GAME);
  if (attached) attached.detach();
  GAME.newDish('dish-001', 'coral', 600);
  hashBuf = null;

  const passed = results.filter(r => r.pass).length;
  return { passed, failed: results.length - passed, ok: passed === results.length, results };
}

export default runSaveTests;
