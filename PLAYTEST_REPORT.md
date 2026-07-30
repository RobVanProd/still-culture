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

### 1. RESOLVED — knowing now beats not knowing

This section previously recorded the central claim as false. It has since been
repaired and the repair is worth keeping on the record.

The failure: `informed` (handed the variant for free) scored **0.198** against
`blind`'s **0.255**. Knowing the answer made play *worse*.

The root cause was structural. The player is shown the stencil they are scored
against, so the correct action at every point was deducible from the shape alone
and the strain could not matter. Both critics predicted the probe would be
dominated; neither predicted it would be dominated by *the objective function*.

The repair: the variant now inverts what enrichment **does**, not merely where it
is needed. A carrying region metabolises the enrichment backwards — feeding it
starves it — so the same input on the same visible lobe helps or harms according
to a fact no amount of staring at the target can supply.

| Policy | Shape | Probes | Viability |
|---|---|---|---|
| informed — one probe, plays the variant | **0.235** | 1 | 0.919 |
| blind — ignores the variant | 0.215 | 0 | 1.000 |
| guessing — acts on the wrong belief | **0.163** | 0 | 1.000 |

Knowing is worth +0.020; being wrong costs −0.052. The probe is insurance
against a downside two and a half times larger than its upside, which is a live
judgement rather than a fixed opening.

### 2. Stalling is still too cheap

`stall` scores 0.200 against `blind`'s 0.215 — a real gap now, where it was 0.004
before commitment began limiting actuator authority, but smaller than a design
claiming that patience costs authority should produce. The second critic's
predicted collapse is reduced, not resolved.

The likely reason is structural: commitment stiffens *tissue*, and a stalling
player avoids that by having no tissue. Plasticity probably needs to decay with
dish age as well as with local structure.

### 3. The pass thresholds are fiction

`passedShape` is 0.55; the best policy reaches 0.235. They were written before
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
  requires reading nothing — it reaches 0.215 while ignoring the variant. It is no
  longer optimal, but it is still strong enough that the stencil is doing more
  work than it should. This is the next structural question.
- **Never probe** is no longer correct: it forfeits the variant read, and being
  wrong about the variant costs more than the probe does.

## What would change these conclusions

A person playing it. Everything above is mechanical: it establishes that the
decision has teeth, not that making it is enjoyable. The 40-second response
latency in particular is the concept's largest untested risk.

## Honest overall assessment

The simulation is still better than the game, but the gap has closed: the central
decision now has a measurable structure, and it is the structure the concept
promised — a cheap read that is usually unnecessary and occasionally decisive.
What remains untested is the only thing that finally matters, which is whether
sitting with that decision for ten minutes is any good.
