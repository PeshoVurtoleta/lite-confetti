# Changelog

All notable changes to `@zakkster/lite-confetti` are documented here. Format
follows Keep a Changelog; this project adheres to Semantic Versioning.

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
