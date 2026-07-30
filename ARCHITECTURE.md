# Architecture

## The stack, and why

**Hand-written ES modules and WebGL2. No build step, no package manager, no
dependencies.**

This was forced and then turned out to be right. Node is not installed on the
development machine and will not be, so there is no bundler, no TypeScript
compiler and no npm. The consequences are all good ones:

- A saved file is a running game. Nothing can be stale, nothing can fail to
  compile, there is no watch process to die quietly.
- The dependency count is zero, so there is no supply chain, no licence audit
  beyond our own work, and nothing to update.
- Anyone can run it: `py tools/serve.py`, open the page. That is the whole
  install.

The cost is real and accepted: no static type checking. It is paid for with
small modules, explicit interfaces documented at the top of each file, and a
smoke test that exercises the actual simulation rather than trusting types.

Python 3.12 (PIL, numpy) is available and is used **offline**, for generating
texture and lookup data into `assets/`. It is not part of the runtime.

## Layers

Dependencies point downward only. A lower layer never imports a higher one.

```
  game/          the actual game: rules, entities, scenes, tuning
    |
  render/        draws what game/ describes; owns no game state
  sim/           the simulated substance; owns no rendering
  audio/         synthesised voices driven by game state
    |
  core/          loop, input, rng, perf, gl, audio graph
```

**Prohibited dependencies**, enforced by review:

- `core/` imports nothing from the project. It is the platform.
- `sim/` may not import `render/`. A simulation that knows how it is drawn
  cannot be tested headlessly, and headless determinism is the basis of every
  verification claim in this repository.
- `render/` may not mutate game state. It reads and draws. If a renderer needs
  to remember something between frames, that memory belongs to the renderer, not
  to the game.
- Nothing imports from `main.js`.
- No module reaches for `Math.random`, `Date.now`, or `performance.now` to drive
  simulation. Randomness comes from an `Rng` stream passed in; time comes from
  the fixed step. This is what makes a capture reproducible.

## Invariants

1. **The simulation is a pure function of (seed, tick, input stream).** Given the
   same three, it produces the same state. Every scripted test and every visual
   baseline depends on this. Breaking it is a defect regardless of how the game
   looks.
2. **The simulation runs at a fixed 120 Hz** and is never stepped by wall-clock
   delta. Rendering interpolates.
3. **Rendering may be skipped or repeated without affecting the simulation.**
4. **Audio is driven, never triggered blindly.** A sound is a function of state,
   so it can be steered while it plays.
5. **Every random draw comes from a named stream.** Systems fork their own, so
   adding a call in one system cannot shift another system's sequence.

## Performance budgets

Declared up front, measured in `core/perf.js`, and treated as defects when
missed. Target is 1920x1080 on a Radeon RX 7800 XT / Ryzen 7 5700.

| Budget | Limit |
|---|---|
| Frame time, median | 16.7 ms |
| Frame time, p95 | 20.0 ms |
| Frame time, p99 | 25.0 ms |
| Any single frame ("hitch") | 50.0 ms — counted individually, never averaged away |
| Simulation step | 4.0 ms |
| Render submission | 8.0 ms |
| Startup to interactive | 2000 ms |
| Shader compilation, total | 400 ms |

An average frame rate is deliberately absent. It is the least informative number
a game can report, because it hides exactly what players feel: the occasional
frame that takes four times as long as its neighbours.

**Status: instrumented but not yet measured against real gameplay.** There is no
gameplay to move through yet. Any performance claim before that measurement
exists is a guess and is marked as one.

## Verification

The development environment cannot see the game window — the browser pane is
usually not compositing, so `requestAnimationFrame` does not run and ordinary
screenshots time out. Everything therefore routes through one mechanism:

`GAME.capture({ name, width, height, at })` stops the loop, seeks the simulation
to an exact time by whole fixed steps, renders once into a preserved drawing
buffer, and POSTs the PNG to the dev server, which writes it to `evidence/`.

Two captures at the same simulation time are **byte-identical** (verified by
SHA-256), which means the same mechanism serves three purposes at once: it is
the screenshot, the deterministic visual baseline, and the regression test.

## Layout

```
index.html          entry; shows fatal errors on screen rather than a black canvas
src/main.js         bootstrap and the GAME diagnostics object
src/core/           loop, input, rng, perf, gl, audio — the platform
src/sim/            the simulated substance
src/render/         drawing
src/game/           rules, scenes, tuning
tools/serve.py      dev server; also receives captures
assets/             generated data (committed; generators live in tools/)
evidence/           captures; regenerated on demand, not committed
evidence/baseline/  reference images that ARE committed, deliberately
docs/               design records
tests/              scripted smoke and determinism checks
```
