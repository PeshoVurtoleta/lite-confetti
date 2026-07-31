# Changelog

All notable changes to `@zakkster/lite-confetti` are documented here. Format
follows Keep a Changelog; this project adheres to Semantic Versioning.

## [1.2.3] - 2026-07-31

Infrastructure only -- **no runtime or API change**. `Confetti.js` is byte-for-byte
unchanged. This release rebuilds the torture gate in the suite's multi-tier shape
(modelled on `@zakkster/lite-bvh`) so the render loop is stressed the way the rest of
the suite is, not just gated for allocation.

### Changed
- The single-file three-phase gate (`test/torture.mjs`) is now a thin dispatcher over
  **nine tier files** in `test/torture/` sharing one `harness.mjs`: `t0` metamorphic
  laws, `t1` degenerate inputs, `t3` adversarial op orders, `t4` handle/stub/buffer
  abuse, `t5` differential-determinism fuzz, `t6` the zero-alloc gate (F0's Phase B),
  `t7` soak + occupancy conservation, `t8` cross-package poison + shared-ticker
  retention (F0's Phase A), `t9` controls (F0's Phase C, widened). Nothing the old
  gate proved was dropped; T2 (aliasing) is intentionally omitted, as in lite-bvh.
- All tiers are **black-box**: confetti's pool is encapsulated, so they observe only
  the public `count()` and the instrumented-ctx draw fingerprint, never private
  arrays. `Confetti.js` stays untouched.

### Added
- Seeded-PRNG replay: `TORTURE_SEED=<n> npm run torture` reproduces any fuzz run.
- Whole-suite red switch `CONFETTI_TORTURE_BREAK=1` (injects a retained allocation
  into the real T6 hot loop; the gate must then exit non-zero).
- `test/_env.mjs` gained an opt-in `assertFinite` draw-position check (default off, so
  the committed determinism fingerprint is unchanged) used as T9's NaN-detector.

### Notes (latent gaps surfaced by the new tiers -- not fixed here; see decisions/0002)
- `burst`/`spray` do **not** validate numeric options: a non-finite `speed`/`gravity`
  propagates NaN into particle positions until the particle's finite life expires, and
  a NaN `life` makes a particle immortal. Garbage-in does not crash and the pool stays
  bounded, but it is not fail-closed.
- `destroy()` zeroes the pool's life but not the `count` getter, so a destroyed
  instance reports its last integrated count until `clear()`/`update()` runs.
  These are candidates for a future validation patch (a source change, so out of scope
  for a byte-unchanged release).

## [1.2.2] - 2026-07-31

Infrastructure only -- **no runtime or API change**. `Confetti.js` is byte-for-byte
unchanged; this release brings the package onto the ecosystem Law's test and
packaging footing so later feature work (shapes, flutter) can be proven.

### Changed
- Test suite ported from `vitest` to the built-in `node:test` + `node:assert/strict`.
  The old suite could not have run: it imported the runtime API from
  `Confetti.d.ts` (a types-only file) and `vitest` was never installed. It now runs
  the real engine against the real `@zakkster` dependencies over a minimal browser
  shim (`test/_env.mjs`), with the `requestAnimationFrame` pump driving the real
  `lite-ticker` render loop.
- `test` script is now `node --test`; `vitest` removed from devDependencies.

### Added
- `test/torture.mjs` -- the zero-GC gate (`node --expose-gc test/torture.mjs`):
  Phase A proves a destroyed, dropped instance and its lent canvas are released
  (the shared ticker pins nothing after `destroy()`); Phase B proves `update()`
  retains 0 B/frame over a full 500-particle pool and a 10k-frame window fires no
  major GC; Phase C is falsifiable -- `TORTURE_CONTROL=alloc` drives a
  per-frame-allocating soak that must breach `maxMajor:0` and exit non-zero.
- Determinism gate: a seeded burst reproduces an identical integer-pixel draw-position
  fingerprint, committed and re-verified across processes.
- `CHANGELOG.md` (this file) and `llms.txt` added to the published `files` list;
  `@zakkster/lite-gc-profiler` and `@zakkster/lite-leak` declared as devDependencies.
- `torture` and `verify` npm scripts.

## [1.2.1]

### Fixed
- Emoji shape no longer rasterizes per particle per frame. The old path set
  `ctx.font` and called `fillText()` for every emoji particle every frame (font
  size varies per particle, so nothing cached) -- a colour-glyph raster storm that
  could freeze the main thread. Each unique glyph is now rasterized once to an
  offscreen atlas; the hot path is a `drawImage()` blit.

## [1.2.0]

### Added
- Named presets: `fireworks`, `cannons`, `snow`, `pride` (`export const presets`),
  spreadable into `burst()` / `spray()`.
- `colorsFromPalette(input)` -- normalize a lite-hueforge `toGradientStops()` result
  (or a plain palette) into a `colors` array; never returns empty.
- `fromElement(el, extra?)` -- burst-origin sugar from an element's bounding rect.
- Per-instance, opt-in pointer-follow spray (`spray({ followPointer: true })`):
  binds a passive listener only while a follow-spray is active, reference-counted,
  and consumes no rng draw (a non-following spray stays seed-deterministic).

## [1.1.0] - and earlier

Initial deterministic confetti engine: OKLCH colors, five shapes (rect, circle,
star, triangle, emoji), seeded RNG, zero-GC render loop, `prefers-reduced-motion`
support, and a shared ref-counted ticker.
