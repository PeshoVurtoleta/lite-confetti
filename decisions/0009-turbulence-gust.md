# 0009 -- turbulence + gust (living air)

- **Status:** accepted (implemented in v1.8.0)
- **Date:** 2026-08-02
- **Session:** F7, the feature release after F6 (v1.7.0 bounding box). Where 0005-0008 built out
  the SPATIAL force model (wind, floor, walls, ceiling), this adds the first TIME-VARYING forces.

## Context

By v1.7.0 the force model is spatially complete: `gravity` (down), `wind` (constant lateral),
`drag`, and a full reflecting bounding box (`floor` + walls + `ceiling` + `bounce`). But every
force is CONSTANT IN TIME -- `wind` blows at one fixed strength forever -- so a wide fall reads
like parallel rain, not confetti drifting on moving air. This chapter adds two time-varying
forces that complete the "weather" story:

- **`turbulence`** -- a per-particle ROTATING acceleration (organic wander): each particle
  curls on its own, so a burst fans out and mills instead of falling in lockstep.
- **`gust`** -- a GLOBAL, sinusoidally-oscillating horizontal acceleration layered on `wind`:
  the whole pool swells left, then right, in coherent waves (a breeze gusting).

Both are the exact same fingerprint-safe-knob discipline the last four chapters proved, with
one deliberate refinement chosen this session (see decision 2): a STATELESS field drawing ZERO
new rng, so the drift is a pure deterministic function of state the engine already advances.

## Decisions

1. **Two knobs, `turbulence` + `gust`, absolute px/sec^2 accelerations (like `wind`).** Both
   default `0` (off). Both are magnitudes in the same units as `gravity`/`wind`, so they compose
   into the existing 2D force reasoning and no new unit enters the vocabulary. Two distinct
   effects, chosen together (not one) because they are genuinely different: `turbulence` is
   per-particle and decorrelated (spreads the pool), `gust` is global and coherent (displaces
   the pool). Confirmed via AskUserQuestion.

2. **Stateless field, ZERO new rng -- reuse state the engine already advances.** Confirmed via
   AskUserQuestion over a per-particle-seeded-phase alternative. This is the crux of the chapter:
   - **`turbulence`** reuses the per-particle `tilt` and `spin` phases. Both are seeded once at
     spawn (`tilt = rng()*2pi`, `tiltV = 1+rng()*4`, `spin = rng()*2pi`, `spinV = (rng()-0.5)*10`)
     and integrated every frame (`tilt += tiltV*dt`, `spin += spinV*dt`) REGARDLESS of turbulence.
     So the curl direction `p = tilt*1.7 + spin` is a pure function of already-seeded state --
     no new rng draw, no new phase column. It drives BOTH axes to be a genuine curl and to stay
     decorrelated from `sway` (which is a position offset from `sin(tilt)` on x only):
     ```
     if (pool.turb[i] !== 0) {
         const tp = pool.tilt[i] * 1.7 + pool.spin[i];
         pool.vx[i] += Math.cos(tp) * pool.turb[i] * dtSec;
         pool.vy[i] += Math.sin(tp) * pool.turb[i] * dtSec;
     }
     ```
   - **`gust`** needs a GLOBAL phase, so it introduces one instance-level scalar `_elapsed`
     (sum of `dtSec`, advanced once per `update()` outside the particle loop). All particles
     share it, so gust reads as a coherent breeze, not per-particle noise; the amplitude is
     per-particle. `GUST_HZ = 2*pi/3` gives one swell-and-return every ~3s:
     ```
     if (pool.gust[i] !== 0) pool.vx[i] += Math.sin(_elapsed * GUST_HZ) * pool.gust[i] * dtSec;
     ```
   Neither draws rng at spawn or integration. This is the same "draws no rng; pure physics"
   property as `wind` (0006) / `floor` (0007) / box (0008), now for time-varying forces.

3. **Placed in the force-accumulation block, AFTER `wind`, BEFORE `drag`.** Both are
   accelerations, so they belong with `gravity`/`wind`: integrated into vx/vy, then damped by
   `drag`, then applied to position, then subject to the box clamps. This gives three
   properties for free: they damp toward a terminal velocity exactly like `wind` (never a
   runaway); a boxed burst stays CONTAINED (the floor/ceiling/wall clamps still run after
   position integration, on the perturbed velocities); and `turbulence`'s vy component simply
   feeds the same floor/ceiling machinery.

4. **Opt-in via `!== 0` guards -- structurally hash-neutral, per knob, preserving ALL THREE
   prior fingerprints.** `turb == 0` and `gust == 0` skip their blocks entirely, so a calm
   burst executes the identical instruction stream as v1.7.0. Because the guards also never
   fire in the floor-only or box paths, the default `1569828004`, the v1.6.0 floored
   `2679696825`, AND the v1.7.0 box `804161759` fingerprints are all byte-for-byte unchanged
   (the unit gate re-asserts every one). The `_elapsed += dtSec` accumulation runs
   unconditionally every frame, but `_elapsed` is READ ONLY inside the gust guard, so it can
   never perturb a gust-free stream -- keeping the accumulation unconditional is simpler than
   guarding it and provably cannot shift any fingerprint.

5. **Deterministic when on -- new committed fingerprints.** Because neither force draws rng
   (decision 2), a turbulent/gusty burst does not shift the rng stream at all; it merely
   perturbs velocities already fixed by the seed. It replays identically, earning its own
   committed fingerprints: `turbulence: 500` -> `1630588936`, `gust: 400` -> `4074438162`,
   both -> `15761758` (all asserted distinct from each other and from the default).

6. **Two per-particle amplitude columns (`turb`, `gust`), mirroring `wind`.** Required, not
   optional: a forced burst and a calm burst coexist in one pool over time, so each particle
   carries its own amplitude -- exactly why `wind`/`floor`/box are per-particle. Cost is 8
   bytes/particle (4 each). Note the asymmetry with the PHASE: turbulence needs NO phase column
   (it reuses tilt/spin), and gust needs NO per-particle phase (it shares `_elapsed`); only the
   amplitudes are per-particle.

7. **Coerce each with `num(.., 0)` (fail closed), negatives allowed.**
   `turbulence = num(turbulence, 0)`, `gust = num(gust, 0)`. A non-finite value coerces to `0`
   (off), so garbage fails closed -- the coerce-don't-throw stance of 0004 s1. Negatives are
   VALID (like `wind`): a negative `turbulence` flips the curl direction, a negative `gust`
   flips the swell phase; both stay finite and deterministic. So `num` (signed), not `nonneg`.

8. **`_elapsed` is never reset and may grow unbounded -- fine.** It is a pure function of frames
   elapsed, so it stays deterministic; a fresh instance (as every unit test uses) starts at 0.
   Over a long session `_elapsed` grows, but `Math.sin` of a large argument is still finite,
   bounded, and deterministic (float precision degrades slowly, and confetti bursts are
   short-lived), so a modulo is not worth the complexity. Not reset on `clear()` either -- a new
   burst's gust phase simply continues the same clock, which is what "the air kept moving" means.

9. **No effect under reduced motion -- intentionally, like every other force.**
   `renderStaticBurst` does no integration and has no velocity, so an acceleration has nothing
   to act on. These are DYNAMICS events, not rendered geometry, so -- unlike `shapes` (0005 d5)
   -- no static-path change is needed and they are simply inert there.

10. **Minor bump 1.7.0 -> 1.8.0.** `turbulence?`/`gust?` are new PUBLIC options
    (`Confetti.d.ts`), so semver minor -- matching every prior feature. Existing presets
    unchanged (conservative; opt-in, the demo showcases it rather than altering a shipped look).

## Why it is hash-neutral by default AND deterministic when on

The same two-property shape as `wind` (0006), `floor` (0007), and the box (0008):

- **All three defaults preserved.** The `!== 0` guards (decision 4) mean a calm burst executes
  the identical instruction stream as v1.7.0. Because the guards never fire in the floor-only or
  box paths either, the default `1569828004`, the floored `2679696825`, AND the box `804161759`
  fingerprints all survive (the unit gate omits / zeros / NaNs / nulls / strings each knob
  against the default, and re-asserts the floored and box hashes).
- **Forced burst deterministic.** Neither force draws rng (decision 2), so a forced burst does
  not shift the rng stream; it perturbs seed-fixed velocities. It replays identically with its
  own committed fingerprints (decision 5).

## How the tests prove it -- measuring PERTURBATION, not just determinism

A position fingerprint proves the forced stream is deterministic but says nothing about whether
each force did the RIGHT thing. So, reusing the existing hash-neutral mock-ctx accessors (`sumX`
drift-sum from 0006, `minX`/`maxX` extents from 0008 -- no new accessor needed), the unit gate
asserts the observable SIGNATURE of each force that a bare hash cannot see: `turbulence` widens
the x-extent (`maxX - minX`) -- decorrelated wander fans the pool; `gust` displaces the summed
x (`sumX`) by a material amount -- a coherent push shifts the whole pool. Each is checked
non-vacuously against the same-seed calm run.

- **Unit** (`turbulence / gust (living air)` describe, 7 tests, suite 106 -> 113): opt-in +
  fail-closed per knob (`== 1569828004`); floored + box hashes re-asserted untouched; the three
  new committed hashes (turbulence-only, gust-only, both) pinned, mutually distinct, and stable
  on replay; the perturbation signature (turbulence widens extent, gust displaces sumX); finite
  AND contained under strong turbulence + gust + wind + gravity in a tight elastic box; spray
  honours both (deterministic + perturbing); reduced-motion inert.
- **Torture T5**: signed finite/`0` `turbulence` + `gust` threaded into the differential fuzz
  op-stream (burst and spray), so two same-seed instances stay bit-identical frame for frame --
  which ALSO proves the shared `_elapsed` clock is deterministic across instances.
- **Torture T6 lane 5**: the full multi-shape resting pool (already under wind + a full box)
  now also carries `turbulence: 250` + `gust: 200`, so both guarded accel blocks and their
  `Math.cos`/`Math.sin` fire for every particle every frame; it still integrates at ~0 B/frame
  (the trig FMAs de-opt nothing).
- **Torture T1**: `turbulence: NaN`, `turbulence: -Infinity`, `gust: Infinity` join the poison
  barrage under the finite-position detector -- coercion holds, no NaN reaches a drawn position.

## Explicitly NOT done

- Perlin/simplex 3D noise fields, a spatial flow-field texture, or per-axis independent
  turbulence -- this chapter is the cheap phase-reuse curl + a single global sine gust (four
  trig calls, zero new rng, zero new alloc). A real noise field is a separate chapter if ever.
- A vortex / point attractor (curved pull toward a center) -- offered and NOT chosen this round;
  it is a distinct force with per-particle vector-to-center math, its own future chapter.
- Per-shape / per-color turbulence, gust on the Y axis, or turbulence that scales with life --
  both knobs are burst-wide scalars, matching every prior force.
- A settle-and-freeze optimisation (resting particles keep integrating at ~0 B/frame) -- same
  as 0007/0008.
- No change to the default fall path, existing presets, the default look, or the committed
  `1569828004` / `2679696825` / `804161759` fingerprints.

## References

- `Confetti.js` (`turb`/`gust` pool columns; `pool.turb[i]`/`pool.gust[i]` in `spawn`; the
  `GUST_HZ` constant; the instance `_elapsed` accumulator + `_elapsed += dtSec` in `update`;
  the guarded turbulence curl + gust blocks after the wind line and before the drag multiply in
  `update`; `turbulence = num(turbulence, 0)` / `gust = num(gust, 0)` + config in `burst`/`spray`).
- `Confetti.d.ts` (`turbulence?`/`gust?` on `BurstOptions`; `SprayOptions`/`Preset` inherit).
- `test/Confetti.test.mjs` (`turbulence / gust (living air)` describe; `TURB_HASH = 1630588936`,
  `GUST_HASH = 4074438162`, `TURBGUST_HASH = 15761758`); `test/torture/{t5-fuzz,t6-alloc,t1-degenerate}.mjs`.
- `decisions/0006` (wind, the guarded-accel + "draws no rng" determinism story and the `sumX`
  drift-direction probe this reuses), `0007` (floor), `0008` (box, the `minX`/`maxX` extent
  probes this reuses and the single-edge->box mirroring pattern), `0004` s1 (the coerce/drop-
  not-throw stance), `0003` (sway, the guarded-position knob whose x-only `sin(tilt)` offset
  this deliberately decorrelates turbulence from).
