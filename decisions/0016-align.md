# 0016 -- velocity-aligned orientation (`align`, the first RENDER-ORIENTATION feature)

- **Status:** accepted (implemented in v1.15.0)
- **Date:** 2026-08-06
- **Session:** F14, the release after F13 (v1.14.0 stagger). Where 0005-0009 extended the PHYSICS,
  0010/0013 built the color/trail RENDER path, 0011 added a DIRECTED force (vortex), 0012 added the first
  BEHAVIOUR feature (settle), 0014 opened emission GEOMETRY (where a piece is born) and 0015 emission
  TIMING (when), this opens the last untouched render axis: ORIENTATION -- WHICH WAY a piece faces.

## Context

For fourteen releases a confetti piece's rotation has only ever been RANDOM tumble: a per-particle `spin`
(a seeded angular velocity advanced each frame) plus a `tilt`/`flutter` X-scale wobble. Nothing ever tied
rotation to MOTION. Real windblown paper and leaves bank into their flight -- they turn to face the way
the air pushes them. This chapter adds **`align`**: an opt-in `0..1` blend that rotates each piece
BROADSIDE to its own velocity (its flat face square to the airflow), from pure random tumble (0) to fully
velocity-locked (1).

The engineering question is, once again, the determinism contract -- but with a twist unique to this
axis. Rotation is a RENDER property, not a physics one; the risk is not a runaway force but proving the
new orientation does not perturb the seeded POSITION stream every prior fingerprint pins.

## Decisions

1. **Live velocity heading, chosen over a launch-heading frozen at spawn.** Confirmed via
   AskUserQuestion. The heading is recomputed from the CURRENT `(vx, vy)` every frame in the render loop,
   so an aligned piece continuously re-banks as gravity / wind / vortex bend its trajectory (a leaf
   riding the air). The alternative -- capturing the spawn velocity's angle ONCE into a per-particle
   column (zero per-frame trig) -- is cheaper but cannot respond to mid-flight curving, so a piece thrown
   left keeps pointing left even as it falls. The whole appeal is banking into the LIVE flight, so the
   per-frame `Math.atan2` is worth it; it is paid ONLY for the aligned subset (the off/default path runs
   no trig).

2. **Broadside (face to travel), chosen over edge-on (along travel).** Confirmed via AskUserQuestion.
   `rotate(heading + HALF_PI)` sits the piece's long axis PERPENDICULAR to velocity, so its flat face
   meets the direction of motion -- a leaf/petal presenting its broad side, fluttering face-first. The
   alternative `rotate(heading)` (long axis parallel to travel, a card knifing forward point-first) was
   rejected as the less confetti-like read.

3. **A 0..1 shortest-arc blend.** `align` lerps the render rotation from the random `spin` toward the
   broadside heading along the SHORT way around the circle (`d -= TAU * floor((d + PI) / TAU)` wraps the
   delta into `[-PI, PI)` before the lerp), so a `spin` near a full turn never unwinds the long way.
   `align == 0` is exactly the current `spin`; `align == 1` is exactly the heading; partial is a smooth
   mix. The blend draws NO rng.

4. **The byte-identical-POSITION-stream crux -- the load-bearing property.** `align` changes ONLY the
   argument to `ctx.rotate`; it never moves `ctx.translate`. The position fingerprint folds ONLY
   `translate(x, y)` (rotation and scale are no-op sinks in the test canvas -- which is exactly why
   `flutter`, an X-scale wobble, has always been hash-neutral at any value). So an aligned burst draws
   the IDENTICAL translate sequence as a same-seed plain burst; ONLY the rotation differs. Therefore:
   - **OFF** (`align == 0`) -> the `if (pool.align[i] > 0)` guard is false -> `ctx.rotate(pool.spin[i])`
     exactly as today -> the rotate ARGUMENT sequence AND the position hash are byte-identical.
     COMMITTED_HASH (1569828004) and every prior physics/trail/color/emit/stagger fingerprint preserved.
   - **ON** -> the POSITION hash is STILL identical to the same-seed off burst (a pure orientation
     overlay, the analog of `lifeColors`' colorHash on the color axis), but the rotation sequence changes
     -> a NEW committed fingerprint on a SEPARATE probe (ALIGN_HASH 1909618495), deterministic under a
     fixed seed + fixed dt.
   - **A new probe WAS needed.** Rotation is invisible to the position hash, so a bare fingerprint cannot
     see it. The mock canvas's `rotate()` (a no-op until now) gained a `rotateHash` that folds the
     QUANTIZED angle (kept out of the position hash, like `strokeHash` / `colorHash` / `translates`), plus
     a `lastRotate` accessor -- a hash-neutral DIRECTION witness (the `sumX` analog) so a test can assert
     the rotation TRACKS the velocity heading, not merely "some different number". The stale `_env.mjs`
     header comment claiming the hash folds "translate AND rotate" was corrected (it folds translate only).

5. **The `align` column + the guarded render blend.** One per-particle Float32 column `align` (blend
   `0..1`), assigned from config in `spawn()` alongside `flut` / `sway` (always reassigned, so a recycled
   slot never inherits a prior burst's blend -- no separate reset needed). The blend sits in the render
   loop, replacing `ctx.rotate(pool.spin[i])` with a guarded computation: off emits the raw `spin`; armed
   computes `heading = atan2(vy, vx) + HALF_PI`, wraps the delta, and lerps by `align`.

6. **Fail closed.** `clamp01(align, 0)` maps non-finite / negative -> `0` (off) and caps `> 1` at `1`.
   `Math.atan2` is total (`atan2(0, 0) === 0` for a settled `landed` piece, whose `vx == vy == 0`), so
   `rot` is finite for any finite velocity and any `align` in `[0, 1]` -- no non-finite draw can result.

7. **Both burst AND spray.** Unlike `stagger` (burst-only, because a spray already emits over time),
   `align` is a render property of ANY moving piece, so both `burst()` and `spray()` carry it. The shared
   column is simply `0` for a plain (unaligned) piece, so the guard is inert for it.

8. **No reduced-motion effect.** The static accessible fan (`renderStaticBurst`) has no velocity to
   orient to, so `align` is inert there -- consistent with every motion feature. A one-line comment
   documents the deliberate inertness; the pieces keep their random static rotation.

9. **Hot path untouched by default.** The blend is one guarded branch per alive piece per frame on the
   RENDER path; when off it is a single Float32 read + compare, when on one `atan2` + a wrap + a lerp
   (stack arithmetic, zero allocation). The physics integrator is not touched at all.

## Consequences / proof

- Unit suite 165 -> 173. New `describe('align / velocity-aligned orientation')` asserts: OPT-IN /
  fail-closed (off / 0 / negative / NaN / Infinity / non-numeric all reproduce COMMITTED_HASH AND the
  plain-run rotateHash -- the raw spin is emitted); prior gates still hold with align off (FLOOR_HASH,
  BOX_HASH); the PURE-OVERLAY headline (align:1 leaves the position hash identical, changes only
  rotateHash); a committed ALIGN_HASH, distinct + deterministic, with a partial `align:0.5` distinct from
  both 0 and 1; NON-VACUOUS DIRECTION (a rightward-blown piece stands broadside ~`HALF_PI` via the
  `lastRotate` probe, while align:0 keeps the spin-driven value); `assertFinite` under align + gravity +
  wind + bounce in a box; spray HONORS align (rotateHash differs while positions hold); reduced-motion
  inert.
- Torture: T5 threads a random `align` (half off) through the burst AND spray differential fuzz and adds
  `rotateHash` to the same-seed equality check (two instances stay bit-identical -- the alignment is
  deterministic, zero rng). T6 adds a velocity-aligned live-pool lane (wind + gravity keep the heading
  non-trivial, so the atan2 + wrap + lerp run for ~MAXP pieces/frame) -- still ~0 B/frame. T1 adds align
  poison (NaN / negative / huge / Infinity / non-numeric, plus a valid align in a bouncing box) under the
  finite-position detector -- all coerce to `[0, 1]`, nothing crashes, no NaN reaches a draw.
- Full gate matrix green: 173 unit; torture ok / BREAK exit 1 / CONTROL=alloc exit 1 / SEED ok; ASCII
  clean; npm pack 1.15.0.
- Cost: one Float32 pool column (4 B/particle); one guarded branch per alive piece per frame (one atan2 +
  a wrap + a lerp when armed, a read + compare when off). No physics change.

## Explicitly NOT done (flagged for a future chapter, if ever)

- **Launch-heading-frozen mode** -- rejected in decision 1; the heading is LIVE (re-banks with forces),
  not captured once at spawn.
- **Edge-on / along-travel orientation** -- rejected in decision 2; the piece sits BROADSIDE to travel.
- **Wobble / flutter suppression under align** -- `align` touches ONLY the rotation angle; the `flutter`
  X-scale wobble runs independently (the two stay orthogonal, each hash-neutral on its own transform).
- **Orientation on the reduced-motion static path** -- the static fan has no velocity; orientation is a
  motion-time concern.
- **A separate spin-RATE knob** (exposing / scaling the seeded `spinV`) -- this chapter aligns rotation to
  velocity, it does not retune the random tumble.
- Any change to the default look, existing presets, the physics integrator, the trail / color / emit /
  stagger overlays, or any committed position / trail / color / emit fingerprint when align is off.
