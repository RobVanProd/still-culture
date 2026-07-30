// The heads-up display, the prompt layer, and the overlay screens.
//
// This module owns every pixel of DOM the game draws over the dish, and it owns
// nothing else. It is handed a plain snapshot each frame and renders it. It
// never reads game state, never mutates it, and imports nothing from game/,
// sim/ or render/. That is the contract render/ already has with the
// simulation, kept for the same reason: presentation that reaches into the
// model is presentation that cannot be changed without touching the model.
//
// Two consequences worth stating, because both are load-bearing:
//
//   1. Nothing here appears in a capture. `GAME.capture` reads the WebGL canvas,
//      and this is DOM sitting on top of it, so the deterministic visual
//      baseline cannot be disturbed by anything in this file.
//   2. There are no numbers describing the medium anywhere on this display. The
//      debug dump this replaces printed beat frequency, interface roughness,
//      commitment and scar as figures, which is a channel that is both free and
//      precise — the exact thing pillar 1 forbids, and the reason the free
//      channels are rendered here as a trace rather than as a readout.
//
// Interface
// ---------
//   const hud = new Hud({ mount, legacy });
//   hud.update(model)                        // every rendered frame
//   hud.showPrompt({ text, x, y, ttl })      // x,y in CSS pixels of the viewport
//   hud.clearPrompts()
//   hud.setOverlay(overlay | null)
//   hud.setDiagnostics(on) / hud.diagnostics
//   hud.setVisible(on)
//   hud.onAction = (name) => {}              // overlay buttons report by name
//   hud.destroy()
//
// Model
// -----
//   {
//     dt:        seconds of presentation time; pass 0 to freeze fades
//     clock:     { remaining, duration }        seconds
//     tools:     [{ key, label, kind, selected, charges, maxCharges }]
//     toolHint:  string | null                  shown briefly under the tools
//     trace:     { beatHz, rough, scar, presence, register }   all 0..1 but beatHz
//     diagnostics: string[]                     printed only when toggled on
//   }
//
// Overlay
// -------
//   { kind: 'title' | 'paused' | 'assay',
//     title, subtitle,
//     rows:    [{ label, value, threshold, pass, scale }],   // assay only
//     notes:   string[],                                     // quiet detail lines
//     reading: string,                                       // the one-line verdict
//     actions: [{ name, key, label }] }

const STYLE_ID = 'sc-ui-style';

const CSS = `
.sc-root {
  position: fixed; inset: 0; z-index: 10;
  pointer-events: none;
  font-family: inherit;
  --ink:      #8ca0ba;
  --ink-hi:   #dce7f5;
  --ink-dim:  #56657d;
  --pass:     #93b39a;
  --fail:     #c08f88;
  /* A dark halo rather than a panel. A plate behind the text would be a second
     rectangle competing with the dish; a halo is invisible until the image
     underneath it is bright, which is exactly when it is needed. */
  --halo: 0 0 7px rgba(0,0,0,.95), 0 0 2px rgba(0,0,0,1), 0 1px 2px rgba(0,0,0,.9);
}
.sc-root.sc-hidden .sc-chrome,
.sc-root.sc-hidden .sc-diag,
.sc-root.sc-hidden .sc-prompts { display: none; }

.sc-chrome { position: absolute; text-shadow: var(--halo); }
.sc-tl { top: 20px; left: 22px; }
.sc-bl { bottom: 20px; left: 22px; }

/* ---- clock ---------------------------------------------------------- */
.sc-clock {
  font-size: 19px; line-height: 1; letter-spacing: .06em;
  color: var(--ink-hi); font-variant-numeric: tabular-nums;
  opacity: .92;
}
/* No colour change, no flash, no countdown alarm. Pressure in this game is
   meant to come from the state of the field; a clock that starts shouting
   would supply it from the wrong place. */

/* ---- the trace: the free channels, seen ----------------------------- */
/* The visual twin of the hum, not a transcription of it. Two nearly-agreeing
   lines drift against each other at the beat rate, the dash texture carries
   interface roughness, the whole pair sits high or low with the culture's
   centre of gravity, and scar dulls the colour exactly as it dulls the mix.
   Ambiguous, continuous, free — the same bargain the audio makes, so a player
   with the sound off is playing the same game rather than a worse one. */
.sc-trace {
  position: relative; width: 128px; height: 16px; margin-top: 9px;
  color: #6f86a4;
  --dash: 128px; --gap: 128px;
}
.sc-trace i {
  position: absolute; left: 0; right: 0; top: 50%; height: 1px;
  background-image: repeating-linear-gradient(90deg,
    currentColor 0 var(--dash), transparent var(--dash) var(--gap));
  filter: drop-shadow(0 0 3px rgba(0,0,0,.9));
}

/* ---- tools ---------------------------------------------------------- */
.sc-tools { display: grid; gap: 3px; font-size: 11px; line-height: 1.35; }
.sc-tool {
  display: grid; grid-template-columns: 10px 62px auto; align-items: center;
  gap: 8px; color: var(--ink-dim); letter-spacing: .05em;
}
.sc-tool.sel { color: var(--ink-hi); }
.sc-tool .k { opacity: .55; }
.sc-tool.sel .k { opacity: 1; }
.sc-pips { display: flex; gap: 3px; }
.sc-pips b {
  width: 4px; height: 4px; border-radius: 50%;
  background: currentColor; opacity: .85; font-size: 0;
}
.sc-pips b.spent { background: none; box-shadow: inset 0 0 0 1px currentColor; opacity: .3; }
.sc-hint {
  margin-top: 7px; font-size: 10.5px; letter-spacing: .05em;
  color: var(--ink-dim); max-width: 190px; transition: opacity .35s linear;
}

/* ---- diagnostics ---------------------------------------------------- */
.sc-diag {
  position: absolute; top: 20px; right: 22px; text-align: right;
  font-size: 10.5px; line-height: 1.5; white-space: pre;
  color: var(--ink-dim); text-shadow: var(--halo); display: none;
}
.sc-diag.on { display: block; }

/* ---- prompts -------------------------------------------------------- */
.sc-prompts { position: absolute; inset: 0; }
.sc-prompt {
  position: absolute; transform: translate(-50%, -50%);
  font-size: 12px; letter-spacing: .05em; white-space: nowrap;
  color: var(--ink-hi); text-shadow: var(--halo);
  opacity: 0;
}
/* A prompt is a remark, not a callout: no box, no arrow, no pointer. It sits
   where the player is already looking and then it is gone. */

/* ---- overlays ------------------------------------------------------- */
.sc-overlay {
  position: absolute; inset: 0; display: none;
  place-content: center; justify-items: center;
  background: radial-gradient(120% 90% at 50% 45%, rgba(4,6,11,.62), rgba(4,6,11,.9));
  pointer-events: auto; opacity: 0; transition: opacity .5s ease;
}
.sc-overlay.on { display: grid; opacity: 1; }
.sc-panel { width: min(520px, 82vw); text-shadow: var(--halo); }
.sc-title {
  font-size: 26px; letter-spacing: .34em; color: var(--ink-hi);
  margin: 0 0 14px; font-weight: 500;
}
.sc-sub { font-size: 11.5px; letter-spacing: .1em; color: var(--ink-dim); margin: 0 0 26px; }
.sc-rows { display: grid; gap: 10px; margin: 0 0 22px; }
.sc-row {
  display: grid; grid-template-columns: 74px 54px 1fr 46px;
  align-items: center; gap: 12px; font-size: 11.5px; letter-spacing: .05em;
}
.sc-row .lbl { color: var(--ink-dim); }
.sc-row .val { color: var(--ink-hi); font-variant-numeric: tabular-nums; }
.sc-row .verdict { text-align: right; font-size: 10.5px; letter-spacing: .1em; }
.sc-row.ok .verdict { color: var(--pass); }
.sc-row.no .verdict { color: var(--fail); }
.sc-track { position: relative; height: 1px; background: rgba(140,160,186,.22); }
.sc-track .fill { position: absolute; left: 0; top: 0; height: 1px; background: var(--ink); }
.sc-row.ok .fill { background: var(--pass); }
.sc-row.no .fill { background: var(--fail); }
/* The threshold notch is why these are bars at all. A bare number cannot be read
   as "just short"; a mark you can see the fill stop before can. */
.sc-track .notch { position: absolute; top: -3px; width: 1px; height: 7px; background: rgba(220,231,245,.6); }
/* Pre-wrapped so a caller can align label columns with spaces; this is a
   monospace face and the alignment is doing the work a table would. */
.sc-notes { display: grid; gap: 5px; margin: 0 0 18px; font-size: 11px; color: var(--ink-dim); letter-spacing: .04em; white-space: pre; overflow-x: auto; }
.sc-reading {
  font-size: 13px; line-height: 1.6; color: var(--ink-hi); margin: 0 0 30px;
  letter-spacing: .02em; max-width: 46ch;
}
.sc-actions { display: flex; gap: 22px; flex-wrap: wrap; }
.sc-action {
  pointer-events: auto; cursor: pointer; background: none; border: 0; padding: 0;
  font: inherit; font-size: 11.5px; letter-spacing: .12em;
  color: var(--ink); text-shadow: var(--halo); opacity: .8;
}
.sc-action:hover, .sc-action:focus-visible { color: var(--ink-hi); opacity: 1; outline: none; }
.sc-action .k { color: var(--ink-dim); margin-left: 8px; }
`;

/** Format seconds as m:ss. */
function mmss(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

export class Hud {
  /**
   * @param {object} opts
   * @param {HTMLElement} [opts.mount]  where to attach; defaults to <body>
   * @param {HTMLElement} [opts.legacy] the old debug element, hidden if given
   */
  constructor({ mount = document.body, legacy = null } = {}) {
    if (!document.getElementById(STYLE_ID)) {
      const style = el('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    // The bootstrap page ships a debug text dump. Leaving it visible under a
    // composed HUD would put two clocks and two tool lists on screen.
    if (legacy) { legacy.textContent = ''; legacy.style.display = 'none'; }

    this.root = el('div', 'sc-root');

    const tl = el('div', 'sc-chrome sc-tl');
    this.clockEl = el('div', 'sc-clock', '0:00');
    this.traceEl = el('div', 'sc-trace');
    this.traceA = el('i');
    this.traceB = el('i');
    this.traceEl.append(this.traceA, this.traceB);
    tl.append(this.clockEl, this.traceEl);

    const bl = el('div', 'sc-chrome sc-bl');
    this.toolsEl = el('div', 'sc-tools');
    this.hintEl = el('div', 'sc-hint');
    this.hintEl.style.opacity = '0';
    bl.append(this.toolsEl, this.hintEl);

    this.diagEl = el('div', 'sc-diag');
    this.promptsEl = el('div', 'sc-prompts');
    this.overlayEl = el('div', 'sc-overlay');
    this.overlayEl.addEventListener('click', (e) => {
      // The title screen is one big button: any click starts the dish, which is
      // also the gesture the browser needs before it will let the hum play.
      if (this._overlayKind === 'title' && e.target === this.overlayEl) this._fire('begin');
    });

    this.root.append(tl, bl, this.diagEl, this.promptsEl, this.overlayEl);
    mount.appendChild(this.root);

    /** @type {(name: string) => void} */
    this.onAction = () => {};
    this.diagnostics = false;

    this._prompts = [];
    this._toolRows = new Map();
    this._overlayKind = null;
    this._last = { clock: '', diag: '', hint: null, dash: '', colour: '' };

    // The trace's beat is a phase we advance ourselves rather than a CSS
    // animation whose duration we rewrite. Rewriting animation-duration
    // restarts the animation, which reads as a stutter every time the field
    // changes — precisely when the player is trying to read it.
    this._beatPhase = 0;
    this._traceThrottle = 0;
  }

  _fire(name) { try { this.onAction(name); } catch (err) { console.error('[hud] action', name, err); } }

  setVisible(on) { this.root.classList.toggle('sc-hidden', !on); }

  setDiagnostics(on) {
    this.diagnostics = !!on;
    this.diagEl.classList.toggle('on', this.diagnostics);
  }

  // ------------------------------------------------------------------ frame

  update(model = {}) {
    const dt = model.dt ?? 0;
    this._updateClock(model.clock);
    this._updateTrace(model.trace, dt);
    this._updateTools(model.tools);
    this._updateHint(model.toolHint);
    this._updatePrompts(dt);

    if (this.diagnostics) {
      const text = (model.diagnostics || []).join('\n');
      if (text !== this._last.diag) { this.diagEl.textContent = text; this._last.diag = text; }
    }
  }

  _updateClock(clock) {
    if (!clock) return;
    const text = mmss(clock.remaining);
    if (text === this._last.clock) return;   // one DOM write a second, not sixty
    this._last.clock = text;
    this.clockEl.textContent = text;
  }

  _updateTrace(trace, dt) {
    if (!trace) return;
    const beat = Math.max(0, trace.beatHz || 0);
    const rough = Math.min(1, Math.max(0, trace.rough || 0));
    const scar = Math.min(1, Math.max(0, trace.scar || 0));
    const presence = Math.min(1, Math.max(0, trace.presence ?? 0.5));
    const register = Math.min(1, Math.max(0, trace.register ?? 0.5));

    // Below about half a hertz the ear hears a swell rather than a beat, and the
    // eye should be told the same thing: keep a slow drift so a healthy dish is
    // never a dead line, but do not let it read as a pulse.
    this._beatPhase += (beat > 0.05 ? beat : 0.09) * dt;
    if (this._beatPhase > 1e6) this._beatPhase = 0;
    const swing = Math.sin(this._beatPhase * Math.PI * 2);
    const separation = (0.35 + 2.6 * Math.min(1, beat / 6)) * swing;

    const alpha = 0.30 + 0.55 * presence;
    this.traceA.style.opacity = (alpha * (0.72 + 0.28 * Math.abs(swing))).toFixed(3);
    this.traceB.style.opacity = (alpha * (0.72 - 0.28 * Math.abs(swing))).toFixed(3);
    this.traceB.style.transform = `translateY(${separation.toFixed(2)}px)`;
    // Register: where the culture's mass sits, as where the trace sits.
    this.traceEl.style.transform = `translateY(${((0.5 - register) * 7).toFixed(2)}px)`;

    // The texture and the colour change slowly, so they are written a few times
    // a second rather than sixty; a repainted gradient per frame is the one part
    // of this display that could plausibly cost something.
    this._traceThrottle += dt;
    if (this._traceThrottle < 0.16) return;
    this._traceThrottle = 0;

    const dash = (1 - rough) * 120 + 1.5;
    const gap = dash + rough * 5 + 0.5;
    const dashKey = `${dash.toFixed(1)}/${gap.toFixed(1)}`;
    if (dashKey !== this._last.dash) {
      this._last.dash = dashKey;
      this.traceEl.style.setProperty('--dash', `${dash.toFixed(1)}px`);
      this.traceEl.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    }
    // Scar dulls and warms the trace, the same way it dulls the mix. The price
    // of looking stays visible in the channel the player reads for free.
    const dull = Math.min(1, scar * 2.2);
    const r = Math.round(111 + dull * 36), g = Math.round(134 - dull * 12), b = Math.round(164 - dull * 48);
    const colour = `rgb(${r},${g},${b})`;
    if (colour !== this._last.colour) { this._last.colour = colour; this.traceEl.style.color = colour; }
  }

  _updateTools(tools) {
    if (!tools) return;
    for (const t of tools) {
      let row = this._toolRows.get(t.key);
      if (!row) {
        const node = el('div', 'sc-tool');
        const k = el('span', 'k', t.key);
        const label = el('span', 'lbl', t.label);
        const pips = el('span', 'sc-pips');
        node.append(k, label, pips);
        this.toolsEl.appendChild(node);
        row = { node, pips, state: '' };
        this._toolRows.set(t.key, row);
      }
      // One string comparison instead of six attribute writes per tool per frame.
      const state = `${t.selected ? 1 : 0}:${t.charges}`;
      if (state === row.state) continue;
      row.state = state;
      row.node.classList.toggle('sel', !!t.selected);
      if (Number.isFinite(t.maxCharges)) {
        const want = t.maxCharges;
        while (row.pips.childElementCount < want) row.pips.appendChild(el('b'));
        for (let i = 0; i < want; i++) {
          row.pips.children[i].classList.toggle('spent', i >= t.charges);
        }
      }
    }
  }

  _updateHint(hint) {
    if (hint === this._last.hint) return;
    this._last.hint = hint;
    if (hint) this.hintEl.textContent = hint;
    this.hintEl.style.opacity = hint ? '0.85' : '0';
  }

  // ----------------------------------------------------------- the prompts

  /**
   * Show one short line at a point on screen.
   * @param {object} p { text, x, y, ttl } — x,y in CSS pixels of the viewport
   */
  showPrompt({ text, x = 0, y = 0, ttl = 7 }) {
    const node = el('div', 'sc-prompt', text);
    // Nudged off the anchor so the line never sits under the cursor itself, and
    // kept inside the viewport: a remark about the rim of the dish is worthless
    // if it is rendered off the edge of the window.
    //
    // The size test is not defensive padding. The browser pane this project is
    // developed in does not composite, and reports an inner size of zero — a
    // clamp trusting that would pin every prompt to one corner and the fault
    // would only ever be visible to somebody who could see the screen.
    let left = x, top = y - 28;
    const vw = innerWidth || 0, vh = innerHeight || 0;
    if (vw > 240 && vh > 160) {
      const mx = Math.min(110, vw * 0.22);
      left = Math.min(Math.max(left, mx), vw - mx);
      top = Math.min(Math.max(top, 34), vh - 34);
    }
    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
    this.promptsEl.appendChild(node);
    this._prompts.push({ node, age: 0, ttl });
    return node;
  }

  clearPrompts() {
    for (const p of this._prompts) p.node.remove();
    this._prompts.length = 0;
  }

  _updatePrompts(dt) {
    if (!this._prompts.length) return;
    const FADE_IN = 0.8, FADE_OUT = 1.4;
    for (let i = this._prompts.length - 1; i >= 0; i--) {
      const p = this._prompts[i];
      p.age += dt;
      if (p.age >= p.ttl) {
        p.node.remove();
        this._prompts.splice(i, 1);
        continue;
      }
      const inA = Math.min(1, p.age / FADE_IN);
      const outA = Math.min(1, (p.ttl - p.age) / FADE_OUT);
      p.node.style.opacity = (Math.min(inA, outA) * 0.92).toFixed(3);
    }
  }

  // ---------------------------------------------------------- the overlays

  /** @param {object|null} overlay see the header for the shape */
  setOverlay(overlay) {
    if (!overlay) {
      this._overlayKind = null;
      this.overlayEl.classList.remove('on');
      this.overlayEl.replaceChildren();
      return;
    }
    this._overlayKind = overlay.kind;
    const panel = el('div', 'sc-panel');

    if (overlay.title) panel.appendChild(el('h1', 'sc-title', overlay.title));
    if (overlay.subtitle) panel.appendChild(el('p', 'sc-sub', overlay.subtitle));

    if (overlay.rows && overlay.rows.length) {
      const rows = el('div', 'sc-rows');
      for (const r of overlay.rows) rows.appendChild(this._buildRow(r));
      panel.appendChild(rows);
    }

    if (overlay.notes && overlay.notes.length) {
      const notes = el('div', 'sc-notes');
      for (const n of overlay.notes) notes.appendChild(el('div', null, n));
      panel.appendChild(notes);
    }

    if (overlay.reading) panel.appendChild(el('p', 'sc-reading', overlay.reading));

    if (overlay.actions && overlay.actions.length) {
      const actions = el('div', 'sc-actions');
      for (const a of overlay.actions) {
        const b = el('button', 'sc-action');
        b.type = 'button';
        b.appendChild(document.createTextNode(a.label));
        if (a.key) b.appendChild(el('span', 'k', a.key));
        b.addEventListener('click', (e) => { e.stopPropagation(); this._fire(a.name); });
        actions.appendChild(b);
      }
      panel.appendChild(actions);
    }

    this.overlayEl.replaceChildren(panel);
    // Force a reflow so the opacity transition runs on a freshly built panel
    // rather than being collapsed into the same frame as the insert.
    void this.overlayEl.offsetHeight;
    this.overlayEl.classList.add('on');
  }

  _buildRow({ label, value, threshold = null, pass = null, scale = 1 }) {
    const row = el('div', 'sc-row');
    if (pass === true) row.classList.add('ok');
    if (pass === false) row.classList.add('no');
    row.appendChild(el('span', 'lbl', label));
    row.appendChild(el('span', 'val', typeof value === 'number' ? value.toFixed(3) : String(value)));

    const track = el('span', 'sc-track');
    const fill = el('i', 'fill');
    fill.style.width = `${Math.max(0, Math.min(1, (Number(value) || 0) / scale)) * 100}%`;
    track.appendChild(fill);
    if (threshold != null) {
      const notch = el('u', 'notch');
      notch.style.left = `${Math.max(0, Math.min(1, threshold / scale)) * 100}%`;
      track.appendChild(notch);
    }
    row.appendChild(track);
    row.appendChild(el('span', 'verdict', pass === null ? '' : pass ? 'met' : 'short'));
    return row;
  }

  destroy() {
    this.clearPrompts();
    this.root.remove();
  }
}
