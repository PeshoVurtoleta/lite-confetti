# 0002 -- the torture gate becomes a multi-tier suite (the lite-bvh shape)

- **Status:** accepted (implemented in v1.2.3)
- **Date:** 2026-07-31
- **Session:** the patch after F0. F0 (v1.2.2) built a WORKING gate; this builds a
  THOROUGH one, modelled on `@zakkster/lite-bvh` (the suite's reference for stress
  testing). Test-only, `Confetti.js` byte-for-byte unchanged.

## Context

F0 left `test/torture.mjs` as a single file with three phases (A retention,
B GC budget, C controls). It proves the two halves of the Law -- no hidden
retention, no hot-path allocation -- and nothing else. `@zakkster/lite-bvh` (v2.0.0)
carries a nine-tier harness (`t0-laws` .. `t9-controls`, a shared `harness.mjs`, a
thin dispatcher, seeded replay, a whole-suite break switch, and a controls tier that
proves every gate can fail). That is the level of stress the suite expects. This
patch brings confetti's gate up to it.

## Decisions

1. **Adopt the lite-bvh multi-tier shape verbatim in structure.** `test/torture/`
   holds one `.mjs` file per tier, each exporting `run()`; `harness.mjs` centralises
   the shared kit; `test/torture.mjs` is a thin sequential dispatcher. Nine tiers,
   T2 (aliasing) intentionally omitted -- confetti has no caller-shared buffers to
   alias, exactly as lite-bvh reserves its own T2. Nothing F0's A/B/C proved was
   dropped: **A -> T8 (shared-ticker retention), B -> T6 (alloc), C -> T9 (controls)**.

2. **Every tier is BLACK-BOX, and that is forced by the version.** lite-bvh's tiers
   index tree internals directly (`freeHead`, `nextFree`, `bboxes`, `nodeCount`) --
   its SoA is public. Confetti's pool is closed over inside `createConfetti`; the
   instance exposes only `{ burst, spray, clear, seed, destroy, count }`. Reading
   columns would mean adding a test-only introspection surface to `Confetti.js` -- a
   source change, i.e. not a byte-unchanged 1.2.3. So the tiers assert through the
   public `count()` (occupancy) and the instrumented-ctx draw **fingerprint**
   (determinism, per-particle state) only. A true white-box `alive+free===cap` check
   and a direct NaN scan are the **deferred 1.3.0 option**: add a non-enumerable
   introspection getter, then port lite-bvh's `conservation()`/poison controls.

3. **The NaN detector is a harness-side finite check, not a source change.** A NaN
   that reaches a particle's position would hash SILENTLY as 0 (`Math.round(NaN)|0`
   is 0), so the fingerprint alone cannot see it. `test/_env.mjs` gained an opt-in
   `assertFinite` flag that makes the record ctx throw on a non-finite draw position.
   It defaults OFF, so the committed determinism hash (all-finite) is unchanged; only
   T1/T9 enable it. This is the black-box analog of lite-bvh's `validate()` NaN
   backstop.

4. **Controls live where they bite (T9), plus one in the real gate (T6).** T9 shows
   each gate a workload it must reject: retention (dropped-not-destroyed stays live),
   alloc (per-frame allocation exceeds the floor), determinism (different seeds must
   diverge), the NaN detector (injected non-finite position must throw), and the
   count channel (count() must actually move, or the count laws are vacuous). The
   whole-suite red switch `CONFETTI_TORTURE_BREAK=1` is wired into the REAL T6 hot
   loop, so the production gate is the one proven falsifiable; the dispatcher fails if
   BREAK is set yet the run passed.

## Latent gaps the new tiers surfaced (flagged, NOT fixed here)

These are real behaviours discovered while writing the tiers. None is fixable in a
byte-unchanged patch; each is a candidate for a future validation release.

- **No numeric-input validation.** `burst`/`spray` do not sanitise options: a
  non-finite `speed`/`gravity`/`angle` propagates NaN into a particle's velocity and
  thus its drawn position, and a NaN `life` makes a particle immortal (`NaN <= 0` is
  false, so it never dies). Garbage-in does not throw and the pool stays bounded, but
  this is not "fail closed on every unverified state." T1 asserts the true, bounded
  behaviour (no crash; a FINITE life still expires); T9 K1 injects a NaN on purpose
  and requires the detector to fire.
- **`destroy()` leaves `count` stale.** `destroy()` zeroes `pool.life` but not the
  `aliveCount` the getter returns (only `clear()`/`update()` touch it), so a destroyed
  instance reports its last integrated count. T3 A2 asserts the load-bearing fact
  instead -- the render loop is truly stopped (count is frozen across pumps) -- and
  documents the quirk here.

## Explicitly NOT done

- No source change of any kind. The F0 decision's open item -- `Confetti.js` still
  violates the ASCII-only Law (emoji default + box-drawing comments) -- remains F1's,
  untouched.
- No white-box pool introspection (the 1.3.0 option in decision 2).

## References

- `test/torture/harness.mjs`, `test/torture/t0-laws.mjs` .. `t9-controls.mjs`,
  `test/torture.mjs`, `test/_env.mjs` (the `assertFinite` addition).
- `CHANGELOG.md` [1.2.3]; `decisions/0001` (the F0 base this builds on).
- `@zakkster/lite-bvh` `test/torture/` (the design reference).
