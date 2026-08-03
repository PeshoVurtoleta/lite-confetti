# Changelog

All notable changes to `@zakkster/lite-confetti` are documented here. Format
follows Keep a Changelog; this project adheres to Semantic Versioning.

## [1.10.0] - 2026-08-03

Feature release: `attract` + `swirl` -- a **vortex / attractor**, the first **directed (point)**
force. Every force until now was uniform in space (`gravity`/`wind`/`gust`) or per-particle-random
(`turbulence`); this one is aimed at a *place*, so a burst can collapse into, blow out from, or
spin around a chosen point. `attract` is a linear-spring pull toward a per-burst center (accel =
`attract * (center - pos)`) -- zero at the center (no singularity), damped by `drag` into an inward
spiral; negative repels. `swirl` adds the perpendicular tangential term. The force draws **zero
rng** (a pure function of the particle's position + the burst center), so default `0` is
byte-identical -- every prior committed fingerprint is preserved (default `1569828004`, mixed,
wind, floored `2679696825`, box `804161759`, turbulence `1630588936`, gust `4074438162`, and the
v1.9.0 trail geometry) -- and a vortexed burst is reproducible for free.

### Added
- **`attract: number` on `burst()`/`spray()`** -- radial spring strength (1/sec^2, scaled by
  distance). Positive pulls toward the center, negative repels. Default `0` (none).
- **`swirl: number`** -- tangential strength (1/sec^2): spins particles around the center; the sign
  sets the spin direction. Default `0` (none).
- **`attractX` / `attractY`** -- the vortex center in CSS px. Default: the burst origin, so a bare
  `attract`/`swirl` spins around where the burst was fired.

### Semantics
- **Opt-in, zero-cost by default.** The force is guarded on `attract !== 0 || swirl !== 0`, so no
  branch fires by default -- a plain burst does no extra work and its seeded positions are
  byte-identical. All prior fingerprints (physics and the trail geometry) are preserved.
- **Deterministic when on.** The force draws no rng (position + center only), so a vortexed burst
  replays identically under a fixed seed, with its own committed fingerprints (attract-only,
  swirl-only, and both, all distinct).
- **Stable, finite, contained.** The spring is zero at the center (no singularity); a pull is a
  damped oscillator that spirals in; inside a bounding box the edge clamps still hold. A negative
  `attract` is an unstable anti-spring, so a fail-closed accel cap (`VORTEX_MAX_ACCEL`) bounds the
  acceleration -- a repeller can never drive a position to a non-finite value (verified).
- **Fail closed.** A non-finite/garbage strength or center coerces via `num()` (strengths to `0` =
  off, center to the burst origin); negatives are valid (repel / reverse spin).
- **No reduced-motion effect** -- the static render has no velocity to perturb.

### Internal
- Four per-particle columns (`vortX`, `vortY`, `attract`, `swirl`); the force is `[[at,-sw],[sw,at]]`
  applied to the radial vector, inserted after `gust` and before `drag` in the integrator. No
  hot-path allocation (the guarded block is a few multiplies + the component cap).

### Fixed
- **Trails are clearly visible again.** The per-segment "comet" taper added in 1.9.0 (alpha + width
  fading to a transparent tail) read as too faint -- on a dark background the ribbon all but
  disappeared. It had been added to fix an apparent overlap "smear", which turned out to be a
  misconfigured `floor` (particles piling up), not the trail. Reverted to the original single
  flat-alpha ribbon (uniform opacity along its length). The committed `strokeHash` gate returns to
  its 1.9.0-pre-taper value; no physics fingerprint is affected. The demo `trail` slider ceiling
  and ring-buffer capacity go back to 24 (from 14), restoring the longer, prominent ribbons.

## [1.9.0] - 2026-08-02

Feature release: motion **`trail`s** -- the first **render-path** feature (every prior release
extended the physics). Opt in at construction and each particle leaves a fading ribbon through
its recent world positions, so a fast burst reads as motion streaks instead of hard dots. The
key property: trails are a **pure overlay**. They draw as a world-space stroked polyline
(`moveTo`/`lineTo`/`stroke`, never `translate`) and never touch physics state, so **every**
committed physics fingerprint -- default `1569828004`, mixed, wind, floor `2679696825`, box
`804161759`, turbulence `1630588936`, gust `4074438162` -- is preserved byte-for-byte at any
trail depth. The new gate is the trail **geometry** itself (its own committed hash). Storage is
a fixed ring buffer allocated **once** at construction (zero-GC: no lazy growth), so the default
`trail: 0` allocates nothing and is byte-identical to v1.8.0.

### Added
- **`trail: number` on `createConfetti()`** -- the trail *capacity*: ring-buffer depth (samples
  of recent world positions) for the per-particle ribbon. Sizes the buffer once; default `0`
  (off, no buffers). Capped at 64; fails closed to 0 on non-finite/negative input.
- **`trail: number` on `burst()`/`spray()`** -- the per-particle *draw length* `0..capacity`
  (default: full capacity). `0` opts a single burst out; a shorter value draws a shorter ribbon.
  Requires a construction `trail` budget; ignored (no throw) on an instance created without one.

### Semantics
- **Pure render overlay.** The ribbon draws in world space via `stroke()`, never `translate`,
  and reads (never writes) physics state, so it cannot perturb any position fingerprint. A
  trailed burst still reproduces the exact committed physics hash at any depth (asserted).
- **Off by default, zero-cost.** `trail: 0` (the default) allocates no buffers, never advances
  the ring cursor, and emits no `stroke()` -- byte-identical to an engine without trails.
- **Deterministic geometry.** The ring buffer + a single global per-frame write cursor are a
  pure function of the seed, so the ribbon geometry replays identically (its own committed
  `strokeHash` gate; deeper vs shallower rings stroke distinct geometry).
- **Fail closed.** A garbage construction capacity coerces to off (0) or the 64-sample cap
  (never a huge allocation or a throw); a garbage per-burst length coerces to full/off/capped.
  On pool reuse a recycled slot's stale history can never leak -- the live sample count resets
  to 0 at spawn and grows only as the new particle writes fresh samples.
- **No effect under reduced motion.** The static render records no history, so it draws no trails.

### Internal
- Zero-GC fixed ring buffer: `trailX`/`trailY` (`Float32Array`, `maxParticles * capacity`) plus
  two `Uint8Array` per-particle columns (live count + draw length), all allocated once at
  construction only when trails are on. A global `_trailHead` cursor advances one integer per
  frame. Recording is TypedArray stores; the ribbon is a tapered "comet" -- one `stroke()` per
  segment, alpha + width fading from full at the head (the particle) to ~0 at the tail, so many
  overlapping trails read as motion streaks instead of stacking into an opaque smear -- and it is
  still allocation-free (per-segment alpha/width are plain numbers; proven under the torture alloc
  gate with a full trailed pool).

## [1.8.0] - 2026-08-02

Feature release: `turbulence` + `gust` -- the first **time-varying** forces. Until now every
force was constant, so a wide fall looked like parallel rain. `turbulence` gives each particle
a rotating acceleration (organic wander, so a burst fans out and mills); `gust` adds a global
sinusoidal horizontal acceleration layered on `wind` (the whole pool swells one way then the
other, in ~3s waves). Both draw **zero rng** -- a pure deterministic function of state the
engine already advances -- so default `0` is byte-identical (the committed `1569828004`, the
v1.6.0 floored `2679696825`, AND the v1.7.0 box `804161759` fingerprints are all unchanged),
and a turbulent/gusty burst is reproducible for free.

### Added
- **`turbulence: number` on `burst()`/`spray()`** -- a per-particle rotating acceleration
  (px/sec^2) that makes each particle wander organically. The curl direction reuses the seeded
  `tilt`/`spin` phases the engine already advances, so no rng is drawn. Default `0` (none).
- **`gust: number` on `burst()`/`spray()`** -- a global, sinusoidally-oscillating horizontal
  acceleration (px/sec^2) layered on `wind`. The whole burst shares one phase (a new
  instance-level elapsed-time clock), so it reads as a coherent breeze rather than noise.
  Default `0` (none).

### Semantics
- **Opt-in, zero-cost by default.** Each force is guarded on its value (`turb !== 0`,
  `gust !== 0`), so no branch fires by default -- a calm burst does no extra work and its
  seeded positions are byte-identical. All three prior committed fingerprints are preserved.
- **Deterministic when on.** Neither force draws rng: `turbulence` is a pure function of the
  per-particle `tilt`/`spin` phases (seeded once at spawn), `gust` of the shared `_elapsed`
  clock. A turbulent/gusty burst replays identically under a fixed seed, with its own committed
  fingerprints in the test suite (turbulence-only, gust-only, and combined, all distinct).
- **Bounded, finite, contained.** Both are accelerations applied before `drag`, exactly like
  `wind`, so they damp toward a terminal velocity and never run away; particles still expire on
  the life countdown. Inside a bounding box the edge clamps still hold -- a burst under strong
  turbulence + gust + wind + gravity in a tight elastic box stays finite AND contained (verified).
- **Fail closed.** A non-finite/garbage value coerces to `0` (off) via `num()`; negatives are
  allowed (they flip the curl / gust direction) and stay finite and deterministic.

### Internal
- New per-particle columns `turb` + `gust` (Float32, 8 B/particle), assigned at spawn like
  every other physics knob; a new instance-level `_elapsed` accumulator (one add per frame,
  read only inside the gust guard); a `GUST_HZ` module constant (~3s period).
- Torture: t5 fuzz threads `turbulence`/`gust` into the burst+spray differential op-stream
  (two same-seed instances stay bit-identical, proving the shared clock is deterministic); t6
  lane 5 carries both forces on the live pool (still ~0 B/frame); t1 adds
  `turbulence:NaN`/`-Infinity` + `gust:Infinity` poison rows. Unit suite 106 -> 113.

## [1.7.0] - 2026-08-02

Feature release: `wallLeft` + `wallRight` + `ceiling`. Completes the boundary `floor`
started into a full opt-in **bounding box** -- the three remaining edges of an axis-aligned
box that a particle reflects off instead of drifting through. Every edge is an absolute
CSS-px coordinate; restitution reuses the existing `bounce` (one bounciness for the whole
box). Opt-in and fingerprint-safe -- omit the edges (each defaults to an infinity sentinel)
and the default look, default positions, the committed determinism fingerprint
(`1569828004`), AND the v1.6.0 floored fingerprint (`2679696825`) are all byte-for-byte
unchanged.

### Added
- **`wallLeft: number` / `wallRight: number` on `burst()`/`spray()`** -- the X-min / X-max
  edges of the bounding box, absolute CSS-px X coordinates. A particle reaching a wall is
  clamped onto it and its horizontal velocity reflected (scaled by `bounce`). Defaults
  `-Infinity` / `Infinity` (no wall).
- **`ceiling: number` on `burst()`/`spray()`** -- the Y-min edge, the mirror of `floor`. A
  particle rising past it is clamped and its vertical velocity reflected. Default `-Infinity`
  (no ceiling). Together with `floor`, `c.burst({ ceiling: 0, floor: h, wallLeft: 0,
  wallRight: w, bounce: 0.4 })` fully contains a burst inside the viewport.

### Semantics
- **Opt-in, zero-cost by default.** Each edge's collision is guarded on its value against an
  infinity sentinel (`x < -Infinity`, `x > Infinity`, `y < -Infinity` are all always false),
  so no branch can fire by default -- a box-less burst does no extra work and its seeded
  positions are byte-identical. Both committed fingerprints (default + v1.6.0 floored) are
  preserved. A boxed burst is itself fully deterministic under a fixed seed (it draws no rng;
  the collisions are pure physics), with its own committed fingerprint in the test suite.
- **Shared restitution.** `bounce` now applies to every edge -- floor, walls, and ceiling
  alike -- a single-material box. It stays clamped to `0..1`, so no edge can add energy, and
  drag still damps each frame, so even `bounce: 1` settles. No escape: an elastic particle in
  a tight box under strong wind + gravity stays contained (verified).
- **Fail closed.** A non-finite/garbage edge coerces to its "off" sentinel (a wrong-signed
  infinity can never turn an edge on in the wrong direction); an inverted box (e.g.
  `ceiling > floor`) clamps deterministically and finitely, never a NaN or a crash.
- **No effect under reduced motion.** The static reduced-motion render does no integration
  and has no velocity, so the box edges are inert there, like `floor`/`wind`/`sway`.

### Internal
- Three new per-particle pool columns (`wallL`, `wallR`, `ceil`, mirroring `floor`), so a
  boxed burst and a box-less burst coexist correctly in one pool. Zero new hot-path
  allocation (T6 measures a full mixed pool under wind + a reachable full box at ~0 B/frame).
  New unit `describe('walls / ceiling (bounding box)')` (committed `BOX_HASH`; hash-neutral
  `minX`/`maxX`/`minY` containment proofs plus a dedicated ceiling-catches-the-launch case;
  restitution-shifts-trajectory; fail-closed + no-escape + spray + reduced-motion); torture
  T5 fuzzes finite/Infinity walls + ceiling through the differential stream, T6 lane 5 arms
  the full box for a resting pool, T1 adds wall/ceiling + inverted-box poison cases under the
  finite-position detector. See `decisions/0008-walls-box.md`.

## [1.6.0] - 2026-08-01

Feature release: `floor` + `bounce`. Adds the missing Y-axis boundary to the physics --
an opt-in settle line that particles land on instead of falling forever. `gravity` and
`wind` set the force; `floor` (an absolute CSS-px Y) and `bounce` (restitution `0..1`) set
where and how they come to rest, so confetti can pile up or bounce. Opt-in and
fingerprint-safe -- omit `floor` (default `Infinity`) and the default look, default
positions, and the committed determinism fingerprint (`1569828004`) are all byte-for-byte
unchanged.

### Added
- **`floor: number` on `burst()`/`spray()`** -- a settle-boundary Y in CSS px. A particle
  that reaches it is clamped onto the line; default `Infinity` (no floor).
  `c.burst({ floor: innerHeight - 20 })` lands confetti at the bottom of the viewport.
- **`bounce: number` on `burst()`/`spray()`** -- restitution `0..1` applied to vertical
  velocity on floor contact: `0` rests (settle / pile-up), `1` is perfectly elastic;
  default `0`. Only meaningful with a finite `floor`. `{ floor: y, bounce: 0.4 }` gives a
  lively rebound that damps out.

### Semantics
- **Opt-in, zero-cost by default.** The integrator guards the collision on the floor value
  (`if (y > floor)`), and the default `floor` is `Infinity`, so the branch can never fire
  by default -- a default burst does no extra work and its seeded positions are
  byte-identical (the committed fingerprint is preserved). A floored burst is itself fully
  deterministic under a fixed seed (it draws no rng; the collision is pure physics), with
  its own committed fingerprint in the test suite.
- **Damped, never a runaway.** `bounce` is clamped to `0..1`, so a rebound can never add
  energy, and drag still damps `vy` each frame, so even `bounce: 1` loses energy and
  settles. Particles still expire on the life countdown -- a floor never makes one immortal.
- **Fail closed.** A non-finite/garbage `floor` (`NaN`, `Infinity`, a string) coerces to
  `Infinity` (no floor), never a NaN position; an out-of-range `bounce` clamps to `0..1`.
- **No effect under reduced motion.** The static reduced-motion render does no integration
  and has no velocity, so a collision boundary is inert there, like `wind`/`sway`.

### Internal
- Two new per-particle pool columns (`floor`, `bounce`, mirroring `grav`/`wind`), so a
  floored burst and a floor-less burst coexist correctly in one pool. Zero new hot-path
  allocation (T6 measures a full mixed pool under wind + reachable floor/bounce at
  ~0 B/frame). New unit `describe('floor / bounce (settle boundary)')` (committed
  `FLOOR_HASH`, a hash-neutral `maxY` containment proof, restitution-shifts-trajectory,
  fail-closed + spray + reduced-motion); torture T5 fuzzes finite/Infinity floor + bounce
  through the differential stream, T1 adds `floor`/`bounce` poison cases under the
  finite-position detector. See `decisions/0007-floor-bounce.md`.

## [1.5.0] - 2026-08-01

Feature release: `wind`. Adds the missing lateral dimension to the physics -- a
sustained horizontal acceleration, the X-axis mirror of `gravity`, so `gravity` (down)
and `wind` (across) together express a 2D force vector. Opt-in and fingerprint-safe --
omit `wind` (or pass `0`) and the default look, default positions, and the committed
determinism fingerprint (`1569828004`) are all byte-for-byte unchanged.

### Added
- **`wind: number` on `burst()`/`spray()`** -- lateral acceleration in px/s^2. Positive
  drifts right, negative left; default `0`. `c.burst({ wind: 300 })` slants a burst
  sideways; `{ ...presets.snow, wind: 60 }` makes snow drift on a breeze. Applied before
  drag, so wind is damped toward a terminal lateral velocity exactly as gravity is toward
  a terminal fall speed.

### Semantics
- **Opt-in, zero-cost by default.** The integrator guards the wind term
  (`if (wind !== 0) vx += wind * dt`), so a default burst does no extra work and its
  seeded positions are byte-identical -- the committed fingerprint is preserved. A windy
  burst is itself fully deterministic under a fixed seed (it draws no rng; wind is pure
  physics), with its own committed fingerprint in the test suite.
- **Fail closed.** A non-finite/garbage `wind` (`NaN`, `Infinity`, a string) coerces to
  `0` (no wind), never a NaN position. Negatives are valid (leftward), so `wind` uses the
  signed `num()` coercion, not the non-negative one.
- **No effect under reduced motion.** The static reduced-motion render has no velocity to
  act on, so `wind` is inert there, like `sway`/`flutter`.

### Internal
- New per-particle `wind` pool column (mirrors `grav`), so a windy burst and a still burst
  coexist correctly in one pool. Zero new hot-path allocation (T6 measures a full windy +
  mixed pool at ~0 B/frame). New unit `describe('wind (lateral drift)')` (committed
  `WIND_HASH`, `sumX` drift-direction proof, fail-closed + spray + reduced-motion); torture
  T5 fuzzes signed wind through the differential stream, T1 adds `wind` poison cases under
  the finite-position detector. See `decisions/0006-wind.md`.

## [1.4.0] - 2026-08-01

Feature release: multi-shape mixing. Closes the last deferred feature from decisions
0003 and 0004. Opt-in and fingerprint-safe -- omit `shapes` and the default look,
default positions, and the committed determinism fingerprint (`1569828004`) are all
byte-for-byte unchanged.

### Added
- **`shapes: string[]` on `burst()`/`spray()`** -- mix multiple shapes in a single
  burst, chosen per-particle. `c.burst({ shapes: ['star', 'circle', 'rect'] })` fires
  one burst of mixed shapes instead of three overlapping ones. Repetition weights the
  mix (`['star', 'star', 'circle']` is ~2:1), matching how `colors` already picks per
  particle. Custom `registerShape()` names compose for free
  (`shapes: ['star', 'myLogo']`). `shapes` overrides the singular `shape`.

### Changed
- Nothing for existing callers. The single-`shape` path is untouched: when `shapes` is
  omitted (or empty / not an array / all-unknown), the engine takes the exact pre-1.4.0
  path with zero extra RNG draw, so seeded output is identical. A single-entry mix
  (`shapes: ['star']`) collapses to `shape: 'star'`, also byte-identical.

### Semantics (fail closed, per decision 0004)
- Unknown names in a mix are **dropped** (a call-time typo must not crash a running
  animation); an all-unknown or empty array falls back to the single `shape`. Mixing is
  per-instance: a `shapes` entry naming another instance's custom shape is dropped, never
  leaked (torture T8 X6).

### Internal
- `resolveShapeIds()` helper resolves `shapes` to ids once per call (never on the hot
  path); `spawn()` gains one conditional, allocation-free per-particle pick that draws an
  RNG value ONLY in the mixed lane. No new pool column -- `pool.shape[i]` already stored a
  per-particle id. A canonical mixed burst has its own committed fingerprint
  (`3132631460`).
- Tests: 82 unit (was 73); torture extended -- T5 F5 mixed-shape determinism + dispatch,
  T6 lane 5 (a `shapes[]` pool integrates at ~0 B/frame), T8 X6 cross-instance mix drop.

## [1.3.1] - 2026-07-31

Hardening release. Closes the two correctness gaps flagged (and deferred) in
decisions 0002 and 0003, both under the Law "fail closed on every unverified state,
null is not zero". No new public API; the default look, default positions, and the
committed determinism fingerprint (`1569828004`) are all unchanged -- validation is a
no-op for the in-range defaults.

### Fixed
- **Numeric options now fail closed.** `burst()`/`spray()` sanitise every numeric
  option: a non-finite value coerces to its documented default instead of poisoning a
  particle. Previously a `speed: NaN` propagated NaN into a drawn position (hashing
  silently as 0), a `lifeMax: NaN` made a particle **immortal** (`NaN <= 0` is false, so
  it never died), and a `colors: null` **threw** on `.map`. `drag` is additionally
  clamped to `[0,1]` (a retention factor above 1 amplified velocity). A call-time typo
  now degrades gracefully rather than crashing or poisoning a running animation --
  matching how an unknown `shape` name already falls back to rect.
- **`destroy()` zeroes the count getter.** It cleared the pool's `life` but not the
  `aliveCount` the `.count` getter returns, so a destroyed instance kept reporting its
  last integrated count. `count` now reads `0` immediately after `destroy()`.

### Changed
- `drag` outside `[0,1]` is clamped (was applied verbatim). The documented range was
  always `0-1`; only callers passing out-of-range values see a behaviour change.

### Internal
- Added `num()`/`nonneg()` fail-closed coercion helpers beside `clamp01`; all
  sanitisation runs once per `burst`/`spray`, never on the render hot path (T6 proves a
  pool spawned from garbage inputs still integrates at ~0 B/frame).
- Added a **non-enumerable, undocumented** `__stats()` conservation probe (the
  white-box introspection deferred in decision 0002): reports `{ cap, aliveGetter,
  aliveActual }` so the torture gate can assert the count getter never drifts from the
  true live-slot count. Non-enumerable, so the public shape and `Confetti.d.ts` are
  unchanged.
- Tests: 73 unit (was 57); torture tiers reworked -- T1 now proves coercion (finite
  positions, immortal bug gone) instead of documenting the old bounded-garbage
  behaviour, T3 adds a conservation soak + the fixed destroy/count assertion, T6 adds a
  sanitised-input zero-alloc lane, T9 K1 inverts to a sanitiser-poison control.

## [1.3.0] - 2026-07-31

First **feature** release on the F0/torture base. Adds custom shapes and tunable
flutter. The default look is unchanged and the committed determinism fingerprint
(`1569828004`) still reproduces: `flutter` defaults to 1 (reproducing the old wobble
exactly) and `sway` defaults to 0 (positions byte-identical to pre-1.3.0).

### Added
- `instance.registerShape(name, def)` -- register a custom particle shape, usable as
  `burst({ shape: name })`. `def` is either a **vector** draw function
  `(ctx, w, h) => void` (the engine sets `fillStyle` to the particle colour first), an
  **image sprite** `{ image }` (prerendered once and blitted, the same GPU-blit path as
  the emoji atlas), or `{ draw, blit }`. Shapes are **per-instance** (seed-sealed,
  invisible to other instances, dropped on `destroy()`); registering a bad name/def or
  overriding a built-in throws (fail-closed). Custom ids start at 5; built-ins keep 0..4.
- `flutter` (0..1, default 1) on `burst()`/`spray()` -- tumble depth. `1` is the classic
  wobble, `0` holds a piece rigid. Controls X-scale only, so it never shifts positions.
- `sway` (0..1, default 0) on `burst()`/`spray()` -- paper-like horizontal drift as a
  piece falls. Opt-in; `0` keeps the straight fall (and the committed fingerprint).
- Non-finite `flutter`/`sway` are clamped to their defaults (validated, unlike the
  physics numerics -- see the 1.2.3 note); a garbage knob never yields a NaN position.

### Changed
- The five-way shape `switch` (hot loop + reduced-motion static path) is replaced by a
  per-instance indexed shape table (`shapeDraw`/`shapeBlit`), so custom shapes dispatch
  through the same zero-allocation path as the built-ins. Proven by T6, which now also
  measures a live pool of a custom vector shape + an image sprite + sway at ~0 B/frame.
- `Confetti.js` is now fully **ASCII** (the suite Law): the functional default emoji is
  built from its code point (`String.fromCodePoint(0x1F389)`) and all box-drawing /
  em-dash / bullet characters in comments are ASCII. This closes the Law gap
  `decisions/0001` flagged for F1.
- Torture suite extended (still nine tiers, no new file): T1 covers registerShape
  argument validation + unknown-shape fallback + flutter/sway clamping; T5 adds a
  custom-shape + flutter/sway determinism lane; T6 the custom-pool alloc gate; T8 the
  **per-instance isolation** proof (one instance's shape is invisible to another) and a
  registry-aware retention check; T9 a sway-discrimination control.

## [1.2.3] - 2026-07-31

Infrastructure only -- **no runtime or API change**. `Confetti.js` is byte-for-byte
unchanged. This release rebuilds the torture gate in the suite's multi-tier shape
(modelled on `@zakkster/lite-bvh`) so the render loop is stressed the way the rest of
the suite is, not just gated for allocation.

### Changed
- The single-file three-phase gate (`test/torture.mjs`) is now a thin dispatcher over
  **nine tier files** in `test/torture/` sharing one `harness.mjs`: `t0` metamorphic
  laws, `t1` degenerate inputs, `t3` adversarial op orders, `t4` handle/stub/buffer
  abuse, `t5` differential-determinism fuzz, `t6` the zero-alloc gate (F0's Phase B),
  `t7` soak + occupancy conservation, `t8` cross-package poison + shared-ticker
  retention (F0's Phase A), `t9` controls (F0's Phase C, widened). Nothing the old
  gate proved was dropped; T2 (aliasing) is intentionally omitted, as in lite-bvh.
- All tiers are **black-box**: confetti's pool is encapsulated, so they observe only
  the public `count()` and the instrumented-ctx draw fingerprint, never private
  arrays. `Confetti.js` stays untouched.

### Added
- Seeded-PRNG replay: `TORTURE_SEED=<n> npm run torture` reproduces any fuzz run.
- Whole-suite red switch `CONFETTI_TORTURE_BREAK=1` (injects a retained allocation
  into the real T6 hot loop; the gate must then exit non-zero).
- `test/_env.mjs` gained an opt-in `assertFinite` draw-position check (default off, so
  the committed determinism fingerprint is unchanged) used as T9's NaN-detector.

### Notes (latent gaps surfaced by the new tiers -- not fixed here; see decisions/0002)
- `burst`/`spray` do **not** validate numeric options: a non-finite `speed`/`gravity`
  propagates NaN into particle positions until the particle's finite life expires, and
  a NaN `life` makes a particle immortal. Garbage-in does not crash and the pool stays
  bounded, but it is not fail-closed.
- `destroy()` zeroes the pool's life but not the `count` getter, so a destroyed
  instance reports its last integrated count until `clear()`/`update()` runs.
  These are candidates for a future validation patch (a source change, so out of scope
  for a byte-unchanged release).

## [1.2.2] - 2026-07-31

Infrastructure only -- **no runtime or API change**. `Confetti.js` is byte-for-byte
unchanged; this release brings the package onto the ecosystem Law's test and
packaging footing so later feature work (shapes, flutter) can be proven.

### Changed
- Test suite ported from `vitest` to the built-in `node:test` + `node:assert/strict`.
  The old suite could not have run: it imported the runtime API from
  `Confetti.d.ts` (a types-only file) and `vitest` was never installed. It now runs
  the real engine against the real `@zakkster` dependencies over a minimal browser
  shim (`test/_env.mjs`), with the `requestAnimationFrame` pump driving the real
  `lite-ticker` render loop.
- `test` script is now `node --test`; `vitest` removed from devDependencies.

### Added
- `test/torture.mjs` -- the zero-GC gate (`node --expose-gc test/torture.mjs`):
  Phase A proves a destroyed, dropped instance and its lent canvas are released
  (the shared ticker pins nothing after `destroy()`); Phase B proves `update()`
  retains 0 B/frame over a full 500-particle pool and a 10k-frame window fires no
  major GC; Phase C is falsifiable -- `TORTURE_CONTROL=alloc` drives a
  per-frame-allocating soak that must breach `maxMajor:0` and exit non-zero.
- Determinism gate: a seeded burst reproduces an identical integer-pixel draw-position
  fingerprint, committed and re-verified across processes.
- `CHANGELOG.md` (this file) and `llms.txt` added to the published `files` list;
  `@zakkster/lite-gc-profiler` and `@zakkster/lite-leak` declared as devDependencies.
- `torture` and `verify` npm scripts.

## [1.2.1]

### Fixed
- Emoji shape no longer rasterizes per particle per frame. The old path set
  `ctx.font` and called `fillText()` for every emoji particle every frame (font
  size varies per particle, so nothing cached) -- a colour-glyph raster storm that
  could freeze the main thread. Each unique glyph is now rasterized once to an
  offscreen atlas; the hot path is a `drawImage()` blit.

## [1.2.0]

### Added
- Named presets: `fireworks`, `cannons`, `snow`, `pride` (`export const presets`),
  spreadable into `burst()` / `spray()`.
- `colorsFromPalette(input)` -- normalize a lite-hueforge `toGradientStops()` result
  (or a plain palette) into a `colors` array; never returns empty.
- `fromElement(el, extra?)` -- burst-origin sugar from an element's bounding rect.
- Per-instance, opt-in pointer-follow spray (`spray({ followPointer: true })`):
  binds a passive listener only while a follow-spray is active, reference-counted,
  and consumes no rng draw (a non-following spray stays seed-deterministic).

## [1.1.0] - and earlier

Initial deterministic confetti engine: OKLCH colors, five shapes (rect, circle,
star, triangle, emoji), seeded RNG, zero-GC render loop, `prefers-reduced-motion`
support, and a shared ref-counted ticker.
