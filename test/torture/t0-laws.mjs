/**
 * T0 -- metamorphic laws.
 *
 * Invariants that must hold no matter what the internals do, asserted purely
 * through the public surface (`count()` + the draw fingerprint). Confetti's pool
 * is a fixed ring buffer closed over inside createConfetti, so these are the
 * black-box analog of lite-bvh's structural laws:
 *
 *   L1 a fresh instance has count 0
 *   L2 burst(n), n <= cap, then integrate -> count === n
 *   L3 cap conservation: burst(count >> cap) -> count === cap (ring buffer evicts)
 *   L4 additivity: burst(n)+burst(m) -> count === min(n+m, cap)
 *   L5 clear() -> count 0
 *   L6 no emit -> count is monotone non-increasing frame to frame
 *   L7 finite life -> the pool fully drains (count returns to 0)
 *   L8 reduced motion -> the static path emits nothing into the pool (count stays 0)
 */

import { createConfetti, makeCanvas, pump, setReducedMotion, check } from './harness.mjs';

const CAP = 200;

function fresh(seed = 1) {
    return createConfetti(makeCanvas(), { seed, maxParticles: CAP });
}

export function run() {
    // L1 -- fresh instance is empty.
    {
        const c = fresh();
        check(c.count === 0, () => `T0 L1: fresh count ${c.count} != 0`);
        c.destroy();
    }

    // L2 -- burst(n), n <= cap, integrated once -> exactly n alive.
    {
        const c = fresh();
        c.burst({ count: 50, lifeMin: 10, lifeMax: 10 });
        pump(1, 16);
        check(c.count === 50, () => `T0 L2: burst(50) -> count ${c.count} != 50`);
        c.destroy();
    }

    // L3 -- cap conservation. A burst far larger than the pool cannot exceed cap.
    {
        const c = fresh();
        c.burst({ count: CAP * 5, lifeMin: 10, lifeMax: 10 });
        pump(1, 16);
        check(c.count === CAP, () => `T0 L3: burst(${CAP * 5}) -> count ${c.count} != cap ${CAP}`);
        c.destroy();
    }

    // L4 -- additivity across two bursts (no integrate between them).
    for (const [n, m] of [[40, 30], [CAP - 10, 50] /* overflows -> cap */]) {
        const c = fresh();
        c.burst({ count: n, lifeMin: 10, lifeMax: 10 });
        c.burst({ count: m, lifeMin: 10, lifeMax: 10 });
        pump(1, 16);
        const want = Math.min(n + m, CAP);
        check(c.count === want, () => `T0 L4: burst(${n})+burst(${m}) -> count ${c.count} != ${want}`);
        c.destroy();
    }

    // L5 -- clear() empties the pool.
    {
        const c = fresh();
        c.burst({ count: 100, lifeMin: 10, lifeMax: 10 });
        pump(1, 16);
        check(c.count === 100, () => `T0 L5: pre-clear count ${c.count} != 100`);
        c.clear();
        check(c.count === 0, () => `T0 L5: post-clear count ${c.count} != 0`);
        // and it stays cleared across a frame with no new emit
        pump(1, 16);
        check(c.count === 0, () => `T0 L5: count ${c.count} != 0 a frame after clear`);
        c.destroy();
    }

    // L6 -- with no new emission, count never increases frame to frame.
    {
        const c = fresh();
        c.burst({ count: 120, lifeMin: 2, lifeMax: 2 });
        let prev = Infinity;
        for (let f = 0; f < 200; f++) {
            pump(1, 16);
            check(c.count <= prev, () => `T0 L6: count rose ${prev} -> ${c.count} at frame ${f} with no emit`);
            check(c.count <= CAP, () => `T0 L6: count ${c.count} exceeded cap ${CAP} at frame ${f}`);
            prev = c.count;
        }
        c.destroy();
    }

    // L7 -- finite life drains the pool. Life 0.5s, 50ms/frame -> dead well before 20 frames.
    {
        const c = fresh();
        c.burst({ count: 150, lifeMin: 0.5, lifeMax: 0.5 });
        pump(1, 16);
        check(c.count === 150, () => `T0 L7: initial count ${c.count} != 150`);
        for (let f = 0; f < 20; f++) pump(1, 50);
        check(c.count === 0, () => `T0 L7: pool did not drain, count ${c.count} != 0 after 1s of 0.5s-life particles`);
        c.destroy();
    }

    // L8 -- reduced motion: the static path draws directly and spawns nothing into
    // the pool, so count stays 0 (and no ticker is engaged).
    {
        const c = fresh();
        setReducedMotion(true);
        try {
            c.burst({ count: 100 });
            pump(2, 16);
            check(c.count === 0, () => `T0 L8: reduced-motion burst spawned into the pool (count ${c.count} != 0)`);
        } finally {
            setReducedMotion(false);
            c.destroy();
        }
    }
}
