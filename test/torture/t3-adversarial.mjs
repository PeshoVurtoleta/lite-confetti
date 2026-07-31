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

    // A2 -- destroy() mid-pump stops the render loop. Note: destroy() zeroes the
    // pool's life but NOT the count getter (only clear()/update() touch aliveCount),
    // so count freezes at its last integrated value -- a documented stale-count quirk
    // (see decisions/0002). The load-bearing invariant is that the ticker is truly
    // OFF: pumping after destroy() must not change count for this instance.
    {
        const c = fresh();
        let frozen = -1;
        const err = capture(() => {
            c.burst({ count: 100, lifeMin: 5, lifeMax: 5 });
            pump(3, 16);
            c.destroy();
            frozen = c.count;
            pump(10, 16); // ticker was unregistered; must drive nothing for this instance
        });
        check(err === null, () => `T3 A2: threw ${err && err.message}`);
        check(c.count === frozen, () =>
            `T3 A2: count changed ${frozen} -> ${c.count} after destroy() -- render loop still running`);
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

    check(pointerListenerCount() === baseListeners,
        () => `T3: tier leaked ${pointerListenerCount() - baseListeners} pointer listener(s) overall`);
}
