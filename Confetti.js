/**
 * @zakkster/lite-confetti v1.12.0 -- Deterministic Confetti Engine
 *
 * The confetti library that canvas-confetti wishes it was.
 * Deterministic (seeded), zero-GC hot path, OKLCH colors,
 * reduced-motion aware, composable with lite-timeline.
 *
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

// Angular frequency of the global `gust` oscillation: one full swell-and-return every ~3s.
// The whole pool shares this phase (driven by the instance `_elapsed` clock), so gust reads
// as a coherent breeze rather than per-particle noise.
const GUST_HZ = 2 * Math.PI / 3;

// Color-over-life (v1.12.0). A `lifeColors` burst bakes its multi-stop OKLCH ramp ONCE into a
// fixed-resolution LUT of CSS strings (bakeCssGradient), and the render loop indexes it by the
// particle's life fraction -- a pure array read, no per-frame color math. RAMP_N is the LUT
// resolution (32 steps is visually smooth and a trivial one-time allocation); RAMP_LAST is the
// top index. The ramp draws NO rng and touches no position, so it is a pure color overlay:
// every committed POSITION fingerprint is byte-identical whether or not `lifeColors` is used.
const RAMP_N = 32;
const RAMP_LAST = RAMP_N - 1;

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
        lifeMin: 1.6, lifeMax: 3.2, shape: 'star', angle: -Math.PI / 2,
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
        lifeMin: 3.5, lifeMax: 7.5, shape: 'circle', angle: -Math.PI / 2,
    },
    /** Vibrant rainbow burst using perceptually tuned OKLCH. */
    pride: {
        count: 110, spread: 1.6, speed: 320, speedVariance: 160,
        gravity: 480, drag: 0.975, sizeMin: 5, sizeMax: 13,
        lifeMin: 1.7, lifeMax: 3.3, shape: 'rect', angle: -Math.PI / 2,
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
        ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
        ctx.fill();
    },

    star(ctx, w) {
        const r = w / 2;
        const ir = r * 0.4;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
            const a = (i * Math.PI) / 5 - Math.PI / 2;
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
        turb:  new Float32Array(maxParticles),   // turbulence accel magnitude (px/sec^2); 0 = none
        gust:  new Float32Array(maxParticles),   // gust accel magnitude (px/sec^2); 0 = none
        vortX: new Float32Array(maxParticles),   // vortex/attractor center X (CSS px)
        vortY: new Float32Array(maxParticles),   // vortex/attractor center Y (CSS px)
        attract:new Float32Array(maxParticles),  // radial spring strength (1/sec^2); 0 = off, <0 = repel
        swirl: new Float32Array(maxParticles),   // tangential strength (1/sec^2); 0 = off, sign = spin
        settle:new Float32Array(maxParticles),   // rest-speed threshold (px/sec); 0 = off (never settles)
        landed:new Uint8Array(maxParticles),     // 1 = at rest on the floor (physics frozen); 0 = active
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
        pool.spin[i] = rng.next() * Math.PI * 2;
        pool.spinV[i] = (rng.next() - 0.5) * 10;
        pool.tilt[i] = rng.next() * Math.PI * 2;
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
        pool.turb[i] = config.turbulence;
        pool.gust[i] = config.gust;
        pool.vortX[i] = config.attractX;
        pool.vortY[i] = config.attractY;
        pool.attract[i] = config.attract;
        pool.swirl[i] = config.swirl;
        pool.settle[i] = config.settle;
        // Fail-closed reset: a recycled slot must never inherit the dead particle's frozen state,
        // or a fresh piece would spawn already "landed" and skip all physics. (Same pool-reuse
        // subtlety as the trail `trailN = 0` reset.)
        pool.landed[i] = 0;
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
                }

                // Spin + wobble
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
                } else if (pool.x[i] > pool.wallR[i]) {
                    pool.x[i] = pool.wallR[i];
                    pool.vx[i] = -pool.vx[i] * pool.bounce[i];
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

            // Opacity fade in last 30% of life
            const lifeT = pool.life[i] / pool.maxL[i];
            const alpha = lifeT < 0.3 ? lifeT / 0.3 : 1;

            // 3D-ish tumble via X-scale oscillation. flutter (flut, 0..1) sets its depth:
            // flut == 1 reproduces the pre-1.3.0 wobble (0.5 + 0.5|cos|) exactly, flut == 0
            // holds the piece rigid. Scale never enters the position fingerprint, so this
            // knob is hash-neutral regardless of its value.
            const a = pool.flut[i];
            const wobbleScale = 1 - a * 0.5 * (1 - Math.abs(Math.cos(pool.tilt[i])));

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

            // Render
            ctx.save();
            ctx.translate(pool.x[i], pool.y[i]);
            ctx.rotate(pool.spin[i]);
            ctx.scale(wobbleScale, 1);
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
            const angle = -Math.PI / 2 + (rng.next() - 0.5) * spread;
            const dist = 30 + rng.next() * 120;
            const px = cx + Math.cos(angle) * dist;
            const py = cy + Math.sin(angle) * dist;
            const size = sizeMin + rng.next() * (sizeMax - sizeMin);
            const color = colors[Math.floor(rng.next() * colors.length)];
            const rotation = rng.next() * Math.PI * 2;
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
         * @param {number} [options.turbulence=0] Per-particle rotating accel px/sec^2 (organic wander). Opt-in, zero-rng, fingerprint-safe
         * @param {number} [options.gust=0]      Global oscillating horizontal accel px/sec^2 layered on wind (~3s swells). Opt-in, zero-rng
         * @param {number} [options.attract=0]   Vortex radial spring strength (1/sec^2, scaled by distance): + pulls toward the center, - repels. Opt-in, zero-rng, fingerprint-safe
         * @param {number} [options.swirl=0]     Vortex tangential strength (1/sec^2): spins particles around the center; sign = spin direction. Opt-in, zero-rng
         * @param {number} [options.attractX]    Vortex center X (CSS px); default: the burst origin x
         * @param {number} [options.attractY]    Vortex center Y (CSS px); default: the burst origin y
         * @param {number} [options.settle=0]    Rest-speed threshold px/sec: a piece whose post-bounce |vy| drops below it freezes on the `floor` and piles (keeps aging + fades). Needs a `floor`. Opt-in, zero-rng, fingerprint-safe
         * @param {number} [options.trail]       Per-particle motion-trail length 0..capacity (default: full capacity). Needs a construction `trail` budget; ignored otherwise. Render overlay, fingerprint-safe
         * @param {Array}  [options.colors]      Array of OKLCH objects or CSS strings
         * @param {Array}  [options.lifeColors]  Multi-stop OKLCH life ramp (>= 2 stops, birth-color first): the body sweeps it over each particle's life (sparks cooling white->red). Baked once per burst; the trail stays the flat `colors` pick. Opt-in, zero-rng, a pure color overlay -- position fingerprints preserved
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
                  turbulence = 0,
                  gust = 0,
                  attract = 0,
                  swirl = 0,
                  attractX,
                  attractY,
                  trail,
                  colors = DEFAULT_COLORS,
                  lifeColors,
                  angle = -Math.PI / 2,
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
            wallLeft = num(wallLeft, -Infinity);   // opt-in box edge; non-finite => no left wall
            wallRight = num(wallRight, Infinity);  // opt-in box edge; non-finite => no right wall
            ceiling = num(ceiling, -Infinity);     // opt-in box edge; non-finite => no ceiling
            drag = clamp01(drag, 0.98);
            sizeMin = nonneg(sizeMin, 5);
            sizeMax = nonneg(sizeMax, 12);
            lifeMin = nonneg(lifeMin, 1.5);
            lifeMax = nonneg(lifeMax, 3.0);
            angle = num(angle, -Math.PI / 2);
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

            // Reduced motion: show static confetti, no animation
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
                flutter: clamp01(flutter, 1), sway: clamp01(sway, 0), turbulence, gust, trailLen: trailDraw,
                attract, swirl, attractX: vortX, attractY: vortY, settle, lifeRamp,
            };

            for (let i = 0; i < count; i++) {
                const a = angle + (rng.next() - 0.5) * spread;
                const s = speed + (rng.next() - 0.5) * speedVariance * 2;
                spawn(cx, cy, Math.cos(a) * s, Math.sin(a) * s, config);
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
         * @param {number} [options.turbulence=0]   Per-particle rotating accel px/sec^2 (organic wander). Opt-in, zero-rng
         * @param {number} [options.gust=0]         Global oscillating horizontal accel px/sec^2 layered on wind. Opt-in, zero-rng
         * @param {number} [options.attract=0]      Vortex radial spring strength (1/sec^2): + pulls toward the center, - repels. Opt-in, zero-rng
         * @param {number} [options.swirl=0]        Vortex tangential strength (1/sec^2): spins around the center; sign = direction. Opt-in, zero-rng
         * @param {number} [options.attractX]       Vortex center X (CSS px); default: the spray origin x
         * @param {number} [options.attractY]       Vortex center Y (CSS px); default: the spray origin y
         * @param {number} [options.settle=0]       Rest-speed threshold px/sec: a piece whose post-bounce |vy| drops below it freezes on the `floor` and piles (keeps aging + fades). Needs a `floor`. Opt-in, zero-rng
         * @param {number} [options.trail]          Per-particle motion-trail length 0..capacity (default: full). Needs a construction `trail` budget; render overlay, fingerprint-safe
         * @param {Array}  [options.lifeColors]     Multi-stop OKLCH life ramp (>= 2 stops, birth-color first): the body sweeps it over each particle's life. Baked once; trail stays the flat `colors` pick. Opt-in, zero-rng, a pure color overlay
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
                  turbulence = 0,
                  gust = 0,
                  attract = 0,
                  swirl = 0,
                  attractX,
                  attractY,
                  trail,
                  colors = DEFAULT_COLORS,
                  lifeColors,
                  angle = -Math.PI / 2,
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
            wallLeft = num(wallLeft, -Infinity);   // opt-in box edge; non-finite => no left wall
            wallRight = num(wallRight, Infinity);  // opt-in box edge; non-finite => no right wall
            ceiling = num(ceiling, -Infinity);     // opt-in box edge; non-finite => no ceiling
            drag = clamp01(drag, 0.98);
            sizeMin = nonneg(sizeMin, 4);
            sizeMax = nonneg(sizeMax, 10);
            lifeMin = nonneg(lifeMin, 1.2);
            lifeMax = nonneg(lifeMax, 2.5);
            angle = num(angle, -Math.PI / 2);
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
                flutter: clamp01(flutter, 1), sway: clamp01(sway, 0), turbulence, gust, trailLen: trailDraw,
                attract, swirl, attractX: vortX, attractY: vortY, settle, lifeRamp,
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
                    spawn(sx, sy, Math.cos(a) * s, Math.sin(a) * s, config);
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