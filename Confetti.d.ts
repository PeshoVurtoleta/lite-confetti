import type { OklchColor } from '@zakkster/lite-color';

/** A built-in shape name, or any custom name registered via registerShape(). */
export type ShapeName = 'rect' | 'circle' | 'star' | 'triangle' | 'emoji' | (string & {});

/** Draw a single particle centred at (0,0); the canvas is pre-translated/rotated/scaled. */
export type ShapeDrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number, i: number) => void;

/**
 * A custom shape definition for registerShape():
 *  - a draw function -> a VECTOR shape (the engine sets fillStyle to the particle
 *    colour before calling, so a plain fill() paints correctly);
 *  - `{ image }` -> an image source prerendered to a sprite and blitted per particle;
 *  - `{ draw, blit }` -> an advanced self-painting shape (blit defaults to true).
 */
export type ShapeDef =
    | ShapeDrawFn
    | { image: CanvasImageSource }
    | { draw: ShapeDrawFn; blit?: boolean };

export interface BurstOptions {
    x?: number; y?: number; count?: number; spread?: number;
    speed?: number; speedVariance?: number; gravity?: number; drag?: number;
    /**
     * Lateral wind acceleration in px/sec^2 -- the X-axis mirror of `gravity`, so
     * `gravity` (down) + `wind` (across) form a 2D force vector. Default 0; positive
     * drifts right, negative left. Opt-in and fingerprint-safe (default leaves seeded
     * positions byte-identical); no effect under reduced motion.
     */
    wind?: number;
    /**
     * Settle-boundary Y coordinate in CSS px. A particle that reaches it is clamped onto
     * the line and its vertical velocity is reflected (scaled by `bounce`), so confetti
     * lands instead of falling forever. Default `Infinity` (no floor). Opt-in and
     * fingerprint-safe (the default never fires the collision branch, so seeded positions
     * stay byte-identical); draws no rng; no effect under reduced motion.
     */
    floor?: number;
    /**
     * Restitution 0..1 applied on ANY boundary contact -- shared by `floor` and the
     * `wallLeft`/`wallRight`/`ceiling` box edges: 0 rests (settle / pile-up), 1 is
     * perfectly elastic. Values outside 0..1 clamp; a rebound can never add energy, and
     * drag still damps each frame, so motion always settles. Only meaningful when at least
     * one boundary is finite. Default 0.
     */
    bounce?: number;
    /**
     * Rest-speed threshold in CSS px/sec for settle-and-pile (v1.11.0). A piece bounces on
     * the `floor` (losing energy to `bounce` < 1 and `drag`) until its post-bounce vertical
     * speed drops below this threshold, then it FREEZES in place and piles up instead of
     * bouncing forever. A settled piece keeps aging and fades where it rests, so the pool
     * still recycles (the pile is a transient drift, not a leak). Needs a finite `floor`; with
     * no floor nothing ever settles. Default 0 (off). Opt-in, zero-rng, fingerprint-safe.
     */
    settle?: number;
    /**
     * Tangential FLOOR drag 0..1 (v1.21.0) -- the complement to `bounce`. On each
     * floor-contact frame, the HORIZONTAL velocity is multiplied by `1 - friction`, where
     * `bounce` reflects the vertical (normal) component and `friction` damps the horizontal
     * (tangent) one, so they compose on a single contact. `0` = frictionless (default,
     * byte-identical to prior releases), `1` = full grip (horizontal stop on first contact),
     * `0.2` = a long skid, `0.8` = a short one. Needs a finite `floor`; with no floor the
     * branch never fires. A contraction (|vx| never grows), so positions stay finite with no
     * accel cap. A NEGATIVE clamps to `0` (frictionless, NEVER an anti-friction speed-up);
     * non-finite/undefined => `0` (off), > 1 => 1. A physics knob: it MOVES the position
     * stream (its own committed hash). Opt-in, zero-rng; no effect under reduced motion.
     */
    friction?: number;
    /**
     * Tangential drag 0..1 on the box's THREE NON-floor edges (v1.22.0) -- the tangential
     * twin of `friction` (which covers the floor) and the tangential analog to `bounce`'s
     * ONE shared restitution. On each contact with a non-floor edge, the TANGENTIAL velocity
     * is multiplied by `1 - wallFriction`: at the CEILING it damps HORIZONTAL (vx) after the
     * vy reflection; at each WALL it damps VERTICAL (vy) after the vx reflection -- always the
     * OTHER component from what `bounce` reflects there, so it never kills the bounce. `0` =
     * frictionless (default, byte-identical to prior releases), `1` = full grip. The ceiling
     * is included by design (bounce never fragmented the box edge-by-edge). Needs a box
     * (`ceiling`/`wallLeft`/`wallRight`); with none the branches never fire. A contraction
     * (|v| never grows), so positions stay finite with no accel cap. A NEGATIVE clamps to `0`
     * (NEVER an anti-friction speed-up); non-finite/undefined => `0` (off), > 1 => 1. A
     * physics knob: it MOVES the position stream (its own committed hash). The floor keeps its
     * own separate `friction`. Opt-in, zero-rng; no effect under reduced motion.
     */
    wallFriction?: number;
    /**
     * Left wall X coordinate in CSS px -- the X-min edge of the bounding box. A particle
     * reaching it is clamped and its horizontal velocity reflected (scaled by `bounce`).
     * Default `-Infinity` (no wall). Opt-in and fingerprint-safe (the default never fires
     * the collision branch); draws no rng; no effect under reduced motion.
     */
    wallLeft?: number;
    /**
     * Right wall X coordinate in CSS px -- the X-max edge of the bounding box (see
     * `wallLeft`). Default `Infinity` (no wall).
     */
    wallRight?: number;
    /**
     * Ceiling Y coordinate in CSS px -- the Y-min edge of the bounding box and the mirror
     * of `floor`. A particle rising past it is clamped and its vertical velocity reflected
     * (scaled by `bounce`). Default `-Infinity` (no ceiling). Opt-in and fingerprint-safe.
     */
    ceiling?: number;
    sizeMin?: number; sizeMax?: number; lifeMin?: number; lifeMax?: number;
    shape?: ShapeName;
    /**
     * Mix multiple shapes in one burst/spray, chosen per-particle (repetition in the
     * array weights the mix, e.g. ['star','star','circle'] is ~2:1). Overrides `shape`;
     * unknown names are dropped, and an empty/all-unknown array falls back to `shape`.
     */
    shapes?: ShapeName[];
    emoji?: string; colors?: Array<OklchColor | string>;
    /**
     * Color-over-life ramp (v1.12.0). An ordered list of >= 2 OKLCH stops (birth-color first,
     * death-color last) that the BODY of each piece sweeps as it ages -- sparks cooling
     * white -> orange -> red, embers dimming. Baked once per burst into a small LUT of CSS
     * strings and indexed by the piece's life fraction; the hot path is a pure array read.
     * The palette `colors` is still picked per particle and stays the flat trail color (and the
     * body color when this is off). Invalid / fewer than two stops falls back to that flat color.
     * Default off. Opt-in, zero-RNG, a pure color overlay -- every position fingerprint is
     * preserved; no effect under reduced motion.
     */
    lifeColors?: Array<OklchColor | string>;
    /** Tumble depth 0..1 (0 rigid, 1 full wobble). Default 1. Affects scale, not position. */
    flutter?: number;
    /** Horizontal drift 0..1 (0 straight fall). Default 0. */
    sway?: number;
    /**
     * Velocity-aligned orientation, a 0..1 blend. `0` (default) is pure random tumble; `1` rotates
     * each piece BROADSIDE to its LIVE velocity (`atan2(vy, vx) + PI/2`), so its flat face meets the
     * airflow like a falling leaf, re-banking every frame as forces bend the path; partial values
     * blend the two along the shortest arc. Coerced to `[0, 1]` (non-finite/negative -> 0, `> 1` -> 1).
     * A pure ORIENTATION overlay: it changes only rotation, never position, so the seeded position
     * fingerprint is byte-identical whether off or on. Honored by both `burst()` and `spray()`.
     * Draws no RNG; no effect under reduced motion. (v1.15.0)
     */
    align?: number;
    /**
     * Tumble-speed multiplier on the seeded random spin. `1` (default) is the seeded rate as-is;
     * `0` is RIGID -- frozen at each piece's RANDOM birth tilt (varied, not axis-aligned); `0.3` is a
     * slow lazy drift; `2` doubles the tumble; a negative value REVERSES it. A render-time ANGLE SCALE:
     * it scales only the accumulated tumble about the birth orientation and never touches the physics
     * spin, so it is fully decoupled from `turbulence` and the seeded POSITION fingerprint is
     * byte-identical whether off, on, or on-with-turbulence -- a pure orientation overlay. Composes with
     * `align` (the tumble scale runs first, then `align` blends toward the velocity heading). Coerced
     * with `num` -- any FINITE value passes (0 and negatives are valid); non-finite/non-numeric -> 1.
     * Honored by both `burst()` and `spray()`. Draws no RNG; no effect under reduced motion. (v1.16.0)
     */
    spinRate?: number;
    /**
     * Angular-velocity retention in [0,1] (v1.23.0) -- the angular mirror of the linear `drag`. Each frame,
     * before the spin advance, `spinV` is multiplied by `spinDrag`, so the tumble decays exactly as `drag`
     * decays translation. `1` (default) is OFF -- tumble forever, byte-identical to prior releases; `0.95`
     * settles to a lazy drift; `0` FREEZES the piece at its birth angle. A contraction (|spinV| never grows),
     * so it is finite for any input with no accel cap; it damps `spinV` ONLY, never `tiltV`. Coerced with
     * clamp01: a NEGATIVE clamps to `0` (freeze -- a retention has no direction, unlike `spinRate`'s reverse),
     * non-finite/undefined => `1` (off), > 1 => 1. A HYBRID physics knob: with `turbulence` OFF it moves ONLY
     * the render rotation (the position fingerprint is byte-identical, rotateHash moves); with `turbulence` ON
     * the curl phase reads the slower spin, so it MOVES the position stream too -- NOT a pure render overlay.
     * Honored by both `burst()` and `spray()`. Draws no RNG; no effect under reduced motion. (v1.23.0)
     */
    spinDrag?: number;
    /**
     * Size-over-life target. `1` (default) is a constant size; the render lerps each piece's DRAWN size
     * from `1.0` at birth to `scaleTo` at death by its life fraction. `0.2` shrinks out, `2` grows,
     * `0` vanishes at death. ISOTROPIC (one factor on both axes), folded into the same `ctx.scale` as
     * `flutter`'s X-wobble, so `pool.w`/`pool.h` are never touched and the seeded POSITION fingerprint
     * is byte-identical whether off or on -- a pure RENDER overlay. Coerced with `nonneg`: a NEGATIVE
     * clamps to `0` (a size has no direction -- not a mirror flip, not a fallback to `1`);
     * non-finite/non-numeric -> `1`. The trail ribbon keeps its birth width. Honored by both `burst()`
     * and `spray()`. Draws no RNG; no effect under reduced motion. (v1.17.0)
     */
    scaleTo?: number;
    /**
     * Tumble-wobble SPEED multiplier on the seeded flutter -- the SPEED knob to `flutter`'s DEPTH
     * (v1.18.0). `1` (default) is the seeded wobble rate as-is; `0` FREEZES the wobble at each piece's
     * OWN random birth tilt (a varied constant wobble, not collapsed to one value); `0.3` is a slow lazy
     * flutter; `2` is a fast shimmer; a negative value REVERSES the phase. A render-time PHASE SCALE about
     * a stored birth pivot: it scales only the accumulated wobble phase and never touches `pool.tilt` --
     * the phase the integrator advances and that `turbulence` and `sway` read -- so it is fully decoupled
     * from them and the seeded POSITION fingerprint is byte-identical whether off, on, or on-with-turbulence
     * (a pure render overlay reusing flutter's `ctx.scale`). Inert when `flutter` is `0` (a zero-depth
     * wobble has no speed to scale). Coerced with `num` -- any FINITE value passes (0 and negatives are
     * valid); non-finite/non-numeric -> `1`. Honored by both `burst()` and `spray()`. Draws no RNG; no
     * effect under reduced motion.
     */
    flutterRate?: number;
    /**
     * Birth-opacity ramp -- the FIRST public knob on the render-OPACITY axis (v1.19.0). Fade each piece
     * up from fully transparent over the FIRST `fadeIn` fraction of its life: `0.4` eases in over the first
     * 40%, `1` ramps across the whole life. It is the mirror of the hardcoded death fade-OUT and MULTIPLIES
     * the same alpha, so for a normal life the two act in disjoint windows (in near birth, out near death)
     * and for a very short life they overlap and correctly multiply; the death fade is UNCHANGED. A pure
     * RENDER overlay on `ctx.globalAlpha` -- it never touches `pool.x/y/vx/vy`, draws no RNG, and reads only
     * the life fraction, so the seeded POSITION fingerprint (and the rotate/scale/stroke/color streams) is
     * byte-identical whether off or on. The trail ribbon shares the body alpha, so the streak materializes
     * in with the body. Coerced with `clamp01`: non-finite/non-numeric/undefined/negative -> `0` (off,
     * today's instant-on look), a value > 1 clamps to `1`. Honored by both `burst()` and `spray()`; no
     * effect under reduced motion (the constant static opacity is untouched).
     */
    fadeIn?: number;
    /**
     * Death-fade window -- the SECOND public knob on the render-OPACITY axis (v1.20.0), the mirror of
     * `fadeIn`. The fraction of life over which each piece dissolves OUT at the END: `0.6` fades over the
     * last 60% (a long gentle dissolve), `0.1` a quick blink-out, `1` fades across the whole life; default
     * `0.3` = today's exact look (the previously hardcoded window). It MULTIPLIES the same alpha as `fadeIn`,
     * so the two compose into the full opacity envelope -- materialize in, hold, dissolve out. A pure RENDER
     * overlay on `ctx.globalAlpha` -- it never touches `pool.x/y/vx/vy`, draws no RNG, and reads only the
     * life fraction, so the seeded POSITION fingerprint (and the rotate/scale/stroke/color streams) is
     * byte-identical whether off or on. The trail ribbon shares the body alpha, so the streak dissolves out
     * with the body. Coerced with `clamp01`: non-finite/non-numeric/undefined -> `0.3` (the default window);
     * a NEGATIVE value (e.g. `-1`) clamps to `0` = a hard cut (full opacity then gone), NOT a fallback to the
     * default; a value > 1 clamps to `1`. Honored by both `burst()` and `spray()`; no effect under reduced
     * motion (the constant static opacity is untouched).
     */
    fadeOut?: number;
    /** Per-particle turbulence: a rotating acceleration (px/sec^2) that makes each particle
     *  wander organically. Default 0 (none). Opt-in, fingerprint-safe, draws no RNG; no effect
     *  under reduced motion. */
    turbulence?: number;
    /** Gust: a global, sinusoidally-oscillating horizontal acceleration (px/sec^2) layered on
     *  `wind` -- the whole burst swells one way then the other in ~3s waves. Default 0 (none).
     *  Opt-in, fingerprint-safe, draws no RNG. */
    gust?: number;
    /** Vortex radial spring strength (1/sec^2, scaled by distance): the acceleration toward the
     *  center is `attract * (center - pos)`. Positive PULLS in (a damped inward spiral), negative
     *  REPELS. Zero at the center (no singularity). Default 0 (none). Opt-in, fingerprint-safe,
     *  draws no RNG. */
    attract?: number;
    /** Vortex tangential strength (1/sec^2): spins particles around the center (perpendicular to
     *  `attract`); the sign sets the spin direction. Default 0 (none). Opt-in, draws no RNG. */
    swirl?: number;
    /** Vortex center X (CSS px). Default: the burst origin `x` (a bare `attract`/`swirl` spins
     *  around where the burst was fired). */
    attractX?: number;
    /** Vortex center Y (CSS px). Default: the burst origin `y`. */
    attractY?: number;
    /** Per-particle motion-trail length: how many recent world positions this burst's ribbon
     *  spans, in `0..capacity`. Requires a construction `trail` budget (see `createConfetti`);
     *  ignored on an instance created without one. Default: the full capacity. `0` opts a burst
     *  out. Trails are a pure RENDER overlay -- every committed physics fingerprint is preserved
     *  at any depth -- and have no effect under reduced motion. */
    trail?: number;
    /**
     * Spawn emitter shape (v1.13.0). Distributes a burst's spawn ORIGIN over a shape instead of
     * the single point `(x, y)`:
     *  - `'line'` -- a HORIZONTAL segment centred on `(x, y)`, half-length `emitSize` (a rain / snow
     *    curtain);
     *  - `'ring'` -- the circle of radius `emitSize` around `(x, y)`, with each piece fired radially
     *    OUTWARD from the centre (a firework shell: `speed` = expansion rate, `spread` = angular fuzz);
     *  - `'box'` -- the square `[x +/- emitSize, y +/- emitSize]` (an area burst).
     * `line` and `box` leave velocity governed by `angle`/`spread` (only the origin moves). Default:
     * a single point. Opt-in and fail-closed -- an unknown shape, a non-string value, or a
     * non-positive/non-finite `emitSize` spawns at the point, byte-identical to a point burst; every
     * committed position fingerprint is preserved when off. No effect under reduced motion.
     */
    emit?: 'line' | 'ring' | 'box';
    /**
     * Emitter extent in CSS px for `emit`: the line half-length, the ring radius, or the box square
     * half-extent. Required for `emit` to take effect; `<= 0` or non-finite falls back to a point
     * spawn. Ignored when `emit` is unset. Default: none (point spawn).
     */
    emitSize?: number;
    /**
     * Staggered-emission window in milliseconds (v1.14.0). A burst normally spawns its whole `count`
     * at once; `stagger` spreads the births evenly across this window (piece `i` wakes at
     * `stagger * i / count` ms), so the burst cascades / ripples in. This is the BURST-only analog of
     * a spray's `duration` -- a spray already emits over time, so `stagger` is ignored on `spray()`.
     * Opt-in and fail-closed: off / `<= 0` / non-finite spawns synchronously, byte-identical to every
     * prior release. Zero-rng (the delay schedule is index-based); no effect under reduced motion.
     */
    stagger?: number;
    angle?: number; onComplete?: () => void;
}
export interface SprayOptions extends Omit<BurstOptions, 'onComplete'> {
    duration?: number;
    rate?: number;
    /**
     * Stream follows the live pointer within THIS instance's canvas.
     * Opt-in; binds a passive listener only while a follow-spray is active, and
     * releases it when the spray ends or the instance is destroyed.
     *
     * NON-DETERMINISTIC by nature: it injects live pointer positions the seed
     * knows nothing about. It consumes no rng draw, so a non-following spray still
     * replays identically from a seed -- but a following one will not.
     */
    followPointer?: boolean;
}

/** A named drop-in config. Spread into burst()/spray(): c.burst({ ...presets.fireworks }). */
export type Preset = BurstOptions;

/** Iconic effects, ready to spread. */
export const presets: {
    readonly fireworks: Preset;
    readonly cannons: Preset;
    readonly snow: Preset;
    readonly pride: Preset;
};

/** A lite-hueforge gradient stop, or any object exposing a `.color`. */
export interface GradientStop {
    color: OklchColor | string;
    stop?: number;
}

/**
 * Normalize a lite-hueforge `toGradientStops()` result (gradient stops, a
 * `{ stops }` wrapper, a plain colors array, or a single color) into a colors
 * array for the `colors` option. Never returns an empty array -- falls back to
 * the default palette, because an empty `colors` would paint nothing.
 */
export function colorsFromPalette(
    paletteInput:
        | GradientStop[]
        | { stops: Array<GradientStop | OklchColor | string> }
        | Array<OklchColor | string>
        | OklchColor
        | string
        | null
        | undefined,
): Array<OklchColor | string>;

/**
 * Burst-origin sugar: `{ x, y, ...extra }` from `el.getBoundingClientRect()`,
 * measured once. x/y are VIEWPORT coordinates -- correct as-is for a full-screen
 * overlay canvas; for an inline/offset canvas, subtract that canvas's own rect.
 */
export function fromElement<E extends object = {}>(el: HTMLElement, extra?: E): E & { x?: number; y?: number };
export interface ConfettiInstance {
    burst(options?: BurstOptions): void;
    spray(options?: SprayOptions): void;
    clear(): void;
    readonly count: number;
    seed(s: number): void;
    /**
     * Register a custom particle shape for THIS instance, usable as
     * `burst({ shape: name })`. Per-instance: invisible to other instances and dropped
     * on destroy(). `name` must not be a built-in; re-registering a custom name replaces
     * it and keeps its id. Returns the assigned shape id (>= 5), or -1 after destroy().
     * Throws on an empty/non-string name, a built-in override, or a malformed def.
     */
    registerShape(name: string, def: ShapeDef): number;
    destroy(): void;
}
export function createConfetti(canvas: HTMLCanvasElement, options?: {
    seed?: number;
    maxParticles?: number;
    respectReducedMotion?: boolean;
    /** Motion-trail capacity: ring-buffer depth (samples of recent world positions) for the
     *  per-particle ribbon. Sizes the buffer ONCE (zero-GC -- no lazy growth), so it must be set
     *  here, not per burst. Default 0 = off (no buffers; byte-identical to no trails). Capped at
     *  64; fails closed to 0 on non-finite/negative input. A per-burst `trail` (0..this) then
     *  shortens or opts a burst out. Pure render overlay: every committed physics fingerprint is
     *  preserved. */
    trail?: number;
}): ConfettiInstance;
export function confetti(options?: BurstOptions & { seed?: number }): ConfettiInstance;
export default confetti;
