# Project state

Last updated: 2026-07-30. Anyone picking this up should be able to continue from
this file alone.

**Repository:** https://github.com/RobVanProd/still-culture
**Branch:** `main`  ·  **Last verified commit:** `6a82a26`
**Run it:** `py tools/serve.py` then open `http://127.0.0.1:8181/`

---

## Where we are

Phase 0 (harness) is complete and verified. Phase 1 (genre selection) is complete
and recorded. **Phase 2 (prove the core loop) is in progress and has not passed
its gate.**

The honest summary: the simulation is real and beautiful, the actuators work, and
a steering policy now measurably beats doing nothing. Two of the four things the
core-loop gate requires are still unproven, and one of them is the concept's
central claim.

## Current objective

Make the probe worth taking. A player who reads the dish and probes once at the
right moment must score better than a player who never probes — and right now
there is no evidence that they do.

## Active hypothesis — and the structural problem behind it

That experiment has now been run and it **failed**, informatively.

An `informed` policy — handed the variant for free, then applying the correction
that variant needs — scored **0.198**, materially *worse* than a `blind` policy
that ignores the variant entirely and simply feeds inside the target and starves
outside it (**0.255**). Knowing the answer made play worse.

The root cause is not a tuning value, and per the project's own rule no further
values will be tried against it:

> **A stencil target makes information worthless.** If the player is shown the
> shape they are being scored against, the correct action at every point is
> deducible from the shape alone — push toward it. The strain cannot matter,
> because the target already says what to do. Every probe is therefore spending
> substrate to learn something that cannot change a decision.

This is the same defect the critics named, arriving by a route neither of them
predicted. They expected the probe to be *dominated* by free ambient channels;
in fact it is dominated by the objective function.

Two structural repairs are candidates, and one must be chosen before any more
tuning happens:

1. **Make the actuator response variant-dependent.** Feeding a ropy region
   accelerates its runaway instead of growing it, so the same input has opposite
   consequences depending on a fact the player cannot see. Knowing then changes
   what you do, not merely where. This keeps the stencil and is the smaller
   change.
2. **Stop showing the whole stencil.** Give the assay criteria without the map —
   the player learns what is wanted but must find where it is reachable. This is
   the larger change and closer to the concept's original claim about replacing
   measurement with recognition.

Option 1 first: it is falsifiable in one afternoon and does not invalidate the
onboarding work option 2 would require.

## What is measured and true

From `tests/policy.js`, three dishes, 600-second sessions, run against the real
simulation:

| Policy | Shape (IoU) | Viability | Scar | Passes |
|---|---|---|---|---|
| passive (do nothing) | 0.208 | 1.000 | 0 | no |
| blind (steer, never probe) | 0.255 | 1.000 | 0 | no |
| probeOnce | 0.254 | 0.835 | 0.030 | no |
| probeHeavy | 0.254 | 0.836 | 0.030 | no |
| **informed** (told the variant, plays it) | **0.198** | 0.834 | 0.030 | no |
| **guessing** (assumes the wrong variant) | **0.191** | 1.000 | 0 | no |
| stall (act only after t=420) | 0.251 | 1.000 | 0 | no |

What this establishes:

- **Player agency exists.** Steering beats passivity by 26%. This was not true
  three commits ago; every policy scored identically.
- **Probing costs what it should.** Viability falls 0.835 from four probes and
  the scar is still on the dish at the assay.
- **Probing currently buys nothing.** This is no longer a gap in the test — it is
  a measured property of the design as it stands. `informed` loses to `blind` by
  0.057, and `informed` is handed for free the very thing a probe is meant to
  buy. The central claim of the concept is, at present, false in the build.
- **Stalling is nearly free**, at 0.251 against 0.255. Commitment now reduces
  actuator authority as well as gating variant expression, and it is still not
  enough to make a late player pay.

## Known defects, in priority order

1. **The probe has no demonstrated value.** The concept's whole thesis is the
   decision to look; nothing yet rewards looking. See the active hypothesis.
2. **Stalling is nearly free.** `stall` scores 0.268 against `blind` 0.272. The
   irreversible-differentiation answer to the second critic is implemented
   (commitment accrues and gates the latent variant) but it is not yet costing a
   late player anything measurable. Commitment probably needs to reduce actuator
   authority directly rather than only gating variant expression.
3. **The pass thresholds are fiction.** `passedShape` is 0.55 and nothing has
   ever exceeded 0.28. They were guessed before anything worked and must be
   recalibrated against what good play actually achieves.
4. **No human has played this.** Every result above is from scripted bots. Bots
   cannot evaluate whether a decision is interesting, only whether it is
   mechanically load-bearing.
5. **Frame timing is instrumented but unmeasured.** `requestAnimationFrame` does
   not run while the browser pane is hidden, which is how this is developed. The
   budgets in ARCHITECTURE.md are declared, not verified.
6. **The dark-field render is over-saturated.** The thin-film iridescence reads
   as an oil slick rather than a living medium. Cosmetic, deferred until the
   loop passes its gate — deliberately, per the mandate.
7. **No onboarding, no audio verification, no save/pause.** All Phase 3 work,
   correctly not started.

## Blockers

None external. Nothing is waiting on a dependency, a credential or a service.

## What was tried and rejected

Recorded properly in `DECISION_LOG.md`. The three that cost the most time:

- **Raising the feed rate as "nutrient".** The intuitive mapping; it kills the
  culture. Found by a controlled A/B against a no-input control, then explained
  by a response-surface sweep over F and K.
- **Per-call parameter decay.** Ran every tick, giving player input a half-life
  of ~0.14 s. Everything the player did evaporated before the chemistry could
  respond, which is why five different policies scored within 0.01 of each other.
- **Targets drawn independently of the seeds.** Frequently unreachable, which
  reads as broken controls rather than as difficulty.

## Exact next action

Implement repair option 1 in `src/sim/medium.js`: make the nutrient and shade
brushes read the latent field, so that the *same input produces opposite
consequences* depending on the variant. Concretely — feeding a region carrying
the ropy variant should push its K further down rather than up, accelerating the
runaway the player was trying to fatten.

Then re-run `runPolicyExperiment`. The gate is unchanged and is the one this
build has just failed:

```
informed > blind > guessing
```

with `informed - blind` larger than the viability a single probe costs (~0.04).
If that ordering still does not appear, option 1 is dead, and the design moves to
option 2 — withholding the stencil — rather than to another parameter sweep.

Do not begin any visual, audio or onboarding work until this ordering exists. The
render is already better than the game deserves, which is precisely the trap the
mandate warns about.

## Reproducing the evidence

```
py tools/serve.py
```
then in the page console:

```js
const m = await import('/tests/smoke.js');  m.runSmoke();          // 11 invariant checks
const p = await import('/tests/policy.js'); GAME.loop.stop();
await p.runPolicyExperiment(GAME, { dishes: 3, duration: 600 });   // the table above
await GAME.capture({ name: 'x.png', width: 900, height: 900, at: 300 });
```

Captures land in `evidence/`. Two captures at the same simulation time are
byte-identical; `evidence/baseline/` holds the committed reference images.
