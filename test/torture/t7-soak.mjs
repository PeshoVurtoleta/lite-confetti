/**
 * T7 -- soak + conservation.
 *
 * lite-bvh's T7 soaks the tree and asserts free-list conservation (allocated + free
 * == capacity). Confetti's pool is a fixed ring buffer, so the black-box conservation
 * laws are:
 *
 *   S1 occupancy conservation -- across a long emit/expire churn, count() never
 *      exceeds cap, and once emission stops the pool drains completely to 0 (no slot
 *      is stranded "alive" forever).
 *   S2 pointer-listener conservation -- the window-level resource confetti can leak.
 *      Every followPointer bind is matched by a destroy(), so over many cycles the
 *      global pointermove-listener count returns exactly to baseline (the ref-count
 *      analog of the free-list count).
 */

import {
    createConfetti, makeCanvas, pump, pointerListenerCount, makePrng, SEED, check, log,
} from './harness.mjs';

const CAP = 400;

export function run() {
    // S1 -- occupancy conservation under continuous churn.
    {
        const c = createConfetti(makeCanvas(), { seed: 9, maxParticles: CAP });
        const prng = makePrng(SEED ^ 0x2545f491);
        const FRAMES = 20000;
        for (let f = 0; f < FRAMES; f++) {
            if (f % 3 === 0) c.burst({ count: 10 + (prng() % 40), lifeMin: 0.5, lifeMax: 2.0 });
            pump(1, 16);
            check(c.count <= CAP, () => `T7 S1: count ${c.count} exceeded cap ${CAP} at frame ${f}`);
        }
        // Stop emitting; the pool must drain to exactly 0 within a couple seconds.
        for (let f = 0; f < 400; f++) pump(1, 50);
        check(c.count === 0, () => `T7 S1: pool did not drain after emission stopped (count ${c.count} still alive)`);
        c.destroy();
    }

    // S2 -- pointer-listener conservation over many bind/destroy cycles.
    {
        const base = pointerListenerCount();
        const CYCLES = 1000;
        for (let k = 0; k < CYCLES; k++) {
            const inst = createConfetti(makeCanvas(), { seed: k, maxParticles: 32 });
            inst.spray({ followPointer: true, duration: 1e9 });
            pump(1, 16);
            inst.destroy();
        }
        check(pointerListenerCount() === base, () =>
            `T7 S2: ${pointerListenerCount() - base} pointer listener(s) leaked over ${CYCLES} bind/destroy cycles`);
    }

    log('  T7 ok -- 20000-frame churn stayed within cap and drained to 0; 1000 pointer cycles balanced');
}
