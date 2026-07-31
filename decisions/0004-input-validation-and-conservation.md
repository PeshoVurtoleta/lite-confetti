# 0004 -- fail-closed input validation, the count fix, and the conservation probe

- **Status:** accepted (implemented in v1.3.1)
- **Date:** 2026-07-31
- **Session:** F2, the hardening release after F1 (v1.3.0 shapes + flutter). Pays down
  two correctness debts that decisions `0002` and `0003` both flagged and deferred.

## Context

Two gaps sat, explicitly documented, across the last two decision records, both under
the headline Law *"Fail closed on every unverified state. null is not zero."*:

- **No numeric-input validation** (`0002` latent gap #1, reaffirmed `0003` s4 as
  deliberately left for "a dedicated validation patch"). `burst`/`spray` did not
  sanitise options. `speed: NaN` propagated NaN into a drawn position (which hashes
  silently as 0 -- the fingerprint could not even see it); `lifeMax: NaN` made a
  particle immortal (`NaN <= 0` is false, so it never died and pinned the pool);
  `colors: null` threw on `.map` -- fail *open*. And `x: NaN` slipped past `x ?? cw/2`
  because `??` only catches null/undefined, not NaN.
- **`destroy()` left `count` stale** (`0002` gap #2). `destroy()` zeroed `pool.life`
  but not the `aliveCount` the `.count` getter returns, so a destroyed instance kept
  reporting its last integrated count.

`0003` had already built the template (`clamp01` for flutter/sway). F1 said the physics
numerics were "a separate patch, not this feature release." This is that patch.

## Decisions

1. **Coerce to the documented default; do NOT throw** (for call-time numerics). Every
   numeric option -- `x`/`y`/`count`/`spread`/`speed`/`speedVariance`/`gravity`/`drag`/
   `sizeMin`/`sizeMax`/`lifeMin`/`lifeMax`/`angle`, plus spray's `duration`/`rate` --
   passes through `num(v, dflt)` (finite-or-default) or `nonneg(v, dflt)` (finite,
   floored at 0) at the top of `burst`/`spray`, before any use. Rationale: this is the
   exact line `0003` s5 already drew -- `registerShape` THROWS (a structural setup
   contract) but an unknown `shape` NAME falls back to rect, because *a call-time typo
   must not crash a running animation*. Physics numerics are call-time too, so they
   clamp, not throw. `registerShape`'s throw-on-bad-def is unchanged (setup, not a
   per-call tunable).

2. **`drag` clamps to `[0,1]` via `clamp01`** -- it is a retention factor; a value above
   1 amplifies velocity every frame (unstable), a negative flips it. This is the ONE
   behaviour change for an in-band-but-out-of-range caller (`drag: 2`); the documented
   range was always `0-1`. Everything else only changes behaviour for non-finite input.

3. **`colors` falls back to `DEFAULT_COLORS` when not a non-empty array** -- kills the
   `null.map` throw and the paint-nothing empty-array case in one guard.

4. **`x`/`y` coerce differently in burst vs spray.** `burst` bakes a one-shot centre
   (`num(x, cw/2)`), matching its existing `x ?? cw/2` single evaluation. `spray`
   coerces a non-finite `x`/`y` to `undefined` (not a baked centre), so the existing
   dynamic `?? cw/2` fallback inside `sprayFn` still RE-CENTRES if the canvas resizes
   mid-spray. A baked centre there would have silently regressed live re-centring.

5. **`destroy()` now zeroes `aliveCount`** (one line, `clear()` already did this). A
   destroyed instance reports `count === 0`, consistent with its zeroed pool.

6. **A non-enumerable `__stats()` conservation probe** -- the white-box introspection
   `0002` s2 deferred to ">=1.3.0". Returns `{ cap, aliveGetter, aliveActual }` where
   `aliveActual` counts `pool.life[i] > 0` directly. Defined via `Object.defineProperty`
   with `enumerable: false`, so `Object.keys(api)` is unchanged, the public shape does
   not widen, and `Confetti.d.ts` stays a no-change patch. The torture gate reads it to
   assert `aliveGetter === aliveActual` (the getter never drifts) and `aliveActual === 0`
   after destroy (the regression guard for decision 5).

7. **This stays a PATCH.** No new public API; `__stats` is intentionally undocumented and
   non-enumerable. Default look, default positions, and the committed determinism hash
   `1569828004` are all preserved -- validation is a no-op for the in-range defaults
   (unit test re-asserts the hash post-sanitisation).

## The tests flipped from documenting the bug to proving the fix

The gaps were previously *asserted as behaviour*, so closing them meant inverting those
tiers -- a good sign the debt was real and tracked:

- **T1** stopped documenting "positions may be non-finite for garbage input" and now
  runs each poison case under `assertFinite`, proving positions stay finite; a dedicated
  case proves a `NaN` life particle EXPIRES (immortal bug gone).
- **T3** replaced the "count freezes stale after destroy" assertion with "count is 0
  after destroy" + a conservation soak (`aliveGetter === aliveActual` at every
  checkpoint).
- **T6** added a lane: a pool SPAWNED from out-of-range inputs (all coerced) still
  integrates at ~0 B/frame -- coercion runs once in `burst`, never in the loop.
- **T9 K1** inverted: `burst({speed:NaN})` used to be the control PROVING NaN reaches a
  drawn position; it now pumps a full barrage of non-finite options and must NOT trip
  `assertFinite` (the poison control that sanitisation holds end-to-end). K1a (a direct
  `translate(NaN)`) still proves the detector itself bites.

## Explicitly NOT done

- Per-particle multi-shape mixing (`shapes: []`) -- still the deferred feature minor
  from `0003`.
- No `.d.ts`/public-API change; `__stats` is test-only.
- No demo behaviour change: validation has no user-facing control; it hardens the exact
  code the demo already calls.

## References

- `Confetti.js` (`num`/`nonneg`, `burst`/`spray` sanitisation, `colors` guard,
  `aliveCount = 0` in `destroy`, the `__stats` defineProperty).
- `test/torture/{t1,t3,t6,t9}.mjs`; `test/Confetti.test.mjs` (validation + count/destroy
  + `__stats` describes; committed-hash re-assert).
- `CHANGELOG.md` [1.3.1]; `decisions/0002` (the deferred gaps + white-box option),
  `decisions/0003` s4/s5 (the coerce-vs-throw line this follows).
