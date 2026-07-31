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
    sizeMin?: number; sizeMax?: number; lifeMin?: number; lifeMax?: number;
    shape?: ShapeName;
    /**
     * Mix multiple shapes in one burst/spray, chosen per-particle (repetition in the
     * array weights the mix, e.g. ['star','star','circle'] is ~2:1). Overrides `shape`;
     * unknown names are dropped, and an empty/all-unknown array falls back to `shape`.
     */
    shapes?: ShapeName[];
    emoji?: string; colors?: Array<OklchColor | string>;
    /** Tumble depth 0..1 (0 rigid, 1 full wobble). Default 1. Affects scale, not position. */
    flutter?: number;
    /** Horizontal drift 0..1 (0 straight fall). Default 0. */
    sway?: number;
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
export function createConfetti(canvas: HTMLCanvasElement, options?: { seed?: number; maxParticles?: number; respectReducedMotion?: boolean }): ConfettiInstance;
export function confetti(options?: BurstOptions & { seed?: number }): ConfettiInstance;
export default confetti;
