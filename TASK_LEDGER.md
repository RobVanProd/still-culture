# Task ledger

Priority order is the mandate's scope discipline: core interaction, then
controls, then readability, then depth, then structure, then presentation, then
performance. Nothing below jumps that order because it is easier or more fun to
build.

Status: `todo` · `doing` · `done` · `blocked` · `dropped`

---

## P0 — the core loop must pass its gate

| # | Task | Acceptance criteria | Status | Evidence |
|---|---|---|---|---|
| 1 | Medium simulates and grows | Coverage rises from seed to >25% over ~5 min, no instability, deterministic | **done** | `evidence/baseline/growth_coral_t300.png`; sweep in commit `6a82a26` |
| 2 | Actuators have authority | Each actuator moves local coverage measurably against a no-input control | **done** | nutrient +0.100, shade −0.036 vs control |
| 3 | Probes cost the substrate | Scar persists to the assay; viability falls measurably | **done** | viability 0.835 after 4 probes |
| 4 | Steering beats passivity | A steering policy beats do-nothing by a clear margin | **done** | blind 0.255 vs passive 0.208 |
| 5 | **Knowing beats not knowing** | `informed > blind > guessing`, margin > one probe's viability cost | **done** | informed 0.254 > blind 0.220 > guessing 0.151 |
| 6 | Stalling must cost | `stall` below `blind` | **done (modest)** | 0.203 vs 0.220. An ageing mechanism was tried and reverted — see DECISION_LOG |
| 7 | Recalibrate pass thresholds | Set from the distribution of good play | **done** | 0.240 shape / 0.700 viability, from measured play |
| 8 | **Human playtest** | One person plays unassisted and can explain why they failed | **ready** | nothing blocking; tunnel to be raised |

The gate is passed. Phase 3 below is built and integrated.

## P1 — controls and readability (after the gate)

| # | Task | Acceptance criteria | Status |
|---|---|---|---|
| 9 | Onboarding through play | A new player performs each verb once without text instruction | **done** | seven lessons, provoked by dish state |
| 10 | The hum is genuinely readable | States separable in the hum | **done (measured)** | 21/21 pairs separable by d-prime; *heard* by a human is untested |
| 11 | Actuator feedback | Every input has a distinct response | **done** | cue layer, synthesised |
| 12 | After-action trace | Post-run scrub of interventions against the field | **done** | `src/game/trace.js`, replayed deterministically |
| 13 | Waste reporting | Assay names probes that changed nothing | **done** | in the results screen |
| 14 | Touch / mobile | Playable on a phone | **done** | unified Pointer, DOM palette, dvh + safe-area |

## P2 — structure

| # | Task | Acceptance criteria | Status |
|---|---|---|---|
| 15 | Session arc | Title, onboarding, escalation, assay | **done** | `src/game/shell.js` |
| 16 | Save / pause / restart | Survives reload; pause is not a speed exploit | **done** | seed + input log replay, 21/21 tests |
| 17 | Accessibility | Sound-off playable; colour-blind safe; settings persist | **done** | visual trace channel, `src/game/settings.js` |

## P3 — presentation and performance

| # | Task | Acceptance criteria | Status |
|---|---|---|---|
| 18 | Dark-field art pass | Reads as a living medium, not an oil slick | **done** | `evidence/baseline/art_pass.png` |
| 19 | Measure frame timing | Real numbers against the budgets | **blocked** | headless timing is not trustworthy — pane does not composite. Needs a real device |
| 20 | Audio mix | Readable during dense play | **partial** | limiter in place; mix under load unverified without a listener |

## Dropped

| Task | Why |
|---|---|
| Strain lineage across sessions | A critic reduced it to *Creatures* and it is out of scope for a ten-minute vertical slice. Conceded in `GENRE_THESIS.md` rather than defended. |
