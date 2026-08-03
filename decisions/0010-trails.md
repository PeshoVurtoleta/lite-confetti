# 0010 -- trails / ribbons (the first render-path feature)

- **Status:** accepted (implemented in v1.9.0)
- **Date:** 2026-08-02
- **Session:** F8, the feature release after F7 (v1.8.0 turbulence + gust). Where 0005-0009 all
  extended the PHYSICS (wind, floor, walls, ceiling, turbulence, gust), this is the first feature
  that touches the RENDER path instead.

## Context

By v1.8.0 the force model is complete in space and time: `gravity`, `wind`, `drag`, a full
reflecting bounding box, and the time-varying `turbulence` + `gust`. Every chapter so far moved
particles differently; none changed how a particle is DRAWN. This chapter adds motion **trails**:
each particle leaves a fading ribbon through its recent world positions, so a fast burst reads as
motion streaks instead of hard dots.

Trails are a different KIND of feature -- the interesting engineering is not physics but (a) a
zero-GC store of past positions and (b) proving that a render overlay leaves the deterministic
physics fingerprint untouched.

## Decisions

1. **Trails / ribbons, chosen over vortex/attractor, emitter shapes, or settle-and-pile.** Offered
   four directions on four different axes (force / render / spawn / behaviour); the render axis was
   picked. It is the first feature that is provably fingerprint-neutral by CONSTRUCTION rather than
   by a guarded branch, which is a distinct and worthwhile property to establish. (Vortex/attractor
   remains a candidate future force chapter; emitter shapes would be a spawn-side chapter that mints
   new fingerprints; settle-and-pile a behaviour chapter.)

2. **Pure render overlay -- the load-bearing property.** The determinism `hash` (test/_env.mjs) is
   fed ONLY by `translate(x, y)`, the per-particle BODY transform. The ribbon is therefore drawn in
   WORLD space via `beginPath` + `moveTo`/`lineTo` + `stroke` -- deliberately NO `translate` -- and
   it READS (never writes) `x/y/vx/vy`. Consequences:
   - The position hash cannot move. A trailed burst reproduces the EXACT committed physics hash of
     an untrailed one at ANY depth. All prior fingerprints are preserved with no new guard needed:
     default `1569828004`, mixed `3132631460`, wind `2385225781`, floored `2679696825`, box
     `804161759`, turbulence `1630588936`, gust `4074438162`, both `15761758`.
   - The NEW committed gate is the trail GEOMETRY itself: a mock-ctx `strokeHash` accumulated only
     on `stroke()` (shapes `fill()`, never `stroke()`, so it is trail-only) and kept out of the
     position hash, exactly like the `sumX`/`maxY` probes. Committed `TRAIL_HASH = 72519212` on the
     seed-12345 rig at capacity 10 (the flat single-stroke value; see decision 7 for the taper that
     briefly changed this and was reverted).

3. **Capacity is a CONSTRUCTION option; length is per-burst.** A zero-GC ring buffer cannot grow
   lazily, so its depth (the CAPACITY) must be fixed once, at `createConfetti(canvas, { trail: N })`.
   The per-burst `trail` (`0..N`, default `N`) is only the DRAW LENGTH -- it shortens or opts a burst
   out, never enlarges the buffer. This split is honest about the constraint (you cannot ask for a
   deeper trail than you budgeted) while still allowing per-burst variation and a live demo slider
   with no instance rebuild. On a budget-less instance a per-burst `trail` is ignored (fail-closed,
   no throw). Both were confirmed via AskUserQuestion (construction + per-burst; flat-alpha ribbon).

4. **Zero-GC fixed ring buffer, allocated once.** `trailX` / `trailY` are `Float32Array`s of
   `maxParticles * capacity`, plus two `Uint8Array` per-particle columns: `trailN` (live sample
   count) and `trailLen` (per-burst draw length). All four allocate ONLY when `trail > 0`, so a
   default instance pays zero extra bytes. A single global `_trailHead` cursor advances one integer
   per frame (all alive particles append to the same ring slot that frame); it is read only inside
   trail code, so it cannot perturb any fingerprint. Recording is TypedArray stores + one increment;
   the ribbon is per-segment `stroke()` calls (see decision 7) -- all allocation-free (torture T6).

5. **Fail-closed reset on pool reuse -- the correctness subtlety.** When a pool slot is recycled, its
   ring cells still hold the DEAD particle's positions. `spawn()` resets `trailN[i] = 0`, and the
   draw only ever reads the last `trailN` samples, which grow only as the NEW particle writes fresh
   ones -- so a dead particle's trail can never leak into a live one. (This is why a per-particle
   live count is needed rather than clearing the whole ring on spawn: clearing would be O(capacity)
   work per spawn; the counter is O(1) and never reads a stale cell.)

6. **Record AFTER all position mutations.** The sample is written after integrate + floor + ceiling
   + sway + walls, so the stored point equals exactly where the body draws that frame -- the ribbon
   terminates at the particle, not one clamp behind it.

7. **Flat-alpha single-stroke ribbon** (the shipped look, after a taper detour). The ribbon is one
   `stroke()` per particle at a uniform `globalAlpha = bodyAlpha * TRAIL_ALPHA` and uniform width,
   drawn oldest -> newest. `colors[i]` (already parsed) is the `strokeStyle`; zero allocation.
   `TRAIL_ALPHA = 0.5`, `TRAIL_WIDTH = 0.55`.
   - *The taper detour (1.9.0 -> reverted 1.10.0):* a demo screenshot looked like an opaque
     horizontal "smear", read as overlapping trails stacking to opaque. The fix chosen at the time
     was a per-segment "comet" taper (alpha + width fading to a transparent tail, `n-1` strokes per
     particle, `TRAIL_HASH` re-probed to `660640570`). But the smear turned out to be a misconfigured
     `floor` (particles piling up), NOT the trail -- and the taper's transparent tail made the whole
     ribbon too faint to see on the dark demo. So the taper was reverted to this flat-alpha stroke:
     `strokeHash` returns to `72519212`, and the demo slider/capacity go back to 24. Lesson recorded:
     diagnose the actual cause (here, an option the user had set) before changing a renderer.
   - A `createLinearGradient` taper was (and remains) rejected regardless: it allocates a gradient
     object per particle per frame, breaking the zero-GC law.

8. **Fail-closed coercion + a hard cap.** Construction capacity:
   `Math.min(TRAIL_MAX, Math.floor(nonneg(trail, 0)))` -- `TRAIL_MAX = 64` bounds the one-time
   allocation so a typo (`trail: 1e9`) cannot request a gigabyte; non-finite/negative -> 0 (off).
   Per-burst length: `undefined` inherits capacity; otherwise `min(capacity, floor(nonneg(trail,
   capacity)))` so garbage inherits full, `0` opts out, over-large is capped.

9. **No reduced-motion effect.** The static render (`renderStaticBurst`) does no integration and
   records no history, so it strokes no trails -- consistent with every other motion feature.

## Consequences / proof

- Unit suite 113 -> 122. New `describe('trails / ribbons')` asserts: off-by-default (strokes 0,
  hash == COMMITTED_HASH); the PURE-OVERLAY proof (trails on leaves default/floored/box hashes
  intact at depth 10 and 64); fail-closed capacity (NaN/-5/Infinity/string/null -> off, 1e9 ->
  capped 64 == explicit 64); committed `TRAIL_HASH` (non-vacuous strokes > 0, deterministic replay,
  depth 4 vs 10 differ); the per-burst override (0 opts out, a shorter length differs and matches a
  same-capacity construction instance); budget-less-instance ignore; finite-under-forces (trails +
  turbulence + gust + wind in a tight bounce box, still contained); spray honours trails; and
  reduced-motion inert.
- Torture: T5 gives BOTH fuzz instances a trail capacity and threads a per-burst `trail`, checking
  `strokeHash` equality alongside the position hash (the ring buffer + global head are deterministic
  across instances). T6's mixed lane (full pool, shapes[] + wind + full box + turbulence/gust) is
  built with `trail: 16` so every alive particle records AND strokes every frame -- still ~0 B/frame.
  T1 adds construction- and per-burst-trail poison under the assertFinite finite-position detector
  (the mock's `moveTo`/`lineTo` are finiteness-checked too, so a NaN trail point is a hard throw).
- Full gate matrix green: 122 unit; torture ok / BREAK exit 1 / CONTROL=alloc exit 1 / SEED ok;
  ASCII clean; npm pack 1.9.0.

## Explicitly NOT done (flagged for a future chapter, if ever)

- **Filled tapering quad-strip** (a solid ribbon whose polygon narrows along the trail) -- the shipped
  taper narrows a stroked line's width/alpha per segment, which reads well; a true filled quad-strip
  would need per-segment polygon math for marginal gain.
- **Per-burst trail CAPACITY** (a deeper ring than the instance was built with) -- impossible under
  zero-GC without a lazy realloc; capacity is deliberately a construction-time budget.
- **Additive/`globalCompositeOperation` glow trails, per-stop gradient ribbons, velocity-scaled
  trail length** -- rendering flourishes beyond a plain deterministic ribbon.
- Any change to the default look, existing presets, the physics integrator, or any committed
  physics fingerprint.
