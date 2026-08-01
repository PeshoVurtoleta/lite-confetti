# 0005 -- multi-shape mixing (`shapes: []`)

- **Status:** accepted (implemented in v1.4.0)
- **Date:** 2026-08-01
- **Session:** F3, the feature release after F2 (v1.3.1 hardening). Closes the one
  feature debt that decisions `0003` and `0004` both flagged and deferred: per-particle
  multi-shape mixing.

## Context

`registerShape` (`0003`, v1.3.0) shipped single-shape-per-burst: every particle in a
burst shares one baked `shapeId`. To fire a spread of mixed stars + circles + rect a
caller had to overlap three bursts. Both `0003` and `0004` explicitly parked
"per-particle multi-shape mixing (`shapes: []`)" as the deferred feature minor. This is
that minor.

It is the cleanest feature the package has added, because the machinery was already in
place:

- **No new pool column.** `pool.shape[i]` is already a per-particle id column; the
  single-shape path just writes a constant to it. Mixing only varies what gets written.
- **The render dispatch was already per-particle.** `update()` reads `pool.shape[i]` and
  indexes `shapeBlit[id]` / `shapeDraw[id]` every frame regardless. Interleaved ids flow
  through unchanged, so there is zero new hot-path work.
- **Custom shapes compose for free.** `shapes` names resolve through the same
  `shapeName2Id` map as `shape`, so `shapes: ['star', 'myLogo']` just works.

## Decisions

1. **Distribution = weighted-random per particle.** Each spawned particle picks its
   shape by a uniform `rng`-driven choice over the resolved id array -- the same organic
   model `colorPick` already uses (`rng.pick(parsedColors)`). Repetition in the array is
   therefore a natural weight (`['star','star','circle']` ~ 2:1). A round-robin/striped
   alternative was rejected: it bands visibly at low counts and buys nothing, since the
   mixed lane accepts its own fingerprint anyway.

2. **`shapes` overrides `shape`; resolution fails closed.** `resolveShapeIds(shapes,
   map)` returns an id array, or `null` to signal the single-`shape` path. It returns
   null for a non-array / empty input, and **drops** individual unknown names (a
   call-time typo must not crash a running animation -- the `0004` s1 stance); if nothing
   resolves it returns null and the caller falls back to `shape` (which itself fails
   closed to rect). No throw anywhere on the call-time path.

3. **A single-entry mix collapses to the single-shape path.** After resolving, if
   `shapeIds.length === 1` the engine sets `shapeId = shapeIds[0]` and `shapeIds = null`.
   So `shapes: ['star']` is byte-identical to `shape: 'star'` -- a "mix" of one shape is
   not a mix, and this avoids a wasted per-particle rng draw. This makes the drop-unknowns
   rule compose cleanly: `shapes: ['star', 'typo']` becomes `['star']` becomes plain star.

4. **Opt-in, so the committed default fingerprint is preserved.** The per-particle pick
   is a single conditional in `spawn()`:
   `pool.shape[i] = config.shapeIds ? config.shapeIds[(rng.next()*len)|0] : config.shapeId`.
   The single-shape branch takes **no** rng draw, so a default (or any non-`shapes`)
   burst reproduces the committed fingerprint `1569828004` byte-for-byte. The extra draw
   fires only in the mixed lane, at a fixed point (immediately before the colour pick),
   so a mixed burst is itself deterministic -- with its own committed fingerprint
   `3132631460`.

5. **The reduced-motion static path honours the mix too.** `renderStaticBurst` takes an
   optional `shapeIds` and picks per piece (again, no extra draw when null), so a
   `shapes` burst looks consistent when motion is reduced.

6. **This is a minor (1.3.1 -> 1.4.0).** `shapes?: ShapeName[]` is a new *public* option
   (`Confetti.d.ts`), so semver minor -- matching the v1.3.0 feature precedent. `shape`
   (singular) is fully retained.

## The determinism subtlety that shaped decision 3

The mixed branch draws one rng value per particle. Because the rng is a single shared
stream, that draw shifts *every subsequent* particle's draws -- so a naive
`shapes: ['star']` would NOT equal `shape: 'star'` (positions of particle 2 onward would
diverge). Collapsing a length-1 mix (decision 3) removes the draw entirely for that case,
restoring exact equivalence. For genuine mixes (length >= 2) there is no equivalence to
preserve, so the shifted stream is fine and simply gets its own committed hash.

## How the tests prove it

A position fingerprint **cannot** distinguish geometry (a custom shape hashes like rect
at identical positions), so shape *identity* is proven with per-shape dispatch counters,
and the fingerprint proves only stream-level determinism -- the split that
`dom-ticker-torture` records for this package.

- **Unit** (`multi-shape mixing` describe): a mix dispatches >1 distinct shape (counter
  proof, `a+b === count`); repetition weights the split; `shapes:['star'] == shape:'star'`
  and the omitted/empty/non-array/all-unknown cases all reproduce `1569828004`; the
  canonical mix reproduces `3132631460` and is `!=` the single-shape hash; reduced-motion
  mix renders; spray mixes.
- **Torture T5 F5**: two same-seed instances running identical fuzzed `shapes` bursts
  (built-ins + a custom id) stay bit-identical frame for frame; a counter proves the
  custom shape in the mix dispatched.
- **Torture T6 lane 5**: a pool filled from one `shapes: [...]` burst (interleaved ids,
  custom vector + sprite in the mix) integrates at ~0 B/frame.
- **Torture T8 X6**: a `shapes` mix naming another instance's custom shape drops it and
  collapses to the control rect hash -- the per-instance boundary holds for the mix
  surface exactly as X5 proves it for `shape`.

## Explicitly NOT done

- Per-particle **colour** palettes keyed to shape -- `colors` stays burst-wide.
- Per-shape size/physics overrides -- a mixed burst shares one physics config; the point
  is visual variety, not N sub-bursts. A caller who needs distinct physics still overlaps
  bursts.
- No change to the single-`shape` path, the default look, or the committed default hash.

## References

- `Confetti.js` (`resolveShapeIds`; the single-entry collapse + emoji-prime in
  `burst`/`spray`; the conditional pick in `spawn`; `shapeIds` param on
  `renderStaticBurst`).
- `Confetti.d.ts` (`shapes?: ShapeName[]` on `BurstOptions`; `SprayOptions`/`Preset`
  inherit).
- `test/Confetti.test.mjs` (`multi-shape mixing` describe; `MIXED_HASH = 3132631460`);
  `test/torture/{t5-fuzz,t6-alloc,t8-cross}.mjs`.
- `decisions/0003` (registerShape, the single-shape baseline), `0004` s1 (the
  coerce/drop-not-throw stance this follows).
