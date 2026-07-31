/**
 * T4 -- handle / buffer / input abuse.
 *
 * lite-bvh's T4 abuses stale handles and undersized output buffers; confetti has no
 * caller-held handles, so the analog is the two DEGRADED constructions and the
 * post-destroy surface:
 *
 *   - createConfetti(falsy)            -> the minimal no-op stub
 *   - createConfetti(canvas, no 2d ctx)-> the count/seed-bearing no-op stub
 *   - every method after destroy()     -> inert, never throws, count 0
 *   - a burst far larger than the pool -> the fixed typed arrays are never over-run
 *
 * The two stubs expose DIFFERENT surfaces on purpose (the null stub predates the
 * count getter); this tier pins exactly what each provides so a future refactor
 * that silently drops a stub method is caught.
 */

import { createConfetti, makeCanvas, pump, check, capture, withSilencedWarn } from './harness.mjs';

export function run() {
    // H1 -- the falsy-canvas stub. Minimal surface: burst/spray/clear/destroy.
    withSilencedWarn(() => {
        for (const bad of [null, undefined, 0, false, '']) {
            const stub = createConfetti(bad);
            for (const m of ['burst', 'spray', 'clear', 'destroy']) {
                check(typeof stub[m] === 'function', () => `T4 H1(${String(bad)}): stub.${m} missing`);
            }
            const err = capture(() => { stub.burst({ count: 9 }); stub.spray({ rate: 3 }); stub.clear(); stub.destroy(); });
            check(err === null, () => `T4 H1(${String(bad)}): stub method threw ${err && err.message}`);
            // The minimal stub deliberately has no count getter.
            check(stub.count === undefined, () => `T4 H1(${String(bad)}): minimal stub unexpectedly has count`);
        }
    });

    // H2 -- the no-2d-context stub. Richer surface: adds count (0) and seed.
    withSilencedWarn(() => {
        const stub = createConfetti({ getContext: () => null });
        for (const m of ['burst', 'spray', 'clear', 'seed', 'destroy']) {
            check(typeof stub[m] === 'function', () => `T4 H2: stub.${m} missing`);
        }
        check(stub.count === 0, () => `T4 H2: stub.count ${stub.count} != 0`);
        const err = capture(() => { stub.burst({ count: 9 }); stub.spray({}); stub.clear(); stub.seed(7); stub.destroy(); });
        check(err === null, () => `T4 H2: stub method threw ${err && err.message}`);
        check(stub.count === 0, () => `T4 H2: stub.count ${stub.count} != 0 after use`);
    });

    // H3 -- post-destroy inertness. Every method is a no-op after destroy(); none
    // throws, and count stays 0.
    {
        const c = createConfetti(makeCanvas(), { seed: 2, maxParticles: 64 });
        c.burst({ count: 40, lifeMin: 5, lifeMax: 5 });
        pump(1, 16);
        c.destroy();
        const err = capture(() => {
            c.burst({ count: 40 });
            c.spray({ rate: 5, duration: 100 });
            c.seed(123);
            c.clear();
            pump(5, 16);
        });
        check(err === null, () => `T4 H3: a method threw after destroy(): ${err && err.message}`);
        check(c.count === 0, () => `T4 H3: count ${c.count} != 0 after destroy() + calls`);
    }

    // H4 -- buffer bounds. A burst orders of magnitude larger than a tiny pool must
    // not over-run the fixed Float32Array/Uint8Array columns.
    {
        const c = createConfetti(makeCanvas(), { seed: 4, maxParticles: 8 });
        const err = capture(() => { c.burst({ count: 250000, lifeMin: 5, lifeMax: 5 }); pump(2, 16); });
        check(err === null, () => `T4 H4: huge burst threw ${err && err.message}`);
        check(c.count === 8, () => `T4 H4: count ${c.count} != 8 (fixed pool must clamp)`);
        c.destroy();
    }
}
