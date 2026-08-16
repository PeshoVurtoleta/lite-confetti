# 0027 -- pool overwrite fix: drop-new-when-full

- **Status:** accepted (implemented in v1.26.0)
- **Session:** F26, the release after F25 (v1.25.0 gustRate). The FIRST bug-fix chapter -- every prior
  release (0003-0026) added a feature. No new option, no new pool column, no fingerprint change.

## Context

The particle pool is a fixed pre-allocated SoA ring buffer. `spawn()` advances a single write cursor
`head = (head + 1) % maxParticles` and writes that slot -- historically BLIND to whether the slot
held a still-alive piece. This is the "the fixed pool never saturates" design: it always accepts a
new spawn by recycling the oldest slot.

The defect (user-reported, visible in the demo): a sustained `spray()` emits `rate` pieces/frame over
`duration`, so its steady-state ALIVE population is `rate * fps * avgLife` (`fps ~= 60`,
`avgLife = (lifeMin + lifeMax) / 2`). For realistic sprays that exceeds `maxParticles`. Once
cumulative spawns pass `maxParticles`, `head` wraps and every new piece OVERWRITES the oldest
airborne piece -- which pops out of existence mid-flight. On a long spray only the last
~`maxParticles` pieces ever animate to completion; the rest are cut off. The user described it as the
spray "auto-cancelling itself".

## Decisions

1. **Drop-new-when-full, not overwrite.** When the pool is full, KEEP existing pieces alive to finish
   their life + fade; SKIP (drop) the new spawn. The stream thins gracefully instead of popping. This
   is the behavior the user chose.

2. **The guard: `if (pool.life[head] > 0) return -1;` at the TOP of `spawn()`.** `head` addresses the
   OLDEST-written slot, so `life > 0` there means the ring lapped a piece still airborne. Drop WITHOUT
   writing and WITHOUT advancing `head` (the cursor unblocks the instant that piece dies). One Float32
   read + compare: O(1), zero-allocation, no free-slot scan (a `count=N` burst into a full pool stays
   O(N), not O(N^2)). No new pool column -- it reuses the existing `pool.life`.

3. **`pool.life[head] > 0` is an EXACT predicate.** `pool.life` (Float32) zero-inits to 0; a dead slot
   is pinned to 0 in `update()` and by `clear()`. So `<= 0` == reusable, not epsilon-dependent.
   Settled/`landed` pieces AND not-yet-born staggered pieces keep `life > 0` (ageing + the alive count
   run before the `landed` physics guard; a staggered piece has its life set at spawn), so both are
   correctly PROTECTED from eviction -- exactly the settled pile the old code used to erase and the
   piece that has not appeared yet.

4. **`spawn()` returns `-1` on a drop; the one caller that reads it is fail-closed.** `burst()`'s
   stagger write becomes `if (staggerSec > 0 && slot >= 0) pool.delay[slot] = ...` (`pool.delay[-1]=v`
   is a silent TypedArray no-op, but the explicit `slot >= 0` beats relying on it). `spray()` ignores
   the return. Nothing else reads the return or `head`.

5. **Drops stay INVISIBLE -- no `dropped` counter, no public event.** A counter would be state to reset
   on clear/destroy/seed and permanent API surface; the behavior is already observable via `count`
   capping at `maxParticles` (and `__stats()` for tests). Fail-closed: the contract is "at most
   `maxParticles` alive", and dropping is the honest enforcement of it, not an error to report.

6. **The library default `maxParticles` STAYS 500.** The chosen fix is drop-new, NOT a bigger default
   (a default bump taxes every tiny-burst user with memory they do not need). Sizing is the caller's
   opt-in, now DOCUMENTED (see below).

7. **Paired sizing GUIDANCE (docs + demo only).** A full continuous spray wants
   `maxParticles >= rate * 60 * avgLife`. The rule ships in the `maxParticles`/`rate`/`duration` JSDoc,
   `llms.txt`, and README; the demo sizes its instance for its longest spray so it shows a full stream.
   No engine or fingerprint impact.

## The crux -- a hash-neutral one-line fix

**The guard fires ONLY on a spawn that would overwrite a LIVE slot -- exactly the buggy path -- and no
committed rig ever did that, so every committed fingerprint is byte-identical and ZERO hashes re-pin.**
Proven two ways: (a) structural -- all 30 pinned hash literals live in `test/Confetti.test.mjs`; every
`test/torture/**` hash check is DIFFERENTIAL (A vs B in the same build), so both sides take the same
drops and move together or not at all; (b) a per-file saturation sweep -- the largest committed-hash
rig is a burst of `count <= 150` or a spray of `<= ~360` spawns into a `>= 500`-slot pool (never
wraps), and every t6 exactly-full lane fires exactly `MAXP` into a fresh pool (a single fill, `head`
walks 0..MAXP once, guard never fires). Confirmed empirically: 285/285 unit pass with all 30 hashes
reproduced; full torture gate green.

rng and determinism: the caller draws angle/speed/emitter position BEFORE `spawn()` (burst/spray
loops), and `spawn()` draws spin/tilt/size/life INTERNALLY -- but only AFTER the drop guard. So a
DROPPED spawn (guard fires, returns -1 before those internal draws) consumes only the caller's
pre-spawn draws, not the internal ones; the rng sequence past a drop therefore differs from the old
overwrite behavior. This is NOT a determinism regression: drops are a pure deterministic function of
pool state (`pool.life[head]`), so two same-seed instances take identical drops and replay
identically (proven by the "drops are deterministic" unit case), and -- decisively -- NO committed
rig ever reaches the guard, so on every fingerprinted rig `spawn()` proceeds to its internal draws
exactly as before and the rng sequence is byte-identical. Byte-identity is a claim about the
non-saturating (committed) rigs; determinism (same seed -> same frames) holds universally.

## Consequences / proof

- Unit 281 -> 285 (+4): a `pool saturation (v1.26.0)` suite -- cap holds under a sustained spray;
  early pieces SURVIVE a later saturating burst (the anti-regression, which FAILS on HEAD before the
  fix: the original eight would be displaced); drops deterministic across two same-seed instances; a
  non-saturating rig still equals COMMITTED_HASH.
- All 30 committed fingerprints reproduce bit-for-bit. Zero re-pins.
- Torture: a new t6 full-pool drop-path lane (fill, then spray forever so every spawn drops) retains
  ~0 B/frame; t6's emit-spray lane re-rigged with finite life so it keeps measuring real spawns; every
  exactly-full lane stays green; a new t1 lane asserts a sustained spray never exceeds cap and drains
  to 0. No `_env.mjs` change.
- Zero hot-path allocation (one Float32 read + compare); no new pool column (per-particle byte cost
  unchanged, so the README alloc table is untouched).

## The canvas-confetti contrast (why drop-new + headroom is the right zero-GC answer)

`canvas-confetti` (the alternative migrated from) NEVER cuts a piece off -- but only because it
allocates one plain object per particle and rebuilds its live array every frame
(`animatingFettis = animatingFettis.filter(...)`, `concat` on each call), with no cap and no reuse.
That is unbounded GC pressure that scales with particle count x duration. lite-confetti keeps
0 B/frame with a fixed pool; drop-new-when-full is the zero-GC analog of "existing pieces always
complete", and DOCUMENTED HEADROOM (`rate * 60 * avgLife`) closes the perceived-density gap without
paying that allocation cost. Rejecting the object-per-particle model is the whole reason this library
exists; the fix stays inside its zero-GC contract.

## Explicitly NOT done

- A free-list / dead-index stack -- O(1) with no head-of-line stall, but it reassigns slots in DEATH
  order, which changes the deterministic recycle sequence and BREAKS every committed hash. Rejected to
  preserve determinism (the whole point of the hash-neutral guard).
- A forward free-slot scan -- O(N^2) on a full-pool burst; violates the no-scan-on-spawn stance.
- Growing the pool on demand -- violates the fixed pre-allocated zero-GC pool Law.
- A public `dropped` counter / spawn-drop event (decision 5).
- Raising the default `maxParticles` (decision 6) -- orthogonal tuning; the drop fix makes any pool
  size behave correctly, and sizing is now documented caller opt-in.
- Any change to per-particle physics, the render path, presets, reduced-motion, or ANY committed
  fingerprint.

## Head-of-line trade-off (accepted)

With widely varying lifetimes the cursor can sit on one long-lived slot while later slots are already
free, so a saturated pool can run slightly UNDER `maxParticles` -- a marginally thinner stream, never
a pop. In the saturating regime this is self-correcting and near-optimal (new spawns throttle to the
recycle rate, `count` hovers near max); it only visibly under-fills when `lifeMax >> lifeMin`. Chosen
over the free-list (determinism) and the scan (cost). t7-soak is the lane most likely to surface it.
