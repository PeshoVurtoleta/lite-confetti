# 0019 -- tumble-wobble speed (`flutterRate`, the flutter analog of `spinRate`)

- **Status:** accepted (implemented in v1.18.0)
- **Date:** 2026-08-10
- **Session:** F17, the release after F16 (v1.17.0 scaleTo). Delivers the `flutterRate` + `tilt0` item that
  decision 0017 (spinRate) explicitly deferred: "the flutter analog of spinRate".

## Context

`flutter` (v1.3.0) sets the DEPTH of the 3D-ish X-scale wobble --
`wobbleScale = 1 - flut*0.5*(1 - |cos(tilt)|)` -- driven by the per-particle `tilt` phase the integrator
advances every frame (`tilt += tiltV*dt`). The wobble's SPEED has never had a public knob: `tiltV` is a
fixed seeded random (`1 + rng.next()*4`). So a slow lazy flutter, a wobble frozen at a chosen tilt, or a
fast shimmer were all unreachable. This chapter adds **`flutterRate`**: an opt-in multiplier on the
ACCUMULATED wobble phase about a stored birth pivot `tilt0`. `0` = frozen wobble at each piece's OWN varied
birth tilt, `0.3` = a slow lazy flutter, `1` = as seeded (default), `2` = a fast shimmer, negative =
reversed phase. It is the SPEED knob to what `flutter` opened as DEPTH -- exactly as `spinRate` (v1.16.0)
completed what the seeded `spin` opened on the rotation axis.

The engineering question is the determinism contract, as with every render overlay -- but the wobble has a
hazard: the turbulence curl phase READS `pool.tilt` every frame (`tp = tilt*1.7 + spin`), and `sway` reads
it too (`sin(tilt)`). Scaling `tiltV` at spawn, or mutating `pool.tilt`, would perturb BOTH -- diverging the
seeded POSITION stream whenever turbulence or sway is armed.

## Decisions

1. **Render-time PHASE SCALE about a birth pivot, not a `tiltV` spawn scale -- the decoupling crux.** Exactly
   like `spinRate`/`spin0`: store a birth pivot `tilt0` at spawn, and at RENDER compute a scaled phase
   `tiltPhase = tilt0 + (tilt - tilt0) * flutterRate` that feeds ONLY the `wobbleScale` formula. `pool.tilt`
   is never mutated, so `flutterRate` is fully DECOUPLED from turbulence AND sway, and the seeded position
   stream is byte-identical off, on, and on-with-turbulence.

2. **Rate-only about the birth pivot** (mirror of spinRate decision 2). Only the accumulated delta
   `(tilt - tilt0)` is scaled, so `flutterRate: 0` freezes each piece at its OWN varied birth tilt (a
   different constant wobble per piece), NOT collapsing every piece to `cos(0)=1`. A whole-phase multiply
   (`tiltPhase = tilt * flutterRate`) is rejected for the same reason spinRate rejected it.

3. **Reuses the existing `scaleHash` probe -- no new committed-hash channel.** `wobbleScale` feeds
   `ctx.scale(sx, sy)` (sx = wobbleScale, or wobbleScale * s when scaleTo is armed), so `flutterRate` ON
   changes the SCALE call the harness already folds into `scaleHash`. It earns its OWN committed scaleHash
   value (`FLUTRATE_HASH`) at `flutterRate != 1`, distinct from off -- but adds NO new hash channel (the
   selling point vs scaleTo, which needed a brand-new probe). rotateHash, colorHash, strokeHash, and the
   position `hash` are all untouched. The only harness addition is a one-line `lastScaleX` X-factor witness
   (+ accessor) beside `lastScale`, needed because the wobble lives on X (Y stays 1 for flutterRate).

4. **Coercion: `num(flutterRate, 1)`.** Any FINITE value passes (`0` frozen, negative reversed, `2` fast);
   non-finite / non-numeric / undefined -> `1` (off). NOT `clamp01` -- it is a rate multiplier, not a 0..1
   blend. Same precedent and rationale as `spinRate`. `flutterRate: 0` is a legitimate value (frozen wobble
   at birth tilt), independent of `flutter` (the DEPTH).

5. **Both burst AND spray**, like flutter/align/spinRate/scaleTo. Inert under reduced motion --
   `renderStaticBurst` does no `tilt` advance and never calls `ctx.scale`.

6. **Always written at spawn, never zero-init.** `pool.tilt0[i] = pool.tilt[i]` and
   `pool.flutterRate[i] = config.flutterRate` are UNCONDITIONAL in `spawn()`. A Float32Array default of `0`
   for `flutterRate` would mean "frozen wobble" on a recycled slot that skipped the write (fail-closed --
   the default must be 1). `tilt0` mirrors the `spin0 = spin` birth-pivot capture.

## The crux

### (a) One render-local `tiltPhase`, feeding ONLY the wobble. `pool.tilt` is NEVER mutated.

```js
const a = pool.flut[i];
let tiltPhase = pool.tilt[i];
if (pool.flutterRate[i] !== 1) {
    const t0 = pool.tilt0[i];
    tiltPhase = t0 + (pool.tilt[i] - t0) * pool.flutterRate[i];
}
const wobbleScale = 1 - a * 0.5 * (1 - Math.abs(Math.cos(tiltPhase)));
```

- OFF is byte-identical: the guard is false, `tiltPhase === pool.tilt[i]`, the SAME value fed today. Cost
  off: one Float32 read + one compare per alive piece per frame.
- ON keeps the POSITION stream byte-identical: `flutterRate` never touches `pool.tilt`, `x`/`y`/`vx`/`vy`,
  or any rng draw. The turbulence phase and the sway both read the untouched `pool.tilt`, so a flutter-rated
  burst -- even with turbulence armed -- reproduces the same-seed plain burst's position hash EXACTLY
  (COMMITTED_HASH `1569828004`), and is invisible to rotateHash and colorHash too. Only the wobble moves,
  earning its own committed `FLUTRATE_HASH` (`4094960833`).
- Finite: `tilt0`, `tilt`, and `flutterRate` (after `num`) are all finite, so `tiltPhase` is finite -> `cos`
  in `[-1,1]` -> `wobbleScale` finite for any finite flutterRate.

### (b) `flutterRate` is inert when `flutter == 0` -- by construction, and correct.

`flutter` (depth) multiplies the whole `(1 - |cos|)` term; at `flutter: 0`, `wobbleScale = 1` regardless of
`tiltPhase`, so `flutterRate` has nothing to scale. This is CORRECT (a zero-depth wobble has no speed) and
matches the house model. CONSEQUENCE for tests: every flutterRate rig MUST set `flutter: 1` (or leave the
default 1) to be non-vacuous.

### (c) Why `scaleHash` carries it but `lastScale` does not -- a one-line witness addition.

`flutterRate` perturbs `sx = wobbleScale` (the X factor); `sy` stays `1` when scaleTo is off. The harness
`scale(x, y)` sink folds BOTH args into `scaleHash`, so `scaleHash` DOES capture the X change -- so
`FLUTRATE_HASH` works with no new channel. BUT the non-vacuous per-frame witness `lastScale` records only
`y` (which stays 1 for flutterRate), so a one-line `lastScaleX = x` witness (+ accessor) is added beside it,
the X analog of `lastScale`. Not a new hash channel; the flutterRate analog of spinRate's `lastRotate`
rate-witness, needed because the wobble lives on X.

## Consequences / proof

- Two new per-particle pool columns: `tilt0` (Float32, the birth wobble pivot) and `flutterRate` (Float32,
  the render-time speed multiplier); +8 B/particle, both always written at spawn. The tumble/scale render
  family now totals `align 4 + spin0 4 + spinRate 4 + scaleTo 4 + tilt0 4 + flutterRate 4 = 24 B/particle`.
- One harness witness `lastScaleX` (+ accessor) in `test/_env.mjs`; `scaleHash` is UNCHANGED (already folds
  both x and y), so no committed hash moves.
- New committed constant `FLUTRATE_HASH` (`4094960833`), probed on the canonical seed-12345 rig (flutter:1)
  with `flutterRate: 2`, cross-process stable and distinct from off, from `flutterRate: 0`, and from
  `flutterRate: 0.5`.
- Torture: t5 fuzz threads a random `flutterRate` (half at 1, else `[-2,3]`) through burst AND spray, riding
  the existing `scaleHash` differential set; t6 adds lane (12), a flutter-rated live pool
  (`flutterRate: 0.35` + `flutter: 1` + `turbulence: 300`) measured at ~0 B/frame (proving the decoupled
  render fold allocates nothing while turbulence advances the real tilt); t1 poisons `flutterRate`
  (NaN / +-Infinity / non-numeric / null / {} -> 1; legal extremes 0, -5, 1e-9, 1e6) under flutter + wind +
  turbulence + a bouncing box; t3 A9 proves a single-slot pool recycles a `flutterRate: 0` piece without
  leaking the stale rate (the recycled plain piece's X wobble VARIES again).
- Unit suite 193 -> 204 (+11). t7/t8/t9 unchanged: no shared or global state was added.

## Explicitly NOT done

- A wobble-phase OFFSET knob (`flutterPhase`, a birth-tilt override) -- rate only, like spinRate.
- Per-particle flutterRate jitter / a range (one burst-wide scalar; a range costs an rng draw).
- Coupling flutterRate to velocity or life (it is a constant multiplier, like spinRate).
- Making `flutter: 0` + `flutterRate` do something (a zero-depth wobble has no speed -- decision (b)).
- Any per-axis wobble / Y-wobble (collides with scaleTo's isotropic Y and flutter's X ownership).
- Mutating `pool.tilt`, `tiltV`, or any physics; any change to turbulence/sway coupling.
- Any change to the default look / presets / trail / color / emit / stagger / align / spinRate / scaleTo
  overlays, or any committed fingerprint when flutterRate is off.
