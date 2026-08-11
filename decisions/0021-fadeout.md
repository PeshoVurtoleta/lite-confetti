# 0021 -- death-fade window (`fadeOut`, the second knob on the render-OPACITY axis; closes the axis)

- **Status:** accepted (implemented in v1.20.0)
- **Date:** 2026-08-11
- **Session:** F19, the release after F18 (v1.19.0 fadeIn). CLOSES the OPACITY channel -- v1.19.0 opened it
  with the birth ramp; this adds the death ramp, so `fadeIn` (birth) + `fadeOut` (death) now bracket the
  full opacity envelope on one shared `alpha`. First "second knob on an axis" to cost NO harness change.

## Context

For nineteen releases a piece's OPACITY had a fixed death behaviour: a fade-OUT over the last 30% of life,
a magic `0.3` baked into the render body (`Confetti.js`, top of the body draw) --
`const lifeT = life/maxL; let alpha = lifeT < 0.3 ? lifeT/0.3 : 1;`. v1.19.0's `fadeIn` opened the birth
side of the axis (ramp UP over the first `fadeIn` fraction) but the death window itself had no public knob,
so a long gentle dissolve, a quick blink-out, or a hard cut were unreachable. This chapter adds **`fadeOut`**:
an opt-in scalar (default `0.3` = today) that parameterizes the death window -- the fraction of life over
which a piece dissolves OUT at the END. `fadeOut: 0.6` fades over the last 60%; `0.1` a quick blink-out;
`0` a hard cut (full opacity then gone -- the alpha analog of `spinRate:0`/`scaleTo:0`); `1` fades across the
whole life. It is the mirror of `fadeIn` on the SAME `alpha` scalar, and together they compose the full
envelope: materialize in, hold, dissolve out.

Unlike every prior render chapter, `fadeOut` is the SECOND knob on an already-probed axis, so it reuses
v1.19.0's `alphaHash`/`lastAlpha` harness accessor VERBATIM -- zero harness change. The one engineering
wrinkle is a Float32 round-trip subtlety in the off-identity guard (crux (a)).

## Decisions

1. **Parameterize the existing constant, house style.** `fadeOut` is ONE scalar (like fadeIn/scaleTo/
   flutterRate), default `0.3`. The armed math is the SAME shape as the hardcoded line with `0.3` swapped
   for the knob: `alpha = lifeT < fadeOut ? lifeT / fadeOut : 1`. No `age = 1 - lifeT` term (the death fade
   keys off `lifeT` directly, unlike fadeIn which keys off `age`). Zero new math on the shared path beyond
   one Float32 read + one compare; one new pool column.

2. **Multiplies with fadeIn on the SAME alpha; runs BEFORE the fadeIn block.** The death-fade recompute
   produces the base `alpha`; the existing fadeIn block then multiplies it, UNCHANGED. Disjoint windows for a
   normal life (up near birth, down near death); for a very short life they overlap and correctly multiply.
   Order is fixed: fadeOut recompute (new) -> fadeIn multiply (unchanged).

3. **Coercion: `clamp01(fadeOut, FADE_OUT_DEF)` where `FADE_OUT_DEF = Math.fround(0.3)`.** A fraction of life
   like align/fadeIn -- NOT a rate (`num`), NOT an extent (`nonneg`). Non-finite/non-numeric/undefined ->
   `0.3` (the default window, off); `> 1` -> `1` (whole life); NEGATIVE -> `0` (hard cut). DOCUMENTED:
   `fadeOut:-1` clamps to `0` (hard cut), does NOT fall back to `0.3`; `fadeOut:0` is legitimate.

4. **Both burst AND spray.** Inert under reduced motion -- `renderStaticBurst` sets a constant
   `ctx.globalAlpha = 0.85` and does no life integration, so there is no `lifeT` to fade; the 0.85 is
   deliberately untouched, same as fadeIn.

5. **Always written at spawn -- LOAD-BEARING here, not a coincidence.** `pool.fadeOut[i] = config.fadeOut` is
   UNCONDITIONAL. UNLIKE fadeIn (whose Float32 zero-init `0` HAPPENED to coincide with "off"), a zero-init
   `0` for `fadeOut` means "hard cut, no death fade" -- a WRONG default. A recycled slot that skipped the
   write would render a piece that never fades out. This is the scaleTo/flutterRate situation: the
   unconditional write is a fail-closed requirement.

## The crux

### (a) The `Math.fround(0.3)` sentinel is the WHOLE off-identity argument.

`fadeOut`'s default `0.3` is stored in a `Float32Array`, and a Float32 round-trip is LOSSY:
`Math.fround(0.3) === 0.3` is **`false`** (fround(0.3) approx 0.30000001192). So a guard written
`if (pool.fadeOut[i] !== 0.3)` would fire on EVERY piece even at the default -- recomputing `alpha` with the
frounded Float32 instead of the double literal and silently drifting the committed alphaHash. The fix:

```js
const FADE_OUT_DEF = Math.fround(0.3);           // module const -- the fround(0.3) sentinel
// ... coercion: clamp01(fadeOut, FADE_OUT_DEF)
// ... in the render body, AFTER the unchanged death-fade line, BEFORE the fadeIn block:
const lifeT = pool.life[i] / pool.maxL[i];
let alpha = lifeT < 0.3 ? lifeT / 0.3 : 1;       // UNCHANGED -- keeps the DOUBLE 0.3 literal
const fo = pool.fadeOut[i];
if (fo !== FADE_OUT_DEF) alpha = lifeT < fo ? lifeT / fo : 1;   // armed: recompute the base
```

- The original death-fade line is left BYTE-FOR-BYTE UNCHANGED as the default/else path -- it MUST keep the
  DOUBLE `0.3`, because the committed off-look alphaHash `2389639168` and the v1.19.0 `ALPHA_HASH`
  `3712788104` were both probed with that exact double-0.3 math. Only when `fo !== FADE_OUT_DEF` is `alpha`
  overwritten with the parameterized Float32 version.
- OFF byte-identical (fo === FADE_OUT_DEF): guard false, `alpha` is exactly the value fed today. Cost at the
  default: one Float32 read + one compare per alive piece/frame.
- ARMED byte-identical POSITIONS: `fadeOut` never touches translate/x/y/vx/vy, draws no rng, reads only
  `lifeT`. A fade-out burst reproduces the same-seed plain burst's position `hash` EXACTLY, and is invisible
  to `rotateHash`, `scaleHash`, `strokeHash`, `colorHash` (four free "unchanged" channels). Only `alphaHash`
  moves. Even PURER than fadeIn: no birth pivot, no decoupling machinery, AND no harness change.
- Finite for any input: `lifeT` in `(0,1]` (dead pieces `continue`); `fo` in `[0,1]` after clamp01. `fo == 0`
  -> `lifeT < 0` always false -> `alpha = 1`, no divide. `fo > 0` -> the `lifeT < fo` guard caps the ratio and
  the divide is by `fo > 0`, so `alpha` stays in `[0,1]`, never NaN.

### (b) The trail dissolves out WITH the body -- unchanged relationship, for free.

The trail already tracks the body `alpha` via `ctx.globalAlpha = alpha * TRAIL_ALPHA`. Because `fadeOut`
recomputes the shared `alpha` BEFORE the trail block, the ribbon dissolves out on the same window as the body
automatically (one shared scalar, zero extra state) -- exactly as fadeIn made it materialize IN. `strokeHash`
folds path GEOMETRY not globalAlpha, so `TRAIL_HASH 72519212` still reproduces byte-identical with fadeOut
armed.

### (c) The harness needs NO change -- `fadeOut` rides v1.19.0's probe verbatim.

`fadeOut` writes only `ctx.globalAlpha`, through the exact same body/trail sets v1.19.0 already converted to
the `_alpha` get/set accessor. That accessor folds the quantized value into `alphaHash` and records
`lastAlpha` on SET, regardless of WHY the alpha changed. So `test/_env.mjs` is UNTOUCHED: `alphaHash` picks
up the new death-fade sequence and `lastAlpha` witnesses the body alpha for free. This is the headline
simplification vs every prior render chapter -- the second knob on an axis costs no new probe.

### (d) The retention witness must sample a LATE frame -- the fadeIn A10 pattern does NOT transfer.

fadeIn affects BIRTH, so A10 could assert `lastAlpha === 1` on the recycled slot's FIRST frame. fadeOut
affects DEATH: at birth `lifeT approx 1`, so `alpha == 1` for ANY fadeOut window -- a first-frame
`lastAlpha === 1` witness is NON-DISCRIMINATING (it passes whether or not a stale fadeOut leaked -> false
confidence). The t3 A11 lane instead uses two `maxParticles:1` instances: **A** fires N pieces with `fadeOut`
ARMED (`fadeOut:0`, the most divergent), drains each cycle to `count === 0`, then a PLAIN burst; **B** (fresh)
only the plain burst. Both are pumped INTO the death window (small `lifeT`), and the lane asserts
`A.lastAlpha === B.lastAlpha` (a leaked `fadeOut:0` in A reads `1` -- hard cut -- while B reads the default
`lifeT/0.3 < 1`, so they DIVERGE on a leak) AND that the shared value is strictly `< 1` (non-vacuous). This
is a `lastAlpha` snapshot comparison, NOT a `canvas.hash`/`alphaHash` replay (both are lifetime-cumulative
and cannot re-hit a baseline).

## Consequences / proof

- One new per-particle pool column: `fadeOut` (Float32, the death-fade window fraction); +4 B/particle, always
  written at spawn. The render family (align + spin0 + spinRate + scaleTo + tilt0 + flutterRate + fadeIn +
  fadeOut) now totals `32 B/particle`; the always-on SoA total is `38xF32 + 2xU8 = 154 B/particle`.
- NO harness change -- reuses v1.19.0's `alphaHash`/`lastAlpha` accessor (crux (c)). This is the point.
- New committed constant `FADEOUT_HASH` (`587626480`), probed with `fadeOut: 0.6`, cross-process stable and
  distinct from the off-look alphaHash (`2389639168`) and from `fadeOut: 0.1`.
- Off-identity preserved bit-for-bit: at the default (and explicit `0.3`) the off-look alphaHash `2389639168`
  reproduces, and the v1.19.0 `ALPHA_HASH 3712788104` (fadeIn:0.4, default fadeOut) reproduces -- the
  double-0.3 death-fade line was not touched. COMMITTED_HASH `1569828004` and all nine prior fingerprints
  reproduce at fadeOut default / 0 / 0.1 / 0.6 / 1 / 1e9 / -1.
- Pure-overlay proof: `fadeOut` in [0, 0.1, 0.6, 1] reproduces the off run's position `hash`, `rotateHash`,
  `scaleHash`, `strokeHash`, and `colorHash` EXACTLY; only `alphaHash` differs. Non-vacuous via `lastAlpha`
  at a late frame (`lifeT approx 0.15`): default approx `0.5` (`0.15/0.3`), `fadeOut:0.6` approx `0.25`
  (gentler = dimmer earlier), `fadeOut:0` exactly `1` (hard cut).
- Envelope composition: `{fadeIn:0.4, fadeOut:0.6}` reproduces COMMITTED_HASH (positions untouched by either)
  with an `alphaHash` distinct from fadeIn-only AND fadeOut-only -- both act and multiply.
- Torture: t5 fuzz threads a random `fadeOut` (half at the default, else `[0,1]`) through burst AND spray on
  the `alphaHash` differential; t6 adds a death-fade live pool lane (`fadeOut:0.8` + `flutter:1`) at ~0
  B/frame; t1 poisons `fadeOut` (NaN / +-Infinity / non-numeric / null / {} -> default; legal extremes 0,
  -5 -> 0, 1e-9, 1, > 1 -> 1) under turbulence + wind + a bouncing box + trails; t3 A11 proves a recycled
  slot does not leak a stale `fadeOut` via the late-frame `lastAlpha` witness (crux (d)).
- Unit suite 215 -> 226 (+11). t7/t8/t9 unchanged: no shared or global state was added.

## Explicitly NOT done

- An ease curve `fadeOutEase` (linear in `lifeT` only, matching fadeIn / lifeColors / scaleTo).
- A two-endpoint alpha keyframe list or an alpha envelope object (one death-side scalar only, mirroring the
  single-endpoint fadeIn). The opacity axis is now CLOSED with two single-endpoint scalars.
- A death-opacity FLOOR (dissolve to some alpha > 0) -- the terminal is always 0, matching fadeIn's birth 0.
- Per-particle fadeOut jitter / a range (one burst-wide scalar; a range costs an rng draw).
- Trail opacity INDEPENDENT of the body (the ribbon shares the body `alpha` by design -- crux (b)).
- Alpha on the reduced-motion static path (the constant 0.85 is deliberately untouched).
- Any new harness probe -- `fadeOut` reuses v1.19.0's `alphaHash`/`lastAlpha` (crux (c)).
- Any pool.x/y/v mutation, physics change, spawn-time rng draw, or change to the default look / presets /
  trail geometry / color / emit / stagger / align / spinRate / scaleTo / flutterRate / fadeIn overlays, or
  any committed position/rotate/scale/stroke/color fingerprint when fadeOut is at its default.
