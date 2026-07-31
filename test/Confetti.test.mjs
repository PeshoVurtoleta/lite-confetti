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
    //  Reduced motion (path exists; flutter suppression lands in F1)
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
    });
});
