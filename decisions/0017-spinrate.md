# 0017 -- tunable tumble speed (`spinRate`, the second RENDER-ORIENTATION feature)

- **Status:** accepted (implemented in v1.16.0)
- **Date:** 2026-08-08
- **Session:** F15, the release after F14 (v1.15.0 align). Where 0016 opened the render-ORIENTATION axis
  by tying rotation to velocity (WHICH WAY a piece faces), this closes the other half of that axis: HOW
  FAST a piece tumbles.

## Context

For fifteen releases a piece's tumble RATE has been a fixed seeded random (`spinV = (rng.next() - 0.5) *
10` rad/s, advanced each frame into `spin`), with no public knob. So slow drifting petals, frozen rigid
chips, and reverse tumble were all unreachable. This chapter adds **`spinRate`**: an opt-in multiplier on
the accumulated tumble -- `0` = rigid, `0.3` = a lazy drift, `1` = as seeded (default), `2` = double,
negative = reverse.

The engineering question is, again, the determinism contract -- but with a hazard `align` did not have.
`pool.spin[i]` is NOT render-only state: it feeds the turbulence curl phase at [Confetti.js:824]
(`const tp = pool.tilt[i] * 1.7 + pool.spin[i];`), which drives `vx`/`vy`. Any change to the spin VALUE
therefore leaks into POSITIONS whenever `turbulence != 0`.

## Decisions

1. **Render-time angle scale, NOT a spawn-time `spinV` scale.** Confirmed via AskUserQuestion. The
   multiplier is applied in the draw block only; `pool.spin[i]` -- the physics spin the integrator
   advances and the turbulence phase READS at [:824] -- is never modified. Scaling `spinV` at spawn was
   REJECTED: it would perturb `tp = tilt*1.7 + spin` whenever `turbulence` is armed, diverging positions
   and breaking the byte-identical-position guarantee. The resolution: scale the angle at render, never
   the state. The turbulence phase reads the UNSCALED `pool.spin[i]` exactly as today, so `spinRate` and
   `turbulence` are fully DECOUPLED, and the seeded position stream is byte-identical off, on, and
   on-with-turbulence.

2. **Rate-only via a stored birth column.** A new `spin0` column captures the random birth orientation;
   only the ACCUMULATED delta `(spin - spin0)` is scaled: `rot = spin0 + (spin - spin0) * spinRate`. So
   `spinRate: 0` freezes each piece at its OWN varied birth tilt (rigid but organic). A whole-angle
   multiply (`rot = spin * spinRate`) was REJECTED: `spinRate: 0` would collapse EVERY piece to angle `0`
   (all identically axis-aligned -- a visual bug, not a feature).

3. **Multiplier semantics, default 1.** Coerced with the existing `num(v, dflt)`: any FINITE value passes
   (`0` and negatives are valid -- rigid and reverse tumble); only non-finite / undefined / non-numeric
   fails closed to `1`. NOT `clamp01` -- a rate multiplier is not a `0..1` blend.

4. **The byte-identical-POSITION-stream crux -- the load-bearing property.** Like `align`, `spinRate`
   changes ONLY the argument to `ctx.rotate`; it never moves `ctx.translate`. So:
   - **OFF** (`spinRate == 1` / non-finite -> `1`) -> the `if (pool.spinRate[i] !== 1)` guard is false ->
     `ctx.rotate(pool.spin[i])` exactly as today. COMMITTED_HASH (1569828004) and every prior
     physics/trail/color/emit/stagger/align fingerprint preserved, AND the same rotateHash as a plain burst.
   - **ON** -> the POSITION hash is STILL identical to the same-seed off burst (a pure orientation
     overlay), EVEN with `turbulence` armed (the decoupling crux), but the rotation sequence changes ->
     a NEW committed fingerprint (SPINRATE_HASH 1105261140), deterministic under a fixed seed + fixed dt.
   - **No new probe.** It reuses the v1.15.0 `rotateHash` / `lastRotate` pair -- the FIRST orientation
     feature to ship without a harness change.

5. **The `spin0` + `spinRate` columns + the guarded render scale.** Two per-particle Float32 columns:
   `spin0` (the birth pivot, written right after the spin seed in `spawn()`) and `spinRate` (the
   multiplier, assigned from config beside `align`). `spawn()` ALWAYS writes both, so the TypedArray
   zero-init is never relied on (a zero-init `spinRate` of `0` would mean "frozen" -- a fail-closed
   requirement, not a nicety). The scale sits in the render loop BEFORE the `align` blend, so the tumble
   scale runs first (producing the piece's own tumble angle), then `align` lerps that toward the velocity
   heading.

6. **Fail closed.** `num(spinRate, 1)` maps non-finite / non-numeric -> `1` (off). `rot` is a bounded
   seeded angle times a finite multiplier, hence finite for any finite `spinRate` -- no non-finite draw
   can result.

7. **Both burst AND spray.** Like `align` (and unlike burst-only `stagger`), `spinRate` is a render
   property of ANY moving piece, so both `burst()` and `spray()` carry it. The shared column is `1` for a
   plain piece, so the guard is inert for it.

8. **No reduced-motion effect.** The static accessible fan (`renderStaticBurst`) has no accumulated
   tumble to scale, so `spinRate` is inert there -- documented with a one-line comment, no call-site change.

9. **Hot path untouched by default.** The scale is one guarded branch per alive piece per frame on the
   RENDER path; when off it is a single Float32 read + compare, when on two reads + a subtract + a
   multiply + an add (stack arithmetic, zero allocation). The physics integrator is not touched at all.

## Consequences / proof

- Unit suite 173 -> 182. New `describe('spinRate / tumble speed')` asserts: OPT-IN / fail-closed (off / 1
  / NaN / Infinity / non-numeric all reproduce COMMITTED_HASH AND the plain-run rotateHash); prior gates
  still hold with spinRate off (COMMITTED_HASH, FLOOR_HASH, BOX_HASH, ALIGN_HASH); the PURE-OVERLAY
  headline (2 / 0 / 0.5 / -1 each leave the position hash identical, change only rotateHash); the
  TURBULENCE-DECOUPLING crux (`{spinRate:2, turbulence:400}` vs `{spinRate:1, turbulence:400}` -> same
  position hash, different rotateHash); a committed SPINRATE_HASH, distinct + deterministic, with
  `spinRate:0.5` distinct from both 1 and 2; NON-VACUOUS RATE (a pumped `spinRate:0` piece freezes at its
  birth tilt via `lastRotate` and does NOT advance, while `spinRate:1` does); `assertFinite` under
  spinRate + gravity + wind + turbulence + bounce in a box; spray HONORS spinRate (rotateHash differs
  while positions hold); reduced-motion inert.
- Torture: T5 threads a random `spinRate` (half at 1, else `[-2, 3]`) through the burst AND spray
  differential fuzz; the existing `rotateHash` same-seed equality check covers it, and position-hash
  equality holds with the multiplier armed. T6 adds a tumble-scaled live-pool lane (`spinRate: 2` WITH
  `turbulence` on, so both the [:824] read and the render scale run for ~MAXP pieces/frame) -- still
  ~0 B/frame. T1 adds spinRate poison (NaN / Infinity / -Infinity / non-numeric -> 1, plus 0, negative,
  and 1e6) under the finite-position detector with turbulence + wind armed -- nothing crashes, no NaN
  reaches a draw.
- Full gate matrix green: 182 unit; torture ok / BREAK exit 1 / CONTROL=alloc exit 1 / SEED ok; ASCII
  clean; npm pack 1.16.0.
- Cost: two Float32 pool columns (8 B/particle); one guarded branch per alive piece per frame (two reads
  + subtract + multiply + add when armed, a read + compare when off). No physics change.

## Explicitly NOT done (flagged for a future chapter, if ever)

- **Spawn-time `spinV` scaling** -- rejected in decision 1; it would leak into the turbulence curl phase
  at [:824] and break the byte-identical position stream.
- **Whole-angle multiply (`rot = spin * spinRate`)** -- rejected in decision 2; `spinRate: 0` would
  collapse every piece to angle `0` instead of freezing each at its own random birth tilt.
- **A separate flutter / wobble-RATE knob** (scaling `tiltV`) -- `flutter` already tunes wobble DEPTH;
  wobble rate is a distinct chapter, and `tiltV` also feeds [:824].
- **Per-particle spinRate jitter or a spinRate range** -- one burst-wide multiplier, matching every prior
  knob; a range would need an extra rng draw.
- **Orientation on the reduced-motion static path** -- the static fan has no accumulated tumble.
- Any change to the default look, existing presets, the physics integrator, the trail / color / emit /
  stagger / align overlays, or any committed position / trail / color / emit / rotation fingerprint when
  spinRate is off.
