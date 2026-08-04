/**
 * @zakkster/lite-confetti -- node:test suite.
 *
 * Ported from the original vitest suite (which imported the runtime API from a
 * .d.ts types file and mocked every dependency). This version runs the REAL
 * engine against the REAL @zakkster deps, over a minimal browser shim
 * (test/_env.mjs). The shim MUST be imported first -- Confetti.js reads
 * window.matchMedia at module-evaluation time.
 */
import './_env.mjs';
import { makeCanvas, pump, firePointerMove, pointerListenerCount, setReducedMotion } from './_env.mjs';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createConfetti, confetti, presets, colorsFromPalette, fromElement } from '../Confetti.js';

// Committed position fingerprint for the deterministic-replay gate. Set after the
// first green run and re-verified in a second process; a change here means the
// seeded physics output moved (a real regression, or an intended physics change
// that must bump this constant deliberately). See the determinism test below.
const COMMITTED_HASH = 1569828004;

// Committed fingerprint for a canonical MIXED burst (shapes:['rect','circle','star']).
// The per-particle shape pick draws one extra rng value per particle, so this
// deliberately differs from COMMITTED_HASH; it is its own deterministic-replay gate.
const MIXED_HASH = 3132631460;

// Committed fingerprint for a canonical WINDY burst (wind: 300). A non-zero wind adds a
// lateral acceleration to every particle, shifting the stream, so this deliberately
// differs from COMMITTED_HASH; it is its own deterministic-replay gate. (No extra rng
// draw is involved -- wind is pure physics -- so this holds cross-process.)
const WIND_HASH = 2385225781;

// Committed fingerprint for a canonical FLOORED burst (floor: 120, bounce: 0). A finite
// floor clamps every particle that reaches it and reflects vy, shifting the stream, so
// this deliberately differs from COMMITTED_HASH; it is its own deterministic-replay gate.
// Like wind, the collision draws no rng (pure physics), so it holds cross-process.
const FLOOR_HASH = 2679696825;
// The floor Y used by the floor/bounce rig. The un-floored fall reaches maxY == 196 over
// the pumped window, so 120 is genuinely crossed (the boundary actually fires).
const FLOOR_Y = 120;

// Committed fingerprint for a canonical BOXED burst (the full bounding box below). Like the
// floor, every box edge is pure physics (no rng), so this holds cross-process and differs
// from both COMMITTED_HASH and FLOOR_HASH -- its own deterministic-replay gate.
const BOX_HASH = 804161759;
// The canonical box for the walls/ceiling rig. The seed-12345 burst is centered at (400,198)
// and, un-boxed, spans x in [249,540] and y in [43,196], so every edge below sits strictly
// inside that spread and is genuinely crossed: left/right walls clamp x, the floor pins y,
// and (see the dedicated ceiling case) an upward launch is caught by a ceiling.
const BOX = { wallLeft: 300, wallRight: 500, ceiling: 80, floor: 180 };

// Committed fingerprints for the time-varying forces (v1.8.0). Both turbulence and gust draw
// NO rng -- turbulence is a pure function of the seeded tilt/spin phases, gust of the shared
// _elapsed clock -- so, like the box, each is cross-process stable and its own replay gate.
// All differ from COMMITTED_HASH and from each other (probed on the seed-12345 rig below).
const TURB_HASH = 1630588936;   // turbulence: 500
const GUST_HASH = 4074438162;   // gust: 400
const TURBGUST_HASH = 15761758; // turbulence: 500 + gust: 400

// Committed fingerprint for the trail GEOMETRY (v1.9.0) -- the strokeHash of the mock ctx, which
// accumulates only stroked (trail) paths and is kept entirely out of the position `hash`. Trails
// are a pure RENDER overlay (they draw via moveTo/lineTo/stroke, never translate), so the POSITION
// hash is preserved at any depth -- see the trails suite, where a trailed run still reproduces
// COMMITTED_HASH. This gate proves the ribbon geometry itself is deterministic. Value probed on
// the seed-12345 rig at construction `trail: 10` (default per-burst length). The ribbon is a
// single flat-alpha stroke, so strokeHash folds one polyline per particle.
const TRAIL_HASH = 72519212;

// Committed fingerprints for the vortex / attractor (v1.10.0). A linear-spring point force draws
// NO rng (a pure function of position + the burst center), so, like the other forces, each is
// cross-process stable and its own replay gate. All differ from COMMITTED_HASH and each other
// (probed on the seed-12345 rig below; center defaults to the burst origin).
const ATTRACT_HASH = 2926753007; // attract: 6  (pull toward the burst origin)
const SWIRL_HASH   = 2039789049; // swirl: 6    (tangential spin)
const VORTEX_HASH  = 1387388835; // attract: 6 + swirl: 6  (inward spiral)

// Committed fingerprint for settle-and-pile (v1.11.0, decision 0012). Its own rig -- a burst that
// falls onto a floor BELOW it and bounces (bounce 0.5) so `settle` has a real bounce-then-rest
// dynamic to freeze (x400/y150, count 120, rect, life 15, spread 1.8, speed 300, gravity 900,
// floor 360, settle 80; pump 1+150). The freeze draws NO rng (a pure function of the piece's own
// post-bounce vy), so this is cross-process stable and its own deterministic-replay gate; it
// differs from the same rig's no-settle (bouncy) hash.
const SETTLE_HASH = 4157000621;

/** Run `fn` with console.warn silenced; report how many warnings it emitted. */
function withSilencedWarn(fn) {
    const orig = console.warn;
    let warned = 0;
    console.warn = () => { warned++; };
    try {
        const value = fn();
        return { value, warned };
    } finally {
        console.warn = orig;
    }
}

describe('lite-confetti', () => {

    describe('createConfetti()', () => {
        it('returns burst, spray, clear, seed, destroy, count', () => {
            const c = createConfetti(makeCanvas());
            assert.equal(typeof c.burst, 'function');
            assert.equal(typeof c.spray, 'function');
            assert.equal(typeof c.clear, 'function');
            assert.equal(typeof c.seed, 'function');
            assert.equal(typeof c.destroy, 'function');
            assert.equal(typeof c.count, 'number');
            c.destroy();
        });

        it('returns a safe noop object on a null canvas (and warns)', () => {
            const { value: c, warned } = withSilencedWarn(() => createConfetti(null));
            assert.ok(warned > 0, 'a null canvas should warn');
            assert.equal(typeof c.burst, 'function');
            assert.doesNotThrow(() => c.burst());
            c.destroy();
        });
    });

    describe('burst()', () => {
        it('spawns the requested count (visible after one frame)', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            c.burst({ count: 50, lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 50);
            c.destroy();
        });

        it('respects a smaller count', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            c.burst({ count: 10, lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 10);
            c.destroy();
        });

        it('uses default colors when none specified', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            assert.doesNotThrow(() => c.burst());
            c.destroy();
        });

        it('supports all five shapes', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            for (const shape of ['rect', 'circle', 'star', 'triangle', 'emoji']) {
                assert.doesNotThrow(() => c.burst({ count: 5, shape, lifeMin: 5, lifeMax: 5 }));
            }
            c.destroy();
        });

        it('supports a custom emoji', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            assert.doesNotThrow(() => c.burst({ shape: 'emoji', emoji: '*', count: 5 }));
            c.destroy();
        });

        it('supports CSS string colors', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            assert.doesNotThrow(() => c.burst({ colors: ['#ff0000', '#00ff00'], count: 5 }));
            c.destroy();
        });
    });

    describe('spray()', () => {
        it('does not throw and spawns over frames', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            c.spray({ duration: 1000, rate: 2, lifeMin: 5, lifeMax: 5 });
            pump(3);
            assert.ok(c.count > 0);
            c.destroy();
        });
    });

    describe('clear()', () => {
        it('kills all particles immediately', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            c.burst({ count: 50, lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 50);
            c.clear();
            assert.equal(c.count, 0);
            c.destroy();
        });
    });

    describe('seed()', () => {
        it('re-seeds the RNG without throwing', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            c.seed(42);
            assert.doesNotThrow(() => c.burst({ count: 1 }));
            c.destroy();
        });
    });

    describe('destroy()', () => {
        it('is idempotent', () => {
            const c = createConfetti(makeCanvas());
            c.destroy();
            assert.doesNotThrow(() => c.destroy());
        });

        it('prevents further bursts', () => {
            const c = createConfetti(makeCanvas());
            c.destroy();
            assert.doesNotThrow(() => c.burst({ count: 10 }));
            assert.equal(c.count, 0);
        });
    });

    describe('confetti() -- fire-and-forget', () => {
        it('creates an overlay and fires', () => {
            const c = confetti({ count: 10, seed: 42 });
            assert.notEqual(c, undefined);
            assert.equal(typeof c.burst, 'function');
            c.destroy();
        });
    });

    // -------------------------------------------------------------------------
    //  v1.2.0 -- presets
    // -------------------------------------------------------------------------
    describe('presets', () => {
        const KNOWN_SHAPES = new Set(['rect', 'circle', 'star', 'triangle', 'emoji']);

        it('ships the four documented presets', () => {
            assert.deepEqual(Object.keys(presets).sort(), ['cannons', 'fireworks', 'pride', 'snow']);
        });

        it('every preset shape is one the engine actually renders', () => {
            for (const [name, p] of Object.entries(presets)) {
                if (p.shape !== undefined) assert.ok(KNOWN_SHAPES.has(p.shape), name + ':' + p.shape);
            }
        });

        it('every preset has sane numeric ranges (min <= max, positive life)', () => {
            for (const [name, p] of Object.entries(presets)) {
                assert.ok(p.sizeMin <= p.sizeMax, name);
                assert.ok(p.lifeMin <= p.lifeMax, name);
                assert.ok(p.lifeMin > 0, name);
                assert.ok(p.count > 0, name);
            }
        });

        it('pride carries an OKLCH palette that colorsFromPalette accepts', () => {
            assert.equal(colorsFromPalette(presets.pride.colors).length, 6);
        });

        it('spreads into burst() without throwing', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            assert.doesNotThrow(() => c.burst({ ...presets.fireworks }));
            c.destroy();
        });

        it('a preset burst is still deterministic under a fixed seed', () => {
            const runN = () => {
                const c = createConfetti(makeCanvas(), { seed: 7 });
                c.burst({ ...presets.cannons, lifeMin: 5, lifeMax: 5 });
                pump(1);
                const n = c.count;
                c.destroy();
                return n;
            };
            assert.equal(runN(), runN());
        });
    });

    // -------------------------------------------------------------------------
    //  v1.2.0 -- colorsFromPalette
    // -------------------------------------------------------------------------
    describe('colorsFromPalette()', () => {
        const stops = [
            { color: { l: 0.6, c: 0.2, h: 20 }, stop: 0 },
            { color: { l: 0.7, c: 0.2, h: 200 }, stop: 1 },
        ];

        it('extracts colors from lite-hueforge gradient stops', () => {
            assert.deepEqual(colorsFromPalette(stops), [stops[0].color, stops[1].color]);
        });

        it('reads a { stops } wrapper', () => {
            assert.equal(colorsFromPalette({ stops }).length, 2);
        });

        it('passes a plain colors array through', () => {
            const arr = ['#fff', { l: 0.5, c: 0.1, h: 10 }];
            assert.deepEqual(colorsFromPalette(arr), arr);
        });

        it('wraps a single OKLCH object', () => {
            const one = { l: 0.5, c: 0.1, h: 10 };
            assert.deepEqual(colorsFromPalette(one), [one]);
        });

        it('never returns an empty array', () => {
            assert.ok(colorsFromPalette([]).length > 0);
            assert.ok(colorsFromPalette({ stops: [] }).length > 0);
            assert.ok(colorsFromPalette([{ notacolor: true }]).length > 0);
        });

        it('falls back to defaults on falsy / garbage input', () => {
            assert.ok(colorsFromPalette(null).length > 0);
            assert.ok(colorsFromPalette(undefined).length > 0);
            assert.ok(colorsFromPalette(42).length > 0);
        });

        it('filters invalid entries out of a stops array', () => {
            const mixed = [
                { color: { l: 0.6, c: 0.2, h: 20 } },
                { color: null },
                { color: { l: 0.7, c: 0.2, h: 200 } },
            ];
            assert.equal(colorsFromPalette(mixed).length, 2);
        });

        it('output feeds burst() without error', () => {
            const c = createConfetti(makeCanvas(), { seed: 3 });
            assert.doesNotThrow(() => c.burst({ colors: colorsFromPalette(stops), count: 10 }));
            c.destroy();
        });
    });

    // -------------------------------------------------------------------------
    //  v1.2.0 -- fromElement
    // -------------------------------------------------------------------------
    describe('fromElement()', () => {
        const el = (r) => ({ getBoundingClientRect: () => r });

        it('returns the element centre in viewport coordinates', () => {
            const o = fromElement(el({ left: 100, top: 50, width: 40, height: 20 }));
            assert.equal(o.x, 120);
            assert.equal(o.y, 60);
        });

        it('merges extra options', () => {
            const o = fromElement(el({ left: 0, top: 0, width: 10, height: 10 }), { count: 42, shape: 'star' });
            assert.equal(o.count, 42);
            assert.equal(o.shape, 'star');
        });

        it('lets an explicit x/y in extra override the computed centre', () => {
            const o = fromElement(el({ left: 0, top: 0, width: 10, height: 10 }), { x: 999, y: -1 });
            assert.equal(o.x, 999);
            assert.equal(o.y, -1);
        });

        it('warns and returns just extra on a bad element', () => {
            const { value: o, warned } = withSilencedWarn(() => fromElement(null, { count: 3 }));
            assert.deepEqual(o, { count: 3 });
            assert.ok(warned > 0);
        });
    });

    // -------------------------------------------------------------------------
    //  v1.2.0 -- pointer-follow spray
    // -------------------------------------------------------------------------
    describe('spray({ followPointer })', () => {
        it('binds no global listener on a normal spray', () => {
            const before = pointerListenerCount();
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.spray({ duration: 100, rate: 2 });
            assert.equal(pointerListenerCount(), before);
            c.destroy();
        });

        it('binds a listener only when followPointer is on, and releases it on destroy', () => {
            const before = pointerListenerCount();
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.spray({ duration: 5000, rate: 1, followPointer: true });
            assert.equal(pointerListenerCount(), before + 1);
            c.destroy();
            assert.equal(pointerListenerCount(), before);
        });

        it('stays alive without throwing after a pointer move', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.spray({ duration: 5000, rate: 1, followPointer: true });
            firePointerMove(300, 250);
            pump(2);
            assert.ok(c.count >= 0);
            c.destroy();
        });

        it('a non-following spray replays identically regardless of pointer moves', () => {
            const run = (movePointer) => {
                const c = createConfetti(makeCanvas(), { seed: 99 });
                if (movePointer) firePointerMove(400, 400);
                c.spray({ duration: 1000, rate: 3, lifeMin: 5, lifeMax: 5 });
                pump(1);
                const n = c.count;
                c.destroy();
                return n;
            };
            assert.equal(run(false), run(true));
        });

        it('reference-counts: two overlapping follow-sprays share one listener', () => {
            const before = pointerListenerCount();
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.spray({ duration: 5000, rate: 1, followPointer: true });
            c.spray({ duration: 5000, rate: 1, followPointer: true });
            assert.equal(pointerListenerCount(), before + 1);
            c.destroy();
            assert.equal(pointerListenerCount(), before);
        });
    });

    // -------------------------------------------------------------------------
    //  v1.2.1 -- emoji glyph atlas (per-particle rasterization freeze fix)
    // -------------------------------------------------------------------------
    describe('emoji rendering does not rasterize per particle', () => {
        beforeEach(() => { globalThis.__fillTextCount = 0; });

        it('rasterizes a glyph at most once when firing many emoji particles', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.burst({ shape: 'emoji', emoji: 'A', count: 100, lifeMin: 5, lifeMax: 5 });
            assert.ok(globalThis.__fillTextCount <= 1);
            c.destroy();
        });

        it('does not re-rasterize a glyph already in the atlas', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.burst({ shape: 'emoji', emoji: 'A', count: 50, lifeMin: 5, lifeMax: 5 });
            assert.equal(globalThis.__fillTextCount, 0);
            c.destroy();
        });

        it('a fresh glyph rasterizes exactly once regardless of count', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            // A fixed Private Use Area codepoint, unlikely to be primed elsewhere.
            const rare = String.fromCodePoint(0xF8123);
            c.burst({ shape: 'emoji', emoji: rare, count: 200, lifeMin: 5, lifeMax: 5 });
            assert.equal(globalThis.__fillTextCount, 1);
            globalThis.__fillTextCount = 0;
            c.burst({ shape: 'emoji', emoji: rare, count: 200, lifeMin: 5, lifeMax: 5 });
            assert.equal(globalThis.__fillTextCount, 0);
            c.destroy();
        });

        it('non-emoji shapes never touch fillText', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.burst({ shape: 'star', count: 100, lifeMin: 5, lifeMax: 5 });
            c.burst({ shape: 'circle', count: 100, lifeMin: 5, lifeMax: 5 });
            assert.equal(globalThis.__fillTextCount, 0);
            c.destroy();
        });
    });

    // -------------------------------------------------------------------------
    //  Determinism gate -- a seeded burst reproduces identical draw positions.
    // -------------------------------------------------------------------------
    describe('deterministic replay', () => {
        // Force the ticker's first frame into its dt cap (>maxDt -> 16.66ms) so the
        // dt sequence is identical no matter what pumped before this test, making the
        // committed fingerprint reproducible across test order and across processes.
        const run = () => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8 });
            pump(1, 1000); // capped first frame -> deterministic 16.66ms
            pump(29, 16);  // 29 deterministic 16ms frames
            const h = canvas.hash;
            c.destroy();
            return h;
        };

        it('same seed reproduces identical draw positions', () => {
            assert.equal(run(), run());
        });

        it('matches the committed position fingerprint', () => {
            const h = run();
            if (COMMITTED_HASH === null) {
                console.log('[determinism] position fingerprint =', h);
            } else {
                assert.equal(h, COMMITTED_HASH, 'seeded draw positions changed vs the committed baseline');
            }
        });
    });

    // -------------------------------------------------------------------------
    //  Reduced motion
    // -------------------------------------------------------------------------
    describe('reduced motion', () => {
        it('renders the static path without throwing when reduce is preferred', () => {
            setReducedMotion(true);
            try {
                const c = createConfetti(makeCanvas(), { seed: 5 });
                assert.doesNotThrow(() => c.burst({ count: 30 }));
                c.destroy();
            } finally {
                setReducedMotion(false);
            }
        });

        it('renders a custom registered shape on the static path', () => {
            setReducedMotion(true);
            try {
                const c = createConfetti(makeCanvas(), { seed: 5 });
                c.registerShape('heart', (ctx, w) => { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); });
                assert.doesNotThrow(() => c.burst({ count: 30, shape: 'heart' }));
                c.destroy();
            } finally {
                setReducedMotion(false);
            }
        });
    });

    // -------------------------------------------------------------------------
    //  registerShape() -- custom vector + image-sprite shapes (v1.3.0)
    // -------------------------------------------------------------------------
    describe('registerShape()', () => {
        const heart = (ctx, w) => { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); };

        it('assigns custom ids starting at 5 and increments', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            assert.equal(c.registerShape('heart', heart), 5);
            assert.equal(c.registerShape('hex', heart), 6);
            c.destroy();
        });

        it('re-registering a custom name keeps its id', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            const id = c.registerShape('heart', heart);
            assert.equal(c.registerShape('heart', heart), id);
            c.destroy();
        });

        it('bursts a custom vector shape and actually dispatches to its draw fn', () => {
            const c = createConfetti(makeCanvas(), { seed: 1, maxParticles: 100 });
            let calls = 0;
            c.registerShape('heart', (ctx, w) => { calls++; ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); });
            c.burst({ count: 20, shape: 'heart', lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 20);
            assert.ok(calls > 0, 'custom draw fn was never called');
            c.destroy();
        });

        it('registers an image sprite and bursts it without touching fillText', () => {
            const before = globalThis.__fillTextCount || 0;
            const c = createConfetti(makeCanvas(), { seed: 1, maxParticles: 100 });
            const id = c.registerShape('logo', { image: makeCanvas() });
            assert.ok(id >= 5);
            c.burst({ count: 20, shape: 'logo', lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 20);
            assert.equal(globalThis.__fillTextCount || 0, before, 'a sprite must blit, never fillText');
            c.destroy();
        });

        it('throws on an empty name, a built-in override, or a bad def', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            assert.throws(() => c.registerShape('', heart));
            assert.throws(() => c.registerShape('rect', heart));
            assert.throws(() => c.registerShape('emoji', heart));
            assert.throws(() => c.registerShape('x', 123));
            assert.throws(() => c.registerShape('y', {}));
            c.destroy();
        });

        it('an unknown shape name falls back to rect without throwing', () => {
            const c = createConfetti(makeCanvas(), { seed: 1, maxParticles: 100 });
            assert.doesNotThrow(() => c.burst({ count: 10, shape: 'no-such', lifeMin: 5, lifeMax: 5 }));
            pump(1);
            assert.equal(c.count, 10);
            c.destroy();
        });

        it('returns -1 after destroy() and stays inert', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.destroy();
            assert.equal(c.registerShape('heart', heart), -1);
        });

        it('is per-instance: a shape on one instance is invisible to another', () => {
            const cvB = makeCanvas({ record: true });
            const a = createConfetti(makeCanvas(), { seed: 9, maxParticles: 100 });
            const b = createConfetti(cvB, { seed: 9, maxParticles: 100 });
            a.registerShape('heart', heart);
            b.burst({ x: 400, y: 300, count: 30, shape: 'heart', lifeMin: 50, lifeMax: 50 });
            pump(1, 1000); pump(10, 16);
            const bHash = cvB.hash;
            b.destroy(); a.destroy();

            const cvR = makeCanvas({ record: true });
            const r = createConfetti(cvR, { seed: 9, maxParticles: 100 });
            r.burst({ x: 400, y: 300, count: 30, shape: 'rect', lifeMin: 50, lifeMax: 50 });
            pump(1, 1000); pump(10, 16);
            r.destroy();
            assert.equal(bHash, cvR.hash, 'instance B saw instance A\'s custom shape (registry leaked)');
        });
    });

    // -------------------------------------------------------------------------
    //  multi-shape mixing -- shapes: [] (v1.4.0, decision 0005)
    // -------------------------------------------------------------------------
    describe('multi-shape mixing (shapes: [])', () => {
        // A position fingerprint cannot tell geometry apart (a custom shape hashes like
        // rect at the same positions), so shape IDENTITY is proven with per-shape
        // dispatch counters; the fingerprint proves only stream-level determinism.
        const counter = (ref, key) => (ctx, w) => { ref[key]++; ctx.fillRect(-w / 2, -w / 2, w, w); };
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const h = canvas.hash;
            c.destroy();
            return h;
        };

        it('dispatches more than one shape across particles in a single burst', () => {
            const c = createConfetti(makeCanvas(), { seed: 7, maxParticles: 200 });
            const n = { a: 0, b: 0 };
            c.registerShape('ca', counter(n, 'a'));
            c.registerShape('cb', counter(n, 'b'));
            c.burst({ count: 60, shapes: ['ca', 'cb'], lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 60);
            assert.ok(n.a > 0, 'first mixed shape never dispatched');
            assert.ok(n.b > 0, 'second mixed shape never dispatched');
            assert.equal(n.a + n.b, 60, 'every particle dispatches exactly one shape per frame');
            c.destroy();
        });

        it('weights the mix by repetition (a 2:1 array skews toward the repeated shape)', () => {
            const c = createConfetti(makeCanvas(), { seed: 4, maxParticles: 500 });
            const n = { a: 0, b: 0 };
            c.registerShape('s', counter(n, 'a'));
            c.registerShape('o', counter(n, 'b'));
            c.burst({ count: 300, shapes: ['s', 's', 'o'], lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(n.a + n.b, 300);
            assert.ok(n.a > n.b, 'the repeated shape should dominate a 2:1 mix');
            c.destroy();
        });

        it("a single-entry mix equals the plain shape (shapes:['star'] == shape:'star')", () => {
            assert.equal(run({ shapes: ['star'] }), run({ shape: 'star' }));
            assert.equal(run({ shapes: ['rect'] }), run({ shape: 'rect' }));
        });

        it('omitting / empty / non-array shapes keeps the committed default fingerprint', () => {
            assert.equal(run({ shape: 'rect' }), COMMITTED_HASH);
            assert.equal(run({ shape: 'rect', shapes: [] }), COMMITTED_HASH);
            assert.equal(run({ shape: 'rect', shapes: null }), COMMITTED_HASH);
            assert.equal(run({ shape: 'rect', shapes: 'star' }), COMMITTED_HASH); // non-array ignored
        });

        it('all-unknown shapes fall back to the single `shape` path (fail closed)', () => {
            assert.equal(run({ shape: 'rect', shapes: ['nope', 'gone'] }), COMMITTED_HASH);
        });

        it('drops unknown names but keeps the resolvable ones', () => {
            // ['heart','nope'] -> [heart] (nope dropped) -> length 1 -> heart every particle
            const c = createConfetti(makeCanvas(), { seed: 1, maxParticles: 100 });
            const n = { a: 0 };
            c.registerShape('heart', counter(n, 'a'));
            c.burst({ count: 20, shapes: ['heart', 'nope'], lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 20);
            assert.equal(n.a, 20, 'unknown name should be dropped; heart should paint every particle');
            c.destroy();
        });

        it('matches a committed fingerprint for a canonical mixed burst', () => {
            const h = run({ shapes: ['rect', 'circle', 'star'] });
            if (MIXED_HASH === null) console.log('[mix] fingerprint =', h);
            else assert.equal(h, MIXED_HASH, 'mixed-burst positions changed vs the committed baseline');
            assert.notEqual(h, COMMITTED_HASH, 'the per-particle shape pick must shift the stream vs single-shape');
        });

        it('renders a mix on the reduced-motion static path without throwing', () => {
            setReducedMotion(true);
            try {
                const c = createConfetti(makeCanvas(), { seed: 5 });
                assert.doesNotThrow(() => c.burst({ count: 30, shapes: ['rect', 'circle', 'star'] }));
                c.destroy();
            } finally {
                setReducedMotion(false);
            }
        });

        it('spray() accepts a shapes mix too', () => {
            const c = createConfetti(makeCanvas(), { seed: 2, maxParticles: 300 });
            const n = { a: 0, b: 0 };
            c.registerShape('sa', counter(n, 'a'));
            c.registerShape('sb', counter(n, 'b'));
            c.spray({ duration: 200, rate: 10, shapes: ['sa', 'sb'], lifeMin: 5, lifeMax: 5 });
            pump(5, 16);
            assert.ok(n.a > 0 && n.b > 0, 'spray did not mix shapes');
            c.destroy();
        });
    });

    // -------------------------------------------------------------------------
    //  wind -- lateral drift (v1.5.0, decision 0006)
    // -------------------------------------------------------------------------
    describe('wind (lateral drift)', () => {
        // Same seeded rig as the determinism gate. `record` also exposes canvas.sumX --
        // the net signed sum of integer draw-X, a drift-DIRECTION probe kept out of the
        // hash. A bare fingerprint proves the windy stream is deterministic but not which
        // way it leans; sumX gives the sign.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, sumX: canvas.sumX };
            c.destroy();
            return out;
        };

        it('omitting / zero / non-finite wind keeps the committed default fingerprint', () => {
            assert.equal(run({}).hash, COMMITTED_HASH);
            assert.equal(run({ wind: 0 }).hash, COMMITTED_HASH);
            assert.equal(run({ wind: NaN }).hash, COMMITTED_HASH);       // fail closed -> 0
            assert.equal(run({ wind: Infinity }).hash, COMMITTED_HASH);  // fail closed -> 0
            assert.equal(run({ wind: 'gale' }).hash, COMMITTED_HASH);    // fail closed -> 0
        });

        it('matches a committed fingerprint for a canonical windy burst', () => {
            const { hash } = run({ wind: 300 });
            if (WIND_HASH === null) console.log('[wind] fingerprint =', hash);
            else assert.equal(hash, WIND_HASH, 'windy-burst positions changed vs the committed baseline');
            assert.notEqual(hash, COMMITTED_HASH, 'a non-zero wind must shift the stream vs no wind');
        });

        it('drifts right for positive wind, left for negative (sumX ordering)', () => {
            const right = run({ wind: 400 }).sumX;
            const still = run({ wind: 0 }).sumX;
            const left  = run({ wind: -400 }).sumX;
            assert.ok(right > still, 'positive wind should push the net draw-X right');
            assert.ok(left  < still, 'negative wind should push the net draw-X left');
        });

        it('keeps positions finite under a strong negative wind (no NaN drift)', () => {
            const canvas = makeCanvas({ assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({ count: 60, wind: -900, lifeMin: 5, lifeMax: 5 });
                pump(10, 16);
            });
            c.destroy();
        });

        it('spray() honours wind (drifts right for positive vs negative)', () => {
            const sprayDrift = (wind) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 200, rate: 10, wind, lifeMin: 5, lifeMax: 5 });
                pump(1, 1000); pump(20, 16);
                const s = canvas.sumX;
                c.destroy();
                return s;
            };
            assert.ok(sprayDrift(400) > sprayDrift(-400), 'spray wind should drift right vs left');
        });

        it('has no effect under reduced motion (static path is wind-inert)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ wind: 500 }), staticHash({ wind: 0 }));
        });
    });

    // -------------------------------------------------------------------------
    //  floor / bounce -- settle boundary (v1.6.0, decision 0007)
    // -------------------------------------------------------------------------
    describe('floor / bounce (settle boundary)', () => {
        // Same seeded rig as the wind gate (so an un-floored run reproduces COMMITTED_HASH).
        // `record` also exposes canvas.maxY -- the largest integer draw-Y, a CONTAINMENT
        // probe kept out of the hash. A bare fingerprint proves the floored stream is
        // deterministic but not that the boundary actually held; maxY gives the invariant.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, maxY: canvas.maxY };
            c.destroy();
            return out;
        };

        it('omitting / Infinity / non-finite floor keeps the committed default fingerprint', () => {
            assert.equal(run({}).hash, COMMITTED_HASH);
            assert.equal(run({ floor: Infinity }).hash, COMMITTED_HASH);   // explicit "no floor"
            assert.equal(run({ floor: NaN }).hash, COMMITTED_HASH);        // fail closed -> Infinity
            assert.equal(run({ floor: null }).hash, COMMITTED_HASH);       // fail closed -> Infinity
            assert.equal(run({ floor: 'low' }).hash, COMMITTED_HASH);      // fail closed -> Infinity
        });

        it('an unreachable floor is inert (never crosses => byte-identical stream)', () => {
            // The fall tops out at maxY == 196, so a floor at 500 is never touched.
            assert.equal(run({ floor: 500 }).hash, COMMITTED_HASH);
        });

        it('matches a committed fingerprint for a canonical floored burst', () => {
            const { hash } = run({ floor: FLOOR_Y, bounce: 0 });
            if (FLOOR_HASH === null) console.log('[floor] fingerprint =', hash);
            else assert.equal(hash, FLOOR_HASH, 'floored-burst positions changed vs the committed baseline');
            assert.notEqual(hash, COMMITTED_HASH, 'a reachable floor must shift the stream vs no floor');
        });

        it('contains every particle at or above the floor (maxY invariant)', () => {
            // The invariant a bare hash cannot see: floored <= floor, un-floored > floor.
            assert.ok(run({ floor: FLOOR_Y, bounce: 0 }).maxY <= FLOOR_Y, 'a particle escaped below the floor');
            assert.ok(run({ floor: FLOOR_Y, bounce: 0.7 }).maxY <= FLOOR_Y, 'bounce must not let a particle escape');
            assert.ok(run({}).maxY > FLOOR_Y, 'without a floor the fall should pass the line (else the test is vacuous)');
        });

        it('restitution changes the trajectory (bounce shifts the fingerprint)', () => {
            const settle = run({ floor: FLOOR_Y, bounce: 0 }).hash;
            const bouncy = run({ floor: FLOOR_Y, bounce: 0.7 }).hash;
            assert.notEqual(settle, bouncy, 'reflecting vy by restitution must change positions');
        });

        it('clamps out-of-range bounce (negative -> rest, >1 -> elastic, no runaway)', () => {
            // bounce is clamp01: -5 behaves as 0 (rest), 9 behaves as 1 (elastic).
            assert.equal(run({ floor: FLOOR_Y, bounce: -5 }).hash, run({ floor: FLOOR_Y, bounce: 0 }).hash);
            assert.equal(run({ floor: FLOOR_Y, bounce: 9 }).hash,  run({ floor: FLOOR_Y, bounce: 1 }).hash);
        });

        it('keeps positions finite under an elastic bounce + strong gravity (no NaN)', () => {
            const canvas = makeCanvas({ assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({ count: 60, floor: 50, bounce: 1, gravity: 4000, lifeMin: 5, lifeMax: 5 });
                pump(40, 16);
            });
            c.destroy();
        });

        it('spray() honours floor (contains the spray at the boundary)', () => {
            const sprayMaxY = (floor) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 200, rate: 10, floor, bounce: 0, y: 0, lifeMin: 5, lifeMax: 5 });
                pump(1, 1000); pump(60, 16); // spray rises first, then falls; give it time to cross
                const m = canvas.maxY;
                c.destroy();
                return m;
            };
            const bounded = sprayMaxY(40);
            const free = sprayMaxY(Infinity);
            assert.ok(bounded <= 40, 'spray floor did not contain the particles');
            assert.ok(free > 40, 'un-floored spray should pass the line (else the test is vacuous)');
        });

        it('has no effect under reduced motion (static path is floor-inert)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ floor: 10, bounce: 0.5 }), staticHash({}));
        });
    });

    // -------------------------------------------------------------------------
    //  walls / ceiling -- bounding box (v1.7.0, decision 0008)
    // -------------------------------------------------------------------------
    describe('walls / ceiling (bounding box)', () => {
        // Same seeded rig as the floor gate (an un-boxed run reproduces COMMITTED_HASH). The
        // record canvas also exposes minX/maxX/minY -- the X/Y-min CONTAINMENT probes kept out
        // of the hash, the box analogs of maxY: they prove each edge actually held, which a
        // bare fingerprint cannot.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = {
                hash: canvas.hash,
                minX: canvas.minX, maxX: canvas.maxX,
                minY: canvas.minY, maxY: canvas.maxY,
            };
            c.destroy();
            return out;
        };

        it('omitting / infinity / non-finite edges keep the committed default fingerprint', () => {
            assert.equal(run({}).hash, COMMITTED_HASH);
            // Each edge at its explicit "off" sentinel.
            assert.equal(run({ wallLeft: -Infinity }).hash, COMMITTED_HASH);
            assert.equal(run({ wallRight: Infinity }).hash, COMMITTED_HASH);
            assert.equal(run({ ceiling: -Infinity }).hash, COMMITTED_HASH);
            // Each edge fails closed on garbage -> its "off" sentinel (num coercion).
            assert.equal(run({ wallLeft: NaN, wallRight: NaN, ceiling: NaN }).hash, COMMITTED_HASH);
            assert.equal(run({ wallLeft: null, wallRight: null, ceiling: null }).hash, COMMITTED_HASH);
            assert.equal(run({ wallLeft: 'l', wallRight: 'r', ceiling: 'c' }).hash, COMMITTED_HASH);
            // A wrong-signed infinity can never turn an edge ON in the wrong direction.
            assert.equal(run({ wallLeft: Infinity, wallRight: -Infinity, ceiling: Infinity }).hash, COMMITTED_HASH);
        });

        it('a box entirely outside the spread is inert (never crossed => byte-identical)', () => {
            // The seed-12345 burst lives in x[249,540] y[43,196]; this box encloses it loosely.
            assert.equal(run({ wallLeft: -1000, wallRight: 2000, ceiling: -1000, floor: 2000 }).hash, COMMITTED_HASH);
        });

        it('matches a committed fingerprint for a canonical boxed burst', () => {
            const { hash } = run({ ...BOX, bounce: 0 });
            if (BOX_HASH === null) console.log('[box] fingerprint =', hash);
            else assert.equal(hash, BOX_HASH, 'boxed-burst positions changed vs the committed baseline');
            assert.notEqual(hash, COMMITTED_HASH, 'a reachable box must shift the stream vs no box');
            assert.notEqual(hash, FLOOR_HASH, 'a full box must differ from a floor-only burst');
        });

        it('contains every particle inside all four edges (minX/maxX/minY/maxY invariant)', () => {
            // The invariant a bare hash cannot see: boxed within every edge, un-boxed breaches each.
            const boxed = run({ ...BOX, bounce: 0 });
            assert.ok(boxed.minX >= BOX.wallLeft,  'a particle escaped left of wallLeft');
            assert.ok(boxed.maxX <= BOX.wallRight, 'a particle escaped right of wallRight');
            assert.ok(boxed.minY >= BOX.ceiling,   'a particle escaped above the ceiling');
            assert.ok(boxed.maxY <= BOX.floor,     'a particle escaped below the floor');
            // A bounced box (energy-adding would breach) still contains.
            const bouncy = run({ ...BOX, bounce: 0.7 });
            assert.ok(bouncy.minX >= BOX.wallLeft && bouncy.maxX <= BOX.wallRight, 'bounce let a particle through a wall');
            assert.ok(bouncy.minY >= BOX.ceiling && bouncy.maxY <= BOX.floor, 'bounce let a particle through floor/ceiling');
            // Non-vacuous: without the box, the same seed breaches every edge.
            const free = run({});
            assert.ok(free.minX < BOX.wallLeft,  'un-boxed run should pass wallLeft (else vacuous)');
            assert.ok(free.maxX > BOX.wallRight, 'un-boxed run should pass wallRight (else vacuous)');
            assert.ok(free.minY < BOX.ceiling,   'un-boxed run should pass the ceiling (else vacuous)');
            assert.ok(free.maxY > BOX.floor,     'un-boxed run should pass the floor (else vacuous)');
        });

        it('the ceiling alone catches the upward launch (no floor pinning it)', () => {
            // With no floor, particles launch up and are the only thing the ceiling can catch;
            // this proves the ceiling edge fires on its own, not merely via the floor clamp.
            const CEIL = 80;
            assert.ok(run({ ceiling: CEIL }).minY >= CEIL, 'ceiling did not contain the upward launch');
            assert.ok(run({}).minY < CEIL, 'un-ceilinged launch should rise past the line (else vacuous)');
        });

        it('restitution changes the trajectory (bounce shifts the boxed fingerprint)', () => {
            assert.notEqual(run({ ...BOX, bounce: 0 }).hash, run({ ...BOX, bounce: 0.7 }).hash);
        });

        it('keeps positions finite AND contained in a tight box (bounce 1 + wind + gravity)', () => {
            // Elastic walls + strong lateral wind + strong gravity: an energy leak would either
            // NaN out or escape the box. assertFinite catches the NaN; the clamp catches escape.
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 5, lifeMax: 5,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350,
                    bounce: 1, wind: 3000, gravity: 4000,
                });
                pump(1, 1000); pump(80, 16);
            });
            assert.ok(canvas.minX >= 350 && canvas.maxX <= 450, 'an elastic particle escaped a wall');
            assert.ok(canvas.minY >= 250 && canvas.maxY <= 350, 'an elastic particle escaped floor/ceiling');
            c.destroy();
        });

        it('spray() honours the walls (contains the spray between them)', () => {
            const sprayX = (wall) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 200, rate: 10, x: 400, y: 300, spread: 2.0, lifeMin: 5, lifeMax: 5, ...wall });
                pump(1, 1000); pump(60, 16);
                const out = { minX: canvas.minX, maxX: canvas.maxX };
                c.destroy();
                return out;
            };
            const bounded = sprayX({ wallLeft: 360, wallRight: 440 });
            const free = sprayX({});
            assert.ok(bounded.minX >= 360 && bounded.maxX <= 440, 'spray walls did not contain the stream');
            assert.ok(free.minX < 360 || free.maxX > 440, 'un-walled spray should pass a wall (else vacuous)');
        });

        it('has no effect under reduced motion (static path is box-inert)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ wallLeft: 10, wallRight: 20, ceiling: 5, bounce: 0.5 }), staticHash({}));
        });
    });

    // -------------------------------------------------------------------------
    //  turbulence / gust -- living air (v1.8.0)
    // -------------------------------------------------------------------------
    describe('turbulence / gust (living air)', () => {
        // Same seeded rig as the floor/box gates (an un-forced run reproduces COMMITTED_HASH).
        // The record canvas also exposes sumX (drift-direction sum) and minX/maxX (extent) --
        // turbulence FANS the pool (wider extent), gust PUSHES it (displaced sumX); neither is
        // visible to a bare fingerprint, so both are asserted directly.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = {
                hash: canvas.hash, sumX: canvas.sumX,
                minX: canvas.minX, maxX: canvas.maxX, spread: canvas.maxX - canvas.minX,
            };
            c.destroy();
            return out;
        };

        it('omitting / zero / non-finite forces keep the committed default fingerprint', () => {
            assert.equal(run({}).hash, COMMITTED_HASH);
            assert.equal(run({ turbulence: 0 }).hash, COMMITTED_HASH);
            assert.equal(run({ gust: 0 }).hash, COMMITTED_HASH);
            assert.equal(run({ turbulence: 0, gust: 0 }).hash, COMMITTED_HASH);
            // Fail closed on garbage -> 0 (num coercion), for each knob.
            assert.equal(run({ turbulence: NaN, gust: NaN }).hash, COMMITTED_HASH);
            assert.equal(run({ turbulence: null, gust: null }).hash, COMMITTED_HASH);
            assert.equal(run({ turbulence: 't', gust: 'g' }).hash, COMMITTED_HASH);
        });

        it('leaves the floor-only and box fingerprints byte-identical (new guards never fire)', () => {
            // The v1.8.0 blocks must not perturb any prior committed stream. Re-assert both.
            const floorHash = run({ floor: FLOOR_Y }).hash;
            if (FLOOR_HASH !== null) assert.equal(floorHash, FLOOR_HASH, 'floor-only fingerprint drifted');
            assert.equal(run({ ...BOX, bounce: 0 }).hash, BOX_HASH, 'box fingerprint drifted');
        });

        it('matches committed fingerprints for turbulence, gust, and both (deterministic, distinct)', () => {
            const t = run({ turbulence: 500 });
            const g = run({ gust: 400 });
            const b = run({ turbulence: 500, gust: 400 });
            if (TURB_HASH === null) console.log('[turb] fingerprint =', t.hash);
            else assert.equal(t.hash, TURB_HASH, 'turbulence stream changed vs the committed baseline');
            if (GUST_HASH === null) console.log('[gust] fingerprint =', g.hash);
            else assert.equal(g.hash, GUST_HASH, 'gust stream changed vs the committed baseline');
            if (TURBGUST_HASH === null) console.log('[turbgust] fingerprint =', b.hash);
            else assert.equal(b.hash, TURBGUST_HASH, 'combined stream changed vs the committed baseline');
            // Each force perturbs, and the three are mutually distinct and distinct from calm.
            const hashes = new Set([COMMITTED_HASH, t.hash, g.hash, b.hash]);
            assert.equal(hashes.size, 4, 'turbulence/gust/both must each shift the stream distinctly');
            // Deterministic replay: no rng means same seed -> same hash on a second run.
            assert.equal(run({ turbulence: 500 }).hash, t.hash, 'turbulence is not deterministic on replay');
            assert.equal(run({ turbulence: 500, gust: 400 }).hash, b.hash, 'combined is not deterministic on replay');
        });

        it('turbulence fans the pool wider; gust displaces it sideways (non-vacuous)', () => {
            const plain = run({});
            const t = run({ turbulence: 500 });
            const g = run({ gust: 400 });
            // Turbulence: decorrelated per-particle wander => a strictly wider x-extent.
            assert.ok(t.spread > plain.spread, 'turbulence did not widen the pool (else vacuous)');
            // Gust: a coherent horizontal push => a materially displaced summed x.
            assert.ok(Math.abs(g.sumX - plain.sumX) > 1000, 'gust did not displace the pool (else vacuous)');
        });

        it('keeps positions finite under strong turbulence + gust + wind + gravity in a box', () => {
            // Time-varying accels layered on wind/gravity inside an elastic box: an energy leak
            // would NaN out or escape. assertFinite catches NaN; the clamp catches escape.
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 5, lifeMax: 5,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350,
                    bounce: 1, wind: 2000, gravity: 4000, turbulence: 3000, gust: 2500,
                });
                pump(1, 1000); pump(80, 16);
            });
            assert.ok(canvas.minX >= 350 && canvas.maxX <= 450, 'a particle escaped a wall under turbulence/gust');
            c.destroy();
        });

        it('spray() honours turbulence + gust (deterministic, perturbing stream)', () => {
            const sprayRun = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 200, rate: 10, x: 400, y: 300, spread: 2.0, lifeMin: 5, lifeMax: 5, ...opts });
                pump(1, 1000); pump(60, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            };
            const calm = sprayRun({});
            assert.equal(sprayRun({}), calm, 'calm spray not deterministic');
            assert.notEqual(sprayRun({ turbulence: 400, gust: 300 }), calm, 'spray ignored turbulence/gust');
            assert.equal(sprayRun({ turbulence: 400, gust: 300 }), sprayRun({ turbulence: 400, gust: 300 }), 'forced spray not deterministic');
        });

        it('has no effect under reduced motion (static path has no velocity to perturb)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ turbulence: 800, gust: 600 }), staticHash({}));
        });
    });

    // -------------------------------------------------------------------------
    //  trails / ribbons -- the first RENDER-path feature (v1.9.0, decision 0010)
    // -------------------------------------------------------------------------
    describe('trails / ribbons', () => {
        // Same seed-12345 rig as the box/turbulence gates -- a trail-less run therefore reproduces
        // COMMITTED_HASH. `trail` is a CONSTRUCTION option (the ring buffer must be sized once), so
        // it is passed to createConfetti; a per-burst `trail` overrides the draw length. The record
        // canvas exposes strokeHash + strokes (trail-only, kept OUT of the position hash), so we can
        // prove the ribbon geometry is deterministic AND that the physics hash is untouched.
        const run = (ctorOpts = {}, burstOpts = {}) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345, ...ctorOpts });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...burstOpts });
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, strokeHash: canvas.strokeHash, strokes: canvas.strokes };
            c.destroy();
            return out;
        };

        it('is off by default: no strokes, position hash byte-identical', () => {
            const off = run({});
            assert.equal(off.strokes, 0, 'a default instance must not stroke any trail');
            assert.equal(off.strokeHash, 0, 'no strokes => empty trail-geometry hash');
            assert.equal(off.hash, COMMITTED_HASH, 'the default position fingerprint drifted');
            // Explicit trail: 0 is identical to omitting it.
            const zero = run({ trail: 0 });
            assert.equal(zero.strokes, 0);
            assert.equal(zero.hash, COMMITTED_HASH);
        });

        it('is a PURE OVERLAY: trails on leaves every committed physics fingerprint intact', () => {
            // The headline property. Trails draw via stroke() in world space (never translate),
            // so the position hash cannot move -- at any depth, for any physics.
            assert.equal(run({ trail: 10 }).hash, COMMITTED_HASH, 'trails perturbed the default stream');
            assert.equal(run({ trail: 64 }).hash, COMMITTED_HASH, 'max-depth trails perturbed the stream');
            // Re-assert the floor-only and box fingerprints with trails on -- unchanged.
            assert.equal(run({ trail: 10 }, { floor: FLOOR_Y }).hash, FLOOR_HASH, 'floor fingerprint drifted under trails');
            assert.equal(run({ trail: 10 }, { ...BOX, bounce: 0 }).hash, BOX_HASH, 'box fingerprint drifted under trails');
        });

        it('fails closed on a garbage / over-large construction trail', () => {
            // Non-finite / negative capacity => off (0); no buffers, no strokes, hash intact.
            for (const bad of [NaN, -5, Infinity, 'x', null]) {
                const r = run({ trail: bad });
                assert.equal(r.strokes, 0, `trail:${String(bad)} should disable trails`);
                assert.equal(r.hash, COMMITTED_HASH);
            }
            // Absurd depth is capped at TRAIL_MAX (64), not honoured literally -- no huge alloc,
            // no throw, and it still strokes (feature on).
            const huge = run({ trail: 1e9 });
            assert.ok(huge.strokes > 0, 'a capped-but-positive trail should still stroke');
            assert.equal(huge.hash, COMMITTED_HASH);
            // trail: 1e9 clamps to 64, so it must equal an explicit trail: 64.
            assert.equal(huge.strokeHash, run({ trail: 64 }).strokeHash, 'over-large trail did not clamp to TRAIL_MAX');
        });

        it('matches the committed trail-geometry fingerprint (non-vacuous, deterministic)', () => {
            const t = run({ trail: 10 });
            assert.ok(t.strokes > 0, 'trails on must stroke at least one ribbon (else vacuous)');
            if (TRAIL_HASH === null) console.log('[trail] geometry fingerprint =', t.strokeHash);
            else assert.equal(t.strokeHash, TRAIL_HASH, 'trail geometry changed vs the committed baseline');
            // Deterministic replay: the ring buffer + global head are a pure function of the seed.
            assert.equal(run({ trail: 10 }).strokeHash, t.strokeHash, 'trail geometry not deterministic on replay');
            // Depth changes the geometry: a shallower ring strokes a different (shorter) ribbon.
            assert.notEqual(run({ trail: 4 }).strokeHash, t.strokeHash, 'trail depth 4 vs 10 must differ');
        });

        it('honours a per-burst trail override (0 opts out; a shorter length changes geometry)', () => {
            // A trail-capable instance trails by default; burst({ trail: 0 }) silences one burst.
            const out = run({ trail: 10 }, { trail: 0 });
            assert.equal(out.strokes, 0, 'per-burst trail: 0 did not opt the burst out');
            assert.equal(out.hash, COMMITTED_HASH);
            // A per-burst length below capacity draws a different (shorter) ribbon than the default,
            // and matches a construction instance built at that same capacity (same max samples).
            const perBurst4 = run({ trail: 10 }, { trail: 4 });
            assert.ok(perBurst4.strokes > 0, 'per-burst trail: 4 should still stroke');
            assert.notEqual(perBurst4.strokeHash, run({ trail: 10 }).strokeHash, 'per-burst 4 must differ from default 10');
            assert.equal(perBurst4.strokeHash, run({ trail: 4 }).strokeHash, 'per-burst 4 should match construction cap 4');
        });

        it('ignores a per-burst trail on a trail-less instance (fail closed, no throw)', () => {
            // No construction budget => no buffer => the option is silently inert.
            const r = run({}, { trail: 10 });
            assert.equal(r.strokes, 0, 'trail on a budget-less instance must not stroke');
            assert.equal(r.hash, COMMITTED_HASH);
        });

        it('keeps every drawn position finite under trails + strong forces in a tight box', () => {
            // Trail points are copies of the finite body positions; assertFinite also guards the
            // stroked path points. A leak would NaN out; the box clamp still contains the bodies.
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3, trail: 16 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 5, lifeMax: 5,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350,
                    bounce: 1, wind: 2000, gravity: 4000, turbulence: 3000, gust: 2500,
                });
                pump(1, 1000); pump(80, 16);
            });
            assert.ok(canvas.strokes > 0, 'the finite-under-forces rig should actually draw trails');
            assert.ok(canvas.minX >= 350 && canvas.maxX <= 450, 'a body escaped a wall under trails + forces');
            c.destroy();
        });

        it('spray() honours trails (deterministic ribbon geometry)', () => {
            const sprayRun = (ctorOpts, sprayOpts = {}) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9, ...ctorOpts });
                c.spray({ duration: 200, rate: 10, x: 400, y: 300, spread: 2.0, lifeMin: 5, lifeMax: 5, ...sprayOpts });
                pump(1, 1000); pump(60, 16);
                const out = { strokes: canvas.strokes, strokeHash: canvas.strokeHash };
                c.destroy();
                return out;
            };
            assert.equal(sprayRun({}).strokes, 0, 'a trail-less spray must not stroke');
            const trailed = sprayRun({ trail: 12 });
            assert.ok(trailed.strokes > 0, 'spray ignored the trail budget');
            assert.equal(sprayRun({ trail: 12 }).strokeHash, trailed.strokeHash, 'sprayed trail geometry not deterministic');
        });

        it('has no effect under reduced motion (static path records no history)', () => {
            setReducedMotion(true);
            try {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 5, trail: 16 });
                c.burst({ count: 30, trail: 16 });
                assert.equal(canvas.strokes, 0, 'reduced-motion static render must not draw trails');
                c.destroy();
            } finally {
                setReducedMotion(false);
            }
        });
    });

    // -------------------------------------------------------------------------
    //  vortex / attractor -- a directed point force (v1.10.0, decision 0011)
    // -------------------------------------------------------------------------
    describe('vortex / attractor', () => {
        // Same seed-12345 rig as the force gates (a plain run reproduces COMMITTED_HASH). The record
        // canvas's extent (maxX-minX, maxY-minY) captures the convergence a bare hash cannot see:
        // a PULL collapses the pool, a REPEL expands it. The burst here centers at (400,198), so a
        // bare `attract` (center defaults to the burst origin) pulls toward that point.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = {
                hash: canvas.hash,
                spreadX: canvas.maxX - canvas.minX, spreadY: canvas.maxY - canvas.minY,
                cx: (canvas.minX + canvas.maxX) / 2,
            };
            c.destroy();
            return out;
        };

        it('omitting / zero / non-finite knobs keep the committed default fingerprint', () => {
            assert.equal(run({}).hash, COMMITTED_HASH);
            assert.equal(run({ attract: 0, swirl: 0 }).hash, COMMITTED_HASH);
            // Fail closed on garbage -> 0 (num), for each knob (incl. the center).
            assert.equal(run({ attract: NaN, swirl: NaN }).hash, COMMITTED_HASH);
            assert.equal(run({ attract: null, swirl: 'x' }).hash, COMMITTED_HASH);
            assert.equal(run({ attract: Infinity, swirl: -Infinity }).hash, COMMITTED_HASH);
            // A center with no strength never fires the branch either.
            assert.equal(run({ attractX: 10, attractY: 20 }).hash, COMMITTED_HASH);
        });

        it('leaves the floor-only and box fingerprints byte-identical (new guard never fires)', () => {
            assert.equal(run({ floor: FLOOR_Y }).hash, FLOOR_HASH, 'floor-only fingerprint drifted');
            assert.equal(run({ ...BOX, bounce: 0 }).hash, BOX_HASH, 'box fingerprint drifted');
        });

        it('matches committed fingerprints for attract, swirl, and both (deterministic, distinct)', () => {
            const a = run({ attract: 6 });
            const s = run({ swirl: 6 });
            const b = run({ attract: 6, swirl: 6 });
            if (ATTRACT_HASH === null) console.log('[attract] fingerprint =', a.hash);
            else assert.equal(a.hash, ATTRACT_HASH, 'attract stream changed vs the committed baseline');
            if (SWIRL_HASH === null) console.log('[swirl] fingerprint =', s.hash);
            else assert.equal(s.hash, SWIRL_HASH, 'swirl stream changed vs the committed baseline');
            if (VORTEX_HASH === null) console.log('[vortex] fingerprint =', b.hash);
            else assert.equal(b.hash, VORTEX_HASH, 'combined stream changed vs the committed baseline');
            // Each perturbs, and the three are mutually distinct and distinct from plain.
            assert.equal(new Set([COMMITTED_HASH, a.hash, s.hash, b.hash]).size, 4,
                'attract/swirl/both must each shift the stream distinctly');
            // Deterministic replay: no rng, so same seed -> same hash on a second run.
            assert.equal(run({ attract: 6 }).hash, a.hash, 'attract is not deterministic on replay');
            assert.equal(run({ attract: 6, swirl: 6 }).hash, b.hash, 'combined is not deterministic on replay');
        });

        it('attract CONVERGES the pool; repel EXPANDS it (non-vacuous, directional)', () => {
            const plain = run({});
            const pull = run({ attract: 6 });
            const push = run({ attract: -6 });
            // A pull collapses the pool toward the center -> strictly smaller extent than plain.
            assert.ok(pull.spreadX < plain.spreadX, 'attract did not converge the pool in x (else vacuous)');
            assert.ok(pull.spreadY < plain.spreadY, 'attract did not converge the pool in y');
            // A repel (negative attract) blows it apart -> strictly larger extent.
            assert.ok(push.spreadX > plain.spreadX, 'repel did not expand the pool (else vacuous)');
        });

        it('swirl is directional: +swirl and -swirl diverge (spin sign is real)', () => {
            assert.notEqual(run({ swirl: 6 }).hash, run({ swirl: -6 }).hash,
                'swirl sign made no difference -- the tangential term is not directional');
            // A pure swirl orbits (roughly conserves radial extent), so it must NOT collapse the
            // pool the way attract does -- it is a distinct effect, not a weak attractor.
            const plain = run({});
            const swirl = run({ swirl: 6 });
            assert.ok(swirl.spreadX > plain.spreadX * 0.8,
                'a pure swirl should orbit, not collapse the pool like attract');
        });

        it('honours a custom attractX/attractY (pulls toward that point, not the origin)', () => {
            // The burst origin is x~400; pulling toward x=600 must shift the pool's center right.
            const plain = run({});
            const off = run({ attract: 6, attractX: 600, attractY: 100 });
            assert.ok(off.cx > plain.cx + 20, 'a custom attractX did not pull the pool toward it');
        });

        it('keeps positions finite AND contained under strong attract + swirl in a box', () => {
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 5, lifeMax: 5,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350,
                    bounce: 1, wind: 2000, gravity: 4000, attract: 40, swirl: 30,
                });
                pump(1, 1000); pump(80, 16);
            });
            assert.ok(canvas.minX >= 350 && canvas.maxX <= 450, 'a particle escaped a wall under the vortex');
            c.destroy();
        });

        it('a strong repeller stays finite over its life (the accel cap holds)', () => {
            // A negative attract is an unstable anti-spring; without the VORTEX_MAX_ACCEL cap it
            // could drive a position to Infinity. assertFinite makes any non-finite draw a throw.
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 7 });
            assert.doesNotThrow(() => {
                c.burst({ x: 400, y: 300, count: 60, attract: -400, lifeMin: 0.4, lifeMax: 0.4 });
                pump(1, 1000); for (let f = 0; f < 40; f++) pump(1, 50);
            });
            assert.equal(c.count, 0, 'the repeller pool did not drain within its life');
            c.destroy();
        });

        it('spray() honours the vortex (deterministic, perturbing stream)', () => {
            const sprayRun = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 200, rate: 10, x: 400, y: 300, spread: 2.0, lifeMin: 5, lifeMax: 5, ...opts });
                pump(1, 1000); pump(60, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            };
            const calm = sprayRun({});
            assert.equal(sprayRun({}), calm, 'calm spray not deterministic');
            assert.notEqual(sprayRun({ attract: 8, swirl: 5 }), calm, 'spray ignored the vortex');
            assert.equal(sprayRun({ attract: 8, swirl: 5 }), sprayRun({ attract: 8, swirl: 5 }), 'vortex spray not deterministic');
        });

        it('has no effect under reduced motion (static path has no velocity to perturb)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ attract: 10, swirl: 8 }), staticHash({}));
        });
    });

    // -------------------------------------------------------------------------
    //  settle / pile -- the first BEHAVIOUR (lifecycle) feature (v1.11.0, decision 0012)
    // -------------------------------------------------------------------------
    describe('settle / pile', () => {
        // Two rigs. `runStd` is the shared seed-12345 force rig (a plain run reproduces
        // COMMITTED_HASH), used to prove the new physics-freeze wrap + settle guard perturb NOTHING
        // when settle is off. `runSettle` is a settle-friendly rig -- a burst that falls onto a
        // floor BELOW it and bounces (bounce 0.5), so `settle` has a real bounce-then-rest dynamic
        // to freeze; the record canvas's maxX-minX (extent) captures the "arrests lateral drift"
        // and "pile stops growing" a bare hash cannot see, and maxY captures floor CONTAINMENT.
        const runStd = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const h = canvas.hash;
            c.destroy();
            return h;
        };
        const runSettle = (opts, frames = 150) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ x: 400, y: 150, count: 120, shape: 'rect', lifeMin: 15, lifeMax: 15, spread: 1.8,
                speed: 300, gravity: 900, floor: 360, bounce: 0.5, ...opts });
            pump(1, 1000); pump(frames, 16);
            const out = { hash: canvas.hash, spreadX: canvas.maxX - canvas.minX, maxY: canvas.maxY };
            c.destroy();
            return out;
        };

        it('leaves the default / floor / box fingerprints byte-identical (freeze wrap + guard never fire)', () => {
            // With settle off, `landed` is always 0, so the `if (!landed)` wrap always runs and the
            // settle branch never fires -- every prior committed stream must be untouched.
            assert.equal(runStd({}), COMMITTED_HASH, 'the physics-freeze wrap perturbed the default stream');
            assert.equal(runStd({ floor: FLOOR_Y }), FLOOR_HASH, 'floor-only fingerprint drifted');
            assert.equal(runStd({ ...BOX, bounce: 0 }), BOX_HASH, 'box fingerprint drifted');
        });

        it('omitting / zero / non-finite settle is a no-op vs the same bouncy run (opt-in, fail-closed)', () => {
            const bouncy = runSettle({}).hash;   // floor + bounce 0.5, no settle
            assert.equal(runSettle({ settle: 0 }).hash, bouncy);
            assert.equal(runSettle({ settle: NaN }).hash, bouncy);     // nonneg -> 0
            assert.equal(runSettle({ settle: null }).hash, bouncy);    // nonneg -> 0
            assert.equal(runSettle({ settle: -5 }).hash, bouncy);      // negative -> 0
            assert.equal(runSettle({ settle: 'x' }).hash, bouncy);     // string -> 0
        });

        it('matches the committed settle fingerprint (deterministic, distinct from bouncy)', () => {
            const bouncy = runSettle({}).hash;
            const settled = runSettle({ settle: 80 });
            if (SETTLE_HASH === null) console.log('[settle] fingerprint =', settled.hash);
            else assert.equal(settled.hash, SETTLE_HASH, 'settle stream changed vs the committed baseline');
            assert.notEqual(settled.hash, bouncy, 'settle did not change the stream (else vacuous)');
            // Zero rng: same seed -> same hash on replay.
            assert.equal(runSettle({ settle: 80 }).hash, settled.hash, 'settle is not deterministic on replay');
        });

        it('arrests lateral drift: a settled pool spreads less than a still-sliding one (non-vacuous)', () => {
            // With a wind, a floored-but-not-settled piece keeps sliding along the floor; a settled
            // piece freezes on landing. So settle strictly narrows the pool's x-extent.
            const sliding = runSettle({ wind: 800 }).spreadX;
            const piled = runSettle({ wind: 800, settle: 80 }).spreadX;
            assert.ok(piled < sliding, 'settle did not arrest lateral drift (else vacuous)');
        });

        it('the pile stops growing while an un-settled pool keeps sliding (comes to rest)', () => {
            // Long life (no deaths in the window) + a steady wind. A settled pool's extent is FROZEN
            // between two late snapshots (every piece at rest); an un-settled pool's keeps growing as
            // pieces slide down-wind forever. This is the "it actually comes to rest" proof.
            const settleEarly = runSettle({ wind: 600, settle: 80 }, 250).spreadX;
            const settleLate = runSettle({ wind: 600, settle: 80 }, 450).spreadX;
            assert.equal(settleLate, settleEarly, 'the settled pile kept moving (did not come to rest)');
            const slideEarly = runSettle({ wind: 600 }, 250).spreadX;
            const slideLate = runSettle({ wind: 600 }, 450).spreadX;
            assert.ok(slideLate > slideEarly + 100, 'the un-settled pool should keep sliding (else vacuous)');
        });

        it('piles AT the floor, and needs a floor to settle (contained, non-vacuous)', () => {
            const FLOOR2 = 360;
            assert.equal(runSettle({ settle: 80 }).maxY, FLOOR2, 'settled pieces did not come to rest on the floor');
            assert.ok(runSettle({ floor: Infinity, settle: 80 }).maxY > FLOOR2,
                'with no floor nothing should settle -- the fall must overshoot (else vacuous)');
        });

        it('keeps positions finite AND contained under settle + sway + wind + gravity in a box', () => {
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 5, lifeMax: 5,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350,
                    bounce: 0.6, wind: 2000, gravity: 4000, sway: 1, settle: 90,
                });
                pump(1, 1000); pump(80, 16);
            });
            assert.ok(canvas.minX >= 350 && canvas.maxX <= 450, 'a piece escaped a wall while settling');
            assert.ok(canvas.maxY <= 350, 'a settled piece sank below the floor');
            c.destroy();
        });

        it('spray() honours settle (deterministic, perturbing stream)', () => {
            const sprayRun = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 600, rate: 20, x: 400, y: 150, spread: 1.8, lifeMin: 8, lifeMax: 8,
                    speed: 300, gravity: 900, floor: 360, bounce: 0.5, ...opts });
                pump(1, 1000); pump(150, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            };
            const bouncy = sprayRun({});
            assert.equal(sprayRun({}), bouncy, 'bouncy spray not deterministic');
            assert.notEqual(sprayRun({ settle: 80 }), bouncy, 'spray ignored settle');
            assert.equal(sprayRun({ settle: 80 }), sprayRun({ settle: 80 }), 'settle spray not deterministic');
        });

        it('has no effect under reduced motion (static path never integrates, so nothing lands)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, floor: 200, bounce: 0.5, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ settle: 80 }), staticHash({}));
        });
    });

    // -------------------------------------------------------------------------
    //  flutter / sway (v1.3.0)
    // -------------------------------------------------------------------------
    describe('flutter / sway', () => {
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 2024 });
            c.burst({ x: 400, y: 300, count: 80, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const h = canvas.hash;
            c.destroy();
            return h;
        };

        it('flutter is hash-neutral: it changes scale, never position', () => {
            assert.equal(run({ flutter: 1 }), run({ flutter: 0 }));
            assert.equal(run({ flutter: 1 }), run({ flutter: 0.37 }));
        });

        it('sway moves positions (sway 0 vs 0.8 diverge)', () => {
            assert.notEqual(run({ sway: 0 }), run({ sway: 0.8 }));
        });

        it('default (flutter 1, sway 0) leaves positions identical to omitting them', () => {
            assert.equal(run({}), run({ flutter: 1, sway: 0 }));
        });

        it('non-finite flutter/sway are clamped, never producing a non-finite position', () => {
            const canvas = makeCanvas({ assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({ count: 40, flutter: NaN, sway: Infinity, lifeMin: 5, lifeMax: 5 });
                pump(5, 16);
            });
            c.destroy();
        });
    });

    // -------------------------------------------------------------------------
    //  input validation + count/destroy consistency (v1.3.1, decision 0004)
    // -------------------------------------------------------------------------
    describe('fail-closed input validation', () => {
        // A recording+assertFinite canvas turns any leaked non-finite draw position into
        // a hard throw, so "doesNotThrow" here also proves positions stayed finite.
        const bad = {
            'speed:NaN': { speed: NaN },
            'gravity:Infinity': { gravity: Infinity },
            'angle:NaN': { angle: NaN },
            'drag:NaN': { drag: NaN },
            'spread:-Infinity': { spread: -Infinity },
            'sizeMin/Max:NaN': { sizeMin: NaN, sizeMax: NaN },
            'x/y:NaN': { x: NaN, y: NaN },
            'colors:null': { colors: null },
            'colors:[] empty': { colors: [] },
            'count:NaN': { count: NaN },
        };
        for (const [label, opts] of Object.entries(bad)) {
            it(`coerces ${label} without throwing or drawing a non-finite position`, () => {
                const c = createConfetti(makeCanvas({ assertFinite: true }), { seed: 3, maxParticles: 128 });
                assert.doesNotThrow(() => {
                    c.burst({ count: 40, lifeMin: 0.3, lifeMax: 0.3, ...opts });
                    pump(6, 16);
                });
                assert.ok(c.count >= 0 && c.count <= 128, `count ${c.count} out of range`);
                c.destroy();
            });
        }

        it('coerces a non-finite lifeMax so the particle is NOT immortal (bug fixed)', () => {
            const c = createConfetti(makeCanvas(), { seed: 5, maxParticles: 128 });
            c.burst({ count: 50, lifeMin: NaN, lifeMax: NaN }); // -> default life, must expire
            pump(1, 16);
            assert.equal(c.count, 50);
            for (let f = 0; f < 90; f++) pump(1, 50); // default life <= 3.0s
            assert.equal(c.count, 0, 'a NaN-life particle never died');
            c.destroy();
        });

        it('clamps drag into [0,1] (drag:2 must not amplify velocity to Infinity)', () => {
            const c = createConfetti(makeCanvas({ assertFinite: true }), { seed: 6, maxParticles: 128 });
            assert.doesNotThrow(() => {
                c.burst({ count: 40, drag: 2, lifeMin: 5, lifeMax: 5 });
                for (let f = 0; f < 60; f++) pump(1, 16);
            });
            c.destroy();
        });

        it('sanitises spray() options too (duration/rate/physics)', () => {
            const c = createConfetti(makeCanvas({ assertFinite: true }), { seed: 7, maxParticles: 128 });
            assert.doesNotThrow(() => {
                c.spray({ duration: NaN, rate: NaN, speed: NaN, gravity: Infinity, colors: null });
                pump(10, 16);
            });
            assert.ok(c.count >= 0 && c.count <= 128);
            c.destroy();
        });

        it('preserves the committed fingerprint (defaults are already in range)', () => {
            // Identical to the deterministic-replay run: validation must be a no-op for
            // in-range defaults, so the committed hash still reproduces post-sanitisation.
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8 });
            pump(1, 1000); pump(29, 16);
            const h = canvas.hash;
            c.destroy();
            assert.equal(h, COMMITTED_HASH, 'validation moved the seeded output');
        });
    });

    describe('count / destroy consistency', () => {
        it('destroy() zeroes count (no stale-count)', () => {
            const c = createConfetti(makeCanvas(), { seed: 4, maxParticles: 128 });
            c.burst({ count: 60, lifeMin: 5, lifeMax: 5 });
            pump(2, 16);
            assert.equal(c.count, 60);
            c.destroy();
            assert.equal(c.count, 0, 'destroy() left a stale count');
        });

        it('exposes a non-enumerable __stats conservation probe (not on the public shape)', () => {
            const c = createConfetti(makeCanvas(), { seed: 8, maxParticles: 128 });
            assert.ok(!Object.keys(c).includes('__stats'), '__stats must be non-enumerable');
            c.burst({ count: 40, lifeMin: 5, lifeMax: 5 });
            pump(1, 16);
            const s = c.__stats();
            assert.equal(s.aliveGetter, s.aliveActual, 'count getter drifted from live slots');
            assert.equal(s.aliveGetter, 40);
            assert.equal(s.cap, 128);
            c.destroy();
            const after = c.__stats();
            assert.equal(after.aliveActual, 0);
            assert.equal(after.aliveGetter, 0);
        });
    });
});
