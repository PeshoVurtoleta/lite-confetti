# Changelog

All notable changes to `@zakkster/lite-confetti` are documented here. Format
follows Keep a Changelog; this project adheres to Semantic Versioning.

## [1.3.1] - 2026-07-31

Hardening release. Closes the two correctness gaps flagged (and deferred) in
decisions 0002 and 0003, both under the Law "fail closed on every unverified state,
null is not zero". No new public API; the default look, default positions, and the
committed determinism fingerprint (`1569828004`) are all unchanged -- validation is a
no-op for the in-range defaults.

### Fixed
- **Numeric options now fail closed.** `burst()`/`spray()` sanitise every numeric
  option: a non-finite value coerces to its documented default instead of poisoning a
  particle. Previously a `speed: NaN` propagated NaN into a drawn position (hashing
  silently as 0), a `lifeMax: NaN` made a particle **immortal** (`NaN <= 0` is false, so
  it never died), and a `colors: null` **threw** on `.map`. `drag` is additionally
  clamped to `[0,1]` (a retention factor above 1 amplified velocity). A call-time typo
  now degrades gracefully rather than crashing or poisoning a running animation --
  matching how an unknown `shape` name already falls back to rect.
- **`destroy()` zeroes the count getter.** It cleared the pool's `life` but not the
  `aliveCount` the `.count` getter returns, so a destroyed instance kept reporting its
  last integrated count. `count` now reads `0` immediately after `destroy()`.

### Changed
- `drag` outside `[0,1]` is clamped (was applied verbatim). The documented range was
  always `0-1`; only callers passing out-of-range values see a behaviour change.

### Internal
- Added `num()`/`nonneg()` fail-closed coercion helpers beside `clamp01`; all
  sanitisation runs once per `burst`/`spray`, never on the render hot path (T6 proves a
  pool spawned from garbage inputs still integrates at ~0 B/frame).
- Added a **non-enumerable, undocumented** `__stats()` conservation probe (the
  white-box introspection deferred in decision 0002): reports `{ cap, aliveGetter,
  aliveActual }` so the torture gate can assert the count getter never drifts from the
  true live-slot count. Non-enumerable, so the public shape and `Confetti.d.ts` are
  unchanged.
- Tests: 73 unit (was 57); torture tiers reworked -- T1 now proves coercion (finite
  positions, immortal bug gone) instead of documenting the old bounded-garbage
  behaviour, T3 adds a conservation soak + the fixed destroy/count assertion, T6 adds a
  sanitised-input zero-alloc lane, T9 K1 inverts to a sanitiser-poison control.

## [1.3.0] - 2026-07-31

First **feature** release on the F0/torture base. Adds custom shapes and tunable
flutter. The default look is unchanged and the committed determinism fingerprint
(`1569828004`) still reproduces: `flutter` defaults to 1 (reproducing the old wobble
exactly) and `sway` defaults to 0 (positions byte-identical to pre-1.3.0).

### Added
- `instance.registerShape(name, def)` -- register a custom particle shape, usable as
  `burst({ shape: name })`. `def` is either a **vector** draw function
  `(ctx, w, h) => void` (the engine sets `fillStyle` to the particle colour first), an
  **image sprite** `{ image }` (prerendered once and blitted, the same GPU-blit path as
  the emoji atlas), or `{ draw, blit }`. Shapes are **per-instance** (seed-sealed,
  invisible to other instances, dropped on `destroy()`); registering a bad name/def or
  overriding a built-in throws (fail-closed). Custom ids start at 5; built-ins keep 0..4.
- `flutter` (0..1, default 1) on `burst()`/`spray()` -- tumble depth. `1` is the classic
  wobble, `0` holds a piece rigid. Controls X-scale only, so it never shifts positions.
- `sway` (0..1, default 0) on `burst()`/`spray()` -- paper-like horizontal drift as a
  piece falls. Opt-in; `0` keeps the straight fall (and the committed fingerprint).
- Non-finite `flutter`/`sway` are clamped to their defaults (validated, unlike the
  physics numerics -- see the 1.2.3 note); a garbage knob never yields a NaN position.

### Changed
- The five-way shape `switch` (hot loop + reduced-motion static path) is replaced by a
  per-instance indexed shape table (`shapeDraw`/`shapeBlit`), so custom shapes dispatch
  through the same zero-allocation path as the built-ins. Proven by T6, which now also
  measures a live pool of a custom vector shape + an image sprite + sway at ~0 B/frame.
- `Confetti.js` is now fully **ASCII** (the suite Law): the functional default emoji is
  built from its code point (`String.fromCodePoint(0x1F389)`) and all box-drawing /
  em-dash / bullet characters in comments are ASCII. This closes the Law gap
  `decisions/0001` flagged for F1.
- Torture suite extended (still nine tiers, no new file): T1 covers registerShape
  argument validation + unknown-shape fallback + flutter/sway clamping; T5 adds a
  custom-shape + flutter/sway determinism lane; T6 the custom-pool alloc gate; T8 the
  **per-instance isolation** proof (one instance's shape is invisible to another) and a
  registry-aware retention check; T9 a sway-discrimination control.

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
