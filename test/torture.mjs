/**
 * @zakkster/lite-confetti -- torture gate.
 *
 *     node --expose-gc test/torture.mjs        -> prints "ok", exit 0
 *
 * lite-confetti's contract is a GC-free render loop: a fixed particle pool of
 * flat typed arrays, spawned in the cold burst()/spray() path and integrated +
 * drawn every frame by update() with no per-frame allocation. The two invariants
 * this gate proves are the ecosystem Law's two halves:
 *
 *   1. NO HIDDEN RETENTION -- an instance and the canvas it is lent are released
 *      the instant the caller destroys() and drops them. The one thing that keeps
 *      a confetti instance alive is the shared module ticker holding its update()
 *      closure; destroy() unregisters it. (This is exactly what the control in
 *      Phase C leaks on purpose.)
 *   2. NO ALLOCATION GROWTH on the hot path -- update() over a full live pool
 *      retains 0 B/frame, and a long render-loop window fires no MAJOR GC.
 *
 * Three phases, in the suite vocabulary:
 *
 *   Phase A  retention   -- lite-leak. N instances are each created, fired,
 *                           destroyed, and dropped; a FinalizationRegistry settle
 *                           proves the tracker's live count returns to 0 -- neither
 *                           the shared ticker nor the module pinned any instance or
 *                           its lent canvas.
 *   Phase B  GC budget   -- lite-gc-profiler. update() over a 500-particle live
 *                           pool retains ~0 B/frame (GC-bracketed net heap +
 *                           arrayBuffers, min over reps), and a >=10k-frame window
 *                           fires no MAJOR GC (maxMajor:0). HARD GATE.
 *   Phase C  controls    -- falsifiability. A dropped-but-NOT-destroyed instance
 *                           must stay live (the retention gate can see a leak); a
 *                           per-frame-allocating render loop must read > 0 B/frame
 *                           (the per-frame gate can see allocation); and
 *                           TORTURE_CONTROL=alloc drives a per-frame-allocating
 *                           soak that MUST breach maxMajor:0, then exits 1.
 *
 * The render loop is driven through the real @zakkster/lite-ticker via the
 * pumpable requestAnimationFrame in test/_env.mjs -- no shipped-code hook. Phases
 * run strictly sequentially: lite-gc-profiler measures one thing at a time and the
 * retention settle needs the heap to itself.
 *
 * lite-gc-profiler and lite-leak are devDependencies, never runtime deps.
 *
 * @license MIT
 */

import './_env.mjs';
import { makeCanvas, pump } from './_env.mjs';
import { GcProfiler, assertNoGc } from '@zakkster/lite-gc-profiler';
import { createLeakTracker } from '@zakkster/lite-leak';
import { createConfetti } from '../Confetti.js';

// Phase B is a HARD GATE. Set false only to re-baseline a regression while bisecting.
const STRICT_PHASE_B = true;

const CONTROL = process.env.TORTURE_CONTROL || '';

// Net retained bytes/FRAME floor. A render loop that pins nothing reads ~0 (a
// single GC-boundary shift over 10k frames is sub-byte); this floor absorbs that
// jitter without letting a real per-frame object (>= ~16 B) through.
const RETAIN_FLOOR_BPF = 8.0;

const MAXP = 500;
const WARM = 1000;
const FRAMES = 10000;
const REPS = 3;
const SOAK = 10000;

const HAS_GC = typeof globalThis.gc === 'function';
const maybeGc = () => { if (HAS_GC) globalThis.gc(); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = (phase, msg) => {
    process.stderr.write('torture: FAIL [' + phase + '] ' + msg + '\n');
    process.exit(1);
};
const log = (msg) => process.stderr.write(msg + '\n');

// Total retained memory: JS heap PLUS external typed-array backing stores. A
// Float32Array's bytes live in `arrayBuffers`, not `heapUsed`; the pool is exactly
// such buffers, so a leaked pool would be invisible to heapUsed alone. Sum both.
const usedBytes = () => {
    const m = process.memoryUsage();
    return m.heapUsed + m.arrayBuffers;
};

/**
 * Net RETAINED bytes per call: warm, full GC, snapshot, run `calls`, full GC
 * AGAIN, snapshot. The trailing GC reclaims every transient, so only memory the
 * run PINNED survives to be counted. Min over reps: a zero-retention body's noise
 * is two-sided GC-boundary jitter and the min is the honest floor; a retaining
 * body grows every rep, so the min stays positive.
 */
function retainedBytesPerCall(fn, calls, warm = WARM, reps = REPS) {
    let min = Infinity;
    for (let r = 0; r < reps; r++) {
        for (let i = 0; i < warm; i++) fn(i);
        maybeGc();
        maybeGc();
        const before = usedBytes();
        for (let i = 0; i < calls; i++) fn(i);
        maybeGc();
        maybeGc();
        const after = usedBytes();
        const v = (after - before) / calls;
        if (v < min) min = v;
    }
    return min;
}

/** Drive a FinalizationRegistry to quiescence: gc + yield until live count hits 0. */
async function settle(liveCount, maxRounds = 20) {
    for (let r = 0; r < maxRounds; r++) {
        if (liveCount() === 0) return 0;
        maybeGc();
        // eslint-disable-next-line no-await-in-loop
        await delay(5);
    }
    return liveCount();
}

/**
 * A confetti instance with a full, long-lived pool spanning every shape branch,
 * so update() exercises rect/circle/star/triangle/emoji every frame. Life is set
 * effectively infinite so nothing dies (and auto-detach never fires) across a soak.
 */
function makeLivePool() {
    const c = createConfetti(makeCanvas(), { seed: 1234, maxParticles: MAXP });
    const per = MAXP / 5;
    for (const shape of ['rect', 'circle', 'star', 'triangle', 'emoji']) {
        c.burst({ count: per, shape, lifeMin: 1e6, lifeMax: 1e6, sizeMin: 4, sizeMax: 12 });
    }
    pump(1, 1000); // integrate once; all MAXP now alive
    return c;
}

// ---------------------------------------------------------------------------
// Phase A -- retention (lite-leak). A destroyed, dropped instance and its lent
// canvas are released; the shared ticker pins nothing after destroy().
// ---------------------------------------------------------------------------
async function phaseA() {
    if (!HAS_GC) { log('  Phase A inconclusive -- run with node --expose-gc'); return; }

    const tracker = createLeakTracker({ name: 'lite-confetti-lifecycle' });
    let handles = [];
    const N = 64;

    for (let i = 0; i < N; i++) {
        const canvas = makeCanvas();
        const c = createConfetti(canvas, { seed: i, maxParticles: 128 });
        handles.push(tracker.track(canvas, null, 'canvas'));
        handles.push(tracker.track(c, null, 'instance'));
        c.burst({ count: 64, lifeMin: 1, lifeMax: 1 });
        pump(1);
        c.destroy();
        // canvas and c fall out of scope on the next iteration -- nothing else holds them.
    }

    const tracked = tracker.size();
    if (tracked !== N * 2) {
        fail('A-retention', 'tracker registered ' + tracked + ' handles, expected ' + (N * 2));
    }

    for (let i = 0; i < handles.length; i++) tracker.untrack(handles[i]);
    handles = null;
    const remaining = await settle(() => tracker.size());
    if (remaining !== 0) {
        fail('A-retention', 'destroyed instances left ' + remaining + ' object(s) live -- '
            + 'the shared ticker or a listener is pinning an instance or its canvas after destroy()');
    }

    log('  Phase A ok -- ' + N + ' create/fire/destroy cycles all released (live=0)');
}

// ---------------------------------------------------------------------------
// Phase B -- GC budget (lite-gc-profiler). update() retains 0 B/frame over a full
// pool, and a long render window fires no major GC.
// ---------------------------------------------------------------------------
async function phaseB() {
    if (!HAS_GC) { log('  Phase B inconclusive -- run with node --expose-gc'); return; }

    const c = makeLivePool();
    if (c.count !== MAXP) fail('B', 'live pool has ' + c.count + ' alive, expected ' + MAXP);

    // (1) Retained allocation of the render loop -- one pumped frame = update() over
    // MAXP particles. Must be ~0.
    const bpf = retainedBytesPerCall(() => pump(1, 16), FRAMES);

    // (2) GC-budget window: >= SOAK frames under the profiler, gated maxMajor:0.
    for (let i = 0; i < WARM; i++) pump(1, 16); // warm the call sites
    maybeGc();
    const gc = new GcProfiler(256).start();
    for (let i = 0; i < SOAK; i++) pump(1, 16);
    await gc.settle();
    const summary = gc.summary();
    gc.stop();

    let budgetOk = true;
    let budgetMsg = '';
    try {
        assertNoGc(summary, { maxMajor: 0 });
    } catch (e) {
        budgetOk = false;
        budgetMsg = e && e.message ? e.message : String(e);
    }
    const gcLine = 'major=' + summary.gc.major + ' minor=' + summary.gc.minor
        + ' maxMs=' + summary.gc.maxMs.toFixed(2);

    c.destroy(); // release the pool before Phase C

    if (STRICT_PHASE_B) {
        if (bpf > RETAIN_FLOOR_BPF) {
            fail('B', 'update() retains ' + bpf.toFixed(2) + ' B/frame over the '
                + RETAIN_FLOOR_BPF + ' floor -- the render loop is allocating');
        }
        if (!budgetOk) {
            fail('B', SOAK + '-frame window fired a major GC (maxMajor:0) [' + gcLine + ']: ' + budgetMsg);
        }
        log('  Phase B ok -- update() ' + bpf.toFixed(2) + ' B/frame retained over ' + MAXP
            + ' particles; ' + SOAK + '-frame window no major GC [' + gcLine + ']');
        return;
    }
    log('  Phase B (non-strict) -- update() ' + bpf.toFixed(2) + ' B/frame; window [' + gcLine
        + ']. Set STRICT_PHASE_B=true to gate.');
}

// ---------------------------------------------------------------------------
// Phase C -- controls (falsifiability). Every Phase B/A gate is shown a workload
// that MUST trip it. If any control reads clean, the matching gate is blind.
// ---------------------------------------------------------------------------
async function phaseC() {
    if (!HAS_GC) { log('  Phase C inconclusive -- run with node --expose-gc'); return; }

    // C1: a dropped-but-NOT-destroyed instance must stay live -- the shared ticker
    // still holds its update() closure, which captures the lent canvas. If the
    // retention gate cannot see this, Phase A's live=0 proves nothing.
    const tracker = createLeakTracker({ name: 'lite-confetti-lifecycle-control' });
    let leakedRef = (() => {
        const canvas = makeCanvas();
        const c = createConfetti(canvas, { seed: 7, maxParticles: 128 });
        tracker.track(canvas, null, 'leaked-canvas');
        c.burst({ count: 64, lifeMin: 1e6, lifeMax: 1e6 });
        pump(1);
        return c; // keep the instance reachable ONLY here; the canvas is not tracked-through it below
    })();
    // Drop the instance: only the module ticker's update() closure now reaches the canvas.
    leakedRef = null;
    const stillLive = await settle(() => tracker.size(), 8);
    if (stillLive < 1) {
        fail('C-control', 'a fired, un-destroyed instance released its canvas (live=' + stillLive
            + ') -- the retention gate cannot see a real leak');
    }

    // C2: a per-frame-allocating render loop must be VISIBLE to the per-frame gate.
    const c = makeLivePool();
    const sink = [];
    const leakyBpf = retainedBytesPerCall((i) => { pump(1, 16); sink.push({ i }); }, 4000, 500, 2);
    if (!(leakyBpf > RETAIN_FLOOR_BPF)) {
        fail('C-control', 'a per-frame-allocating loop read ' + leakyBpf.toFixed(3)
            + ' B/frame -- the per-frame retention gate cannot see allocation');
    }
    if (sink.length === 0) fail('C-control', 'leaky sink drained'); // defeat DCE
    c.destroy();

    log('  Phase C ok -- un-destroyed instance held live (seen); per-frame alloc '
        + leakyBpf.toFixed(1) + ' B/frame (seen)');

    // C3: end-to-end red path. TORTURE_CONTROL=alloc drives a per-frame-allocating
    // soak; it MUST breach maxMajor:0, and then we exit 1.
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
        try { assertNoGc(summary, { maxMajor: 0 }); } catch { tripped = true; }
        if (allocSink.length === 0) fail('C-control', 'alloc sink drained under the soak');
        live.destroy();
        if (!tripped) {
            fail('C-control', 'TORTURE_CONTROL=alloc soak did NOT breach maxMajor:0 '
                + '(major=' + summary.gc.major + ') -- the Phase B GC gate is blind');
        }
        fail('C-control', 'TORTURE_CONTROL=alloc -- forcing non-zero exit '
            + '(soak breached maxMajor:0 as required; major=' + summary.gc.major + ')');
    }
}

async function main() {
    const phases = [['A', phaseA], ['B', phaseB], ['C', phaseC]];
    for (const [name, run] of phases) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await run();
        } catch (e) {
            fail(name, e && e.message ? e.message : String(e));
        }
    }
    process.stdout.write('ok\n');
    process.exit(0);
}

main();
