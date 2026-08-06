# 0015 -- staggered emission (`stagger`, the first EMISSION-TIMING feature)

- **Status:** accepted (implemented in v1.14.0)
- **Date:** 2026-08-06
- **Session:** F13, the release after F12 (v1.13.0 emit). Where 0005-0009 extended the PHYSICS,
  0010/0013 built the RENDER path (trails, color-over-life), 0011 added a DIRECTED force (vortex),
  0012 added the first BEHAVIOUR feature (settle), and 0014 opened EMISSION GEOMETRY (where a piece is
  born), this opens the last untouched axis on emission: its TIMING -- WHEN a piece is born.

## Context

Every burst has always spawned its entire `count` in one synchronous loop at frame 0. Real effects
often want a burst to CASCADE / ripple in -- a wave of confetti, a rolling firework. This chapter adds
**`stagger`**: an opt-in duration (ms) that spreads a burst's fixed `count` births evenly across a
window, so the pieces arrive over time instead of all at once.

`spray()` already emits over time (that IS its purpose), so `stagger` is the BURST-only analog of a
spray's `duration`. It is ignored by `spray()`.

The engineering question is not a force but, again, the determinism contract: emitting over frames
means later pieces enter the simulation on later ticks, which threatens the seeded stream unless the
design keeps the rng sequence pinned.

## Decisions

1. **Birth-delay gate, chosen over a deferred spray-style drip.** Confirmed via AskUserQuestion. All
   `count` pieces spawn at CALL TIME through the existing synchronous loop -- so the rng draw sequence
   is BYTE-IDENTICAL to a synchronous burst (the strongest possible determinism proof). Each piece is
   stamped with a per-piece `delay` (seconds until birth); an unborn piece is frozen + invisible until
   its delay elapses, then it lives its FULL life from birth. The alternative -- actually spawning a
   few pieces per frame over the window (a bounded spray) -- would make `.count` and the pool fill
   gradually (the truest "emission over time"), but it needs a retained per-burst emitter closure
   (config held until the window closes) and the auto-detach taught not to fire mid-emission. The
   birth-delay gate instead REUSES the proven settle-freeze pattern (`if (!landed)`) and the existing
   `ensureRunning()` path, adds one pool column, and needs no lifecycle plumbing. Trade-off accepted:
   pieces occupy pool slots and count toward `.count` from t0 (invisible until born).

2. **Duration window in ms, chosen over a per-particle step.** Confirmed via AskUserQuestion. `stagger`
   is the TOTAL emit-window length; the `count` is spread evenly across it (piece i wakes at
   `stagger * i / count`), so the window is STABLE as `count` changes -- mirroring spray's `duration`.
   A per-particle step (`stagger` = the ms gap between successive pieces) was rejected: the total
   cascade length would scale with `count`, which is easy to set surprisingly long. Emission order is
   LINEAR / even and draws NO rng; jitter / easing curves are deferred (see NOT done).

3. **The byte-identical-rng-sequence crux -- the load-bearing property.** A staggered burst draws the
   IDENTICAL rng sequence as a synchronous burst of the same seed + count; ONLY birth timing differs.
   This holds because (a) all `count` pieces spawn in the existing loop -- same angle/speed draws, same
   `spawn()` body draws, same order -- and the per-piece `delay = staggerSec * i / count` is a function
   of the loop INDEX only, no rng; and (b) `update()` draws no rng (physics is deterministic; `spawn()`
   is the only rng consumer and is not called from `update()`), so freezing a piece for N frames
   changes nothing about the stream. Therefore `stagger` OFF (delay all 0) -> the gate never fires ->
   byte-identical -> COMMITTED_HASH (1569828004) and every prior physics/trail/color/emit fingerprint
   preserved. ON -> a NEW committed fingerprint (STAGGER_HASH 3414676538): the per-piece
   `(angle, speed, spin, ...)` are identical to the synchronous burst, but early frames have unborn
   (invisible) pieces and woken pieces begin moving at staggered times, so the POSITION hash differs --
   and replays identically under a fixed seed + fixed dt.
   - **A new probe WAS needed.** All pieces count as alive from t0 (unborn ones included, so the loop
     stays registered), so `.count` cannot show the timing. The mock canvas gained a `translates`
     counter (one per DRAWN piece per frame, kept out of the position hash like `strokes`/`colorHash`):
     a staggered burst draws strictly fewer pieces in the early frames than a synchronous one,
     converging once the window elapses. That is the non-vacuous witness that births are delayed.

4. **The birth gate + the `delay` column.** One per-particle Float32 column `delay` (seconds until
   birth). The gate sits at the TOP of the update loop, right after the dead-slot skip and BEFORE the
   life countdown: `if (pool.delay[i] > 0) { pool.delay[i] -= dtSec; alive++; continue; }`. So an
   unborn piece does NOT age (its full life begins at birth), skips physics + trail + render, and still
   counts as alive so the loop persists through the whole window (no premature auto-detach). `spawn()`
   resets `delay = 0` (the fail-closed pool-reuse guard, like `landed`) and now RETURNS its slot, so
   the burst loop can stamp `pool.delay[slot] = staggerSec * i / count` -- but only when armed
   (`if (staggerSec > 0)`), so the OFF path never writes and the column stays 0.

5. **Fail closed.** `staggerSec = nonneg(stagger, 0) / 1000` (NaN / negative / undefined / Infinity ->
   0 via nonneg's finite-guard + default -> synchronous). The delay is a time offset of the finite
   spawn origin, so no non-finite draw position can result from any input.

6. **Burst-only.** `spray()` already emits over time; layering a second timing knob on it is redundant.
   The shared `delay` column is simply always 0 for spray pieces, so the gate is inert for them.

7. **No reduced-motion effect.** The static accessible fan (`renderStaticBurst`) lays pieces out with
   no per-piece delay or animation, so `stagger` is inert there -- consistent with every motion feature.

8. **Hot path untouched.** The gate is one Float32 read + compare per alive piece per frame (mirrors the
   existing `life <= 0` / `!landed` guards); the delay is a single Float32 store at spawn. Zero
   allocation.

## Consequences / proof

- Unit suite 157 -> 165. New `describe('stagger / staggered emission')` asserts: OPT-IN / fail-closed
  (off / 0 / negative / NaN / Infinity / non-numeric all reproduce COMMITTED_HASH); prior gates still
  hold with stagger off (FLOOR_HASH, BOX_HASH); a committed STAGGER_HASH, distinct from COMMITTED +
  deterministic on replay; NON-VACUOUS timing (the `translates` probe: a staggered burst draws far
  fewer pieces in the early frames, converging to all `count` per frame once the window elapses);
  FULL-LIFE-FROM-BIRTH (a late-born piece is still alive after an equal-life synchronous burst is fully
  dead); `assertFinite` under stagger + gravity + bounce in a box; spray IGNORES stagger; reduced-motion
  inert.
- Torture: T5 threads a random `stagger` window (half off) through the differential burst fuzz (two
  same-seed instances stay bit-identical -- the delay schedule is deterministic, zero rng). T6 adds a
  staggered-burst-mid-emission lane -- a huge window over a full pool keeps ~every piece UNBORN across
  the measured window, so the birth-gate unborn branch runs for ~MAXP pieces/frame -- still ~0 B/frame.
  T1 adds stagger poison (NaN / negative / 0 / Infinity / non-numeric, plus a valid stagger in a
  bouncing box) under the finite-position detector -- all fail closed to a synchronous spawn, nothing
  crashes, no NaN reaches a draw.
- Full gate matrix green: 165 unit; torture ok / BREAK exit 1 / CONTROL=alloc exit 1 / SEED ok; ASCII
  clean; npm pack 1.14.0.
- Cost: one Float32 pool column (4 B/particle); one `spawn()` return value; one guarded Float32 store
  per spawned piece when armed; one int-compare branch per alive piece per frame (the default path).

## Explicitly NOT done (flagged for a future chapter, if ever)

- **Jitter / eased emission curves** -- v1 emits LINEAR / even; front-loaded, back-loaded, or randomized
  (per-piece jittered) births would add an easing knob, and jitter would need a new conditional rng draw.
- **A per-particle-step (ms) unit** -- rejected in decision 2; the window is a fixed duration, not a
  count-scaled gap.
- **Stagger on `spray()`** -- spray already emits over time; a second timing knob is redundant.
- **A stagger on the reduced-motion static path** -- the static fan is a fixed accessible layout;
  emission timing is a motion-time concern.
- **Back-to-front / center-out / random emission ORDER** -- v1 emits in spawn-index order only.
- Any change to the default look, existing presets, the physics integrator, the trail/color/emit
  overlays, or any committed position/trail/color/emit fingerprint when stagger is off.
