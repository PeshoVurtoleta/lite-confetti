/**
 * @zakkster/lite-confetti v1.5.0 -- Deterministic Confetti Engine
 *
 * The confetti library that canvas-confetti wishes it was.
 * Deterministic (seeded), zero-GC hot path, OKLCH colors,
 * reduced-motion aware, composable with lite-timeline.
 *
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
import { toCssOklch } from '@zakkster/lite-color';
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
 */
export function createConfetti(canvas, {
    seed,
    maxParticles = 500,
    respectReducedMotion = true,
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
        drag:  new Float32Array(maxParticles),
        flut:  new Float32Array(maxParticles),   // flutter: tumble depth 0..1 (X-scale wobble)
        sway:  new Float32Array(maxParticles),   // sway: horizontal drift amplitude 0..1
        shape: new Uint8Array(maxParticles),     // 0..4 built-in, 5+ = registerShape() custom
    };

    // Color and emoji stored as arrays (can't go in TypedArrays)
    const colors = new Array(maxParticles);
    const emojis = new Array(maxParticles);

    let head = 0;
    let aliveCount = 0;

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
        pool.drag[i] = config.drag;
        pool.flut[i] = config.flutter;
        pool.sway[i] = config.sway;
        // Multi-shape mixing: when a `shapes` mix is active, pick a shape per particle
        // (weighted by repetition in the array). The single-shape branch takes NO rng
        // draw, so a default burst's determinism fingerprint is byte-for-byte preserved;
        // the mixed branch draws exactly one rng.next() at this fixed point (before the
        // colour pick below), so a mixed burst is itself deterministic under a fixed seed.
        pool.shape[i] = config.shapeIds
            ? config.shapeIds[(rng.next() * config.shapeIds.length) | 0]
            : config.shapeId;
        colors[i] = config.colorPick();
        emojis[i] = config.emoji || DEFAULT_EMOJI;
    }

    // -- Render loop --
    function update(dt) {
        const dtSec = dt / 1000;
        const W = canvas.width;
        const H = canvas.height;

        ctx.clearRect(0, 0, W, H);

        let alive = 0;

        for (let i = 0; i < maxParticles; i++) {
            if (pool.life[i] <= 0) continue;

            pool.life[i] -= dtSec;
            if (pool.life[i] <= 0) { pool.life[i] = 0; continue; }

            alive++;

            // Physics
            pool.vy[i] += pool.grav[i] * dtSec;
            // Wind: sustained lateral drift, the X-axis mirror of gravity. Guarded so the
            // default (wind == 0) leaves vx byte-identical -- gravity is unguarded only
            // because its default is non-zero; wind defaults to 0, so it follows the sway
            // discipline (the committed fingerprint depends on this branch never firing by
            // default). Applied before drag, so wind is damped toward a terminal lateral
            // velocity exactly as gravity is toward a terminal fall speed.
            if (pool.wind[i] !== 0) pool.vx[i] += pool.wind[i] * dtSec;
            pool.vx[i] *= pool.drag[i];
            pool.vy[i] *= pool.drag[i];
            pool.x[i] += pool.vx[i] * dtSec;
            pool.y[i] += pool.vy[i] * dtSec;

            // Spin + wobble
            pool.spin[i] += pool.spinV[i] * dtSec;
            pool.tilt[i] += pool.tiltV[i] * dtSec;

            // Sway: paper-like side-to-side drift, opt-in. Guarded so the default
            // (sway == 0) leaves positions byte-identical to pre-1.3.0 -- the committed
            // determinism fingerprint depends on this branch never firing by default.
            if (pool.sway[i] !== 0) {
                pool.x[i] += Math.sin(pool.tilt[i]) * pool.sway[i] * SWAY_PX * dtSec;
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

            // Render
            ctx.save();
            ctx.translate(pool.x[i], pool.y[i]);
            ctx.rotate(pool.spin[i]);
            ctx.scale(wobbleScale, 1);
            ctx.globalAlpha = alpha;

            const id = pool.shape[i];
            if (!shapeBlit[id]) {
                ctx.fillStyle = colors[i]; // Pre-parsed in burst()/spray() -- zero allocation
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
         * @param {Array}  [options.colors]      Array of OKLCH objects or CSS strings
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
                  colors = DEFAULT_COLORS,
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

            // Reduced motion: show static confetti, no animation
            if (respectReducedMotion && _prefersReducedMotion) {
                renderStaticBurst(cx, cy, count, parsedColors, shapeId, sizeMin, sizeMax, spread, emoji, shapeIds);
                if (onComplete) setTimeout(onComplete, 1500);
                return;
            }

            const colorPick = () => rng.pick(parsedColors);
            const config = {
                sizeMin, sizeMax, lifeMin, lifeMax, gravity, wind, drag, shapeId, shapeIds, emoji, colorPick,
                flutter: clamp01(flutter, 1), sway: clamp01(sway, 0),
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
         * @param {number} [options.flutter=1]      Tumble depth 0..1
         * @param {number} [options.sway=0]         Horizontal drift 0..1
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
                  colors = DEFAULT_COLORS,
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

            if (respectReducedMotion && _prefersReducedMotion) {
                renderStaticBurst(cx, cy, 30, parsedColors, shapeId, sizeMin, sizeMax, spread, emoji, shapeIds);
                return;
            }

            const colorPick = () => rng.pick(parsedColors);
            const config = {
                sizeMin, sizeMax, lifeMin, lifeMax, gravity, wind, drag, shapeId, shapeIds, emoji, colorPick,
                flutter: clamp01(flutter, 1), sway: clamp01(sway, 0),
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