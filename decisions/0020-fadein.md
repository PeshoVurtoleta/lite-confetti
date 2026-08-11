# 0020 -- birth-opacity ramp (`fadeIn`, the first knob on the render-OPACITY axis)

- **Status:** accepted (implemented in v1.19.0)
- **Date:** 2026-08-10
- **Session:** F18, the release after F17 (v1.18.0 flutterRate). Opens the OPACITY channel -- the last
  render axis with no public knob (rotation, scale, and color were each opened in prior chapters).

## Context

For eighteen releases a piece's OPACITY had exactly ONE hardcoded behaviour: a death fade-OUT over the last
30% of life (`Confetti.js` render block) --
`const lifeT = life/maxL; const alpha = lifeT < 0.3 ? lifeT/0.3 : 1;`. Every OTHER render channel had since
gained a public knob -- rotation (`align` v1.15.0, `spinRate` v1.16.0), scale (`scaleTo` v1.17.0,
`flutterRate` v1.18.0), color (`lifeColors` v1.12.0) -- but OPACITY had none, so a piece that MATERIALIZES
in (fades up from transparent at birth) was unreachable. This chapter adds **`fadeIn`**: an opt-in scalar
that ramps alpha `0 -> 1` over the FIRST `fadeIn` fraction of each piece's life, by the age fraction
`1 - lifeT` the death-fade and `lifeColors` already use. `fadeIn: 0.4` eases in over the first 40% of life;
default `0` = today's instant-on look. It is the mirror of the death fade, on the SAME `alpha` scalar.

Unlike spinRate/flutterRate, `fadeIn` has NO decoupling hazard: it reads only `lifeT` (a pure per-frame
ratio) and writes only `ctx.globalAlpha`. Nothing downstream reads alpha, so no birth pivot and no
decoupling machinery are needed -- it is the cleanest overlay in the suite. The one engineering wrinkle is
the harness probe: `globalAlpha` is a plain PROPERTY, not a method like `ctx.scale()`, so folding it needs
an accessor conversion (crux (c)).

## Decisions

1. **Single-endpoint monotone ramp, house style.** `fadeIn` is ONE scalar (like flutter/sway/align/
   spinRate/scaleTo), default `0` (off). The ramp is `alpha *= age / fadeIn` while `age < fadeIn`, where
   `age = 1 - lifeT` reuses the `lifeT` already computed for the death-fade + lifeColors index. Zero new
   state on the shared path beyond the one pool column.

2. **Multiplies the EXISTING alpha, does not replace it.** The birth fade-in and the hardcoded death
   fade-out act on the SAME `alpha` scalar and MULTIPLY. For a normal life they act in disjoint windows
   (in near birth, out near death); for a very short life they overlap and correctly multiply. The death
   fade-out line is UNCHANGED (only `const alpha` -> `let alpha`).

3. **Coercion: `clamp01(fadeIn, 0)`.** A fraction of life, exactly like `align` -- NOT a rate (`num`) and
   NOT an extent (`nonneg`). Non-finite / non-numeric / undefined -> `0` (off); `> 1` clamps to `1` (ramp
   spans the whole life); negative -> `0` (off). The render branch is gated `if (pool.fadeIn[i] > 0)`, so
   off does no divide and is byte-identical, and the `age / fadeIn` divide can never hit 0.

4. **Both burst AND spray**, like align/spinRate/scaleTo/flutterRate. Inert under reduced motion --
   `renderStaticBurst` sets a constant `ctx.globalAlpha = 0.85` and does no life integration, so `fadeIn`
   cannot touch it.

5. **Always written at spawn.** `pool.fadeIn[i] = config.fadeIn` is unconditional in `spawn()`. NOTE:
   unlike scaleTo/flutterRate (where a Float32 zero-init of `0` would mean a BAD state -- "shrink to
   nothing" / "frozen wobble"), here the zero-init default `0` HAPPENS to coincide with "off" (safe). We
   still write unconditionally (house style + fail-closed); we do not RELY on the coincidence.

## The crux

### (a) A pure RENDER overlay -- the position stream is byte-identical off AND on.

```js
const lifeT = pool.life[i] / pool.maxL[i];   // 1 at birth, 0 at death
let alpha = lifeT < 0.3 ? lifeT / 0.3 : 1;   // death fade-out (unchanged)
if (pool.fadeIn[i] > 0) {
    const age = 1 - lifeT;                   // 0 at birth -> 1 at death
    if (age < pool.fadeIn[i]) alpha *= age / pool.fadeIn[i];
}
```

- OFF is byte-identical: the guard is false, `alpha` is the SAME value fed today (COMMITTED_HASH
  `1569828004` and every prior fingerprint preserved). Cost off: one Float32 read + one compare per alive
  piece per frame.
- `fadeIn` never touches `ctx.translate` / `x` / `y` / `vx` / `vy`, draws no rng, and reads only `lifeT`.
  The position `hash` folds ONLY `translate`, so a fade-in burst reproduces the same-seed plain burst's
  position hash EXACTLY. It is also invisible to `rotateHash`, `scaleHash`, `colorHash`, AND `strokeHash`
  (the trail geometry) -- FIVE free "unchanged" channels. Only `globalAlpha` moves.
- Finite: `lifeT` in `(0,1]` (life<=0 pieces `continue`), so `age` in `[0,1)`; `fadeIn` in `(0,1]` after
  clamp01 + guard; `age < fadeIn` caps the factor to `[0,1)`, so `alpha` stays in `[0,1]`, finite for any
  input.

### (b) The trail ribbon fades in WITH the body -- the OPPOSITE of scaleTo's trail exemption, and correct.

`scaleTo` deliberately left the trail at its birth WIDTH (scaling the ribbon would need a per-sample
scale-history column, rejected). `fadeIn` is different: the trail ALREADY tracks the body `alpha` -- the
death fade dims the ribbon today via `ctx.globalAlpha = alpha * TRAIL_ALPHA`. Because `fadeIn` folds into
`alpha` BEFORE the trail block, the ribbon materializes in with the body for FREE (one shared scalar, zero
extra state). This is the RIGHT behaviour: a fading-in piece whose streak was at full opacity would read as
a bright tail with an invisible head. `strokeHash` folds path GEOMETRY (rounded points), NOT globalAlpha, so
`TRAIL_HASH 72519212` still reproduces byte-identical with fadeIn armed -- trail stays a proven overlay of
PHYSICS geometry, fadeIn a proven overlay of RENDER opacity, no cross-contamination.

### (c) The harness probe: `globalAlpha` is a PROPERTY, not a method -- convert it to an accessor.

`scaleHash` was easy: `ctx.scale(x,y)` is a METHOD, hooked at the call. `globalAlpha` is a plain assignable
FIELD on the mock ctx, previously unprobed. To fold it, it is converted to a get/set ACCESSOR with a backing
var, folding on SET in record mode -- the ONE structural difference from the scaleHash precedent. The engine
only ever WRITES globalAlpha (trail `alpha*TRAIL_ALPHA`, body `alpha`, static `0.85`; never reads it), so a
setter that stores + folds and a getter that returns the backing value is transparent to shipped code. The
set folds the QUANTIZED value (round to 1/4096, mirroring rotate()/scale()) into a NEW `alphaHash` (kept OUT
of the position `hash`, like scaleHash) and records the raw value in `lastAlpha`. `lastAlpha` witnesses the
BODY alpha: per particle the trail sets `alpha*TRAIL_ALPHA` THEN the body sets `alpha`, so the last set
before the shape draw is the body alpha. Converting globalAlpha to an accessor moves NO committed hash
(it was never in any hash); `alphaHash` is a brand-new out-of-hash channel. The reduced-motion static path
folds a constant `0.85` into alphaHash per drawn piece -- deterministic, baked into any reduced-motion
ALPHA_HASH; deliberately not filtered.

## Consequences / proof

- One new per-particle pool column: `fadeIn` (Float32, the render-time birth-opacity ramp); +4 B/particle,
  always written at spawn. The render family (align + spin0 + spinRate + scaleTo + tilt0 + flutterRate +
  fadeIn) now totals `28 B/particle`; the always-on SoA total is `37xF32 + 2xU8 = 150 B/particle`.
- New harness probe `alphaHash` / `lastAlpha` in `test/_env.mjs` (globalAlpha converted from a literal field
  to a get/set accessor). No committed hash moves -- globalAlpha was never hashed.
- New committed constant `ALPHA_HASH` (`3712788104`), probed on the canonical seed-12345 rig with
  `fadeIn: 0.4`, cross-process stable and distinct from off and from `fadeIn: 0.2`.
- Pure-overlay proof: `run(0.4)` reproduces the off run's position `hash`, `rotateHash`, `scaleHash`,
  `strokeHash`, and `colorHash` EXACTLY; only `alphaHash` differs. Non-vacuous via `lastAlpha`: a
  single-piece rig reads `1.0` on the first frame when off, and STRICTLY `< 1` + strictly increasing across
  the fade-in window at `fadeIn: 0.4`.
- Torture: t5 fuzz threads a random `fadeIn` (half at 0, else `[0,1]`) through burst AND spray, riding the
  `alphaHash` differential set; t6 adds a fade-in live pool lane (`fadeIn: 0.5` + `flutter: 1`) measured at
  ~0 B/frame; t1 poisons `fadeIn` (NaN / +-Infinity / non-numeric / null / {} -> 0; legal extremes 0, 1e-9,
  1, and `> 1` -> clamp 1) under turbulence + wind + a bouncing box + trails; t3 proves a recycled slot does
  not leak a stale `fadeIn`.
- Unit suite 204 -> 215 (+11). t7/t8/t9 unchanged: no shared or global state was added.

## Explicitly NOT done

- `fadeOut` -- parameterizing the hardcoded `0.3` death-fade window (the natural v1.20 sibling; same alpha
  axis + same alphaHash probe, retunes an existing constant rather than opening a new look).
- A two-endpoint `fadeIn -> hold -> fadeOut` envelope or an alpha keyframe list (one birth-side scalar only,
  matching the single-endpoint house style of scaleTo/flutterRate).
- An ease curve `fadeInEase` (linear in the age fraction only, matching lifeColors' linear LUT and scaleTo's
  linear ramp).
- Per-particle alpha jitter / an alpha range (one burst-wide scalar; a range costs an rng draw).
- A birth-opacity FLOOR (start above 0) -- the start is always 0 (fully transparent), matching the death
  fade's terminal 0.
- Alpha on the reduced-motion static path (the constant 0.85 is deliberately untouched).
- Opacity on the trail INDEPENDENT of the body (the ribbon shares the body `alpha` by design -- crux (b)).
- Any pool.x/y/v mutation, physics change, spawn-time rng draw, or change to the default look / presets /
  trail geometry / color / emit / stagger / align / spinRate / scaleTo / flutterRate overlays, or any
  committed position/rotate/scale/stroke/color fingerprint when fadeIn is off.
