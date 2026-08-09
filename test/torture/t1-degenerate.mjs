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
        ['wallLeft:NaN', { count: 60, wallLeft: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['wallRight:-Infinity', { count: 60, wallRight: -Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['ceiling:Infinity', { count: 60, ceiling: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['inverted-box', { count: 60, wallLeft: 500, wallRight: 100, ceiling: 400, floor: 100, bounce: 1, lifeMin: 0.3, lifeMax: 0.3 }],
        ['turbulence:NaN', { count: 60, turbulence: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['turbulence:-Infinity', { count: 60, turbulence: -Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['gust:Infinity', { count: 60, gust: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['attract:NaN', { count: 60, attract: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['swirl:Infinity', { count: 60, swirl: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['attractX/Y:NaN', { count: 60, attract: 6, attractX: NaN, attractY: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['attractX:Infinity', { count: 60, attract: 6, attractX: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        // A strong repeller is an unstable anti-spring; the VORTEX_MAX_ACCEL cap must keep every
        // drawn position finite over the (finite) life, not just coerce the input.
        ['repeller:-400', { count: 60, x: 400, y: 300, attract: -400, lifeMin: 0.3, lifeMax: 0.3 }],
        ['repeller:-5000', { count: 60, x: 400, y: 300, attract: -5000, swirl: 3000, lifeMin: 0.3, lifeMax: 0.3 }],
        // Settle poison (v1.11.0): garbage thresholds must coerce to 0 (off), and a settled piece
        // rests at a FINITE floor -- no non-finite draw position, with or without a valid floor.
        ['settle:NaN', { count: 60, floor: 50, bounce: 0.5, settle: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['settle:Infinity', { count: 60, floor: 50, bounce: 0.5, settle: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['settle:-Infinity', { count: 60, floor: 50, bounce: 0.5, settle: -Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['settle:-90', { count: 60, floor: 50, bounce: 0.5, settle: -90, lifeMin: 0.3, lifeMax: 0.3 }],
        ['settle:"rest"', { count: 60, floor: 50, bounce: 0.5, settle: 'rest', lifeMin: 0.3, lifeMax: 0.3 }],
        ['settle+poison-floor', { count: 60, floor: NaN, settle: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['settle+strong-fall', { count: 60, y: 20, gravity: 5000, floor: 300, bounce: 0.5, settle: 120, lifeMin: 0.3, lifeMax: 0.3 }],
        // lifeColors poison (v1.12.0): a non-array, too-few stops, or any non-finite / unparseable
        // stop must fail closed in buildLifeRamp (return null -> the body paints the flat colors[i]),
        // never crash the burst and never reach a draw. parseOklch THROWS on a bad string -- the
        // try/catch must swallow it. A VALID ramp is finite by construction (a color, not a position).
        ['lifeColors:NaN', { count: 60, lifeColors: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['lifeColors:nonarray', { count: 60, lifeColors: 42, lifeMin: 0.3, lifeMax: 0.3 }],
        ['lifeColors:[]', { count: 60, lifeColors: [], lifeMin: 0.3, lifeMax: 0.3 }],
        ['lifeColors:[one]', { count: 60, lifeColors: [{ l: 0.7, c: 0.2, h: 40 }], lifeMin: 0.3, lifeMax: 0.3 }],
        ['lifeColors:[badnum]', { count: 60, lifeColors: [{ l: NaN, c: 0, h: 0 }, { l: 0.5, c: 0.1, h: 10 }], lifeMin: 0.3, lifeMax: 0.3 }],
        ['lifeColors:[badstr]', { count: 60, lifeColors: ['not-a-color', 'also-bad'], lifeMin: 0.3, lifeMax: 0.3 }],
        ['lifeColors:valid+box', { count: 60, floor: 200, bounce: 0.5, gravity: 3000, lifeColors: [{ l: 0.98, c: 0.02, h: 90 }, { l: 0.3, c: 0.15, h: 20 }], lifeMin: 0.3, lifeMax: 0.3 }],
        // emit poison (v1.13.0): an unknown/non-string shape or a non-positive/non-finite/huge size
        // must fail closed to EMIT_OFF (a point spawn) -- never a NaN origin at a draw. A VALID emitter
        // in a box is finite by construction (the origin is an offset of the finite burst center).
        ['emit:unknown', { count: 60, emit: 'arc', emitSize: 100, lifeMin: 0.3, lifeMax: 0.3 }],
        ['emit:nonstring', { count: 60, emit: 42, emitSize: 100, lifeMin: 0.3, lifeMax: 0.3 }],
        ['emit:size-NaN', { count: 60, emit: 'box', emitSize: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['emit:size-0', { count: 60, emit: 'ring', emitSize: 0, lifeMin: 0.3, lifeMax: 0.3 }],
        ['emit:size-neg', { count: 60, emit: 'line', emitSize: -50, lifeMin: 0.3, lifeMax: 0.3 }],
        ['emit:size-huge', { count: 60, emit: 'box', emitSize: 1e9, lifeMin: 0.3, lifeMax: 0.3 }],
        ['emit:size-Infinity', { count: 60, emit: 'ring', emitSize: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['emit:no-size', { count: 60, emit: 'ring', lifeMin: 0.3, lifeMax: 0.3 }],
        ['emit:valid+box', { count: 60, emit: 'box', emitSize: 120, floor: 300, bounce: 0.5, gravity: 3000, lifeMin: 0.3, lifeMax: 0.3 }],
        // stagger poison (v1.14.0): garbage windows must coerce to 0 (synchronous spawn); the delay is
        // a time offset, so a bad value can never yield a non-finite draw position. A VALID stagger in
        // a bouncing box confirms the birth gate stays finite while pieces are still being born.
        ['stagger:NaN', { count: 60, stagger: NaN, lifeMin: 0.3, lifeMax: 0.3 }],
        ['stagger:neg', { count: 60, stagger: -200, lifeMin: 0.3, lifeMax: 0.3 }],
        ['stagger:0', { count: 60, stagger: 0, lifeMin: 0.3, lifeMax: 0.3 }],
        ['stagger:Infinity', { count: 60, stagger: Infinity, lifeMin: 0.3, lifeMax: 0.3 }],
        ['stagger:nonnumeric', { count: 60, stagger: 'later', lifeMin: 0.3, lifeMax: 0.3 }],
        ['stagger:valid+box', { count: 60, stagger: 250, floor: 300, bounce: 0.5, gravity: 3000, lifeMin: 0.6, lifeMax: 0.6 }],
        // align poison (v1.15.0): garbage blends coerce via clamp01 (non-finite/negative -> 0, > 1 -> 1);
        // the render rotation is atan2(vy,vx) blended toward spin, finite for any finite velocity, so a
        // bad align can never yield a non-finite draw. A VALID align in a bouncing box confirms the
        // aligned rotation stays finite while forces bend the velocity every frame.
        ['align:NaN', { count: 60, align: NaN, wind: 500, lifeMin: 0.3, lifeMax: 0.3 }],
        ['align:neg', { count: 60, align: -3, wind: 500, lifeMin: 0.3, lifeMax: 0.3 }],
        ['align:huge', { count: 60, align: 1e9, wind: 500, lifeMin: 0.3, lifeMax: 0.3 }],
        ['align:Infinity', { count: 60, align: Infinity, wind: 500, lifeMin: 0.3, lifeMax: 0.3 }],
        ['align:nonnumeric', { count: 60, align: 'lots', wind: 500, lifeMin: 0.3, lifeMax: 0.3 }],
        ['align:valid+box', { count: 60, align: 1, floor: 300, bounce: 0.5, gravity: 3000, wind: 800, lifeMin: 0.6, lifeMax: 0.6 }],
        // spinRate poison (v1.16.0): garbage multipliers coerce via num (non-finite/non-numeric -> 1);
        // the render rotation is spin0 + (spin - spin0) * rate -- a bounded seeded angle times a finite
        // multiplier, so 0 / negative / 1e6 are all VALID and can never yield a non-finite draw. Armed
        // with turbulence + wind so the [:824] curl read runs beside the render scale every frame.
        ['spinRate:NaN', { count: 60, spinRate: NaN, turbulence: 400, wind: 500, lifeMin: 0.3, lifeMax: 0.3 }],
        ['spinRate:Infinity', { count: 60, spinRate: Infinity, turbulence: 400, wind: 500, lifeMin: 0.3, lifeMax: 0.3 }],
        ['spinRate:-Infinity', { count: 60, spinRate: -Infinity, turbulence: 400, wind: 500, lifeMin: 0.3, lifeMax: 0.3 }],
        ['spinRate:nonnumeric', { count: 60, spinRate: 'fast', turbulence: 400, wind: 500, lifeMin: 0.3, lifeMax: 0.3 }],
        ['spinRate:0', { count: 60, spinRate: 0, turbulence: 400, wind: 500, lifeMin: 0.3, lifeMax: 0.3 }],
        ['spinRate:neg', { count: 60, spinRate: -2, turbulence: 400, wind: 500, lifeMin: 0.3, lifeMax: 0.3 }],
        ['spinRate:huge', { count: 60, spinRate: 1e6, turbulence: 400, wind: 500, lifeMin: 0.3, lifeMax: 0.3 }],
        // scaleTo poison (v1.17.0): garbage targets coerce via nonneg (non-finite/non-numeric/negative
        // -> the default 1 for garbage, 0 for a negative). The render fold is 1 + (scaleTo - 1)*(1 - lifeT)
        // -- a bounded age fraction times a finite, non-negative target -- so 0 / 1e-9 / 1e6 are all VALID
        // and can never yield a non-finite draw. Armed with turbulence + wind + a bouncing box so the
        // render size fold runs beside live physics every frame.
        ['scaleTo:NaN', { count: 60, scaleTo: NaN, turbulence: 400, wind: 500, floor: 300, bounce: 0.5, lifeMin: 0.3, lifeMax: 0.3 }],
        ['scaleTo:Infinity', { count: 60, scaleTo: Infinity, turbulence: 400, wind: 500, floor: 300, bounce: 0.5, lifeMin: 0.3, lifeMax: 0.3 }],
        ['scaleTo:-Infinity', { count: 60, scaleTo: -Infinity, turbulence: 400, wind: 500, floor: 300, bounce: 0.5, lifeMin: 0.3, lifeMax: 0.3 }],
        ['scaleTo:nonnumeric', { count: 60, scaleTo: 'big', turbulence: 400, wind: 500, floor: 300, bounce: 0.5, lifeMin: 0.3, lifeMax: 0.3 }],
        ['scaleTo:null', { count: 60, scaleTo: null, turbulence: 400, wind: 500, floor: 300, bounce: 0.5, lifeMin: 0.3, lifeMax: 0.3 }],
        ['scaleTo:0', { count: 60, scaleTo: 0, turbulence: 400, wind: 500, floor: 300, bounce: 0.5, lifeMin: 0.3, lifeMax: 0.3 }],
        ['scaleTo:neg', { count: 60, scaleTo: -5, turbulence: 400, wind: 500, floor: 300, bounce: 0.5, lifeMin: 0.3, lifeMax: 0.3 }],
        ['scaleTo:tiny', { count: 60, scaleTo: 1e-9, turbulence: 400, wind: 500, floor: 300, bounce: 0.5, lifeMin: 0.3, lifeMax: 0.3 }],
        ['scaleTo:huge', { count: 60, scaleTo: 1e6, turbulence: 400, wind: 500, floor: 300, bounce: 0.5, lifeMin: 0.3, lifeMax: 0.3 }],
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

    // --- trails (v1.9.0) FAIL CLOSED: a garbage construction `trail` capacity coerces to
    //     off (0) or the TRAIL_MAX cap -- never a huge allocation or a throw -- and a garbage
    //     per-burst `trail` length coerces safely. Under assertFinite the stroked ribbon points
    //     (moveTo/lineTo) are finiteness-checked too, so a NaN reaching the trail is a hard
    //     throw, not an invisible pixel. --------------------------------------------------
    {
        // Construction-time capacity poison: NaN/-5/Infinity/string/null => off (0); 1e9 => 64.
        for (const cap of [NaN, -5, Infinity, 1e9, 'x', null]) {
            const cv = makeCanvas({ assertFinite: true });
            const c = createConfetti(cv, { seed: 4, maxParticles: CAP, trail: cap });
            const err = capture(() => {
                c.burst({ count: 40, wind: 200, turbulence: 300, lifeMin: 0.3, lifeMax: 0.3 });
                for (let f = 0; f < 30; f++) pump(1, 50);
            });
            check(err === null, () => `T1 trail-cap ${String(cap)}: threw or drew a non-finite trail point (${err && err.message})`);
            check(c.count === 0, () => `T1 trail-cap ${String(cap)}: pool did not drain (count ${c.count})`);
            c.destroy();
        }
        // Per-burst draw-length poison on a trail-capable instance: each coerces (full/off/capped)
        // with no non-finite stroked point and no immortal pool.
        for (const len of [NaN, -5, Infinity, 1e9]) {
            const cv = makeCanvas({ assertFinite: true });
            const c = createConfetti(cv, { seed: 4, maxParticles: CAP, trail: 20 });
            const err = capture(() => {
                c.burst({ count: 40, trail: len, wind: 200, turbulence: 300, lifeMin: 0.3, lifeMax: 0.3 });
                for (let f = 0; f < 30; f++) pump(1, 50);
            });
            check(err === null, () => `T1 trail-len ${String(len)}: threw or drew a non-finite trail point (${err && err.message})`);
            check(c.count === 0, () => `T1 trail-len ${String(len)}: pool did not drain (count ${c.count})`);
            c.destroy();
        }
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
