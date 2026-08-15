# 0026 -- gust swell frequency (`gustRate`, the SPEED knob to `gust`'s depth)

- **Status:** accepted (implemented in v1.25.0)
- **Session:** F25, the release after F24 (v1.24.0 scaleFrom). scaleFrom closed the last unbracketed RENDER
  axis (SCALE: birth `scaleFrom` + death `scaleTo`). This chapter closes the last DEPTH-tunable-but-
  SPEED-hardcoded living-air force: `gust` had a tunable amplitude since v1.8.0 but a baked frequency.
  `gustRate` is the swell-speed knob, the exact mirror `gust:gustRate :: flutter:flutterRate`.

## Context

Since v1.8.0 `gust` has layered a single GLOBAL sinusoidal horizontal acceleration on wind -- a coherent
breeze that swells the whole pool together. Its DEPTH is per-particle and tunable (`gust: 400`), but its
FREQUENCY has been hardcoded from the day it shipped:

```js
const GUST_HZ = TAU / 3;   // ~3s swells; GUST_HZ = 2.0943951023931953
if (pool.gust[i] !== 0) pool.vx[i] += Math.sin(_elapsed * GUST_HZ) * pool.gust[i] * dtSec;
```

So the swell SPEED -- how fast the breeze rises and falls -- was unreachable: a fast shimmer-gust and a
slow ocean-swell were the same knob. This chapter adds **`gustRate`**: an opt-in scalar, default `GUST_HZ`
(off), that parameterizes the baked frequency. `gustRate: 6` triples the swell rate; `0.5` is a long ocean
roll; `0` freezes the phase (the gust force collapses to `sin(0)=0`, inert -- the frequency analog of
`gust:0`); a NEGATIVE reverses the phase (`sin(-r*t) == -sin(r*t)`, the breeze leans the other way first).

It mirrors `flutterRate` (v1.18.0) one-for-one: a signed speed scalar over a baked phase constant. `gust`
was the last living-air force with a tunable depth and a literal speed.

## Decisions

1. **One scalar `gustRate`, default `GUST_HZ`.** One new `Float32Array` pool column (`grate`), +4 B/particle
   (170 -> 174 = 43 x Float32 + 2 x Uint8). The column is declared immediately after `gust` (a PHYSICS
   column, NOT a render-family column), so the README alloc-table row inserts MID-table and shifts every
   subsequent running total +4.

2. **Coercion `num(gustRate, GUST_RATE_DEF)`** -- the SAME signed helper `flutterRate` uses. A frequency has
   a SIGN (negative = phase reversal, a real direction, like reverse spin), so it is `num`, NOT
   `nonneg`/`clamp01`. Non-finite / non-numeric / undefined -> `GUST_RATE_DEF` (off). `0` is a legitimate
   finite value (frozen phase -> inert gust). No upper cap (a fast shimmer is legal; t1 pins 1e6 finite).

3. **fround sentinel `GUST_RATE_DEF = Math.fround(GUST_HZ)` -- the crux.** Unlike `scaleFrom`/`flutterRate`
   (default `1`, Float32-exact, no sentinel), `GUST_HZ = TAU/3 = 2.0943951023931953` is NOT Float32-exact
   (`Math.fround(GUST_HZ) = 2.094395160675049 !== GUST_HZ`), so a stored default cannot be compared
   `!== GUST_HZ` (that would ALWAYS fire and move the committed hash). This is the `FADE_OUT_DEF =
   Math.fround(0.3)` pattern (Confetti.js). `Math.fround` is idempotent, so the Float32 `grate` column stores
   `GUST_RATE_DEF` and reads it back EXACTLY, and the off-branch substitutes the DOUBLE `GUST_HZ` literal:
   ```js
   const gr = pool.grate[i];
   pool.vx[i] += Math.sin(_elapsed * (gr === GUST_RATE_DEF ? GUST_HZ : gr)) * pool.gust[i] * dtSec;
   ```
   Do NOT store the raw double and compare against it; do NOT drop the sentinel "because flutterRate did".

4. **Spawn write UNCONDITIONAL and LOAD-BEARING.** `pool.grate[i] = config.gustRate;` at spawn. A Float32
   zero-init `0` would mean "frozen phase" (inert gust) on a recycled slot whose gust IS armed -- a WRONG
   default. This is the `scaleFrom`/`scaleTo`/`fadeOut`/`spinDrag` load-bearing case (the write carries a
   NON-zero default), NOT the `friction`/`wallFriction` case (whose `0` default coincides with off). The t3
   A16 symmetric-history retention proof pins it.

5. **The grate read stays INSIDE the existing `if (pool.gust[i] !== 0)` guard.** gustRate modifies an
   already-cold branch; when gust is off (default), `grate` is NEVER read and the branch is never entered.
   So a burst with `gust` off reproduces COMMITTED_HASH for ANY gustRate. The grate read is NOT hoisted
   above the gust guard.

6. **burst AND spray; inert under reduced motion.** `renderStaticBurst` runs no update loop, so the static
   path is untouched (`staticHash` unchanged).

## The crux -- bit-identity-when-off via a fround sentinel on a transcendental default, riding a rewrite of a committed PHYSICS expression

Three facts, all PROVEN not asserted:

**(a) It REWRITES a committed integrator expression, not a new guarded branch.** This is the first PHYSICS
chapter to edit a shipped `update()` expression (the gust vx term) since gust itself. Two committed
fingerprints ride this exact term: `GUST_HASH 4074438162` (`gust: 400`) and `TURBGUST_HASH 15761758`
(`turbulence: 500 + gust: 400`). Bit-identity when off depends ENTIRELY on the fround sentinel (decision 3):
the off-branch must evaluate `Math.sin(_elapsed * GUST_HZ)` -- the DOUBLE literal, not the Float32
round-trip -- to reproduce those two hashes. Verified across two processes.

**(b) Zero second-reader / position-coupling (genuinely provable).** `pool.grate` is read in EXACTLY one
place (the gust vx term) plus its spawn write. Its only downstream is `vx -> x -> position hash + sumX`.
No trail, no rotate, no color, no alpha, no rng draw. So the position `hash` IS the witness and there is no
hidden second path (contrast spinDrag's `pool.spin`, read a second time by the turbulence curl). Proven two
ways: (i) gust-off short-circuits the read entirely (decision 5) -> COMMITTED_HASH for any gustRate; (ii) a
gust-armed rig moves ONLY `hash`/`sumX`, never rotateHash/colorHash/strokeHash/alphaHash.

**(c) The `gustRate: 0` inert-zero identity, with a -0 caveat.** At `gustRate: 0`, `Math.sin(_elapsed*0) =
Math.sin(0) = 0`, so the term is `vx += 0`. `x + 0 === x` for every float EXCEPT `-0 + 0 = +0`; positions
are hashed through `Math.round(x * 4096)`, so a `-0 -> +0` flip is hash-neutral. Thus `run({gust:400,
gustRate:0}).hash === COMMITTED_HASH 1569828004`, an exact inert-zero witness -- verified EMPIRICALLY before
pinning (the -0 reasoning is sound but cheap to check).

Harness: REUSES `hash` (positions) + `sumX` (drift-direction witness) -- **NO `_env.mjs` change** (the first
physics chapter since gust to add zero harness surface). gustRate changes the gust phase over time ->
different vx trajectory -> different position hash; a NEGATIVE gustRate flips the sign of the early swell ->
opposite `sumX` drift over a fixed window (the non-vacuous witness).

## Consequences / proof

- Committed hash: `GUSTRATE_HASH 870603509` (`run({gust:400, gustRate:6}).hash`, cross-process stable,
  distinct from `GUST_HASH 4074438162` and from `gustRate:3`). At the default (and every fail-closed input
  -> GUST_RATE_DEF) every prior fingerprint including GUST_HASH and TURBGUST_HASH reproduces bit-for-bit.
- Inert-zero (empirical): `run({gust:400, gustRate:0}).hash === 1569828004` (COMMITTED_HASH).
- Gust-off short-circuit: `run({gustRate:X}).hash === COMMITTED_HASH` for any X (gust:0 -> grate unread).
- Second-reader purity: `run({gust:400, gustRate:6})` moves ONLY hash/sumX vs `{gust:400}`; the
  rotate/scale/stroke/alpha streams are byte-identical.
- Non-vacuous sign flip via sumX: over a fixed window, `gustRate:6` and `gustRate:-6` sumX deltas from the
  gust-off baseline have OPPOSITE sign (phase reversal).
- Fail-closed: t1 poisons NaN/+-Infinity/'6'/null/{} -> GUST_RATE_DEF; legal extremes 0, -6, 1e-9, 1e6 under
  gust + wind + turbulence + a bouncing box, all finite.
- Retention (t3 A16): a recycled slot does not leak a stale `gustRate`. Proven with a SYMMETRIC-history
  WINDOWED sumX-DELTA: a slot previously armed `gustRate:6`, recycled for a DEFAULT-gustRate burst over an
  identical drain history, yields the SAME windowed sumX delta as a fresh default-only instance; a
  still-armed instance's delta differs (non-vacuous). A WINDOWED delta, NOT a cumulative-from-zero hash
  compare (canvas.hash/sumX accumulate -- the donewhen-retention-phrasing rule).
- Alloc: one new Float32 column, no hot-path allocation (the term is a guarded read + compare + a sin on
  Float32s already in cache). t6 gust-swept immortal-pool lane (`gust:400, gustRate:6, wind:400`) at ~0
  B/frame, SOAK 10000-frame window maxMajor 0.
- Unit suite 270 -> 281 (+11). t5 threads a random gustRate (half off) through the burst + spray
  differential. t7/t8/t9 unchanged (no shared/global state added; `_elapsed` already exists).

## Explicitly NOT done

- `turbulenceRate` -- turbulence's phase mixes the shared clock with per-particle `tilt`/`spin` (a SECOND
  reader), so a rate knob re-runs the v1.23.0/0024 spinDrag hybrid-coupling crux for a noisier, less legible
  effect. Deferred.
- `trailAlpha` / `trailWidth` -- would force a NEW `_env.mjs` probe for a cosmetic overlay; no hash-neutral
  witness like `lastScale`/`sumX` exists. Deferred.
- A gust PHASE OFFSET, a non-sinusoidal gust waveform, or per-particle gust phase -- one scalar per chapter;
  the gust stays a single shared-phase sine whose only new knob is its frequency.
- An ease curve on the gust swell -- linear frequency scale only.
- Applying `gustRate` to `turbulence`'s or `sway`'s internal rate -- those are separate axes with their own
  (coupled) phases; only the gust term is touched.
- `spinFriction` (contact-only tumble kill) -- re-deferred from 0025: after v1.23.0 `spinDrag`, ambient
  angular decay already bites everywhere; contact-only decay bites on <1% of frames.
- Per-particle mass / size-dependent linear or angular drag -- re-deferred from 0022/0024/0025 (no mass
  concept; an honest version muddies the `drag` fingerprint or pays a per-frame `Math.pow`).
- `spinRange` / per-particle spin-rate range -- re-deferred from 0024/0025 (a spawn-time `spinV` scale is
  `spinRate`'s render scale by another name; a variance variant perturbs the seeded draw).
- Any change to the default look, presets, `GUST_HZ`'s baked value, or to ANY committed fingerprint
  (position / rotate / scale / stroke / color / alpha) when `gustRate` is off.
