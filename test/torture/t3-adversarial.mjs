/**
 * T3 -- adversarial op orders and lifecycle abuse.
 *
 * lite-bvh's T3 hammers pathological insert orders; confetti's analog is
 * pathological CALL orders against the live render loop: overflow every frame,
 * destroy mid-flight, clear during a following spray, reduced-motion flips, and
 * pointer bind/unbind churn. The pool must survive all of it -- no throw, count
 * always in bounds -- and every window-level resource (pointer listeners) must be
 * conserved: whatever a sequence binds, destroy() must release, so the tier ends at
 * the exact pointer-listener count it started with.
 */

import {
    createConfetti, makeCanvas, pump, setReducedMotion, firePointerMove,
    pointerListenerCount, check, capture,
} from './harness.mjs';

const CAP = 256;

function fresh(seed = 5, maxParticles = CAP) {
    return createConfetti(makeCanvas(), { seed, maxParticles });
}

export function run() {
    const baseListeners = pointerListenerCount();

    // A1 -- emit-to-overflow every frame for a long run. Ring buffer churns hard;
    // count must never exceed cap and never throw.
    {
        const c = fresh();
        const err = capture(() => {
            for (let f = 0; f < 3000; f++) {
                c.burst({ count: 40, lifeMin: 0.5, lifeMax: 1.5, shape: f % 2 ? 'circle' : 'rect' });
                pump(1, 16);
                check(c.count <= CAP, () => `T3 A1: count ${c.count} exceeded cap ${CAP} at frame ${f}`);
            }
        });
        check(err === null, () => `T3 A1: threw ${err && err.message}`);
        c.destroy();
    }

    // A2 -- destroy() mid-pump stops the render loop AND reports zero. Pre-1.3.1
    // destroy() zeroed pool.life but not aliveCount, so count froze at its last value
    // (the stale-count quirk decision 0002 documented). Decision 0004 fixed it:
    // destroy() now zeroes aliveCount too, so count reads 0 immediately and the
    // conservation probe (__stats) shows 0 live slots. The ticker must also be truly
    // OFF: pumping after destroy() drives nothing.
    {
        const c = fresh();
        let atDestroy = -1;
        const err = capture(() => {
            c.burst({ count: 100, lifeMin: 5, lifeMax: 5 });
            pump(3, 16);
            c.destroy();
            atDestroy = c.count;
            pump(10, 16); // ticker was unregistered; must drive nothing for this instance
        });
        check(err === null, () => `T3 A2: threw ${err && err.message}`);
        check(atDestroy === 0, () => `T3 A2: destroy() left count ${atDestroy} != 0 -- the stale-count bug is back`);
        check(c.count === 0, () => `T3 A2: count moved to ${c.count} after destroy() -- render loop still running`);
        const s = c.__stats();
        check(s.aliveActual === 0 && s.aliveGetter === 0, () =>
            `T3 A2: __stats after destroy shows getter=${s.aliveGetter} actual=${s.aliveActual}, both must be 0`);
    }

    // A7 -- conservation: the count getter must equal the true live-slot count at every
    // checkpoint of a churning soak (the getter never drifts from the pool). __stats is
    // the non-enumerable white-box probe decision 0002 deferred and 0004 landed.
    {
        const c = fresh(17);
        const err = capture(() => {
            for (let f = 0; f < 400; f++) {
                c.burst({ count: 12, lifeMin: 0.4, lifeMax: 1.2, shape: f % 3 ? 'rect' : 'star' });
                pump(1, 16);
                if (f % 17 === 0) {
                    const s = c.__stats();
                    check(s.aliveGetter === s.aliveActual, () =>
                        `T3 A7: conservation broke at frame ${f} -- count getter ${s.aliveGetter} != live slots ${s.aliveActual}`);
                    check(s.aliveActual <= s.cap, () => `T3 A7: live ${s.aliveActual} > cap ${s.cap} at frame ${f}`);
                }
            }
            c.clear();
            const s = c.__stats();
            check(s.aliveGetter === 0 && s.aliveActual === 0, () =>
                `T3 A7: after clear() getter=${s.aliveGetter} actual=${s.aliveActual}, both must be 0`);
        });
        check(err === null, () => `T3 A7: threw ${err && err.message}`);
        c.destroy();
    }

    // A3 -- double (and triple) destroy is idempotent.
    {
        const c = fresh();
        c.burst({ count: 30 });
        pump(1, 16);
        const err = capture(() => { c.destroy(); c.destroy(); c.destroy(); });
        check(err === null, () => `T3 A3: repeated destroy threw ${err && err.message}`);
    }

    // A4 -- clear() and reseed WHILE a following spray is live, then destroy. The
    // pointer listener bound by followPointer must be released by destroy().
    {
        const c = fresh();
        const err = capture(() => {
            c.spray({ followPointer: true, duration: 1e9, rate: 8 });
            pump(2, 16);
            check(pointerListenerCount() === baseListeners + 1,
                () => `T3 A4: followPointer did not bind exactly one listener ` +
                      `(${pointerListenerCount()} vs base ${baseListeners})`);
            firePointerMove(300, 200);
            pump(2, 16);
            c.clear();          // clear mid-spray
            c.seed(99);         // reseed mid-spray
            c.burst({ count: 20 });
            pump(2, 16);
        });
        check(err === null, () => `T3 A4: threw ${err && err.message}`);
        c.destroy();
        check(pointerListenerCount() === baseListeners,
            () => `T3 A4: destroy() leaked a pointer listener ` +
                  `(${pointerListenerCount()} vs base ${baseListeners})`);
    }

    // A5 -- reduced-motion toggled mid-flight across bursts. No throw, count bounded.
    {
        const c = fresh();
        const err = capture(() => {
            c.burst({ count: 50, lifeMin: 5, lifeMax: 5 }); pump(2, 16);
            setReducedMotion(true);
            c.burst({ count: 50 }); pump(2, 16);     // static path
            setReducedMotion(false);
            c.burst({ count: 50, lifeMin: 5, lifeMax: 5 }); pump(2, 16);
            check(c.count <= CAP, () => `T3 A5: count ${c.count} > cap ${CAP}`);
        });
        setReducedMotion(false);
        check(err === null, () => `T3 A5: threw ${err && err.message}`);
        c.destroy();
    }

    // A6 -- many short-lived following sprays across many instances: every bind is
    // matched by a destroy, so the global pointer-listener count returns to base.
    {
        const err = capture(() => {
            for (let k = 0; k < 200; k++) {
                const c = fresh(k);
                c.spray({ followPointer: true, duration: 1e9 });
                pump(1, 16);
                c.destroy();
            }
        });
        check(err === null, () => `T3 A6: threw ${err && err.message}`);
        check(pointerListenerCount() === baseListeners,
            () => `T3 A6: 200 bind/destroy cycles leaked ${pointerListenerCount() - baseListeners} listener(s)`);
    }

    // A8 -- pool-recycle retention for scaleTo (v1.17.0). scaleTo is ALWAYS written at spawn (never
    // zero-init), so a recycled slot cannot inherit a prior burst's target. A single-slot pool
    // (maxParticles:1) FORCES slot 0 reuse: fire 5 "vanish at death" (scaleTo:0) pieces, expiring each
    // so the pool drains to 0 every cycle, then a PLAIN burst (default scaleTo 1) into the same recycled
    // slot. With scaleTo reset to 1 the render leaves ctx.scale's Y factor at EXACTLY 1 (the guard is
    // false -- an exact identity, robust to dt); a leaked scaleTo:0 would instead fold s = lifeT < 1.
    // lastScale (flutter 0, so the recorded Y factor is the pure size fold) is the witness.
    {
        const canvas = makeCanvas({ record: true });
        const c = createConfetti(canvas, { seed: 7, maxParticles: 1 });
        const err = capture(() => {
            for (let cycle = 0; cycle < 5; cycle++) {
                c.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 0,
                    scaleTo: 0, lifeMin: 0.3, lifeMax: 0.3 });
                for (let f = 0; f < 20; f++) pump(1, 50);
                check(c.count === 0, () => `T3 A8: cycle ${cycle} single-slot pool did not drain the scaleTo:0 piece (count ${c.count})`);
            }
            // Recycle slot 0 with a constant-size piece; its Y size factor must be exactly 1.
            c.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 0,
                lifeMin: 5, lifeMax: 5 });
            pump(1, 100);
            check(c.count === 1, () => `T3 A8: recycled plain burst did not spawn (count ${c.count})`);
            check(canvas.lastScale === 1, () =>
                `T3 A8: a recycled slot leaked a stale scaleTo -- Y size factor ${canvas.lastScale} != 1`);
        });
        check(err === null, () => `T3 A8: threw ${err && err.message}`);
        c.destroy();
    }

    // A9 -- pool-recycle retention for flutterRate (v1.18.0). flutterRate is ALWAYS written at spawn (never
    // zero-init), so a recycled slot cannot inherit a prior burst's rate. A single-slot pool
    // (maxParticles:1) FORCES slot 0 reuse: fire 5 "frozen wobble" (flutterRate:0) pieces, expiring each so
    // the pool drains to 0 every cycle, then a PLAIN burst (default flutterRate 1) into the same recycled
    // slot. With flutterRate reset to 1 the render feeds the RAW advancing tilt (the guard is false), so the
    // recorded X wobble factor VARIES again frame to frame; a leaked flutterRate:0 would instead freeze it.
    // lastScaleX (flutter 1, so the X factor is the pure wobble) is the witness, and the plain burst must
    // reproduce the canonical single-slot position stream.
    {
        const canvas = makeCanvas({ record: true });
        const c = createConfetti(canvas, { seed: 7, maxParticles: 1 });
        const err = capture(() => {
            for (let cycle = 0; cycle < 5; cycle++) {
                c.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 1,
                    flutterRate: 0, lifeMin: 0.3, lifeMax: 0.3 });
                for (let f = 0; f < 20; f++) pump(1, 50);
                check(c.count === 0, () => `T3 A9: cycle ${cycle} single-slot pool did not drain the flutterRate:0 piece (count ${c.count})`);
            }
            // Recycle slot 0 with a default-rate piece; its X wobble factor must VARY across frames.
            c.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 1,
                lifeMin: 5, lifeMax: 5 });
            let lo = Infinity, hi = -Infinity;
            for (let f = 0; f < 8; f++) { pump(1, 100); const v = canvas.lastScaleX; if (v < lo) lo = v; if (v > hi) hi = v; }
            check(c.count === 1, () => `T3 A9: recycled plain burst did not spawn (count ${c.count})`);
            check(hi - lo > 1e-6, () =>
                `T3 A9: a recycled slot leaked a stale flutterRate:0 -- the X wobble factor stayed frozen (swing ${hi - lo})`);
        });
        check(err === null, () => `T3 A9: threw ${err && err.message}`);
        c.destroy();
    }

    check(pointerListenerCount() === baseListeners,
        () => `T3: tier leaked ${pointerListenerCount() - baseListeners} pointer listener(s) overall`);
}
