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
    makeLivePool, makeCanvas, createConfetti, pump, retainedBytesPerCall, GcProfiler,
    assertNoGc, maybeGc, HAS_GC, check, die, log, WARM, FRAMES, SOAK, RETAIN_FLOOR_BPF,
    RULES, MAXP, BREAK,
} from './harness.mjs';

const breakSink = [];

// A full pool that ALSO exercises the two registerShape() code paths every frame:
// a custom VECTOR shape (engine sets fillStyle, then calls the user draw fn) and an
// image SPRITE (blit, fillStyle skipped). If the new indexed dispatch, the custom-fn
// call, or the sprite blit allocated anything, this pool's retained-bytes/frame would
// rise above the floor exactly like a leaking built-in loop.
function makeCustomLivePool() {
    const c = createConfetti(makeCanvas(), { seed: 4321, maxParticles: MAXP });
    const heart = (ctx, w) => {
        ctx.beginPath();
        ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
        ctx.fill();
    };
    c.registerShape('heart', heart);
    c.registerShape('logo', { image: makeCanvas() }); // any image source; blitted
    const per = MAXP / 4;
    for (const shape of ['rect', 'emoji', 'heart', 'logo']) {
        c.burst({ count: per, shape, lifeMin: 1e6, lifeMax: 1e6, sizeMin: 4, sizeMax: 12, flutter: 1, sway: 0.5 });
    }
    pump(1, 1000);
    return c;
}

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

    // (3) The registerShape() paths (custom vector + sprite blit + sway drift) must be
    // as allocation-free as the built-ins. Same GC-bracketed measurement, own pool.
    const cc = makeCustomLivePool();
    check(cc.count === MAXP, () => `T6: custom pool has ${cc.count} alive, expected ${MAXP}`);
    const bpfCustom = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    cc.destroy();
    if (bpfCustom > RETAIN_FLOOR_BPF) {
        die('T6: custom-shape update() retains ' + bpfCustom.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- registerShape dispatch/sprite/sway is allocating');
    }

    // (4) A pool SPAWNED from out-of-range/garbage options (every one coerced by v1.3.1
    // fail-closed sanitisation) must integrate with the same ~0 B/frame. Coercion runs
    // once in burst(), never in the loop, and must not leave a value that de-opts
    // update() into allocating. Large finite life keeps the pool full for the window.
    const cp = createConfetti(makeCanvas(), { seed: 777, maxParticles: MAXP });
    cp.burst({
        count: MAXP, speed: NaN, gravity: Infinity, drag: NaN, angle: NaN, spread: NaN,
        sizeMin: NaN, sizeMax: NaN, lifeMin: 1e6, lifeMax: 1e6, colors: null, sway: 0.5,
    });
    pump(1, 1000);
    check(cp.count === MAXP, () => `T6: sanitised pool has ${cp.count} alive, expected ${MAXP}`);
    const bpfPoison = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    cp.destroy();
    if (bpfPoison > RETAIN_FLOOR_BPF) {
        die('T6: sanitised-input update() retains ' + bpfPoison.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- coercion left the render loop allocating');
    }

    // (5) A pool filled from ONE multi-shape burst (shapes: []), ALSO under a non-zero
    // `wind` AND a reachable `floor` + `bounce`. The per-particle shape pick is a spawn-time
    // rng draw + array index (no alloc); it interleaves shape ids so update()'s indexed
    // dispatch runs fully polymorphic every frame; wind != 0 arms the guarded lateral-accel
    // FMA (`vx += wind*dt`); and the finite floor arms the guarded collision block
    // (`y > floor` -> clamp + reflect) -- once a particle lands, gravity re-crosses it every
    // frame, so the branch keeps firing for every resting particle. All must still integrate
    // at ~0 B/frame. Includes a custom vector + a sprite in the mix so all three dispatch
    // kinds are hit from a single burst.
    const cm = createConfetti(makeCanvas(), { seed: 5150, maxParticles: MAXP });
    cm.registerShape('heart', (ctx, w) => { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); });
    cm.registerShape('logo', { image: makeCanvas() });
    cm.burst({
        count: MAXP, shapes: ['rect', 'circle', 'star', 'triangle', 'emoji', 'heart', 'logo'],
        lifeMin: 1e6, lifeMax: 1e6, sizeMin: 4, sizeMax: 12, sway: 0.5, wind: 300,
        floor: 150, bounce: 0.4,
    });
    pump(1, 1000);
    check(cm.count === MAXP, () => `T6: mixed-shape pool has ${cm.count} alive, expected ${MAXP}`);
    const bpfMix = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    cm.destroy();
    if (bpfMix > RETAIN_FLOOR_BPF) {
        die('T6: multi-shape update() retains ' + bpfMix.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- shapes[] dispatch is allocating');
    }

    let budgetOk = true;
    let budgetMsg = '';
    try { assertNoGc(summary, RULES); } catch (e) { budgetOk = false; budgetMsg = e && e.message ? e.message : String(e); }
    const gcLine = 'major=' + summary.gc.major + ' minor=' + summary.gc.minor + ' maxMs=' + summary.gc.maxMs.toFixed(2);
    if (!budgetOk) {
        die('T6: ' + SOAK + '-frame window fired a major GC (maxMajor:0) [' + gcLine + ']: ' + budgetMsg);
    }

    log('  T6 ok -- update() ' + bpf.toFixed(2) + ' B/frame over ' + MAXP + ' particles ('
        + bpfCustom.toFixed(2) + ' B/frame custom vector+sprite+sway, '
        + bpfPoison.toFixed(2) + ' B/frame from sanitised garbage inputs, '
        + bpfMix.toFixed(2) + ' B/frame from a shapes[] mix under wind + floor/bounce); '
        + SOAK + '-frame window no major GC [' + gcLine + ']');
}
