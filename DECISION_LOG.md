# Decision log

Append-only. Entries are added, never edited or deleted. If a decision is
reversed, the reversal is a new entry that names the one it supersedes.

Every entry states what was decided, why, what else was considered and why each
alternative lost, and — the part that matters most — what evidence would show the
decision was wrong. A decision with no falsification condition is a preference,
and it should be recorded as one.

Entries D-001 to D-005 were taken during the Phase 0 harness work and written up
on the date below; they are backfilled, not invented after the fact, and the code
in `src/core/` predates the write-up. D-006 onwards were taken on the day they
are dated.

---

## D-001 — Hand-written ES modules and WebGL2, no build step, no dependencies

**Date:** 2026-07-30
**Status:** active

### Decision

The game is plain ES modules loaded directly by the browser, drawing through
WebGL2. No bundler, no transpiler, no package manager, no runtime dependency of
any kind. Python 3.12 with PIL and numpy is used **offline only**, to bake
textures, colour LUTs and stencil data into `assets/`.

### Reasoning

This began as a constraint and was kept on merit. Node is not installed on the
development machine and will not be, so there was no bundler available. Working
inside that produced three properties worth more than the thing given up:

- A saved file is a running game. There is no watch process to die quietly, no
  stale build to debug, no gap between what is on disk and what is executing.
- The dependency count is zero. No supply chain, no lockfile drift, no advisory
  to triage, no licence audit beyond our own work.
- The install is `py tools/serve.py` and open the page. That is the whole of it,
  on any machine, indefinitely.

The last one matters more than it looks. This project's verification story rests
on an agent being able to run the game and read numbers out of it. Every step
between "clone" and "running" is a step that can fail in a way nobody sees.

### What is given up

Static type checking, honestly and permanently. There is no TypeScript, so
nothing catches a renamed field or a wrong argument order before it runs.

That cost is paid three ways: modules stay small, each file documents its own
interface in a header comment, and `tests/smoke.js` exercises the actual
simulation rather than trusting a type signature. It is a worse safety net than a
compiler and it is accepted as such. JSDoc annotations are used where they cost
nothing, but nothing checks them.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Install Node, add a bundler and TypeScript | Buys type checking; costs a toolchain, a lockfile, a watch process, and a supply chain, in exchange for catching a class of error a smoke test also catches. The exchange is bad at this scale, and the marginal value of types falls as module size falls. |
| A commercial engine (Unity, Godot, Unreal) | The visual identity here is a simulation rendered directly — reaction-diffusion over float textures with a dark-field pass. An engine's value is its content pipeline, animation system, physics and editor, none of which this game uses. It would add gigabytes, an editor, a licence and an opaque frame loop to get a fullscreen quad and a compute-ish fragment pass. |
| A minimal bundler only, no types | Solves a problem we do not have. Nothing needs bundling: HTTP/2 and ES modules handle a dozen files fine, and the file count will stay small by design. |
| Canvas2D instead of WebGL2 | The simulation *is* the render. Gray-Scott plus advection plus ~4000 advected particles is a fragment-shader problem; on Canvas2D it is a CPU problem, and the CPU budget is 4 ms. |

### How this could be falsified

- A defect class appears repeatedly that a type checker would have caught, and
  costs more debugging time than a toolchain would cost to maintain. Two or three
  such defects is noise; a pattern over a month is evidence.
- The module count passes roughly fifty and load order or import graph problems
  start costing time.
- A WebGL2 feature the render needs turns out to be missing or unusably slow on
  the target hardware.

---

## D-002 — Fixed-timestep simulation at 120 Hz, interpolated render

**Date:** 2026-07-30
**Status:** active

### Decision

`src/core/loop.js` steps the simulation at a fixed 1/120 s. The renderer
interpolates between the last two states. The simulation is never stepped by a
wall-clock delta. The accumulated delta is clamped to `maxCatchUp` steps before
accumulation, and rendering may be skipped or repeated with no effect on
simulation state.

### Reasoning

Determinism is the foundation everything else in this repository stands on: the
visual baseline, the regression test, the reproducible performance capture, and
the ability to make a claim about the game without a human watching it. A
simulation stepped by the wall clock produces different results on different
machines, and different results on the same machine under load. Under that
regime a "deterministic baseline" is a fiction, and there is no honest way to say
a change did or did not alter behaviour.

There is a second, independent reason. A reaction-diffusion field with
advection is a feedback system integrated forward in time. Integrating it with a
variable step is not merely non-reproducible, it is numerically unstable in
exactly the low-frame-rate conditions where the player is already suffering. A
frame-rate dip becoming a simulation blow-up is a failure mode that must not be
available.

120 Hz rather than 60: the medium's actuators are continuous and the player is
steering by ear against a hum synthesised from field statistics. A 60 Hz step
puts audible quantisation into that signal path. 120 Hz costs roughly nothing at
the present sim size and removes the question.

The clamp exists because a backgrounded tab returning after ten seconds must not
attempt to simulate ten seconds on one frame. That is a multi-second freeze and
the first step of a spiral of death.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Variable timestep (`update(dt)` with real delta) | Kills reproducibility outright, and destabilises the integrator under load. Every verification claim in this project would become unavailable. |
| Fixed 60 Hz | Cheaper, and adequate for the sim, but coarsens the control-to-audio path in a game where audio is a primary information channel. |
| Fixed step with no interpolation | Simplest, and visibly judders on a 144 Hz display. Interpolation is a few lines in the renderer and costs nothing in the simulation. |
| Unclamped accumulator | Straightforward until a tab is backgrounded, at which point it hangs. |

### How this could be falsified

- Profiling shows the 120 Hz step consuming a meaningful share of the 4 ms
  simulation budget once the real medium is in place, with no perceptible
  benefit over 60 Hz. The test is a blind A/B on the hum's smoothness.
- Two captures of the same seed and simulation time stop being byte-identical,
  which would mean something is reading a non-deterministic source and the
  premise is already broken.
- Interpolation produces visible artefacts on a branching field — plausible,
  since interpolating a structure that is bifurcating is not obviously
  meaningful. If so, the answer is to render the latest state, not to unfix the
  step.

---

## D-003 — Headless deterministic capture as the single verification mechanism

**Date:** 2026-07-30
**Status:** active

### Decision

`GAME.capture({ name, width, height, at })` stops the loop, seeks the simulation
to an exact time by whole fixed steps, renders once into a preserved drawing
buffer at a forced size, and POSTs the resulting PNG to the dev server, which
writes it into `evidence/`. Reference images live in `evidence/baseline/` and are
committed deliberately.

### Reasoning

This exists because of an environmental fact, not a preference. The browser pane
in the development environment is usually not compositing. When a page is not
composited, `requestAnimationFrame` does not run: the loop does not tick, the
simulation does not advance, and an ordinary screenshot either times out or
returns a frame from an arbitrary moment. Development would then proceed with no
eyes at all.

An explicit render into a preserved drawing buffer works regardless of
compositing, because it does not wait for a frame callback. Combined with the
fixed step from D-002 it also produces a specific and valuable property: the
same name and simulation time always produce the same image, verified by
SHA-256.

That property collapses three tools into one. The screenshot an agent looks at,
the deterministic visual baseline, and the visual regression test are the same
mechanism. There is no separate test harness to keep in step with the game, and
no risk of the baseline being generated by a code path the game does not use.

`forcedSize` and `seek()` are part of the same decision: a capture whose size or
timing depends on the window is not a baseline.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Ordinary screenshots of the live window | Does not work — no compositing, no rAF, no advancing simulation. This is not a matter of degree. |
| A separate headless renderer for tests | A second render path that can silently disagree with the real one. The bug you most want to catch is the one where the game looks different from the test. |
| Video capture | Not reproducible, not diffable, and large in the repository. |
| Numeric-only assertions, no images | Catches sim regressions and misses everything the game is actually about. The whole visual identity is emergent field structure, which is precisely what a scalar assertion cannot describe. |
| Perceptual (fuzzy) image diffing | Would be needed if captures were not bit-exact. They are, so exact comparison is available and strictly stronger. Revisit only if determinism is lost. |

### How this could be falsified

- Captures stop being byte-identical across runs on the same machine — GPU
  driver non-determinism in floating-point paths is the plausible cause, and it
  would force a move to a tolerance-based diff.
- Byte-identical captures diverge across machines to the point that baselines
  cannot be committed usefully.
- The capture render path drifts from the live render path — for example if
  `forcedSize` handling starts producing a layout the player never sees. That
  would mean the mechanism is no longer testing the game.

---

## D-004 — All randomness through named, forked, seeded streams

**Date:** 2026-07-30
**Status:** active

### Decision

`Math.random` is prohibited. Every random draw comes from an `Rng` instance
(`src/core/rng.js`, xorshift32, seeded from a string via FNV-1a) passed into the
system that needs it. Systems call `fork(tag)` to obtain their own independent
stream rather than sharing one.

### Reasoning

Seeding is the obvious half. `Math.random` cannot be seeded, so a reproducible
scenario, a deterministic baseline and a repeatable performance capture are all
impossible while it is in use.

Forking is the half that is easy to skip and expensive to omit. With one shared
stream, the sequence any system receives depends on how many draws every other
system happened to take first. The consequence is a specific and horrible bug:
you add a single random call to the particle scatter, and the latent binaries in
the medium — untouched code, in a different file — start resolving differently.
The build is still deterministic in the strict sense, and every baseline is now
wrong, and the diff that caused it looks unrelated. Debugging that means
bisecting a determinism failure against a change that appears innocent.

Forked streams make the dependency explicit and local. Adding a draw inside one
system changes that system's sequence and nothing else.

For this game the stakes are higher than usual. The latent binaries — the hidden
variants that invert the correct response — are drawn from the seed. If the
sequence shifts, the same seed string names a different dish, and the "export
your dish as a seed string" idea (see D-006) stops working. Reproducibility here
is a player-facing feature, not only a test convenience.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| `Math.random`, seeded only where tests need it | The unseeded paths leak into simulation state and the guarantee is silently void. There is no way to enforce a partial rule. |
| One global seeded stream | Reproducible, but couples every system's sequence to every other system's call count. This is the bug described above. |
| A cryptographic PRNG | Slower, larger, and buys a property (unpredictability against an adversary) that a game does not need. Noise built from xorshift32 has no visible structure, which is the only requirement. |
| Per-system fixed seeds instead of forking | Works, and requires a registry of magic numbers that someone will eventually duplicate. `fork(tag)` derives them from the parent, so the whole run still descends from one named seed. |

### How this could be falsified

- The generator's statistical quality shows up visibly — banding or repetition in
  the particle scatter or the initial seeding of the medium. That is a
  replaceable component, not a change to the policy.
- Fork tags collide in practice, producing correlated streams in two systems.
- A player-visible feature requires randomness that must *not* be reproducible
  from the seed. None is currently planned.

---

## D-005 — Synthesised audio only; no sample files, ever

**Date:** 2026-07-30
**Status:** active

### Decision

All audio is computed at runtime through a small fixed WebAudio graph
(`voices -> bus -> master -> limiter -> destination`). There are no audio files
in the project and none will be added.

### Reasoning

The licensing argument is real but it is not the argument. The argument is that a
computed sound can be a continuous function of game state, and a sample cannot.
A sample can be triggered and pitched. A synthesised voice can be *steered* —
held, bent, made to beat against itself — while it is sounding.

In this game that distinction is load-bearing rather than aesthetic. The hum is
the player's primary free information channel: dominant spatial frequency drives
pitch, field variance drives the noise floor, and a bifurcation in the medium
becomes an audible beat frequency. The player is expected to learn to hear a
structural commitment a few seconds before it is visible. That is a continuous
mapping from field statistics to timbre, sampled every frame. There is no set of
audio files that implements it — not because it would be expensive, but because
the thing being expressed is a continuously varying state, and a trigger-and-
pitch model can only approximate it in discrete steps that the player would learn
to hear as steps.

The implementation cost is also small: a 16x16 downsample of the field read back
once per frame is cheap enough to tolerate the readback stall, and one frame of
latency is imperceptible here.

The limiter in the graph is not decoration. Additive synthesis with many
simultaneous voices clips hard and unpredictably, and a game that distorts at its
loudest moment distorts exactly when the player is listening hardest.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Licensed sample libraries or commissioned audio | Cannot express a continuous function of state. Also adds asset weight, a licence obligation, and a content pipeline this project deliberately does not have. |
| Generated audio assets, baked offline | Same defect: once baked, it is a sample. Offline generation is right for LUTs and stencils (D-001) because those are consumed by shaders that interpolate them; a sound is consumed by an ear over time. |
| Hybrid — synthesised hum, sampled UI clicks | Tempting, and it would put a sample pipeline in the repository for the least important sounds in the game. The UI is a handful of transients that additive synthesis handles. |

### How this could be falsified

- A required sound turns out to be impractical to synthesise convincingly and
  materially improves the game as a sample. That would be a specific, named
  exception, argued in a new entry — not a general reversal.
- The per-frame readback proves too expensive once the full render pass exists,
  forcing the audio to be driven from coarser or older statistics. That degrades
  the mapping without changing this decision.
- Playtesting shows the hum is not actually informative — see D-006 and the open
  questions. That would be a failure of the design, not of synthesis.

---

## D-006 — The game is STILL CULTURE

**Date:** 2026-07-30
**Status:** active

### Decision

The project builds **STILL CULTURE**: a living medium grows in a dish; every
instrument that would tell you what it is doing also damages it. The central verb
is **withhold** — deciding, second by second, not to look. The player steers
toward a target morphology with coarse blind actuators (thermal ring, nutrient
drip, shear) while the cheap information is ambient — the way the medium moves,
and the hum synthesised from its statistics. The run is scored twice: on what the
culture became, and on how much of it was burned finding out.

### How it was chosen

Twelve concepts were generated across four design lenses. Eight adversarial
critics attacked them, two per batch — one hunting prior art, one hunting
dominant strategies — with each concept seen by two independent critics. Three
judges then scored all twelve on seven axes (novelty, readability, depth,
emotion, feasibility, audiovisual potential, vertical-slice potential), 10 points
each, 70 maximum.

The full record — every concept specification, every critic verdict and all three
judge rankings with rationales — is in the workflow journal, and the concept
specifications are dumped at `docs/_concepts_raw.json`.

**Judge totals:**

| Concept | Player | Tech director | Mandate | Total |
|---|---|---|---|---|
| **STILL CULTURE** | 56 | 59 | 58 | **173** |
| COINAGE | 50 | 51 | 51 | 152 |
| SLOW MATCH | 47 | 51 | 53 | 151 |
| Objective | 49 | 47 | 54 | 150 |
| THE UNEVEN HOUR | 50 | 49 | 50 | 149 |
| Perfusion | 47 | 45 | 46 | 138 |
| VAGUS | 43 | 47 | 46 | 136 |
| LONGBODY | 42 | 45 | 41 | 128 |
| RESIDUAL | 40 | 40 | 41 | 121 |
| ARREARS | 39 | 41 | 37 | 117 |
| HEARSAY | 38 | 38 | 38 | 114 |
| Sounding | 35 | 33 | 34 | 102 |

Unanimous: STILL CULTURE was first on all three ballots, 173 against 152 for the
runner-up. It was also the only concept in the dossier that both its critics
kept. Its per-axis profile was 8/6/7/8/9/9/9, 8/7/7/7/10/10/10 and 9/6/8/7/10/9/9
— consistently strong on feasibility, audiovisual potential and slice potential,
and consistently weakest on **readability**, which is recorded here as the known
soft spot and appears again in the open questions.

### Reasoning

Three things decided it.

**The decision shape is not in the library.** Four critics across two lenses
attempted a reduction and none landed. Fog of war lifts for free. Duskers charges
risk. Theme Hospital charges time and money. Hardspace: Shipbreaker charges value
but its cutter is not an instrument. No shipped game makes the act of *measuring*
permanently disfigure the artefact you are graded on, with the disfigurement as
an explicit second score. One critic put the test plainly: nothing structural
here depends on the biology theme, which is the mark of a form rather than a
costume.

**The remaining flaws are tuning, not logic.** This is the argument that
separated it from the field. The concepts below it failed on statements that
cannot be tuned out: a legible error grammar *is* a gradient (RESIDUAL); a belief
expressible only as movement *is* a potential field (HEARSAY); the Tero model
converges, so runs either all end alike or never commit (Perfusion). STILL
CULTURE's two named dominant strategies are properties of a simulation that is a
handful of fragment shaders and can be retuned fifty times in a week.

**It fits the stack better than anything else considered.** Gray-Scott plus
advection plus ~4000 advected particles over ping-pong RGBA32F float textures at
512x512 is a known-quantity shader stack with headroom on the target GPU. There
are no art assets, no animation, no writing and no level design; the visual
identity *is* the simulation. Every other strong concept had exactly one
hand-tuned component carrying its entire visual case with no fallback — VAGUS
needed procedural quadruped locomotion to look alive, Objective needed blackbody
emission and wall thickness to be legible on the same pixel where they physically
fight, ARREARS needed a bit-deterministic 1500-body solver plus a concurrent
counterfactual ghost in hand-written JavaScript.

And the vertical slice is not a slice. Ten minutes, one dish, one strain, two
scores at the end — that is the finished object. Nothing is deferred to a phase
two that will not happen.

### The concepts that were killed, and by what argument

Recorded because the bar matters as much as the winner. Verdicts are the two
independent critics' calls.

| Concept | Verdicts | The killing argument |
|---|---|---|
| Sounding | kill / kill | See below. |
| HEARSAY | kill / kill | Every belief cashes out as movement, and movement is also the only actuator, so it is formally a potential field and players will correctly perceive it as pathing. Honesty strictly dominates, so the lie ledger is a resource the good player never spends. |
| ARREARS | wounded / kill | Pledging collateral against a thing already on rails is free, which dissolves the debt economy in twenty minutes; and default-as-transport is free fast travel. Also the only concept whose technology was a genuine stretch on this stack. |
| LONGBODY | kill / wounded | Fixed latency is precisely what motor learning erases fastest, and four to six in-flight round trips exceed working memory. The best idea in it — hearing your own command land, low-passed, seconds later — belongs in something else. |
| RESIDUAL | wounded / wounded | A pincer, not a tuning band: a consistently learnable parameter-to-shape mapping *is* a gradient, so legible means bisectable and rich means blind. Restart-scumming also voids an abstract measurement budget. |
| Perfusion | wounded / wounded | A free reversible clamp dominates three costly tools; four quantities encoded on 1200 edges with phase-lock carrying the most critical signal; and Tero adaptation converges, so "increasingly rigid, increasingly yours" and continual perturbation cannot both hold. |
| VAGUS | wounded / wounded | The stated mastery goal — expert play measured in how little you had to lie — *is* the dominant strategy, which makes the novel subsystem a punish-only fine rather than a system. |
| THE UNEVEN HOUR | keep / kill | Slow walls fronts pile against, fast channels that starve the region behind, lenses that focus a wave: Creeper World's terrain vocabulary with the substrate relabelled. The destructive oracle also manufactures its own bypass, because burned ground has no substrate left and is therefore a free rate sink. |
| SLOW MATCH | keep / kill | From Dust shipped irreversible pre-commitment into a continuous nonlinear field with slow agents who refuse. Both critics independently derived the same one-sentence optimum — light the top of the slope at dusk and sleep — which switches off the forecast cone, the window-versus-certainty tension, the crews and the smoke blindness simultaneously. |
| Objective | wounded / keep | Cold, thick and slow strictly dominates and nothing in the spec charges for it; blackbody emission and wall thickness both read as brightness on the same pixel at the exact moment both must be read. |
| COINAGE | wounded / keep | The most original concept in the dossier — a critic who killed a sibling on prior art searched and could not name what it reduces to. Rejected on readability and depth: the meaning map is a 48x6x4 tensor rendered as blots, a UI job no shipped game has done, carrying a loop that is otherwise two clicks and a wait; and useful vocabulary is capped by the number of mutually exclusive required *responses*, not event types. |

**Sounding is the useful precedent**, because it shows the bar being applied to a
concept nobody disliked. It was double-killed and finished last on all three
ballots, 102 points.

Its prior art is documented and commercial: Dark Echo (RAC7, 2015), Perception
(The Deep End Games, 2017) and Stifled (Gattai Games, 2017) all ship "the only
way to know anything is the main thing making you unsafe", and behind them sit
forty years of submarine sims where an active ping tells you the world and tells
the world about you. One critic dismissed the pitch's own defence — that the
closest comparison is a sonar operator, "and that is a job, not a genre" — as
"a dodge, and I think a knowing one. It is a genre."

Worse, the novelty had a measured half-life. Reviewers recorded Perception's
wearing off at about an hour, and Stifled's tension being nullified once players
found the safe distance at which to make noise. And its own control specification
dominated its risky option out of existence: a long-standoff strike gives a
muddier return but "seeds no crack under you", so optimal play is maximum
standoff every time, and muddiness is a perceptual cost, which is exactly what
practice deletes. As the critic put it, measurement stops being hazardous
precisely when the player gets good — "and that is the one outcome the design is
committed to producing."

The verdict was: kill it, and steal the permanent-measurement-cost idea for
something else. That idea is now the centre of STILL CULTURE.

### Alternatives rejected

Beyond the eleven above, two process alternatives:

| Alternative | Why rejected |
|---|---|
| Pick the safest build (SLOW MATCH) | It scored third and would have been the most pleasant thing to build. It also fails the assignment: a familiar thinking shape wearing a fresh subject. One judge named it explicitly as the trap. |
| Pick the most novel (COINAGE) | Most original by a clear margin and genuinely irreducible, but its novelty is concentrated in a readout nobody has ever built, with no fallback — showing the numbers destroys the concept. High variance with the least legible feedback is the wrong shape of risk for something that must ship polished. |
| Combine two concepts | Not seriously considered. Every one of these dies on a specific structural property; grafting adds surface without removing any of them. |

### How this could be falsified

The concept names its own kill conditions and they are cheap to run.

- **Testers report the ten minutes felt like waiting.** That means the free
  ambient channels are not moment-to-moment gripping and the "do I look" decision
  has no stakes.
- **A policy of never probing scores as well as a considered one.** That means
  the latent state is not doing its job.
- Multi-channel reading collapses to a single channel — players find whichever
  cue has the best signal-to-noise and stop attending to the others, leaving
  "listen for the beat, act", which is a reaction game with a good renderer.
- Morphology match judged by eye produces scores testers cannot predict. "I
  thought that looked right" is corrosive in a game about trusting your own read.

---

## D-007 — Latent binaries manifest where the culture's own growth puts them

**Date:** 2026-07-30
**Status:** active
**Answers:** the fixed-opening defect

### The defect

From the critic, on the concept's own description of expert play — probe once,
early, at the single place where the latent binary branches your plan:

> If the latent binary is what risk (2) requires it to be — lethal, common, and
> truly unreadable from ambient cues — then a single deterministic probe at the
> branch point is correct every single session, and "do I look" stops being a
> live decision by roughly session five.

And the diagnosis, which is the part worth keeping:

> The design has no mechanism forcing the *location or timing* of the branch
> point to itself be uncertain, which is the thing that would keep the decision
> alive. Fix it before the hum, before the render, before anything.

### Decision

The latent binary does not have a fixed address. It manifests **wherever the
dominant lobe actually forms** — a location determined by the culture's own
growth, which the player's own actions have already influenced. There are
multiple binaries with **staggered, growth-dependent onset**, so no single moment
answers everything.

### Reasoning

The exploit is not "the player knows the binary's value". It is "the player knows
where and when to buy the value cheaply". Randomising the value alone does not
touch it: an unknown coin flip read at a known address is still one memorised
probe.

Making the address emergent inverts the dependency. To probe the branch point,
the player must first know where the branch point will be — and that is itself a
read of the free channels, which is the skill the game is trying to teach. The
opening probe does not disappear; it stops being free. It becomes a bet placed on
a prediction, which is a decision rather than a recipe.

Staggered onset does the same work along the time axis. If everything a run
depends on is knowable at t=20 s, there is one moment of the run that matters. If
binaries come due at different times and their onset depends on how far the
growth has progressed — which the player has been changing — then the question
"is now the moment" recurs, with a different answer each time, and the player's
own earlier interventions are part of why.

This also protects the strain lineage. Drifted thresholds across a strain family
move *values*; if locations were fixed, drift would be furniture-moving rather
than deepening — the critic's exact complaint. With emergent locations, what
transfers between sessions is the reading skill, which is what should transfer.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Randomise only the binary's value | Does not address the exploit. The probe is still correct at a known place and time. |
| Randomise the location uniformly, unrelated to growth | Removes the memorised opening and replaces it with a lottery. An arbitrary location cannot be predicted from any channel, so reading skill buys nothing and the correct policy becomes "probe nowhere" or "probe randomly". Worse than the disease. |
| One binary, but hide the timing only | Halves the problem. A player who knows the address can watch it, and watching a known address is much cheaper than searching. |
| Remove latent binaries entirely | The concept collapses: with no hidden state that inverts the correct response, blind play always wins and there is nothing to withhold from. |
| Sister dish (a parallel culture from the same seed, freely butchered) | Proposed by one critic and endorsed by two judges, and it does address a different defect — see D-009, where it was weighed against the after-action trace. It does not fix the fixed opening: if the branch point has an address, the sister dish makes reading it cheaper still. |

### How this could be falsified

- Playtesters converge on a probe *schedule* anyway — a rule of the form "probe
  the largest lobe at 90 seconds" that works regardless of dish. That would mean
  growth-dependence is too weakly coupled to player action to be a real unknown.
- The opposite: locations are so unpredictable that no free channel narrows them,
  and players stop probing entirely because a probe is a coin flip. Measurable as
  probe usage collapsing to zero without a corresponding fall in score.
- Instrumentation shows the binaries' onset times clustering tightly across
  seeds, which would mean "staggered" is nominal.

---

## D-008 — The medium differentiates irreversibly; waiting buys certainty with authority

**Date:** 2026-07-30
**Status:** active
**Answers:** the stalling defect

### The defect

The stronger of the two dominant strategies the critics found:

> Ambient channels are free and they become decisive late — the pitch says so
> outright, that the two outcomes have different beat frequencies "once they are
> far enough along." So time is the only price of free information, and the
> optimal policy is to refuse commitment: keep the mass generic and
> undifferentiated, take no shaping action that a latent binary could invert, and
> commit hard in the last ninety seconds once the binaries have resolved for
> free.

And the consequence, which is fatal either way:

> Either way the game flattens to a fixed schedule rather than a read.

### Decision

The medium **differentiates irreversibly as it grows**. The longer it runs, the
less plastic it becomes and the less the actuators can move it. Late commitment
is weak commitment. Waiting is not free: it buys certainty and spends authority.

### Reasoning

The exploit exists because the two currencies were separable. Information
accrued with time; the ability to act did not decay. Under those conditions the
optimal policy is trivially "wait, then act", and no amount of tuning the
information rate changes the shape — it only changes when the last-safe commit
time is, and players will find it and use it every session.

Coupling them removes the free variable. Every second spent waiting is a second
of plasticity spent. The player is no longer choosing between certainty and
nothing; they are choosing a point on a curve where certainty rises and leverage
falls, and where the right point depends on the dish in front of them rather than
on the clock. That is a read, which is what the design wants.

**Why physically motivated rather than a timer.** This is the load-bearing part
of the decision, and it is why an explicit commitment deadline was rejected. A
timer that penalises late action reads as the game punishing patience — and
patience is the virtue this game exists to teach. The player would correctly
perceive the designer's hand, and the whole restraint thesis would read as
hypocrisy: *withhold, but not for too long, because we said so.*

Differentiation is not a rule imposed on the medium; it is a property of it. A
mass that has committed to a structure is harder to redirect than a mass that has
not. The player learns this the way they learn everything else here — by watching
the same actuator do less this minute than it did last minute — and the lesson
generalises, because it is about the substance rather than about the scoring.

It also gives the free ambient channels a second job. Plasticity is itself
readable: a medium that is still soft moves differently and sounds different from
one that has set. So "how much authority do I have left" becomes another thing
the expert reads for free, which deepens the channel the game most needs to be
worth attending to.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| A commitment deadline after which actuators are locked out | Same effect, visible hand. Reads as arbitrary punishment of the behaviour the game is otherwise asking for, and creates a hard schedule instead of removing one. |
| Make ambient channels resolve *later*, so stalling gains nothing | Guts the design. The free channels becoming informative is the reward for learning to read them; delaying that just makes the game more opaque. |
| Charge an explicit resource for time | Adds an economy, and any explicit cost curve is one the player optimises against directly rather than reading off the medium. |
| Score speed — reward finishing early | Rewards haste rather than judgement, and makes restraint strictly worse. Inverts the thesis. |
| Accept stalling and design around it | The critics were right that this flattens the game to a fixed schedule. There is no version of this concept worth building where the optimal policy is "do nothing, then commit". |

### How this could be falsified

- Players still find a stable late-commit time — meaning plasticity decays too
  slowly, or the late-committed dish still scores well enough. Directly
  measurable: plot first-substantive-action time against final score across many
  runs. If the correlation is flat or favours lateness, this has not worked.
- The opposite: the curve is so steep that all decisions collapse into the first
  ninety seconds, and the remaining eight minutes are watching. That is the "felt
  like waiting" failure arriving through a different door.
- Players report the stiffening as the game taking the controls away rather than
  as the medium setting. This is the failure mode the physical motivation was
  chosen to avoid, and if it happens anyway the motivation is not legible enough
  in the render and the hum.

---

## D-009 — After-action trace: attribution is taught afterwards, never during

**Date:** 2026-07-30
**Status:** active
**Answers:** the unattributable-failure defect

### The defect

Named by a critic as the deepest problem in the concept, and not one the pitch
had flagged:

> The player cannot run a controlled experiment. Actuators are coarse, latency is
> forty seconds, the field is continuous with many causes, every dish is a
> different draw of latent binaries, and probing — the only direct read — is
> scored against you. So when something happens the player cannot attribute it:
> was that the nutrient drip, the variant, or would it have branched anyway? A
> player who fails cannot form a theory, and cannot test a theory if they form
> one.

And the verdict on what that produces:

> That is not mystery, that is opacity, and it is the thing that makes people put
> a game down while still calling it beautiful.

### Decision

During the run the player gets nothing extra. Afterwards they can **scrub the
run** — replay it on a timeline with their own interventions shown against what
the field actually did, when each latent binary came due, and where the medium
was still plastic.

### Reasoning

The problem is real and the constraint is that any fix operating *during* play
hands out free information, which is the exact currency the game is about. Every
in-run remedy — a confidence readout, a highlighted cause, a diff against a
counterfactual — is a probe that costs nothing, and a free probe is a hole in the
centre of the design.

Moving attribution after the run separates the two things that were conflated.
The tension the game wants is uncertainty *while deciding*. The comprehension the
player needs is a causal story *about a decision already made*. Those can be
served at different times, and serving the second one afterwards costs the first
one nothing.

It also matches how the skill is actually acquired. The expert reads free
channels by correlation, and correlation needs paired observations: this is what
the hum did, this is what the field turned out to be doing. In the run, the pair
is separated by forty seconds and buried in other causes. In the trace, it is one
scrubbed second. Ten minutes of play generates a great many such pairs, and the
trace is where the player harvests them.

The run stays honest because nothing in the trace was available while it
mattered.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| The sister dish — a parallel culture from the same seed the player may butcher freely | The strongest alternative, proposed by one critic and endorsed by two judges, and it does restore a genuine controlled comparison. Rejected for now on three grounds: it puts a second dish on screen in a game whose entire image is one dish; it splits the ten-minute clock, so the sacrificial dish competes for attention with the scored one, which changes the game's shape rather than clarifying it; and it partially reopens D-007, since a freely butchered twin makes locating a branch point cheap. It remains the leading candidate if the trace proves insufficient, and it is listed in the open questions as an A/B. |
| In-run causal overlay | A free probe. Destroys the central economy. |
| A tutorial explaining the mechanisms | Explains the model instead of teaching the read. The skill here is perceptual — hearing a bifurcation — and perceptual skills are not transmitted by text. |
| Nothing; keep the opacity | The critic is right that this is how a beautiful game gets put down. Opacity is not the same as mystery, and a player who cannot form a theory cannot improve. |

### How this could be falsified

- Players do not use the trace, or use it once and never again. That would mean
  it is not answering a question they actually have, and the sister dish should
  be tested instead.
- Players use the trace and still cannot say why a run went wrong. The trace
  shows correlation across a single run; if the causes are genuinely
  cross-session, a per-run replay is the wrong instrument.
- Knowledge from the trace turns out to transfer as a recipe rather than a read —
  players extract fixed rules and stop listening. That would make the trace a
  solution manual rather than a teaching aid.

---

## D-010 — The end-of-run assay names waste explicitly

**Date:** 2026-07-30
**Status:** active
**Answers:** the unteachable-restraint defect

### The defect

> The central lesson — most of the culture self-corrects, so do nothing — cannot
> be taught by demonstration, because doing nothing and doing the *right* nothing
> look identical on screen and identical in the log. The player who correctly
> withholds and the player who was confused both did the same thing.

The concept's own novice-versus-expert description contains the shape of the
answer: the novice ends "having spent all eight charges on questions whose
answers changed no action they took."

### Decision

The end-of-run assay reports, by name and count, **probes that changed no
subsequent action** — a measurement taken, an answer received, and no shaping
action within the window in which that answer could have mattered.

### Reasoning

Restraint cannot be shown during the run, because it has no picture. It can be
named after it.

The distinction the player needs is not between acting and not acting; it is
between a question worth asking and a question that was never going to change
anything. That distinction is mechanically checkable — the probe's answer is
known, the actions taken afterwards are known, and whether the actions differed
from what the player was already doing is known. It requires no model of intent.

Naming it converts a diffuse feeling ("I probably looked too much") into a
countable quantity attached to specific moments, which the trace (D-009) can then
be scrubbed to. That is the pairing the design needs: the assay says *three of
your six probes changed nothing*, and the trace says *here they are*.

It also finally distinguishes the two identical-looking players. Both did
nothing; only one of them has a report saying their restraint was informed. The
lesson is not "probe less" — that is available already, and a player who
internalises only that will lose to the hard strains. The lesson is "probe where
the answer would change your hand", which is the actual skill.

This is deliberately kept separate from scar load. Scar load is the price of
looking, paid in the substrate, visible throughout the run as a dulling in the
render and a roughness in the hum. Waste is a different claim: not that a probe
was expensive, but that it was pointless. A probe can be expensive and correct.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| Fold waste into the scar-load score | Conflates cost with pointlessness. A necessary probe would then be indistinguishable from a wasted one, which is precisely the distinction being taught. |
| Show the waste counter live during the run | Free in-run information about whether a probe was worth it — a probe on a probe. |
| Grade restraint qualitatively ("measured", "reckless") | A label is not a lesson. It tells the player what they were without telling them which decision to reconsider. |
| Leave it to the trace alone | The trace shows everything, which means it shows nothing in particular. The assay's job is to point. |

### How this could be falsified

- The waste count correlates with nothing — good and bad runs show similar
  counts. That would mean the metric is not measuring the skill it claims to.
- Players optimise the counter directly, probing less than is correct in order to
  keep the number down, and lose to the hard strains as a result. The counter
  would then be teaching the wrong lesson.
- The "window in which the answer could have mattered" turns out to be
  unspecifiable — if plausible windows differ enough that the count swings with
  the definition, the metric is arbitrary and should not be shown.

---

## Open questions

Not yet decided. Each is listed with the evidence that would settle it.

| Question | What would settle it |
|---|---|
| **Is the sister dish better than the after-action trace?** D-009 chose the trace and kept the sister dish as the leading alternative. Two judges wanted it prototyped. | A direct A/B in the falsifying prototype: same seed, same target, half the testers with each. Measure whether players can state a correct causal claim about their run, and whether the second dish steals attention from the first. |
| **Does the strain lineage stay?** One critic recommended cutting persistence from the prototype entirely — if ten minutes are not gripping without a strain to grow, the lineage is compensating for a hollow core. | Build the prototype with no persistence. If the single session holds attention, add lineage and measure whether it deepens or merely retains. |
| **How is morphology match judged, and can the player predict it?** Both a critic and a judge flagged eye-judged stencil matching as producing unpredictable scores. Live rendered difference, live numeric difference, or a hidden score are all still on the table. | Ask testers to predict their shape score before it is shown. Systematic surprise means it needs to be visible during the run. |
| **What is the honestly degraded visual read for players without audio?** The hum is a mechanic, not decoration; laptop speakers, a shared room or hearing loss currently reduce the game to guessing. The obvious fix — a visual equivalent of the hum — risks deleting the game's identity. | Build the visual instrument, then compare scores and reported experience with audio on and off. It must be weaker and playable, not equivalent and not useless. |
| **How many latent binaries, and on what onset schedule?** D-007 commits to multiple with staggered growth-dependent onset. The count and the spread are unset. | Sweep in the prototype. Too few and the run has one decisive moment; too many and no single one is worth a probe. |
| **How steep is the differentiation curve?** D-008 commits to plasticity decaying with growth, not to a rate. | First-action time plotted against final score across many runs. The curve is right when neither early nor late commitment dominates and the best time varies by dish. |
| **What is the exchange rate between the two scores?** Shape match and scar load are both reported; whether they combine into one number, and how, is undecided. | Whether players can articulate a trade-off. If they cannot say what a point of shape is worth in scars, the presentation is wrong. |
| **Probe charges: how many, and are they fungible?** The concept names six or eight fluorescence charges plus aspirate and acoustic sweep. Not fixed. | Prototype sweep, read against probe-usage distributions. |
| **Does Gray-Scott stay interesting for ten continuous minutes?** Reaction-diffusion's interesting parameter band is narrow — a point one judge raised against a different concept, and it applies here too. | Run the sim unattended for ten minutes across many seeds and look at how many produce structure worth steering. If it needs a hand-mapped parameter manifold and a governor, that is a cost to book now. |
| **Do the performance budgets hold?** `core/perf.js` is instrumented; nothing has been measured against real gameplay because there is no gameplay yet. Any claim before then is a guess. | The first capture of the real medium at 1920x1080 on the target hardware, read off the perf HUD. |
