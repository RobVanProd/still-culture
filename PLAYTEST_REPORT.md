# Playtest report

**No human has played this yet, and that limits everything below.** Every result
here comes from scripted policies run headlessly against the real simulation
(`tests/policy.js`). Bots can establish whether a mechanic is load-bearing. They
cannot establish whether a decision is interesting, and the concept's whole claim
is about a decision being interesting.

Method: 4 dishes × 7 policies × 600-second sessions, real chemistry, real
scoring. Reproduce with the snippet at the bottom of `PROJECT_STATE.md`.

---

## What is working

**The medium is genuinely alive and genuinely legible.** Growth reaches ~31%
coverage over five minutes with visible branching structure, and the hidden
variant expresses emergently in the place the culture chose to build — the first
capture shows a dish whose committed centre has dissolved into discrete spots
while its uncommitted rim is still ropy. Nothing scripted that; it fell out of
the physics. This is the strongest thing the project has.

**The actuators have real, measurable authority**, and finding the correct ones
required measuring rather than reasoning (see the response-surface sweep in
`DECISION_LOG.md`).

**The probe costs what it should.** Four probes take viability from 1.000 to
0.835, the scar is still on the dish at the assay, and it is visible throughout.

**Steering beats passivity** by 26%, which is the minimum bar for the game
being a game.

## What is not working

### 1. Knowing is worse than not knowing — the central claim is currently false

| Policy | Shape |
|---|---|
| blind — ignores the variant entirely | **0.255** |
| informed — handed the variant free, plays it | **0.198** |
| guessing — assumes the wrong variant | 0.191 |

`informed` is given for free exactly what a probe is supposed to buy, and it
still loses. The concept's thesis — that the decision to look is the game — does
not hold in this build.

**Root cause, and it is structural rather than a tuning value:** the player is
shown the stencil they are scored against. If you know the shape you want, the
correct action at every point is deducible from the shape alone. The strain
cannot matter, because the target already told you what to do. Every probe is
spending substrate to learn something that cannot change a decision.

Both critics predicted the probe would be dominated. Neither predicted it would
be dominated by *the objective function*.

### 2. Stalling is nearly free

`stall` (no action until t=420, then commit hard) scores 0.251 against `blind`'s
0.255. Commitment now both gates variant expression and reduces actuator
authority, and it is still not enough. The second critic's predicted collapse is
unresolved.

### 3. The pass thresholds are fiction

`passedShape` is 0.55; nothing has ever exceeded 0.28. They were written before
anything worked. No policy has ever "passed", which makes the pass/fail signal
meaningless rather than harsh.

### 4. Everything about feel is unknown

Input latency, whether the actuators feel like leaning on something, whether the
40-second response delay reads as depth or as unresponsiveness, whether the hum
is audible as information rather than as ambience — none of this can be assessed
without a person. The 40-second latency in particular is the concept's biggest
untested risk: a critic flagged that a player who cannot attribute an outcome to
an action "cannot form a theory, and cannot fail informatively".

## Dominant strategies found

- **Feed inside the stencil, starve outside it.** Found immediately, works, and
  requires reading nothing. This is currently the optimal policy and it is the
  problem.
- **Never probe.** Strictly correct as the game stands, since probes cost
  viability and buy nothing.

## What would change these conclusions

The next experiment is specified exactly in `PROJECT_STATE.md`: make the
actuators' *consequences* depend on the variant, so that the same input helps or
harms according to a fact the player cannot see. If `informed > blind > guessing`
does not appear after that, the stencil itself comes out of the game rather than
another number being adjusted.

## Honest overall assessment

The simulation is better than the game. That is the exact failure mode the
mandate warns about, it is visible in the evidence rather than hidden by it, and
no presentation work will start until the gate above passes.
