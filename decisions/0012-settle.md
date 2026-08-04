# 0012 -- settle / pile (the first behaviour / lifecycle feature)

- **Status:** accepted (implemented in v1.11.0)
- **Date:** 2026-08-04
- **Session:** F10, the release after F9 (v1.10.0 vortex). Where 0005-0009 extended the PHYSICS and
  0010 opened the RENDER path (trails) and 0011 added the first DIRECTED force (vortex), this is the
  first feature on the BEHAVIOUR axis -- it changes how a particle ENDS, not how it moves or draws.

## Context

By v1.10.0 the force model is complete (uniform, time-varying, and directed forces; a full
reflecting bounding box) and the render path has trails. Every chapter so far changed a particle's
MOTION or its APPEARANCE; none changed its LIFECYCLE. A particle either bounces on the `floor`
forever (energy bleeding to `bounce` < 1 + `drag`, but never actually stopping at Float32
resolution for a long time) or expires on its life countdown. This chapter adds **settle-and-pile**:
a piece that can no longer bounce off the floor comes to REST -- frozen in place -- and accumulates
into a drift. Snow settling, ticker-tape piling on the ground.

The interesting engineering is not a new force but a new STATE (a per-particle frozen flag) and
proving that (a) freezing is fingerprint-neutral when off and (b) the frozen pile stays zero-GC and
never saturates the fixed pool.

## Decisions

1. **Settle-and-pile, chosen over emitter shapes or a multi-attractor field.** Offered three
   directions on three axes (behaviour / spawn / force). The BEHAVIOUR axis was picked: it is the
   first feature that changes a particle's lifecycle rather than its trajectory, a genuinely new
   KIND of feature. (Emitter shapes -- a spawn-side chapter that mints new fingerprints -- and a
   multi-attractor field -- explicitly out-of-scope in 0011 -- remain future candidates.)

2. **Rest-threshold trigger (bounce, then settle), over immediate-freeze-on-contact.** Confirmed via
   AskUserQuestion. A piece keeps bouncing until the REBOUND is too weak to lift it: right after the
   floor block reflects `vy` (`vy = -vy * bounce`), if `settle != 0 && |vy| < settle` the piece
   freezes. This composes with the existing `floor`/`bounce` box and reads physically (ticker tape
   bounces a few times and comes to rest). Consequences of tying it to the reflected `vy`:
   - With `bounce = 0` the reflected `vy` is `0 < settle`, so a piece rests on FIRST contact (the
     classic pile). A higher `bounce` just makes a piece bounce longer before the rebound decays
     below the threshold (`drag` still bleeds energy each frame, so even `bounce = 1` settles
     eventually -- only a fully-lossless `bounce = 1` + `drag >= 1` would bounce forever). With no
     floor the branch is unreachable, so nothing settles -- a clean fail-closed "needs a floor".
   - The threshold is compared against the reflected (post-bounce) upward speed, so it is literally
     "is the rebound too weak to matter". `|vy| < settle` is written as `vy > -settle && vy < settle`
     to avoid a `Math.abs` call (matching the vortex accel-cap style).

3. **Keep aging + fade in place, over freeze-immortal.** Confirmed via AskUserQuestion, and the
   load-bearing choice for a fixed pool. A settled piece keeps its normal life countdown and fades
   where it rests, then its slot recycles. So the pile is a TRANSIENT drift that builds and melts,
   and the fixed zero-GC pool NEVER saturates -- new bursts always spawn. The rejected alternative
   (freeze immortal = a permanent pile) would fill the pool with frozen pieces; once full, further
   `spawn()`s fail closed (silently no-op), trading pool headroom for permanence. That is a
   defensible future opt-in behind a second flag, but a poor default (a confetti call that silently
   stops working after enough piles). The transient pile is the safe default.

4. **Freeze via an `if (!landed)` wrap around the whole physics span -- the load-bearing property.**
   A `landed` piece must not move OR rotate, robust even if the burst also has wind/gust/sway/vortex.
   The entire physics block (gravity through the wall clamps, including spin/tilt advance and sway)
   is wrapped in `if (!pool.landed[i])`; the life countdown, trail record, life-fade, and render all
   sit OUTSIDE the wrap, so a landed piece keeps ageing, records its (frozen) trail point, fades, and
   draws at its frozen pose. Consequences:
   - **Fingerprint-neutral by CONSTRUCTION when off.** With `settle` never used, `landed[i]` is
     always 0, so `!landed` is always true and the physics runs byte-for-byte as before. Every prior
     committed fingerprint is preserved (default `1569828004`, mixed `3132631460`, wind `2385225781`,
     floored `2679696825`, box `804161759`, turbulence `1630588936`, gust `4074438162`, both
     `15761758`, vortex `1387388835`/`2926753007`/`2039789049`, and the trail `strokeHash 72519212`).
   - The freeze is a true rest: position AND rotation frozen, so a pile lies still and lateral forces
     cannot slide it. (Without the wrap, a landed piece would keep spinning and -- under wind/sway --
     slide along the floor, which is not "at rest".)

5. **Fail-closed reset on pool reuse -- the correctness subtlety.** `spawn()` sets `pool.settle[i]`
   and resets `pool.landed[i] = 0`. Without the reset, a recycled slot could inherit a dead piece's
   `landed = 1`, so a fresh piece would spawn already frozen and skip all physics. (The exact analog
   of the trail `trailN = 0` reset in 0010.)

6. **The rest test lives INSIDE the floor block.** Settle can only ever fire as a piece lands on the
   floor, so the branch is appended to the existing `if (y > floor)` collision (itself opt-in on a
   finite floor). No floor => the branch is unreachable => nothing settles, for free.

7. **Fail-closed coercion.** `settle = nonneg(settle, 0)` -- a speed threshold, so NaN / +-Infinity /
   negative / string / null all coerce to `0` (off) (`nonneg` gates on `Number.isFinite`, so a
   non-finite threshold is off, not "settle on any contact"). A settled piece rests at a
   finite floor Y, so no non-finite draw position can result.

8. **No reduced-motion effect.** The static render (`renderStaticBurst`) does no integration, so a
   piece never crosses the floor and never lands -- consistent with every other motion feature.

## Consequences / proof

- Unit suite 132 -> 141. New `describe('settle / pile')` asserts: the default/floor/box fingerprints
  are byte-identical (the freeze wrap + guard never fire when off); opt-in/fail-closed settle
  (0/NaN/null/-5/'x') == the same bouncy run; the committed `SETTLE_HASH = 4157000621` (distinct
  from bouncy, deterministic on replay); NON-VACUOUS directional effects a bare hash can't see --
  settle ARRESTS lateral drift (a settled pool's x-extent is strictly smaller than a still-sliding
  one under wind), the pile STOPS GROWING while an un-settled pool keeps sliding (the "comes to
  rest" proof: a settled pool's extent is frozen between two late snapshots, an un-settled one's
  keeps growing), pieces pile AT the floor (`maxY == floor`) and a no-floor run overshoots; plus
  assertFinite + contained under settle + sway + wind + gravity in a box; spray honours settle; and
  reduced-motion inert.
- Torture: T5 threads `settle` (nonneg, half off) + a floor through the differential fuzz (landing
  is deterministic across two same-seed instances). T6 adds a fully-settled (frozen) pile lane -- an
  immortal pool falls, bounces, and freezes into a saturated pile, and update() takes the `!landed`
  skip for every piece every frame at the same ~0 B/frame as an active pool. T1 adds settle + floor
  poison (NaN / Infinity / -Infinity / negative / string) under the finite-position detector.
- Full gate matrix green: 141 unit; torture ok / BREAK exit 1 / CONTROL=alloc exit 1 / SEED ok;
  ASCII clean; npm pack 1.11.0.
- Cost: two per-particle pool columns (`settle` Float32 + `landed` Uint8 = 5 B/particle); one extra
  branch per particle per frame (`if (!landed)`); the freeze branch is a compare + three stores.

## Explicitly NOT done (flagged for a future chapter, if ever)

- **Freeze-immortal persistent pile** (the other AskUserQuestion afterlife option) -- saturates the
  fixed pool; deliberately not the default. A future opt-in could add it behind a second flag.
- **Pile height / inter-particle stacking** -- landed pieces all rest on the floor LINE; a true
  pile whose height grows would need per-x-column height tracking + collision, off the zero-GC hot
  path for marginal visual gain.
- **Settle against walls / ceiling** -- rest is floor-only (gravity's natural edge); a sticky-wall
  variant would be a separate knob.
- **Per-shape / per-color settle, or a settle-triggered onLand callback** -- edges are burst-wide
  scalars, matching every prior force knob; a per-landing callback is an allocation/timing concern.
- Any change to the default look, existing presets, the physics integrator, or any committed
  physics/trail fingerprint.
