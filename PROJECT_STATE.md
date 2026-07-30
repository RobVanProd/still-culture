# Project state

Last updated: 2026-07-30. Anyone picking this up should be able to continue from
this file alone.

**Repository:** https://github.com/RobVanProd/still-culture · branch `main`
**Run it:** `py tools/serve.py`, then open `http://127.0.0.1:8181/`

---

## Where we are

Phase 0 (harness) complete and verified. Phase 1 (genre selection) complete and
recorded. **Phase 2's central gate has passed.** Knowing the hidden variant now
beats not knowing it, and acting on a wrong belief is worse than not acting on
one — which is the concept's whole thesis, expressed as a measurement.

Three Phase 2 items remain open: stalling is still too cheap, the pass thresholds
are still fiction, and no human has played it.

## What is measured and true

`tests/policy.js`, 4 dishes × 600-second sessions, real chemistry, real scoring:

| Policy | Shape (IoU) | Probes | Viability |
|---|---|---|---|
| passive — do nothing | 0.208 | 0 | 1.000 |
| stall — act only after t=420 | 0.200 | 0 | 1.000 |
| blind — steer, ignore the variant | 0.215 | 0 | 1.000 |
| probeOnce / probeHeavy — probe, ignore what it says | 0.215 / 0.214 | 4 / 6 | 0.835 |
| **informed** — one probe, plays the variant | **0.235** | 1 | 0.919 |
| **guessing** — acts on the wrong belief | **0.163** | 0 | 1.000 |

The shape of that table is the design working:

- **Knowing is worth +0.020. Being wrong costs −0.052.** The probe's value is not
  its upside, it is insurance against a downside two and a half times larger.
  That asymmetry is what makes "do I look" a judgement rather than a habit.
- **Probing without using the answer is pure loss** — `probeHeavy` pays 0.165 of
  viability for nothing. The instrument is not a score button.
- **Steering beats passivity**; player agency exists.
- **The stencil is still doing too much work.** `blind` gets 0.215 while ignoring
  the variant entirely, because the target tells you where to push. This is the
  next structural question, not a tuning one.

## Known defects, in priority order

1. **Stalling is too cheap.** 0.200 against 0.215. Commitment reduces actuator
   authority and gates variant expression, and a late player still pays only
   0.015. It should hurt more.
2. **The pass thresholds are fiction.** `passedShape` is 0.55; the best policy
   reaches 0.235. They were guessed before anything worked. Recalibrate from the
   distribution of good play.
3. **No human has played this.** Every number above is from bots. Bots establish
   whether a mechanic is load-bearing; they cannot say whether a decision is
   *interesting*, and that is the actual claim.
4. **The 40-second response latency is untested on a person.** A critic warned
   that a player who cannot attribute an outcome to an action "cannot form a
   theory, and cannot fail informatively". This is the biggest unquantified risk.
5. **Frame timing instrumented but unmeasured.** `requestAnimationFrame` does not
   run while the browser pane is hidden, which is how this is developed. The
   budgets in ARCHITECTURE.md are declared, not verified.
6. **The dark-field render is over-saturated** — reads as an oil slick rather than
   a living medium. Deliberately deferred; presentation does not start until the
   loop is done.
7. **No onboarding, save, pause, or accessibility.** Phase 3, correctly not begun.

## Blockers

None external.

## What was tried and rejected

Full record in `DECISION_LOG.md`. The four that cost the most:

- **Raising the feed rate as "nutrient".** The intuitive mapping, and it *kills*
  this culture. Found by controlled A/B against a no-input control, then
  explained by a response-surface sweep: the authority is almost entirely in K,
  and steeply — −0.004 multiplies coverage fivefold, +0.004 sterilises the dish.
- **Per-call parameter decay.** Ran every tick, giving player input a half-life
  of ~0.14 s. The player was writing on water, and five different policies scored
  within 0.01 of each other because none of them were really doing anything.
- **Targets drawn independently of the seeds.** Frequently unreachable, which
  reads as broken controls rather than as difficulty.
- **A variant that only changed *where* the correct action was needed.** With the
  stencil visible, that is deducible from the stencil, so knowing could not change
  a decision — `informed` scored *worse* than `blind`. Fixed by making the variant
  invert what enrichment *does*, so the same input helps or harms according to a
  fact no amount of staring at the target can supply.

## Exact next action

Make stalling cost more, and do it structurally rather than by raising a number.
The current commitment model reduces actuator authority in already-committed
tissue, which a stalling player avoids by simply having no tissue. Candidate: let
plasticity decay with *dish age* as well as with local structure, so a deliberately
blank dish also stiffens. Falsify with the existing `stall` policy — it must fall
clearly below `blind`.

Then recalibrate the pass thresholds from the measured distribution, and get one
human in front of it. Do not start visual, audio or onboarding work before that
playtest: the render is already better than the game deserves, which is exactly
the trap the mandate warns about.

## Reproducing the evidence

```
py tools/serve.py
```
then in the page console:

```js
const s = await import('/tests/smoke.js');  s.runSmoke();            // 11 invariant checks
const p = await import('/tests/policy.js'); GAME.loop.stop();
await p.runPolicyExperiment(GAME, { dishes: 4, duration: 600 });     // the table above
await GAME.capture({ name: 'x.png', width: 900, height: 900, at: 300 });
```

Captures land in `evidence/`. Two captures at the same simulation time are
byte-identical; `evidence/baseline/` holds committed reference images.
