# Changelog

All notable changes to `@zakkster/lite-confetti` are documented here. Format
follows Keep a Changelog; this project adheres to Semantic Versioning.

## [1.18.0] - 2026-08-10

Feature release: `flutterRate` -- **tumble-wobble speed**, the third tumble-axis knob and the flutter analog
of `spinRate`. `flutter` (v1.3.0) sets the *depth* of the 3D-ish X-scale wobble
(`wobbleScale = 1 - flut*0.5*(1-|cos(tilt)|)`), driven by the per-particle `tilt` phase the integrator
advances every frame. The wobble's *speed* has never had a public knob (`tiltV` is a fixed seeded random),
so a slow lazy flutter, a wobble frozen at a chosen tilt, or a fast shimmer were all unreachable. An opt-in
`flutterRate` **multiplies the accumulated wobble phase** about a stored birth pivot `tilt0`: `0` = frozen
wobble at each piece's *own* varied birth tilt, `0.3` = a slow lazy flutter, `1` = as seeded (default),
`2` = a fast shimmer, negative = reversed phase: `c.burst({ flutterRate: 0, flutter: 1 })`. The crux,
exactly like `spinRate`: it is a **render-time phase scale**, never a spawn-time `tiltV` scale. `pool.tilt`
-- the wobble phase the integrator advances *and* that the `turbulence` curl phase and `sway` read -- is
**never touched**; the draw block scales only the accumulated delta `(tilt - tilt0)` into a stack local that
feeds *only* the `wobbleScale` formula. So `flutterRate` is fully **decoupled** from turbulence and sway,
and the seeded *position* stream is byte-identical off, on, and on-with-turbulence -- reproducing the
same-seed plain burst's position hash exactly (`1569828004`), while the wobble sequence earns its own
committed fingerprint (`4094960833`). Off (`flutterRate: 1` / non-finite) feeds the raw `tilt` verbatim,
byte-identical to every prior release. It is **inert when `flutter` is `0`** (a zero-depth wobble has no
speed to scale). It reuses the v1.17.0 `scaleHash` probe -- **no new committed-hash channel**.

### Added
- **`flutterRate: number` on `burst()` and `spray()`** -- a tumble-wobble speed multiplier. `1` (default) =
  as seeded, `0` = frozen at the random birth tilt, `0.3` = slow lazy flutter, `2` = fast shimmer, negative
  = reversed. A render property of any moving piece, so **both** `burst()` and `spray()` honor it.

### Semantics
- **Rate-only about the birth pivot.** Only the accumulated delta `(tilt - tilt0)` is scaled, so
  `flutterRate: 0` freezes each piece at its OWN varied birth wobble (a different constant per piece), NOT
  collapsing every piece to `cos(0)=1`. A whole-phase multiply is rejected for the same reason `spinRate`
  rejected it.
- **Coerced with `num`, default 1.** Any finite value passes (`0` frozen, negative reversed, `2` fast);
  non-finite / non-numeric / undefined -> `1` (off). Not `clamp01` -- it is a rate multiplier, not a 0..1
  blend.
- **Inert when `flutter` is 0.** `flutter` (depth) multiplies the whole `(1 - |cos|)` term; at `flutter: 0`,
  `wobbleScale = 1` regardless of the phase, so `flutterRate` has nothing to scale (a zero-depth wobble has
  no speed). Correct by construction.
- **Pure render overlay, decoupled from turbulence and sway.** Never mutates `pool.tilt` or `ctx.translate`,
  so the seeded *position* stream is byte-identical off, on, and on-with-turbulence; only the wobble
  (scaleHash) moves. Draws **no rng**. Inert under reduced motion.

### Internal
- Two new per-particle pool columns: `tilt0` (Float32, the birth wobble pivot) and `flutterRate` (Float32,
  the render-time speed multiplier); +8 B/particle. `spawn()` **always** writes both -- `tilt0 = tilt` at the
  seed, `flutterRate = config.flutterRate` unconditionally -- so the TypedArray zero-init is never relied on
  (a `flutterRate` zero would mean "frozen wobble", a fail-closed requirement).
- The render wobble scale is guarded (`if (pool.flutterRate[i] !== 1)`) and folds into the existing
  `wobbleScale` formula -- paid only for armed pieces, a Float32 read + compare when off. Zero allocation --
  torture T6 measures a flutter-rated (`flutterRate` + `turbulence`) live pool at ~0 B/frame.
- Reuses the v1.17.0 harness probe `scaleHash` (wobbleScale feeds `ctx.scale`'s X arg); adds only a
  `lastScaleX` X-factor witness beside `lastScale`. New committed constant `FLUTRATE_HASH` (`4094960833`).
- Unit suite 193 -> 204.

## [1.17.0] - 2026-08-09

Feature release: `scaleTo` -- **size-over-life**, the first feature on the **render-scale** axis. For
sixteen releases a piece's *size* was fixed at birth (`pool.w`/`pool.h` drawn once in `spawn()` and never
changed), and the only `ctx.scale` was `flutter`'s X-wobble -- so a piece that shrinks away to nothing, or
an ember that blooms as it dies, was unreachable. An opt-in `scaleTo` scalar **lerps each piece's rendered
size** from `1.0` at birth to `scaleTo` at death by the *same* age fraction (`1 - life/maxL`) the
`lifeColors` ramp already indexes: `0.2` shrinks out, `2` grows, `0` vanishes at death; default `1` =
constant size: `c.burst({ scaleTo: 0.1, gravity: 300 })`. The crux: it is **isotropic** and **folded into
the single existing `ctx.scale` call**, never a second call -- flutter's X-wobble and the size ramp
multiply on one transform, and `pool.w`/`pool.h` are **never touched**. So scale never enters
`ctx.translate`, and a scaled burst reproduces the same-seed plain burst's *position* hash exactly
(`1569828004`) -- a pure render overlay (invisible to `rotateHash` and `colorHash` too), while the size
fold earns its own committed fingerprint (`148099462`). Off (`scaleTo: 1` / non-finite) leaves
`ctx.scale(wobbleScale, 1)` byte-identical to every prior release.

### Added
- **`scaleTo: number` on `burst()` and `spray()`** -- a size-over-life target. `1` (default) = constant
  size, `0.2` = shrink out, `2` = grow/bloom, `0` = vanish at death. A render property of any moving piece,
  so **both** `burst()` and `spray()` honor it.

### Semantics
- **Single scalar, default 1.** `s = 1 + (scaleTo - 1) * (1 - lifeT)`, reusing the `lifeT` already computed
  for the opacity fade and the `lifeColors` index -- zero new math on the shared path.
- **Isotropic.** One factor on *both* axes. Per-axis scale is out of scope (it collides with flutter, which
  owns X via the wobble); isotropic keeps the two orthogonal -- flutter wobbles X, `scaleTo` scales both,
  they multiply on one `ctx.scale`.
- **Negative clamps to 0, not to the default.** Coerced with `nonneg`: a *negative* -> `0` (a size has no
  direction -- **not** a mirror flip, **not** a fallback to `1`; `scaleTo: -2` renders identically to
  `scaleTo: 0`), non-finite / non-numeric -> `1`. `scaleTo: 0` is a legitimate value (the size analog of
  `spinRate: 0`).
- **Pure render overlay.** Never touches `pool.w`/`pool.h` or `ctx.translate`, so the seeded *position*
  stream is byte-identical off or on; only the size fold moves. The **trail ribbon keeps its birth width**
  (the ramp scales the body, not the streak). Draws **no rng**.
- **Fail closed.** `lifeT` is in `(0,1]` so `s` is finite and `>= 0` for any finite non-negative `scaleTo`.
  Inert under reduced motion (the static fan does no life integration and never calls `ctx.scale`).

### Internal
- One new per-particle pool column: `scaleTo` (Float32, the render-time size target); +4 B/particle.
  `spawn()` **always** writes it, so the TypedArray zero-init is never relied on (a zero would mean "shrink
  to nothing", a fail-closed requirement).
- The render size fold is guarded (`if (pool.scaleTo[i] !== 1)`) and folded into the SINGLE existing
  `ctx.scale(sx, sy)` -- paid only for armed pieces, a Float32 read + compare when off. Zero allocation --
  torture T6 measures a size-ramped (`scaleTo` + `flutter`) live pool at ~0 B/frame.
- New harness probe `scaleHash` / `lastScale` (a structural copy of the `rotateHash` / `lastRotate` pair,
  kept out of the position hash). New committed constant `SCALE_HASH` (`148099462`).
- Unit suite 182 -> 193.

## [1.16.0] - 2026-08-08

Feature release: `spinRate` -- **tunable tumble speed**, the second feature on the
**render-orientation** axis (part 2 of what `align` opened). For fifteen releases a piece's tumble *rate*
was a fixed seeded random (`spinV`, ~5 rad/s), so slow drifting petals, frozen rigid chips, and reverse
tumble were unreachable. An opt-in `spinRate` **multiplies the accumulated tumble**: `0` = rigid (frozen
at each piece's *random birth tilt* -- varied, not axis-aligned), `0.3` = a lazy drift, `2` = double,
negative = reverse; default `1` = as seeded: `c.burst({ spinRate: 0.3, gravity: 200 })`. The crux: it is
a **render-time angle scale, never a spawn-time `spinV` scale**. `pool.spin[i]` -- the physics spin the
turbulence curl phase *reads* to drive `vx`/`vy` -- is **never touched**; the draw block scales only the
accumulated delta `(spin - spin0)` about a stored random birth column into a stack local. So `spinRate`
and `turbulence` are fully **decoupled**, and the seeded *position* stream is byte-identical whether off,
on, or on-with-turbulence -- the same position hash (`1569828004`) in all three, while the rotation earns
its own committed fingerprint (`1105261140`). It reuses the v1.15.0 `rotateHash` probe -- the first
orientation feature to ship without a harness change. Off (`spinRate: 1` / non-finite) emits the raw
`spin`, byte-identical to every prior release.

### Added
- **`spinRate: number` on `burst()` and `spray()`** -- a tumble-speed multiplier on the seeded random
  spin. `1` (default) = as seeded, `0` = rigid at the random birth tilt, `0.3` = slow drift, `2` = double,
  negative = reverse. A render property of any moving piece, so **both** `burst()` and `spray()` honor it.

### Semantics
- **Multiplier, default 1.** Any *finite* value passes (`0` and negatives are valid -- rigid and reverse
  tumble); coerced with `num` (non-finite / non-numeric -> `1`), **not** `clamp01` -- a rate multiplier is
  not a `0..1` blend.
- **Rate-only via a birth pivot.** Only the accumulated tumble `(spin - spin0)` is scaled, about each
  piece's stored *random* birth orientation, so `spinRate: 0` freezes each piece at its own varied tilt
  (rigid but organic) rather than collapsing every piece to angle `0`.
- **Pure orientation overlay, turbulence-safe.** A render-time angle scale that never touches
  `pool.spin[i]` or `ctx.translate`, so the seeded *position* stream is byte-identical off, on, and
  on-with-turbulence; only the rotation sequence moves. Composes with `align` (the tumble scale runs
  first, then `align` blends toward the velocity heading). Draws **no rng**.
- **Fail closed.** Non-finite / non-numeric -> `1`. `rot` is finite for any finite `spinRate` (a bounded
  seeded angle times a finite multiplier). Inert under reduced motion (the static fan has no accumulated
  tumble to scale).

### Internal
- Two new per-particle pool columns: `spin0` (Float32, the random birth orientation the scale pivots
  about) and `spinRate` (Float32, the render-time multiplier); 8 B/particle. `spawn()` always writes both,
  so the TypedArray zero-init is never relied on (a zero `spinRate` means "frozen", a fail-closed
  requirement).
- The render angle scale is guarded (`if (pool.spinRate[i] !== 1)`): `spin0 + (spin - spin0) * rate`, paid
  ONLY for scaled pieces, on the render path, BEFORE the `align` blend. The turbulence phase keeps reading
  the *unscaled* `pool.spin[i]`, so the two are decoupled. Zero allocation -- torture T6 measures a
  tumble-scaled (`spinRate` + `turbulence`) live pool at ~0 B/frame.
- No harness change: reuses the v1.15.0 `rotateHash` / `lastRotate` probe. New committed constant
  `SPINRATE_HASH` (`1105261140`).
- Unit suite 173 -> 182.

## [1.15.0] - 2026-08-06

Feature release: `align` -- **velocity-aligned orientation**, the first feature on a new
**render-orientation** axis. For fourteen releases a piece's rotation was only ever *random tumble* (a
seeded `spin` plus a `flutter` X-scale wobble); this opens **which way** it faces. An opt-in `align`
(a `0..1` blend) rotates each piece **broadside to its live velocity** -- `atan2(vy, vx) + PI/2`, so its
flat face meets the airflow like a falling leaf -- re-banking every frame as gravity/wind/vortex bend the
path: `c.burst({ align: 1, gravity: 200, spread: 0.4 })`. It is a **pure orientation overlay**: rotation
never touches `ctx.translate`, so the seeded *position* stream is untouched -- an aligned burst reproduces
the same-seed plain burst's position hash (`1569828004`) *exactly*, while the rotation earns its own
committed fingerprint (`1909618495`). Off (`align <= 0` / non-finite) emits the raw `spin`, byte-identical
to every prior release.

### Added
- **`align: number` on `burst()` and `spray()`** -- a `0..1` velocity-align blend. `0` = pure random spin,
  `1` = fully broadside to the live velocity, partial blends along the shortest arc. A render property of
  any moving piece, so **both** `burst()` and `spray()` honor it (unlike burst-only `stagger`).

### Semantics
- **Opt-in, zero-cost by default.** With `align` off (or `<= 0` / non-finite), the render emits the raw
  `spin` argument exactly as before -- byte-identical rotation *and* position to every prior release.
- **Pure orientation overlay.** `align` changes only the `ctx.rotate` argument, never `ctx.translate`, so
  an aligned burst reproduces the same-seed plain burst's *position* hash exactly; only the rotation
  sequence changes (its own committed hash). The orientation analog of what `lifeColors` did for color.
- **Live velocity, broadside.** The heading is recomputed from the current `(vx, vy)` each frame (the
  piece re-orients as forces curve its path) and offset by `PI/2` so the flat face meets the airflow.
  Draws **no rng** (rotation derives from the deterministic velocity), so an aligned run replays identically.
- **Fail closed.** Coerced to `[0, 1]` via `clamp01` (non-finite / negative -> `0`, `> 1` -> `1`).
  `atan2` is total (`atan2(0, 0) === 0` for a settled piece), so the rotation is finite for any finite
  velocity. Inert under reduced motion (the static fan has no velocity to orient to).

### Internal
- One new per-particle pool column: `align` (Float32, blend `0..1`; 4 B/particle), assigned from config
  in `spawn()` like `flut` / `sway`.
- The render-rotation blend is guarded (`if (pool.align[i] > 0)`): one `Math.atan2` + a shortest-arc wrap
  + a lerp, paid ONLY for aligned pieces, on the render path. Zero allocation -- torture T6 measures a
  velocity-aligned live pool at ~0 B/frame.
- New test-harness probe `rotateHash` (the quantized rotate-argument fingerprint, kept out of the position
  hash like `strokeHash` / `colorHash`) plus a `lastRotate` direction accessor; the stale `_env.mjs`
  header comment claiming the hash folds rotate is corrected (it folds translate only).
- Unit suite 165 -> 173.

## [1.14.0] - 2026-08-06

Feature release: `stagger` -- **staggered emission**, the first feature on a new **emission-timing**
axis. v1.13 opened emission *geometry* (**where** a piece is born); this opens **when**. A burst has
always spawned its whole `count` at frame 0; an opt-in `stagger` (a duration in ms) spreads the births
evenly across that window, so a burst **cascades / ripples in** instead of appearing all at once --
`c.burst({ count: 120, stagger: 400 })`. It is the burst-only analog of a spray's `duration` (a spray
already emits over time). The mechanism is a **birth-delay gate**: all `count` pieces still spawn at
call time (so the rng sequence is *byte-identical* to a synchronous burst), each stamped with a
per-piece `delay` of `stagger * i / count` -- a function of the loop index only, drawing **no rng**. An
unborn piece is frozen and invisible (physics, life-countdown, trail, and render all skipped) until its
delay elapses, then it lives its **full life from birth**. Off (`stagger <= 0` / non-finite) leaves the
delay column `0`, the gate never fires, and the burst spawns synchronously -- byte-identical to every
prior release (`1569828004` and all prior physics/trail/color/emit hashes preserved). On earns its own
committed fingerprint (`3414676538`) purely from birth *timing* (the same per-piece draws, spread across
frames).

### Added
- **`stagger: number` on `burst()`** -- a staggered-emission window in ms. Spreads the `count` births
  evenly across it (piece `i` wakes at `stagger * i / count`). Burst-only; ignored by `spray()`.

### Semantics
- **Opt-in, zero-cost by default.** With `stagger` off (or `<= 0` / non-finite), every piece is born at
  `t0` and the birth gate never fires -- byte-identical to every prior release.
- **Byte-identical rng sequence.** All `count` pieces spawn at call time, drawing the identical rng
  sequence as a synchronous burst; only the per-index `delay` (no rng) differs, so a staggered burst has
  the *same* per-piece `(angle, speed, spin, ...)` -- only birth timing, and thus positions per frame,
  change. Hence its own committed hash, deterministic under a fixed seed + fixed dt.
- **Full life from birth.** An unborn piece does not age; its full lifetime begins when it is born, so a
  late piece outlives the early ones by the width of the window.
- **Burst-only.** `spray()` already emits over time, so it ignores `stagger` (the shared `delay` column
  is simply always `0` for spray pieces).
- **Fail closed.** `NaN` / negative / `Infinity` / non-numeric coerce to `0` (synchronous). The delay is
  a time offset of the finite spawn origin, so no non-finite draw position can result. Inert under
  reduced motion (the static fan has no per-piece animation).

### Internal
- One new per-particle pool column: `delay` (Float32, seconds until birth; 4 B/particle), reset to `0`
  in `spawn()` (fail-closed pool-reuse guard, like `landed`). `spawn()` now **returns its slot** so the
  caller can stamp the delay; the guarded write runs only when `stagger` is armed.
- The birth gate is one Float32 read + compare per alive piece per frame (mirrors the `life <= 0` /
  `!landed` guards); an unborn piece counts as alive so the loop stays registered through the window.
  Zero allocation -- torture T6 measures a staggered burst mid-emission at ~0 B/frame.
- New test-harness probe `translates` (pieces actually drawn per frame), kept out of the position hash,
  as the non-vacuous witness that stagger delays births.
- Unit suite 157 -> 165.

## [1.13.0] - 2026-08-06

Feature release: `emit` -- **spawn emitter shapes**, the first feature on a new **emission-geometry**
axis. Every chapter until now changed how a particle *moves* (forces), how it *ends* (settle), or how
it is *drawn* (trails, color-over-life); this changes **where it is born**. Instead of the single point
`(x, y)`, a burst can distribute its spawn **origin** over a shape: a horizontal `line` curtain (rain /
snow), a `ring` firework shell, or a `box` area -- each sized by the single `emitSize` scalar (line
half-length / ring radius / box square half-extent). The `ring` is the one geometry-to-velocity
coupling: pieces fly radially **outward** (`speed` = shell expansion rate, `spread` = angular fuzz);
`line` and `box` leave velocity governed by `angle`/`spread` and move only the origin. `emit` is the
first feature to add a **conditional spawn-time rng draw** (the position along the shape), so it is
opt-in *by construction*: off / unknown / `emitSize <= 0` inserts **no draw** and spawns at the point
-- byte-identical to a point burst, every committed position fingerprint preserved (`1569828004` and
all prior physics/trail/color hashes). Per-shape draw counts differ (box draws 2, line/ring 1), so each
shape earns its own committed fingerprint (`line 2558715937`, `ring 2441425203`, `box 2748626140`).

### Added
- **`emit: 'line' | 'ring' | 'box'` + `emitSize: number` on `burst()`/`spray()`** -- distribute the
  spawn origin over a shape, sized by `emitSize`. Default: a single point. Ring fires each piece
  radially outward; line/box move only the origin.

### Semantics
- **Opt-in, zero-cost by default.** With `emit` off (or unknown, or `emitSize <= 0`), the spawn loop
  takes a single int-compare then the identical point `spawn()` call -- no new rng draw, no new
  allocation -- so every prior committed fingerprint is byte-identical.
- **The conditional spawn-rng contract.** The emitter branch sits between the speed draw and `spawn()`.
  `EMIT_OFF` inserts nothing; `line`/`ring` draw 1 rng value (the position along the shape), `box`
  draws 2. Because the counts differ, each shape has its own committed hash; within a shape the draw
  count is fixed, so it replays identically under a fixed seed.
- **Ring = radial shell.** For `emit:'ring'` each piece's velocity points outward from the centre
  (`speed` = expansion, `spread` = angular fuzz), reusing the already-drawn spread jitter (no extra
  draw). `line` and `box` leave velocity to `angle`/`spread`.
- **Fail closed.** An unknown or non-string shape, or a non-positive / non-finite `emitSize`, collapses
  to `EMIT_OFF` (a point spawn). The origin is an offset of the finite burst centre, so no non-finite
  draw position can result.
- **No reduced-motion effect** -- the static accessible fan has no rng origin, so `emit` is inert there.
- **Hot path untouched** -- `emit` only moves the spawn origin; `update()` and the render loop are
  unchanged.

### Internal
- Module consts `EMIT_OFF/LINE/RING/BOX` + an `EMIT_ID` string->int `Map`, resolved once per
  `burst()`/`spray()` (`emitId`/`emitR` locals), so the spawn loop branches on an int, never a string.
- `spawn()`'s signature is unchanged -- the emitter computes the origin `(ex, ey)` and (ring) velocity
  in the caller and passes them in place of `cx, cy, cos(a)*s, sin(a)*s`.
- No test-harness change: `emit` moves the spawn origin, and the mock canvas already folds `translate`
  into the position `hash`, so the existing fingerprint observes the emitter directly (unlike
  trails/lifeColors, which needed the `strokeHash`/`colorHash` probes).

## [1.12.0] - 2026-08-05

Feature release: `lifeColors` -- **color-over-life**, the second **render** feature (after trails).
Until now a piece was painted one flat color from birth to death; now its **body** sweeps a multi-stop
OKLCH ramp as it ages -- sparks cooling white -> orange -> red, embers dimming, a firework tail
shifting hue. The ramp is baked **once per burst** into a small LUT of CSS strings (lite-color's
`bakeCssGradient`) and indexed by the piece's own life fraction, so the hot path is a pure array read:
no per-frame color math, no allocation. It draws **zero rng** and touches **no** position, velocity, or
rotation, so it is a **pure color overlay** -- every committed *position* fingerprint is byte-identical,
including a `lifeColors` burst's own (`1569828004` and all prior physics/trail hashes are preserved).
The palette `colors` is still picked per particle and stays the flat **trail** color (and the body color
when off). The new gate is the body's `fillStyle` sequence (`colorHash 2406267552`).

### Added
- **`lifeColors: Array<OklchColor | string>` on `burst()`/`spray()`** -- an ordered multi-stop OKLCH
  life ramp (>= 2 stops, birth-color first). The body of each piece sweeps it over the piece's life;
  the trail stays the flat `colors` pick. Default off. Invalid / fewer than two stops falls back to the
  flat color.

### Semantics
- **Opt-in, zero-cost by default.** With `lifeColors` off (or invalid), each piece paints the flat
  pre-parsed `colors[i]` exactly as before -- the render branch is a single `ramp ? ... : colors[i]`
  guard, and color never enters the position fingerprint, so every prior committed hash is byte-identical.
- **Pure color overlay.** `lifeColors` adds no rng draw and moves no position, so a `lifeColors` burst
  reproduces the same-seed plain burst's position hash exactly. The only thing it changes is `fillStyle`.
- **Ramp indexed by life.** `step = clamp(floor((1 - life/maxL) * (RAMP_N-1)))` -- birth = first stop,
  death = last stop. All pieces share one baked ramp; variety comes from their different life phases.
- **Trail stays flat.** The ribbon keeps drawing the flat `colors[i]`; only the body sweeps the ramp
  (the per-segment trail taper tried in v1.9.0 was reverted in v1.10.0 -- the trail is a flat overlay).
- **Deterministic when on.** The ramp is a pure function of life, so a `lifeColors` burst replays
  identically under a fixed seed, with its own committed color fingerprint.
- **Fail closed.** A non-array, fewer than two stops, or any non-finite / unparseable stop makes
  `buildLifeRamp` return `null` (`parseOklch` throws on a bad string -- caught) and the body paints the
  flat color. A ramp is a color, not a position, so no non-finite draw position can result.
- **No reduced-motion effect** -- the static render does no life integration, so it paints the flat color.

### Internal
- One per-particle `colorRamp` `Array` column (holds the burst's baked LUT ref, or null); `spawn()`
  always (re)assigns it, so a recycled slot can never inherit a prior burst's ramp. `colors[i]` is still
  picked per particle (one `rng.pick`, unchanged), preserving the spawn rng sequence.
- `buildLifeRamp()` bakes the ramp once per `burst()`/`spray()` via lite-color's `bakeCssGradient` +
  `parseOklch` (off the hot path, like the existing `parsedColors` pre-parse); the render loop indexes
  the LUT by life fraction (`RAMP_N = 32` steps).
- Test harness: the mock canvas gains a `colorHash` probe (folds `fillStyle` at each `fill`/`fillRect`/
  `fillText`), kept entirely out of the position `hash` (like `strokeHash`/`sumX`) -- it makes the pure
  color overlay testable without perturbing any committed position fingerprint.

## [1.11.0] - 2026-08-04

Feature release: `settle` -- **settle-and-pile**, the first **behaviour (lifecycle)** feature.
Every chapter until now changed how a particle *moves* (forces) or *draws* (trails); this one
changes how it *ends*. A piece bounces on the `floor` (losing energy to `bounce` < 1 and `drag`)
until the rebound is too weak to lift it -- its post-bounce vertical speed drops below the `settle`
rest threshold -- then it **freezes in place** and piles up, instead of bouncing forever. A settled
piece keeps aging and fades where it rests, so its slot still recycles: the pile is a *transient
drift* that builds and melts, and the fixed zero-GC pool never saturates. The rest test draws
**zero rng** (a pure function of the piece's own post-bounce velocity), so default `0` is
byte-identical -- every prior committed fingerprint is preserved (default `1569828004`, mixed, wind,
floored `2679696825`, box `804161759`, turbulence `1630588936`, gust `4074438162`, vortex
`1387388835`/`2926753007`/`2039789049`, and the v1.9.0 trail geometry) -- and a settling burst is
reproducible for free with its own committed fingerprint.

### Added
- **`settle: number` on `burst()`/`spray()`** -- rest-speed threshold in CSS px/sec. A piece whose
  post-bounce vertical speed drops below it freezes on the `floor` and piles up (it keeps aging +
  fading, so the slot recycles). Default `0` (off). Needs a finite `floor`; with no floor nothing
  ever settles.

### Semantics
- **Opt-in, zero-cost by default.** Settle is guarded on `settle !== 0` inside the (already opt-in)
  floor block, and the physics loop is wrapped in `if (!landed)` -- with settle off, no piece is
  ever `landed`, so the wrap always runs and every prior committed fingerprint (physics + the trail
  geometry) is byte-identical.
- **Bounce, then rest.** A piece keeps bouncing (energy lost to `bounce` < 1 and `drag`) until the
  reflected `|vy|` falls below `settle`, then it freezes: velocity zeroed, pinned on the floor,
  physics skipped (position *and* rotation frozen -- a pile lies still, unmoved by wind/gust/sway).
  With `bounce = 0` a piece rests on first contact; a higher `bounce` just delays the rest (`drag`
  still bleeds energy each frame), and with no `floor` nothing settles.
- **Keeps aging, transient pile.** A settled piece still counts down its life and fades in place,
  then the slot recycles -- so a fixed pool never saturates and new bursts always spawn.
- **Deterministic when on.** The rest test draws no rng (post-bounce velocity only), so a settling
  burst replays identically under a fixed seed, with its own committed fingerprint.
- **Fail closed.** A non-finite/negative/garbage threshold coerces via `nonneg()` to `0` (off). A
  settled piece rests at a finite floor Y, so no non-finite draw position can result.
- **No reduced-motion effect** -- the static render never integrates, so nothing ever lands.

### Internal
- Two per-particle columns: `settle` (Float32, the threshold) and `landed` (Uint8, the frozen flag);
  `spawn()` sets `settle` and resets `landed = 0` (a recycled slot can never inherit a dead piece's
  frozen state).
- The `update()` physics span (gravity through the wall clamps) is wrapped in `if (!landed)`; the
  rest test is appended inside the floor block; a landed piece still ages, records its trail, fades,
  and draws (all outside the wrap). Torture T6 gains a fully-settled (frozen) pile lane -- a
  saturated pile integrates at the same ~0 B/frame as an active pool.

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
