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

    // A10 -- pool-recycle retention for fadeIn (v1.19.0). fadeIn is ALWAYS written at spawn (never zero-init,
    // though here the Float32 zero happens to coincide with "off"), so a recycled slot cannot inherit a prior
    // burst's ramp. A single-slot pool (maxParticles:1) FORCES slot 0 reuse: fire 5 "materialize in" (fadeIn:1)
    // pieces, expiring each so the pool drains to 0 every cycle, then a PLAIN burst (default fadeIn 0) into the
    // same recycled slot. With fadeIn reset to 0 the render leaves globalAlpha at EXACTLY 1 on the first drawn
    // frame (birth is instant-on; the death fade only starts in the last 30% of life -- the `> 0` guard is
    // false, an exact identity robust to dt); a leaked fadeIn:1 would instead ramp the first frame far below 1.
    // lastAlpha (single piece, no trail, so the recorded value is the pure body alpha) is the witness.
    {
        const canvas = makeCanvas({ record: true });
        const c = createConfetti(canvas, { seed: 7, maxParticles: 1 });
        const err = capture(() => {
            for (let cycle = 0; cycle < 5; cycle++) {
                c.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1,
                    fadeIn: 1, lifeMin: 0.3, lifeMax: 0.3 });
                for (let f = 0; f < 20; f++) pump(1, 50);
                check(c.count === 0, () => `T3 A10: cycle ${cycle} single-slot pool did not drain the fadeIn:1 piece (count ${c.count})`);
            }
            // Recycle slot 0 with an instant-on piece; its first-frame body alpha must be EXACTLY 1.
            c.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1,
                lifeMin: 5, lifeMax: 5 });
            pump(1, 16);
            check(c.count === 1, () => `T3 A10: recycled plain burst did not spawn (count ${c.count})`);
            check(canvas.lastAlpha === 1, () =>
                `T3 A10: a recycled slot leaked a stale fadeIn -- first-frame body alpha ${canvas.lastAlpha} != 1`);
        });
        check(err === null, () => `T3 A10: threw ${err && err.message}`);
        c.destroy();
    }

    // A11 -- pool-recycle retention for fadeOut (v1.20.0). fadeOut is UNCONDITIONALLY written at spawn --
    // LOAD-BEARING, since a Float32 zero-init would mean "hard cut" (a WRONG default), so a recycled slot
    // that skipped the write would render a piece that never fades out. UNLIKE fadeIn (A10), the witness
    // canNOT be a first-frame lastAlpha===1: fadeOut acts at DEATH, so alpha is 1 at birth for ANY window
    // (non-discriminating). Instead sample a LATE frame INSIDE the default fade window and compare the
    // recycled slot against a FRESH reference. A leaked fadeOut:0 (hard cut) would read 1 while the fresh
    // default reads < 1 -> divergence. Equal + strictly < 1 proves the spawn write overwrote the stale value
    // AND that we are genuinely in the window. A lastAlpha SNAPSHOT compare, not a cumulative-hash replay.
    {
        const lateAlpha = (c, canvas) => {
            c.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 0,
                lifeMin: 0.5, lifeMax: 0.5 });
            pump(1, 1000);
            for (let f = 0; f < 25; f++) pump(1, 16);
            return canvas.lastAlpha;
        };
        const canvasA = makeCanvas({ record: true });
        const cA = createConfetti(canvasA, { seed: 7, maxParticles: 1 });
        const canvasB = makeCanvas({ record: true });
        const cB = createConfetti(canvasB, { seed: 7, maxParticles: 1 });
        const err = capture(() => {
            for (let cycle = 0; cycle < 5; cycle++) {
                cA.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 0,
                    fadeOut: 0, lifeMin: 0.5, lifeMax: 0.5 });
                for (let f = 0; f < 20; f++) pump(1, 50);
                check(cA.count === 0, () => `T3 A11: cycle ${cycle} single-slot pool did not drain the fadeOut:0 piece (count ${cA.count})`);
            }
            const aAlpha = lateAlpha(cA, canvasA);   // recycled slot, plain (default) burst
            const bAlpha = lateAlpha(cB, canvasB);   // fresh reference, same plain burst
            check(aAlpha === bAlpha, () =>
                `T3 A11: a recycled slot leaked a stale fadeOut -- late body alpha ${aAlpha} != fresh ${bAlpha}`);
            check(aAlpha < 1, () =>
                `T3 A11: the retention witness must sample INSIDE the fade window (got ${aAlpha}, not < 1)`);
        });
        check(err === null, () => `T3 A11: threw ${err && err.message}`);
        cA.destroy();
        cB.destroy();
    }

    // A12 -- pool-recycle retention for friction (v1.21.0). friction is ALWAYS written at spawn for
    // pool-reuse correctness; UNLIKE fadeOut its Float32 zero-init 0 already means "off", so the write is
    // NOT load-bearing, but this tier proves the reset holds regardless. friction acts DURING FLIGHT (at
    // floor contact), not at death, so there is no late-frame constraint -- BUT the position/sumX stream is
    // lifetime-CUMULATIVE, so the witness is a hash-neutral sumX SNAPSHOT DELTA, NOT "a following burst
    // reproduces FLOOR_HASH" (the cumulative-hash trap). A single-slot pool forces slot 0 reuse: fire 5
    // friction:0.9 floor-skid bursts, draining each, then RESEED (so the plain burst draws the identical rng
    // sequence as a fresh instance) and fire a plain friction:0 floor burst; its sumX delta must equal a
    // fresh instance's plain-burst sumX. A leaked friction:0.9 would have damped the recycled plain burst's
    // skid -> a smaller sumX delta. Separately, an armed friction:0.9 burst's sumX must differ from the
    // plain one (the witness is non-vacuous).
    {
        const RSEED = 7;
        const floorSkid = { count: 1, x: 400, y: 150, speed: 300, spread: 0.6, gravity: 900,
            floor: 360, wind: 800, bounce: 0, lifeMin: 1.0, lifeMax: 1.0 };
        // The shared Ticker caps its FIRST tick's dt (16.66ms vs 16ms), a process-global one-off that
        // perturbs the very first burst's trajectory by a few integer pixels. Consume it with a throwaway
        // instance so the cumulative sumX witness below compares like-for-like. Each measured instance is
        // then the SOLE live one (destroyed before the next), so no coexisting ticker callback can perturb it.
        const warm = createConfetti(makeCanvas(), { seed: 1, maxParticles: 1 });
        warm.burst({ count: 1, lifeMin: 0.1, lifeMax: 0.1 });
        for (let f = 0; f < 12; f++) pump(1, 16);
        warm.destroy();
        // A plain (friction:0) floor burst's own sumX contribution, isolated as a delta: after the pool has
        // drained, sumX is frozen, so (after - before) is exactly the plain burst's draws. c.seed() aligns
        // the rng with a fresh instance so ONLY a leaked friction could move the result.
        const plainDelta = (c, canvas) => {
            // Consume the ticker's capped first tick: acquireTicker's start() resets _lastTime to the
            // real wall clock, so the FIRST pumped frame after a fresh instance sees dt > maxDt and caps
            // to 16.66ms (vs the 16ms of every later frame). Instance A enters here with a ticker already
            // primed by its drain pumps, while instance B is freshly created -- so without this prime the
            // plain burst's first frame would be 16ms on A but 16.66ms on B, an ~8px cumulative-sumX skew
            // unrelated to friction. The pool is empty here, so the prime draws nothing and moves no sumX.
            pump(1, 16);
            c.seed(RSEED);
            const before = canvas.sumX;
            c.burst({ ...floorSkid, friction: 0 });
            for (let f = 0; f < 70; f++) pump(1, 16);
            return canvas.sumX - before;
        };
        const err = capture(() => {
            // A: recycle slot 0 through 5 armed friction:0.9 skids (draining each), then a plain burst.
            const canvasA = makeCanvas({ record: true });
            const cA = createConfetti(canvasA, { seed: RSEED, maxParticles: 1 });
            for (let cycle = 0; cycle < 5; cycle++) {
                cA.burst({ ...floorSkid, friction: 0.9 });
                // Pump UNCONDITIONALLY past the 1.0s life to genuinely empty slot 0 (30x50ms = 1500ms),
                // matching A8-A11/A14-A16. A bare `while (count > 0)` never enters: the count getter
                // reflects aliveCount, refreshed only inside update(), so it is stale (0) right after a
                // burst. Under v1.26.0 drop-new-when-full a still-live slot BLOCKS the next re-spawn, so
                // the drain MUST actually reach life 0 for the recycle-retention witness to be real.
                for (let f = 0; f < 30; f++) pump(1, 50);
                check(cA.count === 0, () => `T3 A12: cycle ${cycle} single-slot pool did not drain the friction:0.9 piece (count ${cA.count})`);
            }
            const aDelta = plainDelta(cA, canvasA);   // recycled slot, plain (friction:0) burst
            cA.destroy();
            // B: fresh instance, only the plain burst (measured as the sole live instance).
            const canvasB = makeCanvas({ record: true });
            const cB = createConfetti(canvasB, { seed: RSEED, maxParticles: 1 });
            const bDelta = plainDelta(cB, canvasB);
            cB.destroy();
            check(aDelta === bDelta, () =>
                `T3 A12: a recycled slot leaked a stale friction -- plain-burst sumX delta ${aDelta} != fresh ${bDelta}`);
            // Non-vacuous: an ARMED friction:0.9 skid draws a DIFFERENT sumX than the plain one (friction
            // genuinely damps the slide), so the equality above is a real proof, not comparing constants.
            const canvasC = makeCanvas({ record: true });
            const cC = createConfetti(canvasC, { seed: RSEED, maxParticles: 1 });
            cC.seed(RSEED);
            cC.burst({ ...floorSkid, friction: 0.9 });
            for (let f = 0; f < 70; f++) pump(1, 16);
            const armedDelta = canvasC.sumX;
            cC.destroy();
            check(armedDelta !== bDelta, () =>
                `T3 A12: friction:0.9 did not change the skid sumX vs friction:0 (${armedDelta} == ${bDelta}) -- the witness is vacuous`);
        });
        check(err === null, () => `T3 A12: threw ${err && err.message}`);
    }

    // A13 -- pool-recycle retention for wallFriction (v1.22.0), the A12 pattern applied to a WALL slide.
    // wallFriction is ALWAYS written at spawn for pool-reuse correctness; like friction its Float32 zero-init
    // 0 already means "off", so the write is NOT load-bearing, but this tier proves the reset holds. The
    // witness is the hash-neutral maxY (the deepest a piece descended), NOT a cumulative-hash replay (per the
    // retention-phrasing rule): the wall-slide rig pins each piece to the right wall (wind INTO it, bounce 0)
    // so the wall vy-damp fires every frame -- a wallFriction:0.9 piece descends SHALLOWLY, a plain
    // wallFriction:0 piece descends DEEPEST. A single-slot pool forces slot 0 reuse: fire 5 wallFriction:0.9
    // wall-slide bursts (draining each), then a plain wallFriction:0 burst; because the plain burst descends
    // deepest, instance A's cumulative maxY equals a FRESH instance B's plain-burst maxY. A leaked
    // wallFriction:0.9 would have damped the recycled plain burst's descent -> a SHALLOWER (smaller) maxY.
    {
        const RSEED = 11;
        const wallSkid = { count: 1, x: 300, y: 150, speed: 300, spread: 0.6, gravity: 900,
            wallRight: 450, wind: 1500, bounce: 0, lifeMin: 1.0, lifeMax: 1.0 };
        // maxY of a plain (wallFriction:0) wall-slide burst on instance `c`. maxY is a cumulative running max
        // on the canvas, but the plain burst descends deepest, so after it drains the canvas maxY IS the plain
        // burst's deepest reach. c.seed() aligns the rng with a fresh instance so ONLY a leaked wallFriction moves it.
        const plainMaxY = (c, canvas) => {
            // Consume the ticker's capped first tick (see A12's plainDelta): instance A is primed by its
            // drain pumps while instance B is freshly created, so without this prime the plain burst's
            // first frame would be 16ms on A but 16.66ms on B -- a maxY skew unrelated to wallFriction.
            // The pool is empty here, so the prime draws nothing and moves no maxY.
            pump(1, 16);
            c.seed(RSEED);
            c.burst({ ...wallSkid, wallFriction: 0 });
            for (let f = 0; f < 70; f++) pump(1, 16);
            return canvas.maxY;
        };
        const err = capture(() => {
            // A: recycle slot 0 through 5 armed wallFriction:0.9 wall-slides (draining each), then a plain burst.
            const canvasA = makeCanvas({ record: true });
            const cA = createConfetti(canvasA, { seed: RSEED, maxParticles: 1 });
            for (let cycle = 0; cycle < 5; cycle++) {
                cA.burst({ ...wallSkid, wallFriction: 0.9 });
                // Pump UNCONDITIONALLY past the 1.0s life to genuinely empty slot 0 (30x50ms = 1500ms),
                // matching A8-A11/A14-A16. A bare `while (count > 0)` never enters: the count getter is
                // stale (0) right after a burst (aliveCount refreshes only in update()). Under v1.26.0
                // drop-new-when-full a still-live slot BLOCKS the next re-spawn, so the drain MUST reach
                // life 0 for the recycle-retention witness to be real.
                for (let f = 0; f < 30; f++) pump(1, 50);
                check(cA.count === 0, () => `T3 A13: cycle ${cycle} single-slot pool did not drain the wallFriction:0.9 piece (count ${cA.count})`);
            }
            const aMaxY = plainMaxY(cA, canvasA);   // recycled slot, plain (wallFriction:0) burst descends deepest
            cA.destroy();
            // B: fresh instance, only the plain burst (measured as the sole live instance).
            const canvasB = makeCanvas({ record: true });
            const cB = createConfetti(canvasB, { seed: RSEED, maxParticles: 1 });
            const bMaxY = plainMaxY(cB, canvasB);
            cB.destroy();
            check(aMaxY === bMaxY, () =>
                `T3 A13: a recycled slot leaked a stale wallFriction -- plain-burst maxY ${aMaxY} != fresh ${bMaxY}`);
            // Non-vacuous: an ARMED wallFriction:0.9 wall-slide reaches a SHALLOWER maxY than the plain one
            // (the vy damp genuinely shortens the descent), so the equality above is a real proof.
            const canvasC = makeCanvas({ record: true });
            const cC = createConfetti(canvasC, { seed: RSEED, maxParticles: 1 });
            cC.seed(RSEED);
            cC.burst({ ...wallSkid, wallFriction: 0.9 });
            for (let f = 0; f < 70; f++) pump(1, 16);
            const armedMaxY = canvasC.maxY;
            cC.destroy();
            check(armedMaxY !== bMaxY, () =>
                `T3 A13: wallFriction:0.9 did not change the wall-slide maxY vs wallFriction:0 (${armedMaxY} == ${bMaxY}) -- the witness is vacuous`);
        });
        check(err === null, () => `T3 A13: threw ${err && err.message}`);
    }

    // A14 -- pool-recycle retention for spinDrag (v1.23.0). spinDrag is UNCONDITIONALLY written at spawn --
    // LOAD-BEARING (like scaleTo/flutterRate/fadeOut), since a Float32 zero-init would mean "instant spin
    // freeze" (a WRONG default), so a recycled slot must never inherit a prior burst's retention. A single-slot
    // pool FORCES slot 0 reuse: run 5 drain cycles arming the retention, then RESEED and fire a PLAIN burst
    // (default spinDrag 1) into the recycled slot. The witness is `lastRotate` -- a hash-neutral SNAPSHOT of the
    // current tumble angle, NOT a cumulative-hash replay (canvas.hash is cumulative and would false-fail; see
    // the retention rule). The control B runs the IDENTICAL 5-cycle history but arms spinDrag:1 (off): both
    // instances then share the same ticker stop/restart timing -- the first-frame dt after each drained idle
    // depends on it, and lastRotate is a raw accumulated angle sensitive to that dt -- so the ONLY remaining
    // difference is the armed value the spawn write must overwrite. If the write leaked, A (recycled from a
    // FROZEN 0) would pin to its birth angle while B (recycled from an OFF 1) advanced, and the two would split.
    // Equal angles prove no leak; the armed-live check below keeps the witness non-vacuous.
    {
        const recycleThenPlain = (armed) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 7, maxParticles: 1 });
            for (let cycle = 0; cycle < 5; cycle++) {
                c.seed(7);
                c.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 0, align: 0,
                    spinRate: 1, turbulence: 0, spinDrag: armed, lifeMin: 0.3, lifeMax: 0.3 });
                for (let f = 0; f < 20; f++) pump(1, 50);
                check(c.count === 0, () => `T3 A14: an armed(${armed}) drain cycle left ${c.count} alive in the single-slot pool`);
            }
            c.seed(7);   // plain burst (default spinDrag 1) into the recycled slot, rng-aligned
            c.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 0, align: 0,
                spinRate: 1, turbulence: 0, lifeMin: 5, lifeMax: 5 });
            for (let f = 0; f < 10; f++) pump(1, 50);
            const r = canvas.lastRotate;
            const s = c.__stats();
            c.destroy();
            return { r, s };
        };
        const err = capture(() => {
            const A = recycleThenPlain(0);   // recycled from a FROZEN (spinDrag:0) history
            const B = recycleThenPlain(1);   // recycled from an OFF (spinDrag:1) history -- identical timing
            check(B.s.aliveActual === 1 && B.s.aliveGetter === 1, () =>
                `T3 A14: __stats after the recycled plain burst shows getter=${B.s.aliveGetter} actual=${B.s.aliveActual}, expected 1`);
            check(A.r === B.r, () =>
                `T3 A14: a recycled slot leaked a stale spinDrag -- plain-burst lastRotate ${A.r} != control ${B.r}`);
            // Non-vacuous: an ARMED spinDrag:0 burst freezes at the birth angle -- a DIFFERENT lastRotate than the plain control.
            const canvasC = makeCanvas({ record: true });
            const cC = createConfetti(canvasC, { seed: 7, maxParticles: 1 });
            cC.seed(7);
            cC.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 0, align: 0,
                spinRate: 1, turbulence: 0, spinDrag: 0, lifeMin: 5, lifeMax: 5 });
            for (let f = 0; f < 10; f++) pump(1, 50);
            const armedRotate = canvasC.lastRotate;
            cC.destroy();
            check(armedRotate !== B.r, () =>
                `T3 A14: spinDrag:0 did not change the tumble vs spinDrag:1 (${armedRotate} == ${B.r}) -- the witness is vacuous`);
        });
        check(err === null, () => `T3 A14: threw ${err && err.message}`);
    }

    // A15 -- pool-recycle retention for scaleFrom (v1.24.0). scaleFrom is UNCONDITIONALLY written at spawn --
    // LOAD-BEARING (like scaleTo/flutterRate/fadeOut), since a Float32 zero-init 0 would mean "born at zero
    // size" (invisible) -- a WRONG default -- so a recycled slot must never inherit a prior burst's origin. A
    // single-slot pool FORCES slot 0 reuse: run 5 drain cycles arming the origin, then RESEED and fire a PLAIN
    // burst (default scaleFrom 1, scaleTo 1) into the recycled slot. The witness is `lastScale` -- a hash-neutral
    // SNAPSHOT of the isotropic Y size factor (flutter 0, so it is the pure size fold), NOT a cumulative-hash
    // replay (canvas.hash is cumulative and would false-fail; see the retention rule). With both endpoints reset
    // to 1 the render leaves ctx.scale's Y factor at EXACTLY 1 (the guard is false -- an exact identity, robust
    // to dt). The control B runs the IDENTICAL 5-cycle history but arms scaleFrom:1 (off): symmetric history, so
    // the ONLY remaining difference is the armed value the spawn write must overwrite. A leaked scaleFrom:0 would
    // instead fold s = 0 + (1 - 0)*(1 - lifeT) = 1 - lifeT < 1 on the plain burst, splitting A from B. Equal
    // factors prove no leak; the armed-live check below keeps the witness non-vacuous.
    {
        const recycleThenPlain = (armed) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 7, maxParticles: 1 });
            for (let cycle = 0; cycle < 5; cycle++) {
                c.seed(7);
                c.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 0, align: 0,
                    scaleFrom: armed, scaleTo: 1, lifeMin: 0.3, lifeMax: 0.3 });
                for (let f = 0; f < 20; f++) pump(1, 50);
                check(c.count === 0, () => `T3 A15: an armed(${armed}) drain cycle left ${c.count} alive in the single-slot pool`);
            }
            c.seed(7);   // plain burst (default scaleFrom 1, scaleTo 1) into the recycled slot, rng-aligned
            c.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 0, align: 0,
                lifeMin: 5, lifeMax: 5 });
            for (let f = 0; f < 10; f++) pump(1, 50);
            const ls = canvas.lastScale;
            const s = c.__stats();
            c.destroy();
            return { ls, s };
        };
        const err = capture(() => {
            const A = recycleThenPlain(0);   // recycled from a BORN-INVISIBLE (scaleFrom:0) history
            const B = recycleThenPlain(1);   // recycled from an OFF (scaleFrom:1) history -- identical timing
            check(B.s.aliveActual === 1 && B.s.aliveGetter === 1, () =>
                `T3 A15: __stats after the recycled plain burst shows getter=${B.s.aliveGetter} actual=${B.s.aliveActual}, expected 1`);
            check(A.ls === B.ls, () =>
                `T3 A15: a recycled slot leaked a stale scaleFrom -- plain-burst lastScale ${A.ls} != control ${B.ls}`);
            // Non-vacuous: an ARMED scaleFrom:0 burst blooms from zero size -- a DIFFERENT lastScale than the plain control.
            const canvasC = makeCanvas({ record: true });
            const cC = createConfetti(canvasC, { seed: 7, maxParticles: 1 });
            cC.seed(7);
            cC.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 0, align: 0,
                scaleFrom: 0, scaleTo: 1, lifeMin: 5, lifeMax: 5 });
            for (let f = 0; f < 10; f++) pump(1, 50);
            const armedLastScale = canvasC.lastScale;
            cC.destroy();
            check(armedLastScale !== B.ls, () =>
                `T3 A15: scaleFrom:0 did not change the size fold vs scaleFrom:1 (${armedLastScale} == ${B.ls}) -- the witness is vacuous`);
        });
        check(err === null, () => `T3 A15: threw ${err && err.message}`);
    }

    // A16 -- pool-recycle retention for gustRate (v1.25.0). gustRate is UNCONDITIONALLY written at spawn --
    // LOAD-BEARING (like fadeOut/scaleFrom), since a Float32 zero-init 0 would mean "frozen phase" (an inert
    // gust) on a recycled slot whose gust IS armed -- a WRONG default -- so a recycled slot must never inherit
    // a prior burst's swell frequency. A single-slot pool FORCES slot 0 reuse: run 5 drain cycles arming the
    // frequency, then RESEED and fire a measurement burst into the recycled slot. Because the gust phase
    // sin(_elapsed * rate) rides the CUMULATIVE instance clock, the witness must be a hash-neutral WINDOWED
    // sumX DELTA (a before/after snapshot over a fixed 20-frame window), NOT a cumulative-from-zero hash or
    // sumX compare (canvas.hash/sumX accumulate and would false-fail; see the retention rule). A/B share the
    // IDENTICAL 5-cycle history timing (gustRate draws no rng, so the histories differ ONLY in the armed value
    // the spawn write must overwrite) and both MEASURE with the default (off) frequency: a leaked gustRate:6
    // would have re-phased the recycled plain burst's swell -> a different windowed sumX delta. C shares B's
    // history but MEASURES armed (gustRate:6) at the SAME _elapsed, so its delta must differ -- the non-vacuous
    // guard, phase-matched so the difference is the RATE, not the clock.
    {
        const recycleThenMeasure = (historyRate, measureRate) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 7, maxParticles: 1 });
            for (let cycle = 0; cycle < 5; cycle++) {
                c.seed(7);
                c.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 0, align: 0,
                    gust: 400, gustRate: historyRate, lifeMin: 0.3, lifeMax: 0.3 });
                for (let f = 0; f < 20; f++) pump(1, 50);
                check(c.count === 0, () => `T3 A16: an armed(${historyRate}) drain cycle left ${c.count} alive in the single-slot pool`);
            }
            c.seed(7);   // measurement burst into the recycled slot, rng-aligned
            c.burst({ count: 1, x: 400, y: 300, speed: 0, gravity: 0, drag: 1, flutter: 0, align: 0,
                gust: 400, gustRate: measureRate, lifeMin: 5, lifeMax: 5 });
            const before = canvas.sumX;
            for (let f = 0; f < 20; f++) pump(1, 16);   // fixed windowed measurement
            const delta = canvas.sumX - before;
            const s = c.__stats();
            c.destroy();
            return { delta, s };
        };
        const err = capture(() => {
            const A = recycleThenMeasure(6, undefined);          // history armed 6, measure DEFAULT (off)
            const B = recycleThenMeasure(undefined, undefined);  // history default, measure DEFAULT -- symmetric
            check(B.s.aliveActual === 1 && B.s.aliveGetter === 1, () =>
                `T3 A16: __stats after the recycled measurement burst shows getter=${B.s.aliveGetter} actual=${B.s.aliveActual}, expected 1`);
            check(A.delta === B.delta, () =>
                `T3 A16: a recycled slot leaked a stale gustRate -- windowed sumX delta ${A.delta} != control ${B.delta}`);
            // Non-vacuous: MEASURE armed (gustRate:6) on B's history + clock -> a DIFFERENT windowed sumX delta.
            const C = recycleThenMeasure(undefined, 6);
            check(C.delta !== B.delta, () =>
                `T3 A16: gustRate:6 did not change the swell delta vs the default (${C.delta} == ${B.delta}) -- the witness is vacuous`);
        });
        check(err === null, () => `T3 A16: threw ${err && err.message}`);
    }

    check(pointerListenerCount() === baseListeners,
        () => `T3: tier leaked ${pointerListenerCount() - baseListeners} pointer listener(s) overall`);
}
