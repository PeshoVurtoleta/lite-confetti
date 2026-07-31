/**
 * @zakkster/lite-confetti -- torture harness.
 *
 * The shared kit every tier imports from, modelled on @zakkster/lite-bvh's
 * test/torture/harness.mjs. It centralises the three things that are easy to get
 * wrong if each tier does them itself:
 *
 *   1. IMPORT ORDER. Confetti.js reads `window.matchMedia` at module-evaluation
 *      time, so the browser shim MUST be evaluated first. This module imports
 *      './_env.mjs' (via '../_env.mjs') BEFORE '../../Confetti.js' and re-exports
 *      the library, so a tier that imports only from here can never get the order
 *      wrong. Tiers import the confetti API from THIS file, never from ../../Confetti.js.
 *
 *   2. THE GATE HELPERS. The F0 gate's memory-measurement kit (GC-bracketed net
 *      retained bytes, the FinalizationRegistry settle, the full live pool) lives
 *      here once. T6 (alloc), T7 (soak/retention) and T9 (controls) all reuse it.
 *
 *   3. REPLAY + CONTROLS. A seeded xorshift32 drives every fuzz tier; on failure a
 *      tier prints SEED so the exact run replays with `TORTURE_SEED=... npm run
 *      torture`. `BREAK` (CONFETTI_TORTURE_BREAK=1) is the whole-suite red switch;
 *      `CONTROL` (TORTURE_CONTROL=alloc) is the end-to-end alloc red path.
 *
 * lite-gc-profiler is one-measurement-at-a-time, so tiers run STRICTLY
 * SEQUENTIALLY -- never nested, never concurrent. lite-gc-profiler and lite-leak
 * are devDependencies only; Confetti.js has zero runtime dependencies of this kind.
 *
 * ASCII-only, per the suite Law.
 *
 * @license MIT
 */

// --- import order: shim BEFORE the library, then re-export the library ----------
import '../_env.mjs';
export { makeCanvas, pump, setReducedMotion, firePointerMove, pointerListenerCount } from '../_env.mjs';
export {
    createConfetti, confetti, presets, colorsFromPalette, fromElement,
} from '../../Confetti.js';

import { makeCanvas, pump } from '../_env.mjs';
import { createConfetti } from '../../Confetti.js';

// Gate peers (devDependencies -- never runtime deps of Confetti.js).
export { GcProfiler, assertNoGc } from '@zakkster/lite-gc-profiler';
export { createLeakTracker } from '@zakkster/lite-leak';

// --- replay + control switches --------------------------------------------------

/** PRNG seed for the whole run. Override with TORTURE_SEED for replay. */
export const SEED = (() => {
    const raw = process.env.TORTURE_SEED;
    if (raw === undefined) return 0x9e3779b9;
    const n = Number(raw) >>> 0;
    return n === 0 ? 1 : n; // xorshift32 must not be seeded with 0
})();

/** Whole-suite red switch: injects a retained allocation into the T9 alloc lane. */
export const BREAK = process.env.CONFETTI_TORTURE_BREAK === '1';

/** End-to-end alloc red path (T9 C3): TORTURE_CONTROL=alloc must exit non-zero. */
export const CONTROL = process.env.TORTURE_CONTROL || '';

/** Seeded xorshift32. Returns a function yielding a uint32 each call. */
export function makePrng(seed) {
    let x = (seed >>> 0) || 1;
    return function next() {
        x ^= x << 13; x >>>= 0;
        x ^= x >> 17;
        x ^= x << 5; x >>>= 0;
        return x >>> 0;
    };
}

// --- assertions -----------------------------------------------------------------

/** Fail the whole gate. stdout stays clean; the reason goes to stderr. */
export function die(msg) {
    process.stderr.write('torture: FAIL -- ' + msg +
        '\n  replay: TORTURE_SEED=' + SEED + ' node --expose-gc test/torture.mjs\n');
    process.exit(1);
}

/**
 * Assertion whose message is built ONLY on failure. Pass a thunk, not a string,
 * so the happy path allocates nothing (this matters inside a measured window).
 * @param {boolean} cond
 * @param {() => string} msgThunk
 */
export function check(cond, msgThunk) {
    if (!cond) die(msgThunk());
}

/** Progress / diagnostic line -- stderr, so stdout stays exactly "ok". */
export function log(msg) { process.stderr.write(msg + '\n'); }

/** Run `fn` and return the Error it throws, or null if it does not throw. */
export function capture(fn) {
    try { fn(); return null; } catch (e) { return e || new Error('threw falsy'); }
}

/** Silence console.warn around `fn` (stub-path creation is intentionally noisy). */
export function withSilencedWarn(fn) {
    const orig = console.warn;
    console.warn = () => {};
    try { return fn(); } finally { console.warn = orig; }
}

// --- memory-measurement kit (hoisted verbatim from the F0 gate) -----------------

export const HAS_GC = typeof globalThis.gc === 'function';
export const maybeGc = () => { if (HAS_GC) globalThis.gc(); };
export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Base zero-GC rule for the alloc gate. */
export const RULES = { maxMajor: 0 };

// Gate tuning -- same values the F0 gate committed.
export const MAXP = 500;
export const WARM = 1000;
export const FRAMES = 10000;
export const REPS = 3;
export const SOAK = 10000;

// Net retained bytes/FRAME floor. A render loop that pins nothing reads ~0 (a
// single GC-boundary shift over 10k frames is sub-byte); this floor absorbs that
// jitter without letting a real per-frame object (>= ~16 B) through.
export const RETAIN_FLOOR_BPF = 8.0;

/**
 * Total retained memory: JS heap PLUS external typed-array backing stores. A
 * Float32Array's bytes live in `arrayBuffers`, not `heapUsed`; the pool is exactly
 * such buffers, so a leaked pool would be invisible to heapUsed alone. Sum both.
 */
export const usedBytes = () => {
    const m = process.memoryUsage();
    return m.heapUsed + m.arrayBuffers;
};

/**
 * Net RETAINED bytes per call: warm, full GC, snapshot, run `calls`, full GC
 * AGAIN, snapshot. The trailing GC reclaims every transient, so only memory the
 * run PINNED survives to be counted. Min over reps: a zero-retention body's noise
 * is two-sided GC-boundary jitter and the min is the honest floor; a retaining
 * body grows every rep, so the min stays positive.
 */
export function retainedBytesPerCall(fn, calls, warm = WARM, reps = REPS) {
    let min = Infinity;
    for (let r = 0; r < reps; r++) {
        for (let i = 0; i < warm; i++) fn(i);
        maybeGc();
        maybeGc();
        const before = usedBytes();
        for (let i = 0; i < calls; i++) fn(i);
        maybeGc();
        maybeGc();
        const after = usedBytes();
        const v = (after - before) / calls;
        if (v < min) min = v;
    }
    return min;
}

/** Drive a FinalizationRegistry to quiescence: gc + yield until live count hits 0. */
export async function settle(liveCount, maxRounds = 20) {
    for (let r = 0; r < maxRounds; r++) {
        if (liveCount() === 0) return 0;
        maybeGc();
        // eslint-disable-next-line no-await-in-loop
        await delay(5);
    }
    return liveCount();
}

/**
 * A confetti instance with a full, long-lived pool spanning every shape branch,
 * so update() exercises rect/circle/star/triangle/emoji every frame. Life is set
 * effectively infinite so nothing dies (and auto-detach never fires) across a soak.
 * `record`/`assertFinite` are forwarded to the canvas so callers can also gate on
 * the draw fingerprint.
 */
export function makeLivePool(canvasOpts = {}) {
    const c = createConfetti(makeCanvas(canvasOpts), { seed: 1234, maxParticles: MAXP });
    const per = MAXP / 5;
    for (const shape of ['rect', 'circle', 'star', 'triangle', 'emoji']) {
        c.burst({ count: per, shape, lifeMin: 1e6, lifeMax: 1e6, sizeMin: 4, sizeMax: 12 });
    }
    pump(1, 1000); // integrate once; all MAXP now alive
    return c;
}
