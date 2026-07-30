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
| 5 | **Knowing beats not knowing** | `informed > blind > guessing`, margin > one probe's viability cost (~0.04) | **doing** | **FAILING**: informed 0.198 < blind 0.255 |
| 6 | **Stalling must cost** | `stall` scores materially below `blind` | **doing** | **FAILING**: 0.251 vs 0.255 |
| 7 | Recalibrate pass thresholds | Thresholds set from the distribution of good play, not guessed | todo | current 0.55 never approached |
| 8 | Human playtest | One person plays three dishes unassisted and can explain why they failed | blocked by 5, 6 | — |

Tasks 5 and 6 are the gate. Everything below is deliberately not started.

## P1 — controls and readability (after the gate)

| # | Task | Acceptance criteria | Status |
|---|---|---|---|
| 9 | Onboarding through play | A new player performs each verb once without text instruction | todo |
| 10 | The hum is genuinely readable | A player can name which of three dish states they are hearing, eyes closed, above chance | todo |
| 11 | Actuator feedback | Every input has a visible response within 200 ms, distinct per tool | todo |
| 12 | After-action trace | Post-run scrub showing interventions against what the field did | todo |
| 13 | Waste reporting | Assay names probes that changed no subsequent action | done (untested) |

## P2 — structure

| # | Task | Acceptance criteria | Status |
|---|---|---|---|
| 14 | Session arc | Opening, escalation, conclusion inside one 10-minute dish | todo |
| 15 | Save / pause / restart | State survives reload; pause is not a speed exploit | todo |
| 16 | Accessibility | Playable with sound off at reduced effectiveness; colour-blind safe; remappable | todo |

## P3 — presentation and performance

| # | Task | Acceptance criteria | Status |
|---|---|---|---|
| 17 | Dark-field art pass | Reads as a living medium, not an oil slick; iridescence restrained | todo |
| 18 | Measure frame timing | Real numbers against the budgets in ARCHITECTURE.md | todo |
| 19 | Audio mix | Readable during dense play; limiter never pumping | todo |

## Dropped

| Task | Why |
|---|---|
| Strain lineage across sessions | A critic reduced it to *Creatures* and it is out of scope for a ten-minute vertical slice. Conceded in `GENRE_THESIS.md` rather than defended. |
