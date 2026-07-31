/**
 * T6 -- the zero-alloc gate. This is F0's Phase B, folded into the tier structure
 * unchanged in substance, and it is the HARD gate: confetti's whole contract is a
 * GC-free render loop.
 *
 *   (1) update() over a full MAXP-particle pool retains ~0 B/frame -- measured as
 *       GC-bracketed net (heapUsed + arrayBuffers), min over reps, so a leaked pool
 *       (whose bytes live in arrayBuffers, not heapUsed) cannot hide.
 *   (2) a >= SOAK-frame window under lite-gc-profiler fires no MAJOR GC (maxMajor:0).
 *
 * The whole-suite red switch lives HERE, in the real gate: CONFETTI_TORTURE_BREAK=1
 * makes the measured hot body retain an allocation per frame, so the gate that must
 * bite in production is the exact one proven falsifiable -- it rejects and the run
 * exits non-zero. A gate that cannot fail is decorative.
 */

import {
    makeLivePool, pump, retainedBytesPerCall, GcProfiler, assertNoGc, maybeGc,
    HAS_GC, check, die, log, WARM, FRAMES, SOAK, RETAIN_FLOOR_BPF, RULES, MAXP, BREAK,
} from './harness.mjs';

const breakSink = [];

export async function run() {
    if (!HAS_GC) { log('  T6 inconclusive -- run with node --expose-gc'); return; }

    const c = makeLivePool();
    check(c.count === MAXP, () => `T6: live pool has ${c.count} alive, expected ${MAXP}`);

    // (1) Retained bytes per pumped frame (update() over MAXP particles). ~0 unless
    // BREAK injects a retained allocation, which this gate must then catch.
    const bpf = retainedBytesPerCall((i) => { pump(1, 16); if (BREAK) breakSink.push({ i }); }, FRAMES);

    // (2) GC-budget window.
    for (let i = 0; i < WARM; i++) pump(1, 16);
    maybeGc();
    const gc = new GcProfiler(256).start();
    for (let i = 0; i < SOAK; i++) pump(1, 16);
    await gc.settle();
    const summary = gc.summary();
    gc.stop();

    c.destroy();

    if (BREAK && breakSink.length === 0) die('T6: BREAK set but the injected sink drained (DCE) -- control is vacuous');

    if (bpf > RETAIN_FLOOR_BPF) {
        die('T6: update() retains ' + bpf.toFixed(2) + ' B/frame over the ' + RETAIN_FLOOR_BPF
            + ' floor -- the render loop is allocating');
    }

    let budgetOk = true;
    let budgetMsg = '';
    try { assertNoGc(summary, RULES); } catch (e) { budgetOk = false; budgetMsg = e && e.message ? e.message : String(e); }
    const gcLine = 'major=' + summary.gc.major + ' minor=' + summary.gc.minor + ' maxMs=' + summary.gc.maxMs.toFixed(2);
    if (!budgetOk) {
        die('T6: ' + SOAK + '-frame window fired a major GC (maxMajor:0) [' + gcLine + ']: ' + budgetMsg);
    }

    log('  T6 ok -- update() ' + bpf.toFixed(2) + ' B/frame over ' + MAXP + ' particles; '
        + SOAK + '-frame window no major GC [' + gcLine + ']');
}
