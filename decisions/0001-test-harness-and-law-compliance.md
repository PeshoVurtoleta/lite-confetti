# 0001 -- test harness on node:test + real deps, and what F0 deliberately did NOT touch

- **Status:** accepted (implemented in v1.2.2)
- **Date:** 2026-07-31
- **Session:** F0 (law compliance + the missing gate), the prerequisite the roadmap
  scheduled for lite-particles as P0 but never wrote for lite-confetti.

## Context

lite-confetti 1.2.1 shipped a feature-complete engine but an un-runnable test base:
the suite was `vitest` (the Law says `node:test` only), `vitest` was never installed,
and the suite imported its runtime API from `Confetti.d.ts` -- a types-only file, so
every imported symbol was `undefined`. There was no `CHANGELOG.md`, `llms.txt` was
absent from `files`, and there was no `test/torture.mjs`, so the Pipeline rule "every
module change is proven by `node --expose-gc test/torture.mjs`" could not be honoured.
F1 (shapes + flutter) has gates -- a committed seeded-position hash, a zero-GC hold --
that presuppose this base. So F0 builds it first, as an infra-only patch.

## Decisions

1. **Port to `node:test` running the REAL dependencies, not module mocks.** The old
   suite mocked `@zakkster/lite-random`, `lite-color`, and `lite-ticker` because
   confetti's `node_modules` had none of them. Mocks prove the test's model of a
   dependency, not the dependency; and `node:test` has no clean `vi.mock` equivalent.
   Instead we resolve the real packages (decision 2) and supply only the browser
   *environment* Node lacks -- `window`/`document`/`ResizeObserver` and a
   `requestAnimationFrame` -- in `test/_env.mjs`. The rAF is a **pump**: it queues
   callbacks and `pump(frames, dtMs)` invokes them, which drives the real
   `lite-ticker._tick` and thus confetti's real `update()` deterministically, with
   **no shipped-code hook**. `Confetti.js` is byte-for-byte unchanged.

2. **Resolve peers via local symlinks; the devDeps declaration is the committed
   contract.** `node_modules/@zakkster/<pkg>` symlinks to the sibling source dirs
   (the suite convention -- lite-lerp/lite-particles do the same). `node_modules` is
   gitignored (a `.gitignore` was added -- there was none), so what commits is the
   `devDependencies` list (`lite-gc-profiler`, `lite-leak`) and the `torture`/`verify`
   scripts, not the links.

3. **Determinism fingerprint = integer-pixel draw positions, first frame dt-capped.**
   The mock 2D context can fingerprint `translate` positions (the per-particle draw
   transform), rounded to whole pixels so cross-platform libm `sin`/`cos` epsilon
   cannot flip the hash; rotations (radians) are not hashed for the same reason. The
   determinism run forces the ticker's first frame above `maxDt` so its dt collapses
   to the fixed 16.66ms cap -- making the committed hash reproducible regardless of
   what pumped before it or which process runs it. Committed: `1569828004`,
   re-verified across three processes.

4. **The torture gate proves confetti's actual invariants.** Phase A: a destroyed,
   dropped instance and its lent canvas are released (the one thing that keeps an
   instance alive is the shared module ticker holding its `update()` closure;
   `destroy()` unregisters it). Phase B: `update()` over a full 500-particle pool
   retains 0 B/frame and a 10k-frame window fires no major GC. Phase C makes both
   falsifiable, including a `TORTURE_CONTROL=alloc` red path that must breach
   `maxMajor:0` and exit 1.

## Explicitly NOT done in F0 (flagged, not silently skipped)

- **`Confetti.js` still violates the ASCII-only Law.** It contains a functional
  emoji default (`'\u{1F389}'` as the default `emoji`) and box-drawing characters in
  comments. Fixing the comments is cosmetic churn on otherwise-frozen source, and
  changing the emoji default is a behaviour change -- both contradict F0's
  "infra-only, no API change" scope. Deferred to F1 (which edits the shape/render
  path anyway) or a dedicated cleanup patch. This is a real, open Law gap.
- No feature work: `registerShape`, sprite prerender, image sprites, and flutter are
  F1. F0 only makes them provable.

## References

- `test/_env.mjs`, `test/Confetti.test.mjs`, `test/torture.mjs`.
- `CHANGELOG.md` [1.2.2].
- `ROADMAP.md` F0/F1 briefs (in the LiteColor working copy).
- lite-particles `decisions/0001` (the P0 precedent this mirrors).
