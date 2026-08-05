# 0013 -- color-over-life (`lifeColors`, the second RENDER feature)

- **Status:** accepted (implemented in v1.12.0)
- **Date:** 2026-08-05
- **Session:** F11, the release after F10 (v1.11.0 settle). Where 0005-0009 extended the PHYSICS,
  0010 opened the RENDER path (trails), 0011 added the first DIRECTED force (vortex), and 0012 added
  the first BEHAVIOUR feature (settle), this is the SECOND feature on the RENDER axis -- it changes
  how a particle is COLORED over time, not how it moves, ends, or is shaped.

## Context

Until now a piece was painted ONE flat `colors[i]` string from birth to death. `colors` varies the
palette ACROSS pieces but never WITHIN a piece's life. This chapter adds **color-over-life**: the
BODY of each piece sweeps a multi-stop OKLCH `lifeColors` ramp as it ages -- sparks cooling
white -> orange -> red, embers dimming, a firework tail shifting hue.

The interesting engineering is not a new force but making per-particle time-varying color
zero-allocation on the hot path, AND proving it is a pure overlay (it must not perturb any committed
position fingerprint) with a probe that can still SEE the color changing.

## Decisions

1. **Multi-stop `lifeColors` ramp, chosen over a single `fadeTo` target.** Confirmed via
   AskUserQuestion (offered `fadeTo` vs `lifeColors`). A single-target fade is expressible as a
   two-stop `lifeColors` (`[spawnColor, fadeTo]`), so the multi-stop form subsumes it while also
   covering the flagship spark/ember case (white -> orange -> red -> black). `lifeColors` is an
   ordered list of >= 2 OKLCH stops, birth-color first.

2. **Baked LUT of CSS strings, indexed by life -- the load-bearing property.** The color model was
   already "pre-parse OKLCH objects to CSS strings ONCE per burst, then `fillStyle = colors[i]` --
   never `toCssOklch()` per frame". Per-particle time-varying color must keep that discipline: the
   ramp is baked ONCE per burst into a fixed-resolution LUT (`RAMP_N = 32` CSS strings) via
   lite-color's `bakeCssGradient(stops, RAMP_N)`, and the render loop indexes it by the piece's life
   fraction (`step = clamp(floor((1 - life/maxL) * (RAMP_N-1)))`, birth = stop 0, death = last). The
   hot path is a pure array read -- no per-frame color math, no allocation. OKLCH interpolation is
   the house style and free (`bakeCssGradient` interpolates OKLCH stops), so it was not a question.

3. **Pure color overlay -- no rng draw, no position touched.** The render-axis analog of trails. The
   ONLY hot-path change is which string `fillStyle` gets; `colors[i]` is STILL picked per particle
   (one `rng.pick`, unchanged), so the spawn rng sequence -- and therefore EVERY committed position
   fingerprint -- is byte-identical whether `lifeColors` is on or off. A `lifeColors` burst even
   reproduces the same-seed plain burst's position hash exactly (default `1569828004` etc. all
   preserved). This is stronger than "byte-identical when off": color-over-life is invisible to the
   position fingerprint by construction.
   - **A probe was needed to test it.** Because color never enters the position `hash`, the mock
     canvas gained a `colorHash` that folds `fillStyle` at each body paint (`fill`/`fillRect`/
     `fillText`), kept ENTIRELY out of the position `hash` (like `strokeHash`/`sumX`). A `lifeColors`
     burst's `colorHash` differs from the plain burst's (`COLOR_HASH 2406267552`), while its position
     hash is unchanged -- the two-sided proof.

4. **Trail stays the flat base color, over a gradient ribbon.** Confirmed via AskUserQuestion. The
   ribbon keeps drawing the flat `colors[i]`; only the BODY sweeps the ramp. This matches the
   per-segment trail alpha taper that was tried in v1.9.0 and deliberately REVERTED in v1.10.0 -- the
   trail is a simple flat overlay. Proven by a test: a `trail` + `lifeColors` burst reproduces the
   plain trail's committed `strokeHash` (`72519212`) exactly.

5. **The palette `colors` keeps its role.** `colors` is still picked per particle and is (a) the flat
   TRAIL color and (b) the body color when `lifeColors` is off. When `lifeColors` is on, all pieces
   share ONE baked ramp on the body -- so a spark burst cools uniformly regardless of palette, and
   variety comes from pieces being at different life phases. Keeping the `colors` pick also means
   `lifeColors` never removes an rng draw (decision 3).

6. **Fail-closed bake.** `buildLifeRamp(lifeColors)` returns `null` (=> the body paints the flat
   `colors[i]`, NOT the default rainbow) for a non-array, fewer than two stops, or any stop that is
   not a finite OKLCH triple. Crucially, `parseOklch` THROWS on an unparseable string, so the whole
   bake is wrapped in `try/catch -> null` -- a garbage stop can never crash a burst. Bake runs once
   per call, off the hot path (like the existing `parsedColors` pre-parse).

7. **Fail-closed reset on pool reuse.** `spawn()` always assigns `colorRamp[i] = config.lifeRamp`
   (the shared LUT or null), so a recycled slot can never inherit a prior burst's ramp -- the exact
   analog of the `landed = 0` (0012) and `trailN = 0` (0010) spawn resets. The render guard is a
   truthy check (`ramp ? ramp[step] : colors[i]`), so both null (off) and undefined (never spawned)
   fall through to the flat color.

8. **No reduced-motion effect.** The static render (`renderStaticBurst`) does no life integration, so
   there is no life fraction to index -- it paints the flat color, consistent with every motion/render
   feature.

## Consequences / proof

- Unit suite 141 -> 149. New `describe('color / lifeColors')` asserts: the PURE-OVERLAY headline (a
  `lifeColors` burst reproduces `COMMITTED_HASH` exactly); the committed `COLOR_HASH = 2406267552`
  (distinct from the plain body color, deterministic on replay); opt-in / fail-closed
  (omitted/`[]`/one-stop/null/string/non-array/non-finite-stop/unparseable-string all paint the flat
  color AND keep `COMMITTED_HASH`); NON-VACUOUS ramp sweep (a high-contrast ramp's `colorHash` at few
  frames differs from many frames -- the body color moved along the ramp as pieces aged); the FLAT
  TRAIL guard (`trail` + `lifeColors` reproduces the committed `strokeHash 72519212` and position
  hash); `assertFinite` under `lifeColors` + gravity in a box; spray honours `lifeColors` (pure
  overlay); reduced-motion inert.
- Torture: T5 threads a random `lifeColors` ramp (half off, 2-3 OKLCH stops) through the differential
  fuzz (color is deterministic and off the physics path, so two same-seed instances stay
  bit-identical). T6 arms `lifeColors` on the mixed lane so every vector particle indexes the LUT
  (`ramp[step]`) every frame while the sprite skips it via blit -- still ~0 B/frame (the LUT is baked
  once at burst). T1 adds `lifeColors` poison (`NaN` / non-array / `[]` / one-stop / non-finite stop /
  unparseable string) under the finite-position detector -- `buildLifeRamp` fails closed, nothing
  crashes, no NaN reaches a draw.
- Full gate matrix green: 149 unit; torture ok / BREAK exit 1 / CONTROL=alloc exit 1 / SEED ok;
  ASCII clean (oklch() strings are ASCII); npm pack 1.12.0.
- Cost: one per-particle `Array` column (`colorRamp`, a ref/null); a small per-burst LUT
  (`RAMP_N = 32` strings) baked once; one branch + one array read per vector particle per frame.

## Explicitly NOT done (flagged for a future chapter, if ever)

- **Single-`fadeTo` shorthand** -- `lifeColors: [spawnColor, fadeTo]` already expresses it; a
  dedicated `fadeTo` knob is redundant sugar.
- **Per-particle ramp offset / jitter / phase** -- all pieces share one ramp; per-particle variety
  would need an extra column + an rng draw (which would shift the position fingerprint) for marginal
  gain.
- **Gradient trail ribbon** -- the flat-trail decision (4); a per-segment color sweep re-opens the
  reverted v1.9.0 taper complexity.
- **Per-shape / per-emoji ramps, or an ease curve on the ramp index** -- the ramp is a burst-wide
  knob indexed linearly by life, matching every prior force/render knob.
- **Ramp driven by anything but life fraction** (speed, height, distance) -- life is the natural,
  already-computed parameter; other drivers are separate features.
- Any change to the default look, existing presets, the physics integrator, the trail geometry, or
  any committed position/trail fingerprint.
