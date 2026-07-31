/**
 * T1 -- degenerate inputs.
 *
 * Feed burst()/spray() and createConfetti() the values a real caller eventually
 * passes by accident, and assert the engine stays WITHIN ITS BOUNDS: no throw, and
 * count() always in [0, cap]. This is lite-bvh's "degenerate query values" tier for
 * a particle pool.
 *
 * IMPORTANT, and deliberately honest: confetti does NOT sanitise non-finite numeric
 * options (there is no input validation in burst/spray). A `speed:NaN` propagates
 * NaN into a particle's velocity and thus its drawn position; a `lifeMin:NaN` makes
 * a particle immortal (NaN <= 0 is false, so it never dies). Those are real,
 * documented gaps (see decisions/0002) that a byte-unchanged patch cannot fix. So
 * this tier asserts what IS true for non-finite input -- no crash, count bounded --
 * and, crucially, that a non-finite POSITION never blocks a particle's DEATH when
 * its life is finite (the pool still drains). It does NOT assert positions stay
 * finite for garbage input; the black-box NaN detector is exercised as a control in
 * T9, where a NaN is injected on purpose and the draw path must flag it.
 */

import { createConfetti, makeCanvas, pump, check, capture, withSilencedWarn } from './harness.mjs';

const CAP = 128;

function fresh(maxParticles = CAP) {
    return createConfetti(makeCanvas(), { seed: 3, maxParticles });
}

export function run() {
    // --- benign degenerate counts / options: no throw, count bounded ------------
    const benign = [
        ['count:0', (c) => c.burst({ count: 0, lifeMin: 5, lifeMax: 5 })],
        ['count:negative', (c) => c.burst({ count: -25, lifeMin: 5, lifeMax: 5 })],
        ['count:>>cap', (c) => c.burst({ count: CAP * 7, lifeMin: 5, lifeMax: 5 })],
        ['colors:[] empty', (c) => c.burst({ count: 20, colors: [], lifeMin: 5, lifeMax: 5 })],
        ['emoji:"" empty', (c) => c.burst({ count: 20, shape: 'emoji', emoji: '', lifeMin: 5, lifeMax: 5 })],
        ['spray rate 0', (c) => c.spray({ rate: 0, duration: 100 })],
        ['spray count-ish huge rate', (c) => c.spray({ rate: 9999, duration: 32 })],
    ];
    for (const [label, op] of benign) {
        const c = fresh();
        const err = capture(() => { op(c); pump(3, 16); });
        check(err === null, () => `T1 ${label}: threw ${err && err.message}`);
        check(c.count >= 0 && c.count <= CAP, () => `T1 ${label}: count ${c.count} out of [0, ${CAP}]`);
        c.destroy();
    }

    // --- tiny pool: a huge burst must never over-run the fixed arrays -----------
    {
        const c = fresh(4);
        const err = capture(() => { c.burst({ count: 100000, lifeMin: 5, lifeMax: 5 }); pump(1, 16); });
        check(err === null, () => `T1 tiny-pool: threw ${err && err.message}`);
        check(c.count === 4, () => `T1 tiny-pool: count ${c.count} != 4 (ring buffer must clamp)`);
        c.destroy();
    }

    // --- maxParticles:0 : degenerate pool, must not throw and stays empty -------
    {
        const c = fresh(0);
        const err = capture(() => { c.burst({ count: 50, lifeMin: 5, lifeMax: 5 }); pump(2, 16); });
        check(err === null, () => `T1 maxParticles:0: threw ${err && err.message}`);
        check(c.count === 0, () => `T1 maxParticles:0: count ${c.count} != 0`);
        c.destroy();
    }

    // --- non-finite numerics: NO CRASH, count bounded, and a FINITE life still
    //     drains the pool even though positions may be non-finite. -------------
    const nonFiniteFiniteLife = [
        ['speed:NaN', { count: 60, speed: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['speedVariance:Infinity', { count: 60, speedVariance: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['gravity:Infinity', { count: 60, gravity: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['gravity:-Infinity', { count: 60, gravity: -Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['sizeMin:NaN', { count: 60, sizeMin: NaN, sizeMax: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['angle:NaN', { count: 60, angle: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
    ];
    for (const [label, opts] of nonFiniteFiniteLife) {
        const c = fresh();
        const err = capture(() => {
            c.burst(opts);
            pump(1, 16);
            // count must be bounded regardless of the garbage
            check(c.count >= 0 && c.count <= CAP, () => `T1 ${label}: count ${c.count} out of [0, ${CAP}]`);
            // finite life -> drains within ~1s (0.3s life, 50ms/frame)
            for (let f = 0; f < 30; f++) pump(1, 50);
        });
        check(err === null, () => `T1 ${label}: threw ${err && err.message}`);
        check(c.count === 0, () =>
            `T1 ${label}: non-finite input blocked particle DEATH (count ${c.count} != 0) -- ` +
            `a finite life must still expire`);
        c.destroy();
    }

    // --- registerShape: bad arguments FAIL CLOSED (throw), unlike numeric options.
    //     A shape is a structural contract, not a tunable, so garbage throws loudly
    //     rather than silently degrading. ------------------------------------------
    {
        const c = fresh();
        const heart = (ctx, w) => { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); };
        for (const [label, def, name] of [
            ['empty name', heart, ''],
            ['non-string name', heart, 42],
            ['override built-in rect', heart, 'rect'],
            ['override built-in emoji', heart, 'emoji'],
            ['def is a number', 123, 'bad1'],
            ['def is null', null, 'bad2'],
            ['def is {} (no draw/image)', {}, 'bad3'],
        ]) {
            const err = capture(() => c.registerShape(name, def));
            check(err !== null, () => `T1 registerShape ${label}: must throw, did not`);
        }
        c.destroy();
    }

    // --- unknown shape name in burst/spray falls back to rect (no throw, bounded) -
    {
        const c = fresh();
        const err = capture(() => {
            c.burst({ count: 30, shape: 'no-such-shape', lifeMin: 5, lifeMax: 5 });
            c.spray({ rate: 3, duration: 32, shape: 'also-missing' });
            pump(2, 16);
        });
        check(err === null, () => `T1 unknown-shape: threw ${err && err.message}`);
        check(c.count >= 0 && c.count <= CAP, () => `T1 unknown-shape: count ${c.count} out of range`);
        c.destroy();
    }

    // --- flutter/sway ARE validated (clamp01): non-finite coerces to default, so a
    //     NaN knob -- unlike a NaN speed -- must NOT produce a non-finite position.
    //     assertFinite makes any leaked NaN a hard throw. -------------------------
    {
        const cv = makeCanvas({ assertFinite: true });
        const c = createConfetti(cv, { seed: 9, maxParticles: CAP });
        const err = capture(() => {
            c.burst({ count: 40, flutter: NaN, sway: Infinity, lifeMin: 5, lifeMax: 5 });
            c.burst({ count: 40, flutter: -5, sway: 999, lifeMin: 5, lifeMax: 5 });
            for (let f = 0; f < 20; f++) pump(1, 16);
        });
        check(err === null, () =>
            `T1 flutter/sway garbage produced a non-finite position or threw: ${err && err.message}`);
        check(c.count >= 0 && c.count <= CAP, () => `T1 flutter/sway: count ${c.count} out of range`);
        c.destroy();
    }

    // --- bad canvas objects: createConfetti must degrade to an inert stub -------
    withSilencedWarn(() => {
        const nullStub = createConfetti(null);
        const errN = capture(() => {
            nullStub.burst({ count: 10 }); nullStub.spray({}); nullStub.clear();
            check(nullStub.registerShape('x', () => {}) === -1, () => 'T1 null stub registerShape != -1');
            nullStub.destroy();
        });
        check(errN === null, () => `T1 null-canvas stub: threw ${errN && errN.message}`);

        const noCtx = createConfetti({ getContext: () => null });
        const errC = capture(() => {
            noCtx.burst({ count: 10 }); noCtx.spray({}); noCtx.clear(); noCtx.seed(1);
            check(noCtx.registerShape('x', () => {}) === -1, () => 'T1 no-ctx stub registerShape != -1');
            noCtx.destroy();
        });
        check(errC === null, () => `T1 no-ctx stub: threw ${errC && errC.message}`);
        check(noCtx.count === 0, () => `T1 no-ctx stub: count ${noCtx.count} != 0`);
    });
}
