# Project state

Last updated: 2026-07-30. Anyone picking this up should be able to continue from
this file alone.

**Repository:** https://github.com/RobVanProd/still-culture · branch `main`
**Run it:** `py tools/serve.py`, then open `http://127.0.0.1:8181/`

---

## Where we are

**Phases 0 to 3 are complete.** The vertical slice is built, integrated and
verified: harness, genre selection, core loop, and now onboarding, session shell,
HUD, dark-field art pass, procedural audio with verified discriminability,
save/replay, settings, accessibility, an after-action trace, and touch support.

The one thing that has never happened is a human playing it. That is the next
step and nothing else is blocking it.

## What is measured and true

`tests/policy.js`, 4 dishes × 600-second sessions, real chemistry, real scoring:

| Policy | Shape (IoU) | Probes | Viability |
|---|---|---|---|
| passive — do nothing | 0.216 | 0 | 1.000 |
| stall — act only after t=420 | 0.203 | 0 | 1.000 |
| blind — steer, ignore the variant | 0.220 | 0 | 1.000 |
| probeOnce / probeHeavy — probe, ignore what it says | 0.220 / 0.219 | 4 / 6 | 0.835 |
| **informed** — one probe, plays the variant | **0.254** | 1 | 0.919 |
| **guessing** — acts on the wrong belief | **0.151** | 0 | 1.000 |

The shape of that table is the design working:

- **Knowing is worth +0.034. Being wrong costs −0.069.** The probe's value is not
  its upside, it is insurance against a downside twice as large. That asymmetry
  is what makes "do I look" a judgement rather than a habit.
- **Probing without using the answer is pure loss** — `probeHeavy` pays 0.165 of
  viability for nothing. The instrument is not a score button.
- **Steering beats passivity**, though only by 0.004 when the variant is ignored.
- **The stencil is still doing work.** `blind` reaches 0.220 while ignoring the
  variant entirely, because the target says where to push. Withholding the
  stencil is the obvious next structural experiment if the human playtest says
  the reading is too shallow.

Other suites, all passing: `tests/smoke.js` 11/11 invariants, `tests/save.js`
21/21 (including a bit-identical replay from seed plus input log, and a control
proving a one-tick shift diverges), `tests/audio.js` 21/21 state pairs separable
by d-prime — including variant-off against variant-on at 2.64 JNDs, carried by
the beat, which is the pair the probe exists for.

## Known defects, in priority order

1. **No human has played this.** Every number in this repository is from bots.
   Bots establish whether a mechanic is load-bearing; they cannot say whether a
   decision is *interesting*, and that is the actual claim being made.
2. **The 40-second response latency is untested on a person.** A critic warned
   that a player who cannot attribute an outcome to an action "cannot form a
   theory, and cannot fail informatively". Onboarding now names the latency
   explicitly for exactly this reason, but naming it is not the same as it
   feeling good. Biggest unquantified risk in the design.
3. **Frame timing is still not honestly measured.** Direct timing of the render
   returns implausible figures — 0.02 ms median at 4K — because the browser pane
   is not compositing while this is developed, so the driver may be discarding
   work and `gl.finish()` may be returning early. The shader has an early-out
   for everything outside the dish, so real headroom is probably large, but
   *probably* is the honest word. This needs a visible window or a real device.
4. **Stalling costs 0.017**, comparable to what reading the variant gains. A
   substrate-ageing mechanism was tried to make it hurt more and was reverted —
   see DECISION_LOG. Left as measured.
5. **`blind` beats `passive` by only 0.004.** Playing without reading the variant
   is barely better than not playing. Skilled play is clearly ahead, so this may
   be correct design rather than a defect, but it is unverified either way.
6. **Two of six audio test dishes were inert** — the variant never expressed at
   all, so those dishes have nothing for a player to read. Seed generation may
   want a guarantee that the variant expresses somewhere.

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

**Put it in front of a person.** Everything that can be established without one
has been. The specific questions a playtest has to answer, in order:

1. Does the forty-second latency read as depth or as broken controls? This is the
   design's largest risk and no amount of further engineering will settle it.
2. Can a player form a theory about why they failed? The after-action trace exists
   for this; it has never been used by someone who did not write it.
3. Is the hum heard as information or as ambience? It is measurably
   discriminative; that is not the same as being noticed.
4. Does the moment of discovering the variant inverts your actuator land as a
   revelation or as unfairness?

Only after that: whether to withhold the stencil, and whether stalling needs to
cost more.

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
