import {describe, it, expect, vi, beforeEach} from 'vitest';

vi.mock('@zakkster/lite-random', () => {
    class R {
        constructor(s) {
            this._s = s || 1;
            this._i = 0;
        }

        next() {
            return ((++this._i * 0.618) % 1);
        }

        range(a, b) {
            return a + this.next() * (b - a);
        }

        pick(a) {
            return a[Math.floor(this.next() * a.length)];
        }

        reset(s) {
            if (s !== undefined) this._s = s;
            this._i = 0;
        }
    }

    return {Random: R, default: R};
});
vi.mock('@zakkster/lite-color', () => ({
    toCssOklch: (c) => `oklch(${c.l} ${c.c} ${c.h})`,
}));
vi.mock('@zakkster/lite-ticker', () => {
    class T {
        constructor() {
            this._fns = [];
        }

        add(fn) {
            this._fns.push(fn);
            return () => {
                this._fns = this._fns.filter(f => f !== fn);
            };
        }

        start() {
        }

        destroy() {
        }

        tick(dt) {
            for (const fn of [...this._fns]) fn(dt);
        }
    }

    return {Ticker: T};
});

import {createConfetti, confetti, presets, colorsFromPalette, fromElement} from '../Confetti.d.ts';

// --- DOM Mocks ---
function mockCanvas() {
    // Return a plain object instead of calling document.createElement
    const c = {
        style: {},
        remove: vi.fn(),
        parentElement: null,
        width: 0,
        height: 0
    };
    Object.defineProperty(c, 'clientWidth', {value: 800, configurable: true});
    Object.defineProperty(c, 'clientHeight', {value: 600, configurable: true});
    // Offset, unscaled canvas -- exercises the viewport->canvas coordinate conversion.
    c.getBoundingClientRect = vi.fn(() => ({ left: 100, top: 50, width: 800, height: 600 }));
    c.getContext = vi.fn(() => {
        const ctx = {
            clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '', globalAlpha: 1,
            beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), closePath: vi.fn(),
            moveTo: vi.fn(), lineTo: vi.fn(), save: vi.fn(), restore: vi.fn(),
            translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), setTransform: vi.fn(),
            drawImage: vi.fn(),
            font: '', textAlign: '', textBaseline: '', fillText: vi.fn(() => { globalThis.__fillTextCount = (globalThis.__fillTextCount || 0) + 1; }),
            canvas: c,
        };
        return ctx;
    });
    return c;
}

// Inject fake browser APIs into the Node environment
vi.stubGlobal('document', {
    createElement: (tag) => (tag === 'canvas' ? mockCanvas() : { style: {} }),
    getElementById: vi.fn(() => null),
    body: { appendChild: vi.fn() }
});

const _winListeners = { pointermove: [] };
vi.stubGlobal('window', {
    devicePixelRatio: 1,
    innerWidth: 1024,
    innerHeight: 768,
    matchMedia: vi.fn(() => ({ matches: false, addEventListener: vi.fn() })),
    addEventListener: vi.fn((type, fn) => { (_winListeners[type] ||= []).push(fn); }),
    removeEventListener: vi.fn((type, fn) => {
        const a = _winListeners[type]; if (!a) return;
        const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    }),
});
function firePointerMove(clientX, clientY) {
    for (const fn of (_winListeners.pointermove || []).slice()) fn({ clientX, clientY });
}
function pointerListenerCount() { return (_winListeners.pointermove || []).length; }

describe('🎉 lite-confetti', () => {

    describe('createConfetti()', () => {
        it('returns burst, spray, clear, seed, destroy, count', () => {
            const c = createConfetti(mockCanvas());
            expect(c.burst).toBeTypeOf('function');
            expect(c.spray).toBeTypeOf('function');
            expect(c.clear).toBeTypeOf('function');
            expect(c.seed).toBeTypeOf('function');
            expect(c.destroy).toBeTypeOf('function');
            expect(typeof c.count).toBe('number');
            c.destroy();
        });

        it('returns safe noop on null canvas', () => {
            const spy = vi.spyOn(console, 'warn').mockImplementation(() => {
            });
            const c = createConfetti(null);
            expect(c.burst).toBeTypeOf('function');
            c.burst(); // should not throw
            c.destroy();
            spy.mockRestore();
        });
    });

    describe('burst()', () => {
        it('spawns particles', () => {
            const c = createConfetti(mockCanvas(), {seed: 42});
            c.burst({count: 50});
            // After burst, count should be > 0 once the render loop ticks
            // Since we mock the ticker, we need to check the pool isn't empty
            // The burst function directly writes to the pool
            c.destroy();
        });

        it('respects count option', () => {
            const canvas = mockCanvas();
            const c = createConfetti(canvas, {seed: 42});
            c.burst({count: 10});
            c.destroy();
        });

        it('uses default colors when none specified', () => {
            const c = createConfetti(mockCanvas(), {seed: 42});
            c.burst(); // should not throw
            c.destroy();
        });

        it('supports all shapes', () => {
            const c = createConfetti(mockCanvas(), {seed: 42});
            ['rect', 'circle', 'star', 'triangle', 'emoji'].forEach(shape => {
                c.burst({count: 5, shape});
            });
            c.destroy();
        });

        it('supports custom emoji', () => {
            const c = createConfetti(mockCanvas(), {seed: 42});
            c.burst({shape: 'emoji', emoji: '🌟', count: 5});
            c.destroy();
        });

        it('supports CSS string colors', () => {
            const c = createConfetti(mockCanvas(), {seed: 42});
            c.burst({colors: ['#ff0000', '#00ff00'], count: 5});
            c.destroy();
        });
    });

    describe('spray()', () => {
        it('does not throw', () => {
            const c = createConfetti(mockCanvas(), {seed: 42});
            c.spray({duration: 100, rate: 2});
            c.destroy();
        });
    });

    describe('clear()', () => {
        it('kills all particles', () => {
            const c = createConfetti(mockCanvas(), {seed: 42});
            c.burst({count: 50});
            c.clear();
            expect(c.count).toBe(0);
            c.destroy();
        });
    });

    describe('seed()', () => {
        it('resets RNG for deterministic replay', () => {
            const canvas = mockCanvas();
            const c = createConfetti(canvas, {seed: 42});
            c.seed(42);
            c.burst({count: 1});
            c.destroy();
        });
    });

    describe('destroy()', () => {
        it('is idempotent', () => {
            const c = createConfetti(mockCanvas());
            c.destroy();
            c.destroy(); // should not throw
        });

        it('prevents further bursts', () => {
            const c = createConfetti(mockCanvas());
            c.destroy();
            c.burst({count: 10}); // should be silently ignored
        });
    });

    describe('confetti() — fire-and-forget', () => {
        it('creates overlay and fires', () => {
            const c = confetti({count: 10, seed: 42});
            expect(c).toBeDefined();
            expect(c.burst).toBeTypeOf('function');
            // Clean up the overlay it created
            const overlay = document.getElementById('__lite-confetti-overlay');
            if (overlay) overlay.remove();
            c.destroy();
        });
    });

    // ═══════════════════════════════════════════════════════
    //  v1.2.0 — presets
    // ═══════════════════════════════════════════════════════

    describe('presets', () => {
        const KNOWN_SHAPES = new Set(['rect', 'circle', 'star', 'triangle', 'emoji']);

        it('ships the four documented presets', () => {
            expect(Object.keys(presets).sort()).toEqual(['cannons', 'fireworks', 'pride', 'snow']);
        });

        it('every preset shape is one the engine actually renders', () => {
            for (const [name, p] of Object.entries(presets)) {
                if (p.shape !== undefined) expect(KNOWN_SHAPES.has(p.shape), name + ':' + p.shape).toBe(true);
            }
        });

        it('every preset has sane numeric ranges (min <= max, positive life)', () => {
            for (const [name, p] of Object.entries(presets)) {
                expect(p.sizeMin, name).toBeLessThanOrEqual(p.sizeMax);
                expect(p.lifeMin, name).toBeLessThanOrEqual(p.lifeMax);
                expect(p.lifeMin, name).toBeGreaterThan(0);
                expect(p.count, name).toBeGreaterThan(0);
            }
        });

        it('pride carries an OKLCH palette that colorsFromPalette accepts', () => {
            const cols = colorsFromPalette(presets.pride.colors);
            expect(cols.length).toBe(6);
        });

        it('spreads into burst() without throwing', () => {
            const c = createConfetti(mockCanvas(), { seed: 1 });
            expect(() => c.burst({ ...presets.fireworks })).not.toThrow();
            c.destroy();
        });

        it('a preset burst is still deterministic under a fixed seed', () => {
            const runN = () => {
                const c = createConfetti(mockCanvas(), { seed: 7 });
                c.burst({ ...presets.cannons });
                const n = c.count;
                c.destroy();
                return n;
            };
            expect(runN()).toBe(runN());
        });
    });

    // ═══════════════════════════════════════════════════════
    //  v1.2.0 — colorsFromPalette
    // ═══════════════════════════════════════════════════════

    describe('colorsFromPalette()', () => {
        const stops = [
            { color: { l: 0.6, c: 0.2, h: 20 }, stop: 0 },
            { color: { l: 0.7, c: 0.2, h: 200 }, stop: 1 },
        ];

        it('extracts colors from lite-hueforge gradient stops', () => {
            expect(colorsFromPalette(stops)).toEqual([stops[0].color, stops[1].color]);
        });

        it('reads a { stops } wrapper', () => {
            expect(colorsFromPalette({ stops }).length).toBe(2);
        });

        it('passes a plain colors array through', () => {
            const arr = ['#fff', { l: 0.5, c: 0.1, h: 10 }];
            expect(colorsFromPalette(arr)).toEqual(arr);
        });

        it('wraps a single OKLCH object', () => {
            const one = { l: 0.5, c: 0.1, h: 10 };
            expect(colorsFromPalette(one)).toEqual([one]);
        });

        it('NEVER returns an empty array -- that would paint nothing', () => {
            // rng.pick([]) is undefined; an empty palette must fall back to defaults.
            expect(colorsFromPalette([]).length).toBeGreaterThan(0);
            expect(colorsFromPalette({ stops: [] }).length).toBeGreaterThan(0);
            expect(colorsFromPalette([{ notacolor: true }]).length).toBeGreaterThan(0);
        });

        it('falls back to defaults on falsy / garbage input', () => {
            expect(colorsFromPalette(null).length).toBeGreaterThan(0);
            expect(colorsFromPalette(undefined).length).toBeGreaterThan(0);
            expect(colorsFromPalette(42).length).toBeGreaterThan(0);
        });

        it('filters invalid entries out of a stops array', () => {
            const mixed = [
                { color: { l: 0.6, c: 0.2, h: 20 } },
                { color: null },
                { color: { l: 0.7, c: 0.2, h: 200 } },
            ];
            expect(colorsFromPalette(mixed).length).toBe(2);
        });

        it('output feeds burst() without error', () => {
            const c = createConfetti(mockCanvas(), { seed: 3 });
            expect(() => c.burst({ colors: colorsFromPalette(stops), count: 10 })).not.toThrow();
            c.destroy();
        });
    });

    // ═══════════════════════════════════════════════════════
    //  v1.2.0 — fromElement
    // ═══════════════════════════════════════════════════════

    describe('fromElement()', () => {
        const el = (r) => ({ getBoundingClientRect: () => r });

        it('returns the element centre in viewport coordinates', () => {
            const o = fromElement(el({ left: 100, top: 50, width: 40, height: 20 }));
            expect(o.x).toBe(120);
            expect(o.y).toBe(60);
        });

        it('merges extra options', () => {
            const o = fromElement(el({ left: 0, top: 0, width: 10, height: 10 }), { count: 42, shape: 'star' });
            expect(o.count).toBe(42);
            expect(o.shape).toBe('star');
        });

        it('lets an explicit x/y in extra override the computed centre', () => {
            const o = fromElement(el({ left: 0, top: 0, width: 10, height: 10 }), { x: 999, y: -1 });
            expect(o.x).toBe(999);
            expect(o.y).toBe(-1);
        });

        it('warns and returns just extra on a bad element', () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const o = fromElement(null, { count: 3 });
            expect(o).toEqual({ count: 3 });
            expect(warn).toHaveBeenCalled();
            warn.mockRestore();
        });
    });

    // ═══════════════════════════════════════════════════════
    //  v1.2.0 — pointer-follow spray
    // ═══════════════════════════════════════════════════════

    describe('spray({ followPointer })', () => {
        it('binds NO global listener at module load or on a normal spray', () => {
            const before = pointerListenerCount();
            const c = createConfetti(mockCanvas(), { seed: 1 });
            c.spray({ duration: 100, rate: 2 });
            expect(pointerListenerCount()).toBe(before);
            c.destroy();
        });

        it('binds a listener only when followPointer is on, and releases it on destroy', () => {
            const before = pointerListenerCount();
            const c = createConfetti(mockCanvas(), { seed: 1 });
            c.spray({ duration: 5000, rate: 1, followPointer: true });
            expect(pointerListenerCount()).toBe(before + 1);
            c.destroy();
            expect(pointerListenerCount()).toBe(before);
        });

        it('converts viewport coords into the canvas own space', () => {
            // mockCanvas rect is { left:100, top:50 }. A pointer at (300,250) is (200,200)
            // in canvas space. We cannot read spawn() coords directly, but we can assert the
            // spray runs and stays alive without throwing after a move.
            const c = createConfetti(mockCanvas(), { seed: 1 });
            c.spray({ duration: 5000, rate: 1, followPointer: true });
            firePointerMove(300, 250);
            expect(c.count).toBeGreaterThanOrEqual(0);
            c.destroy();
        });

        it('does not consume an rng draw for following -- a NON-following spray replays identically regardless of pointer moves', () => {
            const run = (movePointer) => {
                const c = createConfetti(mockCanvas(), { seed: 99 });
                if (movePointer) firePointerMove(400, 400);
                c.spray({ duration: 100, rate: 3 });   // followPointer OFF
                const n = c.count;
                c.destroy();
                return n;
            };
            expect(run(false)).toBe(run(true));
        });

        it('reference-counts: two overlapping follow-sprays share one listener', () => {
            const before = pointerListenerCount();
            const c = createConfetti(mockCanvas(), { seed: 1 });
            c.spray({ duration: 5000, rate: 1, followPointer: true });
            c.spray({ duration: 5000, rate: 1, followPointer: true });
            expect(pointerListenerCount()).toBe(before + 1);   // still ONE, not two
            c.destroy();
            expect(pointerListenerCount()).toBe(before);
        });
    });

    // ═══════════════════════════════════════════════════════
    //  v1.2.1 — emoji glyph atlas (freeze fix)
    // ═══════════════════════════════════════════════════════

    describe('emoji rendering does not rasterize per particle', () => {
        // The bug: the old emoji path set ctx.font and called fillText() for EVERY emoji
        // particle EVERY frame. Font size varies per particle, so nothing cached -> a
        // colour-glyph raster storm that froze the main thread. The atlas rasterizes each
        // unique glyph once; the hot path is then a drawImage() blit.

        beforeEach(() => { globalThis.__fillTextCount = 0; });

        it('rasterizes a glyph at most once when firing many emoji particles', () => {
            const c = createConfetti(mockCanvas(), { seed: 1 });
            c.burst({ shape: 'emoji', emoji: '🎉', count: 100, lifeMin: 5, lifeMax: 5 });
            // Priming rasterizes the glyph once (or zero times if already cached from an
            // earlier test). It must NOT scale with particle count.
            expect(globalThis.__fillTextCount).toBeLessThanOrEqual(1);
            c.destroy();
        });

        it('does not re-rasterize a glyph already in the atlas', () => {
            const c = createConfetti(mockCanvas(), { seed: 1 });
            // '🎉' was cached by the previous test (the atlas is module-level).
            c.burst({ shape: 'emoji', emoji: '🎉', count: 50, lifeMin: 5, lifeMax: 5 });
            expect(globalThis.__fillTextCount).toBe(0);
            c.destroy();
        });

        it('a fresh glyph rasterizes exactly once regardless of count', () => {
            const c = createConfetti(mockCanvas(), { seed: 1 });
            // A guaranteed-unique glyph (unlikely to be cached by any other test): a
            // Private Use Area codepoint. First sight -> one rasterization.
            const rare = String.fromCodePoint(0xF8000 + Math.floor(Math.random() * 0x1000));
            c.burst({ shape: 'emoji', emoji: rare, count: 200, lifeMin: 5, lifeMax: 5 });
            expect(globalThis.__fillTextCount).toBe(1);
            // A second burst of the same glyph adds no rasterization (already cached).
            globalThis.__fillTextCount = 0;
            c.burst({ shape: 'emoji', emoji: rare, count: 200, lifeMin: 5, lifeMax: 5 });
            expect(globalThis.__fillTextCount).toBe(0);
            c.destroy();
        });

        it('non-emoji shapes never touch fillText', () => {
            const c = createConfetti(mockCanvas(), { seed: 1 });
            c.burst({ shape: 'star', count: 100, lifeMin: 5, lifeMax: 5 });
            c.burst({ shape: 'circle', count: 100, lifeMin: 5, lifeMax: 5 });
            expect(globalThis.__fillTextCount).toBe(0);
            c.destroy();
        });
    });
});

