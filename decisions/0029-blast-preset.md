# 0029 -- blast: a ready-made half-screen cannon (the reach preset)

- **Status:** accepted (implemented in v1.28.0)
- **Session:** F29, the release after F28 (v1.27.0 swayRate). One new opt-in preset; pure module-level
  DATA, zero engine change, no behaviour change on any existing path.

## Context

A user comparing lite-confetti to canvas-confetti reported it lacked "power" -- confetti could not reach
half a screen from the bottom, "even combining speed with wind." Two facts, both measured on the real
engine (the `minY` reach probe in `test/_env.mjs`), explain the gap:

1. **`wind` is the wrong axis.** `wind` is a purely HORIZONTAL acceleration -- the X-mirror of `gravity`
   (`Confetti.js`: `if (pool.wind[i] !== 0) pool.vx[i] += pool.wind[i] * dtSec`). It drifts a burst
   sideways and contributes ZERO vertical reach. Measured: `speed:1500` alone rises 776px; `speed:1500 +
   wind:600` rises the SAME 776px; `wind:2000` alone rises 163px (the default). Combining speed with wind
   reaches exactly as high as speed alone.

2. **Vertical reach is `speed^2 / (2 * gravity)`, throttled by the per-frame `drag`.** With the default
   straight-up `angle` a piece rises about `speed^2 / (2 * gravity)` px before falling back. The gentle
   default `speed: 400` (gravity 600, drag 0.98) rises only ~160px, which is why the default feels weak
   next to canvas-confetti, whose default launch shoots high in its unit scale. The per-frame `drag: 0.98`
   (~0.30x/sec of velocity retention at 60fps) throttles it further; a looser `drag: 0.995` more than
   doubles reach.

Crucially, **half a screen was already reachable**: `speed: 1200` rises ~590px, `speed: 1500` ~776px on a
1080 screen. Nothing clamps `speed`. So the gap is DISCOVERABILITY, not capability -- the user should not
have to know the reach formula or fight the drag default to get a canvas-confetti-style launch.

## Decisions

1. **Ship a tuned opt-in PRESET, not a default change.** The library's most sacred invariant is the
   committed default fingerprint `1569828004`; raising the default `speed` or loosening the default `drag`
   would rebaseline it and every downstream preset/committed hash -- against library law. A preset is an
   options object spread into `burst()`/`spray()`, pure module-level DATA read once at call time: NO engine
   code path, NO new pool column, NO hot-path allocation. So `1569828004` and every committed hash are
   byte-identical, and the 178 B / 44 Float32 alloc table is unchanged. This is the same class of change as
   any prior preset -- the cheapest possible way to close the gap.

2. **Name `blast`; complements the existing set.** `fireworks` (explosive upward stars), `cannons` (angled
   side launch), `snow` (gentle fall), `pride` (rainbow). `blast` is the straight-up maximum-power cannon --
   the user's word was "power." `presets` now ships FIVE names: { blast, cannons, fireworks, pride, snow }.

3. **Tuning B, measured not guessed.** Candidates fired from a bottom origin (y=1040) on a 1080 screen,
   seed 42, peak RISE above origin:
   ```
   A  speed1200 var180 grav520 drag0.99  spread0.9 life2.6-4.2  ->  902px
   B  speed1300 var200 grav500 drag0.99  spread0.9 life2.8-4.5  -> 1046px   <- chosen
   C  speed1350 var200 grav560 drag0.988 spread1.0 life2.6-4.4  ->  946px
   D  speed1500 var220 grav600 drag0.99  spread1.0 life2.6-4.2  -> 1173px
   ```
   B reaches ~half-to-full screen with ~2x margin over the 540px (half of 1080) bar without flying absurdly
   far offscreen, and settles in ~4.5s. Final object:
   ```js
   blast: {
       count: 120, spread: 0.9, speed: 1300, speedVariance: 200,
       gravity: 500, drag: 0.99, sizeMin: 5, sizeMax: 12,
       lifeMin: 2.8, lifeMax: 4.5, shape: 'rect', angle: -HALF_PI,
   }
   ```
   Measured against the shipped engine: blast rises 1025px, snow 39px, a bare burst 160px (bar = 540).

4. **Documented as a BOTTOM-origin preset.** `speed: 1300` straight up from a top/center origin overshoots
   offscreen. The docs and the JSDoc say to fire it from a bottom origin (`y: innerHeight`), where the high
   reach is the whole point.

## The crux -- the cheapest chapter in the suite

A preset is DATA, so this chapter touches the hot body not at all: no new column, no new branch, no new
alloc, no harness probe. The reviewer/qa surface is therefore about DATA correctness and DISCOVERABILITY,
not integrator purity:

- **Falsifiable reach.** A new unit test fires `{ ...presets.blast, x, y: 1040 }` on an 800x1080 recording
  rig (a `clientHeight: 1080` override drives the engine's cached canvas height, so the bar is a real half
  screen) and asserts `1040 - canvas.minY >= 540`. NON-VACUOUS: `presets.snow` and a bare `burst()` on the
  SAME rig rise BELOW 540, so the bar means something.
- **No new committed hash.** Presets have never been hash-pinned; the house style is a same-seed
  determinism check (equal `count` across two runs). blast follows suit -- a two-run determinism assertion,
  not a `BLAST_HASH`. The reach numbers are asserted as an INEQUALITY (>= 540), not an exact fingerprint, so
  they are robust to trivial float drift while still proving the property the user asked for.
- **The five-name pin moves.** The one test that hard-codes the preset list (`ships the ... documented
  presets`) goes from four names to five (`['blast','cannons','fireworks','pride','snow']`); the range /
  shape / determinism iterators auto-cover blast.

## Consequences / proof

- `presets.blast` clears half a 1080 screen from a bottom origin: measured rise 1025px (>= 540), settles
  ~4.5s. snow (39px) and a bare burst (160px) fall short on the same rig (non-vacuous).
- Committed default fingerprint `1569828004` and EVERY other committed hash reproduce byte-for-byte -- a
  preset adds no engine path. Torture T0..T9 unchanged (no lane added; t5-fuzz already covers arbitrary
  burst param ranges): T6 immortal-pool bytes/frame and the 10000-frame SOAK window (major=0) are
  unmoved.
- Alloc table unchanged at 178 B / 44 Float32 (no pool column added, like the v1.26.0 pool-fix chapter).
- A durable "Reach / power" note lands in README + llms.txt: reach ~= speed^2/(2*gravity); `speed` (with the
  default straight-up `angle`) is the vertical lever; `wind` is horizontal and never adds reach; a looser
  `drag` lengthens the arc.
- Gate: unit suite 296 -> 300 (+4); BREAK exit 1, CONTROL=alloc exit 1, SEED 20260816 exit 0; ASCII clean;
  the forbidden-author grep clean; `npm pack` -> lite-confetti-1.28.0.tgz with README in files[].

## Explicitly NOT done

- **No change to any default** (`speed`, `gravity`, `drag`, `angle`) -- that would rebaseline `1569828004`
  and every committed hash. The gap is closed by an opt-in preset, deliberately.
- **No per-second `drag` rewrite.** The per-frame `drag` is frame-rate-coupled (reach varies with frame
  rate), which is a real latent asymmetry, but converting it to a per-second decay would move EVERY
  committed fingerprint -- out of scope for a discoverability fix.
- **No new `power` / `reach` / `startVelocity` knob.** `speed` already IS the vertical lever; a second knob
  for the same axis would be redundant. The preset plus the reach note is the fix.
- **No change to the existing presets.** `cannons` (grav 920, ~226px reach) stays as-is -- it is a
  deliberately punchy ANGLED side-cannon, not a straight-up reach preset; blast fills that role instead of
  re-tuning cannons and disturbing its look.
- No emit-shape, no color ramp, no trail on the preset -- blast is a plain high-reach rect launch; callers
  compose the rest via the spread.
