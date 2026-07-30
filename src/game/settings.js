// Settings.
//
// Interface
//   settings                        the singleton; there is only ever one
//   settings.get(key)               current value
//   settings.set(key, value)        validated, clamped, persisted, announced
//   settings.update({ ... })        several at once, one announcement
//   settings.all()                  a plain copy, safe to hand to a UI
//   settings.reset(key?)            back to defaults, one key or all of them
//   settings.subscribe(fn)          fn(changedKeys, all) -> unsubscribe
//   settings.applyTo(GAME)          push audio values into the live mix
//   settings.brushRadiusAfterWheel(radius, direction)
//                                   brush sensitivity applied to a wheel notch
//   SETTINGS_SCHEMA                 what exists, with ranges — for building UI
//
// Two rules this file exists to enforce.
//
// First, nothing here may reach the simulation. Reduced motion and the
// colour-blind palette are presentation flags and are read by the renderer;
// brush sensitivity changes the radius the player selects, which is part of the
// input stream and therefore recorded. If a setting could change what the
// chemistry does from the same seed and the same inputs, every determinism
// claim in this repository would become conditional on a value stored in the
// player's browser, and a saved dish would stop replaying on a different
// machine.
//
// Second, a bad stored value must never be able to break the game. Storage is
// user-writable and survives across versions, so everything read back is
// validated against the schema and silently replaced when it does not fit. A
// settings file is not a place to be strict at the player's expense.

const KEY = 'still-culture:settings:v1';

/**
 * Each entry declares enough for a UI to be generated from it, which is the
 * point: the UI agent should not have to know that music sits between 0 and 1
 * or that there are exactly two actuator modes.
 */
export const SETTINGS_SCHEMA = {
  masterVolume: {
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.8,
    label: 'master', group: 'audio',
  },
  musicVolume: {
    type: 'number', min: 0, max: 1, step: 0.05, default: 0.7,
    label: 'hum', group: 'audio',
    note: 'the hum is information, not ambience — silencing it removes a channel',
  },
  sfxVolume: {
    type: 'number', min: 0, max: 1, step: 0.05, default: 1.0,
    label: 'effects', group: 'audio',
  },
  reducedMotion: {
    type: 'boolean', default: null, group: 'display',
    label: 'reduced motion',
    note: 'presentation only; the medium still moves, the camera and overlays do not',
  },
  colourBlindSafe: {
    type: 'boolean', default: false, group: 'display',
    label: 'colour-blind safe palette',
    note: 'the dark-field render separates growth from scar by hue alone',
  },
  brushSensitivity: {
    type: 'number', min: 0.25, max: 4, step: 0.05, default: 1.0,
    label: 'brush sensitivity', group: 'input',
    note: 'how far one wheel notch moves the brush radius',
  },
  actuatorMode: {
    type: 'enum', values: ['hold', 'toggle'], default: 'hold',
    label: 'actuators', group: 'input',
    note: 'hold: the tool acts while the button is down. toggle: click on, click off',
  },
};

/** Defaults that depend on the machine rather than on taste. */
function systemDefault(key) {
  if (key === 'reducedMotion') {
    // Honour the operating system on first run. A player who has asked their
    // machine for less movement should not have to ask again here.
    try {
      return !!(globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch { return false; }
  }
  return null;
}

function defaultsOf() {
  const out = {};
  for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
    out[key] = spec.default === null ? systemDefault(key) : spec.default;
  }
  return out;
}

/** Coerce a stored or supplied value into something the schema permits. */
function coerce(key, value) {
  const spec = SETTINGS_SCHEMA[key];
  if (!spec) return undefined;
  if (spec.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return undefined;
    return Math.min(spec.max, Math.max(spec.min, n));
  }
  if (spec.type === 'boolean') return !!value;
  if (spec.type === 'enum') return spec.values.includes(value) ? value : undefined;
  return undefined;
}

export class Settings {
  constructor({ storageKey = KEY } = {}) {
    this.storageKey = storageKey;
    this.values = defaultsOf();
    this._listeners = new Set();
    this.load();
  }

  /** Read from storage. Anything unrecognised or out of range is dropped. */
  load() {
    let raw = null;
    try { raw = globalThis.localStorage && localStorage.getItem(this.storageKey); } catch { raw = null; }
    if (!raw) return this;
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object') return this;
    for (const key of Object.keys(SETTINGS_SCHEMA)) {
      if (!(key in parsed)) continue;
      const v = coerce(key, parsed[key]);
      if (v !== undefined) this.values[key] = v;
    }
    return this;
  }

  /** Persist. Storage can be full or forbidden; that must not be fatal. */
  save() {
    try {
      globalThis.localStorage && localStorage.setItem(this.storageKey, JSON.stringify(this.values));
      return true;
    } catch {
      return false;
    }
  }

  get(key) { return this.values[key]; }

  all() { return { ...this.values }; }

  set(key, value) { return this.update({ [key]: value }); }

  /**
   * Several keys at once, announced once.
   *
   * A UI that drags a volume slider produces a value per frame; announcing each
   * one separately would have every subscriber rebuild itself sixty times a
   * second for one gesture.
   */
  update(patch) {
    const changed = [];
    for (const [key, value] of Object.entries(patch)) {
      const v = coerce(key, value);
      if (v === undefined) continue;
      if (this.values[key] === v) continue;
      this.values[key] = v;
      changed.push(key);
    }
    if (changed.length) {
      this.save();
      this._announce(changed);
    }
    return changed;
  }

  reset(key = null) {
    const defaults = defaultsOf();
    if (key) return this.update({ [key]: defaults[key] });
    return this.update(defaults);
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _announce(changed) {
    const snapshot = this.all();
    for (const fn of this._listeners) {
      // One broken listener must not stop the others from being told.
      try { fn(changed, snapshot); } catch (err) { console.warn('[settings] listener failed', err); }
    }
  }

  /**
   * Push the audio values into the live mix.
   *
   * Volumes are the only settings this file can apply on its own: the audio
   * graph has a setter, whereas the palette and reduced-motion flags are read
   * by the renderer each frame and belong to whoever owns that.
   */
  applyTo(GAME) {
    if (!GAME) return this;
    const a = GAME.audio;
    if (a && typeof a.setVolume === 'function') {
      a.setVolume('master', this.values.masterVolume);
      a.setVolume('music', this.values.musicVolume);
      a.setVolume('sfx', this.values.sfxVolume);
    }
    // The hum has its own trim on top of the music bus, so a player who turns
    // the hum down gets it down rather than merely quieter relative to nothing.
    if (GAME.hum) GAME.hum.gain = 0.9 * this.values.musicVolume;
    return this;
  }

  /** Keep the mix following the settings for as long as the game runs. */
  bind(GAME) {
    this.applyTo(GAME);
    return this.subscribe((changed) => {
      if (changed.some(k => k === 'masterVolume' || k === 'musicVolume' || k === 'sfxVolume')) {
        this.applyTo(GAME);
      }
    });
  }

  /**
   * One wheel notch, with sensitivity applied.
   *
   * The bounds match the ones main.js enforces. They are repeated rather than
   * imported because the brush limits are a rule of the game and this is a
   * helper for the UI, not the authority.
   *
   * @param {number} radius current brush radius
   * @param {number} direction +1 for a notch away from the player, -1 toward
   */
  brushRadiusAfterWheel(radius, direction) {
    const s = this.values.brushSensitivity;
    // Sensitivity scales the exponent rather than the factor, so doubling it
    // doubles the number of notches-worth of change per notch instead of
    // producing a differently shaped curve.
    const factor = Math.pow(direction > 0 ? 1.12 : 0.89, s);
    return Math.max(0.04, Math.min(0.24, radius * factor));
  }

  /** True when an actuator should latch on click instead of following the button. */
  get actuatorsToggle() { return this.values.actuatorMode === 'toggle'; }
}

/** The one instance. Import this; construct your own only in tests. */
export const settings = new Settings();

export default settings;
