// Saving a dish.
//
// Interface
//   attachRecorder(GAME)              -> Recorder, capturing from now on
//   recorderFor(GAME)                 -> the attached Recorder, or null
//   saveSession(GAME, { slot })       -> Promise<meta>    persist
//   listSaves()                       -> [meta]           cheap, synchronous
//   loadSave(slot)                    -> Promise<record|null>
//   deleteSave(slot)                  -> Promise<void>
//   restore(GAME, record)             -> Promise<result>  replay into the live game
//   replay(GAME, record, opts)        -> result           deterministic re-run
//   encodeToString(record)            -> string           shareable text form
//   decodeFromString(text)            -> record
//   measureReplayCost(GAME, opts)     -> the number this design lives or dies on
//
// A save is a seed and an input log. It is not a field.
//
// ARCHITECTURE.md invariant 1 says the simulation is a pure function of (seed,
// tick, input stream). If that is true then the 512x512 float field is derived
// data and storing it is storing a cache. Storing the three inputs instead
// means a save is a few hundred kilobytes rather than eight megabytes, it can
// be pasted into a bug report as text, and it is the same artefact the
// after-action trace needs in order to scrub. It also keeps the invariant
// honest: if replay ever stops reproducing the field, saving breaks loudly
// rather than the invariant rotting quietly.
//
// The cost is that loading is not free. It is a re-simulation, and it takes as
// long as the chemistry takes. `measureReplayCost` exists so that number is
// measured rather than assumed; see the note on the snapshot fallback at the
// bottom of this file for what to do if it is unacceptable.
//
// Why the recorder wraps the session rather than living inside it: the input
// stream that matters is exactly the set of calls that reach `Session.use`, and
// wrapping that one method captures scripted policies, replayed input and a
// human at a mouse identically. `Session.log` cannot be used for this — it
// deliberately keeps at most one actuator entry per second so the trace stays
// readable, which is a hundred and twentieth of what a held actuator actually
// does.

import { TOOL_ORDER } from './session.js';

export const SAVE_VERSION = 3;

const DB_NAME = 'still-culture';
const DB_STORE = 'saves';
const INDEX_KEY = 'still-culture:saves:v1';

/** What a recorded call was. `held` is part of the identity: probes refuse it. */
export const KIND = { CLICK: 0, HELD: 1, SEED: 2 };

const TOOL_CODE = new Map(TOOL_ORDER.map((t, i) => [t, i]));

// ---------------------------------------------------------------------------
// The event stream
// ---------------------------------------------------------------------------

/**
 * Two parallel typed arrays rather than an array of objects.
 *
 * Ten minutes of a held actuator is 72,000 calls. As objects that is several
 * megabytes of garbage and a JSON blob no storage wants; as columns it is 56
 * bytes each, it survives structured clone into IndexedDB without a copy, and
 * it can be appended to during play without allocating per event.
 *
 * The geometry is stored as float64, not float32 and not quantised. It feeds
 * brush centres and radii directly, and Gray-Scott amplifies small differences
 * by design — a rounding of one part in a million in a brush centre is a
 * different dish ten minutes later. Bit-identical replay is the entire claim
 * being made here, so the storage is exact and pays for it in bytes.
 */
export class EventStream {
  constructor(capacity = 2048) {
    this.count = 0;
    this.meta = new Uint32Array(capacity * 2);   // tick, (kind << 8) | tool
    this.geo = new Float64Array(capacity * 6);   // x, y, dx, dy, strength, radius
  }

  get capacity() { return this.meta.length / 2; }

  _grow() {
    const next = Math.max(2048, this.capacity * 2);
    const meta = new Uint32Array(next * 2);
    const geo = new Float64Array(next * 6);
    meta.set(this.meta);
    geo.set(this.geo);
    this.meta = meta;
    this.geo = geo;
  }

  push(tick, kind, toolCode, x, y, dx, dy, strength, radius) {
    if (this.count >= this.capacity) this._grow();
    const m = this.count * 2, g = this.count * 6;
    this.meta[m] = tick;
    this.meta[m + 1] = (kind << 8) | toolCode;
    this.geo[g] = x; this.geo[g + 1] = y;
    this.geo[g + 2] = dx; this.geo[g + 3] = dy;
    this.geo[g + 4] = strength; this.geo[g + 5] = radius;
    this.count++;
  }

  tickAt(i) { return this.meta[i * 2]; }
  kindAt(i) { return this.meta[i * 2 + 1] >> 8; }
  toolAt(i) { return TOOL_ORDER[this.meta[i * 2 + 1] & 0xff]; }

  /** A plain object for the one caller that wants readability over speed. */
  at(i) {
    const g = i * 6;
    return {
      tick: this.tickAt(i),
      kind: this.kindAt(i),
      tool: this.toolAt(i),
      x: this.geo[g], y: this.geo[g + 1],
      dx: this.geo[g + 2], dy: this.geo[g + 3],
      strength: this.geo[g + 4], radius: this.geo[g + 5],
    };
  }

  /** Exact-length copies, for storage. The live arrays carry spare capacity. */
  trimmed() {
    return {
      count: this.count,
      meta: this.meta.slice(0, this.count * 2),
      geo: this.geo.slice(0, this.count * 6),
    };
  }

  get bytes() { return this.count * 56; }

  static fromTrimmed({ count, meta, geo }) {
    const s = new EventStream(Math.max(1, count));
    s.meta.set(meta);
    s.geo.set(geo);
    s.count = count;
    return s;
  }

  clone() { return EventStream.fromTrimmed(this.trimmed()); }
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

const RECORDERS = new WeakMap();

export function recorderFor(GAME) { return RECORDERS.get(GAME) || null; }

export class Recorder {
  constructor(GAME) {
    this.GAME = GAME;
    this.suspended = false;
    this._inUpdate = false;
    this._wrapped = null;
    this.record = null;
    this._install();
    this.begin(GAME.strain.seedName, GAME.strain.regime.name, GAME.session.duration);
    this._wrap(GAME.session);
  }

  /** Start a fresh recording for a dish. */
  begin(seed, regime, duration) {
    this.record = {
      v: SAVE_VERSION,
      seed, regime, duration,
      createdAt: Date.now(),
      tickCount: 0,
      events: new EventStream(),
      log: [],
    };
    return this.record;
  }

  _install() {
    const GAME = this.GAME;
    const loop = GAME.loop;

    // Knowing whether a call arrived from inside the fixed step decides which
    // tick it belongs to, and getting that wrong puts every held stroke one
    // chemistry step out of place. Inside `update`, `loop.tick` has already been
    // incremented for the step being run; outside it, `loop.tick` is the index
    // of the step about to run. Both mean "this input precedes tick N", but N is
    // one less in the first case.
    const origUpdate = loop.update;
    loop.update = (dt, tick) => {
      this._inUpdate = true;
      try { return origUpdate(dt, tick); }
      finally { this._inUpdate = false; }
    };
    this._restoreUpdate = () => { loop.update = origUpdate; };

    // main.js reaches for its own module-local `newDish` on the R key, so this
    // wrapper cannot be the only way a dish is replaced. `_check` below catches
    // the other route.
    const origNewDish = GAME.newDish;
    GAME.newDish = (seed = 'dish-001', regime = 'coral', duration = 600) => {
      const session = origNewDish(seed, regime, duration);
      if (!this.suspended) {
        this.begin(seed, regime, duration);
        this._wrap(session);
      }
      return session;
    };
    this._restoreNewDish = () => { GAME.newDish = origNewDish; };
  }

  /**
   * Wrap one session's mutating entry points.
   *
   * The marker is on the session rather than on the recorder because a session
   * can be re-wrapped from three places — a new dish, a restore, and the
   * tidy-up after a trace scrub — and wrapping twice would record every event
   * twice, which replays as double the input the player gave.
   */
  _wrap(session) {
    if (!session || session.__recordedBy === this) return;
    session.__recordedBy = this;
    this._wrapped = session;

    const origUse = session.use.bind(session);
    session.use = (x, y, opts = {}) => {
      // A call made after the assay changes nothing and writes nothing, so it
      // is not part of the input stream. Everything else is recorded whether or
      // not it succeeded: a refused shear still writes to `Session.log`, and a
      // restored dish whose log differs from the original is a broken trace.
      const live = session.state === 'running';
      if (live && !this.suspended) {
        this._push(session,
          opts.held ? KIND.HELD : KIND.CLICK, session.tool,
          x, y, opts.dx ?? 0, opts.dy ?? 0, opts.strength ?? 1);
      }
      return origUse(x, y, opts);
    };

    const origSeed = session.seedAt.bind(session);
    session.seedAt = (x, y, strength = 0.6) => {
      if (!this.suspended) this._push(session, KIND.SEED, session.tool, x, y, 0, 0, strength);
      return origSeed(x, y, strength);
    };
  }

  _push(session, kind, tool, x, y, dx, dy, strength) {
    this._check(session);
    const loop = this.GAME.loop;
    const tick = this._inUpdate ? Math.max(0, loop.tick - 1) : loop.tick;
    this.record.events.push(tick, kind, TOOL_CODE.get(tool) ?? 0, x, y, dx, dy, strength, session.brushRadius);
    if (tick + 1 > this.record.tickCount) this.record.tickCount = tick + 1;
  }

  /**
   * Notice a dish that was replaced behind our back.
   *
   * The R key in main.js calls a function this wrapper never sees. Without this
   * check the recorder would keep appending a new dish's input to the previous
   * dish's record, and the save would replay as neither.
   */
  _check(session) {
    const strain = this.GAME.strain;
    if (!strain) return;
    if (this.record && this.record.seed === strain.seedName) return;
    this.begin(strain.seedName, strain.regime.name, session.duration);
  }

  /** Bring the record up to the live clock, so a save with no input still seeks. */
  sync() {
    const loop = this.GAME.loop;
    if (loop.tick > this.record.tickCount) this.record.tickCount = loop.tick;
    const session = this.GAME.session;
    if (session) this.record.log = session.log.slice();
    return this.record;
  }

  /** A detached, storable copy. */
  snapshotRecord() {
    this.sync();
    const r = this.record;
    return {
      v: r.v, seed: r.seed, regime: r.regime, duration: r.duration,
      createdAt: r.createdAt, savedAt: Date.now(),
      tickCount: r.tickCount,
      events: r.events.trimmed(),
      log: r.log.slice(),
    };
  }

  detach() {
    if (this._restoreUpdate) this._restoreUpdate();
    if (this._restoreNewDish) this._restoreNewDish();
    RECORDERS.delete(this.GAME);
    if (this.GAME.recorder === this) delete this.GAME.recorder;
  }
}

/** Attach once. Attaching twice would double every recorded event. */
export function attachRecorder(GAME) {
  const existing = RECORDERS.get(GAME);
  if (existing) return existing;
  const rec = new Recorder(GAME);
  RECORDERS.set(GAME, rec);
  GAME.recorder = rec;   // discoverable from the console, which is how this is developed
  return rec;
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/** Rehydrate whatever shape a record arrived in. */
export function asEventStream(events) {
  if (events instanceof EventStream) return events;
  return EventStream.fromTrimmed(events);
}

/**
 * Re-run a record into the live game.
 *
 * Replay drives the real `loop.update` rather than a private copy of the step
 * order. A private copy would be faster and would rot the first time main.js
 * changed the order it brushes, steps and decays in — and it would rot
 * silently, because the field would still look plausible.
 *
 * @param {object} GAME
 * @param {object} record
 * @param {object} opts
 * @param {number} [opts.toTick]     stop here instead of at the end
 * @param {boolean} [opts.resume]    carry on from where the medium already is,
 *                                   instead of starting the dish again. Only
 *                                   valid when the field is exactly the result
 *                                   of this record replayed to `loop.tick`;
 *                                   scrubbing forward through a trace is the
 *                                   case it exists for, and it is the
 *                                   difference between a scrub bar that costs
 *                                   the gap and one that costs the whole
 *                                   session every time it moves.
 * @param {number} [opts.sampleEvery] seconds between calls to opts.onSample
 * @param {(t:number, stats:Float32Array)=>void} [opts.onSample]
 * @returns {{ms:number, ticks:number, events:number, seconds:number}}
 */
export function replay(GAME, record, { toTick = null, resume = false, sampleEvery = 0, onSample = null } = {}) {
  const t0 = performance.now();
  const { loop, medium, input } = GAME;
  const events = asEventStream(record.events);
  const stop = toTick === null ? record.tickCount : Math.min(toTick, record.tickCount);

  const wasRunning = loop.running;
  loop.stop();

  const rec = recorderFor(GAME);
  const wasSuspended = rec ? rec.suspended : false;
  if (rec) rec.suspended = true;

  // The device must not contribute to a replay. Setting `input.replay` makes the
  // listeners bail out; clearing the sets stops a button that happens to be down
  // right now from painting all over the reconstruction.
  const prevReplay = input.replay;
  input.replay = REPLAY_GUARD;
  input.down = new Set();
  input.buttons = new Set();

  // Suppress the statistics readback for the duration.
  //
  // `Session.update` reduces the field and reads it back ten times a second to
  // drive the hum. Each readback is a synchronous pipeline stall, and over a
  // ten-minute replay that is six thousand of them — measured, it is the single
  // largest cost in a load. It touches a separate render target and cannot
  // affect the state field, so removing it during a replay is free and changes
  // nothing about the result.
  const origReduce = medium.reduceStats;
  const idle = new Float32Array(16 * 16 * 4);
  medium.reduceStats = (out) => (out && out.length >= idle.length ? out : idle);

  let sampled = 0;
  const sampleStride = sampleEvery > 0 ? Math.max(1, Math.round(sampleEvery / loop.stepSec)) : 0;
  const sampleBuf = sampleStride ? new Float32Array(16 * 16 * 4) : null;

  try {
    const session = resume ? GAME.session : GAME.newDish(record.seed, record.regime, record.duration);
    // No audio during a reconstruction. The hum is a live readout of a dish the
    // player is sitting in front of, not a soundtrack to a fast-forward.
    session.hum = null;

    // On resume, every event at or before the current tick has already been
    // applied — that is the invariant the loop below maintains when it stops —
    // so start at the first one that has not.
    let i = 0;
    if (resume) while (i < events.count && events.tickAt(i) <= loop.tick) i++;
    let nextSample = sampleStride ? (resume ? loop.tick : 0) : Infinity;

    for (;;) {
      while (i < events.count && events.tickAt(i) <= loop.tick) applyEvent(session, events, i++);

      if (nextSample <= loop.tick) {
        if (onSample) {
          onSample(loop.tick * loop.stepSec, origReduce.call(medium, sampleBuf), medium);
          sampled++;
        }
        nextSample += sampleStride;
      }

      if (loop.tick >= stop) break;

      let next = stop;
      if (i < events.count && events.tickAt(i) < next) next = events.tickAt(i);
      if (nextSample < next) next = nextSample;
      // Never stall: every pass either breaks above or advances the clock.
      if (next <= loop.tick) next = loop.tick + 1;
      loop.stepHeadless(next - loop.tick);
    }

    session.hum = GAME.hum;
    return {
      ms: +(performance.now() - t0).toFixed(1),
      ticks: loop.tick,
      seconds: +(loop.tick * loop.stepSec).toFixed(3),
      events: i,
      samples: sampled,
    };
  } finally {
    medium.reduceStats = origReduce;
    input.replay = prevReplay;
    input.down = new Set();
    input.buttons = new Set();
    if (rec) {
      rec.suspended = wasSuspended;
      // A replay leaves a brand new session behind, and it was created while
      // recording was suspended so nothing is watching it. Re-wrapping here
      // means a scrub through the trace cannot quietly stop the game recording
      // whatever the player does next.
      rec._wrap(GAME.session);
    }
    if (wasRunning) loop.start();
  }
}

const REPLAY_GUARD = Object.freeze({ source: 'save.replay' });

function applyEvent(session, events, i) {
  const g = i * 6;
  const geo = events.geo;
  session.brushRadius = geo[g + 5];
  const kind = events.kindAt(i);
  if (kind === KIND.SEED) {
    session.seedAt(geo[g], geo[g + 1], geo[g + 4]);
    return;
  }
  session.tool = events.toolAt(i);
  session.use(geo[g], geo[g + 1], {
    dx: geo[g + 2], dy: geo[g + 3],
    held: kind === KIND.HELD,
    strength: geo[g + 4],
  });
}

/**
 * Replay a record and hand the game back to the player, still recording.
 *
 * After this the recorder holds the restored record, so the next save continues
 * the same dish rather than starting a second one from the moment of loading.
 */
export async function restore(GAME, record) {
  const result = replay(GAME, record);
  const rec = recorderFor(GAME);
  if (rec) {
    rec.record = {
      v: SAVE_VERSION,
      seed: record.seed, regime: record.regime, duration: record.duration,
      createdAt: record.createdAt ?? Date.now(),
      tickCount: record.tickCount,
      events: asEventStream(record.events).clone(),
      log: (record.log || []).slice(),
    };
    rec._wrap(GAME.session);
  }
  return result;
}

/**
 * How long a full session takes to load.
 *
 * This is the measurement the design of this file depends on, so it is code
 * rather than a claim in a comment. It builds a worst-case record — an actuator
 * held for the whole session, which is 120 recorded events per second — and
 * replays it.
 */
export function measureReplayCost(GAME, { duration = 600, held = true } = {}) {
  const stepSec = GAME.loop.stepSec;
  // The player waits for the GPU as well as for the JavaScript. Draw calls
  // queue, so timing `replay` alone measures how fast this machine can post
  // work rather than how long a load takes — and it under-reports by an order
  // of magnitude. Both ends of the measurement are synchronised.
  GAME.gl.finish();
  const wall0 = performance.now();
  const ticks = Math.round(duration / stepSec);
  const events = new EventStream(held ? ticks : 1024);
  if (held) {
    for (let t = 0; t < ticks; t++) {
      // A slow circle inside the dish, which is roughly what a player does and
      // means the brush is not repeatedly writing the same texels.
      const a = t * 0.0007;
      events.push(t, KIND.HELD, TOOL_CODE.get('nutrient'), 0.5 + Math.cos(a) * 0.2, 0.5 + Math.sin(a) * 0.2, 0, 0, 1, 0.10);
    }
  }
  const record = {
    v: SAVE_VERSION, seed: 'replay-cost', regime: 'coral', duration,
    tickCount: ticks, events, log: [],
  };
  const r = replay(GAME, record);
  GAME.gl.finish();
  const wallMs = +(performance.now() - wall0).toFixed(1);
  return {
    ...r,
    wallMs,
    queueMs: r.ms,
    simulatedSeconds: duration,
    speedup: +(duration / (wallMs / 1000)).toFixed(1),
    recordBytes: events.bytes,
    perTickMs: +(wallMs / Math.max(1, r.ticks)).toFixed(4),
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

// IndexedDB rather than localStorage, for one reason: localStorage stores
// strings, so a binary event stream has to be base64-encoded into it, which
// inflates it by a third and caps out at a few megabytes for the whole origin.
// IndexedDB takes the typed arrays as they are. localStorage keeps only the
// index — a list of what exists — which is small, synchronous, and can be read
// before the game has decided whether to offer a "continue" button.

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Run one store operation and settle when the transaction actually commits. */
function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(DB_STORE, mode);
    try { fn(t.objectStore(DB_STORE)); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function readIndex() {
  try {
    const raw = globalThis.localStorage && localStorage.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function writeIndex(list) {
  try { globalThis.localStorage && localStorage.setItem(INDEX_KEY, JSON.stringify(list)); } catch { /* full or forbidden */ }
}

/** What is saved, without touching IndexedDB. Safe to call at startup. */
export function listSaves() { return readIndex(); }

export function hasSave(slot = 'auto') { return readIndex().some(s => s.slot === slot); }

/**
 * Persist the current dish.
 *
 * @returns {Promise<object>} the index entry, which is what a UI wants to show.
 */
export async function saveSession(GAME, { slot = 'auto', label = '' } = {}) {
  const rec = recorderFor(GAME);
  if (!rec) throw new Error('no recorder attached — call attachRecorder(GAME) first');
  const record = rec.snapshotRecord();

  const meta = {
    slot, label,
    seed: record.seed,
    regime: record.regime,
    duration: record.duration,
    tickCount: record.tickCount,
    seconds: +(record.tickCount / 120).toFixed(1),
    events: record.events.count,
    bytes: record.events.count * 56,
    savedAt: record.savedAt,
    v: SAVE_VERSION,
  };

  const db = await openDb();
  try {
    await tx(db, 'readwrite', (store) => store.put(record, slot));
  } finally { db.close(); }

  const list = readIndex().filter(s => s.slot !== slot);
  list.unshift(meta);
  writeIndex(list);
  return meta;
}

export async function loadSave(slot = 'auto') {
  const db = await openDb();
  let raw;
  try {
    raw = await new Promise((resolve, reject) => {
      const t = db.transaction(DB_STORE, 'readonly');
      const req = t.objectStore(DB_STORE).get(slot);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
  if (!raw) return null;
  if (raw.v !== SAVE_VERSION) {
    // A save from an older input format cannot be replayed against newer rules
    // and must not be silently half-applied. Refusing is the honest outcome.
    console.warn(`[save] slot "${slot}" is version ${raw.v}, this build reads ${SAVE_VERSION}`);
    return null;
  }
  return raw;
}

export async function deleteSave(slot = 'auto') {
  writeIndex(readIndex().filter(s => s.slot !== slot));
  const db = await openDb();
  try { await tx(db, 'readwrite', (store) => store.delete(slot)); }
  finally { db.close(); }
}

// ---------------------------------------------------------------------------
// The text form
// ---------------------------------------------------------------------------

function bytesToBase64(bytes) {
  // Chunked, because String.fromCharCode.apply blows the argument limit on
  // anything larger than about a hundred thousand bytes.
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(s);
}

function base64ToBytes(text) {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * A record as one string.
 *
 * This is what goes in a bug report. "The dish went wrong at eight minutes" is
 * not reproducible; the seed and the exact input stream that produced it are,
 * on any machine, to the texel.
 *
 * Little-endian, like every machine this will run on. A save moved between
 * architectures of different endianness would need byte-swapping and is out of
 * scope.
 */
export function encodeToString(record) {
  const ev = record.events instanceof EventStream ? record.events.trimmed() : record.events;
  const header = {
    v: SAVE_VERSION, seed: record.seed, regime: record.regime,
    duration: record.duration, tickCount: record.tickCount,
    count: ev.count, createdAt: record.createdAt ?? null,
    log: record.log || [],
  };
  const meta64 = bytesToBase64(new Uint8Array(ev.meta.buffer, ev.meta.byteOffset, ev.meta.byteLength));
  const geo64 = bytesToBase64(new Uint8Array(ev.geo.buffer, ev.geo.byteOffset, ev.geo.byteLength));
  return `SC1.${btoa(JSON.stringify(header))}.${meta64}.${geo64}`;
}

export function decodeFromString(text) {
  const parts = String(text).trim().split('.');
  if (parts.length !== 4 || parts[0] !== 'SC1') throw new Error('not a still-culture record');
  const header = JSON.parse(atob(parts[1]));
  const metaBytes = base64ToBytes(parts[2]);
  const geoBytes = base64ToBytes(parts[3]);
  const meta = new Uint32Array(metaBytes.buffer, 0, header.count * 2);
  const geo = new Float64Array(geoBytes.buffer, 0, header.count * 6);
  return {
    v: header.v, seed: header.seed, regime: header.regime,
    duration: header.duration, tickCount: header.tickCount,
    createdAt: header.createdAt, log: header.log || [],
    events: { count: header.count, meta, geo },
  };
}

// ---------------------------------------------------------------------------
// The fallback, and why it is not implemented here
// ---------------------------------------------------------------------------
//
// If `measureReplayCost` reports a load time a player will not sit through, the
// answer is a state snapshot: read the state and parameter fields back and
// store the two Float32Arrays. That is eight megabytes a dish, which rules out
// localStorage but is nothing to IndexedDB, and restoring is two texture
// uploads regardless of session length.
//
// It is deliberately not built yet, and there is a specific obstacle worth
// recording. A snapshot restores the field but cannot restore the substep
// accumulator, which lives as a module-local in main.js and decides whether
// this tick advances the chemistry. Restoring the field without it leaves the
// dish one substep out of phase — visually identical, arithmetically different,
// and enough to end bit-identical replay. Making snapshots exact needs that
// accumulator moved onto the loop, or exposed, which is a change in a file this
// module does not own. Until the measurement says the snapshot is needed, that
// change is not worth asking for.
