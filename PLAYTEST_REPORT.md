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

## Playtest 2 — first human, on a phone

Verbatim: *"I was confused what things do. i am unsure of the results I got as
well. it's promising but confusing. there is like no onboarding or explanation"*,
and then, on being told the goal: *"the idea is to have the squiggles match the
shape? but the shape isn't telling the whole story?"*

Three findings, in descending order of how much they cost.

**1. A CSS collision made the interface broken, not merely unclear.** `hud.js` and
`toolpalette.js` both defined `.sc-tool`; the HUD's vertical-list styling won, so
on a phone the palette rendered as a column stacked down the left edge, on top of
the results screen. Separately, six controls overflowed a 375 px viewport. The
player was fighting a half-broken interface, and any usability conclusion drawn
before this was fixed would have been about the bug rather than the design.

**2. The game gave six nouns and no verbs.** Controls were labelled with the
fiction's names — nutrient, shade, aspirate — and what each *did* lived in a
tooltip (absent on touch) and an aria-label (never heard by a sighted player).
"Understandable through play" had been applied to mean "unexplained", which is
not the same thing and produced button-mashing rather than discovery. Fixed:
controls lead with the verb, print their cost, and a five-line card states the
goal, the controls and the catch. What is still withheld is what actually matters
— the latency, the variant, and the inversion.

**3. The player diagnosed the deepest defect unprompted, and it is still open.**
"The shape isn't telling the whole story" is the same finding as the measured one:
`blind`, which ignores the variant entirely and pushes mass at the outline, scores
0.220 against `informed`'s 0.254. The stencil tells you what to do, so the game's
real subject is optional.

**The first attempt to fix it failed and was reverted.** A third score was added
for *texture* — interface per unit mass, against a brief. It does not work,
because that quantity is not controllable and barely varies: 2.867 with no input,
2.834 under nutrient, 2.867 under shade, 2.866 under thermal, and 2.78–2.88
across a full sweep of the diffusion ratio, which is what actually sets pattern
wavelength. Gray-Scott makes stripes whose boundary and mass scale together, so
the metric is close to a constant of the system and did not measure what it was
chosen to measure. A score the player cannot influence is worse than no score, so
it is gone. The diagnosis stands; this answer to it does not.

## Honest overall assessment

The simulation is still better than the game, but the gap has closed: the central
decision now has a measurable structure, and it is the structure the concept
promised — a cheap read that is usually unnecessary and occasionally decisive.
What remains untested is the only thing that finally matters, which is whether
sitting with that decision for ten minutes is any good.
