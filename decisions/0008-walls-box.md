# 0008 -- walls / ceiling (bounding box)

- **Status:** accepted (implemented in v1.7.0)
- **Date:** 2026-08-02
- **Session:** F6, the feature release after F5 (v1.6.0 floor). v1.6.0 added the first
  boundary -- a single Y-max collision line; this completes it into a full axis-aligned box.

## Context

v1.6.0's `floor` added the first boundary anywhere in the physics: a Y-max line a falling
particle lands on. But it is a single edge -- a particle can still drift sideways forever or
launch up out of any container. There is no way to keep confetti *inside* a region.

`wallLeft` (X-min), `wallRight` (X-max), and `ceiling` (Y-min, the mirror of `floor`) add the
three remaining edges of an axis-aligned bounding box. Each is a position-space collision
event -- the exact kind of knob `floor` already is -- so this chapter is `floor` mirrored onto
the other three edges, reusing every property that made `floor` safe.

## Decisions

1. **Three new edge knobs, absolute CSS-px coordinates, mirroring `floor`.** `wallLeft`
   (default `-Infinity`), `wallRight` (default `+Infinity`), `ceiling` (default `-Infinity`).
   Each defaults to the guard-neutral infinity, so the edge is OFF by default (pre-1.7.0
   behaviour). Absolute coordinates (not fractions / insets), exactly like `floor` (0007 d1),
   so a caller composes them with their own layout math and no canvas-size lookup enters the
   hot loop.

2. **Restitution reuses `bounce` for all four edges.** `bounce` already means "restitution on
   boundary contact (0..1)"; it now applies to floor, walls, and ceiling alike -- a
   single-material box. A separate `wallBounce` was considered and rejected: asymmetric edge
   bounciness is rarely wanted and costs a public knob plus a per-particle column. One knob,
   one meaning.

3. **Opt-in via `Infinity` guards -- structurally hash-neutral, per edge.** In `update()`:
   - **Ceiling** (a Y-boundary) is a new guarded block immediately AFTER the existing `floor`
     block; the floor block itself is left byte-identical (not an `else`):
     ```
     if (pool.y[i] < pool.ceil[i]) {          // ceil == -Infinity default => never fires
         pool.y[i] = pool.ceil[i];
         pool.vy[i] = -pool.vy[i] * pool.bounce[i];
     }
     ```
   - **Walls** (X-boundaries) go AFTER the `sway` block (decision 4), as an if/else-if:
     ```
     if (pool.x[i] < pool.wallL[i]) {          // wallL == -Infinity default => never fires
         pool.x[i] = pool.wallL[i];
         pool.vx[i] = -pool.vx[i] * pool.bounce[i];
     } else if (pool.x[i] > pool.wallR[i]) {   // wallR == +Infinity default => never fires
         pool.x[i] = pool.wallR[i];
         pool.vx[i] = -pool.vx[i] * pool.bounce[i];
     }
     ```
   `y < -Infinity`, `x < -Infinity`, `x > +Infinity` are all always false, so a box-less burst
   executes the identical instruction stream as pre-1.7.0 -- the same structural-guard trick as
   `floor` (`> Infinity`), `wind` (`!= 0`), and `sway`. The committed default fingerprint
   `1569828004` AND the v1.6.0 floored fingerprint `2679696825` are both byte-for-byte
   unchanged (the new ceiling/wall guards never fire with `floor` alone -- verified in the unit
   gate against both constants).

4. **The wall clamp runs AFTER the sway block, not next to the floor.** `x` is mutated by BOTH
   the vx-integration AND the `sway` term (`x += sin(tilt)*sway*..`), so the wall clamp must be
   the frame's LAST x-write or a swaying particle could poke past a wall each frame. The
   ceiling, a Y-boundary, has no such issue (sway does not touch y), so it sits next to the
   floor. This asymmetry is deliberate and is why the two blocks are placed apart.

5. **Damped, bounded, no runaway, NO escape.** Every reflection is scaled by `clamp01(bounce)`,
   so no edge can ADD energy; `drag` still damps vx/vy every frame, so even `bounce == 1`
   settles; particles still die on the life countdown. Float32 stores the infinities natively
   and the guards only ever COMPARE them (never arithmetic), so no NaN can arise from an "off"
   edge. A degenerate inverted box (`ceiling > floor`, `wallLeft > wallRight`) simply clamps to
   whichever edge the guard hits -- deterministic and finite, never a NaN or a crash (asserted
   under T1 + a `record`+`assertFinite` no-escape unit case with `bounce: 1` + strong wind +
   gravity in a tight box).

6. **Three per-particle columns (`wallL`, `wallR`, `ceil`), mirroring `floor`.** Required, not
   optional: a boxed burst and a box-less burst coexist in one pool over time, so each particle
   carries its own edges -- exactly why `floor`/`grav`/`wind` are per-particle. Cost is 12
   bytes/particle (4 each), matching the existing boundary/force columns; there is no way to
   fold either without breaking mixed-burst correctness.

7. **Coerce each edge with `num(.., +/-Infinity)` (fail closed).**
   `wallLeft = num(wallLeft, -Infinity)`, `wallRight = num(wallRight, Infinity)`,
   `ceiling = num(ceiling, -Infinity)`. `num` returns the default for every non-finite input,
   so garbage fails closed to "no edge" while a finite coordinate passes -- the
   coerce-don't-throw stance of 0004 s1, one-shot per call, never on the hot loop. Note the
   sign: `num(Infinity, -Infinity)` is `-Infinity` and `num(-Infinity, Infinity)` is
   `+Infinity`, so passing the wrong-signed infinity turns the edge OFF, never ON in the wrong
   direction (verified in T1 and the unit fail-closed case).

8. **No effect under reduced motion -- intentionally, like `floor`/`wind`.**
   `renderStaticBurst` does no integration and has no velocity, so a collision boundary has
   nothing to act on. The box edges are *dynamics* events (velocity reflections during
   integration), not rendered geometry, so -- unlike `shapes` (0005 d5) -- no static-path change
   is needed and they are simply inert there.

9. **Minor bump 1.6.0 -> 1.7.0.** `wallLeft?`/`wallRight?`/`ceiling?` are new *public* options
   (`Confetti.d.ts`), so semver minor -- matching every prior feature. Existing presets
   unchanged (conservative; opt-in, the demo showcases it rather than altering a shipped look).

## Why the box is hash-neutral by default AND deterministic when on

The same two-property shape as `floor` (0007) and `wind` (0006), now for three edges at once:

- **Both defaults preserved.** Each guard (decision 3) means a box-absent burst executes the
  identical instruction stream as pre-1.7.0. Because the ceiling/wall guards also never fire
  when only `floor` is set, BOTH committed fingerprints survive: the default `1569828004` AND
  the v1.6.0 floored `2679696825`. The unit gate runs omit / each sentinel / NaN / null /
  string / wrong-signed-infinity per edge, plus a fully-enclosing (unreachable) box, all
  against `1569828004`, and re-asserts `2679696825` for a floor-only burst.
- **Boxed burst deterministic.** Like `floor` -- and unlike the `shapes` mix (0005) -- the
  collisions draw **no** rng; they are pure physics. A boxed burst does not shift the rng
  stream at all; it merely clamps/reflects positions already determined by the seed. It replays
  identically with its own committed fingerprint `804161759` (asserted `!==` both the default
  and the floored hash, since a reachable box must move positions).

## How the tests prove it -- measuring CONTAINMENT, not just determinism

A position fingerprint proves the boxed stream is deterministic but says nothing about whether
each edge actually *held*. So, generalising 0007's `maxY` floor-containment probe to the other
three edges, the mock ctx (`test/_env.mjs`) gains `minX`, `maxX`, `minY` accumulators (the
smallest/largest integer draw X and smallest draw Y), each kept OUT of the `hash` mix (so every
committed fingerprint is byte-identical whether or not they are read). The unit gate then
asserts, for the same seed, `minX >= wallLeft`, `maxX <= wallRight`, `minY >= ceiling`,
`maxY <= floor` (every edge held) AND that an un-boxed run breaches each (the box actually did
something -- the test is not vacuous). Because `floor` (just above the spawn Y) pins the pool
vertically before the upward launch can reach the ceiling, a *dedicated* ceiling case (no
floor) proves the ceiling edge fires on its own by catching the launch.

- **Unit** (`walls / ceiling (bounding box)` describe, 9 tests, suite 97 -> 106): opt-in +
  fail-closed per edge; an enclosing box is inert (`== 1569828004`); a canonical box reproduces
  `804161759` and is `!==` the default and the floored hash; the `minX`/`maxX`/`minY`/`maxY`
  containment invariant (boxed within every edge, un-boxed breaches each); the ceiling alone
  catches an upward launch; restitution shifts the fingerprint; a tight elastic box under strong
  wind + gravity stays finite AND contained (no NaN, no escape); spray honours the walls;
  reduced-motion is box-inert.
- **Torture T5**: finite/`Infinity` `wallLeft`/`wallRight`/`ceiling` are threaded into the
  differential fuzz op-stream (burst and spray), so two same-seed instances stay bit-identical
  frame for frame.
- **Torture T6 lane 5**: the full multi-shape pool now also carries a reachable full box
  (`wallLeft: 200, wallRight: 600, ceiling: 100, floor: 150, bounce: 0.4`) under wind, so every
  guarded collision fires for the resting/leaning pool every frame; it still integrates at
  ~0 B/frame (the guards/clamps de-opt nothing).
- **Torture T1**: `wallLeft: NaN`, `wallRight: -Infinity`, `ceiling: Infinity`, and an inverted
  box join the poison barrage under the finite-position detector -- coercion and clamping hold,
  no NaN reaches a drawn position.

## Explicitly NOT done

- Per-particle box variation, friction on contact (tangential damping), or inter-particle
  collision -- edges are burst-wide, frictionless, and blind to other particles (an O(n^2) cost
  the zero-alloc hot loop will not take).
- Arbitrary / rotated / polygonal bounds, or a circular container -- this chapter is the
  axis-aligned box (four scalar edges, four plain comparisons). Anything non-AABB is a separate
  chapter if ever.
- A settle-and-freeze optimisation (removing rested particles from integration) -- resting
  particles keep integrating at ~0 B/frame and still expire on the life countdown, so the
  complexity buys nothing (same as 0007).
- No change to the default fall-forever path, existing presets, the default look, the committed
  default fingerprint `1569828004`, or the v1.6.0 floored fingerprint `2679696825`.

## References

- `Confetti.js` (`wallL`/`wallR`/`ceil` pool columns; `pool.wallL[i]`/etc in `spawn`; the
  guarded `if (y < ceil)` block after the floor block and the `if (x < wallL) else if
  (x > wallR)` block after the sway block in `update`; `wallLeft = num(wallLeft, -Infinity)`
  etc + config in `burst`/`spray`).
- `Confetti.d.ts` (`wallLeft?`/`wallRight?`/`ceiling?` on `BurstOptions`; `SprayOptions`/`Preset`
  inherit).
- `test/_env.mjs` (hash-neutral `minX`/`maxX`/`minY` accessors); `test/Confetti.test.mjs`
  (`walls / ceiling (bounding box)` describe; `BOX_HASH = 804161759`, `BOX` canonical edges);
  `test/torture/{t5-fuzz,t6-alloc,t1-degenerate}.mjs`.
- `decisions/0007` (floor, the single-edge precedent this mirrors and the `maxY` containment
  technique this generalises), `0006` (wind, the guarded-term + "draws no rng" determinism
  story), `0004` s1 (the coerce/drop-not-throw stance), `0003` (sway, the guarded-position knob
  whose x-mutation dictates the after-sway wall placement).
