// The tool palette.
//
// Every class here is prefixed `tp-`.
//
// It was `sc-` first, which is also the HUD's prefix, and both files defined
// `.sc-tool`. The HUD's version is a row in a vertical read-only list; mine is a
// button in a horizontal bar. Whichever stylesheet loaded second won, and on the
// first real phone playtest the palette rendered as a column stacked down the
// left edge on top of the results screen. Shared prefixes across independently
// authored files are a collision waiting to happen, so this one is its own.
//
// DOM rather than canvas, deliberately. On a phone the palette needs hit targets
// that meet platform guidance, text that stays crisp at any pixel ratio, and
// focus and labelling that a screen reader can follow. Drawing all of that into
// WebGL means reimplementing accessibility badly; a handful of buttons over the
// canvas gets it right for free and costs nothing, because it does not redraw.
//
// The one rule it must obey: it may not sit where the dish is. On a phone in
// portrait the dish is a square in the middle of a tall screen, which leaves a
// band at the bottom that is both empty and exactly where a thumb already is.

import { TOOL_ORDER, TOOL_INFO } from '../game/session.js';

const CSS = `
.tp-bar {
  position: fixed; left: 0; right: 0; bottom: 0;
  display: flex; gap: 6px; justify-content: center;
  padding: 10px 10px calc(10px + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(to top, rgba(4,6,10,.92), rgba(4,6,10,0));
  z-index: 20;
  font: 500 11px/1.2 ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;
  -webkit-user-select: none; user-select: none;
  touch-action: manipulation;
}
.tp-btn {
  flex: 1 1 0; max-width: 92px; min-width: 0;
  /* 44px is the smallest reliable touch target; the dish is unforgiving enough
     without the palette also being a source of mistakes. */
  min-height: 48px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px; padding: 6px 2px;
  border: 1px solid rgba(120,150,190,.22);
  border-radius: 9px;
  background: rgba(14,20,30,.72);
  color: #8ea6c4;
  cursor: pointer;
  transition: border-color .12s, background .12s, color .12s;
  -webkit-tap-highlight-color: transparent;
}
.tp-btn:focus-visible { outline: 2px solid #6fd6ff; outline-offset: 2px; }
.tp-btn[aria-pressed="true"] {
  border-color: rgba(140,220,255,.75);
  background: rgba(30,52,72,.92);
  color: #dff0ff;
}
.tp-btn.tp-probe { border-style: dashed; }
.tp-btn.tp-spent { opacity: .34; pointer-events: none; }
.tp-name { letter-spacing: .04em; font-size: 12px; color: #cfe2f5; }
.tp-btn[aria-pressed="true"] .tp-name { color: #ffffff; }
.tp-sub { font-size: 9px; opacity: .62; letter-spacing: .02em; }
.tp-cost { color: #ff9b9b; opacity: .85; }
.tp-charge { font-size: 10px; opacity: .75; font-variant-numeric: tabular-nums; }
.tp-key { font-size: 9px; opacity: .5; }
@media (pointer: coarse) { .tp-key { display: none; } }

/* Six controls do not fit across a phone. Measured: at 430px the row overflowed
   the viewport and the outer buttons were partly off-screen — which is how the
   first playtest met a palette it could not fully press. Two rows of three, with
   the three actuators on top and the two instruments plus shear below, so the
   things that cost something are not adjacent to the things that do not. */
@media (max-width: 620px) {
  .tp-bar { flex-wrap: wrap; gap: 5px 5px; padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px)); }
  .tp-btn { flex: 0 0 calc(33.333% - 4px); max-width: none; min-height: 52px; }
  .tp-name { font-size: 13px; }
  .tp-sub { font-size: 9px; }
}
@media (min-width: 900px) {
  .tp-bar { justify-content: flex-start; padding-left: 16px; background: none; }
  .tp-btn { max-width: 78px; }
}
`;

export class ToolPalette {
  /**
   * @param {object} opts
   * @param {() => import('../game/session.js').Session} opts.getSession
   */
  constructor({ getSession, onSelect = null } = {}) {
    this.getSession = getSession;
    this.onSelect = onSelect;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.className = 'tp-bar';
    this.root.setAttribute('role', 'toolbar');
    this.root.setAttribute('aria-label', 'Instruments');

    this.buttons = new Map();

    for (const tool of TOOL_ORDER) {
      const info = TOOL_INFO[tool];
      const b = document.createElement('button');
      b.className = 'tp-btn' + (info.kind === 'probe' ? ' tp-probe' : '');
      b.type = 'button';
      b.setAttribute('aria-pressed', 'false');
      // The hint is the only place the game explains itself in words, and it is
      // deliberately available to assistive technology rather than printed on
      // screen, where it would become a tutorial wall the vision document rules
      // out.
      b.setAttribute('aria-label', `${info.label}: ${info.hint}`);
      b.title = info.hint;

      // The verb, not the noun, is the large word. A player scanning six
      // controls under time pressure needs to know what each one does to the
      // dish, not what a microbiologist would call it.
      const name = document.createElement('span');
      name.className = 'tp-name';
      name.textContent = info.verb;

      const sub = document.createElement('span');
      sub.className = 'tp-sub';
      sub.textContent = info.cost || info.label;
      if (info.cost) sub.classList.add('tp-cost');

      const charge = document.createElement('span');
      charge.className = 'tp-charge';

      const key = document.createElement('span');
      key.className = 'tp-key';
      key.textContent = info.key;

      b.append(name, sub, charge, key);
      // pointerdown rather than click: a click waits for the gesture to resolve,
      // which on touch is a perceptible delay on the one control the player uses
      // constantly.
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.select(tool);
      });

      this.root.appendChild(b);
      this.buttons.set(tool, { button: b, charge });
    }

    document.body.appendChild(this.root);
    this.refresh();
  }

  select(tool) {
    const s = this.getSession();
    if (!s) return;
    s.tool = tool;
    this.onSelect?.(tool);
    this.refresh();
  }

  /** Cheap enough to call every frame, but only touches the DOM when something changed. */
  refresh() {
    const s = this.getSession();
    if (!s) return;
    for (const [tool, { button, charge }] of this.buttons) {
      const selected = s.tool === tool;
      const pressed = selected ? 'true' : 'false';
      if (button.getAttribute('aria-pressed') !== pressed) {
        button.setAttribute('aria-pressed', pressed);
      }
      const c = s.chargesOf(tool);
      const text = c === Infinity ? '' : `${c} left`;
      if (charge.textContent !== text) charge.textContent = text;
      const spent = c !== Infinity && c <= 0;
      button.classList.toggle('tp-spent', spent);
    }
  }

  setVisible(on) { this.root.style.display = on ? 'flex' : 'none'; }
  destroy() { this.root.remove(); }
}
