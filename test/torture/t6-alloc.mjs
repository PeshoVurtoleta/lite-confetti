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
    // `wind` AND a reachable full bounding box (`floor` + `wallLeft`/`wallRight`/`ceiling`
    // + `bounce`). The per-particle shape pick is a spawn-time rng draw + array index (no
    // alloc); it interleaves shape ids so update()'s indexed dispatch runs fully polymorphic
    // every frame; wind != 0 arms the guarded lateral-accel FMA (`vx += wind*dt`); and every
    // finite box edge arms its guarded collision block -- the floor + ceiling clamps and the
    // wall if/else-if. Wind drives the pool into the right wall and the floor pins it, so once
    // a particle lands/leans it re-crosses an edge every frame and the branches keep firing for
    // the whole resting pool. It ALSO carries the v1.8.0 time-varying forces (`turbulence` +
    // `gust`), so both guarded accel blocks and their Math.cos/Math.sin fire every particle
    // every frame. It ALSO carries a `vortex` (positive `attract` + `swirl`, stable so the immortal
    // pool stays finite), arming the linear-spring point force + its accel-cap branch every frame.
    // It is ALSO built with a `trail` capacity, so every alive particle BOTH writes
    // a ring-buffer sample AND strokes a ribbon (beginPath + moveTo/lineTo + stroke) every
    // frame -- the v1.9.0 render overlay must be as allocation-free as the physics. It is ALSO armed
    // with a `lifeColors` ramp (v1.12.0), so every vector particle indexes the baked LUT (`ramp[step]`)
    // every frame while the sprite skips it via blit -- the color overlay must be as allocation-free as
    // everything else (the LUT is baked ONCE at burst; the hot path is a pure array read). All must still
    // integrate at ~0 B/frame. Includes a custom vector + a sprite in the mix so all three
    // dispatch kinds are hit from a single burst.
    const cm = createConfetti(makeCanvas(), { seed: 5150, maxParticles: MAXP, trail: 16 });
    cm.registerShape('heart', (ctx, w) => { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); });
    cm.registerShape('logo', { image: makeCanvas() });
    cm.burst({
        count: MAXP, shapes: ['rect', 'circle', 'star', 'triangle', 'emoji', 'heart', 'logo'],
        lifeMin: 1e6, lifeMax: 1e6, sizeMin: 4, sizeMax: 12, sway: 0.5, wind: 300,
        floor: 150, bounce: 0.4, wallLeft: 200, wallRight: 600, ceiling: 100,
        turbulence: 250, gust: 200, attract: 5, swirl: 4,
        lifeColors: [{ l: 0.98, c: 0.02, h: 90 }, { l: 0.60, c: 0.20, h: 40 }, { l: 0.30, c: 0.12, h: 20 }],
    });
    pump(1, 1000);
    check(cm.count === MAXP, () => `T6: mixed-shape pool has ${cm.count} alive, expected ${MAXP}`);
    const bpfMix = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    cm.destroy();
    if (bpfMix > RETAIN_FLOOR_BPF) {
        die('T6: multi-shape update() retains ' + bpfMix.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- shapes[] dispatch is allocating');
    }

    // (6) A SETTLED pile (v1.11.0): an immortal pool under strong gravity onto a reachable
    // `floor` with `settle` armed, so every particle bounces a few times and then FREEZES.
    // Within a frame or two the WHOLE pool is `landed`, so update() takes the `if (!landed)`
    // skip for every particle every frame -- a landed piece must still be pure reads (its life
    // countdown + trail record + fade + render), allocating nothing. This is the frozen-pile
    // analog of the resting-pool lanes above: a saturated pile is the steady state settle
    // produces, and it must integrate at the same ~0 B/frame as an active pool.
    const cs = createConfetti(makeCanvas(), { seed: 8128, maxParticles: MAXP });
    cs.burst({
        count: MAXP, lifeMin: 1e6, lifeMax: 1e6, sizeMin: 4, sizeMax: 12,
        y: 50, speed: 200, gravity: 3000, floor: 400, bounce: 0.4, settle: 90,
    });
    pump(1, 1000); pump(30, 16); // let the pool fall + bounce + freeze into a pile
    check(cs.count === MAXP, () => `T6: settled pool has ${cs.count} alive, expected ${MAXP}`);
    const bpfSettle = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    cs.destroy();
    if (bpfSettle > RETAIN_FLOOR_BPF) {
        die('T6: settled-pile update() retains ' + bpfSettle.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- the frozen (landed) path is allocating');
    }

    // (7) A continuous EMIT spray (v1.13.0): the other lanes burst ONCE, so their spawn cost is paid
    // before the measured window. Emit lives entirely at spawn (the emitter branch only moves the
    // origin), so it needs a lane that spawns INSIDE the window. A long-duration spray with the ring
    // emitter armed spawns `rate` pieces through the emitter branch every measured frame -- the ring
    // rng draw + the radial-outward re-derivation (a few Math.cos/sin on stack locals, the shape-id an
    // int). Immortal pieces saturate the pool to MAXP (steady state), so any per-frame SPAWN allocation
    // shows up as retained bytes exactly like a leaking update() would.
    const ce = createConfetti(makeCanvas(), { seed: 1313, maxParticles: MAXP });
    ce.spray({ duration: 1e9, rate: 24, x: 400, y: 300, speed: 300, gravity: 0,
        lifeMin: 1e6, lifeMax: 1e6, emit: 'ring', emitSize: 120 });
    pump(1, 1000); pump(40, 16); // saturate the pool through the emitter branch
    check(ce.count === MAXP, () => `T6: emit-spray pool has ${ce.count} alive, expected ${MAXP}`);
    const bpfEmit = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    ce.destroy();
    if (bpfEmit > RETAIN_FLOOR_BPF) {
        die('T6: emit-spray retains ' + bpfEmit.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- the emitter spawn branch is allocating');
    }

    // (8) A staggered burst mid-emission (v1.14.0): the birth gate + the per-frame `delay -= dtSec`
    // decrement are NEW hot-path code, and they must run INSIDE the measured window. A huge stagger
    // window over a full MAXP burst keeps nearly every piece UNBORN for the whole soak, so the
    // gate's unborn branch (`delay -= dtSec; alive++; continue;`) executes for ~MAXP pieces every
    // frame -- a Float32 read + subtract + compare, no allocation. Immortal pieces + the huge window
    // hold the pool at MAXP (all unborn count as alive), so any per-frame allocation on the gate path
    // shows up as retained bytes.
    const cg = createConfetti(makeCanvas(), { seed: 1414, maxParticles: MAXP });
    cg.burst({ count: MAXP, x: 400, y: 300, speed: 200, gravity: 500,
        lifeMin: 1e6, lifeMax: 1e6, stagger: 1e7 }); // ~all pieces stay unborn across the window
    pump(1, 16);
    check(cg.count === MAXP, () => `T6: stagger pool has ${cg.count} alive (unborn count as alive), expected ${MAXP}`);
    const bpfStagger = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    cg.destroy();
    if (bpfStagger > RETAIN_FLOOR_BPF) {
        die('T6: staggered-emission update() retains ' + bpfStagger.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- the birth-delay gate is allocating');
    }

    // (9) A velocity-aligned live pool (v1.15.0): with align:1 every rendered piece runs the NEW
    // render-rotation blend (atan2 + shortest-arc wrap + a lerp) INSIDE the measured window. Wind +
    // gravity keep the velocity non-trivial every frame, so atan2 is exercised on a real heading for
    // ~MAXP pieces/frame. It is pure stack arithmetic (no allocation); immortal long-life pieces hold
    // the pool full so any per-frame allocation on the align path would show as retained bytes.
    const cl = createConfetti(makeCanvas({ record: true }), { seed: 1515, maxParticles: MAXP });
    cl.burst({ count: MAXP, x: 400, y: 300, speed: 300, spread: 2.5, gravity: 700, wind: 400,
        lifeMin: 1e6, lifeMax: 1e6, align: 1 });
    pump(1, 16);
    check(cl.count === MAXP, () => `T6: align pool has ${cl.count} alive, expected ${MAXP}`);
    const bpfAlign = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    cl.destroy();
    if (bpfAlign > RETAIN_FLOOR_BPF) {
        die('T6: velocity-aligned update() retains ' + bpfAlign.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- the align render-rotation blend is allocating');
    }

    // (10) A tumble-scaled live pool (v1.16.0): with spinRate:2 every rendered piece runs the NEW
    // render angle scale (spin0 + (spin - spin0) * rate) INSIDE the measured window, AND turbulence is
    // armed so the [:824] curl read runs too -- proving the two are decoupled at zero cost. Immortal
    // long-life pieces hold the pool full so any per-frame allocation on the spinRate path would show
    // as retained bytes. Pure stack arithmetic, so ~0 B/frame over ~MAXP pieces.
    const sr = createConfetti(makeCanvas({ record: true }), { seed: 1616, maxParticles: MAXP });
    sr.burst({ count: MAXP, x: 400, y: 300, speed: 300, spread: 2.5, gravity: 700, wind: 400,
        turbulence: 500, spinRate: 2, lifeMin: 1e6, lifeMax: 1e6 });
    pump(1, 16);
    check(sr.count === MAXP, () => `T6: spinRate pool has ${sr.count} alive, expected ${MAXP}`);
    const bpfSpin = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    sr.destroy();
    if (bpfSpin > RETAIN_FLOOR_BPF) {
        die('T6: tumble-scaled update() retains ' + bpfSpin.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- the spinRate render angle scale is allocating');
    }

    // (11) A size-ramped live pool (v1.17.0): with scaleTo:0.25 every rendered piece runs the NEW
    // size-over-life fold (1 + (scaleTo - 1) * (1 - lifeT), then multiplied into the flutter X-wobble)
    // INSIDE the measured window, AND flutter:1 arms the wobble so BOTH factors multiply on the single
    // ctx.scale call for ~MAXP pieces/frame. Immortal long-life pieces hold the pool full so any
    // per-frame allocation on the scaleTo path would show as retained bytes. Pure stack arithmetic
    // (a Float32 read + compare + two multiplies), so ~0 B/frame.
    const sc = createConfetti(makeCanvas({ record: true }), { seed: 1717, maxParticles: MAXP });
    sc.burst({ count: MAXP, x: 400, y: 300, speed: 300, spread: 2.5, gravity: 700, wind: 400,
        flutter: 1, scaleTo: 0.25, lifeMin: 1e6, lifeMax: 1e6 });
    pump(1, 16);
    check(sc.count === MAXP, () => `T6: scaleTo pool has ${sc.count} alive, expected ${MAXP}`);
    const bpfScale = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    sc.destroy();
    if (bpfScale > RETAIN_FLOOR_BPF) {
        die('T6: size-ramped update() retains ' + bpfScale.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- the scaleTo size fold is allocating');
    }

    // (12) A flutter-rated live pool (v1.18.0): with flutter:1 + flutterRate:0.35 every rendered piece
    // runs the NEW wobble-phase scale (tilt0 + (tilt - tilt0) * flutterRate, folded into the wobbleScale)
    // INSIDE the measured window, AND turbulence is armed so the [:862] curl read of the untouched
    // pool.tilt runs beside it every frame -- proving the decoupled render fold allocates nothing while
    // turbulence advances the real tilt. Immortal long-life pieces hold the pool full so any per-frame
    // allocation on the flutterRate path would show as retained bytes. Pure stack arithmetic (a Float32
    // read + compare + subtract + multiply), so ~0 B/frame over ~MAXP pieces.
    const fr = createConfetti(makeCanvas({ record: true }), { seed: 1801, maxParticles: MAXP });
    fr.burst({ count: MAXP, x: 400, y: 300, speed: 300, spread: 2.5, gravity: 700, wind: 400,
        flutter: 1, flutterRate: 0.35, turbulence: 300, lifeMin: 1e6, lifeMax: 1e6 });
    pump(1, 16);
    check(fr.count === MAXP, () => `T6: flutterRate pool has ${fr.count} alive, expected ${MAXP}`);
    const bpfFlut = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    fr.destroy();
    if (bpfFlut > RETAIN_FLOOR_BPF) {
        die('T6: flutter-rated update() retains ' + bpfFlut.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- the flutterRate wobble-phase scale is allocating');
    }

    // (13) A fade-in live pool (v1.19.0): with fadeIn:0.5 every rendered piece runs the NEW birth-opacity
    // ramp branch (age = 1 - lifeT; if age < fadeIn: alpha *= age / fadeIn) INSIDE the measured window AND
    // sets ctx.globalAlpha every frame (the branch is armed for the whole immortal pool since 1e6 life keeps
    // age near 0 << 0.5 forever). flutter:1 also arms the wobble so the render path is fully loaded. Pure
    // stack arithmetic (a Float32 read + a compare + a subtract + a divide + a multiply), so ~0 B/frame over
    // ~MAXP pieces -- any per-frame allocation on the fadeIn path would show as retained bytes.
    const fi = createConfetti(makeCanvas({ record: true }), { seed: 1901, maxParticles: MAXP });
    fi.burst({ count: MAXP, x: 400, y: 300, speed: 300, spread: 2.5, gravity: 700, wind: 400,
        flutter: 1, fadeIn: 0.5, lifeMin: 1e6, lifeMax: 1e6 });
    pump(1, 16);
    check(fi.count === MAXP, () => `T6: fadeIn pool has ${fi.count} alive, expected ${MAXP}`);
    const bpfFade = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    fi.destroy();
    if (bpfFade > RETAIN_FLOOR_BPF) {
        die('T6: fade-in update() retains ' + bpfFade.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- the fadeIn birth-opacity ramp is allocating');
    }

    // (14) A death-fade live pool (v1.20.0): with fadeOut:0.8 the render guard `fo !== FADE_OUT_DEF` fires
    // for every rendered piece INSIDE the measured window (0.8 != the fround(0.3) default), so the base
    // alpha is recomputed (a Float32 read + a compare + the lifeT < fo ternary) and ctx.globalAlpha is set
    // every frame; flutter:1 also arms the wobble so the render path is fully loaded. Pure stack arithmetic,
    // so ~0 B/frame over ~MAXP pieces -- any per-frame allocation on the fadeOut path would show as retained
    // bytes.
    const fo = createConfetti(makeCanvas({ record: true }), { seed: 2001, maxParticles: MAXP });
    fo.burst({ count: MAXP, x: 400, y: 300, speed: 300, spread: 2.5, gravity: 700, wind: 400,
        flutter: 1, fadeOut: 0.8, lifeMin: 1e6, lifeMax: 1e6 });
    pump(1, 16);
    check(fo.count === MAXP, () => `T6: fadeOut pool has ${fo.count} alive, expected ${MAXP}`);
    const bpfFadeOut = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    fo.destroy();
    if (bpfFadeOut > RETAIN_FLOOR_BPF) {
        die('T6: death-fade update() retains ' + bpfFadeOut.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- the fadeOut death-fade window is allocating');
    }

    // (15) A floor-friction live pool (v1.21.0): an immortal pool under strong gravity + wind onto a
    // reachable `floor` just below spawn with friction:0.3 armed. Every piece contacts the floor within a
    // frame or two and, because bounce is 0, stays clamped to it EVERY frame -- so the guarded friction
    // damp `if (fric != 0) vx *= 1 - fric` fires for the whole pool every frame while the wind keeps
    // re-driving vx (a perpetual skid). It is a Float32 read + compare + a single multiply, allocating
    // nothing; the immortal 1e6 life holds the pool at MAXP so any per-frame allocation on the friction
    // path would show as retained bytes. The skidding-pool analog of the settled-pile lane (6).
    const cf = createConfetti(makeCanvas(), { seed: 2101, maxParticles: MAXP });
    cf.burst({
        count: MAXP, lifeMin: 1e6, lifeMax: 1e6, sizeMin: 4, sizeMax: 12,
        y: 50, speed: 200, gravity: 3000, wind: 500, floor: 120, bounce: 0, friction: 0.3,
    });
    pump(1, 1000); pump(30, 16); // let the pool fall onto the floor and start skidding
    check(cf.count === MAXP, () => `T6: floor-friction pool has ${cf.count} alive, expected ${MAXP}`);
    const bpfFric = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    cf.destroy();
    if (bpfFric > RETAIN_FLOOR_BPF) {
        die('T6: floor-friction update() retains ' + bpfFric.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- the tangential-drag damp is allocating');
    }

    // (16) A wall-friction (skidding) live pool (v1.22.0): an immortal pool under strong wind driving pieces
    // into the RIGHT wall of a tight box with wallFriction:0.3 armed. Wind re-breaches the wall every frame
    // (bounce 0 zeroes vx at contact, wind re-drives it), so the guarded wall damp `if (wfric != 0) vy *= 1 -
    // wfric` fires for the whole pool every frame; the strong downward gravity keeps pieces pressed against
    // the ceiling-to-floor wall band, and where a piece is launched up it also strikes the ceiling (the vx
    // damp). It is a Float32 read + compare + a single multiply, allocating nothing; the immortal 1e6 life
    // holds the pool at MAXP so any per-frame allocation on the wall-friction path shows as retained bytes.
    // The non-floor-edge analog of lane (15).
    const cw = createConfetti(makeCanvas(), { seed: 2201, maxParticles: MAXP });
    cw.burst({
        count: MAXP, lifeMin: 1e6, lifeMax: 1e6, sizeMin: 4, sizeMax: 12,
        x: 300, y: 200, speed: 200, gravity: 3000, wind: 2000,
        wallLeft: 200, wallRight: 400, ceiling: 100, floor: 500, bounce: 0, wallFriction: 0.3,
    });
    pump(1, 1000); pump(30, 16); // drive the pool into the right wall and start skidding down it
    check(cw.count === MAXP, () => `T6: wall-friction pool has ${cw.count} alive, expected ${MAXP}`);
    const bpfWfric = retainedBytesPerCall(() => { pump(1, 16); }, FRAMES);
    cw.destroy();
    if (bpfWfric > RETAIN_FLOOR_BPF) {
        die('T6: wall-friction update() retains ' + bpfWfric.toFixed(2) + ' B/frame over the '
            + RETAIN_FLOOR_BPF + ' floor -- the tangential wall/ceiling damp is allocating');
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
        + bpfMix.toFixed(2) + ' B/frame from a shapes[] mix under wind + full box + turbulence/gust + vortex + trails, '
        + bpfSettle.toFixed(2) + ' B/frame from a fully-settled (frozen) pile, '
        + bpfEmit.toFixed(2) + ' B/frame from a continuous ring-emitter spray, '
        + bpfStagger.toFixed(2) + ' B/frame from a staggered burst mid-emission, '
        + bpfAlign.toFixed(2) + ' B/frame from a velocity-aligned live pool, '
        + bpfSpin.toFixed(2) + ' B/frame from a tumble-scaled (spinRate + turbulence) live pool, '
        + bpfScale.toFixed(2) + ' B/frame from a size-ramped (scaleTo + flutter) live pool, '
        + bpfFlut.toFixed(2) + ' B/frame from a flutter-rated (flutterRate + turbulence) live pool, '
        + bpfFade.toFixed(2) + ' B/frame from a fade-in (fadeIn + flutter) live pool, '
        + bpfFadeOut.toFixed(2) + ' B/frame from a death-fade (fadeOut + flutter) live pool, '
        + bpfFric.toFixed(2) + ' B/frame from a floor-friction (skidding) live pool, '
        + bpfWfric.toFixed(2) + ' B/frame from a wall-friction (wall-skid) live pool); '
        + SOAK + '-frame window no major GC [' + gcLine + ']');
}
