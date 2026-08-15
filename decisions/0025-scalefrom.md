# 0025 -- birth-size ramp (`scaleFrom`, the birth endpoint of the size ramp `scaleTo` targets)

- **Status:** accepted (implemented in v1.24.0)
- **Session:** F24, the release after F23 (v1.23.0 spinDrag). spinDrag closed the last unmirrored asymmetry
  in the PHYSICS integrator (drag:spinDrag). This chapter closes the last unbracketed RENDER axis: SCALE
  had only its death endpoint (`scaleTo`, v1.17.0); opacity already had both (`fadeIn` v1.19.0 birth +
  `fadeOut` v1.20.0 death). `scaleFrom` is the birth endpoint, the mirror `scaleFrom:scaleTo :: fadeIn:fadeOut`.

## Context

For seventeen releases a piece's rendered size has ALWAYS started at exactly `1.0`. `scaleTo` (v1.17.0)
opened the render-SCALE axis with a one-endpoint life ramp `1 -> scaleTo`, but the ORIGIN was hardcoded:
the render fold was literally `s = 1 + (scaleTo - 1) * (1 - lifeT)`. So "born small, blooms as it ages"
(and its inverse, "born big, settles to full") was unreachable.

This chapter adds **`scaleFrom`**: an opt-in scalar, default `1` (off), that turns the one-endpoint ramp
into a two-endpoint envelope `s = scaleFrom + (scaleTo - scaleFrom) * (1 - lifeT)`, isotropic, linear in
the SAME age fraction `scaleTo` and the `lifeColors` index already use. `scaleFrom: 0.2` blooms from a
fifth-size; `2` starts double and settles; `scaleFrom == scaleTo` is an emergent constant size multiplier.

**Divergence flag (supersedes 0018).** `decisions/0018-scaleto.md` deferred this with the rationale
*"birth-size override is already `sizeMin`/`sizeMax`"*. That rationale is WRONG against the source and this
record supersedes it: `sizeMin`/`sizeMax` set a CONSTANT birth size (`pool.w`/`pool.h`, written once at
spawn and never touched again); the render ramp always BEGAN at literal `1`. No combination of
`sizeMin`/`sizeMax`/`scaleTo` produces a piece whose rendered size STARTS at a different factor and
animates from there -- they move the constant, not the ramp's origin. That was the gap.

## Decisions

1. **One scalar, `scaleFrom`, default `1`.** One new `Float32Array` pool column (`scaleFrom`), +4 B/particle
   (166 -> 170 = 42 x Float32 + 2 x Uint8). The column is declared immediately after `scaleTo`, so the
   README alloc-table row inserts MID-table and shifts every subsequent running total +4.

2. **Coercion `nonneg(scaleFrom, 1)`** -- the SAME helper `scaleTo` uses, for the same reason. Non-finite /
   non-numeric / undefined -> `1` (off); a finite NEGATIVE -> `0` (born invisible -- a legitimate finite
   value, the size analog of `scaleTo:0`, NOT a mirror flip and NOT a fallback to `1`); `> 1` passes
   unchanged (a size factor is unbounded above -- `scaleFrom: 3` is legal). NOT `clamp01` (would cap the
   legal `> 1` case); NOT `num` (a negative would mirror the sprite -- a size has no direction).

3. **No fround sentinel.** `Math.fround(1) === 1`, so `pool.scaleFrom[i] !== 1` is byte-exact when off.
   This is the `scaleTo`/`spinDrag`/`friction` case, NOT the `fadeOut` `FADE_OUT_DEF = Math.fround(0.3)`
   case. Do not add one "for symmetry."

4. **The damp is a FORMULA REWRITE of the existing render fold, not a new guarded branch.** The guard
   becomes `if (scaleTo !== 1 || scaleFrom !== 1)` (scaleTo tested first, short-circuiting a scaleTo-armed
   burst) and the body is `const sf = pool.scaleFrom[i]; const s = sf + (pool.scaleTo[i] - sf) * (1 - lifeT);`.
   It still feeds the SINGLE existing `ctx.scale(sx, sy)`; no new `ctx` call, no reorder. The order relative
   to `wobbleScale` (flutter) and the `rot` block is unchanged.

5. **Spawn write UNCONDITIONAL and LOAD-BEARING.** `pool.scaleFrom[i] = config.scaleFrom;` at spawn. A
   Float32 zero-init `0` would mean "born at zero size" (invisible) -- a WRONG default on a recycled slot.
   This is the `scaleTo`/`flutterRate`/`fadeOut`/`spinDrag` load-bearing case (the write carries the correct
   non-zero default), NOT the `friction`/`wallFriction` case (whose `0` default coincides with off). The t3
   A15 symmetric-history retention proof pins it.

6. **burst AND spray; inert under reduced motion.** `renderStaticBurst` does no life integration, has no
   `lifeT`, and never calls `ctx.scale`, so the static path is untouched.

7. **Trail ribbon keeps its BIRTH width.** `ctx.lineWidth = Math.min(pool.w[i], pool.h[i]) * TRAIL_WIDTH`
   is outside the scale block; `scaleFrom` never narrows it, exactly as `scaleTo` left it.

## The crux -- zero position-coupling (genuinely provable) + the formula-rewrite bit-identity

Two facts, both PROVEN not asserted:

**(a) Position-coupling paths: ZERO, and genuinely provable (unlike v1.23.0 spinDrag).** `pool.scaleFrom`
is read in EXACTLY one place (the fold), plus its spawn write. The fold's outputs `sx`/`sy` are consumed by
exactly one `ctx.scale` and by nothing else -- no physics, no trail, no color, no rng. Contrast `spinDrag`,
whose `pool.spin` had a SECOND reader (the turbulence curl `tp = tilt*1.7 + spin`) making it a hybrid.
`scaleFrom` has no such second path. To keep the claim honest rather than vacuous, purity is asserted on
the rigs where a leak WOULD show, ARMED: `{ turbulence: 500, scaleFrom: 0.25 }` reproduces `TURB_HASH`
(the curl reads tilt/spin, never sx/sy); `{ sway: 0.8, scaleFrom: 0.25 }` reproduces the sway position hash
(sway is a direct x write); the trail rig reproduces `TRAIL_HASH` (world-space ribbon, never scaled).

**(b) The rewrite. Bit-identity when off is the load-bearing argument.** This is the first chapter since
`fadeOut` to EDIT an existing committed render expression instead of adding a guarded branch. Two committed
fingerprints ride the same `ctx.scale`: `SCALE_HASH 148099462` (`scaleTo: 2`) and `FLUTRATE_HASH 4094960833`
(`flutter:1, flutterRate:2`). At the default, `pool.scaleFrom[i]` stores/reads back exactly `1.0` (Float32
exact), so `sf + (scaleTo - sf) * age` is the SAME double expression as the shipped `1 + (scaleTo - 1) * age`
-- same operands, same order, same IEEE rounding. Both fingerprints reproduce bit-for-bit with `scaleFrom`
present-but-off. Verified, not hand-waved.

Channels: `scaleHash` MOVES on the canonical rig (`SCALEFROM_HASH 2718696453`, distinct from off, from
`scaleFrom: 2`, and from `SCALE_HASH`). The canonical `lifeMin/Max: 5` rig suffices (unlike `fadeOut`'s
dedicated short-life rig): `scaleFrom` bites HARDEST at age 0 (`s == scaleFrom` on the first drawn frame).
Harness: REUSES `scaleHash` + `lastScale` + `lastScaleX` -- NO `_env.mjs` change. `lastScale` is the
isotropic Y factor (`== s`, the direct witness of the birth endpoint); `lastScaleX == wobbleScale * s`
(proves the fold MULTIPLIES flutter rather than replacing it).

## Consequences / proof

- Committed hash: `SCALEFROM_HASH 2718696453` (`run({ scaleFrom: 0.25 }).scaleHash`, canonical rig,
  cross-process stable, distinct from off / `scaleFrom: 2` / `SCALE_HASH 148099462`). At `scaleFrom: 1`
  (and every fail-closed input -> 1) every prior fingerprint including `SCALE_HASH` and `FLUTRATE_HASH`
  reproduces bit-for-bit.
- Non-vacuous via `lastScale` (hash-neutral): on a single-piece `flutter:0` rig, the first-drawn-frame
  `lastScale` is strictly increasing over `scaleFrom in {0, 0.25, 0.5, 1, 2}`; `{scaleFrom:0, scaleTo:1}`
  gives a `lastScale` that strictly INCREASES frame over frame (a bloom) while `{scaleFrom:2, scaleTo:1}`
  strictly DECREASES; with `flutter:0`, `lastScaleX === lastScale` exactly (the isotropic fold).
- Fail-closed: `run({scaleFrom:-1}).scaleHash === run({scaleFrom:0}).scaleHash` and both `!== run({}).scaleHash`
  (a negative clamps to 0, does NOT fall back to 1). t1 poisons `NaN/+-Infinity/'0.5'/null/{} -> 1`; legal
  extremes `0`, `-5 -> 0`, `1e-9`, `1e9`, under flutter + turbulence + a bouncing box, all finite.
- Retention (t3 A15): a recycled slot does not leak a stale `scaleFrom`. Proven with a SYMMETRIC-history
  `lastScale` snapshot -- the control runs the IDENTICAL 5-cycle drain history but arms `scaleFrom: 1`, so
  both instances share the ticker stop/restart timing; the ONLY remaining difference is the armed value the
  spawn write must overwrite. `A.lastScale === B.lastScale` proves no leak; a still-armed
  `armedLastScale !== B.lastScale` keeps the witness non-vacuous. (A naive fresh-vs-recycled control would
  diverge purely from the ticker-restart timing -- the same false-failure the spinDrag A14 proof avoided.)
- Alloc: one new Float32 column, no hot-path allocation (the fold is a guarded read + compare + a couple of
  multiplies on Float32s already in cache). t6 birth-ramped immortal-pool lane (`scaleFrom:0.2, scaleTo:2,
  flutter:1`) at ~0 B/frame, SOAK 10000-frame window maxMajor:0.
- Unit suite 259 -> 270 (+11). t5 threads a random `scaleFrom` (half off) through the differential.
  t7/t8/t9 unchanged (no shared/global state added).

## Explicitly NOT done

- A scale WINDOW (`scaleIn`, a fadeIn-style "pop over the first N% then hold") -- a second scalar on one
  axis; the house ships one endpoint scalar per chapter. The ramp stays linear across the whole life.
- An ease curve `scaleEase` -- re-deferred from 0018/0020/0021; linear in life fraction only.
- Per-axis / non-uniform `scaleFromX/Y` -- collides with flutter's X-wobble (re-deferred from 0018).
- A keyframe list / envelope object -- two endpoint scalars close the axis, as fadeIn + fadeOut closed opacity.
- Scaling `pool.w`/`pool.h` at spawn instead of at render -- that is `sizeMin`/`sizeMax`; it would move the
  trail width and the position-independent birth constants. The ramp stays a render-time fold.
- Applying the size ramp to the trail ribbon width -- the streak keeps its birth width (0018's rule).
- `scaleFrom` on the reduced-motion static path (no `lifeT`, no `ctx.scale` there).
- A negative `scaleFrom` as a mirror flip -- rejected; `nonneg` clamps to 0 (a size has no direction).
- `spinFriction` (contact-only tumble kill) -- re-deferred: after v1.23.0 `spinDrag`, ambient angular
  decay already bites everywhere; contact-only decay bites on <1% of frames and re-runs 0024's harder
  hybrid crux for a smaller effect.
- Per-particle mass / size-dependent linear or angular drag -- re-deferred from 0022/0024 (the engine has
  no mass concept; an honest version muddies the `drag` fingerprint or pays a per-frame `Math.pow`).
- `spinRange` / per-particle spin-rate range -- 0024 ruled a spawn-time `spinV` scale is `spinRate`'s
  render scale by another name; a variance variant would perturb the seeded `(rng.next()-0.5)*10` draw.
- Any change to the default look, presets, `sizeMin`/`sizeMax`, `scaleTo`, or to ANY committed fingerprint
  (position / rotate / scale / stroke / color / alpha) when `scaleFrom` is off.
