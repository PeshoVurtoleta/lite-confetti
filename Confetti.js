/**
 * @zakkster/lite-confetti v1.2.0 — Deterministic Confetti Engine
 *
 * The confetti library that canvas-confetti wishes it was.
 * Deterministic (seeded), zero-GC hot path, OKLCH colors,
 * reduced-motion aware, composable with lite-timeline.
 *
 * v1.2.0 adds: named presets (fireworks / cannons / snow / pride),
 * colorsFromPalette() for direct lite-hueforge toGradientStops() consumption,
 * fromElement() burst-origin sugar, and per-instance pointer-follow spray.
 *
 * Depends on:
 *   @zakkster/lite-random  (deterministic RNG)
 *   @zakkster/lite-color   (OKLCH colors)
 *   lite-ticker            (shared RAF loop)
 *
 * Does NOT depend on lite-vec, lite-steer, lite-fx, or lite-particles.
 * Confetti is simple physics — gravity, drag, spin. No steering needed.
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


// ─────────────────────────────────────────────────────────
//  SHARED TICKER (ref-counted)
// ─────────────────────────────────────────────────────────

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


// ─────────────────────────────────────────────────────────
//  REDUCED MOTION DETECTION
// ─────────────────────────────────────────────────────────

let _prefersReducedMotion = false;
if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    _prefersReducedMotion = mq.matches;
    mq.addEventListener?.('change', (e) => { _prefersReducedMotion = e.matches; });
}


// ─────────────────────────────────────────────────────────
//  DEFAULT OKLCH CONFETTI COLORS
//  Perceptually uniform — every piece looks equally vibrant.
// ─────────────────────────────────────────────────────────

const DEFAULT_COLORS = [
    { l: 0.70, c: 0.25, h: 30 },   // orange
    { l: 0.65, c: 0.28, h: 330 },  // pink
    { l: 0.72, c: 0.22, h: 60 },   // gold
    { l: 0.60, c: 0.25, h: 270 },  // purple
    { l: 0.68, c: 0.22, h: 150 },  // green
    { l: 0.62, c: 0.20, h: 210 },  // blue
    { l: 0.75, c: 0.20, h: 0 },    // red
];


// ─────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────
//  NAMED PRESETS — drop-in configs for iconic effects
//  Spread into burst()/spray(): c.burst({ ...presets.fireworks })
//  Every `shape` here is one of the five the engine knows
//  (rect | circle | star | triangle | emoji) — validated in the test suite.
// ─────────────────────────────────────────────────────────

export const presets = {
    /** Explosive upward burst with stars — classic celebration. */
    fireworks: {
        count: 140, spread: 1.9, speed: 380, speedVariance: 220,
        gravity: 420, drag: 0.97, sizeMin: 6, sizeMax: 14,
        lifeMin: 1.6, lifeMax: 3.2, shape: 'star', angle: -Math.PI / 2,
    },
    /** Powerful angled launch — side cannons, stage effects. */
    cannons: {
        count: 55, spread: 0.5, speed: 720, speedVariance: 80,
        gravity: 920, drag: 0.985, sizeMin: 5, sizeMax: 11,
        lifeMin: 1.3, lifeMax: 2.8, shape: 'rect', angle: -Math.PI * 0.65,
    },
    /** Gentle wide falling snow — long life, low gravity, circles. */
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
// ─────────────────────────────────────────────────────────

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


// ─────────────────────────────────────────────────────────
//  EMOJI GLYPH ATLAS
//  Rasterize each emoji once to a small offscreen canvas at a fixed base size, then
//  drawImage() it (scaled) per particle. Module-level and shared across instances --
//  the '🎉' bitmap is identical everywhere, so there is no reason to cache per canvas.
//  Zero rasterization on the hot path after first sight of a glyph.
// ─────────────────────────────────────────────────────────

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


// ─────────────────────────────────────────────────────────
//  CONFETTI CANVAS
// ─────────────────────────────────────────────────────────

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
        return { burst() {}, spray() {}, clear() {}, destroy() {} };
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        console.warn('@zakkster/lite-confetti: canvas 2d context unavailable');
        return { burst() {}, spray() {}, clear() {}, get count() { return 0; }, seed() {}, destroy() {} };
    }
    const rng = new Random(seed ?? Date.now());
    const ticker = acquireTicker();
    let removeFn = null;
    let destroyed = false;

    // ── Cached dimensions (never read clientWidth in the hot loop) ──
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

    // ── ResizeObserver (same pattern as lite-viewport) ──
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

    // ── Particle Pool (flat arrays for cache-friendliness) ──
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
        drag:  new Float32Array(maxParticles),
        shape: new Uint8Array(maxParticles),     // 0=rect, 1=circle, 2=star, 3=triangle, 4=emoji
    };

    // Color and emoji stored as arrays (can't go in TypedArrays)
    const colors = new Array(maxParticles);
    const emojis = new Array(maxParticles);

    let head = 0;
    let aliveCount = 0;

    // ── Pointer-follow state (v1.2.0), per-instance ──────────────────────────
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

    // ── Shape ID mapping ──
    const SHAPE_MAP = { rect: 0, circle: 1, star: 2, triangle: 3, emoji: 4 };

    // ── Spawn a single particle ──
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
        pool.drag[i] = config.drag;
        pool.shape[i] = config.shapeId;
        colors[i] = config.colorPick();
        emojis[i] = config.emoji || '🎉';
    }

    // ── Render loop ──
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
            pool.vx[i] *= pool.drag[i];
            pool.vy[i] *= pool.drag[i];
            pool.x[i] += pool.vx[i] * dtSec;
            pool.y[i] += pool.vy[i] * dtSec;

            // Spin + wobble
            pool.spin[i] += pool.spinV[i] * dtSec;
            pool.tilt[i] += pool.tiltV[i] * dtSec;

            // Opacity fade in last 30% of life
            const lifeT = pool.life[i] / pool.maxL[i];
            const alpha = lifeT < 0.3 ? lifeT / 0.3 : 1;

            // 3D-ish wobble via X-scale oscillation
            const wobbleScale = 0.5 + Math.abs(Math.cos(pool.tilt[i])) * 0.5;

            // Render
            ctx.save();
            ctx.translate(pool.x[i], pool.y[i]);
            ctx.rotate(pool.spin[i]);
            ctx.scale(wobbleScale, 1);
            ctx.globalAlpha = alpha;

            const c = colors[i];
            if (pool.shape[i] !== 4) {
                ctx.fillStyle = c; // Pre-parsed in burst()/spray() — zero allocation
            }

            switch (pool.shape[i]) {
                case 0: Shapes.rect(ctx, pool.w[i], pool.h[i]); break;
                case 1: Shapes.circle(ctx, pool.w[i]); break;
                case 2: Shapes.star(ctx, pool.w[i]); break;
                case 3: Shapes.triangle(ctx, pool.w[i]); break;
                case 4: Shapes.emoji(ctx, pool.w[i], emojis[i]); break;
            }

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

    // ═══════════════════════════════════════════════════════
    //  PUBLIC API
    // ═══════════════════════════════════════════════════════

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
         * @param {number} [options.drag=0.98]   Per-frame velocity retention
         * @param {number} [options.sizeMin=5]
         * @param {number} [options.sizeMax=12]
         * @param {number} [options.lifeMin=1.5]
         * @param {number} [options.lifeMax=3.0]
         * @param {string} [options.shape='rect'] 'rect','circle','star','triangle','emoji'
         * @param {string} [options.emoji='🎉']  Emoji character (shape must be 'emoji')
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
                  drag = 0.98,
                  sizeMin = 5,
                  sizeMax = 12,
                  lifeMin = 1.5,
                  lifeMax = 3.0,
                  shape = 'rect',
                  emoji = '🎉',
                  colors = DEFAULT_COLORS,
                  angle = -Math.PI / 2,
                  onComplete,
              } = {}) {
            if (destroyed) return;

            const cx = x ?? cw / 2;
            const cy = y ?? ch * 0.33;
            const shapeId = SHAPE_MAP[shape] ?? 0;
            // Rasterize the emoji glyph now (once), so the first frame has no hitch.
            if (shapeId === 4) EmojiAtlas.prime(emoji || '🎉');

            // Pre-parse OKLCH objects to CSS strings ONCE per burst.
            // This keeps the render loop 100% zero-GC — no toCssOklch() per frame.
            const parsedColors = colors.map(c => typeof c === 'string' ? c : toCssOklch(c));

            // Reduced motion: show static confetti, no animation
            if (respectReducedMotion && _prefersReducedMotion) {
                _renderStaticBurst(ctx, cx, cy, count, parsedColors, shapeId, sizeMin, sizeMax, spread, emoji, rng);
                if (onComplete) setTimeout(onComplete, 1500);
                return;
            }

            const colorPick = () => rng.pick(parsedColors);
            const config = { sizeMin, sizeMax, lifeMin, lifeMax, gravity, drag, shapeId, emoji, colorPick };

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
         */
        spray({
                  duration = 1000,
                  rate = 5,
                  x, y,
                  spread = 0.8,
                  speed = 300,
                  speedVariance = 150,
                  gravity = 500,
                  drag = 0.98,
                  sizeMin = 4,
                  sizeMax = 10,
                  lifeMin = 1.2,
                  lifeMax = 2.5,
                  shape = 'rect',
                  emoji = '🎉',
                  colors = DEFAULT_COLORS,
                  angle = -Math.PI / 2,
                  followPointer = false,
              } = {}) {
            if (destroyed) return;

            const cx = x ?? cw / 2;
            const cy = y ?? ch * 0.33;
            const shapeId = SHAPE_MAP[shape] ?? 0;
            // Rasterize the emoji glyph now (once), so the first frame has no hitch.
            if (shapeId === 4) EmojiAtlas.prime(emoji || '🎉');

            // Pre-parse OKLCH objects to CSS strings ONCE per spray.
            const parsedColors = colors.map(c => typeof c === 'string' ? c : toCssOklch(c));

            if (respectReducedMotion && _prefersReducedMotion) {
                _renderStaticBurst(ctx, cx, cy, 30, parsedColors, shapeId, sizeMin, sizeMax, spread, emoji, rng);
                return;
            }

            const colorPick = () => rng.pick(parsedColors);
            const config = { sizeMin, sizeMax, lifeMin, lifeMax, gravity, drag, shapeId, emoji, colorPick };

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

            // Piggyback on the render loop — spray spawns, render draws
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
        },
    };

    return api;
}


// ─────────────────────────────────────────────────────────
//  REDUCED MOTION: Static Confetti Render
//  Shows confetti pieces in their spread positions with no
//  animation. Fades out after 1.5s via CSS opacity transition.
//  Users see the celebration without motion sickness.
// ─────────────────────────────────────────────────────────

function _renderStaticBurst(ctx, cx, cy, count, colors, shapeId, sizeMin, sizeMax, spread, emoji, rng) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    for (let i = 0; i < Math.min(count, 40); i++) {
        const angle = -Math.PI / 2 + (rng.next() - 0.5) * spread;
        const dist = 30 + rng.next() * 120;
        const x = cx + Math.cos(angle) * dist;
        const y = cy + Math.sin(angle) * dist;
        const size = sizeMin + rng.next() * (sizeMax - sizeMin);
        const color = colors[Math.floor(rng.next() * colors.length)];
        const rotation = rng.next() * Math.PI * 2;

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.globalAlpha = 0.85;

        if (shapeId !== 4) {
            ctx.fillStyle = color; // Already pre-parsed by burst()/spray()
        }

        switch (shapeId) {
            case 0: Shapes.rect(ctx, size, size * 0.6); break;
            case 1: Shapes.circle(ctx, size); break;
            case 2: Shapes.star(ctx, size); break;
            case 3: Shapes.triangle(ctx, size); break;
            case 4: Shapes.emoji(ctx, size, emoji); break;
        }
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


// ─────────────────────────────────────────────────────────
//  v1.2.0 HELPERS
// ─────────────────────────────────────────────────────────

/**
 * Normalize a lite-hueforge `toGradientStops()` result (or a plain palette)
 * into a colors array ready for the `colors` option of burst() / spray().
 *
 * Accepts:
 *   • gradient stops: [{ color: {l,c,h}, stop: 0 }, ...]  -> the colors
 *   • { stops: [...] }                                    -> its stops' colors
 *   • a plain colors array (OKLCH objects or CSS strings) -> passed through
 *   • a single OKLCH object or CSS string                 -> wrapped in an array
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
 * IMPORTANT — coordinate space. The returned x/y are in VIEWPORT coordinates
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


// ─────────────────────────────────────────────────────────
//  CONVENIENCE: One-Shot Global Confetti
//  Creates a temporary full-screen overlay, fires, cleans up.
// ─────────────────────────────────────────────────────────

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