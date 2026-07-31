/**
 * T5 -- differential fuzz. Determinism IS the oracle.
 *
 * lite-bvh checks its tree against a brute-force scan; confetti's guarantee is that
 * a seed fully determines the animation (the one documented exception, followPointer,
 * is excluded here). So the executable proof is a long, seeded, fuzzed op-stream run
 * against TWO instances constructed with the SAME seed: after every integrated frame
 * their draw fingerprints must be bit-identical. A shared brute-force oracle can't
 * hide a bug because the two instances share no state -- only the seed.
 *
 * Three independent checks:
 *   F1 determinism   -- same seed + same ops (incl. clear()/seed()) -> identical hash
 *                       after every pump, across the whole corpus.
 *   F2 discrimination -- a control: two instances with DIFFERENT seeds and no seed()
 *                       op (so their RNGs never resync) must DIVERGE. Proves the
 *                       fingerprint actually depends on the physics, i.e. F1 is not
 *                       vacuously comparing two constant hashes.
 *   F3 count oracle   -- with fixed life the alive count is a closed-form function of
 *                       elapsed frames; the pool must match it exactly and stay
 *                       monotone as particles age out.
 *
 * The record canvases fingerprint integer-pixel translate positions (see _env.mjs),
 * absorbing cross-platform libm epsilon. On divergence the tier prints SEED so the
 * exact run replays with `TORTURE_SEED=... npm run torture`.
 */

import { createConfetti, makeCanvas, pump, makePrng, SEED, check } from './harness.mjs';

const CAP = 300;
const SHAPES = ['rect', 'circle', 'star', 'triangle', 'emoji'];

/** Build the op for index `i` from the PRNG, so A/B/C all receive identical ops. */
function genOp(prng, allowReseed) {
    const roll = prng() % 100;
    if (roll < 42) {
        // pump a frame (8..24 ms)
        return { kind: 'pump', dt: 8 + (prng() % 17) };
    }
    if (roll < 74) {
        return {
            kind: 'burst',
            o: {
                count: 1 + (prng() % CAP),
                shape: SHAPES[prng() % SHAPES.length],
                speed: 100 + (prng() % 600),
                speedVariance: prng() % 300,
                spread: (prng() % 300) / 100,
                gravity: 200 + (prng() % 800),
                lifeMin: 0.5 + (prng() % 200) / 100,
                lifeMax: 2.5 + (prng() % 200) / 100,
            },
        };
    }
    if (roll < 88) {
        return {
            kind: 'spray',
            o: { rate: 1 + (prng() % 8), duration: 100 + (prng() % 400), speed: 100 + (prng() % 500) },
        };
    }
    if (roll < 94) return { kind: 'clear' };
    if (allowReseed && roll < 100) return { kind: 'seed', s: prng() % 100000 };
    return { kind: 'pump', dt: 16 };
}

function apply(c, op) {
    switch (op.kind) {
        case 'burst': c.burst(op.o); break;
        case 'spray': c.spray(op.o); break;
        case 'clear': c.clear(); break;
        case 'seed': c.seed(op.s); break;
        // pump is driven by the caller (shared rAF queue), not per-instance
    }
}

export function run() {
    // --- F1: same seed -> identical fingerprint across a fuzzed stream ----------
    {
        const seed = 20260731;
        const ca = makeCanvas({ record: true });
        const cb = makeCanvas({ record: true });
        const A = createConfetti(ca, { seed, maxParticles: CAP });
        const B = createConfetti(cb, { seed, maxParticles: CAP });
        const prng = makePrng(SEED);
        const OPS = 3000;
        for (let i = 0; i < OPS; i++) {
            const op = genOp(prng, /* allowReseed */ true);
            apply(A, op);
            apply(B, op);
            if (op.kind === 'pump') {
                pump(1, op.dt); // one pump drives BOTH updates on the shared rAF queue
                check(ca.hash === cb.hash, () =>
                    `T5 F1: op ${i} seed ${SEED}: same-seed instances diverged ` +
                    `(A ${ca.hash} != B ${cb.hash})`);
            }
        }
        A.destroy();
        B.destroy();
    }

    // --- F2: different seeds must diverge (no reseed op, so RNGs never resync) ---
    {
        const ca = makeCanvas({ record: true });
        const cc = makeCanvas({ record: true });
        const A = createConfetti(ca, { seed: 1000, maxParticles: CAP });
        const C = createConfetti(cc, { seed: 1001, maxParticles: CAP });
        const prng = makePrng(SEED ^ 0x5bd1e995);
        for (let i = 0; i < 120; i++) {
            const op = genOp(prng, /* allowReseed */ false);
            apply(A, op);
            apply(C, op);
            if (op.kind === 'pump') pump(1, op.dt);
        }
        // Force at least one integrated frame so both have drawn.
        pump(1, 16);
        check(ca.hash !== cc.hash, () =>
            `T5 F2: different-seed instances produced the SAME fingerprint ${ca.hash} -- ` +
            `the determinism gate is comparing constants, not physics`);
        A.destroy();
        C.destroy();
    }

    // --- F3: fixed-life count oracle. With lifeMin == lifeMax there is no rng
    // spread, so every particle shares one deadline. The alive count is then N while
    // clearly before that deadline and 0 clearly after -- asserted with a guard band
    // around the crossing so accumulated float error in the engine's repeated
    // `life -= dtSec` cannot fight a single-multiply oracle at the exact boundary.
    {
        const c = createConfetti(makeCanvas(), { seed: 77, maxParticles: CAP });
        const N = 150;         // <= cap, so no ring-buffer eviction
        const LIFE = 1.0;      // seconds, fixed
        const DT = 30;         // ms/frame -> crossing near frame 33.3, between frames
        const BAND = 0.05;     // seconds; skip the ambiguous window around LIFE
        c.burst({ count: N, lifeMin: LIFE, lifeMax: LIFE });
        let prev = Infinity;
        for (let f = 1; f <= 60; f++) {
            pump(1, DT);
            const elapsed = f * DT / 1000;
            if (elapsed < LIFE - BAND) {
                check(c.count === N, () => `T5 F3: frame ${f} (${elapsed.toFixed(3)}s): count ${c.count} != ${N} (died early)`);
            } else if (elapsed > LIFE + BAND) {
                check(c.count === 0, () => `T5 F3: frame ${f} (${elapsed.toFixed(3)}s): count ${c.count} != 0 (outlived its life)`);
            }
            check(c.count <= prev && c.count <= N, () => `T5 F3: count invariant broke at frame ${f}: ${prev} -> ${c.count}`);
            prev = c.count;
        }
        check(c.count === 0, () => `T5 F3: pool did not fully drain (count ${c.count})`);
        c.destroy();
    }

    // --- F4: custom shapes + flutter + sway are DETERMINISTIC. Two same-seed
    // instances register identical custom shapes in identical order, then run the same
    // fuzzed stream with flutter/sway options -- their fingerprints must stay identical.
    // A separate call-counter proves the custom VECTOR fn is actually being dispatched
    // (the position hash cannot see shape geometry, so "dispatched at all" needs its
    // own channel). ------------------------------------------------------------------
    {
        const seed = 424242;
        const ca = makeCanvas({ record: true });
        const cb = makeCanvas({ record: true });
        const A = createConfetti(ca, { seed, maxParticles: CAP });
        const B = createConfetti(cb, { seed, maxParticles: CAP });

        let drawCalls = 0;
        const heartA = (ctx, w) => { drawCalls++; ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); };
        const heartB = (ctx, w) => { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); };
        A.registerShape('heart', heartA);
        A.registerShape('logo', { image: makeCanvas() });
        B.registerShape('heart', heartB);
        B.registerShape('logo', { image: makeCanvas() });

        const CUSTOM = ['rect', 'heart', 'emoji', 'logo', 'star'];
        const prng = makePrng(SEED ^ 0x1a2b3c4d);
        for (let i = 0; i < 1500; i++) {
            const roll = prng() % 100;
            if (roll < 50) {
                pump(1, 8 + (prng() % 17));
                check(ca.hash === cb.hash, () =>
                    `T5 F4: op ${i} seed ${SEED}: same-seed custom-shape instances diverged (A ${ca.hash} != B ${cb.hash})`);
            } else {
                const o = {
                    count: 1 + (prng() % 200),
                    shape: CUSTOM[prng() % CUSTOM.length],
                    speed: 100 + (prng() % 500),
                    gravity: 200 + (prng() % 600),
                    lifeMin: 0.5 + (prng() % 200) / 100,
                    lifeMax: 2.5 + (prng() % 200) / 100,
                    flutter: (prng() % 101) / 100,
                    sway: (prng() % 101) / 100,
                };
                A.burst(o);
                B.burst(o);
            }
        }
        check(drawCalls > 0, () =>
            `T5 F4: the custom vector draw fn was never invoked -- registerShape dispatch is not reaching it`);
        A.destroy();
        B.destroy();
    }
}
