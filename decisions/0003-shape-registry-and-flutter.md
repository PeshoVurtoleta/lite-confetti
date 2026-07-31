# 0003 -- custom shapes (registerShape) + tunable flutter, and the ASCII closure

- **Status:** accepted (implemented in v1.3.0)
- **Date:** 2026-07-31
- **Session:** F1, the first feature release after F0 (v1.2.2 harness) and the
  multi-tier torture patch (v1.2.3). Scheduled in `decisions/0001` as "shapes +
  flutter". Modelled for stress on `@zakkster/lite-bvh`, as 0002 established.

## Context

Shapes were a closed set of five, dispatched by a hardcoded `switch` duplicated in the
render hot loop and the reduced-motion static path. Flutter primitives (spin/tilt SoA
columns) existed but the wobble was a fixed, un-tunable X-scale. And `decisions/0001`
left one open Law gap explicitly for F1: `Confetti.js` was not ASCII-only (a functional
`'\u{1F389}'` default + box-drawing/em-dash/bullet comment characters).

## Decisions

1. **The shape registry is PER-INSTANCE, not a shared global.** `registerShape` lives on
   the instance; the shape table (`shapeDraw`/`shapeBlit`/`shapeName2Id`) is built inside
   `createConfetti` and dropped with the instance. Rationale: a global registry (like the
   module-level `EmojiAtlas`) would let one instance's registration -- and its order --
   leak into another instance's output, which muddies the determinism guarantee and the
   isolation tier. The cost is a tiny per-instance table; the benefit is that determinism
   stays sealed inside one seed and `destroy()` releases everything. **T8 X5** is the
   executable proof: instance A registers `heart`; instance B bursting `shape:'heart'`
   falls back to rect, byte-identical to a control rect burst at the same seed.
   (The `EmojiAtlas`/`SpriteAtlas` rasterization *caches* stay module-level -- a
   rasterized bitmap does not depend on which instance asked, so sharing it is correct
   and does not leak registration state.)

2. **One uniform dispatch replaces the switch, and it stays zero-allocation.** Every draw
   fn takes `(ctx, w, h, i)` and ignores what it does not need, so the hot loop is
   `if (!shapeBlit[id]) ctx.fillStyle = colors[i]; shapeDraw[id](ctx, w, h, i);` -- an
   array index plus a stored-fn call, no allocation, net-cheaper than the old switch.
   `shapeBlit` distinguishes VECTOR shapes (engine sets fillStyle) from BLIT shapes
   (emoji, image sprites, which paint their own pixels). Image sprites generalise the
   emoji glyph atlas: prerender once to a fixed offscreen canvas, then `drawImage` per
   particle. **T6** now measures a live pool of a custom vector shape + a sprite + sway at
   ~0 B/frame -- the load-bearing proof the new path allocates nothing.

3. **Flutter and sway are two orthogonal, fingerprint-safe knobs.** `flutter` (0..1,
   default 1) scales the tumble DEPTH via `wobbleScale = 1 - flut*0.5*(1 - |cos(tilt)|)`;
   at `flut == 1` this is exactly the pre-1.3.0 `0.5 + 0.5|cos|`. Because it only touches
   the X-scale -- never the translate the fingerprint hashes -- it is hash-neutral at any
   value (unit test: flutter 1 == 0 == 0.37). `sway` (0..1, default 0) adds a horizontal
   position drift `x += sin(tilt)*sway*SWAY_PX*dt`, guarded by `if (sway !== 0)` so the
   default leaves positions byte-identical and the committed hash `1569828004` holds.
   Both are per-particle Float32Array columns set at spawn (zero hot-path allocation).

4. **Flutter/sway ARE validated; the physics numerics still are not.** Unlike
   `speed`/`gravity` (the un-sanitised gap 0002 documents), `flutter`/`sway` pass through
   `clamp01`, coercing a non-finite knob to its default -- "null is not zero", fail
   closed. So a `flutter: NaN` cannot produce a NaN position (T1 asserts this under the
   `assertFinite` detector). This is deliberate: the new knobs get the discipline the old
   numerics lack, without retro-validating the old ones (that remains a separate patch).

5. **registerShape fails closed; unknown shape NAMES do not.** A shape is a structural
   contract, so a bad name/def or a built-in override THROWS (setup-time, loud). But an
   unknown `shape` string in `burst`/`spray` falls back to rect (id 0), exactly as the old
   `SHAPE_MAP[shape] ?? 0` did -- a typo at call time must not crash a running animation.

6. **The ASCII Law gap is closed here.** The default emoji is `String.fromCodePoint(
   0x1F389)` (identical glyph, ASCII source) and all comment decoration is ASCII. Gate:
   `grep -nP '[^\x00-\x7F]' Confetti.js` is empty. This was 0001's open item, correctly
   done in the release that reopens the render path anyway.

## Explicitly NOT done

- No white-box pool introspection (`alive+free===cap`) -- still the deferred option from
  0002; the black-box tiers remain the contract. The custom-shape "did it dispatch?"
  question, which the position fingerprint cannot answer, is instead proven with a draw
  call-counter (T5 F4, unit tests).
- No per-particle multi-shape mixing within a single `burst()` -- one shape per burst
  stays the model. A future `shapes: []` mix is a later minor.
- The `destroy()`-leaves-`count`-stale and no-numeric-validation gaps from 0002 are
  untouched behaviour changes for a dedicated validation patch, not this feature release.

## References

- `Confetti.js` (shape table, `registerShape`, `SpriteAtlas`, flutter/sway, ASCII).
- `Confetti.d.ts` (`ShapeName`/`ShapeDef`/`ShapeDrawFn`, `registerShape`, flutter/sway).
- `test/torture/{t1,t5,t6,t8,t9}.mjs`; `test/Confetti.test.mjs` (registerShape, flutter).
- `CHANGELOG.md` [1.3.0]; `decisions/0001` (the ASCII gap), `decisions/0002` (the tiers).
