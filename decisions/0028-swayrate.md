# 0028 -- swayRate: the SPEED knob to sway's DEPTH

- **Status:** accepted (implemented in v1.27.0)
- **Session:** F27, the release after F26 (v1.26.0 pool drop-when-full). One opt-in scalar; no
  behaviour change on any path when off. Closes the last depth-tunable-but-speed-hardcoded oscillator.

## Context

`sway` (v1.3.0) is a per-particle horizontal OSCILLATION -- `x += sin(tilt) * sway * SWAY_PX * dt`
(`SWAY_PX = 60`), guarded `if (pool.sway[i] !== 0)`. Its DEPTH is tunable (`sway: 0..1`) but its
FREQUENCY has been hardcoded to whatever `pool.tilt` advances at since it shipped. So a lazy
paper-drift and a fast shimmy-drift were the same knob.

`swayRate` is the SPEED knob to that DEPTH -- the third and final member of the house speed-knob family:

```
flutter : flutterRate  (v1.18.0, render wobble)
gust    : gustRate      (v1.25.0, physics breeze)
sway    : swayRate      (v1.27.0, physics drift)  <- this chapter
```

After it, every oscillator with a tunable amplitude (flutter, gust, sway) has a tunable frequency.

## Decisions

1. **One scalar `swayRate`, default 1.** One new `Float32Array` column `swrate`, +4 B/particle
   (174 -> 178 = 44 x Float32 + 2 x Uint8). A PHYSICS column (moves position), so the README alloc
   row inserts MID-table and shifts every subsequent running total +4; it does NOT bump the
   render-family "unlike those N" count (it is a fifth PHYSICS column, beside friction/wallFriction/
   spinDrag/gustRate).

2. **Coercion `num(swayRate, 1)`** -- the SAME signed helper flutterRate/spinRate/gustRate use. A
   frequency has a SIGN (negative = phase reversal, a real direction), so `num`, NOT `clamp01`/`nonneg`.
   Non-finite / non-numeric / undefined -> `1` (off). No upper cap (fast shimmy is legal; t1 pins 1e6
   finite). Default `1` is Float32-EXACT, so **NO fround sentinel** (contrast gustRate's
   `Math.fround(GUST_HZ)` -- GUST_HZ is not Float32-exact; `1` is). This is the flutterRate archetype.

3. **Read stays INSIDE the existing `if (pool.sway[i] !== 0)` guard.** swayRate modifies an
   already-opt-in branch; when sway is off (the DEFAULT), `swrate` is NEVER read and the branch is
   never entered. So a burst with `sway` off reproduces COMMITTED_HASH 1569828004 for ANY swayRate.
   INERT when sway is 0 -- the exact analog of flutterRate being inert when flutter is 0.

4. **Off path is the shipped line, verbatim.** The block mirrors the flutterRate off-guard:
   ```js
   if (pool.sway[i] !== 0) {
       let swayPhase = pool.tilt[i];
       if (pool.swrate[i] !== 1) {
           const t0 = pool.tilt0[i];
           swayPhase = t0 + (pool.tilt[i] - t0) * pool.swrate[i];
       }
       pool.x[i] += Math.sin(swayPhase) * pool.sway[i] * SWAY_PX * dtSec;
   }
   ```
   At `swrate === 1` the inner guard is skipped, `swayPhase === pool.tilt[i]`, and the write is
   `Math.sin(pool.tilt[i]) * pool.sway[i] * SWAY_PX * dtSec` -- BYTE-for-BYTE the pre-1.27.0 line.
   The default path never computes `t0 + (tilt - t0)` (floating-point re-association would drift
   SWAY_HASH); the `!== 1` guard is load-bearing exactly as flutterRate's is.

5. **Spawn write UNCONDITIONAL and LOAD-BEARING.** `pool.swrate[i] = config.swayRate;` beside the
   sway spawn write. A Float32 zero-init `0` would mean "frozen sway phase" (a constant lean) on a
   recycled slot whose sway IS armed -- a WRONG default (off is `1`, not `0`). The
   flutterRate/gustRate/scaleFrom load-bearing case, NOT the friction case (whose `0` default
   coincides with off). The t3 symmetric-history retention proof pins it.

6. **`pool.tilt` / `pool.tilt0` are NEVER written.** swayRate READS tilt (for the local phase) and
   tilt0 (a read-only birth constant flutterRate already reads); it writes neither. So the turbulence
   curl phase (`tp = tilt*1.7 + spin`) and the flutterRate wobble stay byte-identical. swayRate is
   DECOUPLED from turbulence, sway-depth, and flutterRate.

7. **burst AND spray; inert under reduced motion.** `renderStaticBurst` runs no integrator, so the
   sway term never fires on the static path -> swayRate is inert there (like sway itself).

## The crux -- the cleanest physics knob in the suite, riding a NEWLY-established baseline

Three facts, all PROVEN not asserted:

**(a) It REWRITES a committed integrator expression -- but that expression had no committed hash.**
The sway line is a live physics write, but sway is off by default so no shipped fingerprint exercised
it (no preset uses sway; the only sway unit tests asserted RELATIVE equality between two armed
variants, never the absolute value). So the chapter's FIRST act was to establish
`SWAY_HASH = run({ sway: 1 }).hash` on the canonical rig from HEAD (v1.26.0), so the rewrite's
off-branch (`swrate === 1`) is falsifiably byte-identical. This is the ONLY chapter to date whose
off-proof baseline did not already exist -- it was minted BEFORE the edit, not after.
**Pinned: `SWAY_HASH = 1887116762`.**

**(b) Zero second-reader / genuinely provable purity.** `pool.sway` is read in EXACTLY one place and
`pool.swrate` too; both feed only `x -> position hash + sumX`. swayRate reads `tilt`/`tilt0`
read-only and writes nothing but `x`. No rotate, no scale, no alpha, no color, no rng, no trail (the
ribbon samples post-write x, same as today). So a sway-armed rig with swayRate set moves ONLY `hash`
+ `sumX`; `rotateHash`/`scaleHash`/`alphaHash`/`colorHash`/`strokeHash` are byte-identical. UNLIKE
spinDrag (whose `pool.spin` had a second reader in the turbulence curl), there is no hidden coupling
path -- position IS the sole witness. The first physics-speed knob after gustRate to also add ZERO
harness surface (rides the existing `hash` + hash-neutral `sumX`; no `_env.mjs` change).

**(c) `swayRate: 0` is a FROZEN LEAN, not an inert-zero (the gustRate contrast).** gust's phase is
`_elapsed * gustRate` (absolute), so `gustRate:0 -> sin(0) = 0`, inert. sway's phase is
`tilt0 + (tilt - tilt0) * swayRate`, so `swayRate:0 -> swayPhase = tilt0`, giving
`x += sin(tilt0) * sway * SWAY_PX * dt` -- a per-particle CONSTANT non-zero lean (varied by the
random birth tilt). So `run({ sway:1, swayRate:0 }).hash = 1963198227` is a DISTINCT, reproducible
fingerprint, NOT COMMITTED_HASH and NOT SWAY_HASH. This mirrors flutterRate:0 (frozen wobble at the
birth pivot) one-for-one.

## Consequences / proof

- New baseline `SWAY_HASH = 1887116762` (`run({ sway:1 })`, canonical rig, pinned from HEAD). Every
  swayRate=1 (default, and every fail-closed input -> 1) reproduces it bit-for-bit; and
  `run({ sway:1, swayRate:1 }).hash === SWAY_HASH`.
- New armed hash `SWAYRATE_HASH = 3473529279` (`run({ sway:1, swayRate:3 })`) -- cross-process stable,
  DISTINCT from SWAY_HASH and from the frozen-lean `1963198227` (`swayRate:0`).
- Sway-off short-circuit: `run({ swayRate:X }).hash === COMMITTED_HASH 1569828004` for X in
  {3, 0, -3, 1e6} (sway:0 -> swrate unread).
- Second-reader purity: `run({ sway:1, swayRate:3 })` moves ONLY hash/sumX vs `run({ sway:1 })`;
  rotate/scale/alpha/color/stroke streams byte-identical.
- Every prior committed fingerprint reproduces bit-for-bit at the default swayRate: COMMITTED, WIND,
  FLOOR, BOX, TURB, GUST, TURBGUST, GUSTRATE, TRAIL, SETTLE, COLOR, ALIGN, SPINRATE,
  SPINDRAG(_ROT/_TURB), SCALE, SCALEFROM, FLUTRATE, ALPHA, FADEOUT, FRICTION, WALLFRICTION.
- Fail-closed: t1 poisons NaN/+-Infinity/'3'/null/{} -> 1 (off); legal extremes 0, -3, 1e-9, 1e6
  under sway + wind + turbulence + a bouncing box, all finite.
- Retention (t3): a recycled slot does not leak a stale `swayRate`, proven with a SYMMETRIC-history
  WINDOWED sumX-delta (the lastScale/lastAlpha witness rule, NOT a cumulative-from-zero compare): a
  slot previously armed `swayRate:3`, recycled for a DEFAULT-swayRate burst over an identical drain
  history, yields the SAME windowed sumX delta as a fresh default-only instance; a still-armed
  instance's delta differs (non-vacuous).
- Alloc: one new Float32 column, no hot-path allocation (a guarded read + compare + one sin on
  Float32s already in cache). t6 sway-swept immortal-pool lane (`sway:1, swayRate:3, wind:400`) at
  <= RETAIN_FLOOR_BPF, SOAK 10000-frame window maxMajor 0.
- Unit suite 285 -> 296 (+11).

## Explicitly NOT done

- `turbulenceRate` -- turbulence's phase mixes the shared clock with per-particle tilt/spin (a second
  reader); a rate knob would re-run the spinDrag hybrid-coupling crux for a noisier, less legible effect.
- `trailAlpha` / `trailWidth` -- a NEW `_env.mjs` probe for a cosmetic overlay; no hash-neutral witness.
- A sway PHASE OFFSET, a non-sinusoidal sway waveform, or per-particle sway phase -- one scalar per
  chapter; sway stays a single sine whose only new knob is its frequency.
- An ease curve on the sway swing -- linear frequency scale only.
- Applying swayRate to flutter's or turbulence's rate -- those are separate axes with their own knobs.
- `spinFriction`, per-particle mass / size-dependent drag, `spinRange` -- re-deferred from 0025/0026.
- Any change to the default look, presets, `SWAY_PX`, or ANY committed fingerprint (position / rotate
  / scale / stroke / color / alpha) when swayRate is at its default.
