# 0007 -- floor / bounce (settle boundary)

- **Status:** accepted (implemented in v1.6.0)
- **Date:** 2026-08-01
- **Session:** F5, the feature release after F4 (v1.5.0 wind). v1.5.0 completed the *force*
  model; this opens a new axis rather than paying debt: adding the first *boundary* to the
  physics.

## Context

After v1.5.0 the force model is complete -- `gravity` (down) + `wind` (across) form a 2D
force vector -- but there is still no boundary anywhere: every particle falls **forever**.
There is no way to make confetti pile up at the bottom of the canvas, settle on a line, or
bounce off it. The physics can push a particle but cannot stop one.

`floor` adds the missing **Y-axis collision**: an opt-in settle boundary that a falling
particle lands on instead of dropping past. `bounce` is its restitution. This is a
position-space *event* (a velocity reflection during integration), not another force -- a
genuinely new kind of knob -- but it is the tightest possible fit to the proven
fingerprint-safe-knob discipline the package already uses for `wind`, `sway`, and `shapes`.

## Decisions

1. **Two knobs: `floor` (absolute Y in CSS px, WHERE the boundary is) + `bounce`
   (restitution 0..1, HOW much vy is retained on contact).** They are independent scalars,
   exactly like `gravity`/`wind`/`drag`. `floor` defaults to `Infinity` (no boundary,
   pre-1.6.0 behaviour); `bounce` defaults to `0` (dead-stop settle / pile-up). `bounce`
   only has any effect when `floor` is finite. An absolute Y (not a 0..1 fraction, not an
   inset) was chosen so a caller composes it directly with their own layout math
   (`floor: innerHeight - 20`) and it needs no canvas-size lookup inside the hot loop.

2. **Opt-in via an `Infinity` guard -- structurally hash-neutral.** In `update()`,
   immediately after the `pool.y[i] += vy*dt` integration:
   ```
   if (pool.y[i] > pool.floor[i]) {          // floor == Infinity by default => never fires
       pool.y[i] = pool.floor[i];            // clamp onto the boundary
       pool.vy[i] = -pool.vy[i] * pool.bounce[i];  // reflect, scaled by restitution
   }
   ```
   `y > Infinity` is always false, so a floor-less burst executes the identical instruction
   stream as pre-1.6.0 and the committed default fingerprint `1569828004` is byte-for-byte
   unchanged -- the same structural-guard trick as `wind` (`!= 0`) and `sway`. Placed AFTER
   the y-integration (so it reflects the frame's actual landing position) and BEFORE
   spin/sway. Using `Infinity` as the "off" sentinel -- rather than a separate boolean
   `enableFloor` -- keeps it a single scalar and makes the guard a plain comparison.

3. **Damped, bounded, no runaway.** `bounce` is `clamp01` (0..1), so a rebound can never
   *add* energy; drag still multiplies `vy` every frame, so even `bounce == 1` loses energy
   and eventually rests. A resting particle sits exactly on the floor: gravity re-adds a
   sub-pixel `vy` each frame, immediately clamped -- the jitter is `grav*dt^2*bounce` << 1px,
   so it rounds to the floor and is invisible in the integer-pixel fingerprint. Particles
   still die on the life countdown, so a floor never makes one immortal. `Infinity` lives in
   a Float32Array natively and the guard only ever *compares* it (never arithmetic), so no
   NaN can arise from the "off" state.

4. **Two per-particle columns (`floor`, `bounce`), mirroring `grav`/`wind`.** Required, not
   optional: a floored burst and a floor-less burst coexist in one pool over time, so each
   must carry its own boundary -- exactly why the force columns are per-particle. Cost is 8
   bytes/particle, matching the existing force columns; there is no way to fold either into
   an existing column without breaking mixed-burst correctness.

5. **Coerce `floor` with `num(.., Infinity)`, `bounce` with `clamp01(.., 0)`.** `floor` is a
   signed absolute coordinate, and `num(v, Infinity)` returns `Infinity` for
   `undefined`/`null`/`NaN`/`Infinity`/a string typo -- i.e. every non-finite input fails
   closed to "no floor", while a finite Y passes through. `bounce` is a bounded amplitude, so
   `clamp01` (negative -> 0, >1 -> 1). One-shot coercion per call, never on the hot loop --
   the coerce-don't-throw stance of 0004 s1: a call-time typo must not crash a running
   animation. (Note: `floor: -Infinity` also fails closed to `Infinity`, so a negative
   infinity can never clamp the whole pool to the top -- verified in T1.)

6. **No effect under reduced motion -- intentionally, like `wind`.** `renderStaticBurst`
   does no integration and has no velocity, so a collision boundary has nothing to act on.
   `floor` is a *dynamics* event (a velocity reflection during integration), NOT rendered
   geometry -- so, unlike `shapes` (geometry, which the static path DID have to honour,
   0005 d5), it needs no static-path change and is simply inert there, exactly like
   `wind`/`sway`/`flutter`/`drag`/`gravity` (none of which touch the static scatter).

7. **This is a minor (1.5.0 -> 1.6.0).** `floor?`/`bounce?` are new *public* options
   (`Confetti.d.ts`), so semver minor -- matching the `wind`, `flutter`/`sway`,
   `registerShape`, and `shapes` feature precedents. Existing presets are left unchanged
   (conservative; the feature is opt-in and the demo showcases it rather than altering a
   shipped look).

## Why floor is hash-neutral by default AND deterministic when on

Two separate properties, both required (the same shape as wind, 0006):

- **Default preserved.** The `Infinity` guard (decision 2) means a `floor`-absent burst
  executes the identical instruction stream as pre-1.6.0. The committed default fingerprint
  `1569828004` is byte-for-byte unchanged -- verified by the unit gate running
  omit/`Infinity`/`NaN`/`null`/string, AND an unreachable finite floor (500, above the
  196-px fall extent), all against that constant.
- **Floored burst deterministic.** Like wind -- and unlike the `shapes` mix (0005) -- the
  collision draws **no** rng; it is pure physics. So a floored burst does not shift the rng
  stream at all; it merely clamps/reflects positions that were already determined by the
  seed. It therefore replays identically under a fixed seed, with its own committed
  fingerprint `2679696825` (asserted `!==` the default hash, since a reachable floor must
  move positions), and no length-1-collapse subtlety (contrast 0005's per-particle draw).

## How the tests prove it -- measuring CONTAINMENT, not just determinism

A position fingerprint proves the floored stream is deterministic but says nothing about
whether the boundary actually *held* (any clamp changes the hash equally). So, as the analog
of 0006's `sumX` drift-direction probe (itself the analog of 0005's "count dispatches, not
positions"), this chapter measures **containment**: the mock ctx (`test/_env.mjs`) gains a
`maxY` accumulator -- the largest integer draw-Y -- kept entirely out of the `hash` mix (so
every committed fingerprint is byte-identical whether or not it is read). A test then asserts
`maxY(floored) <= floor` (the boundary held) AND `maxY(un-floored) > floor` for the same seed
(the floor actually did something -- the test is not vacuous): the invariant a bare hash
cannot give.

- **Unit** (`floor / bounce (settle boundary)` describe): omit/`Infinity`/`NaN`/`null`/string
  and an unreachable finite floor all reproduce `1569828004` (opt-in + fail-closed in one); a
  canonical `floor: 120, bounce: 0` burst reproduces `2679696825` and is `!==` the default;
  the `maxY` containment invariant (floored and bounced both `<= floor`, un-floored `>`);
  restitution shifts the fingerprint (`bounce: 0` `!==` `bounce: 0.7`); out-of-range bounce
  clamps (`-5` == `0`, `9` == `1`); positions stay finite under an elastic bounce + strong
  gravity (assertFinite); spray contains its particles at the floor; reduced-motion is
  floor-inert (same static hash with and without a floor).
- **Torture T5**: finite/`Infinity` `floor` + `bounce` are threaded into the differential
  fuzz op-stream (burst and spray), so two same-seed instances running the identical corpus
  stay bit-identical frame for frame across 3000 ops.
- **Torture T6 lane 5**: the full multi-shape pool now also carries a reachable `floor: 150`
  + `bounce: 0.4`, so the guarded collision fires for every resting particle every frame; it
  still integrates at ~0 B/frame (the guard/clamp de-opts nothing).
- **Torture T1**: `floor: NaN`, `floor: -Infinity` (with `bounce: 2`), and `bounce: Infinity`
  join the poison barrage under the finite-position detector -- coercion to `Infinity`/`0..1`
  holds, no NaN reaches a drawn position.

## Explicitly NOT done

- Walls / a left-right or top boundary, or a full bounding box -- this chapter is the single
  Y-axis floor (the confetti-piles-up case). A box would multiply the guard/branch cost and
  is a separate chapter if ever.
- Per-particle floor-height variation, floor friction (horizontal damping on contact), or
  stacking / inter-particle collision -- floor is burst-wide, frictionless, and does not see
  other particles (an O(n^2) cost the zero-alloc hot loop will not take).
- A settle-and-freeze optimisation (removing rested particles from the integration) -- resting
  particles keep integrating at ~0 B/frame and still expire on the life countdown, so the
  complexity buys nothing.
- No change to the default fall-forever path, existing presets, the default look, or the
  committed default fingerprint `1569828004`.

## References

- `Confetti.js` (`floor`/`bounce` pool columns; `pool.floor[i]`/`pool.bounce[i]` in `spawn`;
  the guarded `if (y > floor) { y = floor; vy = -vy * bounce; }` in `update`;
  `floor = num(floor, Infinity)` + `bounce = clamp01(bounce, 0)` + config in `burst`/`spray`).
- `Confetti.d.ts` (`floor?`/`bounce?` on `BurstOptions`; `SprayOptions`/`Preset` inherit).
- `test/_env.mjs` (hash-neutral `maxY` accessor); `test/Confetti.test.mjs`
  (`floor / bounce (settle boundary)` describe; `FLOOR_HASH = 2679696825`, `FLOOR_Y = 120`);
  `test/torture/{t5-fuzz,t6-alloc,t1-degenerate}.mjs`.
- `decisions/0006` (wind, the guarded-velocity-term precedent and the "windy burst draws no
  rng" determinism story this reuses), `0005` (the "measure the thing the hash can't see"
  test technique, here generalised from drift-direction to containment), `0004` s1 (the
  coerce/drop-not-throw stance), `0003` (sway, the original guarded-position-knob).
