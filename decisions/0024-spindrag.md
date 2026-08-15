# 0024 -- angular-velocity retention (`spinDrag`, the angular mirror of the linear `drag`)

- **Status:** accepted (implemented in v1.23.0)
- **Date:** 2026-08-15
- **Session:** F23, the release after F22 (v1.22.0 wallFriction). wallFriction completed the box's tangential
  model (floor `friction` + the three-edge `wallFriction`); 0023's "Explicitly NOT done" named `spinFriction`
  (a contact-only tumble kill) as a deferred sibling. This chapter takes a different, higher-value axis: the
  AMBIENT angular decay that bites on every burst, not only at a box edge.

## Context

The integrator has damped a piece's TRANSLATION every frame since day one -- `vx *= drag; vy *= drag` (default
`drag` 0.98), so a piece approaches a terminal velocity instead of accelerating forever. But its ANGULAR
velocity was never damped: `spinV` is drawn once at spawn (`(rng.next() - 0.5) * 10` rad/s) and
`spin += spinV*dt` advances the tumble at that birth rate for the piece's whole life. A chip spun just as fast
the instant before it died as at birth. This is the last unmirrored asymmetry in the integrator, and this
house ships mirrors: wind:gravity (v1.5.0), ceiling:floor (v1.7.0), fadeOut:fadeIn (v1.20.0),
wallFriction:friction (v1.22.0).

This chapter adds **`spinDrag`**: an opt-in scalar in `[0,1]`, default `1` (off), that each frame -- immediately
BEFORE the spin advance -- multiplies `spinV *= spinDrag`, so the tumble decays exactly as `drag` decays
translation. `1` = off (tumble forever, today's exact look), `0.95` = settle to a lazy drift, `0` = freeze at
the birth angle.

`spinDrag` is the angular twin of `drag`, but it occupies a subtler determinism position than the earlier
physics knobs (`friction`/`wallFriction`): those perturb `vx`/`vy` -> position unconditionally, so they always
move the main position hash. `spinDrag` perturbs `spin`, which reaches position through ONLY ONE path -- the
turbulence curl -- so it is a HYBRID: a pure render-rotation effect when turbulence is off, a position effect
when turbulence is on. That single fact drives every decision and the crux below.

## Decisions

1. **One scalar, retention semantics, `clamp01(spinDrag, 1)`.** Default `1`. One new `Float32Array` pool
   column (`sdrag`), +4 B/particle (162 -> 166 = 41 x Float32 + 2 x Uint8). Coerced like `drag`/`bounce`
   (`clamp01`), NOT like `spinRate` (`num`): a retention has no DIRECTION, so a NEGATIVE clamps to `0` (an
   instant spin freeze -- a legitimate finite value, the angular twin of the already-legal `drag: 0`, NOT a
   fallback to the default), non-finite/undefined -> `1` (off), `> 1` -> `1` (which would AMPLIFY spin every
   frame and diverge). `spinRate` admits negatives only because reverse rotation is a real direction; a
   retention factor has none.

2. **Damps `spinV` ONLY -- never `tiltV`.** `tilt` (the wobble phase) feeds BOTH the turbulence curl
   (`tp = tilt*1.7 + spin`) AND `sway` (a direct `x` write). Damping `tiltV` would move positions on any
   swaying burst, would give `spinDrag` more than one position-coupling path, and would collide with
   `flutterRate`'s `tilt0` decoupling narrative. `spinDrag` touches the angular tumble stream and nothing else.

3. **The damp lives immediately before the spin advance, inside the `!landed` block.**
   `if (pool.sdrag[i] !== 1) pool.spinV[i] *= pool.sdrag[i];` on the line before `spin += spinV*dt`, mirroring
   the placement of `vx *= drag` before the position update. Guarded on `!== 1`, so an off burst pays zero new
   bytes per frame and every committed fingerprint -- `rotateHash` included -- is byte-identical. `1` is exactly
   representable in Float32, so there is NO fround sentinel (contrast fadeOut's load-bearing
   `FADE_OUT_DEF = Math.fround(0.3)`); do not add one "for symmetry."

4. **No render-block change and no harness change.** The render rotation (`rot = pool.spin[i]`) reads the
   now-slower-accumulating spin for free; `spinDrag` is a pure INTEGRATOR edit. It reuses `rotateHash` + the
   hash-neutral `lastRotate` witness (v1.15.0) and the main position hash -- `test/_env.mjs` is untouched. It
   composes with `spinRate` (which render-scales the accumulated tumble about `spin0`) and `align` without
   conflict: they read the same `spin`, one damps its growth, the others scale/blend the result.

5. **Spawn write unconditional and LOAD-BEARING.** `pool.sdrag[i] = config.spinDrag;` at spawn. A Float32
   zero-init `0` would mean "instant freeze" -- a wrong default on a recycled slot. This is the
   scaleTo/flutterRate/fadeOut case (default != 0, the write carries the correct value), NOT the
   friction/wallFriction case (default 0, zero-init already correct). The t3 A14 retention proof pins it.

6. **burst AND spray; inert under reduced motion.** `renderStaticBurst` does no integration and never advances
   `spin`/`spinV`, so the static path is untouched.

## The crux -- a HYBRID knob with a single position-coupling path (the false-purity trap)

`pool.spin` is read in EXACTLY two places: the render rotation, and the turbulence curl phase
`tp = tilt*1.7 + spin` (only inside `if (turb != 0)`). So `spinDrag` has ONE position-coupling path:

- **turbulence OFF:** slowing `spin`'s accumulation moves ONLY the render rotation. The position stream is
  byte-identical; only `rotateHash` moves. It LOOKS exactly like the six pure render overlays
  (align/spinRate/scaleTo/flutterRate/fadeIn/fadeOut).
- **turbulence ON:** the curl reads `spin`, so a slower tumble bends the per-particle wander -> `vx`/`vy` ->
  `x`/`y`. The position stream MOVES.

The trap: an "off/on position hash preserved" assertion written on the DEFAULT (turbulence-off) rig passes
VACUOUSLY while `spinDrag` silently perturbs positions on any turbulent burst -- the same class of
plausible-but-wrong assertion that bounced earlier chapters (wallFriction's canonical-rig flaw; friction's
monotonicity reframe). Resolution -- pin BOTH channels as deliberate, falsifiable claims:

- `rotateHash` moves on a turbulence-OFF rig (committed `SPINDRAG_ROT_HASH`), AND the position hash is
  preserved there -- asserted ONLY on turbulence-off rigs.
- the position hash MOVES on a turbulence-ON rig (committed `SPINDRAG_TURB_HASH`, distinct from
  `TURB_HASH 1630588936` on the SAME `turbulence: 500` baseline) -- the coupling is real.
- a sway-armed, turbulence-off rig STILL preserves the position hash (proves `tiltV` is untouched -- decision
  2, the single coupling path).

`spinDrag` is documented everywhere as a PHYSICS knob that is position-neutral only when turbulence is off --
never as a pure render overlay.

## Consequences / proof

- Committed hashes: `SPINDRAG_ROT_HASH 3829166209` (rotateHash, `spinDrag: 0.9`, canonical turbulence-off rig,
  cross-process stable, distinct from off and from 0.5); `SPINDRAG_TURB_HASH 4289557192` (position hash,
  `{ turbulence: 500, spinDrag: 0.9 }`, distinct from `TURB_HASH 1630588936`). At `spinDrag: 1` (and every
  fail-closed input -> 1) every prior fingerprint including `rotateHash` reproduces bit-for-bit.
- Non-vacuous via `lastRotate`: on a single-piece rig, `|lastRotate - spin0|` is strictly monotone decreasing
  over `spinDrag in {1, 0.99, 0.95, 0.9, 0}`, and exactly `0` at `spinDrag: 0` (frozen at the birth angle).
- Finite by contraction: `spinV *= spinDrag` with `spinDrag in [0,1]` can only shrink `|spinV|`; finite for any
  input with NO accel cap (contrast the vortex's `VORTEX_MAX_ACCEL`).
- Retention (t3 A14): a recycled slot does not leak a stale `sdrag`. Proven with a SYMMETRIC-history
  `lastRotate` snapshot -- the control runs the IDENTICAL 5-cycle drain history but arms `spinDrag: 1` (off),
  so both instances share the ticker stop/restart timing (the first-frame dt after each drained idle depends
  on it, and `lastRotate` is a raw accumulated angle sensitive to that dt); the ONLY remaining difference is
  the armed value the spawn write must overwrite. Equal angles prove no leak; the armed-live check keeps the
  witness non-vacuous. (A naive fresh-vs-recycled control diverges ~0.066 rad purely from the ticker-restart
  timing -- a false failure; hence the symmetric history.)
- Alloc: one new Float32 column, no hot-path allocation (the damp is a guarded read + compare + one multiply
  on a Float32 already in cache). t6 spin-damped immortal-pool lane (spinDrag + turbulence + flutter) at
  ~0 B/frame, SOAK 10000-frame window maxMajor:0.
- Unit suite 248 -> 259 (+11). t5 threads a random spinDrag (half off) through the differential; t1 poisons it
  (NaN/+-Infinity/non-numeric/null/{} -> 1; legal extremes 0, -5 -> 0, 1e-9, 1e9 -> 1). t7/t8/t9 unchanged (no
  shared/global state added).

## Explicitly NOT done

- `spinFriction` (contact-only tumble kill on floor/box edges) -- the contact-friction family is complete
  (floor + three edges); `spinDrag` is the ambient analog and fires everywhere. Re-deferred from 0023.
- Per-particle mass / size-dependent linear or angular drag -- deferred from 0022 (muddies the drag
  fingerprint; a separate chapter).
- A separate `tiltDrag` / wobble-decay knob -- `flutterRate` already owns the wobble SPEED axis; damping
  `tiltV` would couple into sway + the turbulence curl (decision 2).
- Damping `spinV` at spawn (a birth-rate scale) -- that is `spinRate`'s render scale; `spinDrag` is a per-frame
  integrator decay, a different axis.
- An angular accel cap -- unneeded (a `[0,1]` contraction is finite by construction; T1 pins `1e9 -> 1`).
- A non-uniform / eased decay curve -- linear per-frame retention only, matching the linear `drag`.
- Any change to the default look, presets, physics positions when off, or any committed fingerprint
  (`rotateHash` included) when `spinDrag` is off.
