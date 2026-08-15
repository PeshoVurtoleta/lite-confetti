# 0023 -- tangential drag on the box's non-floor edges (`wallFriction`, the tangential twin of `friction`)

- **Status:** accepted (implemented in v1.22.0)
- **Date:** 2026-08-15
- **Session:** F21, the release after F20 (v1.21.0 friction). friction opened the PHYSICS axis with tangential
  drag on the FLOOR; 0022's "Explicitly NOT done" named exactly one sibling -- "Wall/ceiling tangential
  friction (the natural v2 of THIS feature ...; deferred, one edge at a time, exactly as the box grew out of
  the floor)." This chapter is that v2.

## Context

The engine has had a full axis-aligned bounding box since v1.7.0 -- `floor` + the `wallLeft`/`wallRight`/
`ceiling` edges -- all sharing ONE restitution coefficient `bounce`, which reflects the NORMAL (perpendicular)
velocity component at every edge. But only the FLOOR had a tangential-drag term (v1.21.0 `friction`). A piece
pinned against a wall by wind, or launched up under a ceiling with lateral speed, slid along that edge at
constant tangential velocity, bled only by the GLOBAL, isotropic `drag`. There was no material grip on the
box's other three edges.

This chapter adds **`wallFriction`**: an opt-in scalar in `[0,1]` that, on EACH contact with a NON-floor box
edge, damps the TANGENTIAL velocity component by `1 - wallFriction`. It is the exact structural twin of
v1.21.0 `friction`, applied to the three edges friction does not cover, and the tangential analog to `bounce`'s
single shared restitution: ONE coefficient for the whole box's non-floor edges. Default `0` = frictionless
(today's exact box behaviour). The floor keeps its own separate `friction` knob, byte-for-byte untouched
(`FRICTION_HASH 1451535522` preserved).

Like `friction`, `wallFriction` is a PHYSICS knob -- it perturbs `vx` (ceiling) / `vy` (walls) -> position ->
the MAIN `hash`, so it earns its own committed hash on the position stream, and the rig that pins it MUST
contain a box or no edge branch fires. It costs NO new harness probe and NO decoupling machinery.

## Decisions

1. **One shared scalar for the box's THREE non-floor edges, `[0,1]`, house style.** `wallFriction` default
   `0`. One new `Float32Array` pool column (`wfric`), +4 B/particle (158 -> 162). This mirrors `bounce`'s "one
   restitution for the whole box": the tangential coefficient is likewise ONE knob for the box's non-floor
   edges, not three. A walls-only variant (per 0022's literal "vy at a vertical-wall contact," leaving the
   ceiling frictionless) was REJECTED -- `bounce` never fragmented the box edge-by-edge, so its tangential
   analog should not either; the ceiling rides along.

2. **Damps the TANGENT at each edge -- the component `bounce` does NOT reflect.** `bounce` reflects the NORMAL
   (ceiling/floor reflect `vy`; walls reflect `vx`); `wallFriction` damps the TANGENT (ceiling tangent =
   horizontal = `vx`; wall tangent = vertical = `vy`). So on a ceiling contact `wallFriction` damps `vx`, and
   on a wall contact it damps `vy` -- the OPPOSITE component from what `bounce` reflects at that same edge.
   (The floor's tangent is also horizontal `vx`, which is why the shipped floor `friction` damps `vx`.)

3. **Floor is NOT included -- it keeps its own `friction`.** `wallFriction` covers ONLY `ceil`/`wallL`/`wallR`.
   The floor block (Confetti.js) is left literally unchanged, so `FRICTION_HASH 1451535522` and the floor-off
   byte-identity are preserved bit-for-bit. Two orthogonal knobs: `friction` = floor tangent, `wallFriction` =
   the box's other three edges' tangent.

4. **Coercion: `clamp01(wallFriction, 0)`.** Non-finite/non-numeric/undefined -> `0` (off); `> 1` -> `1` (full
   grip); a NEGATIVE -> `0` (off, NOT an anti-friction multiplier `1 - f > 1` that would AMPLIFY the tangential
   velocity every contact and diverge). Identical reasoning to `friction`/`bounce` clamp01. DOCUMENTED:
   `wallFriction:-1` clamps to `0`, does NOT amplify; `wallFriction:0` is the default off value.

5. **Lives inside the guarded ceiling + wall blocks; needs a box.** The damps are inserted in the existing
   `if (y < ceil)` block (after the vy reflection) and both `if (x < wallL)` / `else if (x > wallR)` branches
   (after each vx reflection). With no box the edges default to their infinity sentinels and none of those
   branches can fire, so `wallFriction` never fires (mirrors friction's "needs a floor"). Guarded on
   `pool.wfric[i] !== 0` so the default does zero work and every committed fingerprint is byte-identical off.

6. **Both burst AND spray.** Inert under reduced motion -- `renderStaticBurst` does no integration and never
   reaches an edge collision, so there is nothing to damp.

7. **Always written at spawn -- NOT load-bearing (contrast scaleTo/fadeOut).** `pool.wfric[i] =
   config.wallFriction` is UNCONDITIONAL, for pool-reuse correctness (a recycled slot must not inherit a prior
   burst's wallFriction). But a `Float32Array` zero-init `0` == "off" is the CORRECT default -- the
   fadeIn/wind/friction situation, NOT the fadeOut/scaleTo fail-closed-wrong-default one. No sentinel.

## The crux

### (a) The tangent/normal inversion (decision 2) -- get the component right at each edge.

At the CEILING (`y < ceil`): `bounce` reflects `vy` (normal). `wallFriction` damps `vx` (tangent), inserted
AFTER the vy reflection: `if (pool.wfric[i] !== 0) pool.vx[i] *= 1 - pool.wfric[i];`. At each WALL (`x < wallL`
and `else if x > wallR`): `bounce` reflects `vx` (normal). `wallFriction` damps `vy` (tangent), inserted AFTER
each vx reflection: `if (pool.wfric[i] !== 0) pool.vy[i] *= 1 - pool.wfric[i];`. The single easiest bug is
damping the SAME component `bounce` just reflected (killing the reflection) -- it must be the OTHER
(tangential) component. Cross-check against the shipped floor `friction`, which damps `vx` at the floor where
`bounce` reflects `vy`.

### (b) No fround sentinel (contrast fadeOut, same as friction).

Default `wallFriction === 0`, `clamp01(0,0) === 0`, and `0` stored in a `Float32Array` reads back exactly `0`
(`Math.fround(0) === 0`, UNLIKE `0.3`). So `if (pool.wfric[i] !== 0)` is FALSE at the default and NEVER fires
-> `vx`/`vy` untouched -> the ceiling/wall blocks are byte-for-byte the pre-1.22.0 values. EVERY committed hash
reproduces off: BOX `804161759`, COMMITTED `1569828004`, FLOOR `2679696825`, WIND `2385225781`, FRICTION
`1451535522`, SETTLE `4157000621`, etc. Do NOT add a `FADE_OUT_DEF`-style const -- the lossy-0.3 trap that
made fadeOut's sentinel load-bearing does not arise here.

### (c) It is a PHYSICS feature: the position hash MOVES, so wallFriction earns its own committed hash.

Like `friction` and unlike the six render overlays, `wallFriction` changes `vx`/`vy` -> `x`/`y`, so an armed
box burst does NOT reproduce BOX_HASH -- it produces a NEW committed `WALLFRICTION_HASH` on the MAIN `hash`.
No new `_env.mjs` probe: the position `hash` witnesses it directly, and the directional/retention proofs ride
the existing hash-neutral `maxY` (v1.6.0) + `maxX`/`minX` (v1.7.0) accessors.

RIG CHOICE (worth recording so a future reader does not "simplify" it back): the plain BOX rig defaults
`bounce:0`, which is a DEGENERATE hash witness. With `bounce:0` the floor zeroes `vy` before a piece reaches a
wall (so the wall `vy`-damp becomes `0 *= ...`, a no-op) and once `vx -> 0` at a wall the strict `x > wallR`
guard never re-fires -- nothing tangential survives to a rounded draw position, so `wallFriction:0.5`
reproduces BOX_HASH byte-for-byte. That is a VALID inertness property (asserted in the unit suite): WITHOUT a
rebound to keep tangential speed alive, there is nothing to bite. The canonical committed hash rig therefore
adds `bounce:0.6`, so pieces RICOCHET and re-strike the walls/ceiling with tangential speed each bounce and
the damp accumulates: `WALLFRICTION_HASH (87358650) = run({ ...BOX, bounce:0.6, wallFriction:0.5 })`, distinct
from that same rig with `wallFriction` off, from `wallFriction:0.9`, and cross-process stable. The two
non-vacuous DIRECTIONAL proofs use dedicated sustained-contact rigs instead of the box hash: a wall-slide
(strong wind INTO `wallRight` + gravity, `vy` damped every frame) whose `maxY` is STRICTLY DECREASING over
`wallFriction {0,0.25,0.5,0.75,1}`, and a ceiling-slide (buoyant `gravity<0` pinning to `ceiling` + strong
lateral wind, `vx` damped every frame) whose `spreadX = maxX - minX` is STRICTLY DECREASING over the same set
-- exercising the wall `vy`-damp and the ceiling `vx`-damp branches independently.

### (d) Finite by construction, and NO double-damping in any single frame.

`v *= (1 - wallFriction)` with `wallFriction` in `[0,1]` is a CONTRACTION -- `|v|` can never grow, finite for
any input with NO accel cap (contrast the vortex's `VORTEX_MAX_ACCEL`). And NO velocity component is ever
damped twice in one frame: floor and ceiling both damp `vx` but at MUTUALLY EXCLUSIVE edges (a valid box's `y`
can't be `> floor` and `< ceil` in one frame); floor `friction` damps `vx` while a wall damps `vy` (different
components); a ceiling+wall corner damps `vx` (ceiling) and `vy` (wall) -- again different components. So on
any single frame each of `vx`/`vy` is damped at most once. The negative-clamps-to-0 rule (decision 4)
guarantees the factor never exceeds 1.

## Consequences / proof

- One new per-particle pool column: `wfric` (Float32, tangential drag on non-floor box edges 0..1); +4
  B/particle, always written at spawn (pool-reuse, not load-bearing). The always-on SoA total is now
  `40xF32 + 2xU8 = 162 B/particle`.
- NO harness change -- reuses the hash-neutral `maxY`/`maxX`/`minX` accessors (crux (c)). The main position
  `hash` witnesses the trajectory change directly. Stated here so a future reader does not add a probe for
  symmetry.
- New committed constant `WALLFRICTION_HASH` (`87358650`), probed with `wallFriction: 0.5` on the bouncing box
  rig (`{ ...BOX, bounce:0.6 }`), cross-process stable, distinct from that rig with `wallFriction` off and
  from `wallFriction: 0.9`.
- Off-identity preserved bit-for-bit: at the default (and explicit `0`, and `NaN`/`Infinity`/`'0.5'`/`null`/
  negative -> 0) the plain BOX rig reproduces `BOX_HASH 804161759` and the box-less rig reproduces
  COMMITTED_HASH `1569828004`; COMMITTED, WIND, FLOOR, FRICTION and SETTLE fingerprints reproduce with
  `wallFriction` present-but-off (the floor `friction` knob is byte-for-byte untouched). No sentinel.
- Non-vacuous (directional): a wall slide's `maxY` and a ceiling slide's `spreadX` are each STRICTLY monotone
  decreasing over `wallFriction {0,0.25,0.5,0.75,1}` -- exercising the wall `vy`-damp and the ceiling
  `vx`-damp branches. Orthogonal to floor `friction`: each moves the stream on its own edge set, and
  `wallFriction` is inert on a floor-only rig (reproduces `FRICTION_HASH`).
- Torture: t5 fuzz threads a random `wallFriction` (half at 0, else `[0,1]`) alongside the random box +
  friction through the same-seed burst AND spray differential (draws no rng); t6 adds a wall-friction
  immortal-pool lane (16) -- pieces driven into a wall of a tight box + `wallFriction:0.3`, the wall/ceiling
  damp firing every frame -- at ~0 B/frame, SOAK window `maxMajor:0`; t1 poisons `wallFriction`
  (NaN / +-Infinity / non-numeric / null / {} -> 0; legal extremes 0, -5 -> 0, 1e-9, 1) under wind + a
  bouncing box; t3 A13 proves a recycled slot does not leak a stale `wallFriction` via the hash-neutral `maxY`
  snapshot witness (instance A: `wallFriction:0.9` wall-slide burst, drained, then a plain `wallFriction:0`
  wall-slide burst; instance B fresh: only the plain burst; `A.maxY === B.maxY` over the cycles = no leak; the
  armed 0.9-vs-0 `maxY` delta is non-zero = non-vacuous). NOT a cumulative-hash replay (per the
  retention-phrasing rule).
- Unit suite 237 -> 248 (+11). t7/t8/t9 unchanged: no shared or global state was added.

## Explicitly NOT done

- Per-edge tangential coefficients (a separate `wallFriction`/`ceilingFriction`; rejected -- `bounce` uses ONE
  shared restitution for the whole box, so the tangential analog is ONE shared coefficient).
- Merging floor `friction` and `wallFriction` into a single box-wide `friction` (would re-baseline
  `FRICTION_HASH` and conflate the floor's landing/pile semantics with the wall grip; two knobs stays clean).
- `spinFriction` / angular-velocity damping (the runner-up; couples rotation into the position stream via the
  turbulence curl phase -- a different, harder chapter if ever).
- A static/kinetic split, stiction threshold, or velocity-/normal-force model (one linear coefficient only,
  matching `bounce` and `friction`).
- An anti-friction / negative "boost" (rejected in decision 4; clamps to 0).
- `wallFriction` on the reduced-motion static path (no integration there).
- Any change to the default look / presets / `drag` / `bounce` / `friction`, or to any committed fingerprint
  when `wallFriction` is off.
