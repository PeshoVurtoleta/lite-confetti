/**
 * T9 -- controls. Every gate must be provably able to fail.
 *
 * This tier shows each gate a workload that MUST trip it; if a control reads clean,
 * the matching gate is blind and T9 fails the whole run. It folds and widens F0's
 * Phase C:
 *
 *   K1 NaN detector-- (a) the assertFinite draw path throws on a non-finite position, so
 *                     a NaN that would otherwise hash silently as 0 is loud; (b) POISON:
 *                     a burst carrying a full barrage of non-finite options must pump
 *                     WITHOUT tripping it -- proof v1.3.1 fail-closed sanitisation holds
 *                     end-to-end (pre-1.3.1 this threw; the inversion is the regression guard).
 *   K2 retention   -- a dropped-but-NOT-destroyed instance stays live (Phase A can
 *                     see a real leak).
 *   K3 alloc       -- a per-frame-allocating loop reads > floor (the retained-bytes
 *                     gate can see allocation).
 *   K4 determinism -- two DIFFERENT-seed instances hash differently (the T5
 *                     comparator can see divergence; it is not comparing constants).
 *   K5 count channel- count() actually moves (0 -> n -> 0), so the T0/T5 count laws
 *                     are not vacuously true against a stuck getter.
 *   K7 sway        -- sway 0 vs 0.9 diverges, so sway-determinism checks (T5 F4) are
 *                     not comparing constants.
 *   K6 end-to-end  -- TORTURE_CONTROL=alloc drives a per-frame-allocating soak that
 *                     MUST breach maxMajor:0, then exits non-zero.
 *
 * Since v1.3.1 sanitises inputs, K1b no longer throws through the ticker, so it can no
 * longer corrupt the shared scheduler; K1 still runs first and self-checks that a fresh
 * instance integrates, guarding against any future NaN-through-ticker regression.
 */

import {
    createConfetti, makeCanvas, pump, makeLivePool, retainedBytesPerCall,
    GcProfiler, assertNoGc, createLeakTracker, settle, capture, die, log,
    HAS_GC, maybeGc, RETAIN_FLOOR_BPF, WARM, SOAK, RULES, CONTROL,
} from './harness.mjs';

export async function run() {
    if (!HAS_GC) { log('  T9 inconclusive -- run with node --expose-gc'); return; }

    // K1 -- NaN detector + input-sanitisation poison control. K1a proves the assertFinite
    // draw path itself bites: a direct translate(NaN) throws, so the check is not blind.
    // K1b is the poison control for v1.3.1 fail-closed validation: a burst carrying a full
    // barrage of non-finite options must pump WITHOUT tripping assertFinite -- every bad
    // input is coerced before it can reach a drawn position (pre-1.3.1 this threw; the
    // inversion is the end-to-end regression guard). Then self-check a fresh instance
    // integrates, so a later control's failure is never a corrupted ticker.
    {
        const direct = makeCanvas({ assertFinite: true });
        const errDirect = capture(() => direct.getContext().translate(NaN, 5));
        if (errDirect === null) die('T9 K1a: assertFinite draw path did NOT throw on translate(NaN) -- the NaN detector is blind');

        const cv = makeCanvas({ record: true, assertFinite: true });
        const c = createConfetti(cv, { seed: 3, maxParticles: 64 });
        c.burst({
            count: 20, x: NaN, y: NaN, speed: NaN, speedVariance: NaN, gravity: NaN,
            angle: NaN, drag: NaN, spread: NaN, sizeMin: NaN, sizeMax: NaN,
            lifeMin: NaN, lifeMax: NaN,
        });
        const errE2E = capture(() => pump(3, 16));
        if (errE2E !== null) {
            c.destroy();
            die('T9 K1b: a burst of non-finite options tripped assertFinite (' + errE2E.message + ') -- fail-closed sanitisation is NOT holding');
        }
        if (c.count !== 20) { c.destroy(); die('T9 K1b: poison burst spawned ' + c.count + ' != 20 -- count was not sanitised to a finite integer'); }
        c.destroy();

        // Self-check: a fresh instance must integrate again.
        const rc = createConfetti(makeCanvas(), { seed: 8, maxParticles: 64 });
        rc.burst({ count: 10, lifeMin: 5, lifeMax: 5 });
        pump(1, 16);
        if (rc.count !== 10) die('T9 K1: ticker did not integrate a fresh burst (count ' + rc.count + ' != 10)');
        rc.destroy();
    }

    // K2 -- retention control: a fired, un-destroyed instance must stay live. Only
    // the module ticker's update() closure reaches its canvas after the ref drops.
    // (This registers a PERMANENT listener, which is why K1's throwing control ran
    // first.)
    {
        const tracker = createLeakTracker({ name: 't9-retain-control' });
        let ref = (() => {
            const cv = makeCanvas();
            const c = createConfetti(cv, { seed: 7, maxParticles: 128 });
            tracker.track(cv, null, 'leaked-canvas');
            c.burst({ count: 64, lifeMin: 1e6, lifeMax: 1e6 });
            pump(1);
            return c;
        })();
        ref = null;
        const live = await settle(() => tracker.size(), 8);
        if (live < 1) die('T9 K2: a fired, un-destroyed instance released its canvas -- the retention gate cannot see a real leak');
    }

    // K3 -- alloc control: a per-frame-allocating loop must exceed the floor.
    {
        const c = makeLivePool();
        const sink = [];
        const bpf = retainedBytesPerCall((i) => { pump(1, 16); sink.push({ i }); }, 4000, 500, 2);
        if (!(bpf > RETAIN_FLOOR_BPF)) {
            die('T9 K3: a per-frame-allocating loop read ' + bpf.toFixed(3) + ' B/frame -- the retained-bytes gate cannot see allocation');
        }
        if (sink.length === 0) die('T9 K3: leaky sink drained (DCE) -- control vacuous');
        c.destroy();
    }

    // K4 -- determinism comparator control: different seeds MUST diverge.
    {
        const ca = makeCanvas({ record: true });
        const cb = makeCanvas({ record: true });
        const a = createConfetti(ca, { seed: 1, maxParticles: 64 });
        const b = createConfetti(cb, { seed: 2, maxParticles: 64 });
        a.burst({ count: 60, speed: 350 });
        b.burst({ count: 60, speed: 350 });
        pump(5, 16);
        if (ca.hash === cb.hash) {
            die('T9 K4: different-seed instances hashed equal (' + ca.hash + ') -- the determinism comparator is blind');
        }
        a.destroy();
        b.destroy();
    }

    // K5 -- count-channel liveness. If count() were stuck, every count-based law is
    // vacuously true. Prove it moves 0 -> n -> 0.
    {
        const c = createConfetti(makeCanvas(), { seed: 4, maxParticles: 64 });
        if (c.count !== 0) die('T9 K5: fresh count ' + c.count + ' != 0');
        c.burst({ count: 30, lifeMin: 5, lifeMax: 5 });
        pump(1, 16);
        if (c.count !== 30) die('T9 K5: count did not track a burst (stuck at ' + c.count + ') -- count-based laws are vacuous');
        c.clear();
        if (c.count !== 0) die('T9 K5: clear() did not zero count (' + c.count + ')');
        c.destroy();
    }

    // K7 -- sway discrimination. sway must actually move positions, or T5's custom-shape
    // determinism (which pumps sway on both sides) would be comparing constants. Same
    // seed, sway 0 vs 0.9, everything else equal -> fingerprints MUST diverge.
    {
        const c0 = makeCanvas({ record: true });
        const c9 = makeCanvas({ record: true });
        const a = createConfetti(c0, { seed: 55, maxParticles: 64 });
        const b = createConfetti(c9, { seed: 55, maxParticles: 64 });
        a.burst({ x: 400, y: 300, count: 60, speed: 300, sway: 0 });
        b.burst({ x: 400, y: 300, count: 60, speed: 300, sway: 0.9 });
        pump(1, 1000); pump(15, 16);
        if (c0.hash === c9.hash) {
            die('T9 K7: sway 0 vs 0.9 produced the SAME fingerprint (' + c0.hash + ') -- sway is a no-op, so sway-determinism checks are vacuous');
        }
        a.destroy();
        b.destroy();
    }

    log('  T9 ok -- NaN-detector + sanitiser-poison, retention, alloc, determinism, count-channel and sway controls all bite');

    // K6 -- end-to-end alloc red path.
    if (CONTROL === 'alloc') {
        const live = makeLivePool();
        const allocSink = [];
        for (let i = 0; i < WARM; i++) pump(1, 16);
        maybeGc();
        const gc = new GcProfiler(256).start();
        for (let i = 0; i < SOAK; i++) { pump(1, 16); for (let k = 0; k < 200; k++) allocSink.push({ i, k }); }
        await gc.settle();
        const summary = gc.summary();
        gc.stop();
        let tripped = false;
        try { assertNoGc(summary, RULES); } catch { tripped = true; }
        if (allocSink.length === 0) die('T9 K6: alloc sink drained under the soak (DCE)');
        live.destroy();
        if (!tripped) die('T9 K6: TORTURE_CONTROL=alloc soak did NOT breach maxMajor:0 (major=' + summary.gc.major + ') -- the T6 GC gate is blind');
        die('T9 K6: TORTURE_CONTROL=alloc -- forcing non-zero exit (soak breached maxMajor:0 as required; major=' + summary.gc.major + ')');
    }
}
