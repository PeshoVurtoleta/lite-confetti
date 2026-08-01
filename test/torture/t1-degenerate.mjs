/**
 * T1 -- degenerate inputs.
 *
 * Feed burst()/spray() and createConfetti() the values a real caller eventually
 * passes by accident, and assert the engine FAILS CLOSED: no throw, count() always in
 * [0, cap], and -- since v1.3.1 -- every non-finite numeric option is coerced to its
 * documented default before it can reach a particle, so a drawn position is NEVER
 * non-finite. That last claim is asserted under the assertFinite draw path, which turns
 * any leaked NaN into a hard throw. This is lite-bvh's "degenerate query values" tier
 * for a particle pool.
 *
 * History (see decisions/0002 + 0004): pre-1.3.1 confetti did NOT sanitise numerics --
 * a `speed:NaN` propagated NaN into a drawn position (hashing silently as 0) and a
 * `lifeMax:NaN` made a particle immortal (NaN <= 0 is false, so it never died). 0004
 * closed that gap. This tier now PROVES the coercion holds (positions finite, the
 * immortal bug gone) rather than merely documenting the old bounded-garbage behaviour.
 * The detector itself is still exercised as a control in T9 (K1a, a direct NaN inject).
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

    // --- non-finite numerics FAIL CLOSED (v1.3.1): each is coerced to its default, so
    //     NO throw, count bounded, AND -- under assertFinite -- NO drawn position is
    //     ever non-finite. Every finite-life burst still drains the pool. -----------
    const poison = [
        ['speed:NaN', { count: 60, speed: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['speedVariance:Infinity', { count: 60, speedVariance: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['gravity:Infinity', { count: 60, gravity: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['gravity:-Infinity', { count: 60, gravity: -Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['wind:NaN', { count: 60, wind: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['wind:-Infinity', { count: 60, wind: -Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['floor:NaN', { count: 60, floor: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['floor:-Infinity+bounce:2', { count: 60, floor: -Infinity, bounce: 2, lifeMin: 0.3, lifeMax: 0.3 }],
        ['bounce:Infinity', { count: 60, floor: 50, bounce: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['sizeMin/Max:NaN', { count: 60, sizeMin: NaN, sizeMax: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['angle:NaN', { count: 60, angle: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['drag:NaN', { count: 60, drag: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['spread:Infinity', { count: 60, spread: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['x/y:NaN', { count: 60, x: NaN, y: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['colors:null', { count: 60, colors: null, lifeMin: 0.3, lifeMax: 0.3 }],
    ];
    for (const [label, opts] of poison) {
        const cv = makeCanvas({ assertFinite: true });
        const c = createConfetti(cv, { seed: 3, maxParticles: CAP });
        const err = capture(() => {
            c.burst(opts);
            pump(1, 16);
            // count must be bounded regardless of the garbage
            check(c.count >= 0 && c.count <= CAP, () => `T1 ${label}: count ${c.count} out of [0, ${CAP}]`);
            // finite life -> drains within ~1.5s (0.3s life, 50ms/frame)
            for (let f = 0; f < 30; f++) pump(1, 50);
        });
        check(err === null, () =>
            `T1 ${label}: coercion failed -- threw or drew a non-finite position (${err && err.message})`);
        check(c.count === 0, () => `T1 ${label}: pool did not drain (count ${c.count} != 0)`);
        c.destroy();
    }

    // --- the immortal-particle bug (0002/0004): a NaN life made NaN <= 0 false, so the
    //     particle NEVER died. Coerced to the default life now, it MUST expire. --------
    {
        const cv = makeCanvas({ assertFinite: true });
        const c = createConfetti(cv, { seed: 5, maxParticles: CAP });
        c.burst({ count: 50, lifeMin: NaN, lifeMax: NaN });
        pump(1, 16);
        check(c.count === 50, () => `T1 immortal: NaN life did not spawn a bounded burst (count ${c.count} != 50)`);
        for (let f = 0; f < 90; f++) pump(1, 50); // default life <= 3.0s; drain over 4.5s
        check(c.count === 0, () =>
            `T1 immortal: a NaN-life particle stayed alive (count ${c.count} != 0) -- ` +
            `coercion to the default life failed`);
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

    // --- flutter/sway are clamped into [0,1] (clamp01): a non-finite OR out-of-range
    //     knob coerces to default/edge, so it must NOT produce a non-finite position.
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
