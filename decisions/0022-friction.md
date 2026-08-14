# 0022 -- tangential floor drag (`friction`, the first PHYSICS feature since settle; opens a new axis)

- **Status:** accepted (implemented in v1.21.0)
- **Date:** 2026-08-15
- **Session:** F20, the release after F19 (v1.20.0 fadeOut). The opacity axis closed with fadeOut, so this
  chapter OPENS a fresh one: the first PHYSICS feature since `settle` (v1.11.0), after six straight render
  overlays (align/spinRate/scaleTo/flutterRate/fadeIn/fadeOut). The tangential complement to `bounce`.

## Context

The engine has a full boundary system -- `floor` + `bounce` (v1.6.0), the `wallLeft`/`wallRight`/`ceiling`
box (v1.7.0), and `settle` (v1.11.0, a hard rest-freeze once the reflected `|vy|` drops below a threshold) --
but NOTHING damps a piece's HORIZONTAL velocity when it is in contact with the floor. A piece that lands with
lateral speed either freezes instantly (`settle`) or keeps sliding at constant `vx` (bled only by the GLOBAL,
isotropic `drag`). There is no *tangential* floor drag: a piece cannot skid to a stop, or land-and-slide with
a material-dependent grip.

This chapter adds **`friction`**: an opt-in per-particle scalar in `[0,1]` that, on EACH floor-contact frame,
multiplies `vx` by `1 - friction`. `0` (default) = frictionless (today's exact behaviour), `1` = full grip
(horizontal stop on the first contact frame), `0.2` = a long skid, `0.8` = a short one. It is the tangential
complement to `bounce`, which reflects the NORMAL (vertical) component: on one contact, `bounce` handles Y and
`friction` handles X, disjoint and multiplicative.

Unlike the six render overlays before it, `friction` is a PHYSICS knob -- it perturbs `vx` -> `x` -> the MAIN
position `hash`, so it earns its own committed hash on the position stream (like wind/floor/box), and the rig
that pins it MUST contain a `floor` or the branch never fires. But it costs NO new harness probe and NO
decoupling machinery.

## Decisions

1. **One scalar, `[0,1]`, house style.** `friction` default `0` (off). Semantics: on each floor-contact
   frame, `vx *= 1 - friction`. One new `Float32Array` pool column (`fric`), +4 B/particle. Isotropic in the
   tangent (a horizontal floor has one tangent, X); orthogonal to `bounce` (normal/Y).

2. **Coercion: `clamp01(friction, 0)`.** Non-finite/non-numeric/undefined -> `0` (off); `> 1` -> `1` (full
   grip); a NEGATIVE -> `0` (off, NOT an anti-friction speed-up). A negative multiplier `1 - f > 1` would
   AMPLIFY `vx` every contact and diverge, so clamp01 forbids it -- the same "a damping/restitution
   coefficient has no meaning outside [0,1]" reasoning that makes `bounce` clamp01. DOCUMENTED: `friction:-1`
   clamps to `0` (frictionless), does NOT amplify; `friction:0` is the default off value.

3. **Lives INSIDE the floor block; needs a `floor`.** The damp is inserted in the
   `if (pool.y[i] > pool.floor[i])` block, AFTER the `vy` reflection and BEFORE the settle test. With no floor
   the branch is unreachable, so friction never fires (mirrors settle's "needs a floor" rule). Guarded
   `if (pool.fric[i] !== 0)` so the default does zero work and every committed fingerprint is byte-identical
   when off.

4. **Both burst AND spray.** Inert under reduced motion -- `renderStaticBurst` does no integration and never
   reaches a floor collision, so there is nothing to damp.

5. **Always written at spawn -- NOT load-bearing (contrast scaleTo/fadeOut).** `pool.fric[i] = config.friction`
   is UNCONDITIONAL, for pool-reuse correctness (a recycled slot must not inherit a prior burst's friction).
   But a `Float32Array` zero-init `0` == "off" (frictionless) is the CORRECT default, so unlike scaleTo/fadeOut
   the write is not a fail-closed *requirement* -- it is the fadeIn/wind situation (the zero-init default
   happens to coincide with "off"). Stated here so a future reader does not miscite this as the load-bearing
   case.

## The crux

### (a) Off byte-identity, and why there is NO fround sentinel.

Default `friction === 0`, `clamp01(0, 0) === 0`, and `0` stored in a `Float32Array` reads back as exactly `0`
(`Math.fround(0) === 0` -- `0` is representable, UNLIKE `0.3`). So the guard `if (pool.fric[i] !== 0)` is
FALSE at the default and NEVER fires -> `vx` is untouched -> the position update is byte-for-byte the
pre-1.21.0 value. EVERY prior committed hash reproduces: COMMITTED `1569828004`, MIXED, WIND `2385225781`,
FLOOR `2679696825`, BOX `804161759`, TURB/GUST/TURBGUST, TRAIL `72519212`, ATTRACT/SWIRL/VORTEX, SETTLE
`4157000621`, COLOR, the EMIT trio, STAGGER, and the render-channel hashes (ALIGN/SPINRATE/SCALE/FLUTRATE/
ALPHA/FADEOUT). This is the deliberate CONTRAST with fadeOut's `FADE_OUT_DEF = Math.fround(0.3)`: that const
was load-bearing ONLY because `0.3` is not representable in Float32; friction's `0` default has NO such
problem, so NO sentinel const is added. Do not "add one for symmetry".

### (b) It is a PHYSICS feature: the position hash MOVES, so friction earns its own committed hash.

Unlike the six render overlays, friction changes `vx` -> `x`, so an armed friction burst does NOT reproduce
the floorless position hash -- it produces a NEW committed `FRICTION_HASH` on the MAIN `hash`. The canonical
friction rig is therefore the FLOOR rig + `friction:0.5` (a floor MUST be present or nothing fires), and the
headline assertion is `FRICTION_HASH (1451535522) !== FLOOR_HASH (2679696825)` -- friction demonstrably
changed the trajectory. At `friction:0` that same rig reproduces `FLOOR_HASH` exactly (opt-in
fingerprint-safe). No new `_env.mjs` probe: the position `hash` already witnesses it, and the directional /
retention proofs ride the existing hash-neutral `sumX` (wind v1.5.0) + `maxX`/`minX` (box v1.7.0) accessors.
This repeats fadeOut's "second knob at zero harness cost" virtue, on the physics side.

### (c) Finite by construction -- a contraction, so NO accel cap (contrast the vortex).

`vx *= (1 - friction)` with `friction` clamped to `[0,1]` is a CONTRACTION (factor in `[0,1]`): `|vx|` can
never grow, so positions stay finite for any input with NO accel cap. This is strictly simpler than the
vortex (v1.10.0), whose anti-spring (negative `attract`) is exponentially unstable and needed
`VORTEX_MAX_ACCEL` to bound growth. The negative-clamps-to-0 rule (decision 2) is what guarantees the factor
never exceeds 1.

### (d) Interaction with settle/landed and bounce -- no double-application, no ordering hazard.

The whole physics block is skipped for a `landed` piece (`if (!pool.landed[i])`), and a landed piece already
has `vx == 0`, so friction never runs on a frozen piece. Placed BEFORE the settle test, friction damps only
`vx`; the settle test reads `|vy|` only, so friction cannot change WHETHER a piece settles this frame (only
how fast it stops sliding before it does). `bounce` reflects `vy` (normal), `friction` damps `vx` (tangent) --
disjoint components on the same contact. For `bounce:0` + no-settle the piece is clamped to the floor every
frame, so friction bites every frame and `vx` decays geometrically to ~0 (a skid to rest); for `bounce>0`
friction bites once per bounce contact (horizontal speed bleeds a little each landing) -- both physically
correct.

Note on the unit assertions: friction acts ONLY at floor contact, so it cannot undo the horizontal distance a
piece covers WHILE AIRBORNE (dominated in the test rig by the `pump(1,1000)` prime frame). An absolute
"friction:1 arrests the slide almost entirely" claim is therefore false under the harness; the stable, true
property is MONOTONICITY -- `spreadX` shrinks strictly as friction rises (`0 > 0.25 > 0.5 > 0.75 > 1`) -- and
that is what the unit suite asserts.

## Consequences / proof

- One new per-particle pool column: `fric` (Float32, tangential floor drag 0..1); +4 B/particle, always
  written at spawn (pool-reuse, not load-bearing). The always-on SoA total is now
  `39xF32 + 2xU8 = 158 B/particle`.
- NO harness change -- reuses the hash-neutral `sumX`/`maxX`/`minX` accessors (crux (b)). The main position
  `hash` witnesses the trajectory change directly.
- New committed constant `FRICTION_HASH` (`1451535522`), probed with `friction: 0.5` on the FLOOR rig,
  cross-process stable, distinct from `FLOOR_HASH 2679696825` and from `friction: 0.9`.
- Off-identity preserved bit-for-bit: at the default (and explicit `0`, and `NaN`/`Infinity`/`'0.5'`/`null`/
  negative -> 0) the FLOOR rig reproduces `FLOOR_HASH 2679696825` and the floorless rig reproduces
  COMMITTED_HASH `1569828004`; WIND, BOX, and SETTLE fingerprints reproduce with friction off. No sentinel.
- Non-vacuous (directional): a floor slide under wind SHRINKS with friction -- `spreadX` strictly monotone
  decreasing over `0 > 0.25 > 0.5 > 0.75 > 1`, and `sumX` (net drift) differs from frictionless. A bare hash
  cannot show this; the hash-neutral extent/drift probes do.
- Composition: `{floor, bounce:0.5, settle:80, friction:0.6}` stays finite and the pool recycles to `count 0`;
  friction + settle reach rest no later than settle alone.
- Torture: t5 fuzz threads a random `friction` (half at 0, else `[0,1]`) with a random finite `floor` through
  burst AND spray on the same-seed differential (friction draws no rng); t6 adds a floor-friction immortal-pool
  lane (floor just below spawn + `friction:0.3`) at ~0 B/frame, SOAK window `maxMajor:0`; t1 poisons `friction`
  (NaN / +-Infinity / non-numeric / null / {} -> 0; legal extremes 0, -5 -> 0, 1e-9, 1) under wind + a
  bouncing box; t3 A12 proves a recycled slot does not leak a stale `friction` via the hash-neutral `sumX`
  snapshot witness (instance A: `friction:0.9` floor burst, drained, then a plain `friction:0` floor burst;
  instance B fresh: only the plain burst; `A.sumX === B.sumX` over the cycles = no leak; the armed 0.9-vs-0
  `sumX` delta is non-zero = non-vacuous). NOT a cumulative-hash replay.
- Unit suite 226 -> 237 (+11). t7/t8/t9 unchanged: no shared or global state was added.

## Explicitly NOT done

- Wall/ceiling tangential friction (the natural v2 of THIS feature -- friction on the `vy` component at a
  vertical-wall contact; deferred, one edge at a time, exactly as the box grew out of the floor).
- Anisotropic / per-axis GLOBAL drag (the current `drag` is isotropic and global; splitting it moves EVERY
  committed hash -- a breaking re-baseline, not an opt-in).
- Per-particle mass / size-dependent friction or drag (needs a spawn column feeding an existing term; muddies
  the drag fingerprint; a separate chapter).
- A static/kinetic split or a stiction threshold (one linear coefficient only, matching `bounce`'s single
  restitution -- no second knob).
- Friction as anything but a per-contact `vx` contraction (no velocity-dependent or normal-force model; keeps
  it a pure, finite, rng-free multiply, and finite with no accel cap -- crux (c)).
- Friction on the reduced-motion static path (no integration there).
- An anti-friction / negative "boost" (rejected in decision 2; clamps to 0).
- Any change to the default look / presets / `drag` / `settle` / `bounce`, or to any committed fingerprint
  (position/rotate/scale/stroke/color/alpha) when friction is off.
