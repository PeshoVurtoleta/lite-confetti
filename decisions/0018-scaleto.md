# 0018 -- size over life (`scaleTo`, the first RENDER-SCALE feature)

- **Status:** accepted (implemented in v1.17.0)
- **Date:** 2026-08-09
- **Session:** F16, the release after F15 (v1.16.0 spinRate). Where 0016/0017 opened and closed the
  render-ORIENTATION axis (which way a piece faces, how fast it tumbles), this opens a new axis entirely:
  render-SCALE -- how BIG a piece is over its life.

## Context

For sixteen releases a piece's SIZE has been fixed at birth: `pool.w[i]` / `pool.h[i]` are drawn once in
`spawn()` and never change again, and the only `ctx.scale` in the draw block was `flutter`'s X-wobble. So
a piece that shrinks away to nothing, or an ember that blooms as it dies, was unreachable. This chapter
adds **`scaleTo`**: an opt-in scalar that lerps each piece's RENDERED size from `1.0` at birth to `scaleTo`
at death, by the SAME age fraction (`1 - life/maxL`) the `lifeColors` ramp already indexes. `0.2` shrinks
out, `2` grows, `0` vanishes at death; default `1` = today's constant size.

The engineering question is the determinism contract, as with every render overlay -- but scale has a
hazard orientation did not: `flutter` ALREADY owns `ctx.scale`. A naive second `ctx.scale` call, or a
`pool.w`/`pool.h` mutation, would either double the transform ops (and make the OFF path emit a call it
does not emit today) or leak the size into geometry the trail and future physics could read.

## Decisions

1. **Single-endpoint monotone ramp, house style.** `scaleTo` is ONE scalar (like flutter/sway/align/
   spinRate), default `1`. `s = 1 + (scaleTo - 1) * (1 - lifeT)`, reusing the `lifeT` already computed at
   the opacity fade and already consumed by the `lifeColors` index. Zero new state on the shared path, no
   new life math. A two-endpoint `scaleFrom -> scaleTo` pop and an ease curve `scaleEase` were both
   deferred (birth-size override is already `sizeMin`/`sizeMax`; the ramp is linear in life fraction to
   match the `lifeColors` linear LUT).

2. **Isotropic.** One factor on BOTH axes. Per-axis scale is out of scope AND collides with `flutter`,
   which owns X via `ctx.scale(wobbleScale, 1)`. Isotropic keeps the two orthogonal -- flutter wobbles X,
   `scaleTo` scales both, and they MULTIPLY on one transform.

3. **Coercion: `nonneg(scaleTo, 1)` -- a negative clamps to 0, NOT the default.** Non-finite / non-numeric
   / undefined -> `1` (off); a NEGATIVE clamps to `0`, not a mirror flip and not a fallback to the default.
   Precedent, not taste: `clamp01(flutter, 1)` maps `-1 -> 0`, `clamp01(align, 0)` maps `-1 -> 0`,
   `nonneg(sizeMin, 5)` maps `-3 -> 0`. A size multiplier `< 0` is a per-frame mirror flip that, times the
   flutter X-wobble, reads as a flicker glitch; `spinRate` admits negatives only because reverse rotation
   is a real DIRECTION, and a size has none. Documented explicitly: `scaleTo: -2` clamps to `0` and does
   NOT fall back to `1`; `scaleTo: 0` is a legitimate value (the size analog of `spinRate: 0`).

4. **Both burst AND spray**, like align/spinRate. Inert under reduced motion -- `renderStaticBurst` does
   no life integration and never calls `ctx.scale`.

5. **Always written at spawn, never zero-init.** `pool.scaleTo[i] = config.scaleTo;` is unconditional in
   `spawn()`. A Float32Array zero-init would mean `0` = "shrink to nothing", so a recycled slot that
   skipped the write would render a vanishing piece. Fail-closed requirement, like `landed = 0` /
   `trailN = 0`.

## The crux

### (a) One `ctx.scale`, not two. `pool.w`/`pool.h` are NEVER mutated.

`flutter` already calls `ctx.scale(wobbleScale, 1)`. The size factor is FOLDED into that SINGLE existing
call, never a second one:

```js
let sx = wobbleScale;
let sy = 1;
if (pool.scaleTo[i] !== 1) {
    const s = 1 + (pool.scaleTo[i] - 1) * (1 - lifeT);
    sx = wobbleScale * s;
    sy = s;
}
// ...
ctx.scale(sx, sy);
```

- OFF is byte-identical: the guard is false, `sx === wobbleScale` and `sy === 1` are the same unmodified
  locals (no multiply-by-1 executed), so the OFF path emits exactly the call it always did. Cost off: one
  Float32 read + one compare per alive piece per frame.
- ON keeps the POSITION stream byte-identical: scale never touches `ctx.translate` / `x` / `y` / `w` / `h`
  and draws no rng, so a scaled burst reproduces the same-seed plain burst's position hash EXACTLY
  (COMMITTED_HASH `1569828004`) -- and is invisible to `rotateHash` and `colorHash` too. Only the size
  fold moves, earning its own committed `SCALE_HASH` (`148099462`).
- Finite: `lifeT` is in `(0,1]` (life <= 0 pieces already `continue`), so age is in `[0,1)` and `s` stays
  between `min(1, scaleTo)` and `max(1, scaleTo)`. `ctx.scale(0,0)` is legal Canvas2D (draws nothing, no
  throw) and only occurs at `scaleTo: 0` as life -> 0, when alpha is already ~0.

### (b) The trail ribbon keeps its BIRTH width.

The ribbon strokes in WORLD space with `lineWidth = min(pool.w[i], pool.h[i]) * TRAIL_WIDTH`, OUTSIDE the
save/translate/rotate/scale block. `scaleTo` does not narrow it, deliberately: the ring buffer stores
POSITIONS ONLY, and a tapering ribbon would need a per-sample scale-history column (a third
`Float32Array(maxParticles * trailCap)`), real memory growth for a flourish decision 0010 already rejected
once (the 1.9.0 per-segment taper was reverted in 1.10.0). So `strokeHash` / TRAIL_HASH `72519212` stay
byte-identical with `scaleTo` armed -- trail stays a proven overlay of PHYSICS state, `scaleTo` a proven
overlay of RENDER state, no cross-contamination.

## Consequences / proof

- One new per-particle pool column `scaleTo` (Float32, +4 B/particle), always written at spawn.
- New harness probe `scaleHash` / `lastScale` in `test/_env.mjs` -- a structural copy of the
  `rotateHash` / `lastRotate` pair (same 1/4096 quantization), folded OUT of the position hash. The
  `updateSize()` `ctx.scale(dpr, dpr)` at construction folds one `(1,1)` before any burst; deterministic
  and identical across same-shaped runs, so it cancels in every A/B and is baked into the committed
  `SCALE_HASH`.
- New committed constant `SCALE_HASH` (`148099462`), probed on the canonical seed-12345 rig with
  `scaleTo: 2`, cross-process stable and distinct from off and from `scaleTo: 0.5`.
- Torture: t5 fuzz threads a random `scaleTo` (half at 1, else `[0,3]`) through burst AND spray and adds
  `scaleHash` to the same-seed differential set; t6 adds lane (11), a size-ramped live pool (`scaleTo:
  0.25` + `flutter: 1`) measured at ~0 B/frame; t1 poisons `scaleTo` (NaN / +-Infinity / non-numeric /
  null -> 1; legal extremes 0, -5 -> 0, 1e-9, 1e6) under turbulence + wind + a bouncing box; t3 A8 proves
  a single-slot pool recycles a `scaleTo: 0` piece without leaking the stale target (the recycled plain
  piece renders at an exact Y factor of 1).
- Unit suite 182 -> 193 (+11). t7/t8/t9 unchanged: no shared or global state was added.

## Explicitly NOT done

- Two-endpoint `scaleFrom -> scaleTo` pop (birth-size override is already `sizeMin`/`sizeMax`).
- Per-axis / non-uniform scale (collides with flutter's X-wobble).
- An ease curve `scaleEase` (linear in life fraction only, matching the `lifeColors` linear LUT).
- Per-particle scale jitter / a scale range (one burst-wide scalar; a range costs an rng draw).
- A ramp driven by anything but life fraction (same call as `lifeColors`, decision 0013).
- Scaling the trail ribbon width (decision (b)).
- Mirror-flip on negative `scaleTo` (rejected in decision 3; clamps to 0).
- An upper cap on `scaleTo` (none, consistent with the uncapped `sizeMax`; T1 pins `1e6` finite).
- Size on the reduced-motion static path.
- Any `pool.w`/`pool.h` mutation, physics change, or change to any committed fingerprint when `scaleTo`
  is off.
