# 0011 -- vortex / attractor (a directed point force)

- **Status:** accepted (implemented in v1.10.0)
- **Date:** 2026-08-03
- **Session:** F9, the feature release after F8 (v1.9.0 trails). Where 0005-0009 built the force
  model (wind, floor, walls, ceiling, turbulence, gust) and 0010 was the first render feature,
  this adds the first force aimed at a PLACE.

## Context

Every force so far is either uniform in space (`gravity`, `wind`, `gust`) or per-particle
decorrelated (`turbulence`). None is directed at a point. A vortex/attractor fills that gap: a
per-burst center that pulls, pushes, and spins the burst, so confetti can collapse into a logo,
drain into a hole, or spiral like a galaxy. It was offered (and passed over for trails) in the
previous chapter-selection round, and chosen this session.

## Decisions

1. **Flat scalar options, not a compound object.** `attract`, `swirl`, `attractX`, `attractY`
   (confirmed via AskUserQuestion). Every existing option is a flat scalar with a uniform `num()`
   fail-closed coercion; a compound `vortex: { x, y, strength, swirl }` would be the first
   object-valued burst option and its own nested-coercion path -- a departure with no real payoff.
   The center defaults to the burst origin (`cx`/`cy`), so a bare `attract`/`swirl` needs no extra
   options and spins around where the burst was fired.

2. **Linear-spring (Hooke) law, not inverse-square.** (confirmed via AskUserQuestion.) The radial
   acceleration is `attract * (center - pos)` and the swirl is its perpendicular, so together
   `(at, sw)` apply the matrix `[[at,-sw],[sw,at]]` to the radius vector (pull + rotation -- like
   multiplying the complex radius by `at + i*sw`). The force is ZERO at the center, so there is no
   `1/r` (or `1/r^2`) singularity and no NaN; a pull is a damped harmonic oscillator that, with
   `drag`, spirals inward. An inverse-square "real gravity" law was rejected: it is singular at the
   center and blows up, needing epsilon softening the linear law avoids entirely.

3. **The pull-stable / push-unstable asymmetry, and the `VORTEX_MAX_ACCEL` cap.** The linear spring
   is a double-edged sword: for `attract > 0` the dynamics are `u'' = -attract*u` (a bounded
   oscillator -- stable), but for `attract < 0` (repel) they are `u'' = +|attract|*u` (exponential
   growth -- unstable). An unclamped repeller far from the center could therefore drive a position
   to Float32 `Infinity`, violating the suite's "no non-finite draw position" law. Fix: a
   fail-closed cap on each acceleration COMPONENT (`VORTEX_MAX_ACCEL = 50000`), so a repeller's
   accel is bounded, velocity grows at most linearly, and positions stay finite over any finite
   run. The cap is a component clamp (no `sqrt`) to stay cheap on the hot path, and it NEVER bites
   in the normal regime (single-digit `attract` x a few-hundred-px radius gives accel in the low
   thousands, far under the cap). A dedicated unit case fires a strong repeller under `assertFinite`
   to prove the guarantee. Swirl needs no cap (a pure rotation field has imaginary eigenvalues --
   bounded).

4. **Zero rng -> fingerprint-neutral by default, deterministic when on.** The force is a pure
   function of the particle's own position and the burst center -- no rng draw at spawn or in the
   integrator. Guarded on `attract !== 0 || swirl !== 0`, so the default (`0`/`0`) executes the
   identical instruction stream as v1.9.0: EVERY prior committed fingerprint is preserved -- the
   eight physics hashes (default `1569828004`, mixed `3132631460`, wind `2385225781`, floored
   `2679696825`, box `804161759`, turbulence `1630588936`, gust `4074438162`, both `15761758`) AND
   the v1.9.0 trail geometry (positions are untouched, so the `translate` hash and hence the trail
   `strokeHash` are unchanged). A vortexed burst earns its own committed fingerprints:
   attract-only `2926753007`, swirl-only `2039789049`, both `1387388835` (all distinct).

5. **Four per-particle columns; force placed after `gust`, before `drag`.** `vortX`/`vortY`
   (center) + `attract`/`swirl` (strengths), 16 B/particle, so a vortexed burst and a plain burst
   coexist in one pool (the same per-particle discipline as `wind`/`floor`/`turb`). The force is an
   acceleration inserted after the gust line and before the drag multiply, so it damps toward the
   center like every other force and the box clamps (which run after position integration) still
   contain it. Signed `num()` coercion (negatives valid: repel / reverse spin); the center resolves
   to the burst origin AFTER `cx`/`cy` are computed.

## Consequences / proof

- Unit suite 122 -> 132. New `describe('vortex / attractor')` asserts: opt-in/fail-closed ==
  `COMMITTED_HASH` (incl. NaN/Infinity/null/string and a center with no strength); floored + box
  unchanged; the three committed hashes (distinct, deterministic on replay); and the NON-VACUOUS
  directional effects a bare hash cannot see -- attract CONVERGES the pool (smaller x/y extent),
  repel EXPANDS it, `+swirl` vs `-swirl` diverge (spin sign is real), a pure swirl orbits rather
  than collapses, and a custom `attractX`/`attractY` pulls the centroid toward that point. Plus
  `assertFinite` under strong attract + swirl + wind + gravity in a tight box (contained) and the
  strong-repeller finiteness case (the accel cap).
- Torture: T5 threads signed `attract`/`swirl` + a jittered center through the differential fuzz
  (two same-seed instances stay bit-identical -- also proving center resolution is deterministic);
  T6's mixed lane arms a stable POSITIVE attract + swirl on the immortal pool (so it stays finite)
  -> still ~0 B/frame; T1 adds attract/swirl/center poison AND two strong finite-life repellers
  under the assertFinite detector.
- Full gate matrix green: 132 unit; torture ok / BREAK exit 1 / CONTROL=alloc exit 1 / SEED ok;
  ASCII clean; npm pack 1.10.0.

## Explicitly NOT done (flagged for a future chapter, if ever)

- **Inverse-square (`1/r^2`) "real gravity" law** -- singular at the center, needs epsilon
  softening and can blow up; the linear spring was chosen precisely to avoid this.
- **Multiple simultaneous attractors** (an N-body field) -- one center per burst; a second point
  would need another column set and an inner loop on the hot path.
- **An animated / pointer-tracked vortex center** -- the center is a per-burst constant (like the
  burst origin); a live-moving center is a separate, non-deterministic concern (cf. followPointer).
- **Per-shape / per-color vortex, or strength scaling with life** -- edges are burst-wide scalars,
  matching every prior force knob.
- Any change to the default look, existing presets, the physics integrator, or any committed
  physics/trail fingerprint.
