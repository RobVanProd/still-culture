// The opening card.
//
// This exists because the first real playtest ended with "I was confused what
// things do... there is like no onboarding or explanation", and that was a fair
// verdict on a game that deliberately shipped without any.
//
// The design principle was "understandable through play rather than long written
// explanations", and it was applied too literally. Those are not the only two
// options. A player needs three facts before their first action can be a
// decision rather than a poke: what they are trying to do, what the controls do,
// and what the catch is. Withholding those does not create discovery, it creates
// a player pressing buttons to see which one does something — which is the
// opposite of the careful, restrained attention this game is asking for.
//
// What is still withheld is everything that matters: that the medium answers
// slowly, that each dish hides a variant, and that in a carrying region the
// enrichment works backwards. Those are the discoveries. The controls are not.
//
// Six short lines, dismissed by touching anything, never shown again unless
// asked for. It is a label on a machine, not a tutorial.

const CSS = `
.pr-veil {
  position: fixed; inset: 0; z-index: 40;
  display: grid; place-items: center;
  padding: 24px calc(24px + env(safe-area-inset-left, 0px));
  background: radial-gradient(ellipse at 50% 45%, rgba(6,10,16,.72), rgba(3,5,8,.95));
  color: #cfdcec;
  font: 400 14px/1.62 ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace;
  -webkit-user-select: none; user-select: none;
  opacity: 0; transition: opacity .5s ease;
}
.pr-veil.pr-in { opacity: 1; }
.pr-veil.pr-out { opacity: 0; pointer-events: none; }
.pr-card { max-width: 30rem; width: 100%; }
.pr-title {
  font-size: 19px; letter-spacing: .34em; color: #eaf3ff;
  margin: 0 0 1.4rem; font-weight: 500;
}
.pr-line { margin: 0 0 .85rem; }
.pr-line b { color: #eaf3ff; font-weight: 600; }
.pr-line .warn { color: #ff9b9b; }
.pr-rule { height: 1px; background: rgba(140,170,205,.18); margin: 1.4rem 0; }
.pr-go { color: #7f93ab; font-size: 12px; letter-spacing: .1em; }
.pr-go span { color: #cfe2f5; }
@media (max-width: 720px) { .pr-veil { font-size: 13px; } .pr-title { font-size: 16px; } }
`;

const LINES = [
  'A culture is growing in the dish. It grows on its own, and it is <b>slow</b> — an action takes most of a minute to show.',
  'Your job is to fill the <b>scribed outline</b>. Hold a finger on the dish to use the selected tool.',
  '<b>grow</b> spreads it. <b>shrink</b> pulls it back. Between them you can steer it.',
  'The last two tools <b>tell you what is really happening</b> in a patch — and <span class="warn">destroy that patch</span> doing it.',
  'You are scored twice: how close the shape came, and <b>how much of the culture you spent finding out</b>.',
];

export class Primer {
  constructor({ onDismiss = null, storageKey = 'still-culture.primer.seen' } = {}) {
    this.onDismiss = onDismiss;
    this.storageKey = storageKey;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.className = 'pr-veil';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'How to play');

    const card = document.createElement('div');
    card.className = 'pr-card';

    const title = document.createElement('h1');
    title.className = 'pr-title';
    title.textContent = 'STILL CULTURE';
    card.appendChild(title);

    for (const line of LINES) {
      const p = document.createElement('p');
      p.className = 'pr-line';
      p.innerHTML = line;
      card.appendChild(p);
    }

    const rule = document.createElement('div');
    rule.className = 'pr-rule';
    card.appendChild(rule);

    const go = document.createElement('p');
    go.className = 'pr-go';
    go.innerHTML = 'touch anywhere to begin &nbsp;·&nbsp; <span>ten minutes</span>';
    card.appendChild(go);

    this.root.appendChild(card);
    document.body.appendChild(this.root);

    // The dismiss gesture is also the gesture that unlocks audio, which browsers
    // will not grant without one. Putting the card first means the hum is
    // running from the first frame of play rather than from whenever the player
    // happens to touch the dish.
    this._dismiss = () => this.hide();
    this.root.addEventListener('pointerdown', this._dismiss);
    addEventListener('keydown', this._dismiss, { once: true });

    requestAnimationFrame(() => this.root.classList.add('pr-in'));
    this.visible = true;
  }

  static seen(storageKey = 'still-culture.primer.seen') {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.root.classList.remove('pr-in');
    this.root.classList.add('pr-out');
    try { localStorage.setItem(this.storageKey, '1'); } catch { /* private mode */ }
    setTimeout(() => this.root.remove(), 600);
    this.onDismiss?.();
  }

  show() {
    if (this.visible) return;
    document.body.appendChild(this.root);
    this.root.classList.remove('pr-out');
    requestAnimationFrame(() => this.root.classList.add('pr-in'));
    this.visible = true;
  }
}
