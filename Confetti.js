/**
 * @zakkster/lite-confetti v1.23.0 -- Deterministic Confetti Engine
 *
 * The confetti library that canvas-confetti wishes it was.
 * Deterministic (seeded), zero-GC hot path, OKLCH colors,
 * reduced-motion aware, composable with lite-timeline.
 *
 * v1.23.0 adds: `spinDrag` -- angular-velocity retention, the angular mirror of the linear `drag`. The engine
 * has damped LINEAR velocity (`vx`/`vy *= drag`, default 0.98) since day one -- a piece slows as it flies --
 * but its ANGULAR velocity was never damped: `spinV` was seeded once at spawn and `spin += spinV*dt` advanced
 * it at that birth rate forever, so a piece tumbled just as fast the instant before death as at birth.
 * `spinDrag` (opt-in scalar in [0,1], default 1 = off) closes that gap: each frame, before the spin advance,
 * `spinV *= spinDrag`, so the tumble decays exactly as `drag` decays translation -- the last unmirrored
 * asymmetry in the integrator. It is a CONTRACTION (factor in [0,1]): |spinV| never grows, finite for any
 * input, no accel cap; guarded on `pool.sdrag[i] !== 1` so an off burst pays zero new bytes per frame and
 * every committed fingerprint -- rotateHash included -- is byte-identical (1 is exactly representable in
 * Float32, so NO fround sentinel). Coerced with `clamp01(spinDrag, 1)` (a retention has no DIRECTION, unlike
 * spinRate's `num`): NEGATIVE => 0 (instant spin freeze at the birth angle, a legitimate finite value, the
 * angular twin of the legal `drag: 0`), non-finite/undefined => 1 (off), > 1 => 1 (which would otherwise
 * AMPLIFY spin and diverge). It damps `spinV` ONLY, never `tiltV` (tilt feeds sway + the turbulence curl).
 * It is a HYBRID physics knob with ONE position-coupling path: `pool.spin` is read in exactly two places --
 * the render rotation (always) and the turbulence curl `tp = tilt*1.7 + spin` (only inside `if (turb != 0)`).
 * With turbulence OFF, a slower tumble moves ONLY the render rotation -- the position hash is byte-identical,
 * rotateHash moves -- so it LOOKS like a pure render overlay; with turbulence ON, the curl reads the slower
 * spin, so it MOVES the position stream and earns its own committed hash. NOT a pure render overlay. Both
 * burst AND spray honor it; inert under reduced motion (the static path never integrates). +4 B/particle.
 *
 * v1.22.0 adds: `wallFriction` -- tangential drag on the box's THREE non-floor edges, the exact structural
 * twin of v1.21.0 `friction` (which covers the floor). The engine has had a full axis-aligned bounding box
 * since v1.7.0 -- `floor` + the `wallLeft`/`wallRight`/`ceiling` edges -- all sharing ONE restitution
 * coefficient `bounce` that reflects the NORMAL (perpendicular) velocity at every edge. But only the FLOOR
 * had a tangential-drag term (v1.21.0 `friction`): a piece pinned against a wall by wind, or launched up
 * under a ceiling with lateral speed, slid along that edge at constant tangential velocity, bled only by the
 * global isotropic `drag`. `wallFriction` adds the grip: an opt-in scalar in [0,1] that, on EACH contact
 * with a NON-FLOOR box edge, damps the TANGENTIAL velocity component by `1 - wallFriction`. The tangent
 * INVERTS per edge -- where `bounce` reflects the normal, `wallFriction` damps the OTHER component: at the
 * CEILING it damps `vx` (horizontal tangent) AFTER the vy reflection; at each WALL it damps `vy` (vertical
 * tangent) AFTER the vx reflection. This is the tangential analog to `bounce`'s ONE shared restitution: a
 * single coefficient for the box's three non-floor edges, the ceiling included by design (bounce never
 * fragmented the box edge-by-edge, so its tangential twin does not either). The floor keeps its own separate
 * `friction` knob, byte-for-byte untouched (FRICTION_HASH 1451535522 preserved). It lives entirely INSIDE
 * the already-guarded ceiling + wall blocks, guarded on `pool.wfric[i] !== 0`, so a boxless or frictionless
 * burst pays zero new bytes per frame and every committed fingerprint is byte-identical when off (0 is
 * exactly representable in Float32 -- `Math.fround(0) === 0` -- so NO fround sentinel, contrast fadeOut).
 * The update is a CONTRACTION (factor in [0,1]): |v| can never grow, so positions stay finite for any input
 * with NO accel cap. Needs a box -- with no box the edges sit at their infinity sentinels and none of those
 * branches can fire, so `wallFriction` never fires (mirrors friction's "needs a floor"). It is a PHYSICS
 * feature, so it MOVES the position stream and earns its own committed `WALLFRICTION_HASH` on the MAIN hash
 * -- but it needs NO new harness probe (it rides the position hash + the hash-neutral maxY/maxX/minX
 * accessors). Coerced with `clamp01(wallFriction, 0)` (negative => 0, NEVER anti-friction); both burst AND
 * spray honor it; inert under reduced motion (the static path never integrates to an edge collision).
 * v1.21.0 adds: `friction` -- tangential floor drag, the FIRST physics feature since `settle` (v1.11.0)
 * and the tangential complement to `bounce`. The engine has had a full boundary system for fifteen
 * releases -- `floor` + `bounce`, the wall/ceiling box, `settle` -- but NOTHING damped a piece's
 * HORIZONTAL velocity while it was in contact with the floor: a piece that landed with lateral speed
 * either froze instantly (settle) or slid at constant `vx` forever (bled only by the global, isotropic
 * `drag`). `friction` is that knob: an opt-in per-particle scalar in [0,1] that, on EACH floor-contact
 * frame, multiplies `vx` by `1 - friction`. `0` (default) = frictionless (today's exact behaviour),
 * `1` = full grip (horizontal stop on first contact), `0.2` = a long skid, `0.8` = a short one. Where
 * `bounce` reflects the NORMAL (vertical) component, `friction` damps the TANGENT (horizontal) one, so
 * they multiply on a single contact without interfering. It lives entirely INSIDE the already-guarded
 * floor-contact block (AFTER the vy reflection, BEFORE the settle test), so a floorless or frictionless
 * burst pays zero new bytes per frame and every committed fingerprint is byte-identical when off. The
 * update is a CONTRACTION (factor in [0,1]): |vx| can never grow, so positions stay finite for any input
 * with NO accel cap (contrast the vortex's anti-spring). Needs a `floor` -- with no floor the branch is
 * unreachable, so friction never fires (mirrors settle's "needs a floor" rule). It is a PHYSICS feature,
 * so it MOVES the position stream and earns its own committed `FRICTION_HASH` on the MAIN hash -- but it
 * needs NO new harness probe (it rides the position hash + the hash-neutral sumX/maxX/minX accessors) and
 * NO fround sentinel: the default `0` is exactly representable in Float32 (`Math.fround(0) === 0`), so the
 * guard `if (pool.fric[i] !== 0)` is safe (contrast fadeOut's load-bearing `Math.fround(0.3)`). Coerced
 * with `clamp01(friction, 0)` (negative => 0, NEVER anti-friction); both burst AND spray honor it; inert
 * under reduced motion (the static path never integrates to a floor collision); zero rng, zero allocation.
 * v1.20.0 adds: `fadeOut` -- a death-fade window, the SECOND public knob on the render-OPACITY axis and the
 * mirror of v1.19.0's `fadeIn`. For nineteen releases a piece dissolved over exactly the last 30% of its life,
 * a magic `0.3` baked into the render body. `fadeOut` parameterizes that constant: the fraction of life over
 * which a piece dissolves at the END. `fadeOut: 0.6` fades over the last 60% (a long gentle dissolve), `0.1` a
 * quick blink-out, `0` a hard cut (full opacity then gone -- the alpha analog of `spinRate:0`/`scaleTo:0`,
 * NOT a fallback to the default), `1` fades across the whole life; default `0.3` = today's exact look.
 * Together with `fadeIn` this COMPLETES the opacity envelope: `fadeIn` ramps up over the first fraction,
 * `fadeOut` ramps down over the last, both MULTIPLYING one shared `alpha` -- materialize in, hold, dissolve
 * out. The crux is the `Math.fround(0.3)` sentinel: the default round-trips lossily through Float32
 * (`Math.fround(0.3) !== 0.3`), so the render line keeps the DOUBLE `0.3` literal for the default path and
 * the guard fires only when `fadeOut !== FADE_OUT_DEF`, preserving the committed off-look alphaHash
 * bit-for-bit. It is even purer than `fadeIn`: a PURE RENDER overlay reading only `lifeT`, no birth pivot,
 * no decoupling machinery, and reuses v1.19.0's `alphaHash`/`lastAlpha` probe with NO harness change. The
 * spawn write is UNCONDITIONAL and LOAD-BEARING (a zero-init `0` means "hard cut", a WRONG default), unlike
 * fadeIn. Coerced with `clamp01(fadeOut, FADE_OUT_DEF)`; both burst AND spray honor it; inert under reduced
 * motion (the static 0.85 is untouched). This CLOSES the render-opacity axis (in + out).
 * v1.19.0 adds: `fadeIn` -- a birth-opacity ramp, the FIRST public knob on the render-OPACITY axis. For
 * eighteen releases a piece's opacity had exactly ONE hardcoded behaviour: a death fade-OUT over the last
 * 30% of life. Every OTHER render channel already had a public knob (rotation via align/spinRate, scale via
 * scaleTo/flutterRate, color via lifeColors) but OPACITY had none, so a piece that MATERIALIZES in (fades up
 * from transparent at birth) was unreachable. `fadeIn` opens that channel: an opt-in scalar that ramps alpha
 * 0 -> 1 over the FIRST `fadeIn` fraction of each piece's life, by the age fraction (1 - lifeT) the death-fade
 * + lifeColors already use. `fadeIn: 0.4` eases in over the first 40% of life; default `0` = today's
 * instant-on look. It MULTIPLIES the existing alpha (birth fade-in near birth, death fade-out near death act
 * in disjoint windows for a normal life and correctly multiply for a very short one); the death fade-out is
 * UNCHANGED. The crux: it is the cleanest overlay in the suite -- a PURE RENDER overlay on ctx.globalAlpha
 * that never touches ctx.translate / x / y / vx / vy, draws no rng, and reads only `lifeT`, so the seeded
 * POSITION stream is byte-identical off or on (and rotate/scale/stroke/color streams too). The trail ribbon
 * shares the body `alpha` (folded BEFORE the trail block), so the streak materializes in with the body for
 * free -- no new column, no decoupling machinery (nothing downstream reads alpha). Coerced with
 * `clamp01(fadeIn, 0)`; both burst AND spray honor it; inert under reduced motion (the static 0.85 is
 * untouched); zero rng, zero allocation (stack locals). A new `alphaHash`/`lastAlpha` harness probe folds
 * globalAlpha out-of-hash, so no committed position/rotate/scale/stroke/color fingerprint moves.
 * v1.18.0 adds: `flutterRate` -- tumble-wobble speed, the THIRD tumble-axis knob and the flutter analog
 * of v1.16.0's `spinRate`. `flutter` (v1.3.0) sets the DEPTH of the 3D-ish X-scale wobble; its SPEED has
 * never had a public knob (`tiltV` is a fixed seeded random), so a slow lazy flutter, a wobble frozen at a
 * chosen tilt, or a fast shimmer were unreachable. An opt-in `flutterRate` multiplies the ACCUMULATED
 * wobble phase about a stored birth pivot `tilt0`: `0` = frozen wobble at each piece's OWN varied birth
 * tilt, `0.3` = a slow lazy flutter, `1` = as seeded (default), `2` = a fast shimmer, negative = reversed.
 * The crux, exactly like spinRate: it is a render-time PHASE SCALE, never a spawn-time `tiltV` scale.
 * `pool.tilt[i]` -- the wobble phase the integrator advances AND that the turbulence curl phase + `sway`
 * READ -- is NEVER touched; the draw block scales only the accumulated delta `(tilt - tilt0)` into a stack
 * local that feeds ONLY the `wobbleScale` formula. So `flutterRate` is fully DECOUPLED from turbulence and
 * sway, and the seeded POSITION stream is byte-identical off, on, and on-with-turbulence. Off
 * (flutterRate 1 / non-finite) => the raw `tilt` is fed verbatim, byte-identical to every prior release.
 * It is inert when `flutter == 0` (a zero-depth wobble has no speed to scale). It reuses the v1.17.0
 * `scaleHash` probe (wobbleScale feeds ctx.scale) -- no new committed-hash channel. Coerced with
 * `num(flutterRate, 1)`; both burst AND spray honor it; inert under reduced motion; zero rng, zero
 * allocation (stack locals).
 * v1.17.0 adds: `scaleTo` -- size-over-life, the FIRST feature on the render-SCALE axis (until now the
 * only `ctx.scale` was `flutter`'s X-wobble). For sixteen releases a piece's SIZE was fixed at birth
 * (`pool.w`/`pool.h` drawn once in spawn() and never changed), so a piece that shrinks away to nothing
 * or an ember that blooms as it dies was unreachable. An opt-in `scaleTo` scalar lerps each piece's
 * RENDERED size from `1.0` at BIRTH to `scaleTo` at DEATH by the SAME age fraction the `lifeColors` ramp
 * already indexes: `s = 1 + (scaleTo - 1) * (1 - lifeT)`. `0.2` shrinks out, `2` grows, `0` vanishes at
 * death; default `1` = today's constant size. ISOTROPIC (one factor on BOTH axes), it FOLDS into the
 * SINGLE existing `ctx.scale(sx, sy)` call so flutter's X-wobble and the size ramp MULTIPLY on one
 * transform -- `pool.w`/`pool.h` are NEVER touched. A pure RENDER overlay: scale never touches
 * ctx.translate, draws no rng, so the seeded POSITION stream is byte-identical whether off or on -- a
 * scaled burst reproduces the same-seed plain burst's position hash EXACTLY (invisible to rotateHash and
 * colorHash too). Coerced with `nonneg` -- a NEGATIVE clamps to `0` (a size has no direction), NOT a
 * mirror flip and NOT a fallback to `1`; non-finite/non-numeric => 1 (off). The trail ribbon keeps its
 * BIRTH width (the ring buffer stores positions only; the ramp scales the body, not the streak). Both
 * burst AND spray honor it; inert under reduced motion; zero rng, zero allocation (stack locals).
 * v1.16.0 adds: `spinRate` -- tunable tumble speed, the SECOND feature on the render-ORIENTATION axis
 * (part 2 of what `align` opened). For fifteen releases a piece's tumble RATE was a fixed seeded random
 * (`spinV`, ~5 rad/s), so slow drifting petals, frozen rigid chips, and reverse tumble were unreachable.
 * An opt-in `spinRate` multiplies the accumulated tumble: `0` = rigid (frozen at each piece's RANDOM
 * birth tilt -- varied, not axis-aligned), `0.3` = a lazy drift, `2` = double, negative = reverse; default
 * `1` = as seeded. The crux: it is a render-time ANGLE SCALE, never a spawn-time `spinV` scale. `pool.spin[i]`
 * -- the physics spin the integrator advances and that the turbulence curl phase READS to drive vx/vy -- is
 * NEVER touched; the draw block scales only the ACCUMULATED delta `(spin - spin0)` about a stored random
 * birth column `spin0` into a stack local. So `spinRate` and `turbulence` are fully DECOUPLED, and the
 * seeded POSITION stream is byte-identical whether off, on, or on-with-turbulence -- a pure orientation
 * overlay like `align`. Off (spinRate 1 / non-finite) => the raw `spin` is emitted, byte-identical to every
 * prior release. Composes with `align` (the tumble scale runs FIRST, then align lerps toward velocity).
 * Both burst AND spray honor it; inert under reduced motion; zero rng, zero allocation (stack locals). It
 * reuses the v1.15.0 `rotateHash` probe -- the FIRST orientation feature to ship without a harness change.
 * v1.15.0 adds: `align` -- velocity-aligned orientation, the FIRST feature on the render-ORIENTATION
 * axis. For fourteen releases a piece's rotation was only ever RANDOM tumble (a seeded `spin` + a
 * `flutter` X-scale wobble); this opens WHICH WAY it faces. An opt-in `align` (0..1) rotates each piece
 * BROADSIDE to its LIVE velocity -- `atan2(vy, vx) + HALF_PI`, so its flat face meets the airflow, like
 * a falling leaf -- blended along the SHORT arc from pure spin (0) to fully locked (1), recomputed every
 * frame so it re-banks as gravity/wind/vortex bend the path. Zero rng (rotation derives from the
 * deterministic velocity). It is a PURE ORIENTATION overlay: rotation never touches `ctx.translate`, so
 * the seeded POSITION stream is untouched -- an aligned burst reproduces the same-seed plain burst's
 * position hash EXACTLY (the orientation analog of what `lifeColors` did for color), while the rotation
 * sequence earns its own committed hash (a separate `rotateHash` probe). Off (align 0) => the raw `spin`
 * is emitted, byte-identical to every prior release. Both burst AND spray honor it (a render property of
 * any moving piece, unlike burst-only `stagger`). Fail-closed: non-finite/negative => 0, > 1 caps at 1;
 * inert under reduced motion; zero allocation (one atan2 + arithmetic per aligned piece, no per-frame GC).
 * v1.14.0 adds: `stagger` -- staggered emission, the FIRST feature on the emission-TIMING axis (1.13
 * opened emission GEOMETRY -- WHERE a piece is born; this opens WHEN). A burst has always spawned its
 * whole `count` at frame 0; an opt-in `stagger` (a duration in ms) spreads the births evenly across
 * that window, so a burst cascades / ripples in instead of appearing at once. It is a BURST-ONLY knob
 * -- the burst analog of spray's `duration` (spray already emits over time). Mechanism: a birth-delay
 * gate. All `count` pieces still spawn at CALL TIME (so the rng sequence is byte-identical to a
 * synchronous burst), each stamped with a per-piece `delay` of `staggerSec * i / count` -- a function
 * of the loop index only, NO rng draw. An unborn piece is frozen + invisible (physics, life-countdown,
 * trail, render all skipped) until its delay elapses, then it lives its FULL life from birth. Off
 * (staggerSec 0) => the delay column stays 0, the gate never fires, and the burst spawns synchronously
 * -- byte-identical to every prior release, COMMITTED_HASH preserved. On => the same per-piece draws,
 * only births are spread, so it earns its own committed hash. Fail-closed (NaN/negative/Infinity =>
 * off); inert under reduced motion; zero allocation (a Float32 store at spawn + a read/compare/frame).
 * v1.13.0 adds: `emit` -- spawn emitter shapes, the FIRST feature on the emission-geometry axis
 * (every prior chapter changed how a particle MOVES, ENDS, or is DRAWN; this changes WHERE it is
 * BORN). Instead of the single point (x, y), a burst distributes its spawn ORIGIN over a shape:
 * a horizontal `line` curtain (rain/snow), a `ring` firework shell, or a `box` area -- each sized
 * by the single `emitSize` scalar (line half-length / ring radius / box square half-extent). Ring
 * is the one geometry->velocity coupling: pieces fly radially OUTWARD (speed = shell expansion,
 * spread = angular fuzz); line/box leave velocity to angle/spread. It is the FIRST feature to add a
 * CONDITIONAL spawn-time rng draw (the position along the shape), so it is opt-in by construction:
 * `emit` off/unknown/`emitSize<=0` inserts NO draw and spawns at the point -- byte-identical to a
 * point burst, every committed position fingerprint preserved. Per-shape draw counts differ (box 2,
 * line/ring 1), so each shape has its own committed hash. Inert under reduced motion; the hot render
 * path is untouched (emit only moves the origin). Fail-closed: bad shape or size => point spawn.
 * v1.12.0 adds: `lifeColors` -- color-over-life, the second RENDER feature (after trails). The body
 * of each piece sweeps a multi-stop OKLCH ramp as it ages -- sparks cooling white -> orange -> red,
 * embers dimming -- indexed by the piece's own life fraction (birth = first stop, death = last). The
 * ramp is baked ONCE per burst into a small LUT of CSS strings (lite-color's bakeCssGradient), so the
 * hot path is a pure index-by-life array read: zero per-frame color math, zero allocation. It draws
 * ZERO rng and touches NO position/velocity/rotation, so it is a PURE COLOR OVERLAY -- every
 * committed POSITION fingerprint is byte-identical, including a `lifeColors` burst's own (the only
 * thing it moves is `ctx.fillStyle`). The palette `colors` is still picked per particle and stays the
 * flat TRAIL color (and the body color when off); an invalid/short ramp fails closed to that flat
 * color. Off => `lifeColors` changes nothing. The gate is the fillStyle sequence (`colorHash`).
 * v1.11.0 adds: `settle` -- settle-and-pile, the first BEHAVIOUR (lifecycle) feature (every prior
 * chapter changed how a particle MOVES or DRAWS; this changes how it ENDS). A piece bounces on the
 * `floor` (losing energy to `bounce` < 1 + `drag`) until the rebound is too weak to lift it -- its
 * reflected |vy| drops below the `settle` rest threshold -- then it FREEZES in place and piles up,
 * instead of bouncing forever. A settled piece keeps aging + fading, so it recycles and the pile is
 * a transient drift (the fixed pool never saturates). Draws ZERO rng (a pure function of the piece's
 * own post-bounce velocity), so default `0` is byte-identical (every prior fingerprint preserved)
 * and a settling burst is reproducible for free. Needs a `floor`; no floor => nothing ever settles.
 * v1.10.0 adds: `attract` + `swirl` -- a VORTEX / attractor, the first DIRECTED (point) force.
 * `attract` is a linear-spring pull toward a per-burst center (`attractX`/`attractY`, default the
 * burst origin): accel = attract * (center - pos), zero at the center (no singularity), damped by
 * `drag` into an inward spiral; negative repels. `swirl` adds the perpendicular tangential term, so
 * a burst can collapse into, blow out from, or spin around a point. Draws ZERO rng (a pure function
 * of the particle's position + the burst center), so default `0` is byte-identical (every prior
 * fingerprint preserved) and a vortexed burst is reproducible for free. A fail-closed accel cap
 * keeps a repeller (unstable anti-spring) from ever driving a position non-finite.
 * v1.9.0 adds: motion `trail`s -- the first RENDER-path feature (every prior chapter extended
 * the physics). Opt in at construction with `createConfetti(canvas, { trail: N })` to give each
 * particle a fading ribbon through its last N world positions; a per-burst `trail` (0..N) then
 * shortens or opts a single burst out. The ribbon is a PURE OVERLAY: it draws in world space
 * (moveTo/lineTo/stroke, never translate) and never reads or writes physics state, so every
 * committed physics fingerprint is preserved byte-for-byte at any depth -- the new gate is the
 * trail GEOMETRY itself. Storage is a fixed ring buffer allocated ONCE at construction (zero-GC:
 * no lazy growth), so `trail: 0` (the default) allocates nothing and is byte-identical to v1.8.0.
 * v1.8.0 adds: `turbulence` + `gust` -- the first TIME-VARYING forces. `turbulence` is a
 * per-particle rotating acceleration (organic wander) reusing the seeded tilt/spin phases;
 * `gust` is a global sinusoidal horizontal acceleration (a coherent breeze, ~3s waves)
 * layered on `wind`. Both draw ZERO rng -- a pure deterministic function of state the engine
 * already advances -- so default `0` is byte-identical (all three prior fingerprints preserved)
 * and a turbulent/gusty burst is reproducible for free.
 * v1.7.0 adds: `wallLeft` + `wallRight` + `ceiling` -- the three remaining edges that
 * complete `floor` into a full opt-in bounding box. A particle reaching any edge (an
 * absolute CSS-px coord) clamps onto it and reflects its velocity scaled by `bounce`
 * (now the shared box restitution), so confetti can be fully contained. Fingerprint-safe:
 * each edge defaults to an infinity sentinel whose guard can never fire, so BOTH the
 * default and the v1.6.0 floored fingerprints are byte-for-byte preserved.
 * v1.6.0 adds: `floor` + `bounce` -- an opt-in settle boundary on the Y axis. Particles
 * that reach `floor` (a CSS-px Y) clamp to it and reflect vy scaled by `bounce`
 * (restitution 0..1: 0 rests/piles up, 1 elastic), so confetti can land instead of
 * falling forever. Fingerprint-safe: default `floor = Infinity` never fires the branch.
 * v1.5.0 adds: `wind` -- a lateral acceleration (px/sec^2), the X-axis mirror of
 * gravity, so `gravity` (down) + `wind` (across) form a 2D force vector. Opt-in and
 * fingerprint-safe: default 0 leaves positions byte-identical.
 * v1.4.0 adds: multi-shape mixing -- burst()/spray() accept a `shapes` array and pick
 * a shape per particle (weighted by repetition), so one burst mixes stars + circles +
 * custom registerShape() shapes. Opt-in: omit `shapes` and the single-`shape` path is
 * byte-identical (the committed determinism fingerprint is preserved).
 * v1.3.1 adds: fail-closed input validation -- every non-finite/out-of-range numeric
 * option on burst()/spray() coerces to its documented default (no NaN positions, no
 * immortal particles); destroy() now zeroes the count getter.
 * v1.3.0 adds: instance.registerShape() for custom vector + image-sprite shapes
 * (per-instance, seed-sealed), and tunable flutter/sway on burst()/spray().
 * v1.2.0 added: named presets (fireworks / cannons / snow / pride),
 * colorsFromPalette() for direct lite-hueforge toGradientStops() consumption,
 * fromElement() burst-origin sugar, and per-instance pointer-follow spray.
 *
 * Depends on:
 *   @zakkster/lite-random  (deterministic RNG)
 *   @zakkster/lite-color   (OKLCH colors)
 *   lite-ticker            (shared RAF loop)
 *
 * Does NOT depend on lite-vec, lite-steer, lite-fx, or lite-particles.
 * Confetti is simple physics -- gravity, drag, spin. No steering needed.
 * If you want confetti that flocks or swirls into a vortex, compose this
 * with lite-steer in a recipe. Don't bloat the core.
 *
 * REDUCED MOTION:
 *   Automatically detects `prefers-reduced-motion: reduce`.
 *   When active: particles appear instantly at their final spread positions
 *   with no animation, hold for 1.5s, then fade. Users see the celebration
 *   without the motion sickness trigger.
 */

import { Random } from '@zakkster/lite-random';
import { toCssOklch, parseOklch, bakeCssGradient } from '@zakkster/lite-color';
import { Ticker } from '@zakkster/lite-ticker';


// ---------------------------------------------------------
//  SHARED TICKER (ref-counted)
// ---------------------------------------------------------

let _ticker = null;
let _tickerRefs = 0;

function acquireTicker() {
    if (!_ticker) { _ticker = new Ticker(); _ticker.start(); }
    _tickerRefs++;
    return _ticker;
}

function releaseTicker() {
    _tickerRefs--;
    if (_tickerRefs <= 0 && _ticker) { _ticker.destroy(); _ticker = null; _tickerRefs = 0; }
}


// ---------------------------------------------------------
//  REDUCED MOTION DETECTION
// ---------------------------------------------------------

let _prefersReducedMotion = false;
if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    _prefersReducedMotion = mq.matches;
    mq.addEventListener?.('change', (e) => { _prefersReducedMotion = e.matches; });
}


// ---------------------------------------------------------
//  DEFAULT OKLCH CONFETTI COLORS
//  Perceptually uniform -- every piece looks equally vibrant.
// ---------------------------------------------------------

const DEFAULT_COLORS = [
    { l: 0.70, c: 0.25, h: 30 },   // orange
    { l: 0.65, c: 0.28, h: 330 },  // pink
    { l: 0.72, c: 0.22, h: 60 },   // gold
    { l: 0.60, c: 0.25, h: 270 },  // purple
    { l: 0.68, c: 0.22, h: 150 },  // green
    { l: 0.62, c: 0.20, h: 210 },  // blue
    { l: 0.75, c: 0.20, h: 0 },    // red
];


// The default emoji glyph (U+1F389 PARTY POPPER). Built from its code point so this
// source file stays ASCII-only per the suite Law; the rendered glyph is identical.
const DEFAULT_EMOJI = String.fromCodePoint(0x1F389);

// Peak horizontal sway speed (CSS px/sec) at sway == 1. Amplitude scales with the knob.
const SWAY_PX = 60;

// Shared angle constants. TAU = a full turn (used for spin/tilt/ring phases + the circle arc);
// HALF_PI = a quarter turn, so -HALF_PI is straight up (the default emission angle). Hoisted so
// the value appears once; multiplying by the power-of-two 2 is exact, so `x * TAU` is bit-identical
// to the former `x * Math.PI * 2` -- no committed fingerprint moves.
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;

// Angular frequency of the global `gust` oscillation: one full swell-and-return every ~3s.
// The whole pool shares this phase (driven by the instance `_elapsed` clock), so gust reads
// as a coherent breeze rather than per-particle noise.
const GUST_HZ = TAU / 3;

// Color-over-life (v1.12.0). A `lifeColors` burst bakes its multi-stop OKLCH ramp ONCE into a
// fixed-resolution LUT of CSS strings (bakeCssGradient), and the render loop indexes it by the
// particle's life fraction -- a pure array read, no per-frame color math. RAMP_N is the LUT
// resolution (32 steps is visually smooth and a trivial one-time allocation); RAMP_LAST is the
// top index. The ramp draws NO rng and touches no position, so it is a pure color overlay:
// every committed POSITION fingerprint is byte-identical whether or not `lifeColors` is used.
const RAMP_N = 32;
const RAMP_LAST = RAMP_N - 1;

// Spawn emitter shapes (v1.13.0). `emit` distributes a burst's spawn ORIGIN over a shape instead
// of the single point (x, y): a horizontal `line` curtain, a `ring` firework shell, or a `box`
// area, each sized by the single `emitSize` scalar (line half-length / ring radius / box square
// half-extent). `emit` resolves ONCE per burst to a small int id via EMIT_ID, so the spawn loop
// branches on an int compare, never a string. It is the FIRST feature to add a CONDITIONAL
// spawn-time rng draw (the parametric position along the shape); the OFF path (EMIT_OFF) inserts
// NOTHING, so the draw sequence -- and thus every committed position fingerprint -- is byte-identical
// to a point burst. Per-shape draw counts differ (box draws 2, line/ring 1), so each shape earns its
// own committed hash. Ring is the one geometry->velocity coupling: velocity points radially outward
// (speed = shell expansion, spread = angular fuzz), reusing the already-drawn spread jitter (no extra
// draw); line/box leave velocity to angle/spread. Inert under reduced motion (the static fan has no
// rng origin). The hot render path is UNTOUCHED -- emit only moves where a particle is born.
const EMIT_OFF = 0, EMIT_LINE = 1, EMIT_RING = 2, EMIT_BOX = 3;
const EMIT_ID = new Map([['line', EMIT_LINE], ['ring', EMIT_RING], ['box', EMIT_BOX]]);

// Motion trails (v1.9.0). A trail is a fixed-size ring buffer of a particle's recent world
// positions, stroked as a single flat-alpha ribbon (uniform opacity along its length, so the
// whole streak stays clearly visible). TRAIL_MAX bounds the one-time buffer allocation (`trail`
// capacity is clamped to it); TRAIL_ALPHA is the ribbon opacity relative to the body's life-fade;
// TRAIL_WIDTH is the line width as a fraction of the particle's min(w,h). The trail is a pure
// RENDER overlay -- it draws in world space (moveTo/lineTo/stroke, never translate) and never
// touches physics state, so every committed physics fingerprint is preserved at any depth.
// (A per-segment alpha/width taper shipped in v1.9.0 was reverted in v1.10.0 -- it read as too
// faint; see decision 0010.)
const TRAIL_MAX = 64;
const TRAIL_ALPHA = 0.5;
const TRAIL_WIDTH = 0.55;

// Death-fade window default (v1.20.0). The fround(0.3) sentinel -- the Float32 round-trip of the
// default death-fade window. pool.fadeOut stores in a Float32Array, so the double 0.3 round-trips
// LOSSILY (Math.fround(0.3) !== 0.3, approx 0.30000001192). NEVER compare pool.fadeOut against the
// double 0.3: it would differ on every piece even at the default and drift the committed alphaHash.
// Coerce with clamp01(fadeOut, FADE_OUT_DEF) and guard the render recompute with `!== FADE_OUT_DEF`,
// leaving the default path on the byte-identical DOUBLE-0.3 render line.
const FADE_OUT_DEF = Math.fround(0.3);

// Vortex / attractor (v1.10.0). A linear-spring point force: `attract` pulls each particle toward
// a per-burst center (accel = attract * (center - pos)), `swirl` adds the perpendicular tangential
// component (a spiral). VORTEX_MAX_ACCEL is a fail-closed cap on the accel components -- a NEGATIVE
// attract is an anti-spring (exponentially unstable far from the center), so without the cap a
// repeller could drive a position to Float32 Infinity; the cap bounds accel so positions stay
// finite for any run. It never bites in the normal regime (single-digit attract x a few-hundred-px
// radius). The force draws NO rng (a pure function of position + the burst center).
const VORTEX_MAX_ACCEL = 50000;

// Clamp a numeric option into [0,1], failing closed to `dflt` for non-finite input
// (NaN/Infinity coerce to the default rather than poisoning a particle -- "null is not
// zero"). Used at spawn time only, never on the render hot path.
function clamp01(v, dflt) {
    return Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : dflt;
}

// Fail-closed numeric coercion for call-time options. A non-finite value (NaN/Infinity,
// or a caller typo like a string) coerces to `dflt` instead of poisoning a particle's
// physics -- "fail closed on every unverified state, null is not zero". Unlike clamp01
// these are unbounded above; `nonneg` additionally floors at 0 for extents/counts that
// have no meaning when negative. Called once per burst/spray, never on the render loop.
function num(v, dflt) {
    return Number.isFinite(v) ? v : dflt;
}
function nonneg(v, dflt) {
    const n = Number.isFinite(v) ? v : dflt;
    return n < 0 ? 0 : n;
}

// Resolve a `shapes` mix option to an array of shape ids, or null to fall back to the
// single-`shape` path. Fails closed like the rest of the suite: a non-array / empty
// input, or one whose names all fail to resolve, returns null (single-shape path), and
// individual unknown names are dropped rather than throwing -- a call-time typo in a mix
// must not crash a running animation. Called once per burst/spray, never on any hot path.
function resolveShapeIds(shapes, name2id) {
    if (!Array.isArray(shapes) || shapes.length === 0) return null;
    const ids = [];
    for (let k = 0; k < shapes.length; k++) {
        const id = name2id.get(shapes[k]);
        if (id !== undefined) ids.push(id); // unknown names dropped (fail closed)
    }
    return ids.length ? ids : null; // nothing resolvable -> single-shape path
}

// Bake a `lifeColors` option (v1.12.0) into a fixed-resolution LUT of CSS strings the render loop
// indexes by life fraction. Fail-closed: a non-array, fewer than two stops, or any stop that is
// not a finite OKLCH triple (objects pass through; oklch() strings parse via parseOklch) returns
// null -- the body then paints the flat `colors[i]` exactly as before (NOT the default rainbow).
// Called ONCE per burst/spray, off the hot path (like the `parsedColors` pre-parse).
function buildLifeRamp(lifeColors) {
    if (!Array.isArray(lifeColors) || lifeColors.length < 2) return null;
    try {
        const stops = [];
        for (let k = 0; k < lifeColors.length; k++) {
            const c = lifeColors[k];
            const o = typeof c === 'string' ? parseOklch(c) : c; // parseOklch THROWS on an unparseable string
            if (!o || !Number.isFinite(o.l) || !Number.isFinite(o.c) || !Number.isFinite(o.h)) return null;
            stops.push(o);
        }
        return bakeCssGradient(stops, RAMP_N); // RAMP_N CSS oklch() strings, birth -> death
    } catch (_) {
        return null; // any parse/bake failure => fail closed to the flat `colors[i]`
    }
}


// ---------------------------------------------------------
//  NAMED PRESETS -- drop-in configs for iconic effects
//  Spread into burst()/spray(): c.burst({ ...presets.fireworks })
//  Every `shape` here is one of the five the engine knows
//  (rect | circle | star | triangle | emoji) -- validated in the test suite.
// ---------------------------------------------------------

export const presets = {
    /** Explosive upward burst with stars -- classic celebration. */
    fireworks: {
        count: 140, spread: 1.9, speed: 380, speedVariance: 220,
        gravity: 420, drag: 0.97, sizeMin: 6, sizeMax: 14,
        lifeMin: 1.6, lifeMax: 3.2, shape: 'star', angle: -HALF_PI,
    },
    /** Powerful angled launch -- side cannons, stage effects. */
    cannons: {
        count: 55, spread: 0.5, speed: 720, speedVariance: 80,
        gravity: 920, drag: 0.985, sizeMin: 5, sizeMax: 11,
        lifeMin: 1.3, lifeMax: 2.8, shape: 'rect', angle: -Math.PI * 0.65,
    },
    /** Gentle wide falling snow -- long life, low gravity, circles. */
    snow: {
        count: 180, spread: Math.PI * 0.95, speed: 60, speedVariance: 35,
        gravity: 95, drag: 0.996, sizeMin: 3.5, sizeMax: 7,
        lifeMin: 3.5, lifeMax: 7.5, shape: 'circle', angle: -HALF_PI,
    },
    /** Vibrant rainbow burst using perceptually tuned OKLCH. */
    pride: {
        count: 110, spread: 1.6, speed: 320, speedVariance: 160,
        gravity: 480, drag: 0.975, sizeMin: 5, sizeMax: 13,
        lifeMin: 1.7, lifeMax: 3.3, shape: 'rect', angle: -HALF_PI,
        colors: [
            { l: 0.62, c: 0.32, h:  15 }, // red
            { l: 0.68, c: 0.28, h:  45 }, // orange
            { l: 0.82, c: 0.22, h:  85 }, // yellow
            { l: 0.65, c: 0.26, h: 135 }, // green
            { l: 0.58, c: 0.24, h: 250 }, // blue
            { l: 0.60, c: 0.30, h: 295 }, // purple
        ],
    },
};


//  SHAPE RENDERERS
//  Each draws a single particle at (0,0). The canvas is
//  pre-translated and rotated by the caller.
// ---------------------------------------------------------

const Shapes = {
    rect(ctx, w, h) {
        ctx.fillRect(-w / 2, -h / 2, w, h);
    },

    circle(ctx, w) {
        ctx.beginPath();
        ctx.arc(0, 0, w / 2, 0, TAU);
        ctx.fill();
    },

    star(ctx, w) {
        const r = w / 2;
        const ir = r * 0.4;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
            const a = (i * Math.PI) / 5 - HALF_PI;
            const rad = i % 2 === 0 ? r : ir;
            if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
            else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
        }
        ctx.closePath();
        ctx.fill();
    },

    triangle(ctx, w) {
        const h = w * 0.866;
        ctx.beginPath();
        ctx.moveTo(0, -h / 2);
        ctx.lineTo(-w / 2, h / 2);
        ctx.lineTo(w / 2, h / 2);
        ctx.closePath();
        ctx.fill();
    },

    emoji(ctx, w, char) {
        // Draw a PRE-RASTERIZED glyph, scaled. See EmojiAtlas below for why this exists:
        // the old path set ctx.font and called fillText() per particle per frame, which
        // re-shaped and re-rasterized a colour-emoji bitmap every call (the font size
        // varies per particle, so nothing cached). At 800 particles x 60fps that is ~48k
        // emoji rasterizations/second on the main thread -- enough to freeze even an M4.
        // Here each unique glyph is rasterized ONCE to an offscreen canvas; this is a GPU
        // blit that scales for free.
        const glyph = EmojiAtlas.get(char);
        if (glyph) ctx.drawImage(glyph, -w / 2, -w / 2, w, w);
    },
};


// ---------------------------------------------------------
//  EMOJI GLYPH ATLAS
//  Rasterize each emoji once to a small offscreen canvas at a fixed base size, then
//  drawImage() it (scaled) per particle. Module-level and shared across instances --
//  the default party-popper bitmap is identical everywhere, so there is no reason to
//  cache per canvas.
//  Zero rasterization on the hot path after first sight of a glyph.
// ---------------------------------------------------------

const EmojiAtlas = (() => {
    const BASE = 64;            // render size; drawImage scales to each particle's w
    const PAD = 8;              // guard against glyphs overflowing the box
    const SIZE = BASE + PAD * 2;
    const cache = new Map();    // char -> HTMLCanvasElement (or null in SSR)

    function rasterize(char) {
        // Checked at call time (not cached at module load): a module can be imported in
        // an SSR pass where document is absent, then run in the browser after hydration.
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
        const c = document.createElement('canvas');
        c.width = SIZE;
        c.height = SIZE;
        const g = c.getContext('2d');
        if (!g) return null;
        g.font = `${BASE}px sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(char, SIZE / 2, SIZE / 2);
        return c;
    }

    return {
        /** The cached glyph canvas for `char`, rasterizing on first use. */
        get(char) {
            let g = cache.get(char);
            if (g === undefined) {
                g = rasterize(char);
                // Only cache a real glyph. A null (no document yet) must not poison the
                // cache -- a later call after hydration should retry.
                if (g) cache.set(char, g);
            }
            return g;
        },
        /** Pre-warm a glyph so the first burst has no first-frame rasterization hitch. */
        prime(char) { this.get(char); },
        /** Test/debug: current cache size. */
        get size() { return cache.size; },
    };
})();


// ---------------------------------------------------------
//  SPRITE ATLAS
//  registerShape({ image }) prerenders an arbitrary image source (an <img>, a
//  canvas, an ImageBitmap) ONCE to a fixed-size offscreen canvas, then blits it
//  (scaled) per particle -- the same GPU-blit hot path as the emoji glyph atlas,
//  generalised to any picture. Keyed by the source object's identity and shared
//  across instances (the rasterised bitmap does not depend on which instance asked).
// ---------------------------------------------------------

const SpriteAtlas = (() => {
    const SIZE = 64;              // render size; drawImage scales to each particle's w
    const cache = new Map();      // image source -> HTMLCanvasElement (or null in SSR)

    function rasterize(img) {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
        const c = document.createElement('canvas');
        c.width = SIZE;
        c.height = SIZE;
        const g = c.getContext('2d');
        if (!g) return null;
        // A not-yet-decoded <img> draws nothing rather than throwing; a broken source
        // (drawImage rejects it) fails closed to null so registerShape can report it.
        try { g.drawImage(img, 0, 0, SIZE, SIZE); } catch (_e) { return null; }
        return c;
    }

    return {
        /** The cached sprite canvas for `img`, rasterizing on first use; null if it cannot. */
        get(img) {
            if (!img) return null;
            let c = cache.get(img);
            if (c === undefined) {
                c = rasterize(img);
                if (c) cache.set(img, c);
            }
            return c;
        },
    };
})();


// ---------------------------------------------------------
//  CONFETTI CANVAS
// ---------------------------------------------------------

/**
 * Create a confetti instance bound to a canvas.
 *
 * @param {HTMLCanvasElement} canvas  Overlay canvas (position: fixed, pointer-events: none)
 * @param {Object} [options]
 * @param {number} [options.seed]            RNG seed for deterministic output
 * @param {number} [options.maxParticles=500] Pool size
 * @param {boolean} [options.respectReducedMotion=true]  Honor prefers-reduced-motion
 * @param {number} [options.trail=0]         Motion-trail capacity: ring-buffer depth (samples of
 *   recent world positions) for the per-particle ribbon. 0 = off (no buffers, byte-identical to
 *   no trails). Capped at 64; fail-closed to 0. Sizes the buffer ONCE (zero-GC, no lazy growth) --
 *   a per-burst `trail` (0..this) then shortens or opts a burst out. Pure render overlay: every
 *   committed physics fingerprint is preserved. No effect under reduced motion.
 */
export function createConfetti(canvas, {
    seed,
    maxParticles = 500,
    respectReducedMotion = true,
    trail = 0,
} = {}) {
    if (!canvas) {
        console.warn('@zakkster/lite-confetti: canvas required');
        return { burst() {}, spray() {}, clear() {}, registerShape() { return -1; }, destroy() {} };
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.warn('@zakkster/lite-confetti: canvas 2d context unavailable');
        return {
            burst() {}, spray() {}, clear() {}, get count() { return 0; },
            seed() {}, registerShape() { return -1; }, destroy() {},
        };
    }
    const rng = new Random(seed ?? Date.now());
    const ticker = acquireTicker();
    let removeFn = null;
    let destroyed = false;

    // -- Cached dimensions (never read clientWidth in the hot loop) --
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    let cw = 0;
    let ch = 0;

    function updateSize() {
        cw = canvas.clientWidth || canvas.width;
        ch = canvas.clientHeight || canvas.height;
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset to identity first
        ctx.scale(dpr, dpr);                  // Then apply exact DPR
    }

    updateSize(); // Initial sizing

    // -- ResizeObserver (same pattern as lite-viewport) --
    // Observes parent element, RAF-deduped to prevent double-fire.
    // Responds to CSS flex/grid reflow, not just window resize.
    let _ro = null;
    let _resizeScheduled = false;

    if (typeof ResizeObserver !== 'undefined') {
        _ro = new ResizeObserver(() => {
            if (!_resizeScheduled && !destroyed) {
                _resizeScheduled = true;
                requestAnimationFrame(() => {
                    _resizeScheduled = false;
                    if (!destroyed) { updateSize(); if (_ptrBound) _ptrMeasure(); }
                });
            }
        });
        _ro.observe(canvas.parentElement || canvas);
    }

    // -- Particle Pool (flat arrays for cache-friendliness) --
    const pool = {
        x:     new Float32Array(maxParticles),
        y:     new Float32Array(maxParticles),
        vx:    new Float32Array(maxParticles),
        vy:    new Float32Array(maxParticles),
        spin:  new Float32Array(maxParticles),   // current rotation (radians)
        spinV: new Float32Array(maxParticles),   // spin velocity
        sdrag: new Float32Array(maxParticles),   // angular retention 0..1; 1 = off (v1.23.0)
        tilt:  new Float32Array(maxParticles),   // wobble phase
        tiltV: new Float32Array(maxParticles),   // wobble speed
        w:     new Float32Array(maxParticles),   // width
        h:     new Float32Array(maxParticles),   // height
        life:  new Float32Array(maxParticles),
        maxL:  new Float32Array(maxParticles),
        grav:  new Float32Array(maxParticles),   // per-particle gravity
        wind:  new Float32Array(maxParticles),   // per-particle lateral wind accel (px/sec^2)
        floor: new Float32Array(maxParticles),   // settle boundary Y (CSS px); Infinity = none
        bounce:new Float32Array(maxParticles),   // restitution 0..1 applied on any boundary contact
        wallL: new Float32Array(maxParticles),   // left wall X (CSS px); -Infinity = none
        wallR: new Float32Array(maxParticles),   // right wall X (CSS px); +Infinity = none
        ceil:  new Float32Array(maxParticles),   // ceiling Y (CSS px); -Infinity = none
        drag:  new Float32Array(maxParticles),
        flut:  new Float32Array(maxParticles),   // flutter: tumble depth 0..1 (X-scale wobble)
        sway:  new Float32Array(maxParticles),   // sway: horizontal drift amplitude 0..1
        align: new Float32Array(maxParticles),   // velocity-align blend 0..1 (0 = pure random spin)
        spin0: new Float32Array(maxParticles),   // birth orientation (the pivot spinRate scales about)
        spinRate: new Float32Array(maxParticles), // render-time tumble-speed multiplier; 1 = as seeded
        scaleTo: new Float32Array(maxParticles), // render-time size-over-life target; 1 = constant size
        tilt0: new Float32Array(maxParticles),   // birth wobble phase (the pivot flutterRate scales about)
        flutterRate: new Float32Array(maxParticles), // render-time wobble-speed multiplier; 1 = as seeded
        fadeIn: new Float32Array(maxParticles), // render-time birth-opacity ramp; 0 = off
        fadeOut: new Float32Array(maxParticles), // death-fade window fraction; default fround(0.3)
        turb:  new Float32Array(maxParticles),   // turbulence accel magnitude (px/sec^2); 0 = none
        gust:  new Float32Array(maxParticles),   // gust accel magnitude (px/sec^2); 0 = none
        vortX: new Float32Array(maxParticles),   // vortex/attractor center X (CSS px)
        vortY: new Float32Array(maxParticles),   // vortex/attractor center Y (CSS px)
        attract:new Float32Array(maxParticles),  // radial spring strength (1/sec^2); 0 = off, <0 = repel
        swirl: new Float32Array(maxParticles),   // tangential strength (1/sec^2); 0 = off, sign = spin
        settle:new Float32Array(maxParticles),   // rest-speed threshold (px/sec); 0 = off (never settles)
        landed:new Uint8Array(maxParticles),     // 1 = at rest on the floor (physics frozen); 0 = active
        fric:  new Float32Array(maxParticles),   // tangential floor drag 0..1; 0 = off (frictionless)
        wfric: new Float32Array(maxParticles),   // tangential drag on non-floor box edges 0..1; 0 = off
        delay: new Float32Array(maxParticles),   // seconds until birth (staggered emission); 0 = born/active
        shape: new Uint8Array(maxParticles),     // 0..4 built-in, 5+ = registerShape() custom
    };

    // Color and emoji stored as arrays (can't go in TypedArrays)
    const colors = new Array(maxParticles);
    const emojis = new Array(maxParticles);
    // Per-particle color-over-life ramp (v1.12.0): the burst's baked `lifeColors` LUT (an array of
    // CSS strings), or null/undefined when off. Holds a reference, not a number, so it is a plain
    // Array alongside `colors`. Always (re)assigned in spawn(), so a recycled slot can never inherit
    // a prior burst's ramp -- the fail-closed pool-reuse reset (cf. `landed = 0` / `trailN = 0`).
    const colorRamp = new Array(maxParticles);

    // -- Motion-trail ring buffer (v1.9.0), allocated ONCE at construction ---------------
    // `trail` is the capacity: how many recent world positions each particle remembers. It
    // MUST be fixed here -- a zero-GC ring buffer cannot grow lazily -- so it is a construction
    // option, coerced fail-closed (NaN/Infinity/negative/string -> 0 = off; over-large -> capped
    // at TRAIL_MAX so a typo can't request a gigabyte). trailCap === 0 allocates nothing and the
    // whole feature is absent: no buffers, `_trailHead` never advances, no stroke() is ever
    // emitted, so the draw path is byte-identical to an engine without trails.
    const trailCap = Math.min(TRAIL_MAX, Math.floor(nonneg(trail, 0)));
    // Interleaved-by-column SoA, matching the pool: trailX[i*trailCap + ring], same for Y. Two
    // Uint8 per-particle columns: trailN is the live sample count (grows from 0 at spawn, capped
    // at this particle's trailLen), trailLen is its per-burst draw length. Only allocated when
    // trails are on, so a default instance pays zero extra bytes.
    const trailX = trailCap ? new Float32Array(maxParticles * trailCap) : null;
    const trailY = trailCap ? new Float32Array(maxParticles * trailCap) : null;
    const trailN = trailCap ? new Uint8Array(maxParticles) : null;
    const trailLen = trailCap ? new Uint8Array(maxParticles) : null;
    // Global write cursor, advanced once per frame (all alive particles append to the same ring
    // slot each frame). Read ONLY inside trail code, so it can never perturb a fingerprint.
    let _trailHead = 0;

    let head = 0;
    let aliveCount = 0;

    // Instance wall-clock (seconds), advanced once per update(). The shared phase for the
    // global `gust` oscillation. Read ONLY inside the gust guard, so it never perturbs a
    // gust-free burst (every committed fingerprint is unaffected by its existence). Never
    // reset -- a pure function of frames elapsed stays deterministic; a fresh instance (as
    // every unit test uses) starts at 0.
    let _elapsed = 0;

    // -- Pointer-follow state (v1.2.0), per-instance --------------------------
    // Opt-in: nothing is bound until spray({ followPointer:true }) runs, so a page
    // that imports lite-confetti but never follows the pointer installs no global
    // listener. Coordinates are converted from viewport space into THIS canvas's
    // CSS-pixel space (spawn() draws through a DPR-scaled ctx, so it wants CSS px,
    // measured from the canvas's own top-left -- not e.clientX, which is only the
    // same thing when the canvas happens to be a full-viewport overlay at 0,0).
    let _ptrX = 0, _ptrY = 0, _ptrSeen = false;
    let _ptrRectL = 0, _ptrRectT = 0, _ptrScaleX = 1, _ptrScaleY = 1;
    let _ptrBound = false, _ptrRefs = 0;

    function _ptrMeasure() {
        // Cached at bind and on resize -- reading getBoundingClientRect per
        // pointermove would force a layout on every event.
        if (typeof canvas.getBoundingClientRect !== 'function') return;
        const r = canvas.getBoundingClientRect();
        _ptrRectL = r.left;
        _ptrRectT = r.top;
        // CSS px per client px. Usually 1, but a CSS-scaled canvas (width != rect.width)
        // needs this or the follow point drifts.
        _ptrScaleX = r.width > 0 ? cw / r.width : 1;
        _ptrScaleY = r.height > 0 ? ch / r.height : 1;
    }
    function _onPointerMove(e) {
        _ptrX = (e.clientX - _ptrRectL) * _ptrScaleX;
        _ptrY = (e.clientY - _ptrRectT) * _ptrScaleY;
        _ptrSeen = true;
    }
    function _bindPointer() {
        _ptrRefs++;
        if (_ptrBound || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
        _ptrMeasure();
        window.addEventListener('pointermove', _onPointerMove, { passive: true });
        _ptrBound = true;
    }
    function _unbindPointer() {
        if (_ptrRefs > 0) _ptrRefs--;
        if (_ptrRefs > 0 || !_ptrBound) return;
        window.removeEventListener('pointermove', _onPointerMove);
        _ptrBound = false;
    }

    // -- Shape table (per-instance, so custom shapes never leak between instances) --
    // Ids 0..4 are the built-ins; registerShape() allocates 5+. The render loop
    // dispatches through shapeDraw[id] (an indexed call, zero-allocation) and consults
    // shapeBlit[id] to decide whether to set fillStyle (vector fill) or leave it (blit:
    // emoji / image sprites paint their own pixels). Every draw fn takes the uniform
    // signature (ctx, w, h, i) and ignores the args it does not need.
    const shapeDraw = [
        Shapes.rect,
        Shapes.circle,
        Shapes.star,
        Shapes.triangle,
        (dctx, w, _h, i) => Shapes.emoji(dctx, w, emojis[i]),
    ];
    const shapeBlit = [false, false, false, false, true];
    const shapeName2Id = new Map([['rect', 0], ['circle', 1], ['star', 2], ['triangle', 3], ['emoji', 4]]);
    let nextShapeId = 5;

    // -- Spawn a single particle --
    function spawn(x, y, vx, vy, config) {
        const i = head;
        head = (head + 1) % maxParticles;

        pool.x[i] = x;
        pool.y[i] = y;
        pool.vx[i] = vx;
        pool.vy[i] = vy;
        pool.spin[i] = rng.next() * TAU;
        pool.spin0[i] = pool.spin[i];   // birth tilt: the pivot for the spinRate render scale
        pool.spinV[i] = (rng.next() - 0.5) * 10;
        // Angular retention (v1.23.0). ALWAYS written -- LOAD-BEARING, like scaleTo/flutterRate/fadeOut, NOT
        // house style: a Float32Array zero-init of 0 means "instant spin freeze" -- a WRONG default. A recycled
        // slot that skipped this write would spawn with a frozen tumble. The default must be 1 (off), so the
        // unconditional write is REQUIRED for fail-closed pool reuse. (Contrast fric/wfric whose zero-init 0 == off.)
        pool.sdrag[i] = config.spinDrag;
        pool.tilt[i] = rng.next() * TAU;
        pool.tilt0[i] = pool.tilt[i];   // birth wobble phase: the pivot for the flutterRate render scale
        pool.tiltV[i] = 1 + rng.next() * 4;
        pool.w[i] = config.sizeMin + rng.next() * (config.sizeMax - config.sizeMin);
        pool.h[i] = pool.w[i] * (0.4 + rng.next() * 0.6); // slight height variation
        pool.life[i] = config.lifeMin + rng.next() * (config.lifeMax - config.lifeMin);
        pool.maxL[i] = pool.life[i];
        pool.grav[i] = config.gravity;
        pool.wind[i] = config.wind;
        pool.floor[i] = config.floor;
        pool.bounce[i] = config.bounce;
        pool.wallL[i] = config.wallLeft;
        pool.wallR[i] = config.wallRight;
        pool.ceil[i] = config.ceiling;
        pool.drag[i] = config.drag;
        pool.flut[i] = config.flutter;
        pool.sway[i] = config.sway;
        pool.align[i] = config.align;   // velocity-align blend (v1.15.0); 0 = pure random spin
        pool.spinRate[i] = config.spinRate;   // render-time tumble-speed multiplier (v1.16.0); 1 = as seeded
        // Size-over-life target (v1.17.0). ALWAYS written, never zero-init: a Float32Array default of 0
        // would mean "shrink to nothing", so a recycled slot that skipped the write would render a
        // vanishing piece. Fail-closed pool-reuse reset, like `landed = 0` / `trailN = 0`.
        pool.scaleTo[i] = config.scaleTo;
        // Tumble-wobble speed (v1.18.0). ALWAYS written, never zero-init: a Float32Array default of 0
        // would mean "frozen wobble" on a recycled slot that skipped the write (the default must be 1),
        // so this is unconditional like scaleTo. Mirrors the tilt0 birth-pivot capture above.
        pool.flutterRate[i] = config.flutterRate;
        // Birth-opacity ramp (v1.19.0). ALWAYS written (house style + fail-closed pool-reuse reset). Here
        // the Float32Array zero-init default of 0 HAPPENS to coincide with "off" (safe, unlike scaleTo/
        // flutterRate whose 0 would be a bad state), but we still write unconditionally; we do not rely on it.
        pool.fadeIn[i] = config.fadeIn;
        // Death-fade window (v1.20.0). ALWAYS written -- LOAD-BEARING, not house style. UNLIKE fadeIn
        // (whose zero-init 0 coincides with "off"), a Float32Array zero-init of 0 for fadeOut means
        // "hard cut, no death fade" -- a WRONG default. A recycled slot that skipped this write would
        // render a piece that never fades out. This is the scaleTo/flutterRate situation: the
        // unconditional write is REQUIRED for fail-closed pool reuse.
        pool.fadeOut[i] = config.fadeOut;
        pool.turb[i] = config.turbulence;
        pool.gust[i] = config.gust;
        pool.vortX[i] = config.attractX;
        pool.vortY[i] = config.attractY;
        pool.attract[i] = config.attract;
        pool.swirl[i] = config.swirl;
        pool.settle[i] = config.settle;
        // Tangential floor drag (v1.21.0). ALWAYS written for pool-reuse correctness (a recycled slot
        // must not inherit a prior burst's friction), but NOT load-bearing: unlike scaleTo/fadeOut, the
        // Float32Array zero-init default of 0 == "off" (frictionless) is the CORRECT default, so nothing
        // relies on this write to avoid a wrong state (this is the fadeIn/wind situation). We still write
        // unconditionally, in house style. 0 is exactly representable in Float32 -- no fround sentinel.
        pool.fric[i] = config.friction;
        // Tangential drag on the box's non-floor edges (v1.22.0). ALWAYS written for pool-reuse correctness
        // (a recycled slot must not inherit a prior burst's wallFriction), but NOT load-bearing: like `fric`,
        // the Float32Array zero-init default of 0 == "off" is the CORRECT default, so nothing relies on this
        // write to avoid a wrong state (the fadeIn/wind/friction situation, NOT the fadeOut/scaleTo one). 0 is
        // exactly representable in Float32 -- no fround sentinel.
        pool.wfric[i] = config.wallFriction;
        // Fail-closed reset: a recycled slot must never inherit the dead particle's frozen state,
        // or a fresh piece would spawn already "landed" and skip all physics. (Same pool-reuse
        // subtlety as the trail `trailN = 0` reset.)
        pool.landed[i] = 0;
        // Staggered emission (v1.14.0): reset the birth delay so a recycled slot is born at once
        // unless the caller stamps a fresh delay (same fail-closed pool-reuse guard as `landed`).
        pool.delay[i] = 0;
        // Motion trail: reset the live sample count to 0 and stamp this burst's draw length.
        // Resetting trailN is the fail-closed guard on pool reuse -- the recycled ring slots
        // still hold the DEAD particle's positions, but we only ever read the last trailN of
        // them, and trailN grows only as the NEW particle writes fresh samples, so a dead
        // particle's trail can never leak into a live one. Guarded so a trail-less instance
        // (trailN === null) touches nothing.
        if (trailN) { trailN[i] = 0; trailLen[i] = config.trailLen; }
        // Multi-shape mixing: when a `shapes` mix is active, pick a shape per particle
        // (weighted by repetition in the array). The single-shape branch takes NO rng
        // draw, so a default burst's determinism fingerprint is byte-for-byte preserved;
        // the mixed branch draws exactly one rng.next() at this fixed point (before the
        // colour pick below), so a mixed burst is itself deterministic under a fixed seed.
        pool.shape[i] = config.shapeIds
            ? config.shapeIds[(rng.next() * config.shapeIds.length) | 0]
            : config.shapeId;
        colors[i] = config.colorPick();
        // Color-over-life: the shared baked ramp for this burst (or null when off). Always assigned,
        // so a recycled slot can never keep a dead particle's ramp. `colors[i]` is still picked above
        // (one rng.pick, unchanged) and stays the flat trail color + the body color when off.
        colorRamp[i] = config.lifeRamp;
        emojis[i] = config.emoji || DEFAULT_EMOJI;
        return i; // the slot filled, so the caller can stamp a per-particle stagger delay on it
    }

    // -- Render loop --
    function update(dt) {
        const dtSec = dt / 1000;
        _elapsed += dtSec;   // instance clock: the shared phase for the global `gust` swell
        const W = canvas.width;
        const H = canvas.height;

        ctx.clearRect(0, 0, W, H);

        // Advance the trail ring cursor once per frame (all alive particles append to this same
        // slot below). Guarded so a trail-less instance never touches it. Read only in trail code.
        if (trailCap !== 0) _trailHead = _trailHead + 1 === trailCap ? 0 : _trailHead + 1;

        let alive = 0;

        for (let i = 0; i < maxParticles; i++) {
            if (pool.life[i] <= 0) continue;

            // Staggered birth (v1.14.0): an unborn piece waits, frozen and invisible, until its
            // delay elapses -- its FULL life begins at birth, so life is NOT counted down here, and
            // physics + trail record + render are all skipped below. It still counts as alive so the
            // loop stays registered through the whole window (no premature auto-detach). `delay` is 0
            // for every piece unless `stagger` armed it, so this branch never fires by default and
            // every committed fingerprint is byte-identical.
            if (pool.delay[i] > 0) { pool.delay[i] -= dtSec; alive++; continue; }

            pool.life[i] -= dtSec;
            if (pool.life[i] <= 0) { pool.life[i] = 0; continue; }

            alive++;

            // Physics -- skipped ENTIRELY for a landed (settled) piece. A settled piece is frozen
            // in place: it keeps its exact position AND rotation (no integration, no sway, no spin
            // advance), so a pile lies still and cannot be nudged by wind/gust/sway. It still ages,
            // fades, records its trail, and draws below (all OUTSIDE this guard). When `settle` is
            // unused, `landed[i]` is always 0, so this branch always runs and every committed
            // fingerprint (default + every force + box + trail) is byte-identical.
            if (!pool.landed[i]) {
                pool.vy[i] += pool.grav[i] * dtSec;
                // Wind: sustained lateral drift, the X-axis mirror of gravity. Guarded so the
                // default (wind == 0) leaves vx byte-identical -- gravity is unguarded only
                // because its default is non-zero; wind defaults to 0, so it follows the sway
                // discipline (the committed fingerprint depends on this branch never firing by
                // default). Applied before drag, so wind is damped toward a terminal lateral
                // velocity exactly as gravity is toward a terminal fall speed.
                if (pool.wind[i] !== 0) pool.vx[i] += pool.wind[i] * dtSec;
                // Turbulence: a per-particle rotating acceleration for organic wander. Reuses the
                // tilt + spin phases (already advanced every frame, seeded once at spawn) so it
                // draws NO rng -- the curl direction is a pure deterministic function of seeded
                // state, hence a turbulent burst is reproducible for free. Guarded so turb == 0
                // leaves vx/vy byte-identical (the committed fingerprints depend on this branch
                // never firing by default). Decorrelated from `sway` (a position offset from
                // sin(tilt)) by mixing spin in and driving BOTH axes.
                if (pool.turb[i] !== 0) {
                    const tp = pool.tilt[i] * 1.7 + pool.spin[i];
                    pool.vx[i] += Math.cos(tp) * pool.turb[i] * dtSec;
                    pool.vy[i] += Math.sin(tp) * pool.turb[i] * dtSec;
                }
                // Gust: a global sinusoidal horizontal acceleration (a coherent breeze), layered
                // on wind. Phase is the shared `_elapsed` clock so the whole pool swells together;
                // amplitude is per-particle. Guarded so gust == 0 is byte-identical. Applied
                // before drag, like wind, so it too damps toward a terminal velocity.
                if (pool.gust[i] !== 0) pool.vx[i] += Math.sin(_elapsed * GUST_HZ) * pool.gust[i] * dtSec;
                // Vortex: a linear-spring point force. `attract` pulls toward (center - pos) -- the
                // force is ZERO at the center (no singularity), so a PULL (attract > 0) is a damped
                // oscillator that spirals in; `swirl` adds the perpendicular tangential component, so
                // together (at, sw) apply the matrix [[at,-sw],[sw,at]] to the radial vector (pull +
                // rotation). Draws NO rng -- a pure function of the particle's own position and the
                // burst center -- so a vortexed burst is reproducible for free. Guarded so the default
                // (attract == 0 && swirl == 0) leaves vx/vy byte-identical (every committed fingerprint
                // depends on this branch never firing by default). Applied before drag, like the other
                // forces, so it damps toward the center rather than running away.
                if (pool.attract[i] !== 0 || pool.swirl[i] !== 0) {
                    const rx = pool.vortX[i] - pool.x[i];
                    const ry = pool.vortY[i] - pool.y[i];
                    const at = pool.attract[i], sw = pool.swirl[i];
                    let ax = at * rx - sw * ry;
                    let ay = at * ry + sw * rx;
                    // Fail-closed finiteness cap: a NEGATIVE attract is an anti-spring (exponentially
                    // unstable far from the center), so an unclamped repeller could drive a position to
                    // Float32 Infinity. Clamping each accel component bounds velocity growth to linear,
                    // so positions stay finite over any finite run. Never bites in the normal regime.
                    if (ax > VORTEX_MAX_ACCEL) ax = VORTEX_MAX_ACCEL; else if (ax < -VORTEX_MAX_ACCEL) ax = -VORTEX_MAX_ACCEL;
                    if (ay > VORTEX_MAX_ACCEL) ay = VORTEX_MAX_ACCEL; else if (ay < -VORTEX_MAX_ACCEL) ay = -VORTEX_MAX_ACCEL;
                    pool.vx[i] += ax * dtSec;
                    pool.vy[i] += ay * dtSec;
                }
                pool.vx[i] *= pool.drag[i];
                pool.vy[i] *= pool.drag[i];
                pool.x[i] += pool.vx[i] * dtSec;
                pool.y[i] += pool.vy[i] * dtSec;

                // Floor: an opt-in settle boundary on the Y axis (the piece lands instead of
                // falling forever). Guarded so the default (floor == Infinity) NEVER fires --
                // `y > Infinity` is always false -- leaving y/vy byte-identical to pre-1.6.0, so
                // the committed default fingerprint is preserved (the same structural-guard trick
                // as wind's `!= 0`). On contact, clamp onto the floor and reflect vy scaled by
                // restitution (bounce): 0 rests (pile-up), 1 is perfectly elastic. clamp01 keeps
                // bounce in 0..1 so a rebound can never ADD energy, and drag still damps vy every
                // frame, so even bounce == 1 loses energy and settles -- never a runaway. Draws no
                // rng, so a floored burst stays deterministic under a fixed seed.
                if (pool.y[i] > pool.floor[i]) {
                    pool.y[i] = pool.floor[i];
                    pool.vy[i] = -pool.vy[i] * pool.bounce[i];
                    // Friction (v1.21.0): tangential floor drag. On a floor-contact frame, bleed the HORIZONTAL
                    // (vx) component by `1 - fric`, the complement to `bounce` (which reflects the vertical
                    // component). Guarded on fric != 0 so the committed floor/box fingerprints are byte-identical
                    // when off (0 is exactly representable in Float32, so no fround sentinel is needed). A
                    // contraction (factor in [0,1]) => |vx| never grows, finite for any input, no accel cap. Draws
                    // no rng. Runs only when NOT landed (whole block is skipped for a settled piece) and only with a
                    // floor (this branch is otherwise unreachable), so a frictionless or floorless burst is untouched.
                    if (pool.fric[i] !== 0) pool.vx[i] *= 1 - pool.fric[i];
                    // Settle: if the rebound is too weak to lift the piece off the floor (the
                    // reflected |vy| is below the rest threshold), it comes to REST -- freeze it
                    // here for the rest of its life. It keeps aging + fading (see the life
                    // countdown above), so the slot still recycles and the pile is a transient
                    // drift, not a permanent leak. Guarded on settle != 0, so the committed
                    // floor/box fingerprints are byte-identical when off. The `> -settle &&
                    // < settle` pair is `|vy| < settle` without a Math.abs call. Draws no rng, so
                    // a settling burst is deterministic. With bounce == 0 the reflected vy is 0,
                    // so a piece rests on first contact; a higher bounce just makes it bounce longer
                    // before the rebound decays below the threshold (drag still bleeds energy every
                    // frame). With no floor this branch is unreachable, so nothing ever settles.
                    if (pool.settle[i] !== 0 && pool.vy[i] > -pool.settle[i] && pool.vy[i] < pool.settle[i]) {
                        pool.landed[i] = 1;
                        pool.vx[i] = 0;
                        pool.vy[i] = 0;
                    }
                }

                // Ceiling: the Y-min edge of the bounding box (v1.7.0), the mirror of `floor`.
                // Guarded so the default (ceil == -Infinity) NEVER fires -- `y < -Infinity` is
                // always false -- so it is byte-identical to pre-1.7.0 and BOTH committed
                // fingerprints (default + the v1.6.0 floored) are preserved. Separate from the
                // floor `if` above (not an else) so the floor block stays literally unchanged; for
                // a valid box (ceil < floor) a single y can't trip both in one frame anyway.
                // Reuses `bounce` as the shared box restitution; draws no rng (pure physics).
                if (pool.y[i] < pool.ceil[i]) {
                    pool.y[i] = pool.ceil[i];
                    pool.vy[i] = -pool.vy[i] * pool.bounce[i];
                    // Wall friction (v1.22.0): tangential drag on the box's non-floor edges. At the CEILING
                    // `bounce` reflects the NORMAL (vertical, vy) component; `wallFriction` damps the TANGENT
                    // (horizontal, vx) -- the OTHER component, so it never kills the reflection. Guarded on
                    // wfric != 0 so the committed box fingerprints are byte-identical when off (0 is exactly
                    // representable in Float32, no fround sentinel). A contraction (factor in [0,1]) => |vx|
                    // never grows, finite for any input, no accel cap. Draws no rng. Needs a box (this branch
                    // is otherwise unreachable), so a frictionless or boxless burst is untouched.
                    if (pool.wfric[i] !== 0) pool.vx[i] *= 1 - pool.wfric[i];
                }

                // Spin + wobble
                // Angular drag (v1.23.0): the angular mirror of the linear `vx *= drag` above. Off (spinDrag == 1)
                // leaves spinV untouched, so every committed fingerprint -- rotateHash included -- is byte-identical
                // (1 is exact in Float32; no fround sentinel). A contraction (factor in [0,1]) => |spinV| never grows,
                // finite for any input, no accel cap. Damps spinV ONLY, never tiltV (tilt feeds sway + the turb curl).
                // HYBRID physics knob: with turbulence OFF this moves only the render rotation (position byte-identical,
                // rotateHash moves); with turbulence ON the curl phase (tp = tilt*1.7 + spin) reads the slower spin, so
                // it moves the POSITION stream too. NOT a pure render overlay.
                if (pool.sdrag[i] !== 1) pool.spinV[i] *= pool.sdrag[i];
                pool.spin[i] += pool.spinV[i] * dtSec;
                pool.tilt[i] += pool.tiltV[i] * dtSec;

                // Sway: paper-like side-to-side drift, opt-in. Guarded so the default
                // (sway == 0) leaves positions byte-identical to pre-1.3.0 -- the committed
                // determinism fingerprint depends on this branch never firing by default.
                if (pool.sway[i] !== 0) {
                    pool.x[i] += Math.sin(pool.tilt[i]) * pool.sway[i] * SWAY_PX * dtSec;
                }

                // Walls: the X-min / X-max edges of the bounding box (v1.7.0), the X-axis mirror
                // of `floor`/`ceiling`. Placed AFTER the sway block on purpose -- x is mutated by
                // BOTH the vx integration above AND sway, so the clamp must be the frame's LAST x
                // write to actually contain a swaying particle. Guarded so the defaults
                // (wallL == -Infinity, wallR == +Infinity) NEVER fire -- `x < -Infinity` and
                // `x > +Infinity` are always false -- so both committed fingerprints are preserved.
                // if/else-if because a particle can't breach both walls in one frame. Reuses
                // `bounce` as the shared box restitution; draws no rng (pure physics).
                if (pool.x[i] < pool.wallL[i]) {
                    pool.x[i] = pool.wallL[i];
                    pool.vx[i] = -pool.vx[i] * pool.bounce[i];
                    // Wall friction (v1.22.0): at a WALL `bounce` reflects the NORMAL (horizontal, vx)
                    // component; `wallFriction` damps the TANGENT (vertical, vy) -- the OTHER component
                    // (contrast the ceiling above, which damps vx). Same guard/contraction/needs-a-box notes.
                    if (pool.wfric[i] !== 0) pool.vy[i] *= 1 - pool.wfric[i];
                } else if (pool.x[i] > pool.wallR[i]) {
                    pool.x[i] = pool.wallR[i];
                    pool.vx[i] = -pool.vx[i] * pool.bounce[i];
                    if (pool.wfric[i] !== 0) pool.vy[i] *= 1 - pool.wfric[i];
                }
            }

            // Motion trail: append this frame's FINAL position (after every clamp above, so the
            // stored point equals where the body draws) to the ring, and grow the live count up
            // to this particle's draw length. Pure TypedArray stores + one integer increment --
            // zero allocation. Guarded so trail-less instances and trail:0 bursts do no work and
            // write nothing (leaving stale slots untouched -- see the spawn() reuse note).
            if (trailCap !== 0 && trailLen[i] !== 0) {
                const base = i * trailCap;
                trailX[base + _trailHead] = pool.x[i];
                trailY[base + _trailHead] = pool.y[i];
                if (trailN[i] < trailLen[i]) trailN[i]++;
            }

            // Opacity fade OUT over the last 30% of life (unchanged). lifeT = life/maxL: 1 at birth, 0 at death.
            const lifeT = pool.life[i] / pool.maxL[i];
            let alpha = lifeT < 0.3 ? lifeT / 0.3 : 1;
            // Death fade-OUT window (v1.20.0). Off (fadeOut == the fround(0.3) default) leaves `alpha` above
            // byte-identical -- the line above keeps the DOUBLE 0.3 literal, so the committed off-look alphaHash
            // (2389639168) and ALPHA_HASH (3712788104) are preserved bit-for-bit. When armed, recompute the base
            // alpha with the caller's window: fadeOut 0 = hard cut (lifeT < 0 is never true -> alpha 1, no fade,
            // no divide), 1 = dissolve across the whole life. Pure RENDER overlay: reads only lifeT, writes only
            // the local alpha; never touches ctx.translate / x / y / rng. The fadeIn block below still MULTIPLIES
            // this base, so fadeIn + fadeOut compose into the full opacity envelope. FADE_OUT_DEF = fround(0.3)
            // is the sentinel: comparing against the double 0.3 would fire always (fround(0.3) !== 0.3).
            const fo = pool.fadeOut[i];
            if (fo !== FADE_OUT_DEF) alpha = lifeT < fo ? lifeT / fo : 1;
            // Birth fade-IN (v1.19.0). Off (fadeIn == 0) skips the branch -- alpha byte-identical to every prior
            // release. When armed, ramp alpha 0 -> 1 over the FIRST `fadeIn` fraction of life by the age fraction
            // (1 - lifeT), so a piece materializes in; near a very short life the fade-in and death fade-out
            // windows overlap and correctly MULTIPLY. A pure RENDER overlay: alpha never touches ctx.translate /
            // x / y / rng, so the seeded POSITION stream is byte-identical whether off or on -- only globalAlpha
            // changes (its own alphaHash probe). clamp01 gates fadeIn to [0,1]; the `> 0` guard avoids a divide
            // and keeps off exact. Zero rng, zero alloc (stack locals). Folded BEFORE the trail block so the
            // ribbon (ctx.globalAlpha = alpha * TRAIL_ALPHA) materializes in WITH the body for free.
            if (pool.fadeIn[i] > 0) {
                const age = 1 - lifeT;                 // 0 at birth -> 1 at death
                if (age < pool.fadeIn[i]) alpha *= age / pool.fadeIn[i];
            }

            // 3D-ish tumble via X-scale oscillation. flutter (flut, 0..1) sets its depth:
            // flut == 1 reproduces the pre-1.3.0 wobble (0.5 + 0.5|cos|) exactly, flut == 0
            // holds the piece rigid. Scale never enters the position fingerprint, so this
            // knob is hash-neutral regardless of its value.
            const a = pool.flut[i];
            // Tumble-wobble speed (v1.18.0). Off (flutterRate == 1) feeds the raw `tilt` verbatim --
            // byte-identical to every prior release. When armed, scale the ACCUMULATED wobble phase
            // (tilt - birth) about the random birth tilt `tilt0`, so flutterRate 0 freezes each piece at
            // its OWN varied birth wobble, 2 shimmers twice as fast, <0 reverses. A pure RENDER phase
            // scale: pool.tilt is NEVER touched, so the turbulence curl phase (:862) and sway (:950) --
            // and every POSITION fingerprint -- stay byte-identical whether off or on, even with
            // turbulence armed. `flutter:0` gates the whole effect (a zero-depth wobble has no speed).
            // Zero rng, zero alloc (stack locals).
            let tiltPhase = pool.tilt[i];
            if (pool.flutterRate[i] !== 1) {
                const t0 = pool.tilt0[i];
                tiltPhase = t0 + (pool.tilt[i] - t0) * pool.flutterRate[i];
            }
            const wobbleScale = 1 - a * 0.5 * (1 - Math.abs(Math.cos(tiltPhase)));

            // Trail ribbon: a single flat-alpha stroke through the particle's recent world
            // positions, drawn BEFORE the body so the solid piece sits on top of its own streak.
            // A uniform alpha keeps the whole ribbon clearly visible (a per-segment taper to a
            // transparent tail was tried in v1.9.0 and reverted in v1.10.0 -- it made trails too
            // faint, and the "smear" it aimed to fix was a misread floor pile, not the trail).
            // Done in WORLD space with beginPath/moveTo/lineTo/stroke -- deliberately NO translate,
            // so it contributes nothing to the position fingerprint (which hashes only translate);
            // that is what keeps trails a provable pure overlay. strokeStyle reuses the color string
            // already parsed in burst()/spray() -- zero allocation on this path. Needs >= 2 samples.
            if (trailCap !== 0 && trailN[i] >= 2) {
                const n = trailN[i];
                const base = i * trailCap;
                ctx.strokeStyle = colors[i];
                ctx.lineWidth = Math.min(pool.w[i], pool.h[i]) * TRAIL_WIDTH;
                ctx.globalAlpha = alpha * TRAIL_ALPHA;
                ctx.beginPath();
                for (let k = n - 1; k >= 0; k--) {   // oldest sample -> newest (the head)
                    let r = _trailHead - k;
                    if (r < 0) r += trailCap;
                    const gx = trailX[base + r];
                    const gy = trailY[base + r];
                    if (k === n - 1) ctx.moveTo(gx, gy);
                    else ctx.lineTo(gx, gy);
                }
                ctx.stroke();
            }

            // Velocity-aligned orientation (v1.15.0). Off (align == 0) emits the raw random `spin`,
            // byte-identical to every prior release. When armed, blend the render rotation from `spin`
            // toward BROADSIDE of the LIVE velocity (heading + HALF_PI, so the flat face meets the
            // airflow -- a leaf/petal) along the SHORT arc, so a spin near a full turn never unwinds the
            // long way. atan2 is the only added cost and is paid ONLY for aligned pieces; it is total
            // (atan2(0,0) === 0 for a settled piece), so `rot` is finite for any finite velocity and any
            // align in [0,1]. Rotation never touches ctx.translate, so the seeded POSITION stream is
            // untouched -- a pure orientation overlay (the analog of lifeColors on the color axis).
            let rot = pool.spin[i];
            // Tumble-speed (v1.16.0). Off (spinRate == 1) emits the raw `spin` verbatim -- byte-identical
            // to every prior release, no multiply paid. When armed, scale the ACCUMULATED tumble
            // (spin - birth) about the random birth orientation, so spinRate 0 freezes each piece at its
            // VARIED birth tilt (not all axis-aligned), 2 doubles the spin, <0 reverses. A pure RENDER
            // scale: pool.spin is never touched, so the turbulence phase (:824) and every POSITION
            // fingerprint stay byte-identical whether off or on. `rot` is finite for any finite spinRate
            // (num() gates non-finite at call time). Zero rng, zero alloc (stack locals). Runs BEFORE the
            // align blend, which then lerps this piece's own tumble angle toward the velocity heading.
            if (pool.spinRate[i] !== 1) {
                const s0 = pool.spin0[i];
                rot = s0 + (rot - s0) * pool.spinRate[i];
            }
            if (pool.align[i] > 0) {
                const heading = Math.atan2(pool.vy[i], pool.vx[i]) + HALF_PI;
                let d = heading - rot;
                d -= TAU * Math.floor((d + Math.PI) / TAU);   // wrap the delta into [-PI, PI)
                rot += d * pool.align[i];
            }

            // Size-over-life (v1.17.0). Off (scaleTo == 1) leaves ctx.scale(wobbleScale, 1) byte-identical.
            // When armed, lerp an ISOTROPIC factor from 1 at birth to scaleTo at death by the SAME age
            // fraction (1 - lifeT) the lifeColors ramp indexes with, and fold it into the SINGLE existing
            // scale call so flutter's X-wobble and the size ramp multiply on one transform. pool.w/h are
            // NEVER touched, so the seeded POSITION stream is byte-identical whether off or on. lifeT is in
            // (0,1] (life<=0 pieces already `continue`), so age is in [0,1) and s stays finite and >=0.
            let sx = wobbleScale;
            let sy = 1;
            if (pool.scaleTo[i] !== 1) {
                const s = 1 + (pool.scaleTo[i] - 1) * (1 - lifeT);
                sx = wobbleScale * s;
                sy = s;
            }

            // Render
            ctx.save();
            ctx.translate(pool.x[i], pool.y[i]);
            ctx.rotate(rot);
            ctx.scale(sx, sy);
            ctx.globalAlpha = alpha;

            const id = pool.shape[i];
            if (!shapeBlit[id]) {
                // Color-over-life: if this burst has a baked `lifeColors` ramp, index it by the
                // particle's life fraction (birth -> step 0, death -> RAMP_LAST); else paint the flat
                // pre-parsed `colors[i]`. `ramp` truthy-guards both null (off) and undefined (never
                // spawned). Pure array read -- no per-frame color math, no allocation. Color is not in
                // the position fingerprint, so this branch is hash-neutral regardless of its value.
                const ramp = colorRamp[i];
                if (ramp) {
                    let step = ((1 - lifeT) * RAMP_LAST) | 0;
                    if (step < 0) step = 0; else if (step > RAMP_LAST) step = RAMP_LAST;
                    ctx.fillStyle = ramp[step];
                } else {
                    ctx.fillStyle = colors[i]; // Pre-parsed in burst()/spray() -- zero allocation
                }
            }
            shapeDraw[id](ctx, pool.w[i], pool.h[i], i);

            ctx.restore();
        }

        aliveCount = alive;

        // Auto-detach when all particles are dead
        if (alive === 0 && removeFn) {
            removeFn();
            removeFn = null;
        }
    }

    function ensureRunning() {
        if (!removeFn && !destroyed) {
            removeFn = ticker.add(update);
        }
    }

    // -- Reduced-motion static render (per-instance so it shares the shape table) --
    // Shows confetti pieces in their spread positions with no animation, holds ~1.5s,
    // then fades via a CSS opacity transition. Custom shapes render here too, through
    // the same shapeDraw/shapeBlit table as the animated path.
    function renderStaticBurst(cx, cy, count, colors, shapeId, sizeMin, sizeMax, spread, emoji, shapeIds) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        for (let i = 0; i < Math.min(count, 40); i++) {
            const angle = -HALF_PI + (rng.next() - 0.5) * spread;
            const dist = 30 + rng.next() * 120;
            const px = cx + Math.cos(angle) * dist;
            const py = cy + Math.sin(angle) * dist;
            const size = sizeMin + rng.next() * (sizeMax - sizeMin);
            const color = colors[Math.floor(rng.next() * colors.length)];
            // `align` (v1.15.0) is INERT here: the static fan has no velocity to orient to, so pieces
            // keep their random rotation (emission timing / orientation are motion-time concerns,
            // consistent with every prior motion feature under reduced motion). `spinRate` (v1.16.0) is
            // INERT for the same reason: the static fan has no accumulated tumble to scale. `scaleTo`
            // (v1.17.0) is INERT too: the static path does no life integration and never calls ctx.scale,
            // so a piece is drawn once at its birth size. `flutterRate` (v1.18.0) is INERT for the same
            // reason: the static path advances no `tilt` and never calls ctx.scale, so there is no
            // accumulated wobble phase to scale. `fadeIn` (v1.19.0) is INERT too: the static path does no
            // life integration and sets a constant `ctx.globalAlpha = 0.85` below, so there is no birth
            // age fraction to ramp -- the 0.85 is deliberately untouched. `fadeOut` (v1.20.0) is INERT for the
            // same reason: the static path does no life integration, so there is no `lifeT` to dissolve -- the
            // constant 0.85 is deliberately untouched, exactly like fadeIn. `friction` (v1.21.0) is INERT too:
            // the static fan does no physics integration and never reaches a floor collision, so there is no
            // floor-contact frame on which to damp `vx` -- the tangential drag has nothing to bite.
            // `wallFriction` (v1.22.0) is INERT for the same reason: the static path does no integration and
            // never reaches a ceiling or wall collision, so there is no edge-contact frame on which to damp
            // the tangential component -- the box grip has nothing to bite. `spinDrag` (v1.23.0) is INERT too:
            // the static path advances no `spin` and damps no `spinV`, so there is no accumulating tumble to
            // decay -- the angular drag has nothing to bite.
            const rotation = rng.next() * TAU;
            // Honour a `shapes` mix in the reduced-motion render too. Single-shape (null)
            // takes no extra rng draw, so the non-mixed static render is unchanged.
            const id = shapeIds ? shapeIds[(rng.next() * shapeIds.length) | 0] : shapeId;

            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(rotation);
            ctx.globalAlpha = 0.85;

            if (!shapeBlit[id]) {
                ctx.fillStyle = color; // Already pre-parsed by burst()/spray()
            }
            // The built-in emoji glyph comes from the local `emoji` here (no pool row to
            // read); every other shape -- vector or sprite -- dispatches through the table.
            if (id === 4) Shapes.emoji(ctx, size, emoji);
            else shapeDraw[id](ctx, size, size * 0.6, -1);

            ctx.restore();
        }

        // Fade out after 1.5s
        const canvasEl = ctx.canvas;
        canvasEl.style.transition = 'opacity 0.5s ease-out';
        setTimeout(() => { canvasEl.style.opacity = '0'; }, 1500);
        setTimeout(() => {
            ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
            canvasEl.style.opacity = '';
            canvasEl.style.transition = '';
        }, 2100);
    }

    // =======================================================
    //  PUBLIC API
    // =======================================================

    const api = {
        /**
         * Classic confetti burst.
         *
         * @param {Object} [options]
         * @param {number} [options.x]           Burst center X (default: canvas center)
         * @param {number} [options.y]           Burst center Y (default: top third)
         * @param {number} [options.count=80]    Number of particles
         * @param {number} [options.spread=1.2]  Emission cone width (radians, centered upward)
         * @param {number} [options.speed=400]   Initial speed range center
         * @param {number} [options.speedVariance=200] Speed randomness
         * @param {number} [options.gravity=600] Downward acceleration
         * @param {number} [options.wind=0]     Lateral acceleration px/sec^2, the X mirror of gravity (negative = leftward). Opt-in
         * @param {number} [options.floor=Infinity] Settle-boundary Y in CSS px; particles clamp to it and reflect vy. Default none. Opt-in
         * @param {number} [options.bounce=0]    Restitution 0..1 on any boundary contact (0 rests/pile-up, 1 elastic); shared by floor and walls
         * @param {number} [options.wallLeft=-Infinity]  Left wall X in CSS px; a particle reaching it clamps and reflects vx. Default none. Opt-in
         * @param {number} [options.wallRight=Infinity]  Right wall X in CSS px (see `wallLeft`). Default none. Opt-in
         * @param {number} [options.ceiling=-Infinity]   Ceiling Y in CSS px; a particle rising past it clamps and reflects vy. Default none. Opt-in
         * @param {number} [options.drag=0.98]   Per-frame velocity retention
         * @param {number} [options.sizeMin=5]
         * @param {number} [options.sizeMax=12]
         * @param {number} [options.lifeMin=1.5]
         * @param {number} [options.lifeMax=3.0]
         * @param {string} [options.shape='rect'] 'rect','circle','star','triangle','emoji', or a registerShape() name
         * @param {string[]} [options.shapes]    Mix of shape names, one chosen per particle (repetition weights it). Overrides `shape`; unknown names are dropped
         * @param {string} [options.emoji]       Emoji character (shape must be 'emoji'); defaults to a party popper
         * @param {number} [options.flutter=1]   Tumble depth 0..1 (0 rigid, 1 full wobble)
         * @param {number} [options.sway=0]      Horizontal drift 0..1 (0 straight fall)
         * @param {number} [options.align=0]     Velocity-align blend 0..1: rotate each piece BROADSIDE to its live velocity (its flat face meets the airflow, like a leaf), 0 = pure random spin, 1 = fully locked. Coerced to [0,1] (non-finite/negative => 0). A pure orientation overlay (rotation only) -- the seeded POSITION stream is byte-identical whether off or on. Zero-rng; inert under reduced motion
         * @param {number} [options.spinRate=1]  Tumble-speed multiplier on the seeded random spin: 0 = rigid at the random birth tilt, 0.3 = slow drift, 2 = double, negative = reverse. A pure RENDER scale, so the seeded POSITION stream is byte-identical off or on, even with `turbulence` armed. Zero-rng; non-finite => 1; inert under reduced motion
         * @param {number} [options.spinDrag=1]  Angular-velocity retention in [0,1] -- the angular mirror of the linear `drag`. Each frame, before the spin advance, `spinV *= spinDrag`, so the tumble decays exactly as `drag` decays translation. `1` = off (default, tumble forever, exactly today's look), `0.95` = settle to a lazy drift, `0` = FREEZE at the birth angle. clamp01: a NEGATIVE clamps to `0` (freeze -- a retention has no direction, unlike spinRate's reverse), non-finite/undefined => `1` (off), > 1 => 1. A contraction (|spinV| never grows), finite with no accel cap. Damps `spinV` only, never `tiltV`. HYBRID physics knob: with turbulence OFF it moves ONLY the render rotation (position byte-identical, rotateHash moves); with turbulence ON the curl reads the slower spin, so it MOVES positions and earns its own hash -- NOT a pure render overlay. Zero-rng; inert under reduced motion
         * @param {number} [options.scaleTo=1]   Size-over-life target: lerp each piece's RENDERED size from 1.0 at birth to `scaleTo` at death (isotropic, both axes). `0.2` shrinks out, `2` grows, `0` vanishes at death; `1` = constant size. A pure RENDER overlay folded into the flutter scale call -- pool.w/h untouched, so the seeded POSITION stream is byte-identical off or on. Coerced with nonneg: a NEGATIVE clamps to 0 (a size has no direction), NOT a mirror flip and NOT a fallback to 1; non-finite => 1. The trail ribbon keeps its birth width. Zero-rng; inert under reduced motion
         * @param {number} [options.flutterRate=1] Tumble-wobble SPEED multiplier on the seeded flutter (the SPEED knob to `flutter`'s DEPTH): 0 = wobble frozen at the random birth tilt, 0.3 = slow lazy flutter, 2 = fast shimmer, negative = reversed phase; 1 = as seeded. A pure RENDER phase scale about a birth pivot, so the seeded POSITION stream is byte-identical off or on, even with `turbulence` armed. Inert when `flutter` is 0 (a zero-depth wobble has no speed). Zero-rng; non-finite => 1; inert under reduced motion
         * @param {number} [options.fadeIn=0]     Birth-opacity ramp: fade each piece up from transparent over the FIRST `fadeIn` fraction of its life (`0.4` eases in over the first 40%). The mirror of the hardcoded death fade-out, MULTIPLYING the same alpha; `1` ramps across the whole life; default `0` = today's instant-on. A pure RENDER overlay on ctx.globalAlpha -- pool.x/y/v untouched, so the seeded POSITION stream is byte-identical off or on. The trail ribbon materializes in with the body (shares the alpha). clamp01: non-finite/undefined/negative => 0 (off), > 1 clamps to 1. Zero-rng; inert under reduced motion
         * @param {number} [options.fadeOut=0.3]  Death-fade window: the fraction of life over which each piece dissolves OUT at the END. `0.6` fades over the last 60% (a long gentle dissolve), `0.1` a quick blink-out, `1` fades across the whole life; default `0.3` = today's exact look. The mirror of `fadeIn`, MULTIPLYING the same alpha to compose the full opacity envelope. A pure RENDER overlay on ctx.globalAlpha (reads only lifeT) -- pool.x/y/v untouched, so the seeded POSITION stream is byte-identical off or on; the trail dissolves out with the body. clamp01: non-finite/undefined => `0.3` (the default window); NEGATIVE (e.g. `-1`) clamps to `0` = a hard cut (full opacity then gone), NOT a fallback to the default; > 1 clamps to 1. Zero-rng; inert under reduced motion
         * @param {number} [options.turbulence=0] Per-particle rotating accel px/sec^2 (organic wander). Opt-in, zero-rng, fingerprint-safe
         * @param {number} [options.gust=0]      Global oscillating horizontal accel px/sec^2 layered on wind (~3s swells). Opt-in, zero-rng
         * @param {number} [options.attract=0]   Vortex radial spring strength (1/sec^2, scaled by distance): + pulls toward the center, - repels. Opt-in, zero-rng, fingerprint-safe
         * @param {number} [options.swirl=0]     Vortex tangential strength (1/sec^2): spins particles around the center; sign = spin direction. Opt-in, zero-rng
         * @param {number} [options.attractX]    Vortex center X (CSS px); default: the burst origin x
         * @param {number} [options.attractY]    Vortex center Y (CSS px); default: the burst origin y
         * @param {number} [options.settle=0]    Rest-speed threshold px/sec: a piece whose post-bounce |vy| drops below it freezes on the `floor` and piles (keeps aging + fades). Needs a `floor`. Opt-in, zero-rng, fingerprint-safe
         * @param {number} [options.friction=0]  Tangential FLOOR drag 0..1: on each floor-contact frame, bleed the HORIZONTAL velocity by `1 - friction` (the complement to `bounce`, which reflects the vertical component). `0` = frictionless (default, today's exact behaviour), `1` = full grip (horizontal stop on first contact), `0.2` = a long skid, `0.8` = a short one. Needs a `floor` -- with none the branch never fires. A contraction (|vx| never grows), so positions stay finite with no accel cap. clamp01: a NEGATIVE clamps to `0` (frictionless, NEVER anti-friction/speed-up), non-finite/undefined => `0` (off), > 1 => 1. It MOVES the position stream (a physics knob), so a friction burst earns its own committed hash. Opt-in, zero-rng; inert under reduced motion
         * @param {number} [options.wallFriction=0] Tangential drag on the box's THREE NON-floor edges 0..1 -- the tangential twin of `friction` (which covers the floor) and the tangential analog to `bounce`'s ONE shared restitution. On each contact with a non-floor edge, bleed the TANGENTIAL velocity by `1 - wallFriction`: at the CEILING it damps HORIZONTAL (vx) AFTER the vy reflection; at each WALL it damps VERTICAL (vy) AFTER the vx reflection -- always the OTHER component from what `bounce` reflects there, so it never kills the bounce. `0` = frictionless (default, today's exact box). `1` = full grip. The ceiling is included by design (bounce never fragmented the box edge-by-edge). Needs a box (`ceiling`/`wallLeft`/`wallRight`) -- with none the branches never fire. A contraction (|v| never grows), finite with no accel cap. clamp01: a NEGATIVE clamps to `0` (NEVER anti-friction), non-finite/undefined => `0` (off), > 1 => 1. It MOVES the position stream (a physics knob), so a wallFriction burst earns its own committed hash. The floor keeps its own separate `friction`. Opt-in, zero-rng; inert under reduced motion
         * @param {number} [options.trail]       Per-particle motion-trail length 0..capacity (default: full capacity). Needs a construction `trail` budget; ignored otherwise. Render overlay, fingerprint-safe
         * @param {Array}  [options.colors]      Array of OKLCH objects or CSS strings
         * @param {Array}  [options.lifeColors]  Multi-stop OKLCH life ramp (>= 2 stops, birth-color first): the body sweeps it over each particle's life (sparks cooling white->red). Baked once per burst; the trail stays the flat `colors` pick. Opt-in, zero-rng, a pure color overlay -- position fingerprints preserved
         * @param {string} [options.emit]       Spawn-origin shape: 'line' (horizontal curtain), 'ring' (firework shell, velocity radial-outward), or 'box' (square area) -- sized by `emitSize`. Default: a single point. Opt-in; off/unknown/`emitSize<=0` => point spawn, byte-identical
         * @param {number} [options.emitSize]   Emitter extent in CSS px: line half-length / ring radius / box square half-extent. Needs a shape in `emit`; <= 0 or non-finite => point spawn
         * @param {number} [options.stagger]    Staggered-emission window in ms: spread the `count` births evenly over it (piece i wakes at `stagger*i/count`), so the burst cascades in instead of appearing at once. Burst-only (spray already emits over time). Opt-in; off/<=0/non-finite => synchronous spawn, byte-identical. Zero-rng; inert under reduced motion
         * @param {number} [options.angle=-Math.PI/2] Center angle of emission cone
         * @param {Function} [options.onComplete] Called when all burst particles die
         */
        burst({
                  x, y,
                  count = 80,
                  spread = 1.2,
                  speed = 400,
                  speedVariance = 200,
                  gravity = 600,
                  wind = 0,
                  floor = Infinity,
                  bounce = 0,
                  settle = 0,
                  friction = 0,
                  wallFriction = 0,
                  wallLeft = -Infinity,
                  wallRight = Infinity,
                  ceiling = -Infinity,
                  drag = 0.98,
                  sizeMin = 5,
                  sizeMax = 12,
                  lifeMin = 1.5,
                  lifeMax = 3.0,
                  shape = 'rect',
                  shapes,
                  emoji = DEFAULT_EMOJI,
                  flutter = 1,
                  sway = 0,
                  align = 0,
                  spinRate = 1,
                  spinDrag = 1,
                  scaleTo = 1,
                  flutterRate = 1,
                  fadeIn = 0,
                  fadeOut = FADE_OUT_DEF,
                  turbulence = 0,
                  gust = 0,
                  attract = 0,
                  swirl = 0,
                  attractX,
                  attractY,
                  trail,
                  colors = DEFAULT_COLORS,
                  lifeColors,
                  emit,
                  emitSize,
                  stagger,
                  angle = -HALF_PI,
                  onComplete,
              } = {}) {
            if (destroyed) return;

            // Fail closed: coerce every numeric option to a finite, in-range value before
            // it can reach a particle. A non-finite speed/gravity would paint a NaN
            // position (hashing silently as 0); a non-finite lifeMax would make a particle
            // immortal (NaN <= 0 is false). A call-time typo must not crash or poison a
            // running animation, so we coerce to the documented default rather than throw.
            count = Math.floor(nonneg(count, 80));
            spread = num(spread, 1.2);
            speed = num(speed, 400);
            speedVariance = num(speedVariance, 200);
            gravity = num(gravity, 600);
            wind = num(wind, 0); // signed: negative wind drifts left, so num (not nonneg)
            turbulence = num(turbulence, 0); // signed accel (px/sec^2); non-finite => 0 (off)
            gust = num(gust, 0);             // signed accel (px/sec^2); non-finite => 0 (off)
            attract = num(attract, 0);       // signed spring strength; non-finite => 0 (off), <0 = repel
            swirl = num(swirl, 0);           // signed tangential strength; non-finite => 0 (off)
            floor = num(floor, Infinity);  // opt-in: undefined/NaN/Infinity/string all => no floor
            bounce = clamp01(bounce, 0);   // restitution 0..1; a rebound can never add energy
            settle = nonneg(settle, 0);    // rest-speed threshold (px/sec); NaN/negative/string => 0 (off)
            friction = clamp01(friction, 0);   // tangential floor drag 0..1; NaN/negative/string => 0 (off)
            wallFriction = clamp01(wallFriction, 0);  // tangential drag on non-floor box edges 0..1; NaN/negative/string => 0 (off)
            wallLeft = num(wallLeft, -Infinity);   // opt-in box edge; non-finite => no left wall
            wallRight = num(wallRight, Infinity);  // opt-in box edge; non-finite => no right wall
            ceiling = num(ceiling, -Infinity);     // opt-in box edge; non-finite => no ceiling
            drag = clamp01(drag, 0.98);
            sizeMin = nonneg(sizeMin, 5);
            sizeMax = nonneg(sizeMax, 12);
            lifeMin = nonneg(lifeMin, 1.5);
            lifeMax = nonneg(lifeMax, 3.0);
            angle = num(angle, -HALF_PI);
            // A null/empty colors array would throw on .map (fail open); fall back to the defaults.
            if (!Array.isArray(colors) || colors.length === 0) colors = DEFAULT_COLORS;

            const cx = num(x, cw / 2);
            const cy = num(y, ch * 0.33);
            // Unknown shape names fail closed to rect (id 0), matching pre-1.3.0 behaviour.
            let shapeId = shapeName2Id.get(shape) ?? 0;
            // Opt-in multi-shape mixing: resolve `shapes` to ids (null => single-shape path).
            let shapeIds = resolveShapeIds(shapes, shapeName2Id);
            // A single-entry mix is just that shape: collapse it onto the single-shape path
            // (zero extra rng draw), so shapes:['star'] is byte-identical to shape:'star'.
            if (shapeIds && shapeIds.length === 1) { shapeId = shapeIds[0]; shapeIds = null; }
            // Rasterize the emoji glyph now (once), so the first frame has no hitch. Prime
            // when the single shape is emoji OR the mix contains it.
            if (shapeId === 4 || (shapeIds && shapeIds.indexOf(4) !== -1)) EmojiAtlas.prime(emoji || DEFAULT_EMOJI);

            // Pre-parse OKLCH objects to CSS strings ONCE per burst.
            // This keeps the render loop 100% zero-GC -- no toCssOklch() per frame.
            const parsedColors = colors.map(c => typeof c === 'string' ? c : toCssOklch(c));
            // Bake the color-over-life ramp ONCE (or null when off) -- off the hot path, like parsedColors.
            const lifeRamp = buildLifeRamp(lifeColors);
            // Spawn emitter (v1.13.0): resolve `emit` to a small int id ONCE, so the spawn loop
            // branches on an int, not a string. Fail-closed: an unknown/non-string shape, or a
            // non-positive/non-finite `emitSize`, collapses to EMIT_OFF (point spawn, byte-identical).
            let emitId = EMIT_ID.get(emit) ?? EMIT_OFF;
            const emitR = nonneg(emitSize, 0);
            if (emitR <= 0) emitId = EMIT_OFF;
            // Staggered emission (v1.14.0): spread the `count` births evenly over `stagger` ms (ms ->
            // seconds). Fail-closed via nonneg (NaN / negative / undefined / Infinity -> 0 -> OFF); the
            // delay is stamped per-piece below and draws NO rng, so off (staggerSec 0) is byte-identical.
            const staggerSec = nonneg(stagger, 0) / 1000;

            // Reduced motion: show static confetti, no animation. `emit` and `stagger` are both inert
            // here -- the static fan is a fixed accessible layout with no rng origin or per-piece
            // animation (like every motion feature).
            if (respectReducedMotion && _prefersReducedMotion) {
                renderStaticBurst(cx, cy, count, parsedColors, shapeId, sizeMin, sizeMax, spread, emoji, shapeIds);
                if (onComplete) setTimeout(onComplete, 1500);
                return;
            }

            const colorPick = () => rng.pick(parsedColors);
            // Vortex center: defaults to the burst origin (cx, cy), so a bare `attract`/`swirl`
            // spins around where the burst was fired; an explicit attractX/attractY overrides
            // (non-finite falls back to the origin via num()).
            const vortX = num(attractX, cx);
            const vortY = num(attractY, cy);
            // Per-particle trail DRAW length (not capacity -- the buffer was sized at construction).
            // `undefined` (option omitted) inherits full capacity, so a trail-capable instance
            // trails by default; an explicit value clamps into [0, trailCap] (0 opts this burst out,
            // over-large is capped). Fail-closed: non-finite coerces to full via nonneg's default.
            // Always 0 on a trail-less instance -- there is no buffer to write.
            const trailDraw = trailCap === 0
                ? 0
                : (trail === undefined ? trailCap : Math.min(trailCap, Math.floor(nonneg(trail, trailCap))));
            const config = {
                sizeMin, sizeMax, lifeMin, lifeMax, gravity, wind, floor, bounce, wallLeft, wallRight, ceiling, drag, shapeId, shapeIds, emoji, colorPick,
                flutter: clamp01(flutter, 1), sway: clamp01(sway, 0), align: clamp01(align, 0), spinRate: num(spinRate, 1), spinDrag: clamp01(spinDrag, 1), scaleTo: nonneg(scaleTo, 1), flutterRate: num(flutterRate, 1), fadeIn: clamp01(fadeIn, 0), fadeOut: clamp01(fadeOut, FADE_OUT_DEF), turbulence, gust, trailLen: trailDraw,
                attract, swirl, attractX: vortX, attractY: vortY, settle, friction, wallFriction, lifeRamp,
            };

            for (let i = 0; i < count; i++) {
                const a = angle + (rng.next() - 0.5) * spread;
                const s = speed + (rng.next() - 0.5) * speedVariance * 2;
                // Emitter branch: EMIT_OFF (default) inserts no rng draw and spawns at the point,
                // byte-identical to a point burst. line/box offset the origin; ring places the piece
                // on the circle AND fires it radially outward (reusing the spread jitter `a - angle`).
                let slot;
                if (emitId === EMIT_OFF) {
                    slot = spawn(cx, cy, Math.cos(a) * s, Math.sin(a) * s, config);
                } else if (emitId === EMIT_LINE) {
                    const ex = cx + (rng.next() * 2 - 1) * emitR;
                    slot = spawn(ex, cy, Math.cos(a) * s, Math.sin(a) * s, config);
                } else if (emitId === EMIT_RING) {
                    const th = rng.next() * TAU;
                    const j = a - angle; // reuse the already-drawn spread jitter, no new draw
                    slot = spawn(cx + Math.cos(th) * emitR, cy + Math.sin(th) * emitR,
                          Math.cos(th + j) * s, Math.sin(th + j) * s, config);
                } else { // EMIT_BOX
                    const ex = cx + (rng.next() * 2 - 1) * emitR;
                    const ey = cy + (rng.next() * 2 - 1) * emitR;
                    slot = spawn(ex, ey, Math.cos(a) * s, Math.sin(a) * s, config);
                }
                // Staggered birth: piece i wakes at `staggerSec * i / count` s (linear, even, NO rng),
                // so the whole burst cascades over the window. Guarded so the default (staggerSec 0)
                // never writes -- the delay column stays 0 and the burst spawns synchronously,
                // byte-identical to every prior release.
                if (staggerSec > 0) pool.delay[slot] = staggerSec * i / count;
            }

            if (onComplete) {
                const checkDone = () => {
                    if (aliveCount === 0) onComplete();
                    else setTimeout(checkDone, 100);
                };
                setTimeout(checkDone, (lifeMin * 1000) | 0);
            }

            ensureRunning();
        },

        /**
         * Continuous confetti spray over a duration.
         *
         * @param {Object} [options]    Same as burst, plus:
         * @param {number} [options.duration=1000]  Spray duration in ms
         * @param {number} [options.rate=5]         Particles per frame
         * @param {number} [options.wind=0]         Lateral acceleration px/sec^2 (negative = leftward)
         * @param {number} [options.floor=Infinity] Settle-boundary Y in CSS px (default none). Opt-in
         * @param {number} [options.bounce=0]       Restitution 0..1 on any boundary contact (0 rests, 1 elastic); shared by floor and walls
         * @param {number} [options.wallLeft=-Infinity]  Left wall X in CSS px (default none). Opt-in
         * @param {number} [options.wallRight=Infinity]  Right wall X in CSS px (default none). Opt-in
         * @param {number} [options.ceiling=-Infinity]   Ceiling Y in CSS px (default none). Opt-in
         * @param {number} [options.flutter=1]      Tumble depth 0..1
         * @param {number} [options.sway=0]         Horizontal drift 0..1
         * @param {number} [options.align=0]        Velocity-align blend 0..1: rotate each piece broadside to its live velocity (0 = random spin, 1 = locked). A pure orientation overlay -- the seeded position stream is byte-identical off or on. Zero-rng
         * @param {number} [options.spinRate=1]     Tumble-speed multiplier on the seeded random spin (0 = rigid at the random birth tilt, 0.3 = slow drift, 2 = double, negative = reverse). A pure render scale -- the seeded position stream is byte-identical off or on, even with `turbulence` armed. Zero-rng; non-finite => 1
         * @param {number} [options.spinDrag=1]     Angular-velocity retention in [0,1] -- the angular mirror of the linear `drag`. Each frame, before the spin advance, `spinV *= spinDrag`, so the tumble decays as `drag` decays translation. `1` = off (default), `0.95` = settle to a lazy drift, `0` = FREEZE at the birth angle. clamp01: a NEGATIVE clamps to `0` (freeze -- a retention has no direction), non-finite => `1` (off), > 1 => 1. A contraction (|spinV| never grows), finite with no accel cap. Damps `spinV` only, never `tiltV`. HYBRID physics knob: turbulence OFF moves only the render rotation (position byte-identical); turbulence ON the curl reads the slower spin and MOVES positions -- NOT a pure render overlay. Zero-rng
         * @param {number} [options.scaleTo=1]      Size-over-life target: lerp each piece's rendered size from 1.0 at birth to `scaleTo` at death (isotropic). `0.2` shrinks out, `2` grows, `0` vanishes; `1` = constant size. A pure render overlay -- pool.w/h untouched, so the seeded position stream is byte-identical off or on. nonneg: a NEGATIVE clamps to 0 (not a flip, not a fallback to 1); non-finite => 1. The trail keeps its birth width. Zero-rng
         * @param {number} [options.flutterRate=1]  Tumble-wobble SPEED multiplier on the seeded flutter (0 = frozen at the random birth tilt, 0.3 = slow lazy flutter, 2 = fast shimmer, negative = reversed; 1 = as seeded). A pure render phase scale about a birth pivot -- the seeded position stream is byte-identical off or on, even with `turbulence` armed. Inert when `flutter` is 0. Zero-rng; non-finite => 1
         * @param {number} [options.fadeIn=0]       Birth-opacity ramp: fade each piece up from transparent over the FIRST `fadeIn` fraction of its life (`0.4` eases in over the first 40%). The mirror of the hardcoded death fade-out, multiplying the same alpha; `1` ramps across the whole life; default `0` = instant-on. A pure render overlay on ctx.globalAlpha -- pool.x/y/v untouched, so the seeded position stream is byte-identical off or on. The trail materializes in with the body. clamp01: non-finite/negative => 0 (off), > 1 => 1. Zero-rng
         * @param {number} [options.fadeOut=0.3]    Death-fade window: the fraction of life over which each piece dissolves OUT at the END. `0.6` fades over the last 60%, `0.1` a quick blink-out, `1` across the whole life; default `0.3` = today's look. The mirror of `fadeIn`, multiplying the same alpha to compose the full opacity envelope. A pure render overlay on ctx.globalAlpha (reads only lifeT) -- pool.x/y/v untouched, so the seeded position stream is byte-identical off or on; the trail dissolves out with the body. clamp01: non-finite/undefined => `0.3`; NEGATIVE clamps to `0` = hard cut (NOT a fallback to the default); > 1 => 1. Zero-rng
         * @param {number} [options.turbulence=0]   Per-particle rotating accel px/sec^2 (organic wander). Opt-in, zero-rng
         * @param {number} [options.gust=0]         Global oscillating horizontal accel px/sec^2 layered on wind. Opt-in, zero-rng
         * @param {number} [options.attract=0]      Vortex radial spring strength (1/sec^2): + pulls toward the center, - repels. Opt-in, zero-rng
         * @param {number} [options.swirl=0]        Vortex tangential strength (1/sec^2): spins around the center; sign = direction. Opt-in, zero-rng
         * @param {number} [options.attractX]       Vortex center X (CSS px); default: the spray origin x
         * @param {number} [options.attractY]       Vortex center Y (CSS px); default: the spray origin y
         * @param {number} [options.settle=0]       Rest-speed threshold px/sec: a piece whose post-bounce |vy| drops below it freezes on the `floor` and piles (keeps aging + fades). Needs a `floor`. Opt-in, zero-rng
         * @param {number} [options.friction=0]     Tangential FLOOR drag 0..1: on each floor-contact frame, bleed the HORIZONTAL velocity by `1 - friction` (the complement to `bounce`). `0` = frictionless (default), `1` = full grip (horizontal stop on contact), `0.2` = a long skid. Needs a `floor`. A contraction (|vx| never grows), finite with no accel cap. clamp01: a NEGATIVE clamps to `0` (NEVER anti-friction), non-finite => `0` (off), > 1 => 1. It MOVES the position stream. Opt-in, zero-rng
         * @param {number} [options.wallFriction=0] Tangential drag on the box's THREE NON-floor edges 0..1 -- the tangential twin of `friction` (floor) and the tangential analog to `bounce`'s ONE shared restitution. On each non-floor edge contact, bleed the TANGENTIAL velocity by `1 - wallFriction`: the CEILING damps HORIZONTAL (vx), each WALL damps VERTICAL (vy) -- the OTHER component from what `bounce` reflects there. `0` = frictionless (default), `1` = full grip. Needs a box. A contraction (|v| never grows), finite with no accel cap. clamp01: a NEGATIVE clamps to `0` (NEVER anti-friction), non-finite => `0` (off), > 1 => 1. It MOVES the position stream. The floor keeps its own `friction`. Opt-in, zero-rng
         * @param {number} [options.trail]          Per-particle motion-trail length 0..capacity (default: full). Needs a construction `trail` budget; render overlay, fingerprint-safe
         * @param {Array}  [options.lifeColors]     Multi-stop OKLCH life ramp (>= 2 stops, birth-color first): the body sweeps it over each particle's life. Baked once; trail stays the flat `colors` pick. Opt-in, zero-rng, a pure color overlay
         * @param {string} [options.emit]          Spawn-origin shape: 'line' / 'ring' (radial-outward shell) / 'box', sized by `emitSize`. Default: a single point. Opt-in; off/unknown/`emitSize<=0` => point spawn, byte-identical
         * @param {number} [options.emitSize]      Emitter extent in CSS px: line half-length / ring radius / box square half-extent. Needs a shape in `emit`; <= 0 or non-finite => point spawn
         */
        spray({
                  duration = 1000,
                  rate = 5,
                  x, y,
                  spread = 0.8,
                  speed = 300,
                  speedVariance = 150,
                  gravity = 500,
                  wind = 0,
                  floor = Infinity,
                  bounce = 0,
                  settle = 0,
                  friction = 0,
                  wallFriction = 0,
                  wallLeft = -Infinity,
                  wallRight = Infinity,
                  ceiling = -Infinity,
                  drag = 0.98,
                  sizeMin = 4,
                  sizeMax = 10,
                  lifeMin = 1.2,
                  lifeMax = 2.5,
                  shape = 'rect',
                  shapes,
                  emoji = DEFAULT_EMOJI,
                  flutter = 1,
                  sway = 0,
                  align = 0,
                  spinRate = 1,
                  spinDrag = 1,
                  scaleTo = 1,
                  flutterRate = 1,
                  fadeIn = 0,
                  fadeOut = FADE_OUT_DEF,
                  turbulence = 0,
                  gust = 0,
                  attract = 0,
                  swirl = 0,
                  attractX,
                  attractY,
                  trail,
                  colors = DEFAULT_COLORS,
                  lifeColors,
                  emit,
                  emitSize,
                  angle = -HALF_PI,
                  followPointer = false,
              } = {}) {
            if (destroyed) return;

            // Fail closed (see burst): coerce every numeric option to a finite, in-range
            // value before use. x/y coerce to undefined (not a baked centre) so the
            // dynamic `?? cw/2` fallback still re-centres if the canvas resizes mid-spray.
            duration = nonneg(duration, 1000);
            rate = Math.floor(nonneg(rate, 5));
            spread = num(spread, 0.8);
            speed = num(speed, 300);
            speedVariance = num(speedVariance, 150);
            gravity = num(gravity, 500);
            wind = num(wind, 0); // signed: negative wind drifts left, so num (not nonneg)
            turbulence = num(turbulence, 0); // signed accel (px/sec^2); non-finite => 0 (off)
            gust = num(gust, 0);             // signed accel (px/sec^2); non-finite => 0 (off)
            attract = num(attract, 0);       // signed spring strength; non-finite => 0 (off), <0 = repel
            swirl = num(swirl, 0);           // signed tangential strength; non-finite => 0 (off)
            floor = num(floor, Infinity);  // opt-in: undefined/NaN/Infinity/string all => no floor
            bounce = clamp01(bounce, 0);   // restitution 0..1; a rebound can never add energy
            settle = nonneg(settle, 0);    // rest-speed threshold (px/sec); NaN/negative/string => 0 (off)
            friction = clamp01(friction, 0);   // tangential floor drag 0..1; NaN/negative/string => 0 (off)
            wallFriction = clamp01(wallFriction, 0);  // tangential drag on non-floor box edges 0..1; NaN/negative/string => 0 (off)
            wallLeft = num(wallLeft, -Infinity);   // opt-in box edge; non-finite => no left wall
            wallRight = num(wallRight, Infinity);  // opt-in box edge; non-finite => no right wall
            ceiling = num(ceiling, -Infinity);     // opt-in box edge; non-finite => no ceiling
            drag = clamp01(drag, 0.98);
            sizeMin = nonneg(sizeMin, 4);
            sizeMax = nonneg(sizeMax, 10);
            lifeMin = nonneg(lifeMin, 1.2);
            lifeMax = nonneg(lifeMax, 2.5);
            angle = num(angle, -HALF_PI);
            if (!Number.isFinite(x)) x = undefined;
            if (!Number.isFinite(y)) y = undefined;
            if (!Array.isArray(colors) || colors.length === 0) colors = DEFAULT_COLORS;

            const cx = x ?? cw / 2;
            const cy = y ?? ch * 0.33;
            // Unknown shape names fail closed to rect (id 0), matching pre-1.3.0 behaviour.
            let shapeId = shapeName2Id.get(shape) ?? 0;
            // Opt-in multi-shape mixing: resolve `shapes` to ids (null => single-shape path).
            let shapeIds = resolveShapeIds(shapes, shapeName2Id);
            // A single-entry mix is just that shape: collapse it onto the single-shape path
            // (zero extra rng draw), so shapes:['star'] is byte-identical to shape:'star'.
            if (shapeIds && shapeIds.length === 1) { shapeId = shapeIds[0]; shapeIds = null; }
            // Rasterize the emoji glyph now (once), so the first frame has no hitch. Prime
            // when the single shape is emoji OR the mix contains it.
            if (shapeId === 4 || (shapeIds && shapeIds.indexOf(4) !== -1)) EmojiAtlas.prime(emoji || DEFAULT_EMOJI);

            // Pre-parse OKLCH objects to CSS strings ONCE per spray.
            const parsedColors = colors.map(c => typeof c === 'string' ? c : toCssOklch(c));
            // Bake the color-over-life ramp ONCE (or null when off) -- off the hot path, like parsedColors.
            const lifeRamp = buildLifeRamp(lifeColors);
            // Spawn emitter (v1.13.0): resolve `emit` once (see burst). Fail-closed to EMIT_OFF on an
            // unknown/non-string shape or a non-positive/non-finite size; inert under reduced motion.
            let emitId = EMIT_ID.get(emit) ?? EMIT_OFF;
            const emitR = nonneg(emitSize, 0);
            if (emitR <= 0) emitId = EMIT_OFF;

            if (respectReducedMotion && _prefersReducedMotion) {
                renderStaticBurst(cx, cy, 30, parsedColors, shapeId, sizeMin, sizeMax, spread, emoji, shapeIds);
                return;
            }

            const colorPick = () => rng.pick(parsedColors);
            // Vortex center: defaults to the burst origin (cx, cy), so a bare `attract`/`swirl`
            // spins around where the burst was fired; an explicit attractX/attractY overrides
            // (non-finite falls back to the origin via num()).
            const vortX = num(attractX, cx);
            const vortY = num(attractY, cy);
            // Per-particle trail DRAW length (not capacity -- the buffer was sized at construction).
            // `undefined` (option omitted) inherits full capacity, so a trail-capable instance
            // trails by default; an explicit value clamps into [0, trailCap] (0 opts this burst out,
            // over-large is capped). Fail-closed: non-finite coerces to full via nonneg's default.
            // Always 0 on a trail-less instance -- there is no buffer to write.
            const trailDraw = trailCap === 0
                ? 0
                : (trail === undefined ? trailCap : Math.min(trailCap, Math.floor(nonneg(trail, trailCap))));
            const config = {
                sizeMin, sizeMax, lifeMin, lifeMax, gravity, wind, floor, bounce, wallLeft, wallRight, ceiling, drag, shapeId, shapeIds, emoji, colorPick,
                flutter: clamp01(flutter, 1), sway: clamp01(sway, 0), align: clamp01(align, 0), spinRate: num(spinRate, 1), spinDrag: clamp01(spinDrag, 1), scaleTo: nonneg(scaleTo, 1), flutterRate: num(flutterRate, 1), fadeIn: clamp01(fadeIn, 0), fadeOut: clamp01(fadeOut, FADE_OUT_DEF), turbulence, gust, trailLen: trailDraw,
                attract, swirl, attractX: vortX, attractY: vortY, settle, friction, wallFriction, lifeRamp,
            };

            // Pointer-follow is opt-in and, by nature, NON-DETERMINISTIC: it injects
            // live pointer positions the seed knows nothing about. It never consumes an
            // rng draw, so seeded replays of a non-following spray are unaffected -- but
            // a spray that follows the pointer will not reproduce from a seed. That is the
            // one documented exception to the determinism guarantee.
            const useFollow = !!followPointer;
            if (useFollow) _bindPointer();

            let elapsed = 0;
            let followStopped = false;
            const sprayFn = (dt) => {
                elapsed += dt;
                if (elapsed >= duration) {
                    if (useFollow && !followStopped) { followStopped = true; _unbindPointer(); }
                    return; // spray fn stays registered, ticker cleans up when all dead
                }
                let sx = x ?? cw / 2;
                let sy = y ?? ch * 0.33;
                if (useFollow && _ptrSeen) { sx = _ptrX; sy = _ptrY; }
                for (let i = 0; i < rate; i++) {
                    const a = angle + (rng.next() - 0.5) * spread;
                    const s = speed + (rng.next() - 0.5) * speedVariance * 2;
                    // Emitter branch (see burst): EMIT_OFF spawns at the point, byte-identical.
                    if (emitId === EMIT_OFF) {
                        spawn(sx, sy, Math.cos(a) * s, Math.sin(a) * s, config);
                    } else if (emitId === EMIT_LINE) {
                        const ex = sx + (rng.next() * 2 - 1) * emitR;
                        spawn(ex, sy, Math.cos(a) * s, Math.sin(a) * s, config);
                    } else if (emitId === EMIT_RING) {
                        const th = rng.next() * TAU;
                        const j = a - angle; // reuse the spread jitter, no new draw
                        spawn(sx + Math.cos(th) * emitR, sy + Math.sin(th) * emitR,
                              Math.cos(th + j) * s, Math.sin(th + j) * s, config);
                    } else { // EMIT_BOX
                        const ex = sx + (rng.next() * 2 - 1) * emitR;
                        const ey = sy + (rng.next() * 2 - 1) * emitR;
                        spawn(ex, ey, Math.cos(a) * s, Math.sin(a) * s, config);
                    }
                }
            };

            // Piggyback on the render loop -- spray spawns, render draws
            const origUpdate = update;
            const wrappedUpdate = (dt) => {
                sprayFn(dt);
                origUpdate(dt);
            };

            if (removeFn) removeFn();
            removeFn = ticker.add(wrappedUpdate);
        },

        /** Kill all particles immediately. */
        clear() {
            pool.life.fill(0);
            aliveCount = 0;
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        },

        /** Number of alive particles. */
        get count() { return aliveCount; },

        /** Re-seed the RNG for deterministic replay. */
        seed(s) { rng.reset(s); },

        /**
         * Register a custom particle shape for this instance, usable as
         * `burst({ shape: name })`. Per-instance: the shape is invisible to other
         * instances and dies with this one on destroy().
         *
         * @param {string} name  Shape name. Must not be a built-in
         *   ('rect'|'circle'|'star'|'triangle'|'emoji'); re-registering a custom name
         *   replaces it and keeps its id.
         * @param {Function|Object} def  Either a draw function `(ctx, w, h) => void`
         *   (a VECTOR shape -- the engine sets fillStyle to the particle colour before
         *   calling, so a plain fill() paints correctly), or `{ image }` (an <img> /
         *   canvas / ImageBitmap prerendered to a sprite and blitted), or
         *   `{ draw, blit }` for an advanced self-painting shape.
         * @returns {number} the assigned shape id (>= 5), or -1 after destroy().
         */
        registerShape(name, def) {
            if (destroyed) return -1;
            if (typeof name !== 'string' || name === '') {
                throw new Error('@zakkster/lite-confetti: registerShape(name) requires a non-empty string name');
            }
            const existing = shapeName2Id.get(name);
            if (existing !== undefined && existing < 5) {
                throw new Error('@zakkster/lite-confetti: cannot override built-in shape "' + name + '"');
            }

            let draw, blit;
            if (typeof def === 'function') {
                draw = def;
                blit = false;
            } else if (def && typeof def === 'object' && def.image) {
                const sprite = SpriteAtlas.get(def.image);
                if (!sprite) {
                    throw new Error('@zakkster/lite-confetti: registerShape("' + name + '") image could not be rasterized');
                }
                draw = (dctx, w) => { dctx.drawImage(sprite, -w / 2, -w / 2, w, w); };
                blit = true;
            } else if (def && typeof def === 'object' && typeof def.draw === 'function') {
                draw = def.draw;
                blit = def.blit !== false; // self-painting by default; opt into fill with blit:false
            } else {
                throw new Error('@zakkster/lite-confetti: registerShape(name, def) def must be a draw function, { image }, or { draw, blit }');
            }

            const id = existing === undefined ? nextShapeId++ : existing;
            shapeDraw[id] = draw;
            shapeBlit[id] = blit;
            shapeName2Id.set(name, id);
            return id;
        },

        /** Destroy everything. Idempotent. */
        destroy() {
            if (destroyed) return;
            destroyed = true;
            if (removeFn) { removeFn(); removeFn = null; }
            if (_ro) { _ro.disconnect(); _ro = null; }
            // Force the pointer listener off regardless of outstanding spray refs.
            _ptrRefs = 0;
            if (_ptrBound) { window.removeEventListener('pointermove', _onPointerMove); _ptrBound = false; }
            releaseTicker();
            pool.life.fill(0);
            aliveCount = 0; // keep the count getter honest: a destroyed pool has 0 alive
        },
    };

    // Non-enumerable, undocumented, test-only conservation probe (decision 0004): lets the
    // torture gate assert the count getter matches the actual live-slot count and that a
    // destroyed pool truly holds zero. Non-enumerable so it never widens the public shape
    // (Object.keys(api) is unchanged) and Confetti.d.ts stays a no-change patch.
    Object.defineProperty(api, '__stats', {
        enumerable: false,
        value() {
            let live = 0;
            for (let i = 0; i < pool.life.length; i++) if (pool.life[i] > 0) live++;
            return { cap: pool.life.length, aliveGetter: aliveCount, aliveActual: live };
        },
    });

    return api;
}


// ---------------------------------------------------------
//  v1.2.0 HELPERS
// ---------------------------------------------------------

/**
 * Normalize a lite-hueforge `toGradientStops()` result (or a plain palette)
 * into a colors array ready for the `colors` option of burst() / spray().
 *
 * Accepts:
 *   - gradient stops: [{ color: {l,c,h}, stop: 0 }, ...]  -> the colors
 *   - { stops: [...] }                                    -> its stops' colors
 *   - a plain colors array (OKLCH objects or CSS strings) -> passed through
 *   - a single OKLCH object or CSS string                 -> wrapped in an array
 *
 * Returns DEFAULT_COLORS for empty/invalid input, and never an empty array --
 * an empty `colors` would make rng.pick() return undefined and paint nothing.
 */
export function colorsFromPalette(paletteInput) {
    const isColor = (c) =>
        typeof c === 'string' ||
        (c && typeof c === 'object'
            && typeof c.l === 'number' && typeof c.c === 'number' && typeof c.h === 'number');

    const nonEmpty = (arr) => (arr.length > 0 ? arr : DEFAULT_COLORS);

    if (!paletteInput) return DEFAULT_COLORS;

    if (Array.isArray(paletteInput)) {
        // Gradient stops -> pull .color; otherwise treat as a colors array.
        const looksLikeStops = paletteInput.length > 0
            && paletteInput[0] && typeof paletteInput[0] === 'object' && 'color' in paletteInput[0];
        const src = looksLikeStops ? paletteInput.map((s) => s.color) : paletteInput;
        return nonEmpty(src.filter(isColor));
    }

    if (typeof paletteInput === 'object') {
        if (Array.isArray(paletteInput.stops)) {
            return nonEmpty(paletteInput.stops.map((s) => (s && s.color !== undefined ? s.color : s)).filter(isColor));
        }
        if (isColor(paletteInput)) return [paletteInput];
    }

    return DEFAULT_COLORS;
}


/**
 * Burst-origin sugar: `{ x, y, ...extra }` from `el.getBoundingClientRect()`,
 * measured once at call time (never inside a loop).
 *
 * IMPORTANT -- coordinate space. The returned x/y are in VIEWPORT coordinates
 * (the element's centre on screen). They line up with a confetti canvas only
 * when that canvas is a full-viewport overlay pinned at (0,0) -- the standard
 * `confetti()` overlay, and the fixed full-screen canvas most apps use. For an
 * INLINE or offset canvas, subtract the canvas's own rect first:
 *
 *   const o = fromElement(button);
 *   const cr = canvas.getBoundingClientRect();
 *   c.burst({ x: o.x - cr.left, y: o.y - cr.top, count: 60 });
 *
 * `extra` is spread last, so an explicit x/y in `extra` overrides the computed one.
 *
 * @param {HTMLElement} el
 * @param {Object} [extra]  merged into the result (count, colors, a preset spread, ...)
 */
export function fromElement(el, extra = {}) {
    if (!el || typeof el.getBoundingClientRect !== 'function') {
        console.warn('@zakkster/lite-confetti: fromElement(el) requires a DOM element with getBoundingClientRect');
        return { ...extra };
    }
    const rect = el.getBoundingClientRect();
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        ...extra,
    };
}


// ---------------------------------------------------------
//  CONVENIENCE: One-Shot Global Confetti
//  Creates a temporary full-screen overlay, fires, cleans up.
// ---------------------------------------------------------

/**
 * Fire-and-forget confetti. Creates a temporary canvas overlay,
 * fires a burst, and cleans up automatically.
 *
 * @param {Object} [options]  Same as burst options
 */
export function confetti(options = {}) {

    const existing = /** @type {HTMLCanvasElement} */ document.getElementById('__lite-confetti-overlay');
    if (existing) {
        const c = createConfetti(existing, { seed: options.seed });
        c.burst(options);
        return c;
    }

    const overlay = document.createElement('canvas');
    overlay.id = '__lite-confetti-overlay';
    Object.assign(overlay.style, {
        position: 'fixed', top: '0', left: '0',
        width: '100%', height: '100%',
        pointerEvents: 'none', zIndex: '99999',
    });
    document.body.appendChild(overlay);

    const c = createConfetti(overlay, { seed: options.seed });

    c.burst({
        ...options,
        onComplete: () => {
            c.destroy();
            overlay.remove();
            if (options.onComplete) options.onComplete();
        },
    });

    return c;
}


export default confetti;