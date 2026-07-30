# Game vision

**STILL CULTURE.** A living medium grows in a dish. Every instrument that would
tell you what it is doing also damages it. The central verb is **withhold** —
deciding, second by second, not to look.

This document says what the game is for, what it should feel like, what will
arbitrate a design argument, and — at equal length, deliberately — what it is
not. Nothing here is implemented. `src/game/` is empty. Read every claim below
as intent, not as description.

## Where the concept came from

Twelve concepts were generated across four design lenses, attacked by eight
adversarial critics (two per batch: one hunting prior art, one hunting dominant
strategies), then ranked by three independent judges. STILL CULTURE won
unanimously, 173 points to 152 for the runner-up. It was the only concept in the
dossier both its critics said to keep, and one of them was explicit about
sequencing: build this one first, because the two ways it can fail are
falsifiable in a weekend.

The whole record is in `docs/_concepts_raw.json` and in the workflow journal.
Where this document quotes a critic, it is quoting that record.

## The player fantasy

You are the steward of something with its own agenda, which you can influence
but cannot command and cannot directly perceive.

The dish is on screen at full bleed — a dark-field render of a reaction-diffusion
field with a few thousand motile particles in it, breathing and branching in real
time, with a faint target stencil and a clock. You have four coarse, blind
actuators — heat, nutrient, shade, shear — and three instruments, and each
instrument takes its payment out of the culture. Fluorescence tells you species concentration in a
disc and bleaches it, costing that region growth you do not have. Aspirate
returns exact numbers and permanently removes mass, punching a hole the medium
must heal around. The acoustic sweep is cheap and whole-dish, and it tells you
that something is bifurcating, never where.

The information that is free is the information that is ambiguous: the way the
medium moves, and the sound it makes. The hum is synthesised live from field
statistics — dominant spatial frequency to pitch, variance to noise floor,
bifurcation to audible beating. It is always on, it costs nothing, and it is
never quite decisive.

The fantasy is not mastery of a machine. It is the specific competence of a
person who has worked with a living thing long enough to read it: the slow
replacement of measurement with recognition, until you can shape a culture almost
without looking at it. The expert in the design dossier, asked why they ignored
the collapsing north edge, says *the medium fixes that itself*.

You are scored twice. On what the culture became, and on how much of it you burned
finding out.

## What the player should feel

| When | Target feeling | What produces it |
|---|---|---|
| Minute 1 | Curiosity with a low unease. *This is happening whether I act or not.* | The dish is already moving before the player touches anything. The hum is present from the first frame. The stencil is faint and does not yet match. |
| Minute 10 | Culpability. Not tension, not triumph — culpability. | Scar load is rendered as a dulling in the same image being graded and a roughness in the same hum being steered by. The price of curiosity accumulates in front of the player, in the readout they need. |
| Minute 30 | Recognition, and the first honest regret. | Third dish. The player hears something and acts before they can say what they heard. Afterwards the trace shows that four of six probes changed no subsequent action. |

The minute-30 entry assumes a ten-minute dish, so it is the second or third
session rather than a late moment in one. That is not evasion of the question; it
is the answer. This game does not have a thirty-minute emotional arc. It has a
ten-minute one that gets denser each time you run it.

The feeling to design *against* is the one a critic named as the likeliest
outcome: that the ten minutes felt like waiting. Waiting and withholding are the
same posture and different experiences, and the difference is entirely whether
the free channels change moment to moment. If the hum and the motion field are
not gripping second by second, there is no game here and no amount of scoring
will supply one.

## Pillars

Four. Each is stated so that it can be violated, because a pillar that cannot be
violated cannot settle an argument.

### 1. The price of knowing is paid out of the thing you are keeping — and most of the time, you did not need to know

Every channel that answers a question precisely takes its payment in substrate.
Every channel that is free is ambiguous. There is no third kind.

The second half matters as much as the first. Most of the culture self-corrects.
A dish where every wobble needs an intervention has no dilemma in it, because
looking is then always correct and the cost is just a tax. The dilemma exists
only because doing nothing is usually right.

**Violated when:** any readout is both free and precise; the UI quietly
aggregates ambient channels into a number; a difficulty option makes probes
cheaper; or the field is tuned so that untended regions reliably fail.

**Arbitrates:** "Could we add a small chart of mean concentration over time, just
for readability?" No — that is a free precise channel and it deletes the game.
"Should the north edge collapse if left alone?" No — it should mostly heal, and
the player should learn that it heals.

### 2. Waiting buys certainty and spends authority

The medium differentiates irreversibly. The longer it grows, the less plastic it
becomes and the less the actuators can move it. Late commitment is weak
commitment.

This is the answer to the strongest dominant strategy either critic found. The
ambient channels are free and become decisive late — the two outcomes of a
bifurcation have different beat frequencies once they are far enough along — so
if waiting is free, the optimal policy is to refuse commitment: keep the mass
generic, take no shaping action a latent binary could invert, and commit hard in
the last ninety seconds once the binaries have resolved for nothing. The critic's
conclusion was that either way, "the game flattens to a fixed schedule rather than
a read."

Making the price of waiting a property of the medium rather than a timer is not
decoration. **The alternative considered and rejected** was a straightforward
deadline or a decaying score multiplier. Both work mechanically and both read as
the game punishing patience — which is fatal in a game whose subject is patience.
Declining plasticity is the same constraint with an honest cause: you may have
your certainty, but you are buying it with the ability to act on it.

**Violated when:** information acquired late is as actionable as information
acquired early; actuator authority is constant across the session; or the
pressure to commit comes from a clock rather than from the state of the field.

**Arbitrates:** any proposal to make the endgame more dramatic by increasing
actuator strength near the deadline. That inverts the pillar.

### 3. The branch point is grown, not scheduled

Each culture carries two or three latent binaries — hidden variants that invert
the correct response and that the free channels genuinely cannot separate until
it is nearly too late. Where and when a binary manifests is determined by the
culture's own growth: it appears wherever the dominant lobe actually forms, which
the player's own actions influenced. The binaries have staggered onset, so no
single moment answers everything.

This answers the other dominant strategy, and the critic who found it was blunt
about priority: the design "has no mechanism forcing the location or timing of the
branch point to itself be uncertain, which is the thing that would keep the
decision alive. Fix it before the hum, before the render, before anything."
Without it, one deterministic probe at the branch point is correct every session
and "do I look" stops being a live decision by about session five.

The consequence is the point: to probe the branch point you must first know where
it will be, and that is itself a read of the free channels. The expensive question
now depends on the cheap one.

**Violated when:** a binary manifests at a fixed time or a fixed place; the
binaries resolve together; or a readability fix makes the branch point signposted
in advance.

**Arbitrates:** "Testers can't find the branch point — should we mark it?" No.
Finding it is the skill. Make the growth that determines it more legible instead.

### 4. Nothing is explained during the run. Everything is explicable after it

During the ten minutes the player gets no help beyond what they pay for. When the
clock stops they get an after-action trace: they can scrub the run and see their
own interventions laid against what the field actually did.

This exists because of the deepest objection in the record, which the concept
itself did not flag. The player cannot run a controlled experiment — actuators are
coarse, latency is long, the field is continuous with many causes, every dish is a
different draw, and probing is scored against them. So when something happens they
cannot attribute it. The critic's phrasing: "That is not mystery, that is opacity,
and it is the thing that makes people put a game down while still calling it
beautiful."

The same pillar answers a second objection: that restraint cannot be taught,
because "doing nothing and doing the *right* nothing look identical on screen and
identical in the log." They do. So the end-of-run assay names waste explicitly —
it reports probes that changed no subsequent action. Identical during the run,
not identical in the report.

**Violated when:** the game hands out attribution during play (a highlight on the
thing that just changed, a hint, a post-hoc "that was the ropy variant" toast); or
when the end screen gives a number without the trace that explains it.

**Arbitrates:** every proposal that begins "what if we just told them". Tell them
afterwards.

## A single session

Ten minutes of real time, one dish, no pause.

| Time | What is happening | What the player is doing |
|---|---|---|
| 0:00–0:45 | Seeding. The medium establishes. The hum is a flat drone. | Watching. There is no correct action here and the game does not pretend otherwise. |
| 0:45–3:00 | The first lobes form. The medium is at its most plastic, so the actuators have the most authority they will ever have. | Coarse shaping, on almost no information. This is where the growth that determines the branch points is decided. |
| 3:00–7:00 | The binaries onset, staggered. Ambiguity peaks: a shimmer at an edge is either the start of a branch or the start of a collapse, and those want opposite interventions. | The actual game. Reading three ambiguous channels jointly, and deciding two or three times whether an answer is worth what it costs. |
| 7:00–9:30 | Differentiation has hardened. Reads are getting easier and interventions are getting weaker. | Executing a plan, or salvaging one — steering toward the nearest morphology still reachable rather than the stencil that no longer matches anything in the dish. |
| 9:30 | The assay. | Nothing. It is over. |
| After | The trace. | Scrubbing their own run against what the field did. |

The clock runs in real time, which is a design asset rather than a constraint: it
makes restart-scumming expensive, so the session budget is a real budget and not
an abstract counter. A critic noted this as the concept's one genuine structural
advantage over its rivals, adding that it "matters more than it sounds."

### What the assay reports

Three things, and the third is the unusual one.

1. **Shape.** How close the culture came to the target morphology. Shown as a live
   rendered difference throughout the run, never as a hidden number revealed at
   the end. Every judge flagged this: a morphology score the player cannot predict
   produces "I thought that looked right", which is corrosive in a game whose
   whole premise is trusting your own read.
2. **Scar load.** Bleached discs, aspirate craters, the asymmetry your instruments
   left. Already visible during the run as a dulling in the render and a roughness
   in the hum, so the number confirms rather than reveals.
3. **Waste.** Probes that changed no subsequent action. This is the line that
   teaches the game.

A finished dish is an artefact with your intervention history written into it, and
exports as a seed string somebody else can grow.

## What an hour buys that five minutes does not

This is the real test of whether the game has depth, so it should be answered
concretely rather than with the word "mastery".

**After five minutes a player can:** move the thermal ring, the nutrient drip and
the shear; hear the hum change when they do; see that the stencil does not match;
press the fluorescence key and get an answer. (The prototype ships three of the
four actuators and one of the three instruments — thermal ring, nutrient drip,
shear, and fluorescence — because that is the smallest set the two falsification
tests need.)

**After an hour a player can do four things they could not do at minute five.**

1. **Tell a branch from a collapse before the render does.** The two look the same
   at the edge for several seconds and want opposite interventions. The
   distinguishing evidence is a joint read — the beat in the hum, the coherence of
   the particle motion in the seconds before a structural commitment, and the
   behaviour at the dish edge. None is decisive alone. Getting there a dozen
   seconds early is the difference between an intervention with authority and one
   without, per pillar 2.

2. **Predict where the dominant lobe will form from the first ninety seconds of
   growth.** This is what makes a probe affordable at all: you cannot cheaply
   interrogate a branch point you have not located, and by the time it is
   obvious it is too late for the answer to be worth much.

3. **Decide, before pressing a key, whether the answer would change anything.**
   Name the action you would take under each outcome; if they are the same action,
   do not pay. This is the competence the game exists to train, and it is
   value-of-information reasoning with the cost charged to the asset. The novice in
   the dossier "ends with a dish that matches the stencil at 80% and fails
   viability, having spent all eight charges on questions whose answers changed no
   action they took."

4. **Do nothing on purpose, and say why.** Not the same as doing nothing. The
   difference is a claim about the medium — *that region self-corrects* — that the
   player can now make in advance and be right about.

None of these is an unlock, a stat, or a piece of content. They are all the same
player getting better at reading, which is why the game has no progression
systems and does not need any.

## Session length and audience

**Session length: ten minutes.** The prototype clock is ten minutes and the
shipping session is intended to stay between ten and fifteen. It has to be long
enough for two or three staggered binaries to onset and resolve, and short enough
that finishing a bad dish is cheaper than restarting it. The exact figure is not
settled and will be set by testing, not by argument.

**Audience.** People who liked being given information through degraded ambient
channels — the Duskers audience, the people who play with the sound on and would
notice if it were off. People who want a complete thing in ten minutes rather than
a campaign. People who are willing to lose a session to learning something.

It is not a large audience and the design does not chase one. The pitch is one
sentence — every instrument that tells you what it is doing also damages it — and
that sentence either lands on someone or it does not.

## Non-goals

These carry the same weight as the goals. Each is here because it is a plausible
thing to add and each would remove something specific.

**No upgrade tree, no unlocks, no earned instruments.** Whatever actuators and
instruments you have in session one, you have in session fifty. The scarce
resource in this game is knowledge; every unlock economy converts a scarce
resource into an owned one, and the moment a cheaper instrument can be bought, "do
I look" becomes "have I unlocked cheap looking yet" — a question about the save
file rather than about the dish. What improves across sessions is the player.

**No narrative exposition.** No laboratory, no character, no supervisor, no
emails, no reason given for why the culture matters. The dish is the entire
fiction. Story would supply the motivation the dish is meant to supply, and would
put something on screen that is interesting and costs nothing to look at, which is
precisely the thing this game does not have.

**No numbers going up.** No XP, no levels, no cumulative score, no streak. The two
scores describe one dish and are not summed across dishes. The accepted cost is
that there is no retention hook and a player who stops after one session has
finished the game as designed.

This also settles the strain lineage. Carrying a sample forward with drifted
constants and inherited scars is the best long-arc idea in the record, and it is
**cut from the prototype entirely**, because a critic was right that inherited
scars plus drifted constants "is a meta-progression system, and 'keep the strain
you understand or take a clean one you don't' is an unlock choice wearing
epistemic clothes." If ten minutes are not gripping without a lineage to grow, the
lineage is compensating for a hollow core, and that needs to be known in week one
rather than month six. It may return later. It is not load-bearing.

**No resource-management economy.** No currency, no throughput, no stockpile, no
supply chain, no allocation of a pool. Nutrient is not a budget; it is something
you do to a place. The instant there is a pool of anything, the player optimises
the pool instead of reading the field — and allocation is exactly the thinking
this concept exists to replace. A judge put the distinction well: making
observation the costed act changes what decisions are about, "from allocation to
epistemics."

**No combat, no antagonist, no contamination invader.** Nothing in the dish wants
to hurt the player. There is no opponent to model. The medium is indifferent
rather than hostile, and the distinction is load-bearing: hostility licenses
aggression, and aggression here — intervene harder, look harder, take control — is
exactly the instinct the game is trying to unteach.

**No procedural sandbox.** There is a target, a clock, and a real failure. The
reaction-diffusion toys already exist — Lenia, Powder Toy, the whole shelf — and
the design record is straightforward that they are the toy half of this idea: no
goal, no failure, no cost to looking. Remove the failure and looking becomes free,
and the game is gone.

**No tutorial text wall.** No modal explaining that fluorescence bleaches. The hum
answers within a frame of the player touching anything, which is a teaching
structure: the player is trained by correlation from second one. The accepted cost
is that the first dish is usually wasted. It costs ten minutes, and the trace
afterwards explains what happened, which is the intended way to learn.

**Not a science education product, and not a simulation of real biology.**
Gray-Scott is not a cell. There are no real species, no real reagents, no correct
terminology, and no accuracy claim of any kind. **The medium must be legible
before it is accurate**; where realism and readability disagree, readability wins
and the fiction is edited to match. What a player takes away is about deciding
under a cost, not about microbiology, and pretending otherwise would be a lie
about the product and would also start losing design arguments to the wrong
authority.

**Not a puzzle with a solution.** There is no correct sequence to discover and no
optimal opening — pillar 3 exists specifically to prevent one. Each dish is a
fresh draw, and the answer to "what should I have done" is frequently "less".

**No free precise channel introduced as an accessibility fix.** The audio is a
mechanic rather than decoration, which is a genuine accessibility problem: a
player on laptop speakers, with sound off, or with hearing loss is currently
playing a worse game and has no way to find that out. The fix is a visual
instrument built from the same field statistics and honestly degraded in the same
way the hum is — ambiguous, continuous, free. It is not a readout that says what
the hum would have said, because that channel would immediately dominate for
everyone.

## What is not yet decided

Stated here rather than quietly omitted, in the same spirit as ARCHITECTURE.md's
performance section.

- **The sister dish.** Two critics and two judges proposed a parallel culture
  grown from the same seed that the player may butcher freely, restoring the
  controlled experiment and upgrading the question from "do I look" to "do I look
  here or there". It is genuinely good and it is in tension with pillar 1, because
  some looking becomes free. The committed answer to attribution is the
  after-action trace; the sister dish is the fallback, to be A/B tested against
  the pure version if the trace proves insufficient. It is not in the pillars and
  should not be built on the assumption that it will be.
- **Whether three free channels survive as three.** The design claims a joint read
  of hum, particle coherence and edge behaviour beats one decisive expensive
  channel. A critic bet against it: players "find whichever channel has the best
  signal-to-noise for the decisions that actually matter and stop attending to the
  others", leaving "listen for the beat, act" — a single-channel reaction game with
  a good renderer. This is a tuning question and it is the one most likely to be
  answered badly.
- **Session length**, as above.
- **How the shape score is presented** so that it is predictable by eye, which is
  an unsolved readability problem and not a small one.

## The two ways to know this is wrong

From the concept's own falsification criteria, unchanged:

1. Testers report that the ten minutes felt like waiting. The free channels are
   not tense enough.
2. A policy of never probing scores as well as a considered one. The latent state
   is not doing its job.

Either result is worth more than a month of argument, and both are reachable in
days on a stack with no build step.
