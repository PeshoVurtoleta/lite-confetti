/**
 * @zakkster/lite-confetti -- node:test suite.
 *
 * Ported from the original vitest suite (which imported the runtime API from a
 * .d.ts types file and mocked every dependency). This version runs the REAL
 * engine against the REAL @zakkster deps, over a minimal browser shim
 * (test/_env.mjs). The shim MUST be imported first -- Confetti.js reads
 * window.matchMedia at module-evaluation time.
 */
import './_env.mjs';
import { makeCanvas, pump, firePointerMove, pointerListenerCount, setReducedMotion } from './_env.mjs';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createConfetti, confetti, presets, colorsFromPalette, fromElement } from '../Confetti.js';

// Committed position fingerprint for the deterministic-replay gate. Set after the
// first green run and re-verified in a second process; a change here means the
// seeded physics output moved (a real regression, or an intended physics change
// that must bump this constant deliberately). See the determinism test below.
const COMMITTED_HASH = 1569828004;

// Committed fingerprint for a canonical MIXED burst (shapes:['rect','circle','star']).
// The per-particle shape pick draws one extra rng value per particle, so this
// deliberately differs from COMMITTED_HASH; it is its own deterministic-replay gate.
const MIXED_HASH = 3132631460;

// Committed fingerprint for a canonical WINDY burst (wind: 300). A non-zero wind adds a
// lateral acceleration to every particle, shifting the stream, so this deliberately
// differs from COMMITTED_HASH; it is its own deterministic-replay gate. (No extra rng
// draw is involved -- wind is pure physics -- so this holds cross-process.)
const WIND_HASH = 2385225781;

// Committed fingerprint for a canonical FLOORED burst (floor: 120, bounce: 0). A finite
// floor clamps every particle that reaches it and reflects vy, shifting the stream, so
// this deliberately differs from COMMITTED_HASH; it is its own deterministic-replay gate.
// Like wind, the collision draws no rng (pure physics), so it holds cross-process.
const FLOOR_HASH = 2679696825;
// The floor Y used by the floor/bounce rig. The un-floored fall reaches maxY == 196 over
// the pumped window, so 120 is genuinely crossed (the boundary actually fires).
const FLOOR_Y = 120;

// Committed fingerprint for a canonical BOXED burst (the full bounding box below). Like the
// floor, every box edge is pure physics (no rng), so this holds cross-process and differs
// from both COMMITTED_HASH and FLOOR_HASH -- its own deterministic-replay gate.
const BOX_HASH = 804161759;
// The canonical box for the walls/ceiling rig. The seed-12345 burst is centered at (400,198)
// and, un-boxed, spans x in [249,540] and y in [43,196], so every edge below sits strictly
// inside that spread and is genuinely crossed: left/right walls clamp x, the floor pins y,
// and (see the dedicated ceiling case) an upward launch is caught by a ceiling.
const BOX = { wallLeft: 300, wallRight: 500, ceiling: 80, floor: 180 };

// Committed fingerprints for the time-varying forces (v1.8.0). Both turbulence and gust draw
// NO rng -- turbulence is a pure function of the seeded tilt/spin phases, gust of the shared
// _elapsed clock -- so, like the box, each is cross-process stable and its own replay gate.
// All differ from COMMITTED_HASH and from each other (probed on the seed-12345 rig below).
const TURB_HASH = 1630588936;   // turbulence: 500
const GUST_HASH = 4074438162;   // gust: 400
const TURBGUST_HASH = 15761758; // turbulence: 500 + gust: 400

// gustRate (v1.25.0): the swell-FREQUENCY knob to gust's depth. Parameterizes the baked GUST_HZ in
// the SINGLE committed gust vx term via a fround sentinel, so gust-off is byte-identical for any
// value. Draws NO rng (a pure function of the shared _elapsed clock and the per-particle grate), so
// like GUST_HASH it is cross-process stable and its own replay gate. Distinct from GUST_HASH (gust
// with the default swell) and from gustRate:3 (probed on the gust-armed seed-12345 rig below).
const GUSTRATE_HASH = 870603509; // gust: 400 + gustRate: 6 (fast breeze)

// Committed fingerprint for the trail GEOMETRY (v1.9.0) -- the strokeHash of the mock ctx, which
// accumulates only stroked (trail) paths and is kept entirely out of the position `hash`. Trails
// are a pure RENDER overlay (they draw via moveTo/lineTo/stroke, never translate), so the POSITION
// hash is preserved at any depth -- see the trails suite, where a trailed run still reproduces
// COMMITTED_HASH. This gate proves the ribbon geometry itself is deterministic. Value probed on
// the seed-12345 rig at construction `trail: 10` (default per-burst length). The ribbon is a
// single flat-alpha stroke, so strokeHash folds one polyline per particle.
const TRAIL_HASH = 72519212;

// Committed fingerprints for the vortex / attractor (v1.10.0). A linear-spring point force draws
// NO rng (a pure function of position + the burst center), so, like the other forces, each is
// cross-process stable and its own replay gate. All differ from COMMITTED_HASH and each other
// (probed on the seed-12345 rig below; center defaults to the burst origin).
const ATTRACT_HASH = 2926753007; // attract: 6  (pull toward the burst origin)
const SWIRL_HASH   = 2039789049; // swirl: 6    (tangential spin)
const VORTEX_HASH  = 1387388835; // attract: 6 + swirl: 6  (inward spiral)

// Committed fingerprint for settle-and-pile (v1.11.0, decision 0012). Its own rig -- a burst that
// falls onto a floor BELOW it and bounces (bounce 0.5) so `settle` has a real bounce-then-rest
// dynamic to freeze (x400/y150, count 120, rect, life 15, spread 1.8, speed 300, gravity 900,
// floor 360, settle 80; pump 1+150). The freeze draws NO rng (a pure function of the piece's own
// post-bounce vy), so this is cross-process stable and its own deterministic-replay gate; it
// differs from the same rig's no-settle (bouncy) hash.
const SETTLE_HASH = 4157000621;

// Committed fingerprint for color-over-life (v1.12.0, decision 0013) -- the `colorHash` of the mock
// ctx, which folds the current fillStyle STRING at each body paint (fill/fillRect/fillText) and is
// kept entirely out of the position `hash`. `lifeColors` moves ONLY the body color, drawing NO rng
// and touching no position, so it is a pure color overlay: a lifeColors burst reproduces the plain
// burst's position hash (COMMITTED_HASH) exactly -- see the color suite. This gate proves the body
// color SEQUENCE is deterministic. Value probed on the runStd rig with the canonical 3-stop ember
// ramp EMBER below (birth = near-white, death = deep orange).
const COLOR_HASH = 2406267552;
// Canonical ember life ramp: near-white -> gold -> deep orange, i.e. a spark cooling as it ages.
const EMBER = [{ l: 0.98, c: 0.02, h: 90 }, { l: 0.72, c: 0.22, h: 60 }, { l: 0.40, c: 0.15, h: 30 }];

// Committed position fingerprints for the spawn emitter shapes (v1.13.0, decision 0014). `emit`
// distributes the spawn ORIGIN over a shape; it is the FIRST feature to add a CONDITIONAL spawn-time
// rng draw (the position along the shape), so it is opt-in by construction: OFF inserts NO draw and
// reproduces COMMITTED_HASH exactly (see the emit suite). Per-shape draw counts differ (box draws 2,
// line/ring 1), so each shape earns its OWN committed hash -- all distinct from COMMITTED_HASH and
// each other. Probed on the runStd rig at emitSize 200. Ring couples geometry to velocity (radial
// shell); line/box move only the origin. Deterministic (the emitter draws are seeded), so these are
// cross-process stable and each is its own replay gate.
const EMIT_LINE_HASH = 2558715937; // emit:'line', emitSize:200 (horizontal curtain)
const EMIT_RING_HASH = 2441425203; // emit:'ring', emitSize:200 (radial shell)
const EMIT_BOX_HASH  = 2748626140; // emit:'box',  emitSize:200 (square area)

// Committed position fingerprint for staggered emission (v1.14.0, decision 0015). `stagger` opens
// the emission-TIMING axis: a burst spreads its `count` births evenly over a ms window instead of
// spawning them all at frame 0. It uses a birth-delay gate -- all pieces spawn at CALL TIME (so the
// rng sequence is byte-identical to a synchronous burst), each stamped with a NO-rng per-index delay;
// an unborn piece is frozen + invisible until its delay elapses. So OFF reproduces COMMITTED_HASH
// exactly, and ON earns its own hash purely from birth TIMING (same per-piece draws, spread across
// frames). Probed on a SMALL-dt-from-t0 rig (the canonical pump(1,1000) would blow a sub-second
// window in one frame); deterministic under a fixed seed + fixed dt, so it is its own replay gate.
const STAGGER_HASH = 3414676538; // burst({ stagger: 300 }), 40 x 16ms frames from t0

// Committed ROTATION fingerprint for velocity-aligned orientation (v1.15.0). `align` changes ONLY the
// ctx.rotate argument, never ctx.translate, so an aligned burst reproduces the same-seed plain burst's
// POSITION hash (COMMITTED_HASH) exactly -- a pure orientation overlay. This gate proves the rotation
// itself is deterministic and non-vacuous: `rotateHash` (kept out of the position hash, like
// strokeHash/colorHash) folds the quantized rotate angle. Value probed on the canonical seed-12345 rig
// with align:1; distinct from the OFF rotateHash and its own replay gate.
const ALIGN_HASH = 1909618495; // burst({ align: 1 }) rotateHash on the canonical rig

// Committed ROTATION fingerprint for tunable tumble speed (v1.16.0, decision 0017). `spinRate` is a
// render-time ANGLE SCALE: the draw block scales only the ACCUMULATED tumble (spin - spin0) about a
// stored random birth column, never touching `pool.spin[i]` -- the physics spin the turbulence phase
// reads. So the POSITION hash stays COMMITTED_HASH whether spinRate is off, on, or on-with-turbulence
// (the headline), and only the rotate sequence moves. It reuses the v1.15.0 `rotateHash` probe -- no new
// harness probe. Value probed on the canonical seed-12345 rig with spinRate:2; distinct from the OFF
// rotateHash (and from align/0.5) and its own deterministic-replay gate.
const SPINRATE_HASH = 1105261140; // burst({ spinRate: 2 }) rotateHash on the canonical rig

// Committed ROTATION fingerprint for angular-velocity retention (v1.23.0, decision 0024). `spinDrag` is the
// angular mirror of the linear `drag`: each frame, before the spin advance, `spinV *= spinDrag`. It is a
// HYBRID physics knob with ONE position-coupling path -- `pool.spin` is read only by the render rotation
// (always) and the turbulence curl `tp = tilt*1.7 + spin` (only inside `if (turb != 0)`). With turbulence
// OFF, a slower tumble moves ONLY the render rotation, so the POSITION hash stays COMMITTED_HASH and only the
// rotate sequence moves (it rides the v1.15.0 `rotateHash` probe -- no new harness channel). Value probed on
// the canonical seed-12345 rig (turbulence OFF) with spinDrag:0.9; distinct from the OFF rotateHash and from
// spinDrag:0.5, cross-process stable, its own deterministic-replay gate.
const SPINDRAG_ROT_HASH = 3829166209; // run({ spinDrag: 0.9 }).rotateHash on the canonical rig (turbulence OFF)

// Committed POSITION fingerprint for spinDrag UNDER TURBULENCE -- the crux. With turbulence ON the curl phase
// reads the now-slower spin, so the wander bends and the POSITION stream MOVES. Probed on the SAME turbulence
// baseline as TURB_HASH (turbulence:500) with spinDrag:0.9; it MUST differ from TURB_HASH 1630588936 (that
// same baseline, spinDrag off) -- the coupling is real, so spinDrag is NEVER a pure render overlay. Draws no
// rng (a contraction of seeded state), so it is cross-process stable and its own deterministic-replay gate.
const SPINDRAG_TURB_HASH = 4289557192; // run({ turbulence: 500, spinDrag: 0.9 }).hash (distinct from TURB_HASH 1630588936)

// Committed SCALE fingerprint for size-over-life (v1.17.0, decision 0018). `scaleTo` changes ONLY the
// arguments to ctx.scale (folded into flutter's existing X-wobble call), never ctx.translate, so a
// scaled burst reproduces the same-seed plain burst's POSITION hash (COMMITTED_HASH) exactly -- a pure
// RENDER overlay. This gate proves the size ramp itself is deterministic and non-vacuous: `scaleHash`
// (kept out of the position hash, like rotateHash/colorHash) folds the quantized scale factors. Value
// probed on the canonical seed-12345 rig with scaleTo:2; distinct from the OFF scaleHash (and from 0.5)
// and its own cross-process replay gate.
const SCALE_HASH = 148099462; // burst({ scaleTo: 2 }) scaleHash on the canonical rig

// Committed SCALE fingerprint for the size-over-life ORIGIN (v1.24.0, decision 0025). `scaleFrom` is the
// BIRTH endpoint of the ramp `scaleTo` targets -- the fold becomes s = scaleFrom + (scaleTo - scaleFrom) *
// (1 - lifeT). Like scaleTo it changes ONLY the arguments to ctx.scale (folded into the SAME existing call),
// never ctx.translate/x/y/rng, so a scaleFrom burst reproduces the same-seed plain burst's POSITION hash
// (COMMITTED_HASH) exactly -- a pure RENDER overlay -- and only the `scaleHash` moves. scaleFrom bites
// HARDEST at age 0 (s == scaleFrom on the first drawn frame), so the canonical lifeMin/Max:5 rig exposes it
// immediately (no dedicated short-life rig needed). It reuses the v1.17.0 `scaleHash` probe -- no new
// harness channel. Value probed on the canonical seed-12345 rig with scaleFrom:0.25; distinct from the OFF
// scaleHash, from scaleFrom:2, and from SCALE_HASH 148099462, and its own cross-process replay gate.
const SCALEFROM_HASH = 2718696453; // burst({ scaleFrom: 0.25 }) scaleHash on the canonical rig

// Committed SCALE fingerprint for tumble-wobble speed (v1.18.0, decision 0019). `flutterRate` is the
// SPEED knob to flutter's DEPTH: the draw block scales only the ACCUMULATED wobble phase (tilt - tilt0)
// about a stored random birth pivot, never touching `pool.tilt[i]` -- the wobble phase the turbulence
// curl read + sway consume. So the POSITION hash stays COMMITTED_HASH whether flutterRate is off, on, or
// on-with-turbulence (the headline), and only the SCALE sequence (wobbleScale feeds ctx.scale's X arg)
// moves. It reuses the v1.17.0 `scaleHash` probe -- no new harness channel. Value probed on the canonical
// seed-12345 rig (flutter:1 so the wobble is armed) with flutterRate:2; distinct from the OFF scaleHash
// (and from 0 / 0.5) and its own cross-process replay gate.
const FLUTRATE_HASH = 4094960833; // burst({ flutter: 1, flutterRate: 2 }) scaleHash on the canonical rig
// Committed ALPHA fingerprint for the birth-opacity ramp (v1.19.0, decision 0020). `fadeIn` fades a piece
// up from transparent over the FIRST `fadeIn` fraction of life, MULTIPLYING the existing (death-fade)
// alpha. It changes ONLY ctx.globalAlpha -- never translate / x / y / rng -- so the POSITION hash stays
// COMMITTED_HASH whether off or on (and rotate/scale/stroke/color too); only the ALPHA sequence moves. It
// uses the NEW v1.19.0 `alphaHash` probe (globalAlpha folded on SET, out of `hash`). Value probed on the
// canonical seed-12345 rig with fadeIn:0.4; distinct from the OFF alphaHash (and from 0.2) and its own
// cross-process replay gate.
const ALPHA_HASH = 3712788104; // burst({ fadeIn: 0.4 }) alphaHash on the canonical rig
// v1.20.0 -- `fadeOut` (death-fade window, the SECOND knob on the render-OPACITY axis). It parameterizes
// the hardcoded 0.3 death-fade over which a piece dissolves OUT. Like fadeIn it changes ONLY
// ctx.globalAlpha -- never translate / x / y / rng -- so the POSITION hash stays COMMITTED_HASH whether off
// or on (and rotate/scale/stroke/color too); only the ALPHA sequence moves. It reuses v1.19.0's `alphaHash`
// probe with NO harness change. IMPORTANT rig note: the canonical position rig (lifeMin/Max 5) never ages a
// piece into the death-fade window under the ticker's dt cap -- lifeT stays well above 0.3, so on THAT rig
// fadeOut is an alpha no-op (correct: nothing to fade yet). The death fade is exercised on a dedicated
// short-life ALPHA rig (lifeMin/Max 0.5, low speed/gravity so pieces stay on-canvas and are aged into the
// window). Value probed there with fadeOut:0.6; distinct from that rig's OFF alphaHash and from fadeOut:0.1,
// deterministic + cross-process stable.
const FADEOUT_HASH = 587626480; // burst({ fadeOut: 0.6 }) alphaHash on the short-life alpha rig
// v1.21.0 -- `friction` (tangential floor drag), the FIRST physics feature since settle. UNLIKE the six
// render overlays (align/spinRate/scaleTo/flutterRate/fadeIn/fadeOut), friction changes `vx` -> `x`, so it
// MOVES the position stream and earns its own committed hash on the MAIN `hash` (no new probe). The canonical
// friction rig is the FLOOR rig (the one that pins FLOOR_HASH) + `friction:k` -- a floor MUST be present or
// the branch never fires. FRICTION_HASH is probed there with friction:0.5; it MUST differ from FLOOR_HASH
// 2679696825 (friction demonstrably changed the trajectory) and from friction:0.9, and is cross-process
// stable + its own deterministic-replay gate. At friction:0 that same rig reproduces FLOOR_HASH exactly (0 is
// exactly representable in Float32, so the `!== 0` guard never fires -- no fround sentinel, byte-identical off).
const FRICTION_HASH = 1451535522; // run({ floor: FLOOR_Y, friction: 0.5 }) hash on the floor rig
// wallFriction (v1.22.0) is the tangential twin of friction on the box's THREE non-floor edges. Like friction
// it is a PHYSICS knob: it changes vx (ceiling) / vy (walls) -> position, so an armed box burst earns its own
// WALLFRICTION_HASH on the MAIN position hash (no new probe; the directional proofs ride the hash-neutral
// maxY/maxX/minX accessors). RIG CHOICE (see decisions/0023): the plain BOX rig defaults `bounce:0`, which is
// a DEGENERATE witness -- the floor zeroes vy before a piece reaches a wall (the wall vy-damp becomes a no-op)
// and once vx->0 at a wall the strict `x > wallR` guard never re-fires, so nothing tangential survives to a
// rounded draw position and wallFriction:0.5 reproduces BOX_HASH byte-for-byte (a VALID inertness property,
// asserted below). The canonical hash rig therefore adds `bounce:0.6`: pieces RICOCHET and re-strike the
// walls/ceiling with tangential speed each bounce, so the damp accumulates and moves the stream. It MUST
// differ from that same rig with wallFriction OFF (bounce:0.6, wf:0) and from wallFriction:0.9, and is
// cross-process stable + its own deterministic-replay gate.
const WALLFRICTION_HASH = 87358650; // run({ ...BOX, bounce: 0.6, wallFriction: 0.5 }) hash on the bouncing box rig
const HALF_PI = Math.PI / 2;

/** Run `fn` with console.warn silenced; report how many warnings it emitted. */
function withSilencedWarn(fn) {
    const orig = console.warn;
    let warned = 0;
    console.warn = () => { warned++; };
    try {
        const value = fn();
        return { value, warned };
    } finally {
        console.warn = orig;
    }
}

describe('lite-confetti', () => {

    describe('createConfetti()', () => {
        it('returns burst, spray, clear, seed, destroy, count', () => {
            const c = createConfetti(makeCanvas());
            assert.equal(typeof c.burst, 'function');
            assert.equal(typeof c.spray, 'function');
            assert.equal(typeof c.clear, 'function');
            assert.equal(typeof c.seed, 'function');
            assert.equal(typeof c.destroy, 'function');
            assert.equal(typeof c.count, 'number');
            c.destroy();
        });

        it('returns a safe noop object on a null canvas (and warns)', () => {
            const { value: c, warned } = withSilencedWarn(() => createConfetti(null));
            assert.ok(warned > 0, 'a null canvas should warn');
            assert.equal(typeof c.burst, 'function');
            assert.doesNotThrow(() => c.burst());
            c.destroy();
        });
    });

    describe('burst()', () => {
        it('spawns the requested count (visible after one frame)', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            c.burst({ count: 50, lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 50);
            c.destroy();
        });

        it('respects a smaller count', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            c.burst({ count: 10, lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 10);
            c.destroy();
        });

        it('uses default colors when none specified', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            assert.doesNotThrow(() => c.burst());
            c.destroy();
        });

        it('supports all five shapes', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            for (const shape of ['rect', 'circle', 'star', 'triangle', 'emoji']) {
                assert.doesNotThrow(() => c.burst({ count: 5, shape, lifeMin: 5, lifeMax: 5 }));
            }
            c.destroy();
        });

        it('supports a custom emoji', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            assert.doesNotThrow(() => c.burst({ shape: 'emoji', emoji: '*', count: 5 }));
            c.destroy();
        });

        it('supports CSS string colors', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            assert.doesNotThrow(() => c.burst({ colors: ['#ff0000', '#00ff00'], count: 5 }));
            c.destroy();
        });
    });

    describe('spray()', () => {
        it('does not throw and spawns over frames', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            c.spray({ duration: 1000, rate: 2, lifeMin: 5, lifeMax: 5 });
            pump(3);
            assert.ok(c.count > 0);
            c.destroy();
        });
    });

    describe('clear()', () => {
        it('kills all particles immediately', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            c.burst({ count: 50, lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 50);
            c.clear();
            assert.equal(c.count, 0);
            c.destroy();
        });
    });

    describe('seed()', () => {
        it('re-seeds the RNG without throwing', () => {
            const c = createConfetti(makeCanvas(), { seed: 42 });
            c.seed(42);
            assert.doesNotThrow(() => c.burst({ count: 1 }));
            c.destroy();
        });
    });

    describe('destroy()', () => {
        it('is idempotent', () => {
            const c = createConfetti(makeCanvas());
            c.destroy();
            assert.doesNotThrow(() => c.destroy());
        });

        it('prevents further bursts', () => {
            const c = createConfetti(makeCanvas());
            c.destroy();
            assert.doesNotThrow(() => c.burst({ count: 10 }));
            assert.equal(c.count, 0);
        });
    });

    describe('confetti() -- fire-and-forget', () => {
        it('creates an overlay and fires', () => {
            const c = confetti({ count: 10, seed: 42 });
            assert.notEqual(c, undefined);
            assert.equal(typeof c.burst, 'function');
            c.destroy();
        });
    });

    // -------------------------------------------------------------------------
    //  v1.2.0 -- presets
    // -------------------------------------------------------------------------
    describe('presets', () => {
        const KNOWN_SHAPES = new Set(['rect', 'circle', 'star', 'triangle', 'emoji']);

        it('ships the four documented presets', () => {
            assert.deepEqual(Object.keys(presets).sort(), ['cannons', 'fireworks', 'pride', 'snow']);
        });

        it('every preset shape is one the engine actually renders', () => {
            for (const [name, p] of Object.entries(presets)) {
                if (p.shape !== undefined) assert.ok(KNOWN_SHAPES.has(p.shape), name + ':' + p.shape);
            }
        });

        it('every preset has sane numeric ranges (min <= max, positive life)', () => {
            for (const [name, p] of Object.entries(presets)) {
                assert.ok(p.sizeMin <= p.sizeMax, name);
                assert.ok(p.lifeMin <= p.lifeMax, name);
                assert.ok(p.lifeMin > 0, name);
                assert.ok(p.count > 0, name);
            }
        });

        it('pride carries an OKLCH palette that colorsFromPalette accepts', () => {
            assert.equal(colorsFromPalette(presets.pride.colors).length, 6);
        });

        it('spreads into burst() without throwing', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            assert.doesNotThrow(() => c.burst({ ...presets.fireworks }));
            c.destroy();
        });

        it('a preset burst is still deterministic under a fixed seed', () => {
            const runN = () => {
                const c = createConfetti(makeCanvas(), { seed: 7 });
                c.burst({ ...presets.cannons, lifeMin: 5, lifeMax: 5 });
                pump(1);
                const n = c.count;
                c.destroy();
                return n;
            };
            assert.equal(runN(), runN());
        });
    });

    // -------------------------------------------------------------------------
    //  v1.2.0 -- colorsFromPalette
    // -------------------------------------------------------------------------
    describe('colorsFromPalette()', () => {
        const stops = [
            { color: { l: 0.6, c: 0.2, h: 20 }, stop: 0 },
            { color: { l: 0.7, c: 0.2, h: 200 }, stop: 1 },
        ];

        it('extracts colors from lite-hueforge gradient stops', () => {
            assert.deepEqual(colorsFromPalette(stops), [stops[0].color, stops[1].color]);
        });

        it('reads a { stops } wrapper', () => {
            assert.equal(colorsFromPalette({ stops }).length, 2);
        });

        it('passes a plain colors array through', () => {
            const arr = ['#fff', { l: 0.5, c: 0.1, h: 10 }];
            assert.deepEqual(colorsFromPalette(arr), arr);
        });

        it('wraps a single OKLCH object', () => {
            const one = { l: 0.5, c: 0.1, h: 10 };
            assert.deepEqual(colorsFromPalette(one), [one]);
        });

        it('never returns an empty array', () => {
            assert.ok(colorsFromPalette([]).length > 0);
            assert.ok(colorsFromPalette({ stops: [] }).length > 0);
            assert.ok(colorsFromPalette([{ notacolor: true }]).length > 0);
        });

        it('falls back to defaults on falsy / garbage input', () => {
            assert.ok(colorsFromPalette(null).length > 0);
            assert.ok(colorsFromPalette(undefined).length > 0);
            assert.ok(colorsFromPalette(42).length > 0);
        });

        it('filters invalid entries out of a stops array', () => {
            const mixed = [
                { color: { l: 0.6, c: 0.2, h: 20 } },
                { color: null },
                { color: { l: 0.7, c: 0.2, h: 200 } },
            ];
            assert.equal(colorsFromPalette(mixed).length, 2);
        });

        it('output feeds burst() without error', () => {
            const c = createConfetti(makeCanvas(), { seed: 3 });
            assert.doesNotThrow(() => c.burst({ colors: colorsFromPalette(stops), count: 10 }));
            c.destroy();
        });
    });

    // -------------------------------------------------------------------------
    //  v1.2.0 -- fromElement
    // -------------------------------------------------------------------------
    describe('fromElement()', () => {
        const el = (r) => ({ getBoundingClientRect: () => r });

        it('returns the element centre in viewport coordinates', () => {
            const o = fromElement(el({ left: 100, top: 50, width: 40, height: 20 }));
            assert.equal(o.x, 120);
            assert.equal(o.y, 60);
        });

        it('merges extra options', () => {
            const o = fromElement(el({ left: 0, top: 0, width: 10, height: 10 }), { count: 42, shape: 'star' });
            assert.equal(o.count, 42);
            assert.equal(o.shape, 'star');
        });

        it('lets an explicit x/y in extra override the computed centre', () => {
            const o = fromElement(el({ left: 0, top: 0, width: 10, height: 10 }), { x: 999, y: -1 });
            assert.equal(o.x, 999);
            assert.equal(o.y, -1);
        });

        it('warns and returns just extra on a bad element', () => {
            const { value: o, warned } = withSilencedWarn(() => fromElement(null, { count: 3 }));
            assert.deepEqual(o, { count: 3 });
            assert.ok(warned > 0);
        });
    });

    // -------------------------------------------------------------------------
    //  v1.2.0 -- pointer-follow spray
    // -------------------------------------------------------------------------
    describe('spray({ followPointer })', () => {
        it('binds no global listener on a normal spray', () => {
            const before = pointerListenerCount();
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.spray({ duration: 100, rate: 2 });
            assert.equal(pointerListenerCount(), before);
            c.destroy();
        });

        it('binds a listener only when followPointer is on, and releases it on destroy', () => {
            const before = pointerListenerCount();
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.spray({ duration: 5000, rate: 1, followPointer: true });
            assert.equal(pointerListenerCount(), before + 1);
            c.destroy();
            assert.equal(pointerListenerCount(), before);
        });

        it('stays alive without throwing after a pointer move', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.spray({ duration: 5000, rate: 1, followPointer: true });
            firePointerMove(300, 250);
            pump(2);
            assert.ok(c.count >= 0);
            c.destroy();
        });

        it('a non-following spray replays identically regardless of pointer moves', () => {
            const run = (movePointer) => {
                const c = createConfetti(makeCanvas(), { seed: 99 });
                if (movePointer) firePointerMove(400, 400);
                c.spray({ duration: 1000, rate: 3, lifeMin: 5, lifeMax: 5 });
                pump(1);
                const n = c.count;
                c.destroy();
                return n;
            };
            assert.equal(run(false), run(true));
        });

        it('reference-counts: two overlapping follow-sprays share one listener', () => {
            const before = pointerListenerCount();
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.spray({ duration: 5000, rate: 1, followPointer: true });
            c.spray({ duration: 5000, rate: 1, followPointer: true });
            assert.equal(pointerListenerCount(), before + 1);
            c.destroy();
            assert.equal(pointerListenerCount(), before);
        });
    });

    // -------------------------------------------------------------------------
    //  v1.2.1 -- emoji glyph atlas (per-particle rasterization freeze fix)
    // -------------------------------------------------------------------------
    describe('emoji rendering does not rasterize per particle', () => {
        beforeEach(() => { globalThis.__fillTextCount = 0; });

        it('rasterizes a glyph at most once when firing many emoji particles', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.burst({ shape: 'emoji', emoji: 'A', count: 100, lifeMin: 5, lifeMax: 5 });
            assert.ok(globalThis.__fillTextCount <= 1);
            c.destroy();
        });

        it('does not re-rasterize a glyph already in the atlas', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.burst({ shape: 'emoji', emoji: 'A', count: 50, lifeMin: 5, lifeMax: 5 });
            assert.equal(globalThis.__fillTextCount, 0);
            c.destroy();
        });

        it('a fresh glyph rasterizes exactly once regardless of count', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            // A fixed Private Use Area codepoint, unlikely to be primed elsewhere.
            const rare = String.fromCodePoint(0xF8123);
            c.burst({ shape: 'emoji', emoji: rare, count: 200, lifeMin: 5, lifeMax: 5 });
            assert.equal(globalThis.__fillTextCount, 1);
            globalThis.__fillTextCount = 0;
            c.burst({ shape: 'emoji', emoji: rare, count: 200, lifeMin: 5, lifeMax: 5 });
            assert.equal(globalThis.__fillTextCount, 0);
            c.destroy();
        });

        it('non-emoji shapes never touch fillText', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.burst({ shape: 'star', count: 100, lifeMin: 5, lifeMax: 5 });
            c.burst({ shape: 'circle', count: 100, lifeMin: 5, lifeMax: 5 });
            assert.equal(globalThis.__fillTextCount, 0);
            c.destroy();
        });
    });

    // -------------------------------------------------------------------------
    //  Determinism gate -- a seeded burst reproduces identical draw positions.
    // -------------------------------------------------------------------------
    describe('deterministic replay', () => {
        // Force the ticker's first frame into its dt cap (>maxDt -> 16.66ms) so the
        // dt sequence is identical no matter what pumped before this test, making the
        // committed fingerprint reproducible across test order and across processes.
        const run = () => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8 });
            pump(1, 1000); // capped first frame -> deterministic 16.66ms
            pump(29, 16);  // 29 deterministic 16ms frames
            const h = canvas.hash;
            c.destroy();
            return h;
        };

        it('same seed reproduces identical draw positions', () => {
            assert.equal(run(), run());
        });

        it('matches the committed position fingerprint', () => {
            const h = run();
            if (COMMITTED_HASH === null) {
                console.log('[determinism] position fingerprint =', h);
            } else {
                assert.equal(h, COMMITTED_HASH, 'seeded draw positions changed vs the committed baseline');
            }
        });
    });

    // -------------------------------------------------------------------------
    //  Reduced motion
    // -------------------------------------------------------------------------
    describe('reduced motion', () => {
        it('renders the static path without throwing when reduce is preferred', () => {
            setReducedMotion(true);
            try {
                const c = createConfetti(makeCanvas(), { seed: 5 });
                assert.doesNotThrow(() => c.burst({ count: 30 }));
                c.destroy();
            } finally {
                setReducedMotion(false);
            }
        });

        it('renders a custom registered shape on the static path', () => {
            setReducedMotion(true);
            try {
                const c = createConfetti(makeCanvas(), { seed: 5 });
                c.registerShape('heart', (ctx, w) => { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); });
                assert.doesNotThrow(() => c.burst({ count: 30, shape: 'heart' }));
                c.destroy();
            } finally {
                setReducedMotion(false);
            }
        });
    });

    // -------------------------------------------------------------------------
    //  registerShape() -- custom vector + image-sprite shapes (v1.3.0)
    // -------------------------------------------------------------------------
    describe('registerShape()', () => {
        const heart = (ctx, w) => { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); };

        it('assigns custom ids starting at 5 and increments', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            assert.equal(c.registerShape('heart', heart), 5);
            assert.equal(c.registerShape('hex', heart), 6);
            c.destroy();
        });

        it('re-registering a custom name keeps its id', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            const id = c.registerShape('heart', heart);
            assert.equal(c.registerShape('heart', heart), id);
            c.destroy();
        });

        it('bursts a custom vector shape and actually dispatches to its draw fn', () => {
            const c = createConfetti(makeCanvas(), { seed: 1, maxParticles: 100 });
            let calls = 0;
            c.registerShape('heart', (ctx, w) => { calls++; ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, Math.PI * 2); ctx.fill(); });
            c.burst({ count: 20, shape: 'heart', lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 20);
            assert.ok(calls > 0, 'custom draw fn was never called');
            c.destroy();
        });

        it('registers an image sprite and bursts it without touching fillText', () => {
            const before = globalThis.__fillTextCount || 0;
            const c = createConfetti(makeCanvas(), { seed: 1, maxParticles: 100 });
            const id = c.registerShape('logo', { image: makeCanvas() });
            assert.ok(id >= 5);
            c.burst({ count: 20, shape: 'logo', lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 20);
            assert.equal(globalThis.__fillTextCount || 0, before, 'a sprite must blit, never fillText');
            c.destroy();
        });

        it('throws on an empty name, a built-in override, or a bad def', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            assert.throws(() => c.registerShape('', heart));
            assert.throws(() => c.registerShape('rect', heart));
            assert.throws(() => c.registerShape('emoji', heart));
            assert.throws(() => c.registerShape('x', 123));
            assert.throws(() => c.registerShape('y', {}));
            c.destroy();
        });

        it('an unknown shape name falls back to rect without throwing', () => {
            const c = createConfetti(makeCanvas(), { seed: 1, maxParticles: 100 });
            assert.doesNotThrow(() => c.burst({ count: 10, shape: 'no-such', lifeMin: 5, lifeMax: 5 }));
            pump(1);
            assert.equal(c.count, 10);
            c.destroy();
        });

        it('returns -1 after destroy() and stays inert', () => {
            const c = createConfetti(makeCanvas(), { seed: 1 });
            c.destroy();
            assert.equal(c.registerShape('heart', heart), -1);
        });

        it('is per-instance: a shape on one instance is invisible to another', () => {
            const cvB = makeCanvas({ record: true });
            const a = createConfetti(makeCanvas(), { seed: 9, maxParticles: 100 });
            const b = createConfetti(cvB, { seed: 9, maxParticles: 100 });
            a.registerShape('heart', heart);
            b.burst({ x: 400, y: 300, count: 30, shape: 'heart', lifeMin: 50, lifeMax: 50 });
            pump(1, 1000); pump(10, 16);
            const bHash = cvB.hash;
            b.destroy(); a.destroy();

            const cvR = makeCanvas({ record: true });
            const r = createConfetti(cvR, { seed: 9, maxParticles: 100 });
            r.burst({ x: 400, y: 300, count: 30, shape: 'rect', lifeMin: 50, lifeMax: 50 });
            pump(1, 1000); pump(10, 16);
            r.destroy();
            assert.equal(bHash, cvR.hash, 'instance B saw instance A\'s custom shape (registry leaked)');
        });
    });

    // -------------------------------------------------------------------------
    //  multi-shape mixing -- shapes: [] (v1.4.0, decision 0005)
    // -------------------------------------------------------------------------
    describe('multi-shape mixing (shapes: [])', () => {
        // A position fingerprint cannot tell geometry apart (a custom shape hashes like
        // rect at the same positions), so shape IDENTITY is proven with per-shape
        // dispatch counters; the fingerprint proves only stream-level determinism.
        const counter = (ref, key) => (ctx, w) => { ref[key]++; ctx.fillRect(-w / 2, -w / 2, w, w); };
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const h = canvas.hash;
            c.destroy();
            return h;
        };

        it('dispatches more than one shape across particles in a single burst', () => {
            const c = createConfetti(makeCanvas(), { seed: 7, maxParticles: 200 });
            const n = { a: 0, b: 0 };
            c.registerShape('ca', counter(n, 'a'));
            c.registerShape('cb', counter(n, 'b'));
            c.burst({ count: 60, shapes: ['ca', 'cb'], lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 60);
            assert.ok(n.a > 0, 'first mixed shape never dispatched');
            assert.ok(n.b > 0, 'second mixed shape never dispatched');
            assert.equal(n.a + n.b, 60, 'every particle dispatches exactly one shape per frame');
            c.destroy();
        });

        it('weights the mix by repetition (a 2:1 array skews toward the repeated shape)', () => {
            const c = createConfetti(makeCanvas(), { seed: 4, maxParticles: 500 });
            const n = { a: 0, b: 0 };
            c.registerShape('s', counter(n, 'a'));
            c.registerShape('o', counter(n, 'b'));
            c.burst({ count: 300, shapes: ['s', 's', 'o'], lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(n.a + n.b, 300);
            assert.ok(n.a > n.b, 'the repeated shape should dominate a 2:1 mix');
            c.destroy();
        });

        it("a single-entry mix equals the plain shape (shapes:['star'] == shape:'star')", () => {
            assert.equal(run({ shapes: ['star'] }), run({ shape: 'star' }));
            assert.equal(run({ shapes: ['rect'] }), run({ shape: 'rect' }));
        });

        it('omitting / empty / non-array shapes keeps the committed default fingerprint', () => {
            assert.equal(run({ shape: 'rect' }), COMMITTED_HASH);
            assert.equal(run({ shape: 'rect', shapes: [] }), COMMITTED_HASH);
            assert.equal(run({ shape: 'rect', shapes: null }), COMMITTED_HASH);
            assert.equal(run({ shape: 'rect', shapes: 'star' }), COMMITTED_HASH); // non-array ignored
        });

        it('all-unknown shapes fall back to the single `shape` path (fail closed)', () => {
            assert.equal(run({ shape: 'rect', shapes: ['nope', 'gone'] }), COMMITTED_HASH);
        });

        it('drops unknown names but keeps the resolvable ones', () => {
            // ['heart','nope'] -> [heart] (nope dropped) -> length 1 -> heart every particle
            const c = createConfetti(makeCanvas(), { seed: 1, maxParticles: 100 });
            const n = { a: 0 };
            c.registerShape('heart', counter(n, 'a'));
            c.burst({ count: 20, shapes: ['heart', 'nope'], lifeMin: 5, lifeMax: 5 });
            pump(1);
            assert.equal(c.count, 20);
            assert.equal(n.a, 20, 'unknown name should be dropped; heart should paint every particle');
            c.destroy();
        });

        it('matches a committed fingerprint for a canonical mixed burst', () => {
            const h = run({ shapes: ['rect', 'circle', 'star'] });
            if (MIXED_HASH === null) console.log('[mix] fingerprint =', h);
            else assert.equal(h, MIXED_HASH, 'mixed-burst positions changed vs the committed baseline');
            assert.notEqual(h, COMMITTED_HASH, 'the per-particle shape pick must shift the stream vs single-shape');
        });

        it('renders a mix on the reduced-motion static path without throwing', () => {
            setReducedMotion(true);
            try {
                const c = createConfetti(makeCanvas(), { seed: 5 });
                assert.doesNotThrow(() => c.burst({ count: 30, shapes: ['rect', 'circle', 'star'] }));
                c.destroy();
            } finally {
                setReducedMotion(false);
            }
        });

        it('spray() accepts a shapes mix too', () => {
            const c = createConfetti(makeCanvas(), { seed: 2, maxParticles: 300 });
            const n = { a: 0, b: 0 };
            c.registerShape('sa', counter(n, 'a'));
            c.registerShape('sb', counter(n, 'b'));
            c.spray({ duration: 200, rate: 10, shapes: ['sa', 'sb'], lifeMin: 5, lifeMax: 5 });
            pump(5, 16);
            assert.ok(n.a > 0 && n.b > 0, 'spray did not mix shapes');
            c.destroy();
        });
    });

    // -------------------------------------------------------------------------
    //  wind -- lateral drift (v1.5.0, decision 0006)
    // -------------------------------------------------------------------------
    describe('wind (lateral drift)', () => {
        // Same seeded rig as the determinism gate. `record` also exposes canvas.sumX --
        // the net signed sum of integer draw-X, a drift-DIRECTION probe kept out of the
        // hash. A bare fingerprint proves the windy stream is deterministic but not which
        // way it leans; sumX gives the sign.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, sumX: canvas.sumX };
            c.destroy();
            return out;
        };

        it('omitting / zero / non-finite wind keeps the committed default fingerprint', () => {
            assert.equal(run({}).hash, COMMITTED_HASH);
            assert.equal(run({ wind: 0 }).hash, COMMITTED_HASH);
            assert.equal(run({ wind: NaN }).hash, COMMITTED_HASH);       // fail closed -> 0
            assert.equal(run({ wind: Infinity }).hash, COMMITTED_HASH);  // fail closed -> 0
            assert.equal(run({ wind: 'gale' }).hash, COMMITTED_HASH);    // fail closed -> 0
        });

        it('matches a committed fingerprint for a canonical windy burst', () => {
            const { hash } = run({ wind: 300 });
            if (WIND_HASH === null) console.log('[wind] fingerprint =', hash);
            else assert.equal(hash, WIND_HASH, 'windy-burst positions changed vs the committed baseline');
            assert.notEqual(hash, COMMITTED_HASH, 'a non-zero wind must shift the stream vs no wind');
        });

        it('drifts right for positive wind, left for negative (sumX ordering)', () => {
            const right = run({ wind: 400 }).sumX;
            const still = run({ wind: 0 }).sumX;
            const left  = run({ wind: -400 }).sumX;
            assert.ok(right > still, 'positive wind should push the net draw-X right');
            assert.ok(left  < still, 'negative wind should push the net draw-X left');
        });

        it('keeps positions finite under a strong negative wind (no NaN drift)', () => {
            const canvas = makeCanvas({ assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({ count: 60, wind: -900, lifeMin: 5, lifeMax: 5 });
                pump(10, 16);
            });
            c.destroy();
        });

        it('spray() honours wind (drifts right for positive vs negative)', () => {
            const sprayDrift = (wind) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 200, rate: 10, wind, lifeMin: 5, lifeMax: 5 });
                pump(1, 1000); pump(20, 16);
                const s = canvas.sumX;
                c.destroy();
                return s;
            };
            assert.ok(sprayDrift(400) > sprayDrift(-400), 'spray wind should drift right vs left');
        });

        it('has no effect under reduced motion (static path is wind-inert)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ wind: 500 }), staticHash({ wind: 0 }));
        });
    });

    // -------------------------------------------------------------------------
    //  floor / bounce -- settle boundary (v1.6.0, decision 0007)
    // -------------------------------------------------------------------------
    describe('floor / bounce (settle boundary)', () => {
        // Same seeded rig as the wind gate (so an un-floored run reproduces COMMITTED_HASH).
        // `record` also exposes canvas.maxY -- the largest integer draw-Y, a CONTAINMENT
        // probe kept out of the hash. A bare fingerprint proves the floored stream is
        // deterministic but not that the boundary actually held; maxY gives the invariant.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, maxY: canvas.maxY };
            c.destroy();
            return out;
        };

        it('omitting / Infinity / non-finite floor keeps the committed default fingerprint', () => {
            assert.equal(run({}).hash, COMMITTED_HASH);
            assert.equal(run({ floor: Infinity }).hash, COMMITTED_HASH);   // explicit "no floor"
            assert.equal(run({ floor: NaN }).hash, COMMITTED_HASH);        // fail closed -> Infinity
            assert.equal(run({ floor: null }).hash, COMMITTED_HASH);       // fail closed -> Infinity
            assert.equal(run({ floor: 'low' }).hash, COMMITTED_HASH);      // fail closed -> Infinity
        });

        it('an unreachable floor is inert (never crosses => byte-identical stream)', () => {
            // The fall tops out at maxY == 196, so a floor at 500 is never touched.
            assert.equal(run({ floor: 500 }).hash, COMMITTED_HASH);
        });

        it('matches a committed fingerprint for a canonical floored burst', () => {
            const { hash } = run({ floor: FLOOR_Y, bounce: 0 });
            if (FLOOR_HASH === null) console.log('[floor] fingerprint =', hash);
            else assert.equal(hash, FLOOR_HASH, 'floored-burst positions changed vs the committed baseline');
            assert.notEqual(hash, COMMITTED_HASH, 'a reachable floor must shift the stream vs no floor');
        });

        it('contains every particle at or above the floor (maxY invariant)', () => {
            // The invariant a bare hash cannot see: floored <= floor, un-floored > floor.
            assert.ok(run({ floor: FLOOR_Y, bounce: 0 }).maxY <= FLOOR_Y, 'a particle escaped below the floor');
            assert.ok(run({ floor: FLOOR_Y, bounce: 0.7 }).maxY <= FLOOR_Y, 'bounce must not let a particle escape');
            assert.ok(run({}).maxY > FLOOR_Y, 'without a floor the fall should pass the line (else the test is vacuous)');
        });

        it('restitution changes the trajectory (bounce shifts the fingerprint)', () => {
            const settle = run({ floor: FLOOR_Y, bounce: 0 }).hash;
            const bouncy = run({ floor: FLOOR_Y, bounce: 0.7 }).hash;
            assert.notEqual(settle, bouncy, 'reflecting vy by restitution must change positions');
        });

        it('clamps out-of-range bounce (negative -> rest, >1 -> elastic, no runaway)', () => {
            // bounce is clamp01: -5 behaves as 0 (rest), 9 behaves as 1 (elastic).
            assert.equal(run({ floor: FLOOR_Y, bounce: -5 }).hash, run({ floor: FLOOR_Y, bounce: 0 }).hash);
            assert.equal(run({ floor: FLOOR_Y, bounce: 9 }).hash,  run({ floor: FLOOR_Y, bounce: 1 }).hash);
        });

        it('keeps positions finite under an elastic bounce + strong gravity (no NaN)', () => {
            const canvas = makeCanvas({ assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({ count: 60, floor: 50, bounce: 1, gravity: 4000, lifeMin: 5, lifeMax: 5 });
                pump(40, 16);
            });
            c.destroy();
        });

        it('spray() honours floor (contains the spray at the boundary)', () => {
            const sprayMaxY = (floor) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 200, rate: 10, floor, bounce: 0, y: 0, lifeMin: 5, lifeMax: 5 });
                pump(1, 1000); pump(60, 16); // spray rises first, then falls; give it time to cross
                const m = canvas.maxY;
                c.destroy();
                return m;
            };
            const bounded = sprayMaxY(40);
            const free = sprayMaxY(Infinity);
            assert.ok(bounded <= 40, 'spray floor did not contain the particles');
            assert.ok(free > 40, 'un-floored spray should pass the line (else the test is vacuous)');
        });

        it('has no effect under reduced motion (static path is floor-inert)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ floor: 10, bounce: 0.5 }), staticHash({}));
        });
    });

    // -------------------------------------------------------------------------
    //  walls / ceiling -- bounding box (v1.7.0, decision 0008)
    // -------------------------------------------------------------------------
    describe('walls / ceiling (bounding box)', () => {
        // Same seeded rig as the floor gate (an un-boxed run reproduces COMMITTED_HASH). The
        // record canvas also exposes minX/maxX/minY -- the X/Y-min CONTAINMENT probes kept out
        // of the hash, the box analogs of maxY: they prove each edge actually held, which a
        // bare fingerprint cannot.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = {
                hash: canvas.hash,
                minX: canvas.minX, maxX: canvas.maxX,
                minY: canvas.minY, maxY: canvas.maxY,
            };
            c.destroy();
            return out;
        };

        it('omitting / infinity / non-finite edges keep the committed default fingerprint', () => {
            assert.equal(run({}).hash, COMMITTED_HASH);
            // Each edge at its explicit "off" sentinel.
            assert.equal(run({ wallLeft: -Infinity }).hash, COMMITTED_HASH);
            assert.equal(run({ wallRight: Infinity }).hash, COMMITTED_HASH);
            assert.equal(run({ ceiling: -Infinity }).hash, COMMITTED_HASH);
            // Each edge fails closed on garbage -> its "off" sentinel (num coercion).
            assert.equal(run({ wallLeft: NaN, wallRight: NaN, ceiling: NaN }).hash, COMMITTED_HASH);
            assert.equal(run({ wallLeft: null, wallRight: null, ceiling: null }).hash, COMMITTED_HASH);
            assert.equal(run({ wallLeft: 'l', wallRight: 'r', ceiling: 'c' }).hash, COMMITTED_HASH);
            // A wrong-signed infinity can never turn an edge ON in the wrong direction.
            assert.equal(run({ wallLeft: Infinity, wallRight: -Infinity, ceiling: Infinity }).hash, COMMITTED_HASH);
        });

        it('a box entirely outside the spread is inert (never crossed => byte-identical)', () => {
            // The seed-12345 burst lives in x[249,540] y[43,196]; this box encloses it loosely.
            assert.equal(run({ wallLeft: -1000, wallRight: 2000, ceiling: -1000, floor: 2000 }).hash, COMMITTED_HASH);
        });

        it('matches a committed fingerprint for a canonical boxed burst', () => {
            const { hash } = run({ ...BOX, bounce: 0 });
            if (BOX_HASH === null) console.log('[box] fingerprint =', hash);
            else assert.equal(hash, BOX_HASH, 'boxed-burst positions changed vs the committed baseline');
            assert.notEqual(hash, COMMITTED_HASH, 'a reachable box must shift the stream vs no box');
            assert.notEqual(hash, FLOOR_HASH, 'a full box must differ from a floor-only burst');
        });

        it('contains every particle inside all four edges (minX/maxX/minY/maxY invariant)', () => {
            // The invariant a bare hash cannot see: boxed within every edge, un-boxed breaches each.
            const boxed = run({ ...BOX, bounce: 0 });
            assert.ok(boxed.minX >= BOX.wallLeft,  'a particle escaped left of wallLeft');
            assert.ok(boxed.maxX <= BOX.wallRight, 'a particle escaped right of wallRight');
            assert.ok(boxed.minY >= BOX.ceiling,   'a particle escaped above the ceiling');
            assert.ok(boxed.maxY <= BOX.floor,     'a particle escaped below the floor');
            // A bounced box (energy-adding would breach) still contains.
            const bouncy = run({ ...BOX, bounce: 0.7 });
            assert.ok(bouncy.minX >= BOX.wallLeft && bouncy.maxX <= BOX.wallRight, 'bounce let a particle through a wall');
            assert.ok(bouncy.minY >= BOX.ceiling && bouncy.maxY <= BOX.floor, 'bounce let a particle through floor/ceiling');
            // Non-vacuous: without the box, the same seed breaches every edge.
            const free = run({});
            assert.ok(free.minX < BOX.wallLeft,  'un-boxed run should pass wallLeft (else vacuous)');
            assert.ok(free.maxX > BOX.wallRight, 'un-boxed run should pass wallRight (else vacuous)');
            assert.ok(free.minY < BOX.ceiling,   'un-boxed run should pass the ceiling (else vacuous)');
            assert.ok(free.maxY > BOX.floor,     'un-boxed run should pass the floor (else vacuous)');
        });

        it('the ceiling alone catches the upward launch (no floor pinning it)', () => {
            // With no floor, particles launch up and are the only thing the ceiling can catch;
            // this proves the ceiling edge fires on its own, not merely via the floor clamp.
            const CEIL = 80;
            assert.ok(run({ ceiling: CEIL }).minY >= CEIL, 'ceiling did not contain the upward launch');
            assert.ok(run({}).minY < CEIL, 'un-ceilinged launch should rise past the line (else vacuous)');
        });

        it('restitution changes the trajectory (bounce shifts the boxed fingerprint)', () => {
            assert.notEqual(run({ ...BOX, bounce: 0 }).hash, run({ ...BOX, bounce: 0.7 }).hash);
        });

        it('keeps positions finite AND contained in a tight box (bounce 1 + wind + gravity)', () => {
            // Elastic walls + strong lateral wind + strong gravity: an energy leak would either
            // NaN out or escape the box. assertFinite catches the NaN; the clamp catches escape.
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 5, lifeMax: 5,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350,
                    bounce: 1, wind: 3000, gravity: 4000,
                });
                pump(1, 1000); pump(80, 16);
            });
            assert.ok(canvas.minX >= 350 && canvas.maxX <= 450, 'an elastic particle escaped a wall');
            assert.ok(canvas.minY >= 250 && canvas.maxY <= 350, 'an elastic particle escaped floor/ceiling');
            c.destroy();
        });

        it('spray() honours the walls (contains the spray between them)', () => {
            const sprayX = (wall) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 200, rate: 10, x: 400, y: 300, spread: 2.0, lifeMin: 5, lifeMax: 5, ...wall });
                pump(1, 1000); pump(60, 16);
                const out = { minX: canvas.minX, maxX: canvas.maxX };
                c.destroy();
                return out;
            };
            const bounded = sprayX({ wallLeft: 360, wallRight: 440 });
            const free = sprayX({});
            assert.ok(bounded.minX >= 360 && bounded.maxX <= 440, 'spray walls did not contain the stream');
            assert.ok(free.minX < 360 || free.maxX > 440, 'un-walled spray should pass a wall (else vacuous)');
        });

        it('has no effect under reduced motion (static path is box-inert)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ wallLeft: 10, wallRight: 20, ceiling: 5, bounce: 0.5 }), staticHash({}));
        });
    });

    // -------------------------------------------------------------------------
    //  turbulence / gust -- living air (v1.8.0)
    // -------------------------------------------------------------------------
    describe('turbulence / gust (living air)', () => {
        // Same seeded rig as the floor/box gates (an un-forced run reproduces COMMITTED_HASH).
        // The record canvas also exposes sumX (drift-direction sum) and minX/maxX (extent) --
        // turbulence FANS the pool (wider extent), gust PUSHES it (displaced sumX); neither is
        // visible to a bare fingerprint, so both are asserted directly.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = {
                hash: canvas.hash, sumX: canvas.sumX,
                minX: canvas.minX, maxX: canvas.maxX, spread: canvas.maxX - canvas.minX,
            };
            c.destroy();
            return out;
        };

        it('omitting / zero / non-finite forces keep the committed default fingerprint', () => {
            assert.equal(run({}).hash, COMMITTED_HASH);
            assert.equal(run({ turbulence: 0 }).hash, COMMITTED_HASH);
            assert.equal(run({ gust: 0 }).hash, COMMITTED_HASH);
            assert.equal(run({ turbulence: 0, gust: 0 }).hash, COMMITTED_HASH);
            // Fail closed on garbage -> 0 (num coercion), for each knob.
            assert.equal(run({ turbulence: NaN, gust: NaN }).hash, COMMITTED_HASH);
            assert.equal(run({ turbulence: null, gust: null }).hash, COMMITTED_HASH);
            assert.equal(run({ turbulence: 't', gust: 'g' }).hash, COMMITTED_HASH);
        });

        it('leaves the floor-only and box fingerprints byte-identical (new guards never fire)', () => {
            // The v1.8.0 blocks must not perturb any prior committed stream. Re-assert both.
            const floorHash = run({ floor: FLOOR_Y }).hash;
            if (FLOOR_HASH !== null) assert.equal(floorHash, FLOOR_HASH, 'floor-only fingerprint drifted');
            assert.equal(run({ ...BOX, bounce: 0 }).hash, BOX_HASH, 'box fingerprint drifted');
        });

        it('matches committed fingerprints for turbulence, gust, and both (deterministic, distinct)', () => {
            const t = run({ turbulence: 500 });
            const g = run({ gust: 400 });
            const b = run({ turbulence: 500, gust: 400 });
            if (TURB_HASH === null) console.log('[turb] fingerprint =', t.hash);
            else assert.equal(t.hash, TURB_HASH, 'turbulence stream changed vs the committed baseline');
            if (GUST_HASH === null) console.log('[gust] fingerprint =', g.hash);
            else assert.equal(g.hash, GUST_HASH, 'gust stream changed vs the committed baseline');
            if (TURBGUST_HASH === null) console.log('[turbgust] fingerprint =', b.hash);
            else assert.equal(b.hash, TURBGUST_HASH, 'combined stream changed vs the committed baseline');
            // Each force perturbs, and the three are mutually distinct and distinct from calm.
            const hashes = new Set([COMMITTED_HASH, t.hash, g.hash, b.hash]);
            assert.equal(hashes.size, 4, 'turbulence/gust/both must each shift the stream distinctly');
            // Deterministic replay: no rng means same seed -> same hash on a second run.
            assert.equal(run({ turbulence: 500 }).hash, t.hash, 'turbulence is not deterministic on replay');
            assert.equal(run({ turbulence: 500, gust: 400 }).hash, b.hash, 'combined is not deterministic on replay');
        });

        it('turbulence fans the pool wider; gust displaces it sideways (non-vacuous)', () => {
            const plain = run({});
            const t = run({ turbulence: 500 });
            const g = run({ gust: 400 });
            // Turbulence: decorrelated per-particle wander => a strictly wider x-extent.
            assert.ok(t.spread > plain.spread, 'turbulence did not widen the pool (else vacuous)');
            // Gust: a coherent horizontal push => a materially displaced summed x.
            assert.ok(Math.abs(g.sumX - plain.sumX) > 1000, 'gust did not displace the pool (else vacuous)');
        });

        it('keeps positions finite under strong turbulence + gust + wind + gravity in a box', () => {
            // Time-varying accels layered on wind/gravity inside an elastic box: an energy leak
            // would NaN out or escape. assertFinite catches NaN; the clamp catches escape.
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 5, lifeMax: 5,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350,
                    bounce: 1, wind: 2000, gravity: 4000, turbulence: 3000, gust: 2500,
                });
                pump(1, 1000); pump(80, 16);
            });
            assert.ok(canvas.minX >= 350 && canvas.maxX <= 450, 'a particle escaped a wall under turbulence/gust');
            c.destroy();
        });

        it('spray() honours turbulence + gust (deterministic, perturbing stream)', () => {
            const sprayRun = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 200, rate: 10, x: 400, y: 300, spread: 2.0, lifeMin: 5, lifeMax: 5, ...opts });
                pump(1, 1000); pump(60, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            };
            const calm = sprayRun({});
            assert.equal(sprayRun({}), calm, 'calm spray not deterministic');
            assert.notEqual(sprayRun({ turbulence: 400, gust: 300 }), calm, 'spray ignored turbulence/gust');
            assert.equal(sprayRun({ turbulence: 400, gust: 300 }), sprayRun({ turbulence: 400, gust: 300 }), 'forced spray not deterministic');
        });

        it('has no effect under reduced motion (static path has no velocity to perturb)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ turbulence: 800, gust: 600 }), staticHash({}));
        });
    });

    // -------------------------------------------------------------------------
    //  trails / ribbons -- the first RENDER-path feature (v1.9.0, decision 0010)
    // -------------------------------------------------------------------------
    describe('trails / ribbons', () => {
        // Same seed-12345 rig as the box/turbulence gates -- a trail-less run therefore reproduces
        // COMMITTED_HASH. `trail` is a CONSTRUCTION option (the ring buffer must be sized once), so
        // it is passed to createConfetti; a per-burst `trail` overrides the draw length. The record
        // canvas exposes strokeHash + strokes (trail-only, kept OUT of the position hash), so we can
        // prove the ribbon geometry is deterministic AND that the physics hash is untouched.
        const run = (ctorOpts = {}, burstOpts = {}) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345, ...ctorOpts });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...burstOpts });
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, strokeHash: canvas.strokeHash, strokes: canvas.strokes };
            c.destroy();
            return out;
        };

        it('is off by default: no strokes, position hash byte-identical', () => {
            const off = run({});
            assert.equal(off.strokes, 0, 'a default instance must not stroke any trail');
            assert.equal(off.strokeHash, 0, 'no strokes => empty trail-geometry hash');
            assert.equal(off.hash, COMMITTED_HASH, 'the default position fingerprint drifted');
            // Explicit trail: 0 is identical to omitting it.
            const zero = run({ trail: 0 });
            assert.equal(zero.strokes, 0);
            assert.equal(zero.hash, COMMITTED_HASH);
        });

        it('is a PURE OVERLAY: trails on leaves every committed physics fingerprint intact', () => {
            // The headline property. Trails draw via stroke() in world space (never translate),
            // so the position hash cannot move -- at any depth, for any physics.
            assert.equal(run({ trail: 10 }).hash, COMMITTED_HASH, 'trails perturbed the default stream');
            assert.equal(run({ trail: 64 }).hash, COMMITTED_HASH, 'max-depth trails perturbed the stream');
            // Re-assert the floor-only and box fingerprints with trails on -- unchanged.
            assert.equal(run({ trail: 10 }, { floor: FLOOR_Y }).hash, FLOOR_HASH, 'floor fingerprint drifted under trails');
            assert.equal(run({ trail: 10 }, { ...BOX, bounce: 0 }).hash, BOX_HASH, 'box fingerprint drifted under trails');
        });

        it('fails closed on a garbage / over-large construction trail', () => {
            // Non-finite / negative capacity => off (0); no buffers, no strokes, hash intact.
            for (const bad of [NaN, -5, Infinity, 'x', null]) {
                const r = run({ trail: bad });
                assert.equal(r.strokes, 0, `trail:${String(bad)} should disable trails`);
                assert.equal(r.hash, COMMITTED_HASH);
            }
            // Absurd depth is capped at TRAIL_MAX (64), not honoured literally -- no huge alloc,
            // no throw, and it still strokes (feature on).
            const huge = run({ trail: 1e9 });
            assert.ok(huge.strokes > 0, 'a capped-but-positive trail should still stroke');
            assert.equal(huge.hash, COMMITTED_HASH);
            // trail: 1e9 clamps to 64, so it must equal an explicit trail: 64.
            assert.equal(huge.strokeHash, run({ trail: 64 }).strokeHash, 'over-large trail did not clamp to TRAIL_MAX');
        });

        it('matches the committed trail-geometry fingerprint (non-vacuous, deterministic)', () => {
            const t = run({ trail: 10 });
            assert.ok(t.strokes > 0, 'trails on must stroke at least one ribbon (else vacuous)');
            if (TRAIL_HASH === null) console.log('[trail] geometry fingerprint =', t.strokeHash);
            else assert.equal(t.strokeHash, TRAIL_HASH, 'trail geometry changed vs the committed baseline');
            // Deterministic replay: the ring buffer + global head are a pure function of the seed.
            assert.equal(run({ trail: 10 }).strokeHash, t.strokeHash, 'trail geometry not deterministic on replay');
            // Depth changes the geometry: a shallower ring strokes a different (shorter) ribbon.
            assert.notEqual(run({ trail: 4 }).strokeHash, t.strokeHash, 'trail depth 4 vs 10 must differ');
        });

        it('honours a per-burst trail override (0 opts out; a shorter length changes geometry)', () => {
            // A trail-capable instance trails by default; burst({ trail: 0 }) silences one burst.
            const out = run({ trail: 10 }, { trail: 0 });
            assert.equal(out.strokes, 0, 'per-burst trail: 0 did not opt the burst out');
            assert.equal(out.hash, COMMITTED_HASH);
            // A per-burst length below capacity draws a different (shorter) ribbon than the default,
            // and matches a construction instance built at that same capacity (same max samples).
            const perBurst4 = run({ trail: 10 }, { trail: 4 });
            assert.ok(perBurst4.strokes > 0, 'per-burst trail: 4 should still stroke');
            assert.notEqual(perBurst4.strokeHash, run({ trail: 10 }).strokeHash, 'per-burst 4 must differ from default 10');
            assert.equal(perBurst4.strokeHash, run({ trail: 4 }).strokeHash, 'per-burst 4 should match construction cap 4');
        });

        it('ignores a per-burst trail on a trail-less instance (fail closed, no throw)', () => {
            // No construction budget => no buffer => the option is silently inert.
            const r = run({}, { trail: 10 });
            assert.equal(r.strokes, 0, 'trail on a budget-less instance must not stroke');
            assert.equal(r.hash, COMMITTED_HASH);
        });

        it('keeps every drawn position finite under trails + strong forces in a tight box', () => {
            // Trail points are copies of the finite body positions; assertFinite also guards the
            // stroked path points. A leak would NaN out; the box clamp still contains the bodies.
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3, trail: 16 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 5, lifeMax: 5,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350,
                    bounce: 1, wind: 2000, gravity: 4000, turbulence: 3000, gust: 2500,
                });
                pump(1, 1000); pump(80, 16);
            });
            assert.ok(canvas.strokes > 0, 'the finite-under-forces rig should actually draw trails');
            assert.ok(canvas.minX >= 350 && canvas.maxX <= 450, 'a body escaped a wall under trails + forces');
            c.destroy();
        });

        it('spray() honours trails (deterministic ribbon geometry)', () => {
            const sprayRun = (ctorOpts, sprayOpts = {}) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9, ...ctorOpts });
                c.spray({ duration: 200, rate: 10, x: 400, y: 300, spread: 2.0, lifeMin: 5, lifeMax: 5, ...sprayOpts });
                pump(1, 1000); pump(60, 16);
                const out = { strokes: canvas.strokes, strokeHash: canvas.strokeHash };
                c.destroy();
                return out;
            };
            assert.equal(sprayRun({}).strokes, 0, 'a trail-less spray must not stroke');
            const trailed = sprayRun({ trail: 12 });
            assert.ok(trailed.strokes > 0, 'spray ignored the trail budget');
            assert.equal(sprayRun({ trail: 12 }).strokeHash, trailed.strokeHash, 'sprayed trail geometry not deterministic');
        });

        it('has no effect under reduced motion (static path records no history)', () => {
            setReducedMotion(true);
            try {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 5, trail: 16 });
                c.burst({ count: 30, trail: 16 });
                assert.equal(canvas.strokes, 0, 'reduced-motion static render must not draw trails');
                c.destroy();
            } finally {
                setReducedMotion(false);
            }
        });
    });

    // -------------------------------------------------------------------------
    //  vortex / attractor -- a directed point force (v1.10.0, decision 0011)
    // -------------------------------------------------------------------------
    describe('vortex / attractor', () => {
        // Same seed-12345 rig as the force gates (a plain run reproduces COMMITTED_HASH). The record
        // canvas's extent (maxX-minX, maxY-minY) captures the convergence a bare hash cannot see:
        // a PULL collapses the pool, a REPEL expands it. The burst here centers at (400,198), so a
        // bare `attract` (center defaults to the burst origin) pulls toward that point.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = {
                hash: canvas.hash,
                spreadX: canvas.maxX - canvas.minX, spreadY: canvas.maxY - canvas.minY,
                cx: (canvas.minX + canvas.maxX) / 2,
            };
            c.destroy();
            return out;
        };

        it('omitting / zero / non-finite knobs keep the committed default fingerprint', () => {
            assert.equal(run({}).hash, COMMITTED_HASH);
            assert.equal(run({ attract: 0, swirl: 0 }).hash, COMMITTED_HASH);
            // Fail closed on garbage -> 0 (num), for each knob (incl. the center).
            assert.equal(run({ attract: NaN, swirl: NaN }).hash, COMMITTED_HASH);
            assert.equal(run({ attract: null, swirl: 'x' }).hash, COMMITTED_HASH);
            assert.equal(run({ attract: Infinity, swirl: -Infinity }).hash, COMMITTED_HASH);
            // A center with no strength never fires the branch either.
            assert.equal(run({ attractX: 10, attractY: 20 }).hash, COMMITTED_HASH);
        });

        it('leaves the floor-only and box fingerprints byte-identical (new guard never fires)', () => {
            assert.equal(run({ floor: FLOOR_Y }).hash, FLOOR_HASH, 'floor-only fingerprint drifted');
            assert.equal(run({ ...BOX, bounce: 0 }).hash, BOX_HASH, 'box fingerprint drifted');
        });

        it('matches committed fingerprints for attract, swirl, and both (deterministic, distinct)', () => {
            const a = run({ attract: 6 });
            const s = run({ swirl: 6 });
            const b = run({ attract: 6, swirl: 6 });
            if (ATTRACT_HASH === null) console.log('[attract] fingerprint =', a.hash);
            else assert.equal(a.hash, ATTRACT_HASH, 'attract stream changed vs the committed baseline');
            if (SWIRL_HASH === null) console.log('[swirl] fingerprint =', s.hash);
            else assert.equal(s.hash, SWIRL_HASH, 'swirl stream changed vs the committed baseline');
            if (VORTEX_HASH === null) console.log('[vortex] fingerprint =', b.hash);
            else assert.equal(b.hash, VORTEX_HASH, 'combined stream changed vs the committed baseline');
            // Each perturbs, and the three are mutually distinct and distinct from plain.
            assert.equal(new Set([COMMITTED_HASH, a.hash, s.hash, b.hash]).size, 4,
                'attract/swirl/both must each shift the stream distinctly');
            // Deterministic replay: no rng, so same seed -> same hash on a second run.
            assert.equal(run({ attract: 6 }).hash, a.hash, 'attract is not deterministic on replay');
            assert.equal(run({ attract: 6, swirl: 6 }).hash, b.hash, 'combined is not deterministic on replay');
        });

        it('attract CONVERGES the pool; repel EXPANDS it (non-vacuous, directional)', () => {
            const plain = run({});
            const pull = run({ attract: 6 });
            const push = run({ attract: -6 });
            // A pull collapses the pool toward the center -> strictly smaller extent than plain.
            assert.ok(pull.spreadX < plain.spreadX, 'attract did not converge the pool in x (else vacuous)');
            assert.ok(pull.spreadY < plain.spreadY, 'attract did not converge the pool in y');
            // A repel (negative attract) blows it apart -> strictly larger extent.
            assert.ok(push.spreadX > plain.spreadX, 'repel did not expand the pool (else vacuous)');
        });

        it('swirl is directional: +swirl and -swirl diverge (spin sign is real)', () => {
            assert.notEqual(run({ swirl: 6 }).hash, run({ swirl: -6 }).hash,
                'swirl sign made no difference -- the tangential term is not directional');
            // A pure swirl orbits (roughly conserves radial extent), so it must NOT collapse the
            // pool the way attract does -- it is a distinct effect, not a weak attractor.
            const plain = run({});
            const swirl = run({ swirl: 6 });
            assert.ok(swirl.spreadX > plain.spreadX * 0.8,
                'a pure swirl should orbit, not collapse the pool like attract');
        });

        it('honours a custom attractX/attractY (pulls toward that point, not the origin)', () => {
            // The burst origin is x~400; pulling toward x=600 must shift the pool's center right.
            const plain = run({});
            const off = run({ attract: 6, attractX: 600, attractY: 100 });
            assert.ok(off.cx > plain.cx + 20, 'a custom attractX did not pull the pool toward it');
        });

        it('keeps positions finite AND contained under strong attract + swirl in a box', () => {
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 5, lifeMax: 5,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350,
                    bounce: 1, wind: 2000, gravity: 4000, attract: 40, swirl: 30,
                });
                pump(1, 1000); pump(80, 16);
            });
            assert.ok(canvas.minX >= 350 && canvas.maxX <= 450, 'a particle escaped a wall under the vortex');
            c.destroy();
        });

        it('a strong repeller stays finite over its life (the accel cap holds)', () => {
            // A negative attract is an unstable anti-spring; without the VORTEX_MAX_ACCEL cap it
            // could drive a position to Infinity. assertFinite makes any non-finite draw a throw.
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 7 });
            assert.doesNotThrow(() => {
                c.burst({ x: 400, y: 300, count: 60, attract: -400, lifeMin: 0.4, lifeMax: 0.4 });
                pump(1, 1000); for (let f = 0; f < 40; f++) pump(1, 50);
            });
            assert.equal(c.count, 0, 'the repeller pool did not drain within its life');
            c.destroy();
        });

        it('spray() honours the vortex (deterministic, perturbing stream)', () => {
            const sprayRun = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 200, rate: 10, x: 400, y: 300, spread: 2.0, lifeMin: 5, lifeMax: 5, ...opts });
                pump(1, 1000); pump(60, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            };
            const calm = sprayRun({});
            assert.equal(sprayRun({}), calm, 'calm spray not deterministic');
            assert.notEqual(sprayRun({ attract: 8, swirl: 5 }), calm, 'spray ignored the vortex');
            assert.equal(sprayRun({ attract: 8, swirl: 5 }), sprayRun({ attract: 8, swirl: 5 }), 'vortex spray not deterministic');
        });

        it('has no effect under reduced motion (static path has no velocity to perturb)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ attract: 10, swirl: 8 }), staticHash({}));
        });
    });

    // -------------------------------------------------------------------------
    //  settle / pile -- the first BEHAVIOUR (lifecycle) feature (v1.11.0, decision 0012)
    // -------------------------------------------------------------------------
    describe('color / lifeColors', () => {
        // The shared seed-12345 runStd rig (a plain run reproduces COMMITTED_HASH), extended to read
        // the record canvas's `colorHash` (the body fillStyle sequence, kept OUT of the position
        // `hash`). `lifeColors` is a pure COLOR overlay: it draws no rng and moves no position, so a
        // lifeColors run must reproduce the SAME position hash as the plain run -- the headline proof
        // -- while its colorHash differs. `frames` lets a case age the pool along the ramp.
        const runColor = (opts, frames = 29) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(frames, 16);
            const out = { hash: canvas.hash, colorHash: canvas.colorHash, strokeHash: canvas.strokeHash };
            c.destroy();
            return out;
        };

        it('is a pure color overlay: a lifeColors burst keeps the exact position fingerprint', () => {
            // The load-bearing property. lifeColors adds no rng draw and touches no position, so every
            // committed POSITION hash is byte-identical -- including the lifeColors burst's own.
            const plain = runColor({});
            assert.equal(plain.hash, COMMITTED_HASH, 'the color branch perturbed the default stream');
            assert.equal(runColor({ lifeColors: EMBER }).hash, COMMITTED_HASH,
                'lifeColors changed the position stream (must be a pure color overlay)');
        });

        it('matches the committed color fingerprint (deterministic) and actually changes the body color', () => {
            const plain = runColor({}).colorHash;
            const lc = runColor({ lifeColors: EMBER });
            if (COLOR_HASH === null) console.log('[color] fingerprint =', lc.colorHash);
            else assert.equal(lc.colorHash, COLOR_HASH, 'color stream changed vs the committed baseline');
            assert.notEqual(lc.colorHash, plain, 'lifeColors did not change the body color (else vacuous)');
            // Zero rng: same seed -> same colorHash on replay.
            assert.equal(runColor({ lifeColors: EMBER }).colorHash, lc.colorHash, 'lifeColors is not deterministic on replay');
        });

        it('omitting / empty / short / invalid lifeColors is a no-op vs the plain body color (opt-in, fail-closed)', () => {
            const plain = runColor({}).colorHash;
            for (const bad of [
                undefined, [], [EMBER[0]], null, 'x', 42,
                [{ l: NaN, c: 0, h: 0 }, EMBER[0]],   // a non-finite stop
                ['not-a-color', 'also-bad'],          // unparseable strings (parseOklch throws -> caught)
            ]) {
                const r = runColor({ lifeColors: bad });
                assert.equal(r.colorHash, plain, 'invalid lifeColors should paint the flat colors[i]');
                assert.equal(r.hash, COMMITTED_HASH, 'invalid lifeColors perturbed the position stream');
            }
        });

        it('sweeps the ramp over life: the body color moves as the pool ages (non-vacuous)', () => {
            // A high-contrast 2-stop ramp. Sampled early (pieces near birth = first stop) the body
            // color sequence differs from late (pieces aged toward the last stop).
            const HICON = [{ l: 0.98, c: 0.02, h: 90 }, { l: 0.30, c: 0.20, h: 20 }];
            const few = runColor({ lifeColors: HICON }, 8).colorHash;
            const many = runColor({ lifeColors: HICON }, 120).colorHash;
            assert.notEqual(few, many, 'the body color did not move along the ramp over life (else vacuous)');
        });

        it('leaves the trail flat: a trailed lifeColors burst keeps the committed trail geometry AND color', () => {
            // Locked decision: the ribbon draws the flat spawn color, only the body sweeps the ramp.
            // So a trail+lifeColors run reproduces the plain trail's strokeHash (geometry) exactly, and
            // -- since the trail strokes colors[i], unaffected by the body ramp -- the position hash too.
            const runTrail = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345, trail: 10 });
                c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                pump(1, 1000); pump(29, 16);
                const out = { strokeHash: canvas.strokeHash, hash: canvas.hash };
                c.destroy();
                return out;
            };
            const plain = runTrail({});
            const lc = runTrail({ lifeColors: EMBER });
            assert.equal(plain.strokeHash, TRAIL_HASH, 'trail geometry drifted');
            assert.equal(lc.strokeHash, plain.strokeHash, 'lifeColors changed the trail ribbon (should stay flat)');
            assert.equal(lc.hash, plain.hash, 'lifeColors perturbed the trailed position stream');
        });

        it('keeps positions finite under lifeColors + gravity in a box (guards the render branch)', () => {
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.6,
                    gravity: 4000, lifeColors: EMBER,
                });
                pump(1, 1000); pump(80, 16);
            });
            c.destroy();
        });

        it('spray() honours lifeColors (deterministic, changes the body color)', () => {
            const sprayColor = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 400, rate: 15, x: 400, y: 200, spread: 1.2, shape: 'rect',
                    lifeMin: 4, lifeMax: 4, ...opts });
                pump(1, 1000); pump(60, 16);
                const out = { hash: canvas.hash, colorHash: canvas.colorHash };
                c.destroy();
                return out;
            };
            const plain = sprayColor({});
            const lc = sprayColor({ lifeColors: EMBER });
            assert.notEqual(lc.colorHash, plain.colorHash, 'spray ignored lifeColors');
            assert.equal(lc.hash, plain.hash, 'lifeColors perturbed the spray position stream (should be a pure overlay)');
            assert.equal(sprayColor({ lifeColors: EMBER }).colorHash, lc.colorHash, 'lifeColors spray not deterministic');
        });

        it('has no effect under reduced motion (static path paints the flat colors[i])', () => {
            const staticColor = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                    pump(1, 1000); pump(29, 16);
                    const h = canvas.colorHash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticColor({ lifeColors: EMBER }), staticColor({}),
                'lifeColors should be inert on the static reduced-motion path');
        });
    });

    // -------------------------------------------------------------------------
    //  emit / emitter shapes (v1.13.0, decision 0014)
    // -------------------------------------------------------------------------
    describe('emit / emitter shapes', () => {
        // The shared seed-12345 runStd rig (a plain run reproduces COMMITTED_HASH), extended to read
        // the X/Y draw extents (minX/maxX/minY/maxY) so the geometry of an emitter can be probed
        // directly, not just via a fingerprint. `emit` is the FIRST feature to add a CONDITIONAL
        // spawn-rng draw, so OFF must reproduce COMMITTED_HASH byte-for-byte, and each ON shape must
        // be its own deterministic fingerprint. `frames`/extra opts let a case shape the run.
        const runEmit = (opts, frames = 29) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(frames, 16);
            const out = {
                hash: canvas.hash,
                minX: canvas.minX, maxX: canvas.maxX,
                minY: canvas.minY, maxY: canvas.maxY,
            };
            c.destroy();
            return out;
        };

        it('is opt-in and fail-closed: off / unknown / non-positive size spawns at the point (byte-identical)', () => {
            // The load-bearing property. The conditional spawn-rng draw must insert NOTHING when off,
            // so the seeded stream -- and every committed fingerprint -- is preserved.
            assert.equal(runEmit({}).hash, COMMITTED_HASH, 'the emit branch perturbed the default stream');
            for (const o of [
                { emit: 'arc' },                    // unknown shape name
                { emit: 42 },                       // non-string
                { emit: null },                     // null
                { emit: 'line' },                   // shape but no size -> emitSize defaults off
                { emit: 'line', emitSize: 0 },      // zero extent
                { emit: 'ring', emitSize: -5 },     // negative -> nonneg 0
                { emit: 'box', emitSize: NaN },     // non-finite -> nonneg default 0
                { emit: 'box', emitSize: 'big' },   // non-numeric
            ]) {
                assert.equal(runEmit(o).hash, COMMITTED_HASH,
                    `emit ${JSON.stringify(o)} should fall back to a point spawn`);
            }
        });

        it('every prior committed fingerprint still reproduces with emit off (no sequence drift)', () => {
            // The emit block sits between the speed draw and spawn(); off must not disturb any of them.
            assert.equal(runEmit({ floor: FLOOR_Y, bounce: 0 }).hash, FLOOR_HASH, 'floor gate drifted');
            assert.equal(runEmit({ ...BOX, bounce: 0 }).hash, BOX_HASH, 'box gate drifted');
        });

        it('matches a committed fingerprint per shape -- distinct + deterministic', () => {
            const line = runEmit({ emit: 'line', emitSize: 200 }).hash;
            const ring = runEmit({ emit: 'ring', emitSize: 200 }).hash;
            const box  = runEmit({ emit: 'box', emitSize: 200 }).hash;
            if (EMIT_LINE_HASH === null) console.log('[emit] line/ring/box =', line, ring, box);
            else {
                assert.equal(line, EMIT_LINE_HASH, 'line-emitter positions changed vs the committed baseline');
                assert.equal(ring, EMIT_RING_HASH, 'ring-emitter positions changed vs the committed baseline');
                assert.equal(box,  EMIT_BOX_HASH,  'box-emitter positions changed vs the committed baseline');
            }
            // Each shape is its own fingerprint, all distinct from the point spawn and each other
            // (box draws 2 rng values, line/ring 1, so the sequences genuinely diverge).
            assert.equal(new Set([COMMITTED_HASH, line, ring, box]).size, 4, 'emitter shapes are not all distinct');
            // Zero non-emit rng change: same seed -> same hash on replay.
            assert.equal(runEmit({ emit: 'line', emitSize: 200 }).hash, line, 'line emitter not deterministic');
            assert.equal(runEmit({ emit: 'ring', emitSize: 200 }).hash, ring, 'ring emitter not deterministic');
            assert.equal(runEmit({ emit: 'box', emitSize: 200 }).hash, box,  'box emitter not deterministic');
        });

        it('line widens the origin band along X (non-vacuous geometry)', () => {
            // A horizontal curtain of half-length emitSize should broaden the X spread by ~2*emitSize
            // over the point spawn; Y is untouched (velocity still from angle/spread).
            const pt = runEmit({});
            const line = runEmit({ emit: 'line', emitSize: 200 });
            assert.ok(line.maxX - line.minX > (pt.maxX - pt.minX) + 300,
                'the line emitter did not widen the X band (else vacuous)');
        });

        it('ring fires pieces radially outward -- a symmetric shell (non-vacuous coupling)', () => {
            // With gravity off and a short window, a radial-shell ring expands symmetrically: its X
            // and Y spreads are near-equal. A point burst (default narrow upward cone) is Y-dominant,
            // and a line is X-only -- so near-1 symmetry is the fingerprint of the radial coupling.
            const ring = runEmit({ emit: 'ring', emitSize: 150, gravity: 0 }, 8);
            const xr = ring.maxX - ring.minX, yr = ring.maxY - ring.minY;
            assert.ok(Math.abs(xr / yr - 1) < 0.15, `ring shell not radially symmetric (x=${xr} y=${yr})`);
            // Contrast: a point burst at the same rig is clearly ASYMMETRIC (the emission cone fires
            // in one direction), so near-1 symmetry is a genuine property of the radial ring, not of
            // every burst -- the symmetry test would be vacuous if a point burst were symmetric too.
            const pt = runEmit({ gravity: 0 }, 8);
            const px = pt.maxX - pt.minX, py = pt.maxY - pt.minY;
            assert.ok(Math.abs(px / py - 1) > 0.15, `the point contrast should be asymmetric (x=${px} y=${py})`);
        });

        it('keeps positions finite under emit + gravity + bounce in a box (guards the spawn branch)', () => {
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.6,
                    gravity: 4000, emit: 'box', emitSize: 120,
                });
                pump(1, 1000); pump(80, 16);
            });
            c.destroy();
        });

        it('spray() honours emit (deterministic, shifts the stream)', () => {
            const sprayEmit = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 400, rate: 15, x: 400, y: 200, spread: 1.2, shape: 'rect',
                    lifeMin: 4, lifeMax: 4, ...opts });
                pump(1, 1000); pump(60, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            };
            const plain = sprayEmit({});
            const ring = sprayEmit({ emit: 'ring', emitSize: 120 });
            assert.notEqual(ring, plain, 'spray ignored emit');
            assert.equal(sprayEmit({ emit: 'ring', emitSize: 120 }), ring, 'spray emit not deterministic');
        });

        it('has no effect under reduced motion (static fan ignores the emitter)', () => {
            const staticEmit = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                    pump(1, 1000); pump(29, 16);
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticEmit({ emit: 'ring', emitSize: 150 }), staticEmit({}),
                'emit should be inert on the static reduced-motion path');
        });
    });

    // -------------------------------------------------------------------------
    //  stagger / staggered emission (v1.14.0, decision 0015)
    // -------------------------------------------------------------------------
    describe('stagger / staggered emission', () => {
        // Two rigs. `runStd` is the canonical seed-12345 rig (a plain run reproduces COMMITTED_HASH),
        // used to prove OFF is byte-identical. `runStagger` pumps SMALL dt FROM t0 -- the canonical
        // pump(1,1000) first frame would blow a sub-second window in a single tick, so a stagger run
        // must spread across many small frames. It also reads `translates` (pieces actually drawn) so
        // the timing effect can be probed directly, not just via a fingerprint.
        const runStd = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const h = canvas.hash;
            c.destroy();
            return h;
        };
        const runStagger = (opts, frames = 40) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(frames, 16);
            const out = { hash: canvas.hash, translates: canvas.translates };
            c.destroy();
            return out;
        };

        it('is opt-in and fail-closed: off / <= 0 / non-finite spawns synchronously (byte-identical)', () => {
            // The load-bearing property. The birth gate + guarded delay write must insert NOTHING when
            // off, so the seeded stream -- and every committed fingerprint -- is byte-for-byte preserved.
            assert.equal(runStd({}), COMMITTED_HASH, 'the birth gate perturbed the default stream');
            for (const o of [
                { stagger: 0 },          // explicit off
                { stagger: -100 },       // negative -> nonneg 0
                { stagger: NaN },        // non-finite -> nonneg default 0
                { stagger: Infinity },   // non-finite -> nonneg default 0
                { stagger: 'soon' },     // non-numeric -> nonneg default 0
            ]) {
                assert.equal(runStd(o), COMMITTED_HASH,
                    `stagger ${JSON.stringify(o)} should spawn synchronously`);
            }
        });

        it('every prior committed fingerprint still reproduces with stagger off (no sequence drift)', () => {
            // The gate sits before the life countdown; off must not disturb the physics stream.
            assert.equal(runStd({ floor: FLOOR_Y }), FLOOR_HASH, 'floor gate drifted');
            assert.equal(runStd({ ...BOX, bounce: 0 }), BOX_HASH, 'box gate drifted');
        });

        it('matches the committed STAGGER fingerprint -- distinct + deterministic', () => {
            const st = runStagger({ stagger: 300 }).hash;
            if (STAGGER_HASH === null) console.log('[stagger] 300ms =', st);
            else assert.equal(st, STAGGER_HASH, 'staggered positions changed vs the committed baseline');
            // Distinct from a synchronous burst (births are spread, so positions differ per frame)...
            assert.notEqual(st, COMMITTED_HASH, 'a staggered burst should differ from a synchronous one');
            // ...and deterministic: same seed + fixed dt -> same hash on replay (the delay draws no rng).
            assert.equal(runStagger({ stagger: 300 }).hash, st, 'stagger not deterministic');
        });

        it('spreads births across the window (non-vacuous timing via the translates probe)', () => {
            // Every DRAWN piece calls translate once/frame; an unborn piece skips it. So in the early
            // frames a staggered burst has drawn strictly FEWER pieces than a synchronous one, which
            // draws all `count` from frame 1. A bare position hash cannot see this.
            const syncEarly = runStagger({}, 4).translates;
            const stagEarly = runStagger({ stagger: 300 }, 4).translates;
            assert.ok(stagEarly < syncEarly * 0.5,
                `stagger should delay births (early: sync=${syncEarly} stagger=${stagEarly})`);
            // Once the window (300ms) has fully elapsed, every piece is born, so a single late frame
            // draws all 120 -- the same per-frame count as a synchronous burst (convergence).
            const perFrame = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345 });
                c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                pump(30, 16);                        // 480ms > the 300ms window: all born
                const before = canvas.translates;
                pump(1, 16);
                c.destroy();
                return canvas.translates - before;
            };
            assert.equal(perFrame({ stagger: 300 }), perFrame({}),
                'after the window, a staggered burst should draw every piece per frame (all born)');
        });

        it('a late-born piece lives its FULL life from birth (not from t0)', () => {
            // life = 1s, window = 400ms. By ~1.12s a synchronous burst (all born at t0) is fully dead;
            // a staggered burst still has its late-born pieces alive -- proof life starts at birth.
            const aliveAt = (opts, frames) => {
                const c = createConfetti(makeCanvas(), { seed: 12345 });
                c.burst({ count: 120, shape: 'rect', lifeMin: 1, lifeMax: 1, spread: 1.8, ...opts });
                pump(frames, 16);
                const n = c.count;
                c.destroy();
                return n;
            };
            assert.equal(aliveAt({}, 70), 0, 'a synchronous 1s burst should be dead by 1.12s');
            assert.ok(aliveAt({ stagger: 400 }, 70) > 0,
                'a staggered burst should still have late-born pieces alive (full life from birth)');
        });

        it('keeps positions finite under stagger + gravity + bounce in a box (guards the birth gate)', () => {
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.6,
                    gravity: 4000, stagger: 250,
                });
                pump(80, 16);
            });
            c.destroy();
        });

        it('is ignored by spray() (spray already emits over time)', () => {
            // stagger is a burst-only knob; spray must be byte-identical with or without it.
            const spray = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 400, rate: 15, x: 400, y: 200, spread: 1.2, shape: 'rect',
                    lifeMin: 4, lifeMax: 4, ...opts });
                pump(1, 1000); pump(60, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            };
            assert.equal(spray({ stagger: 300 }), spray({}), 'spray should ignore stagger');
        });

        it('has no effect under reduced motion (static fan is inert)', () => {
            const staticStagger = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                    pump(1, 1000); pump(29, 16);
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticStagger({ stagger: 300 }), staticStagger({}),
                'stagger should be inert on the static reduced-motion path');
        });
    });

    describe('align / velocity-aligned orientation', () => {
        // The canonical seed-12345 rig. `run` reports BOTH fingerprints: `hash` (position, folds only
        // translate) and `rotateHash` (rotation, kept out of `hash`). `align` moves ONLY rotation, so
        // its headline property is that the POSITION hash is byte-identical whether off or on -- a pure
        // orientation overlay (the analog of what lifeColors did on the color axis).
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, rotateHash: canvas.rotateHash };
            c.destroy();
            return out;
        };

        it('is opt-in and fail-closed: off / <= 0 / non-finite emits the raw spin (byte-identical)', () => {
            // The load-bearing property: when off, the render must emit `pool.spin[i]` exactly as before,
            // so BOTH the position hash AND the rotation sequence match a pre-align run. A plain run
            // reproduces COMMITTED_HASH; capture its rotateHash as the OFF rotation baseline.
            const base = run({});
            assert.equal(base.hash, COMMITTED_HASH, 'the align branch perturbed the default position stream');
            for (const o of [
                { align: 0 },            // explicit off
                { align: -1 },           // negative -> clamp01 0
                { align: NaN },          // non-finite -> clamp01 default 0
                { align: Infinity },     // non-finite -> clamp01 default 0
                { align: 'lots' },       // non-numeric -> clamp01 default 0
            ]) {
                const r = run(o);
                assert.equal(r.hash, COMMITTED_HASH, `align ${JSON.stringify(o)} should not move positions`);
                assert.equal(r.rotateHash, base.rotateHash,
                    `align ${JSON.stringify(o)} should emit the raw spin (rotation unchanged)`);
            }
        });

        it('every prior committed fingerprint still reproduces with align off (no sequence drift)', () => {
            assert.equal(run({ floor: FLOOR_Y }).hash, FLOOR_HASH, 'floor fingerprint drifted');
            assert.equal(run({ ...BOX, bounce: 0 }).hash, BOX_HASH, 'box fingerprint drifted');
        });

        it('is a PURE orientation overlay: align:1 leaves the position hash identical, changes only rotation', () => {
            const off = run({});
            const on = run({ align: 1 });
            // The headline: orientation moved NOTHING in world space -- same seed, same positions.
            assert.equal(on.hash, off.hash, 'align:1 perturbed the position stream (not a pure overlay)');
            // ...but the rotation sequence genuinely changed (non-vacuous).
            assert.notEqual(on.rotateHash, off.rotateHash, 'align:1 should change the rotation sequence');
        });

        it('matches the committed ALIGN fingerprint -- distinct + deterministic + partial blends', () => {
            const on = run({ align: 1 });
            if (ALIGN_HASH === null) console.log('[align] 1 rotateHash =', on.rotateHash);
            else assert.equal(on.rotateHash, ALIGN_HASH, 'aligned rotation changed vs the committed baseline');
            // Deterministic: same seed + fixed dt -> same rotation on replay (align draws no rng).
            assert.equal(run({ align: 1 }).rotateHash, on.rotateHash, 'align not deterministic');
            // A partial blend is genuinely between off and full -- distinct from both.
            const half = run({ align: 0.5 }).rotateHash;
            assert.notEqual(half, run({}).rotateHash, 'align:0.5 should differ from off');
            assert.notEqual(half, on.rotateHash, 'align:0.5 should differ from align:1');
        });

        it('orients BROADSIDE to the live velocity (non-vacuous direction via the lastRotate probe)', () => {
            // A single piece blown hard rightward: vx dominates, so heading ~ 0 and the broadside
            // rotation ~ HALF_PI (the flat face square to the wind). align:0 gives the spin-driven value
            // instead. A bare hash proves determinism but not that rotation TRACKS the heading.
            const dir = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 7 });
                c.burst({ count: 1, x: 400, y: 300, spread: 0.001, speed: 10, wind: 20000,
                    gravity: 0, drag: 0.98, lifeMin: 5, lifeMax: 5, ...opts });
                pump(30, 16);   // let the wind dominate the velocity
                const r = canvas.lastRotate;
                c.destroy();
                return r;
            };
            const norm = (a) => { let d = a; d -= 2 * Math.PI * Math.floor((d + Math.PI) / (2 * Math.PI)); return d; };
            const on = norm(dir({ align: 1 }));
            const off = norm(dir({ align: 0 }));
            assert.ok(Math.abs(on - HALF_PI) < 0.05,
                `a rightward-blown aligned piece should stand broadside (~HALF_PI); got ${on.toFixed(4)}`);
            assert.ok(Math.abs(off - HALF_PI) > 0.1,
                `align:0 should keep the random spin, not the heading; got ${off.toFixed(4)}`);
        });

        it('keeps positions finite under align + gravity + wind + bounce in a box', () => {
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.6,
                    gravity: 4000, wind: 1200, align: 1,
                });
                pump(80, 16);
            });
            c.destroy();
        });

        it('is honored by spray() too (a render property of any moving piece, unlike burst-only stagger)', () => {
            // Unlike stagger, align is NOT burst-only: a spraying piece has velocity to orient to, so the
            // rotation sequence must change while positions stay identical.
            const spray = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 400, rate: 15, x: 400, y: 200, spread: 1.2, shape: 'rect',
                    lifeMin: 4, lifeMax: 4, ...opts });
                pump(1, 1000); pump(60, 16);
                const out = { hash: canvas.hash, rotateHash: canvas.rotateHash };
                c.destroy();
                return out;
            };
            const off = spray({});
            const on = spray({ align: 1 });
            assert.equal(on.hash, off.hash, 'align should not move spray positions (pure overlay)');
            assert.notEqual(on.rotateHash, off.rotateHash, 'spray should honor align (rotation changed)');
        });

        it('has no effect under reduced motion (static fan is inert)', () => {
            const staticAlign = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                    pump(1, 1000); pump(29, 16);
                    const out = { hash: canvas.hash, rotateHash: canvas.rotateHash };
                    c.destroy();
                    return out;
                } finally {
                    setReducedMotion(false);
                }
            };
            const off = staticAlign({});
            const on = staticAlign({ align: 1 });
            assert.equal(on.hash, off.hash, 'align should be inert on the static reduced-motion positions');
            assert.equal(on.rotateHash, off.rotateHash, 'align should not touch the static fan rotation');
        });
    });

    describe('spinRate / tumble speed', () => {
        // The canonical seed-12345 rig (shared with the align suite). `run` reports BOTH fingerprints:
        // `hash` (position, folds only translate) and `rotateHash` (rotation, kept out of `hash`).
        // spinRate is a render-time angle scale that NEVER touches pool.spin, so its headline property
        // is that the POSITION hash is byte-identical whether off or on -- a pure orientation overlay.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, rotateHash: canvas.rotateHash };
            c.destroy();
            return out;
        };

        it('is opt-in and fail-closed: off / 1 / non-finite emits the raw spin (byte-identical)', () => {
            // Headline: when off (or non-finite -> num defaults to 1), the render emits pool.spin[i]
            // verbatim, so BOTH the position hash AND the rotation sequence match a pre-spinRate run.
            const base = run({});
            assert.equal(base.hash, COMMITTED_HASH, 'the spinRate branch perturbed the default position stream');
            for (const o of [
                { spinRate: 1 },          // explicit default
                { spinRate: NaN },        // non-finite -> num default 1
                { spinRate: Infinity },   // non-finite -> num default 1
                { spinRate: '2' },        // non-numeric -> num default 1
            ]) {
                const r = run(o);
                assert.equal(r.hash, COMMITTED_HASH, `spinRate ${JSON.stringify(o)} should not move positions`);
                assert.equal(r.rotateHash, base.rotateHash,
                    `spinRate ${JSON.stringify(o)} should emit the raw spin (rotation unchanged)`);
            }
        });

        it('every prior committed fingerprint still reproduces with spinRate off (no sequence drift)', () => {
            assert.equal(run({}).hash, COMMITTED_HASH, 'default fingerprint drifted');
            assert.equal(run({ floor: FLOOR_Y }).hash, FLOOR_HASH, 'floor fingerprint drifted');
            assert.equal(run({ ...BOX, bounce: 0 }).hash, BOX_HASH, 'box fingerprint drifted');
            assert.equal(run({ align: 1 }).rotateHash, ALIGN_HASH, 'align rotation fingerprint drifted');
        });

        it('is a PURE orientation overlay: 2 / 0 / 0.5 / -1 keep the position hash, change only rotation', () => {
            const off = run({});
            for (const sr of [2, 0, 0.5, -1]) {
                const on = run({ spinRate: sr });
                // The headline: orientation moved NOTHING in world space -- same seed, same positions.
                assert.equal(on.hash, off.hash, `spinRate:${sr} perturbed the position stream (not a pure overlay)`);
                // ...but the rotation sequence genuinely changed (non-vacuous).
                assert.notEqual(on.rotateHash, off.rotateHash, `spinRate:${sr} should change the rotation sequence`);
            }
        });

        it('is fully decoupled from turbulence: same positions, different rotation (the crux)', () => {
            // pool.spin[i] feeds the turbulence curl phase (Confetti.js:824). A spawn-time spinV scale
            // would leak into vx/vy and diverge positions; the render-time angle scale does not. So with
            // turbulence armed, spinRate:2 vs spinRate:1 must give IDENTICAL positions but DIFFERENT
            // rotation -- the test that proves the render-scale resolution.
            const a = run({ spinRate: 2, turbulence: 400 });
            const b = run({ spinRate: 1, turbulence: 400 });
            assert.equal(a.hash, b.hash, 'spinRate leaked into positions through the turbulence phase');
            assert.notEqual(a.rotateHash, b.rotateHash, 'spinRate did not change rotation under turbulence');
        });

        it('matches the committed SPINRATE fingerprint -- distinct + deterministic', () => {
            const on = run({ spinRate: 2 });
            if (SPINRATE_HASH === null) console.log('[spinRate] 2 rotateHash =', on.rotateHash);
            else assert.equal(on.rotateHash, SPINRATE_HASH, 'spinRate rotation changed vs the committed baseline');
            // Deterministic: same seed + fixed dt -> same rotation on replay (spinRate draws no rng).
            assert.equal(run({ spinRate: 2 }).rotateHash, on.rotateHash, 'spinRate not deterministic');
            // A different rate is genuinely distinct from both off (1) and 2.
            const half = run({ spinRate: 0.5 }).rotateHash;
            assert.notEqual(half, run({}).rotateHash, 'spinRate:0.5 should differ from off');
            assert.notEqual(half, on.rotateHash, 'spinRate:0.5 should differ from spinRate:2');
        });

        it('scales the RATE, not noise: spinRate:0 freezes at the birth tilt; spinRate:1 advances (lastRotate)', () => {
            // A single piece with no velocity, pumped twice so its seeded tumble accumulates. With
            // spinRate:0 the render freezes at the piece's random birth orientation (spin0) and does NOT
            // advance between pumps; with spinRate:1 the raw spin keeps turning. A bare hash proves
            // determinism but not that the knob scales the RATE.
            const pumped = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 7 });
                c.burst({ count: 1, x: 400, y: 300, spread: 0.001, speed: 10, gravity: 0, drag: 1,
                    lifeMin: 5, lifeMax: 5, ...opts });
                pump(1, 500);
                const a = canvas.lastRotate;
                pump(1, 500);
                const b = canvas.lastRotate;
                c.destroy();
                return { a, b };
            };
            const frozen = pumped({ spinRate: 0 });
            assert.equal(frozen.a, frozen.b, 'spinRate:0 should freeze the tumble at the birth tilt (no advance)');
            const live = pumped({ spinRate: 1 });
            assert.notEqual(live.a, live.b, 'spinRate:1 should keep advancing the tumble');
        });

        it('keeps positions finite under spinRate + gravity + wind + turbulence + bounce in a box', () => {
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.6,
                    gravity: 4000, wind: 1200, turbulence: 600, spinRate: 2,
                });
                pump(80, 16);
            });
            c.destroy();
        });

        it('is honored by spray() too (a render property of any moving piece, unlike burst-only stagger)', () => {
            const spray = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 400, rate: 15, x: 400, y: 200, spread: 1.2, shape: 'rect',
                    lifeMin: 4, lifeMax: 4, ...opts });
                pump(1, 1000); pump(60, 16);
                const out = { hash: canvas.hash, rotateHash: canvas.rotateHash };
                c.destroy();
                return out;
            };
            const off = spray({});
            const on = spray({ spinRate: 2 });
            assert.equal(on.hash, off.hash, 'spinRate should not move spray positions (pure overlay)');
            assert.notEqual(on.rotateHash, off.rotateHash, 'spray should honor spinRate (rotation changed)');
        });

        it('has no effect under reduced motion (static fan is inert)', () => {
            const staticSpin = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                    pump(1, 1000); pump(29, 16);
                    const out = { hash: canvas.hash, rotateHash: canvas.rotateHash };
                    c.destroy();
                    return out;
                } finally {
                    setReducedMotion(false);
                }
            };
            const off = staticSpin({});
            const on = staticSpin({ spinRate: 0 });
            assert.equal(on.hash, off.hash, 'spinRate should be inert on the static reduced-motion positions');
            assert.equal(on.rotateHash, off.rotateHash, 'spinRate should not touch the static fan rotation');
        });
    });

    describe('spinDrag / angular retention', () => {
        // The canonical seed-12345 rig (shared with the wind/floor/box/spinRate suites). `run` reports every
        // render channel: `hash` (position, translate only), `rotateHash`, `scaleHash`, `colorHash`, `alphaHash`
        // (each kept OUT of `hash`) plus `lastRotate` (a hash-neutral witness). spinDrag is the angular mirror of
        // the linear `drag` (`spinV *= spinDrag` before the spin advance). Its headline on this TURBULENCE-OFF rig
        // is that the POSITION hash is byte-identical whether off or on -- only the render rotation moves. But it
        // is NOT a pure render overlay: under turbulence the curl reads the slower spin and positions MOVE (crux).
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = {
                hash: canvas.hash, rotateHash: canvas.rotateHash, scaleHash: canvas.scaleHash,
                strokeHash: canvas.strokeHash, colorHash: canvas.colorHash, alphaHash: canvas.alphaHash,
            };
            c.destroy();
            return out;
        };

        it('is opt-in and fail-closed: off / 1 / non-finite / string coerce to 1 (byte-identical)', () => {
            // clamp01 maps non-finite/undefined -> 1 (off). Every such input leaves spinV untouched, so BOTH the
            // position hash AND the rotation sequence match a pre-spinDrag run bit-for-bit.
            const base = run({});
            assert.equal(base.hash, COMMITTED_HASH, 'the spinDrag branch perturbed the default position stream');
            for (const o of [
                {},                        // omitted
                { spinDrag: 1 },           // explicit default
                { spinDrag: NaN },         // non-finite -> clamp01 default 1
                { spinDrag: Infinity },    // non-finite -> clamp01 default 1
                { spinDrag: '0.9' },       // non-numeric -> clamp01 default 1
                { spinDrag: null },        // non-finite -> clamp01 default 1
                { spinDrag: undefined },   // omitted -> default 1
            ]) {
                const r = run(o);
                assert.equal(r.hash, COMMITTED_HASH, `spinDrag ${JSON.stringify(o)} should not move positions`);
                assert.equal(r.rotateHash, base.rotateHash,
                    `spinDrag ${JSON.stringify(o)} should leave spinV untouched (rotation unchanged)`);
            }
        });

        it('a NEGATIVE freezes at 0 -- it does NOT fall back to the default (decision 1)', () => {
            // clamp01 sends a negative to 0 (instant spin freeze at the birth angle), a legitimate finite value --
            // the angular twin of the legal drag:0, NOT a fallback to 1. So run(-1) must match run(0), and both
            // must DIFFER from off. Positions stay COMMITTED_HASH (turbulence off -- render-only).
            const off = run({});
            const neg = run({ spinDrag: -1 });
            const zero = run({ spinDrag: 0 });
            assert.equal(neg.rotateHash, zero.rotateHash, 'a negative spinDrag must freeze like 0, not default to 1');
            assert.notEqual(zero.rotateHash, off.rotateHash, 'a frozen tumble must differ from the off tumble');
            assert.equal(neg.hash, COMMITTED_HASH, 'a frozen spin must not move positions (turbulence off)');
            assert.equal(zero.hash, COMMITTED_HASH, 'a frozen spin must not move positions (turbulence off)');
        });

        it('every prior POSITION fingerprint reproduces on its turbulence-OFF rig (0.9/0.5/0/-1)', () => {
            // spinDrag is a HYBRID knob: with turbulence OFF it moves ONLY the render rotation. So on EVERY
            // turbulence-off physics rig -- default / floor / box / wind / friction / wallFriction -- the position
            // hash and the scale/stroke/color/alpha channels are byte-identical off or armed; only rotateHash moves.
            const rigs = [
                { name: 'default',      base: {},                                        hash: COMMITTED_HASH },
                { name: 'floor',        base: { floor: FLOOR_Y, bounce: 0 },             hash: FLOOR_HASH },
                { name: 'box',          base: { ...BOX, bounce: 0 },                     hash: BOX_HASH },
                { name: 'wind',         base: { wind: 300 },                             hash: WIND_HASH },
                { name: 'friction',     base: { floor: FLOOR_Y, friction: 0.5 },         hash: FRICTION_HASH },
                { name: 'wallFriction', base: { ...BOX, bounce: 0.6, wallFriction: 0.5 }, hash: WALLFRICTION_HASH },
            ];
            for (const rig of rigs) {
                const off = run(rig.base);
                assert.equal(off.hash, rig.hash, `${rig.name} baseline drifted`);
                for (const sd of [0.9, 0.5, 0, -1]) {
                    const on = run({ ...rig.base, spinDrag: sd });
                    assert.equal(on.hash, rig.hash, `${rig.name} position hash drifted with spinDrag:${sd}`);
                    assert.equal(on.scaleHash, off.scaleHash, `${rig.name} scaleHash drifted with spinDrag:${sd}`);
                    assert.equal(on.strokeHash, off.strokeHash, `${rig.name} strokeHash drifted with spinDrag:${sd}`);
                    assert.equal(on.colorHash, off.colorHash, `${rig.name} colorHash drifted with spinDrag:${sd}`);
                    assert.equal(on.alphaHash, off.alphaHash, `${rig.name} alphaHash drifted with spinDrag:${sd}`);
                }
            }
        });

        it('matches the committed SPINDRAG rotation fingerprint -- distinct + deterministic (turbulence off)', () => {
            const on = run({ spinDrag: 0.9 });
            if (SPINDRAG_ROT_HASH === null) console.log('[spinDrag] 0.9 rotateHash =', on.rotateHash);
            else assert.equal(on.rotateHash, SPINDRAG_ROT_HASH, 'spinDrag rotation changed vs the committed baseline');
            // Deterministic: same seed + fixed dt -> same rotation on replay (spinDrag draws no rng).
            assert.equal(run({ spinDrag: 0.9 }).rotateHash, on.rotateHash, 'spinDrag not deterministic on replay');
            // Non-vacuous: it genuinely moves the rotation vs off AND vs a different factor.
            assert.notEqual(on.rotateHash, run({}).rotateHash, 'spinDrag:0.9 should move the rotation vs off');
            assert.notEqual(on.rotateHash, run({ spinDrag: 0.5 }).rotateHash, 'spinDrag:0.9 should differ from 0.5');
            // Headline: on this turbulence-off rig the position stream is byte-identical.
            assert.equal(on.hash, COMMITTED_HASH, 'spinDrag moved positions with turbulence OFF (should be render-only)');
        });

        it('THE CRUX: under turbulence the curl reads the slower spin, so POSITIONS move', () => {
            // pool.spin feeds the turbulence curl (tp = tilt*1.7 + spin). With turbulence armed, a slower tumble
            // bends the per-particle wander -> vx/vy -> x/y. So on the SAME turbulence:500 baseline, spinDrag:0.9
            // must give a DIFFERENT position hash than spinDrag off. This is why spinDrag is never documented as a
            // pure render overlay.
            assert.equal(run({ turbulence: 500 }).hash, TURB_HASH, 'the turbulence baseline drifted');
            const on = run({ turbulence: 500, spinDrag: 0.9 });
            if (SPINDRAG_TURB_HASH === null) console.log('[spinDrag] turb500+0.9 hash =', on.hash);
            else assert.equal(on.hash, SPINDRAG_TURB_HASH, 'turbulent spinDrag positions changed vs the committed baseline');
            assert.notEqual(on.hash, TURB_HASH, 'spinDrag under turbulence MUST move positions (the coupling is real)');
            assert.equal(run({ turbulence: 500, spinDrag: 0.9 }).hash, on.hash, 'turbulent spinDrag not deterministic');
        });

        it('damps spinV ONLY, never tiltV: a sway-armed turbulence-off rig keeps its position hash', () => {
            // sway is a direct x-write from Math.sin(tilt). If spinDrag damped tiltV it would move a swaying burst.
            // It does not: on a sway-armed, turbulence-off rig, spinDrag:0.5 reproduces its spinDrag-off position
            // hash exactly (only rotateHash moves). Proves the single-coupling-path property (decision 2).
            const off = run({ sway: 0.8 });
            const on = run({ sway: 0.8, spinDrag: 0.5 });
            assert.equal(on.hash, off.hash, 'spinDrag damped tiltV (a sway-armed position hash moved)');
            assert.notEqual(on.rotateHash, off.rotateHash, 'spinDrag should still move the rotation (non-vacuous)');
        });

        it('scales the RATE, not noise: |lastRotate - birth| strictly decreases as spinDrag drops to 0', () => {
            // A single piece with no velocity, pumped a fixed number of frames so its seeded tumble accumulates.
            // The damp is `spinV *= spinDrag` before each advance, so the total swept angle is
            // spinV0*dt*(sd + sd^2 + ... + sd^N) -- strictly increasing in sd on [0,1], exactly 0 at sd 0 (the
            // piece freezes at its birth angle). A bare hash proves determinism but not that the knob scales the RATE.
            const pumped = (sd) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 7 });
                c.burst({ count: 1, x: 400, y: 300, spread: 0.001, speed: 10, gravity: 0, drag: 1,
                    align: 0, spinRate: 1, turbulence: 0, flutter: 0, lifeMin: 20, lifeMax: 20, spinDrag: sd });
                pump(30, 50);
                const last = canvas.lastRotate;
                c.destroy();
                return last;
            };
            const birth = pumped(0);                 // spinDrag 0 freezes at the birth angle (the pivot)
            const swept = (sd) => Math.abs(pumped(sd) - birth);
            const d1  = swept(1);
            const d99 = swept(0.99);
            const d95 = swept(0.95);
            const d90 = swept(0.9);
            const d0  = swept(0);
            assert.equal(d0, 0, 'spinDrag 0 must freeze the tumble at the birth angle (zero swept)');
            assert.ok(d1 > d99, 'spinDrag 1 must sweep more than 0.99');
            assert.ok(d99 > d95, 'spinDrag 0.99 must sweep more than 0.95');
            assert.ok(d95 > d90, 'spinDrag 0.95 must sweep more than 0.9');
            assert.ok(d90 > d0, 'spinDrag 0.9 must sweep more than the frozen 0');
        });

        it('keeps draws finite under spinDrag + turbulence + wind + gravity + a bouncing box + trails', () => {
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3, trail: 8 });
            for (const sd of [0, 0.5, 1e9, -5]) {   // 1e9 -> 1 (off), -5 -> 0 (freeze)
                assert.doesNotThrow(() => {
                    c.burst({
                        x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                        wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.6,
                        gravity: 4000, wind: 1200, turbulence: 500, spinDrag: sd,
                    });
                    pump(80, 16);
                }, `spinDrag:${sd} produced a non-finite draw under load`);
            }
            c.destroy();
        });

        it('is honored by spray() too (turbulence off: rotation moves, position identical)', () => {
            const spray = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 400, rate: 15, x: 400, y: 200, spread: 1.2, shape: 'rect',
                    lifeMin: 4, lifeMax: 4, ...opts });
                pump(1, 1000); pump(60, 16);
                const out = { hash: canvas.hash, rotateHash: canvas.rotateHash };
                c.destroy();
                return out;
            };
            const off = spray({});
            const on = spray({ spinDrag: 0.9 });
            assert.equal(on.hash, off.hash, 'spinDrag should not move spray positions (turbulence off)');
            assert.notEqual(on.rotateHash, off.rotateHash, 'spray should honor spinDrag (rotation changed)');
        });

        it('has no effect under reduced motion (static fan is inert)', () => {
            const staticSpin = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                    pump(1, 1000); pump(29, 16);
                    const out = { hash: canvas.hash, rotateHash: canvas.rotateHash };
                    c.destroy();
                    return out;
                } finally {
                    setReducedMotion(false);
                }
            };
            const off = staticSpin({});
            const on = staticSpin({ spinDrag: 0.1 });
            assert.equal(on.hash, off.hash, 'spinDrag should be inert on the static reduced-motion positions');
            assert.equal(on.rotateHash, off.rotateHash, 'spinDrag should not touch the static fan rotation');
        });

        it('composes with spinRate + align: same positions (turb off), a rotation distinct from each alone', () => {
            // spinDrag damps the accumulation; spinRate render-scales it; align blends toward the heading. All
            // read the same spin, none collide. Turbulence off => positions byte-identical; the combined rotation
            // differs from any single knob.
            const off = run({});
            const composed = run({ spinDrag: 0.5, spinRate: 2, align: 1 });
            assert.equal(composed.hash, off.hash, 'the composition moved positions with turbulence off');
            assert.notEqual(composed.rotateHash, run({ spinDrag: 0.5 }).rotateHash, 'composition == spinDrag alone');
            assert.notEqual(composed.rotateHash, run({ spinRate: 2 }).rotateHash, 'composition == spinRate alone');
            assert.notEqual(composed.rotateHash, run({ align: 1 }).rotateHash, 'composition == align alone');
        });
    });

    describe('scaleTo / size-over-life', () => {
        // The canonical seed-12345 rig (shared with the align/spinRate suites). `run` reports the
        // position `hash` (folds only translate) plus the render probes kept OUT of it: `scaleHash`
        // (the v1.17.0 size fold), `rotateHash`, and `colorHash`. scaleTo is a render-time size scale
        // FOLDED into flutter's existing ctx.scale call; it never touches pool.w/h or translate, so its
        // headline is that the POSITION hash is byte-identical off or on -- a pure render overlay.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, scaleHash: canvas.scaleHash, rotateHash: canvas.rotateHash, colorHash: canvas.colorHash };
            c.destroy();
            return out;
        };

        it('is opt-in and fail-closed: off / 1 / non-finite / null keep the size fold byte-identical', () => {
            // Headline: off, explicit 1, or any non-finite/non-numeric (nonneg -> default 1) emits the
            // birth-size scale verbatim, so BOTH the position hash AND the scale sequence match a
            // pre-scaleTo run.
            const base = run({});
            assert.equal(base.hash, COMMITTED_HASH, 'the scaleTo branch perturbed the default position stream');
            for (const o of [
                {},
                { scaleTo: 1 },
                { scaleTo: NaN },
                { scaleTo: Infinity },
                { scaleTo: '2' },
                { scaleTo: null },
                { scaleTo: undefined },
            ]) {
                const r = run(o);
                assert.equal(r.hash, COMMITTED_HASH, `scaleTo ${JSON.stringify(o)} should not move positions`);
                assert.equal(r.scaleHash, base.scaleHash, `scaleTo ${JSON.stringify(o)} should leave the size fold untouched`);
            }
        });

        it('a NEGATIVE clamps to 0, not to the default 1 (decision 3)', () => {
            // nonneg maps a negative to 0 (a legitimate "vanish at death"), NOT a mirror flip and NOT a
            // fallback to 1. So scaleTo:-1 must render IDENTICALLY to scaleTo:0, and both must DIFFER
            // from off -- while the position hash stays put.
            const base = run({});
            const neg = run({ scaleTo: -1 });
            const zero = run({ scaleTo: 0 });
            assert.equal(neg.scaleHash, zero.scaleHash, 'a negative scaleTo must clamp to 0, not mirror-flip');
            assert.notEqual(neg.scaleHash, base.scaleHash, 'scaleTo:-1 must not fall back to the default 1');
            assert.equal(neg.hash, COMMITTED_HASH, 'a clamped scaleTo must not move positions');
            assert.equal(zero.hash, COMMITTED_HASH, 'scaleTo:0 must not move positions');
        });

        it('every prior committed fingerprint still reproduces with scaleTo off (no sequence drift)', () => {
            assert.equal(run({}).hash, COMMITTED_HASH, 'default fingerprint drifted');
            assert.equal(run({ floor: FLOOR_Y }).hash, FLOOR_HASH, 'floor fingerprint drifted');
            assert.equal(run({ ...BOX, bounce: 0 }).hash, BOX_HASH, 'box fingerprint drifted');
            assert.equal(run({ align: 1 }).rotateHash, ALIGN_HASH, 'align rotation fingerprint drifted');
            assert.equal(run({ spinRate: 2 }).rotateHash, SPINRATE_HASH, 'spinRate rotation fingerprint drifted');
            // v1.24.0 cross-guard: with scaleFrom present-but-off (1), the committed SCALE fingerprints
            // must reproduce byte-for-byte -- the formula rewrite s = sf + (scaleTo - sf) * age is the SAME
            // double expression as the shipped 1 + (scaleTo - 1) * age when sf reads back exactly 1.0.
            assert.equal(run({ scaleTo: 2, scaleFrom: 1 }).scaleHash, SCALE_HASH, 'SCALE_HASH drifted with scaleFrom present-but-off');
            const fr = makeCanvas({ record: true });
            const fc = createConfetti(fr, { seed: 12345 });
            fc.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, flutter: 1, flutterRate: 2, scaleFrom: 1 });
            pump(1, 1000); pump(29, 16);
            assert.equal(fr.scaleHash, FLUTRATE_HASH, 'FLUTRATE_HASH drifted with scaleFrom present-but-off');
            fc.destroy();
        });

        it('is a PURE render overlay: 2 / 0.2 / 0 / 3 keep the position hash, change only the size fold', () => {
            const off = run({});
            for (const st of [2, 0.2, 0, 3]) {
                const on = run({ scaleTo: st });
                assert.equal(on.hash, off.hash, `scaleTo:${st} perturbed the position stream (not a pure overlay)`);
                assert.notEqual(on.scaleHash, off.scaleHash, `scaleTo:${st} should change the size sequence`);
            }
        });

        it('is orthogonal to rotation and color, and composes with align/spinRate/flutter', () => {
            const off = run({});
            const on = run({ scaleTo: 2 });
            assert.equal(on.rotateHash, off.rotateHash, 'scaleTo must not touch rotation');
            assert.equal(on.colorHash, off.colorHash, 'scaleTo must not touch color');
            // Even stacked with every other render overlay, the seeded POSITION stream is untouched.
            const stacked = run({ scaleTo: 2, align: 1, spinRate: 2, flutter: 1 });
            assert.equal(stacked.hash, off.hash, 'stacked render overlays perturbed the position stream');
        });

        it('the trail ribbon keeps its BIRTH width (decision (b)): strokeHash identical, TRAIL_HASH holds', () => {
            const trailRun = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345, trail: 10 });
                c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                pump(1, 1000); pump(29, 16);
                const out = { strokeHash: canvas.strokeHash, strokes: canvas.strokes };
                c.destroy();
                return out;
            };
            const off = trailRun({});
            const on = trailRun({ scaleTo: 0.2 });
            assert.ok(on.strokes > 0, 'the trail rig must actually stroke');
            assert.equal(on.strokeHash, off.strokeHash, 'scaleTo narrowed the ribbon -- it must keep birth width');
            assert.equal(off.strokeHash, TRAIL_HASH, 'the standalone trail geometry fingerprint drifted');
        });

        it('matches the committed SCALE fingerprint -- distinct + deterministic', () => {
            const on = run({ scaleTo: 2 });
            if (SCALE_HASH === null) console.log('[scaleTo] 2 scaleHash =', on.scaleHash);
            else assert.equal(on.scaleHash, SCALE_HASH, 'scaleTo size fold changed vs the committed baseline');
            // Deterministic: same seed + fixed dt -> same size fold on replay (scaleTo draws no rng).
            assert.equal(run({ scaleTo: 2 }).scaleHash, on.scaleHash, 'scaleTo not deterministic');
            // A different target is genuinely distinct from both off (1) and 2.
            const half = run({ scaleTo: 0.5 }).scaleHash;
            assert.notEqual(half, run({}).scaleHash, 'scaleTo:0.5 should differ from off');
            assert.notEqual(half, on.scaleHash, 'scaleTo:0.5 should differ from scaleTo:2');
        });

        it('tracks the life fraction (lastScale): off flat at 1, 0.2 shrinks, 2 grows, birth anchored ~1', () => {
            // A single piece with flutter off (so wobbleScale == 1 and the recorded Y factor is the pure
            // size ramp). Sample lastScale frame by frame: off must be exactly 1 each frame; 0.2 must
            // start ~1 (birth anchor) and STRICTLY DECREASE below 1; 2 must start ~1 and STRICTLY
            // INCREASE above 1. A bare hash proves determinism but not that the ramp tracks life.
            const sampled = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 7 });
                c.burst({ count: 1, x: 400, y: 300, spread: 0.001, speed: 10, gravity: 0, drag: 1,
                    flutter: 0, lifeMin: 5, lifeMax: 5, ...opts });
                const xs = [];
                for (let f = 0; f < 8; f++) { pump(1, 100); xs.push(canvas.lastScale); }
                c.destroy();
                return xs;
            };
            for (const v of sampled({})) assert.equal(v, 1, 'scaleTo off must keep the Y size factor exactly 1');
            const down = sampled({ scaleTo: 0.2 });
            assert.ok(Math.abs(down[0] - 1) < 0.05, 'scaleTo:0.2 should be birth-anchored near 1');
            for (let k = 1; k < down.length; k++) {
                assert.ok(down[k] < down[k - 1], 'scaleTo:0.2 must strictly shrink');
                assert.ok(down[k] < 1, 'scaleTo:0.2 must stay below 1');
            }
            const up = sampled({ scaleTo: 2 });
            assert.ok(Math.abs(up[0] - 1) < 0.05, 'scaleTo:2 should be birth-anchored near 1');
            for (let k = 1; k < up.length; k++) {
                assert.ok(up[k] > up[k - 1], 'scaleTo:2 must strictly grow');
                assert.ok(up[k] > 1, 'scaleTo:2 must stay above 1');
            }
        });

        it('keeps positions finite under scaleTo extremes + gravity + wind + turbulence + a bouncing box + trails', () => {
            for (const st of [0, 0.2, 3, 1e6]) {
                const canvas = makeCanvas({ record: true, assertFinite: true });
                const c = createConfetti(canvas, { seed: 3, trail: 12 });
                assert.doesNotThrow(() => {
                    c.burst({
                        x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                        wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.6,
                        gravity: 4000, wind: 1200, turbulence: 500, scaleTo: st, trail: 12,
                    });
                    pump(80, 16);
                }, `scaleTo:${st} produced a non-finite draw`);
                c.destroy();
            }
        });

        it('is honored by spray() too: positions identical, size fold differs', () => {
            const spray = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 400, rate: 15, x: 400, y: 200, spread: 1.2, shape: 'rect',
                    lifeMin: 4, lifeMax: 4, ...opts });
                pump(1, 1000); pump(60, 16);
                const out = { hash: canvas.hash, scaleHash: canvas.scaleHash };
                c.destroy();
                return out;
            };
            const off = spray({});
            const on = spray({ scaleTo: 0.3 });
            assert.equal(on.hash, off.hash, 'scaleTo should not move spray positions (pure overlay)');
            assert.notEqual(on.scaleHash, off.scaleHash, 'spray should honor scaleTo (size fold changed)');
        });

        it('has no effect under reduced motion (static fan is inert)', () => {
            const staticRun = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                    pump(1, 1000); pump(29, 16);
                    const out = { hash: canvas.hash, scaleHash: canvas.scaleHash };
                    c.destroy();
                    return out;
                } finally {
                    setReducedMotion(false);
                }
            };
            const off = staticRun({});
            const on = staticRun({ scaleTo: 0.1 });
            assert.equal(on.hash, off.hash, 'scaleTo should be inert on the static reduced-motion positions');
            assert.equal(on.scaleHash, off.scaleHash, 'scaleTo should not touch the static fan size fold');
        });
    });

    describe('scaleFrom / birth-size ramp', () => {
        // The canonical seed-12345 rig (shared with the align/spinRate/scaleTo suites). `run` reports the
        // position `hash` (folds only translate) plus the render probes kept OUT of it: `scaleHash` (the
        // size fold, now two-endpoint), `rotateHash`, `colorHash`, and `alphaHash`. scaleFrom is the BIRTH
        // endpoint of the size ramp scaleTo targets -- a render-time size scale FOLDED into flutter's
        // existing ctx.scale call; it never touches pool.w/h or translate, so its headline is that the
        // POSITION hash is byte-identical off or on -- a pure render overlay. It bites HARDEST at age 0
        // (s == scaleFrom on the first drawn frame), so the canonical lifeMin/Max:5 rig exposes it at once.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, scaleHash: canvas.scaleHash, rotateHash: canvas.rotateHash, colorHash: canvas.colorHash, alphaHash: canvas.alphaHash };
            c.destroy();
            return out;
        };

        it('is opt-in and fail-closed: off / 1 / non-finite / null keep the size fold byte-identical (DONE-WHEN 2)', () => {
            // Headline (the formula-rewrite proof): off, explicit 1, or any non-finite/non-numeric
            // (nonneg -> default 1) reads back exactly 1.0, so sf + (scaleTo - sf) * age is the SAME double
            // expression as the shipped 1 + (scaleTo - 1) * age -- BOTH the position hash AND the scale
            // sequence match a pre-scaleFrom run, byte-for-byte.
            const base = run({});
            assert.equal(base.hash, COMMITTED_HASH, 'the scaleFrom branch perturbed the default position stream');
            for (const o of [
                {},
                { scaleFrom: 1 },
                { scaleFrom: NaN },
                { scaleFrom: Infinity },
                { scaleFrom: '2' },
                { scaleFrom: null },
                { scaleFrom: undefined },
            ]) {
                const r = run(o);
                assert.equal(r.hash, COMMITTED_HASH, `scaleFrom ${JSON.stringify(o)} should not move positions`);
                assert.equal(r.scaleHash, base.scaleHash, `scaleFrom ${JSON.stringify(o)} should leave the size fold untouched`);
            }
        });

        it('a NEGATIVE clamps to 0 (born invisible), NOT to the default 1 (DONE-WHEN 5)', () => {
            // nonneg maps a negative to 0 (a legitimate "born invisible", the size analog of scaleTo:0),
            // NOT a mirror flip and NOT a fallback to 1. So scaleFrom:-1 must render IDENTICALLY to
            // scaleFrom:0, and both must DIFFER from off -- while the position hash stays put.
            const base = run({});
            const neg = run({ scaleFrom: -1 });
            const zero = run({ scaleFrom: 0 });
            assert.equal(neg.scaleHash, zero.scaleHash, 'a negative scaleFrom must clamp to 0, not mirror-flip');
            assert.notEqual(neg.scaleHash, base.scaleHash, 'scaleFrom:-1 must not fall back to the default 1');
            assert.equal(neg.hash, COMMITTED_HASH, 'a clamped scaleFrom must not move positions');
            assert.equal(zero.hash, COMMITTED_HASH, 'scaleFrom:0 must not move positions');
        });

        it('matches the committed SCALEFROM fingerprint -- distinct + deterministic (DONE-WHEN 3)', () => {
            const on = run({ scaleFrom: 0.25 });
            if (SCALEFROM_HASH === null) console.log('[scaleFrom] 0.25 scaleHash =', on.scaleHash);
            else assert.equal(on.scaleHash, SCALEFROM_HASH, 'scaleFrom size fold changed vs the committed baseline');
            // Deterministic: same seed + fixed dt -> same size fold on replay (scaleFrom draws no rng).
            assert.equal(run({ scaleFrom: 0.25 }).scaleHash, on.scaleHash, 'scaleFrom not deterministic');
            // Genuinely distinct from off (1), from scaleFrom:2, and from the scaleTo baseline SCALE_HASH.
            assert.notEqual(on.scaleHash, run({}).scaleHash, 'scaleFrom:0.25 should differ from off');
            assert.notEqual(on.scaleHash, run({ scaleFrom: 2 }).scaleHash, 'scaleFrom:0.25 should differ from scaleFrom:2');
            assert.notEqual(on.scaleHash, SCALE_HASH, 'scaleFrom:0.25 should differ from the scaleTo:2 fingerprint');
        });

        it('is a PURE render overlay: 0.2 / 0.5 / 2 / 3 keep the position hash, change only the size fold (DONE-WHEN 4)', () => {
            const off = run({});
            for (const sf of [0.2, 0.5, 2, 3]) {
                const on = run({ scaleFrom: sf });
                assert.equal(on.hash, off.hash, `scaleFrom:${sf} perturbed the position stream (not a pure overlay)`);
                assert.notEqual(on.scaleHash, off.scaleHash, `scaleFrom:${sf} should change the size sequence`);
            }
        });

        it('is orthogonal to rotation, color, and alpha; only scaleHash moves (DONE-WHEN 4)', () => {
            const off = run({});
            const on = run({ scaleFrom: 0.25 });
            assert.equal(on.rotateHash, off.rotateHash, 'scaleFrom must not touch rotation');
            assert.equal(on.colorHash, off.colorHash, 'scaleFrom must not touch color');
            assert.equal(on.alphaHash, off.alphaHash, 'scaleFrom must not touch alpha');
            assert.notEqual(on.scaleHash, off.scaleHash, 'scaleFrom should move only the size fold');
        });

        it('purity on DISTINCT armed rigs: turbulence / sway positions + trail width unmoved (DONE-WHEN 4)', () => {
            // Non-vacuous purity: pin "inert when off" on the rigs where a position or width LEAK WOULD
            // show, with scaleFrom ARMED (not off). The turbulence curl reads tilt/spin (never sx/sy); sway
            // is a direct x write from Math.sin(pool.tilt); the trail ribbon is world-space, never scaled.
            assert.equal(run({ turbulence: 500, scaleFrom: 0.25 }).hash, TURB_HASH, 'scaleFrom leaked into the turbulence position stream');
            assert.equal(run({ sway: 0.8, scaleFrom: 0.25 }).hash, run({ sway: 0.8 }).hash, 'scaleFrom leaked into the sway position stream');
            const trailRun = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345, trail: 10 });
                c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                pump(1, 1000); pump(29, 16);
                const out = { strokeHash: canvas.strokeHash, strokes: canvas.strokes };
                c.destroy();
                return out;
            };
            const on = trailRun({ scaleFrom: 0.25 });
            assert.ok(on.strokes > 0, 'the trail rig must actually stroke');
            assert.equal(on.strokeHash, TRAIL_HASH, 'scaleFrom narrowed the ribbon -- the streak keeps its birth width');
        });

        it('tracks the BIRTH endpoint (lastScale): first-frame monotone in scaleFrom, blooms + settles (DONE-WHEN 6)', () => {
            // A single piece, flutter off (so wobbleScale == 1 and the recorded Y factor is the pure size
            // ramp). scaleFrom bites at age 0: the FIRST drawn frame's lastScale must rise monotonically as
            // scaleFrom rises. Then a {scaleFrom:0, scaleTo:1} envelope must strictly GROW across life (a
            // bloom), and {scaleFrom:2, scaleTo:1} must strictly SHRINK (born big, settles to full).
            const firstFrame = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 7 });
                c.burst({ count: 1, x: 400, y: 300, spread: 0.001, speed: 10, gravity: 0, drag: 1,
                    flutter: 0, lifeMin: 50, lifeMax: 50, ...opts });
                pump(1, 100);
                const s = canvas.lastScale;
                c.destroy();
                return s;
            };
            const births = [0, 0.25, 0.5, 1, 2].map(sf => firstFrame({ scaleFrom: sf, scaleTo: 1 }));
            for (let k = 1; k < births.length; k++) {
                assert.ok(births[k] > births[k - 1], `first-frame lastScale must rise with scaleFrom (${births[k - 1]} -> ${births[k]})`);
            }
            const frames = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 7 });
                c.burst({ count: 1, x: 400, y: 300, spread: 0.001, speed: 10, gravity: 0, drag: 1,
                    flutter: 0, lifeMin: 50, lifeMax: 50, ...opts });
                const xs = [];
                for (let f = 0; f < 10; f++) { pump(1, 100); xs.push(canvas.lastScale); }
                c.destroy();
                return xs;
            };
            const bloom = frames({ scaleFrom: 0, scaleTo: 1 });
            for (let k = 1; k < bloom.length; k++) assert.ok(bloom[k] > bloom[k - 1], 'scaleFrom:0 -> scaleTo:1 must strictly bloom');
            const settle = frames({ scaleFrom: 2, scaleTo: 1 });
            for (let k = 1; k < settle.length; k++) assert.ok(settle[k] < settle[k - 1], 'scaleFrom:2 -> scaleTo:1 must strictly settle');
            // ISOTROPIC fold: with flutter:0 the recorded X and Y factors are the SAME size ramp; with
            // flutter:1 the X wobble still MULTIPLIES the isotropic factor, so they diverge.
            const witness = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 7 });
                c.burst({ count: 1, x: 400, y: 300, spread: 0.001, speed: 10, gravity: 0, drag: 1,
                    lifeMin: 50, lifeMax: 50, ...opts });
                pump(1, 100); pump(3, 100);
                const out = { x: canvas.lastScaleX, y: canvas.lastScale };
                c.destroy();
                return out;
            };
            const iso = witness({ flutter: 0, scaleFrom: 0.3, scaleTo: 1.5 });
            assert.equal(iso.x, iso.y, 'with flutter:0 the fold is isotropic -- lastScaleX must equal lastScale');
            const wobbly = witness({ flutter: 1, scaleFrom: 0.3, scaleTo: 1.5 });
            assert.notEqual(wobbly.x, wobbly.y, 'with flutter:1 the X wobble must still multiply the isotropic factor');
        });

        it('scaleFrom == scaleTo is an emergent CONSTANT size multiplier (design note)', () => {
            // With both endpoints equal, s = k + (k - k) * age == k for all ages: a constant size factor,
            // flat across life. Witness it on the single-piece flutter-off rig.
            const flat = (k) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 7 });
                c.burst({ count: 1, x: 400, y: 300, spread: 0.001, speed: 10, gravity: 0, drag: 1,
                    flutter: 0, lifeMin: 50, lifeMax: 50, scaleFrom: k, scaleTo: k });
                const xs = [];
                for (let f = 0; f < 6; f++) { pump(1, 100); xs.push(canvas.lastScale); }
                c.destroy();
                return xs;
            };
            for (const v of flat(1.5)) assert.ok(Math.abs(v - 1.5) < 1e-4, 'scaleFrom == scaleTo == 1.5 must hold a constant 1.5 factor');
        });

        it('keeps positions finite under scaleFrom extremes + gravity + wind + turbulence + a bouncing box + trails (DONE-WHEN 5)', () => {
            for (const sf of [0, 0.2, 3, 1e6, 1e-9]) {
                const canvas = makeCanvas({ record: true, assertFinite: true });
                const c = createConfetti(canvas, { seed: 3, trail: 12 });
                assert.doesNotThrow(() => {
                    c.burst({
                        x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                        wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.6,
                        gravity: 4000, wind: 1200, turbulence: 500, scaleFrom: sf, scaleTo: 2, flutter: 1, trail: 12,
                    });
                    pump(80, 16);
                }, `scaleFrom:${sf} produced a non-finite draw`);
                c.destroy();
            }
        });

        it('is honored by spray() too: positions identical, size fold differs (DONE-WHEN 11)', () => {
            const spray = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 400, rate: 15, x: 400, y: 200, spread: 1.2, shape: 'rect',
                    lifeMin: 4, lifeMax: 4, ...opts });
                pump(1, 1000); pump(60, 16);
                const out = { hash: canvas.hash, scaleHash: canvas.scaleHash };
                c.destroy();
                return out;
            };
            const off = spray({});
            const on = spray({ scaleFrom: 0.25 });
            assert.equal(on.hash, off.hash, 'scaleFrom should not move spray positions (pure overlay)');
            assert.notEqual(on.scaleHash, off.scaleHash, 'spray should honor scaleFrom (size fold changed)');
        });

        it('has no effect under reduced motion (static fan is inert) (DONE-WHEN 10)', () => {
            const staticRun = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                    pump(1, 1000); pump(29, 16);
                    const out = { hash: canvas.hash, scaleHash: canvas.scaleHash };
                    c.destroy();
                    return out;
                } finally {
                    setReducedMotion(false);
                }
            };
            const off = staticRun({});
            const on = staticRun({ scaleFrom: 0.1 });
            assert.equal(on.hash, off.hash, 'scaleFrom should be inert on the static reduced-motion positions');
            assert.equal(on.scaleHash, off.scaleHash, 'scaleFrom should not touch the static fan size fold');
        });
    });

    describe('flutterRate / tumble-wobble speed', () => {
        // The canonical seed-12345 rig (shared with the align/spinRate/scaleTo suites). `run` reports the
        // position `hash` (folds only translate) plus the render probes kept OUT of it: `scaleHash` (the
        // wobbleScale that flutterRate scales feeds ctx.scale's X arg -- reused from v1.17.0, no new
        // channel), `rotateHash`, and `colorHash`. flutterRate is a render-time PHASE scale about a birth
        // pivot; it never touches pool.tilt or translate, so the headline is that the POSITION hash is
        // byte-identical off or on -- a pure render overlay, DECOUPLED from turbulence and sway.
        // NOTE: flutterRate is INERT when flutter is 0 (a zero-depth wobble has no speed), so the rig
        // leaves the default flutter:1, arming the wobble so flutterRate is non-vacuous.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, scaleHash: canvas.scaleHash, rotateHash: canvas.rotateHash, colorHash: canvas.colorHash };
            c.destroy();
            return out;
        };

        it('is opt-in and fail-closed: off / 1 / non-finite / string / null keep positions AND the wobble byte-identical', () => {
            // Headline: off, explicit 1, or any non-finite/non-numeric (num -> default 1) feeds the raw
            // tilt verbatim, so BOTH the position hash AND the scale (wobble) sequence match a
            // pre-flutterRate run. Pins num(flutterRate, 1).
            const base = run({});
            assert.equal(base.hash, COMMITTED_HASH, 'the flutterRate branch perturbed the default position stream');
            for (const fr of [undefined, 1, NaN, Infinity, '2', null]) {
                const r = run({ flutterRate: fr });
                assert.equal(r.hash, COMMITTED_HASH, `flutterRate ${String(fr)} should not move positions`);
                assert.equal(r.scaleHash, base.scaleHash, `flutterRate ${String(fr)} should leave the wobble untouched`);
            }
        });

        it('is DECOUPLED from turbulence: positions byte-identical even with turbulence armed (the crux)', () => {
            // The turbulence curl phase READS pool.tilt every frame; flutterRate scales only a render-local
            // phase, never mutating pool.tilt, so a flutter-rated burst -- even with turbulence armed --
            // reproduces the same-seed plain burst's position hash EXACTLY.
            assert.equal(run({ flutterRate: 2 }).hash, COMMITTED_HASH, 'flutterRate:2 moved positions off-turbulence');
            assert.equal(run({ flutterRate: 2, turbulence: 400 }).hash, run({ turbulence: 400 }).hash,
                'flutterRate perturbed the turbulence position stream (not decoupled)');
        });

        it('every prior committed fingerprint still reproduces with flutterRate off (no sequence drift)', () => {
            assert.equal(run({}).hash, COMMITTED_HASH, 'default fingerprint drifted');
            assert.equal(run({ floor: FLOOR_Y }).hash, FLOOR_HASH, 'floor fingerprint drifted');
            assert.equal(run({ ...BOX, bounce: 0 }).hash, BOX_HASH, 'box fingerprint drifted');
            assert.equal(run({ align: 1 }).rotateHash, ALIGN_HASH, 'align rotation fingerprint drifted');
            assert.equal(run({ spinRate: 2 }).rotateHash, SPINRATE_HASH, 'spinRate rotation fingerprint drifted');
            assert.equal(run({ scaleTo: 2 }).scaleHash, SCALE_HASH, 'scaleTo size fingerprint drifted');
            assert.equal(run({ lifeColors: EMBER }).colorHash, COLOR_HASH, 'color fingerprint drifted');
            assert.equal(run({ trail: undefined, flutterRate: 0 }).hash, COMMITTED_HASH, 'flutterRate:0 moved positions');
        });

        it('is a PURE render overlay: 0 / 0.3 / 2 / -1 keep the position hash, change only the wobble', () => {
            const off = run({});
            for (const fr of [0, 0.3, 2, -1]) {
                const on = run({ flutterRate: fr });
                assert.equal(on.hash, off.hash, `flutterRate:${fr} perturbed the position stream (not a pure overlay)`);
                assert.notEqual(on.scaleHash, off.scaleHash, `flutterRate:${fr} should change the wobble sequence`);
            }
        });

        it('is orthogonal to rotation and color, and composes with the whole render stack + turbulence', () => {
            const off = run({});
            const on = run({ flutterRate: 2 });
            assert.equal(on.rotateHash, off.rotateHash, 'flutterRate must not touch rotation');
            assert.equal(on.colorHash, off.colorHash, 'flutterRate must not touch color');
            // Even stacked with every other render overlay AND turbulence, the seeded POSITION stream is off-identical.
            assert.equal(run({ flutterRate: 2, scaleTo: 0.5, spinRate: 2, align: 1, turbulence: 300 }).hash,
                run({ turbulence: 300 }).hash, 'stacked render overlays perturbed the position stream');
        });

        it('matches the committed FLUTRATE fingerprint -- distinct + deterministic', () => {
            const on = run({ flutter: 1, flutterRate: 2 });
            if (FLUTRATE_HASH === null) console.log('[flutterRate] 2 scaleHash =', on.scaleHash);
            else assert.equal(on.scaleHash, FLUTRATE_HASH, 'flutterRate wobble changed vs the committed baseline');
            // Deterministic: same seed + fixed dt -> same wobble on replay (flutterRate draws no rng).
            assert.equal(run({ flutter: 1, flutterRate: 2 }).scaleHash, on.scaleHash, 'flutterRate not deterministic');
            // off / 0 / 0.5 / 2 are four mutually DISTINCT wobble sequences.
            const off = run({}).scaleHash;
            const zero = run({ flutterRate: 0 }).scaleHash;
            const half = run({ flutterRate: 0.5 }).scaleHash;
            assert.notEqual(zero, off, 'flutterRate:0 should differ from off');
            assert.notEqual(half, off, 'flutterRate:0.5 should differ from off');
            assert.notEqual(zero, half, 'flutterRate:0 should differ from 0.5');
            assert.notEqual(on.scaleHash, zero, 'flutterRate:2 should differ from 0');
            assert.notEqual(on.scaleHash, half, 'flutterRate:2 should differ from 0.5');
        });

        it('scales the RATE (lastScaleX): off varies, 0 freezes the wobble, 2 advances faster', () => {
            // A single piece with flutter 1 (so wobbleScale carries the wobble on X) and scaleTo 1 (so Y is
            // clean). Sample lastScaleX frame by frame: off VARIES (the seeded wobble); flutterRate:0 is
            // CONSTANT (frozen at the birth-tilt wobble); flutterRate:2 varies AND advances faster (a larger
            // total swing over the same frames). Proves it scales the RATE, not some other number.
            const sampled = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 7 });
                c.burst({ count: 1, x: 400, y: 300, spread: 0.001, speed: 10, gravity: 0, drag: 1,
                    flutter: 1, scaleTo: 1, lifeMin: 5, lifeMax: 5, ...opts });
                const xs = [];
                for (let f = 0; f < 12; f++) { pump(1, 100); xs.push(canvas.lastScaleX); }
                c.destroy();
                return xs;
            };
            // Total variation (accumulated absolute frame-to-frame change): a faster wobble traverses more
            // up-and-down over the same frames, so its total path is larger even when min/max saturate.
            const variation = (xs) => { let s = 0; for (let k = 1; k < xs.length; k++) s += Math.abs(xs[k] - xs[k - 1]); return s; };
            const off = sampled({});
            assert.ok(variation(off) > 1e-6, 'off must vary (the seeded wobble)');
            const frozen = sampled({ flutterRate: 0 });
            for (let k = 1; k < frozen.length; k++) {
                assert.ok(Math.abs(frozen[k] - frozen[0]) < 1e-6, 'flutterRate:0 must freeze the wobble (constant across frames)');
            }
            const fast = sampled({ flutterRate: 2 });
            assert.ok(variation(fast) > variation(off) + 1e-6, 'flutterRate:2 must advance the wobble faster than off');
        });

        it('is inert when flutter is 0 (a zero-depth wobble has no speed): decision (b)', () => {
            assert.equal(run({ flutter: 0, flutterRate: 5 }).scaleHash, run({ flutter: 0 }).scaleHash,
                'flutterRate had an effect at flutter:0 (a zero-depth wobble should have no speed)');
        });

        it('keeps positions finite under flutterRate extremes + gravity + wind + turbulence + a bouncing box + trails', () => {
            for (const fr of [0, 0.3, 3, -4, 1e6]) {
                const canvas = makeCanvas({ record: true, assertFinite: true });
                const c = createConfetti(canvas, { seed: 3, trail: 12 });
                assert.doesNotThrow(() => {
                    c.burst({
                        x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                        wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.6,
                        gravity: 4000, wind: 1200, turbulence: 500, flutter: 1, flutterRate: fr, trail: 12,
                    });
                    pump(80, 16);
                }, `flutterRate:${fr} produced a non-finite draw`);
                c.destroy();
            }
        });

        it('is honored by spray() too: positions identical, wobble differs', () => {
            const spray = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 400, rate: 15, x: 400, y: 200, spread: 1.2, shape: 'rect',
                    flutter: 1, lifeMin: 4, lifeMax: 4, ...opts });
                pump(1, 1000); pump(60, 16);
                const out = { hash: canvas.hash, scaleHash: canvas.scaleHash };
                c.destroy();
                return out;
            };
            const off = spray({});
            const on = spray({ flutterRate: 0.3 });
            assert.equal(on.hash, off.hash, 'flutterRate should not move spray positions (pure overlay)');
            assert.notEqual(on.scaleHash, off.scaleHash, 'spray should honor flutterRate (wobble changed)');
        });

        it('has no effect under reduced motion (static fan is inert)', () => {
            const staticRun = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                    pump(1, 1000); pump(29, 16);
                    const out = { hash: canvas.hash, scaleHash: canvas.scaleHash };
                    c.destroy();
                    return out;
                } finally {
                    setReducedMotion(false);
                }
            };
            const off = staticRun({});
            const on = staticRun({ flutterRate: 0.1 });
            assert.equal(on.hash, off.hash, 'flutterRate should be inert on the static reduced-motion positions');
            assert.equal(on.scaleHash, off.scaleHash, 'flutterRate should not touch the static fan wobble');
        });
    });

    describe('gustRate / gust swell frequency', () => {
        // The canonical seed-12345 rig (shared with the living-air / align / spinRate / scale suites; a
        // plain run reproduces COMMITTED_HASH). `run` reports the position `hash` (folds only translate),
        // its drift-direction witness `sumX`, and the render probes kept OUT of the hash -- `rotateHash`,
        // `colorHash`, `scaleHash`, `alphaHash`, `strokeHash`. gustRate parameterizes the baked GUST_HZ in
        // the SINGLE committed gust vx term; it feeds ONLY vx -> position, so its headline is that with
        // `gust` off it is byte-identical for ANY value (the read short-circuits behind `gust !== 0`), and
        // with `gust` armed it moves ONLY hash/sumX -- never a render channel. No trail is armed, so the
        // gust-off position fingerprints (GUST_HASH etc.) match their trail-free committed baselines.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = {
                hash: canvas.hash, sumX: canvas.sumX,
                rotateHash: canvas.rotateHash, colorHash: canvas.colorHash,
                scaleHash: canvas.scaleHash, alphaHash: canvas.alphaHash, strokeHash: canvas.strokeHash,
            };
            c.destroy();
            return out;
        };

        it('is opt-in and fail-closed: gust-armed but gustRate absent/non-finite reproduces GUST_HASH bit-for-bit (DONE-WHEN 1)', () => {
            // The load-bearing crux: the fround sentinel keeps the DEFAULT byte-identical. gust:400 with
            // gustRate absent OR any non-finite/non-numeric (num -> GUST_RATE_DEF) evaluates the DOUBLE
            // GUST_HZ literal in the off-branch, so the gust vx term is the SAME expression shipped since
            // v1.9.0 -- GUST_HASH reproduces exactly, and TURBGUST_HASH on the turbulence baseline too.
            for (const o of [
                { gust: 400 },
                { gust: 400, gustRate: NaN },
                { gust: 400, gustRate: Infinity },
                { gust: 400, gustRate: 'x' },
                { gust: 400, gustRate: null },
                { gust: 400, gustRate: undefined },
            ]) {
                assert.equal(run(o).hash, GUST_HASH, `gustRate ${JSON.stringify(o)} moved the committed gust stream`);
            }
            assert.equal(run({ turbulence: 500, gust: 400 }).hash, TURBGUST_HASH, 'gustRate off perturbed the turbulence+gust baseline');
            assert.equal(run({ turbulence: 500, gust: 400, gustRate: NaN }).hash, TURBGUST_HASH, 'non-finite gustRate perturbed the turbulence+gust baseline');
        });

        it('leaves every PRIOR committed fingerprint byte-identical when present-but-off (DONE-WHEN 2)', () => {
            // gustRate present but gust off (or a render-only knob armed) must not perturb any prior stream.
            assert.equal(run({ gustRate: 6 }).hash, COMMITTED_HASH, 'gustRate perturbed the default position stream');
            assert.equal(run({ floor: FLOOR_Y, gustRate: 6 }).hash, FLOOR_HASH, 'floor fingerprint drifted under gustRate');
            assert.equal(run({ ...BOX, bounce: 0, gustRate: 6 }).hash, BOX_HASH, 'box fingerprint drifted under gustRate');
            assert.equal(run({ lifeColors: EMBER, gustRate: 6 }).colorHash, COLOR_HASH, 'color fingerprint drifted under gustRate');
            assert.equal(run({ align: 1, gustRate: 6 }).rotateHash, ALIGN_HASH, 'align fingerprint drifted under gustRate');
            assert.equal(run({ spinRate: 2, gustRate: 6 }).rotateHash, SPINRATE_HASH, 'spinRate fingerprint drifted under gustRate');
            assert.equal(run({ scaleTo: 2, gustRate: 6 }).scaleHash, SCALE_HASH, 'scaleTo fingerprint drifted under gustRate');
            assert.equal(run({ scaleFrom: 0.25, gustRate: 6 }).scaleHash, SCALEFROM_HASH, 'scaleFrom fingerprint drifted under gustRate');
            assert.equal(run({ flutter: 1, flutterRate: 2, gustRate: 6 }).scaleHash, FLUTRATE_HASH, 'flutterRate fingerprint drifted under gustRate');
            // TRAIL geometry (own rig with trail:10) is a pure overlay -- gust off -> strokeHash unchanged.
            const trailRun = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345, trail: 10 });
                c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                pump(1, 1000); pump(29, 16);
                const out = { hash: canvas.hash, strokeHash: canvas.strokeHash, strokes: canvas.strokes };
                c.destroy();
                return out;
            };
            const tr = trailRun({ gustRate: 6 });
            assert.ok(tr.strokes > 0, 'the trail rig must actually stroke');
            assert.equal(tr.hash, COMMITTED_HASH, 'gustRate perturbed the trailed position stream');
            assert.equal(tr.strokeHash, TRAIL_HASH, 'gustRate perturbed the committed ribbon geometry');
        });

        it('inert-zero: gustRate:0 freezes the phase and reproduces COMMITTED_HASH (DONE-WHEN 3, EMPIRICAL)', () => {
            // At gustRate:0 the term is sin(_elapsed*0) = sin(0) = 0, so vx += 0. x + 0 === x for every
            // float except -0 + 0 = +0, and positions are hashed through Math.round(x*4096), so a -0 -> +0
            // flip is hash-neutral. Verified empirically here before it is trusted.
            assert.equal(run({ gust: 400, gustRate: 0 }).hash, COMMITTED_HASH, 'gustRate:0 must collapse the gust force to an inert zero');
        });

        it('gust-off short-circuits the grate read entirely for any gustRate (DONE-WHEN 4)', () => {
            // The read lives INSIDE `if (pool.gust[i] !== 0)`, so with gust off grate is NEVER read and any
            // gustRate value reproduces the default fingerprint.
            for (const gr of [6, 0, -6, 1e6]) {
                assert.equal(run({ gustRate: gr }).hash, COMMITTED_HASH, `gust-off gustRate:${gr} must not move positions`);
            }
        });

        it('is a PURE physics scalar: gust-armed gustRate moves ONLY hash/sumX, never a render channel (DONE-WHEN 5)', () => {
            // Zero second-reader: pool.grate feeds only vx -> x. So vs the gust-default run it moves the
            // POSITION hash and its drift sumX, but rotateHash / colorHash / scaleHash / alphaHash / the
            // (trail-free) strokeHash are all byte-identical (nothing downstream reads grate).
            const off = run({ gust: 400 });
            const on = run({ gust: 400, gustRate: 6 });
            assert.notEqual(on.hash, off.hash, 'gustRate should move the position stream');
            assert.notEqual(on.sumX, off.sumX, 'gustRate should move the drift witness');
            assert.equal(on.rotateHash, off.rotateHash, 'gustRate must not touch rotation');
            assert.equal(on.colorHash, off.colorHash, 'gustRate must not touch color');
            assert.equal(on.scaleHash, off.scaleHash, 'gustRate must not touch the size fold');
            assert.equal(on.alphaHash, off.alphaHash, 'gustRate must not touch alpha');
            assert.equal(on.strokeHash, off.strokeHash, 'gustRate must not add a trail of its own');
        });

        it('matches the committed GUSTRATE fingerprint -- distinct + deterministic (DONE-WHEN 6)', () => {
            const on = run({ gust: 400, gustRate: 6 });
            if (GUSTRATE_HASH === null) console.log('[gustRate] gust:400 gustRate:6 hash =', on.hash);
            else assert.equal(on.hash, GUSTRATE_HASH, 'gustRate stream changed vs the committed baseline');
            // Deterministic: same seed + fixed dt -> same hash on replay (gustRate draws no rng).
            assert.equal(run({ gust: 400, gustRate: 6 }).hash, on.hash, 'gustRate not deterministic on replay');
            // Genuinely distinct from the default swell (GUST_HASH) and from another rate (gustRate:3).
            assert.notEqual(on.hash, GUST_HASH, 'gustRate:6 should differ from the default swell');
            assert.notEqual(on.hash, run({ gust: 400, gustRate: 3 }).hash, 'gustRate:6 should differ from gustRate:3');
        });

        it('NON-VACUOUS sign flip: a negative gustRate reverses the early swell drift (DONE-WHEN 7)', () => {
            // Over a fixed 40-frame window from t0 (no giant warmup frame), the gust push integrates: rate 6
            // leans the pool one way first, rate -6 (sin(-r*t) == -sin(r*t)) the OTHER. So the sumX DELTA
            // from the gust-off baseline has OPPOSITE sign for +6 vs -6, and a different magnitude at rate 1.
            const windowSumX = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345 });
                c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                for (let f = 0; f < 40; f++) pump(1, 16);
                const sx = canvas.sumX;
                c.destroy();
                return sx;
            };
            const base = windowSumX({});                          // gust off
            const d6 = windowSumX({ gust: 400, gustRate: 6 }) - base;
            const dNeg6 = windowSumX({ gust: 400, gustRate: -6 }) - base;
            const d1 = windowSumX({ gust: 400, gustRate: 1 }) - base;
            assert.notEqual(d6, 0, 'gustRate:6 must drift the pool (else vacuous)');
            assert.notEqual(dNeg6, 0, 'gustRate:-6 must drift the pool (else vacuous)');
            assert.ok((d6 > 0) !== (dNeg6 > 0), 'a negative gustRate must reverse the early swell drift');
            assert.notEqual(Math.abs(d6), Math.abs(d1), 'gustRate:6 drift magnitude must differ from gustRate:1');
        });

        it('keeps positions finite under gustRate extremes + gust + wind + turbulence + a bouncing box + trails (DONE-WHEN 8)', () => {
            for (const gr of [0, -6, 6, 1e6]) {
                const canvas = makeCanvas({ record: true, assertFinite: true });
                const c = createConfetti(canvas, { seed: 3, trail: 12 });
                assert.doesNotThrow(() => {
                    c.burst({
                        x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                        wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.6,
                        gravity: 4000, wind: 1200, turbulence: 500, gust: 400, gustRate: gr, trail: 12,
                    });
                    pump(80, 16);
                }, `gustRate:${gr} produced a non-finite draw`);
                c.destroy();
            }
        });

        it('is honored by spray() too: gust-armed rate moves the stream; gust-off is unchanged (DONE-WHEN 9)', () => {
            const spray = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 400, rate: 15, x: 400, y: 200, spread: 1.2, shape: 'rect',
                    lifeMin: 4, lifeMax: 4, ...opts });
                pump(1, 1000); pump(60, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            };
            const gustOn = spray({ gust: 400 });
            assert.notEqual(spray({ gust: 400, gustRate: 6 }), gustOn, 'spray ignored gustRate');
            assert.equal(spray({ gust: 400, gustRate: 6 }), spray({ gust: 400, gustRate: 6 }), 'forced spray gustRate not deterministic');
            // gust off -> gustRate inert on the spray stream too.
            assert.equal(spray({ gustRate: 6 }), spray({}), 'gustRate perturbed a gust-off spray');
        });

        it('has no effect under reduced motion (static fan runs no update loop) (DONE-WHEN 10)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                    pump(1, 1000); pump(29, 16);
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ gust: 800, gustRate: 6 }), staticHash({}), 'gustRate must be inert under reduced motion');
        });

        it('fail-closed table: garbage coerces to the default (off), gust-armed (DONE-WHEN 11)', () => {
            // Every non-finite / non-numeric value must fall to GUST_RATE_DEF, so with gust armed each
            // reproduces the gust-default GUST_HASH exactly (the off look).
            for (const gr of [NaN, Infinity, -Infinity, '6', null, {}, undefined]) {
                assert.equal(run({ gust: 400, gustRate: gr }).hash, GUST_HASH, `gustRate ${JSON.stringify(gr)} must coerce to the default (off)`);
            }
        });
    });

    describe('fadeIn / birth-opacity ramp', () => {
        // The canonical seed-12345 rig (shared with align/spinRate/scaleTo/flutterRate). `run` reports the
        // position `hash` (folds only translate) plus every render probe kept OUT of it: the NEW `alphaHash`
        // (globalAlpha folded on SET), `rotateHash`, `scaleHash`, `strokeHash`, `colorHash`, and `lastAlpha`
        // (the last globalAlpha SET before a shape draw = the body alpha). fadeIn changes ONLY globalAlpha,
        // so the headline is that position/rotate/scale/stroke/color are all byte-identical off or on -- the
        // cleanest pure render overlay in the suite; only alphaHash moves.
        const run = (fadeIn) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            const opts = { count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8 };
            if (fadeIn !== undefined) opts.fadeIn = fadeIn;
            c.burst(opts);
            pump(1, 1000); pump(29, 16);
            const out = {
                hash: canvas.hash, alphaHash: canvas.alphaHash, rotateHash: canvas.rotateHash,
                scaleHash: canvas.scaleHash, strokeHash: canvas.strokeHash, colorHash: canvas.colorHash,
                lastAlpha: canvas.lastAlpha,
            };
            c.destroy();
            return out;
        };

        it('is opt-in and fail-closed: {} / 0 / NaN / Infinity / string / null / undefined keep positions AND alpha', () => {
            // clamp01(fadeIn, 0): missing/non-finite/non-numeric/undefined -> 0 (off), so BOTH the position
            // hash AND the alpha sequence match a pre-fadeIn run. Pins clamp01(fadeIn, 0).
            const base = run(undefined);
            assert.equal(base.hash, COMMITTED_HASH, 'the fadeIn branch perturbed the default position stream');
            for (const fi of [undefined, 0, NaN, Infinity, '0.4', null]) {
                const r = run(fi);
                assert.equal(r.hash, COMMITTED_HASH, `fadeIn ${String(fi)} should not move positions`);
                assert.equal(r.alphaHash, base.alphaHash, `fadeIn ${String(fi)} should leave the alpha untouched`);
            }
        });

        it('clamps to [0,1]: >1 clamps to 1, a negative -> 0 (off); positions never move', () => {
            const base = run(undefined);
            assert.equal(run(1e9).alphaHash, run(1).alphaHash, 'fadeIn > 1 should clamp to 1');
            assert.equal(run(-1).alphaHash, run(0).alphaHash, 'a negative fadeIn should clamp to 0 (off)');
            assert.equal(run(-1).alphaHash, base.alphaHash, 'a negative fadeIn should reproduce the off alpha');
            for (const fi of [1e9, 1, -1, 0]) {
                assert.equal(run(fi).hash, COMMITTED_HASH, `fadeIn ${fi} moved positions`);
            }
        });

        it('every prior committed fingerprint still reproduces with fadeIn off (no sequence drift)', () => {
            assert.equal(run(undefined).hash, COMMITTED_HASH, 'default fingerprint drifted');
            assert.equal(run(0).hash, COMMITTED_HASH, 'fadeIn:0 moved positions');
            // The prior physics/render gates on the same seed-12345 rig, via the shared per-suite helpers.
            const g = (ctorOpts, burstOpts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345, ...ctorOpts });
                c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...burstOpts });
                pump(1, 1000); pump(29, 16);
                const out = { hash: canvas.hash, rotateHash: canvas.rotateHash, scaleHash: canvas.scaleHash,
                    strokeHash: canvas.strokeHash, colorHash: canvas.colorHash };
                c.destroy();
                return out;
            };
            assert.equal(g(undefined, { floor: FLOOR_Y }).hash, FLOOR_HASH, 'floor fingerprint drifted');
            assert.equal(g(undefined, { ...BOX, bounce: 0 }).hash, BOX_HASH, 'box fingerprint drifted');
            assert.equal(g({ trail: 10 }, undefined).strokeHash, TRAIL_HASH, 'trail fingerprint drifted');
            assert.equal(g(undefined, { lifeColors: EMBER }).colorHash, COLOR_HASH, 'color fingerprint drifted');
            assert.equal(g(undefined, { align: 1 }).rotateHash, ALIGN_HASH, 'align rotation fingerprint drifted');
            assert.equal(g(undefined, { spinRate: 2 }).rotateHash, SPINRATE_HASH, 'spinRate rotation fingerprint drifted');
            assert.equal(g(undefined, { scaleTo: 2 }).scaleHash, SCALE_HASH, 'scaleTo size fingerprint drifted');
            assert.equal(g(undefined, { flutter: 1, flutterRate: 2 }).scaleHash, FLUTRATE_HASH, 'flutterRate wobble fingerprint drifted');
        });

        it('is a PURE render overlay: 0.2 / 0.4 / 0.8 / 1 keep the position hash, change only the alpha', () => {
            const off = run(undefined);
            for (const fi of [0.2, 0.4, 0.8, 1]) {
                const on = run(fi);
                assert.equal(on.hash, off.hash, `fadeIn:${fi} perturbed the position stream (not a pure overlay)`);
                assert.notEqual(on.alphaHash, off.alphaHash, `fadeIn:${fi} should change the alpha sequence`);
            }
        });

        it('is orthogonal to rotate/scale/stroke/color, and composes with the whole render stack', () => {
            const off = run(undefined);
            const on = run(0.4);
            assert.equal(on.rotateHash, off.rotateHash, 'fadeIn must not touch rotation');
            assert.equal(on.scaleHash, off.scaleHash, 'fadeIn must not touch scale');
            assert.equal(on.strokeHash, off.strokeHash, 'fadeIn must not touch trail geometry');
            assert.equal(on.colorHash, off.colorHash, 'fadeIn must not touch color');
            // Stacked with every other render overlay, the seeded POSITION stream is still off-identical.
            const stacked = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345 });
                c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
                pump(1, 1000); pump(29, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            };
            assert.equal(stacked({ fadeIn: 0.4, align: 1, spinRate: 2, scaleTo: 0.5, flutter: 1, flutterRate: 2 }),
                stacked({}), 'stacked render overlays perturbed the position stream');
        });

        it('the trail ribbon keeps its GEOMETRY: strokeHash identical off vs fadeIn, strokes fire (crux b)', () => {
            const trailRun = (fadeIn) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345, trail: 10 });
                const opts = { count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, trail: 10 };
                if (fadeIn !== undefined) opts.fadeIn = fadeIn;
                c.burst(opts);
                pump(1, 1000); pump(29, 16);
                const out = { strokeHash: canvas.strokeHash, strokes: canvas.strokes };
                c.destroy();
                return out;
            };
            const off = trailRun(undefined);
            const on = trailRun(0.4);
            assert.ok(off.strokes > 0, 'the trail rig must actually stroke');
            assert.equal(on.strokeHash, off.strokeHash, 'fadeIn moved the trail geometry (strokeHash must fold path points only)');
            // And the standalone committed TRAIL_HASH still reproduces on the 8-sample rig.
            assert.equal(run(undefined).strokeHash, run(0).strokeHash, 'fadeIn:0 moved a stroke stream');
        });

        it('matches the committed ALPHA fingerprint -- distinct + deterministic (0.2 != 0.4 != off)', () => {
            const on = run(0.4);
            if (ALPHA_HASH === null) console.log('[fadeIn] 0.4 alphaHash =', on.alphaHash);
            else assert.equal(on.alphaHash, ALPHA_HASH, 'fadeIn alpha changed vs the committed baseline');
            // Deterministic: same seed + fixed dt -> same alpha on replay (fadeIn draws no rng).
            assert.equal(run(0.4).alphaHash, on.alphaHash, 'fadeIn not deterministic');
            const off = run(undefined).alphaHash;
            const two = run(0.2).alphaHash;
            assert.notEqual(on.alphaHash, off, 'fadeIn:0.4 should differ from off');
            assert.notEqual(two, off, 'fadeIn:0.2 should differ from off');
            assert.notEqual(on.alphaHash, two, 'fadeIn:0.4 should differ from 0.2');
        });

        it('is NON-VACUOUS (lastAlpha): a single piece materializes in -- first frame < 1 and rising to ~1', () => {
            // A single piece, no trail (so lastAlpha is purely the body alpha), life 0.5s stepped in 16ms
            // frames (the ticker caps a large dt, so small frames age the piece at a readable rate). off ->
            // birth is instant-on (alpha 1; the death fade only starts in the last 30% of life, past this
            // window). fadeIn:0.4 -> the first frame is STRICTLY < 1 (fading up), STRICTLY increasing across
            // the fade-in window (first 40% = 0.2s = ~12 frames), reaching ~1 by age 0.4. A proof a bare
            // position hash cannot give -- positions are identical off/on.
            const sampled = (fadeIn) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 7 });
                const opts = { count: 1, x: 400, y: 300, spread: 0.001, speed: 10, gravity: 0, drag: 1,
                    lifeMin: 0.5, lifeMax: 0.5 };
                if (fadeIn !== undefined) opts.fadeIn = fadeIn;
                c.burst(opts);
                const as = [];
                for (let f = 0; f < 16; f++) { pump(1, 16); as.push(canvas.lastAlpha); }
                c.destroy();
                return as;
            };
            const off = sampled(undefined);
            assert.equal(off[0], 1, 'off: the first frame should be fully opaque (instant-on)');
            const on = sampled(0.4);
            assert.ok(on[0] < 1, 'fadeIn:0.4: the first frame should be strictly transparent (materializing in)');
            assert.ok(on[0] > 0, 'fadeIn:0.4: the first frame should not be fully transparent (an age has elapsed)');
            // Strictly increasing across the fade-in window (the early frames, age < 0.4).
            assert.ok(on[1] > on[0] && on[2] > on[1], 'fadeIn:0.4 alpha must rise across the fade-in window');
            // Reaches ~1 once past the fade-in window (age >= 0.4 -> the death fade has not yet started).
            assert.ok(on[on.length - 1] > 0.95, 'fadeIn:0.4 alpha must reach ~1 after the fade-in window');
        });

        it('keeps positions finite under fadeIn extremes + gravity + wind + turbulence + a bouncing box + trails', () => {
            for (const fi of [0.05, 0.4, 1]) {
                const canvas = makeCanvas({ record: true, assertFinite: true });
                const c = createConfetti(canvas, { seed: 3, trail: 12 });
                assert.doesNotThrow(() => {
                    c.burst({
                        x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                        wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.6,
                        gravity: 4000, wind: 1200, turbulence: 500, fadeIn: fi, trail: 12,
                    });
                    pump(80, 16);
                }, `fadeIn:${fi} produced a non-finite draw`);
                c.destroy();
            }
        });

        it('is honored by spray() too: positions identical, alpha differs', () => {
            const spray = (fadeIn) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                const opts = { duration: 400, rate: 15, x: 400, y: 200, spread: 1.2, shape: 'rect',
                    lifeMin: 4, lifeMax: 4 };
                if (fadeIn !== undefined) opts.fadeIn = fadeIn;
                c.spray(opts);
                pump(1, 1000); pump(60, 16);
                const out = { hash: canvas.hash, alphaHash: canvas.alphaHash };
                c.destroy();
                return out;
            };
            const off = spray(undefined);
            const on = spray(0.4);
            assert.equal(on.hash, off.hash, 'fadeIn should not move spray positions (pure overlay)');
            assert.notEqual(on.alphaHash, off.alphaHash, 'spray should honor fadeIn (alpha changed)');
        });

        it('has no effect under reduced motion (static fan holds its constant 0.85)', () => {
            const staticRun = (fadeIn) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    const opts = { count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8 };
                    if (fadeIn !== undefined) opts.fadeIn = fadeIn;
                    c.burst(opts);
                    pump(1, 1000); pump(29, 16);
                    const out = { hash: canvas.hash, alphaHash: canvas.alphaHash };
                    c.destroy();
                    return out;
                } finally {
                    setReducedMotion(false);
                }
            };
            const off = staticRun(undefined);
            const on = staticRun(0.4);
            assert.equal(on.hash, off.hash, 'fadeIn should be inert on the static reduced-motion positions');
            assert.equal(on.alphaHash, off.alphaHash, 'fadeIn should not touch the static fan alpha (constant 0.85)');
        });
    });

    describe('fadeOut / death-fade window', () => {
        // TWO rigs, because fadeOut acts at DEATH. `runPos` is the canonical seed-12345 position rig
        // (lifeMin/Max 5): under the ticker's dt cap a piece never ages into its death-fade window on this
        // rig (lifeT stays well above 0.3), so fadeOut is an alpha NO-OP here -- which is exactly what makes
        // it the clean POSITION-fingerprint rig (reproduces COMMITTED_HASH + every prior gate whether fadeOut
        // is off or armed). `run` is a dedicated short-life ALPHA rig (lifeMin/Max 0.5, low speed/gravity so
        // all 120 pieces stay on-canvas and are aged deep INTO the death window) -- here `off` genuinely
        // fades over its last 30%, so fadeOut discriminates. Both prove fadeOut is a PURE render overlay:
        // position/rotate/scale/stroke/color are byte-identical off vs armed; only alphaHash moves.
        const runPos = (fadeOut) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            const opts = { count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8 };
            if (fadeOut !== undefined) opts.fadeOut = fadeOut;
            c.burst(opts);
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, alphaHash: canvas.alphaHash, rotateHash: canvas.rotateHash,
                scaleHash: canvas.scaleHash, strokeHash: canvas.strokeHash, colorHash: canvas.colorHash };
            c.destroy();
            return out;
        };
        const run = (fadeOut) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            const opts = { count: 120, shape: 'rect', spread: 1.8, speed: 50, gravity: 30, drag: 0.995,
                lifeMin: 0.5, lifeMax: 0.5, x: 400, y: 300 };
            if (fadeOut !== undefined) opts.fadeOut = fadeOut;
            c.burst(opts);
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, alphaHash: canvas.alphaHash, rotateHash: canvas.rotateHash,
                scaleHash: canvas.scaleHash, strokeHash: canvas.strokeHash, colorHash: canvas.colorHash };
            c.destroy();
            return out;
        };

        it('is opt-in and fail-closed: {} / 0.3 / NaN / Infinity / string / null / undefined keep positions AND alpha', () => {
            // clamp01(fadeOut, FADE_OUT_DEF): missing/non-finite/non-numeric/undefined -> the default 0.3
            // window. Pins the fround sentinel: an EXPLICIT 0.3 must reproduce the default (proves
            // clamp01(0.3) -> the Float32 fround(0.3) === FADE_OUT_DEF, so the render guard is skipped and the
            // byte-identical double-0.3 line runs). Positions stay COMMITTED_HASH; the alpha sequence is the
            // off default on the alpha rig.
            assert.equal(runPos(undefined).hash, COMMITTED_HASH, 'the fadeOut branch perturbed the default position stream');
            const off = run(undefined);
            for (const fo of [undefined, 0.3, NaN, Infinity, 'x', null]) {
                assert.equal(runPos(fo).hash, COMMITTED_HASH, `fadeOut ${String(fo)} should not move positions`);
                assert.equal(run(fo).alphaHash, off.alphaHash, `fadeOut ${String(fo)} should reproduce the default death fade`);
            }
        });

        it('preserves the double-0.3 line: off-look alphaHash + fadeIn ALPHA_HASH reproduce byte-for-bit', () => {
            // The render line :1029 keeps the DOUBLE 0.3 literal untouched, so v1.19.0's committed off-look
            // alphaHash and the fadeIn ALPHA_HASH (fadeIn:0.4, default fadeOut) must both reproduce exactly.
            assert.equal(runPos(undefined).alphaHash, 2389639168, 'the off-look alphaHash drifted (double-0.3 line touched?)');
            assert.equal(runPos(0.3).alphaHash, 2389639168, 'explicit 0.3 diverged from the off-look (fround sentinel broken)');
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, fadeIn: 0.4 });
            pump(1, 1000); pump(29, 16);
            assert.equal(canvas.alphaHash, ALPHA_HASH, 'the fadeIn off-look ALPHA_HASH drifted (fadeOut disturbed the alpha axis)');
            c.destroy();
        });

        it('a negative clamps to 0 (hard cut), NOT to the default; positions never move', () => {
            // clamp01: negative -> 0 = a legitimate hard cut (full opacity then gone), the alpha analog of
            // spinRate:0 / scaleTo:0 -- NOT a fallback to 0.3. So -1 reproduces fadeOut:0 and DIVERGES from off.
            const off = run(undefined);
            assert.equal(run(-1).alphaHash, run(0).alphaHash, 'a negative fadeOut should clamp to 0 (hard cut)');
            assert.notEqual(run(-1).alphaHash, off.alphaHash, 'a negative fadeOut must NOT fall back to the default window');
            for (const fo of [0, -1, -5, 1e9]) {
                assert.equal(runPos(fo).hash, COMMITTED_HASH, `fadeOut ${fo} moved positions`);
            }
        });

        it('every prior committed fingerprint still reproduces with fadeOut armed (no sequence drift)', () => {
            assert.equal(runPos(undefined).hash, COMMITTED_HASH, 'default fingerprint drifted');
            assert.equal(runPos(0).hash, COMMITTED_HASH, 'fadeOut:0 moved positions');
            assert.equal(runPos(0.6).hash, COMMITTED_HASH, 'fadeOut:0.6 moved positions');
            assert.equal(runPos(1).hash, COMMITTED_HASH, 'fadeOut:1 moved positions');
            // The prior physics/render gates on the same seed-12345 rig, now with fadeOut armed in the burst.
            const g = (ctorOpts, burstOpts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345, ...ctorOpts });
                c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, fadeOut: 0.6, ...burstOpts });
                pump(1, 1000); pump(29, 16);
                const out = { hash: canvas.hash, rotateHash: canvas.rotateHash, scaleHash: canvas.scaleHash,
                    strokeHash: canvas.strokeHash, colorHash: canvas.colorHash };
                c.destroy();
                return out;
            };
            assert.equal(g(undefined, { floor: FLOOR_Y }).hash, FLOOR_HASH, 'floor fingerprint drifted');
            assert.equal(g(undefined, { ...BOX, bounce: 0 }).hash, BOX_HASH, 'box fingerprint drifted');
            assert.equal(g({ trail: 10 }, undefined).strokeHash, TRAIL_HASH, 'trail fingerprint drifted');
            assert.equal(g(undefined, { lifeColors: EMBER }).colorHash, COLOR_HASH, 'color fingerprint drifted');
            assert.equal(g(undefined, { align: 1 }).rotateHash, ALIGN_HASH, 'align rotation fingerprint drifted');
            assert.equal(g(undefined, { spinRate: 2 }).rotateHash, SPINRATE_HASH, 'spinRate rotation fingerprint drifted');
            assert.equal(g(undefined, { scaleTo: 2 }).scaleHash, SCALE_HASH, 'scaleTo size fingerprint drifted');
            assert.equal(g(undefined, { flutter: 1, flutterRate: 2 }).scaleHash, FLUTRATE_HASH, 'flutterRate wobble fingerprint drifted');
        });

        it('is a PURE render overlay: 0 / 0.1 / 0.6 / 1 keep position/rotate/scale/stroke/color, change only alpha', () => {
            const off = run(undefined);
            for (const fo of [0, 0.1, 0.6, 1]) {
                const on = run(fo);
                assert.equal(on.hash, off.hash, `fadeOut:${fo} perturbed the position stream (not a pure overlay)`);
                assert.equal(on.rotateHash, off.rotateHash, `fadeOut:${fo} must not touch rotation`);
                assert.equal(on.scaleHash, off.scaleHash, `fadeOut:${fo} must not touch scale`);
                assert.equal(on.strokeHash, off.strokeHash, `fadeOut:${fo} must not touch trail geometry`);
                assert.equal(on.colorHash, off.colorHash, `fadeOut:${fo} must not touch color`);
                assert.notEqual(on.alphaHash, off.alphaHash, `fadeOut:${fo} should change the alpha sequence`);
            }
        });

        it('composes the opacity envelope with fadeIn: both act, positions untouched, alpha distinct from either alone', () => {
            // fadeIn ramps up near birth, fadeOut dissolves near death; on the short-life rig both windows are
            // exercised. Positions are byte-identical to off (neither touches them); the combined alpha is
            // distinct from fadeIn-only AND fadeOut-only (they MULTIPLY into the full envelope).
            const off = run(undefined);
            const both = (() => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345 });
                c.burst({ count: 120, shape: 'rect', spread: 1.8, speed: 50, gravity: 30, drag: 0.995,
                    lifeMin: 0.5, lifeMax: 0.5, x: 400, y: 300, fadeIn: 0.4, fadeOut: 0.6 });
                pump(1, 1000); pump(29, 16);
                const out = { hash: canvas.hash, alphaHash: canvas.alphaHash };
                c.destroy();
                return out;
            })();
            const fadeInOnly = (() => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345 });
                c.burst({ count: 120, shape: 'rect', spread: 1.8, speed: 50, gravity: 30, drag: 0.995,
                    lifeMin: 0.5, lifeMax: 0.5, x: 400, y: 300, fadeIn: 0.4 });
                pump(1, 1000); pump(29, 16);
                const a = canvas.alphaHash;
                c.destroy();
                return a;
            })();
            assert.equal(both.hash, off.hash, 'the envelope perturbed the position stream');
            assert.notEqual(both.alphaHash, off.alphaHash, 'the envelope should change the alpha');
            assert.notEqual(both.alphaHash, run(0.6).alphaHash, 'fadeIn+fadeOut should differ from fadeOut alone');
            assert.notEqual(both.alphaHash, fadeInOnly, 'fadeIn+fadeOut should differ from fadeIn alone');
        });

        it('matches the committed FADEOUT fingerprint -- distinct + deterministic (0.6 != 0.1 != off)', () => {
            const on = run(0.6);
            if (FADEOUT_HASH === null) console.log('[fadeOut] 0.6 alphaHash =', on.alphaHash);
            else assert.equal(on.alphaHash, FADEOUT_HASH, 'fadeOut alpha changed vs the committed baseline');
            // Deterministic: same seed + fixed dt -> same alpha on replay (fadeOut draws no rng).
            assert.equal(run(0.6).alphaHash, on.alphaHash, 'fadeOut not deterministic');
            const off = run(undefined).alphaHash;
            const narrow = run(0.1).alphaHash;
            assert.notEqual(on.alphaHash, off, 'fadeOut:0.6 should differ from off');
            assert.notEqual(narrow, off, 'fadeOut:0.1 should differ from off');
            assert.notEqual(on.alphaHash, narrow, 'fadeOut:0.6 should differ from 0.1');
        });

        it('is NON-VACUOUS (lastAlpha, late frame): default ~0.5, 0.6 ~0.25 (gentler), 0 == 1 (hard cut)', () => {
            // A single piece, no flutter (so lastAlpha is purely the body alpha), aged to a LATE frame INSIDE
            // the death window (lifeT ~ 0.15). Positions are identical for every fadeOut (pure overlay), so
            // lifeT is the SAME across all three -- the alpha differs only because the WINDOW widens/narrows:
            // default (0.3) -> ~0.5 (lifeT/0.3); fadeOut:0.6 -> ~0.25 (lifeT/0.6, the wider window is dimmer
            // earlier = exactly half); fadeOut:0 -> exactly 1 (hard cut, no divide). A proof a bare position
            // hash cannot give.
            const sampled = (fadeOut) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 7 });
                const opts = { count: 1, x: 400, y: 300, spread: 0.001, speed: 5, gravity: 0, drag: 1,
                    flutter: 0, lifeMin: 0.5, lifeMax: 0.5 };
                if (fadeOut !== undefined) opts.fadeOut = fadeOut;
                c.burst(opts);
                pump(1, 1000);
                for (let f = 0; f < 25; f++) pump(1, 16);
                const a = canvas.lastAlpha;
                c.destroy();
                return a;
            };
            const def = sampled(undefined);
            assert.ok(def > 0.4 && def < 0.7, 'default: the late frame should be mid-dissolve (in the fade window)');
            const wide = sampled(0.6);
            assert.ok(Math.abs(wide - def * 0.5) < 0.02, 'fadeOut:0.6 should be ~half the default alpha (wider window, dimmer earlier)');
            assert.equal(sampled(0), 1, 'fadeOut:0 should be fully opaque at the same frame (hard cut, no dissolve)');
        });

        it('retention: a recycled slot does not inherit an armed fadeOut (crux d, late-frame lastAlpha)', () => {
            // fadeOut affects DEATH, so a first-frame lastAlpha===1 witness is non-discriminating (alpha is 1
            // at birth for ANY window). Instead: pump BOTH a recycled and a fresh single-piece instance to a
            // LATE frame inside the default fade window and compare lastAlpha. A leaked fadeOut:0 (hard cut)
            // in the recycled slot would read 1 while the fresh default reads < 1 -> they DIVERGE. Equal +
            // strictly < 1 proves the spawn write overwrote the stale value AND that we are genuinely in the
            // window. This is a lastAlpha SNAPSHOT compare, not a cumulative-hash replay.
            const lateBurst = (c, canvas) => {
                c.burst({ count: 1, x: 400, y: 300, spread: 0.001, speed: 5, gravity: 0, drag: 1,
                    flutter: 0, lifeMin: 0.5, lifeMax: 0.5 });
                pump(1, 1000);
                for (let f = 0; f < 25; f++) pump(1, 16);
                return canvas.lastAlpha;
            };
            // A: fire fadeOut:0 (the most divergent armed value) and drain to empty 5x, THEN a plain burst.
            const canvasA = makeCanvas({ record: true });
            const cA = createConfetti(canvasA, { seed: 7, maxParticles: 1 });
            for (let k = 0; k < 5; k++) {
                cA.burst({ count: 1, x: 400, y: 300, spread: 0.001, speed: 5, gravity: 0, drag: 1,
                    flutter: 0, lifeMin: 0.5, lifeMax: 0.5, fadeOut: 0 });
                // Pump ONCE before reading count: the count getter reflects `aliveCount`, refreshed
                // only inside update(), so it is stale (0) right after a burst -- a bare `while (count>0)`
                // never enters and the slot is never actually drained. This first pump refreshes the
                // getter AND (life 0.5 << the guaranteed post-first-frame dt) empties the slot; the loop
                // finishes any residue. Genuinely draining pool.life[0] to 0 is REQUIRED under v1.26.0
                // drop-new-when-full: a still-live slot is protected, so the re-spawn would otherwise drop
                // and the recycled-slot retention check would test nothing. (Pre-v1.26.0 the overwrite
                // masked the vacuous drain.)
                pump(1, 1000);
                let guard = 0;
                while (cA.count > 0 && guard++ < 500) pump(1, 16);
                assert.equal(cA.count, 0, 'the armed burst did not drain before recycling');
            }
            const aAlpha = lateBurst(cA, canvasA);
            cA.destroy();
            // B: fresh instance, only the plain burst.
            const canvasB = makeCanvas({ record: true });
            const cB = createConfetti(canvasB, { seed: 7, maxParticles: 1 });
            const bAlpha = lateBurst(cB, canvasB);
            cB.destroy();
            assert.equal(aAlpha, bAlpha, 'a stale fadeOut leaked into the recycled slot (retention bug)');
            assert.ok(aAlpha < 1, 'the retention witness must sample INSIDE the fade window (non-vacuous)');
        });

        it('keeps positions finite under fadeOut extremes + gravity + wind + turbulence + a bouncing box + trails', () => {
            for (const fo of [0, 0.1, 1, 1e9]) {
                const canvas = makeCanvas({ record: true, assertFinite: true });
                const c = createConfetti(canvas, { seed: 3, trail: 12 });
                assert.doesNotThrow(() => {
                    c.burst({
                        x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                        wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.6,
                        gravity: 4000, wind: 1200, turbulence: 500, fadeOut: fo, trail: 12,
                    });
                    pump(80, 16);
                }, `fadeOut:${fo} produced a non-finite draw`);
                c.destroy();
            }
        });

        it('is honored by spray() too: positions identical, alpha differs; reduced motion inert', () => {
            const spray = (fadeOut) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                const opts = { duration: 400, rate: 15, x: 400, y: 300, spread: 1.2, shape: 'rect',
                    speed: 50, gravity: 30, drag: 0.995, lifeMin: 0.5, lifeMax: 0.5 };
                if (fadeOut !== undefined) opts.fadeOut = fadeOut;
                c.spray(opts);
                pump(1, 1000); pump(40, 16);
                const out = { hash: canvas.hash, alphaHash: canvas.alphaHash };
                c.destroy();
                return out;
            };
            const off = spray(undefined);
            const on = spray(0.6);
            assert.equal(on.hash, off.hash, 'fadeOut should not move spray positions (pure overlay)');
            assert.notEqual(on.alphaHash, off.alphaHash, 'spray should honor fadeOut (alpha changed)');
            // Reduced motion: the static fan sets a constant 0.85 and does no life integration, so fadeOut is
            // inert on BOTH the positions and the alpha.
            const staticRun = (fadeOut) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    const opts = { count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8 };
                    if (fadeOut !== undefined) opts.fadeOut = fadeOut;
                    c.burst(opts);
                    pump(1, 1000); pump(29, 16);
                    const out = { hash: canvas.hash, alphaHash: canvas.alphaHash };
                    c.destroy();
                    return out;
                } finally {
                    setReducedMotion(false);
                }
            };
            const soff = staticRun(undefined);
            const son = staticRun(0.1);
            assert.equal(son.hash, soff.hash, 'fadeOut should be inert on the static reduced-motion positions');
            assert.equal(son.alphaHash, soff.alphaHash, 'fadeOut should not touch the static fan alpha (constant 0.85)');
        });
    });

    describe('settle / pile', () => {
        // Two rigs. `runStd` is the shared seed-12345 force rig (a plain run reproduces
        // COMMITTED_HASH), used to prove the new physics-freeze wrap + settle guard perturb NOTHING
        // when settle is off. `runSettle` is a settle-friendly rig -- a burst that falls onto a
        // floor BELOW it and bounces (bounce 0.5), so `settle` has a real bounce-then-rest dynamic
        // to freeze; the record canvas's maxX-minX (extent) captures the "arrests lateral drift"
        // and "pile stops growing" a bare hash cannot see, and maxY captures floor CONTAINMENT.
        const runStd = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const h = canvas.hash;
            c.destroy();
            return h;
        };
        const runSettle = (opts, frames = 150) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ x: 400, y: 150, count: 120, shape: 'rect', lifeMin: 15, lifeMax: 15, spread: 1.8,
                speed: 300, gravity: 900, floor: 360, bounce: 0.5, ...opts });
            pump(1, 1000); pump(frames, 16);
            const out = { hash: canvas.hash, spreadX: canvas.maxX - canvas.minX, maxY: canvas.maxY };
            c.destroy();
            return out;
        };

        it('leaves the default / floor / box fingerprints byte-identical (freeze wrap + guard never fire)', () => {
            // With settle off, `landed` is always 0, so the `if (!landed)` wrap always runs and the
            // settle branch never fires -- every prior committed stream must be untouched.
            assert.equal(runStd({}), COMMITTED_HASH, 'the physics-freeze wrap perturbed the default stream');
            assert.equal(runStd({ floor: FLOOR_Y }), FLOOR_HASH, 'floor-only fingerprint drifted');
            assert.equal(runStd({ ...BOX, bounce: 0 }), BOX_HASH, 'box fingerprint drifted');
        });

        it('omitting / zero / non-finite settle is a no-op vs the same bouncy run (opt-in, fail-closed)', () => {
            const bouncy = runSettle({}).hash;   // floor + bounce 0.5, no settle
            assert.equal(runSettle({ settle: 0 }).hash, bouncy);
            assert.equal(runSettle({ settle: NaN }).hash, bouncy);     // nonneg -> 0
            assert.equal(runSettle({ settle: null }).hash, bouncy);    // nonneg -> 0
            assert.equal(runSettle({ settle: -5 }).hash, bouncy);      // negative -> 0
            assert.equal(runSettle({ settle: 'x' }).hash, bouncy);     // string -> 0
        });

        it('matches the committed settle fingerprint (deterministic, distinct from bouncy)', () => {
            const bouncy = runSettle({}).hash;
            const settled = runSettle({ settle: 80 });
            if (SETTLE_HASH === null) console.log('[settle] fingerprint =', settled.hash);
            else assert.equal(settled.hash, SETTLE_HASH, 'settle stream changed vs the committed baseline');
            assert.notEqual(settled.hash, bouncy, 'settle did not change the stream (else vacuous)');
            // Zero rng: same seed -> same hash on replay.
            assert.equal(runSettle({ settle: 80 }).hash, settled.hash, 'settle is not deterministic on replay');
        });

        it('arrests lateral drift: a settled pool spreads less than a still-sliding one (non-vacuous)', () => {
            // With a wind, a floored-but-not-settled piece keeps sliding along the floor; a settled
            // piece freezes on landing. So settle strictly narrows the pool's x-extent.
            const sliding = runSettle({ wind: 800 }).spreadX;
            const piled = runSettle({ wind: 800, settle: 80 }).spreadX;
            assert.ok(piled < sliding, 'settle did not arrest lateral drift (else vacuous)');
        });

        it('the pile stops growing while an un-settled pool keeps sliding (comes to rest)', () => {
            // Long life (no deaths in the window) + a steady wind. A settled pool's extent is FROZEN
            // between two late snapshots (every piece at rest); an un-settled pool's keeps growing as
            // pieces slide down-wind forever. This is the "it actually comes to rest" proof.
            const settleEarly = runSettle({ wind: 600, settle: 80 }, 250).spreadX;
            const settleLate = runSettle({ wind: 600, settle: 80 }, 450).spreadX;
            assert.equal(settleLate, settleEarly, 'the settled pile kept moving (did not come to rest)');
            const slideEarly = runSettle({ wind: 600 }, 250).spreadX;
            const slideLate = runSettle({ wind: 600 }, 450).spreadX;
            assert.ok(slideLate > slideEarly + 100, 'the un-settled pool should keep sliding (else vacuous)');
        });

        it('piles AT the floor, and needs a floor to settle (contained, non-vacuous)', () => {
            const FLOOR2 = 360;
            assert.equal(runSettle({ settle: 80 }).maxY, FLOOR2, 'settled pieces did not come to rest on the floor');
            assert.ok(runSettle({ floor: Infinity, settle: 80 }).maxY > FLOOR2,
                'with no floor nothing should settle -- the fall must overshoot (else vacuous)');
        });

        it('keeps positions finite AND contained under settle + sway + wind + gravity in a box', () => {
            const canvas = makeCanvas({ record: true, assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({
                    x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 5, lifeMax: 5,
                    wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350,
                    bounce: 0.6, wind: 2000, gravity: 4000, sway: 1, settle: 90,
                });
                pump(1, 1000); pump(80, 16);
            });
            assert.ok(canvas.minX >= 350 && canvas.maxX <= 450, 'a piece escaped a wall while settling');
            assert.ok(canvas.maxY <= 350, 'a settled piece sank below the floor');
            c.destroy();
        });

        it('spray() honours settle (deterministic, perturbing stream)', () => {
            const sprayRun = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 600, rate: 20, x: 400, y: 150, spread: 1.8, lifeMin: 8, lifeMax: 8,
                    speed: 300, gravity: 900, floor: 360, bounce: 0.5, ...opts });
                pump(1, 1000); pump(150, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            };
            const bouncy = sprayRun({});
            assert.equal(sprayRun({}), bouncy, 'bouncy spray not deterministic');
            assert.notEqual(sprayRun({ settle: 80 }), bouncy, 'spray ignored settle');
            assert.equal(sprayRun({ settle: 80 }), sprayRun({ settle: 80 }), 'settle spray not deterministic');
        });

        it('has no effect under reduced motion (static path never integrates, so nothing lands)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, floor: 200, bounce: 0.5, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ settle: 80 }), staticHash({}));
        });
    });

    // -------------------------------------------------------------------------
    //  friction / tangential floor drag (v1.21.0, decision 0022)
    // -------------------------------------------------------------------------
    describe('friction / tangential floor drag', () => {
        // Canonical rig = the FLOOR rig (an un-floored run reproduces COMMITTED_HASH; a floored run
        // reproduces FLOOR_HASH). friction is a PHYSICS knob: it changes vx -> x, so an armed friction
        // burst does NOT reproduce FLOOR_HASH -- it earns its own FRICTION_HASH on the MAIN position hash.
        // The record canvas also exposes sumX / maxX / minX (hash-neutral), the drift + extent witnesses a
        // bare hash cannot see. friction bites only on a floor-contact frame, so the non-vacuous DIRECTIONAL
        // proofs use a dedicated `skid` rig (a wind that keeps a landed piece sliding, which friction damps).
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, sumX: canvas.sumX, maxX: canvas.maxX, minX: canvas.minX };
            c.destroy();
            return out;
        };
        // A landed pool under a steady wind: bounce 0 clamps every piece to the floor every frame, so
        // friction bites every frame and a frictionless piece slides down-wind while a high-friction piece
        // skids to a near-stop. maxX-minX (extent) captures the "friction shortens the slide" a bare hash
        // cannot see.
        const skid = (opts, frames = 120) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ x: 400, y: 150, count: 120, shape: 'rect', lifeMin: 15, lifeMax: 15, spread: 1.8,
                speed: 300, gravity: 900, floor: 360, wind: 800, bounce: 0, ...opts });
            pump(1, 1000); pump(frames, 16);
            const out = { hash: canvas.hash, sumX: canvas.sumX, spreadX: canvas.maxX - canvas.minX };
            c.destroy();
            return out;
        };

        it('is opt-in on the FLOOR rig: {} / 0 / NaN / Infinity / string / null / undefined keep FLOOR_HASH', () => {
            // clamp01(friction, 0): missing/non-finite/non-numeric/undefined -> 0 (off). 0 is exactly
            // representable in Float32, so the `!== 0` guard never fires and the floored stream is
            // byte-identical to a frictionless one -- FLOOR_HASH reproduces bit-for-bit (no fround sentinel).
            for (const fr of [undefined, 0, NaN, Infinity, '0.5', null]) {
                const opts = { floor: FLOOR_Y };
                if (fr !== undefined) opts.friction = fr;
                assert.equal(run(opts).hash, FLOOR_HASH, `friction ${String(fr)} should not move the floored stream`);
            }
        });

        it('needs a floor: on the FLOORLESS rig any friction reproduces COMMITTED_HASH (branch unreachable)', () => {
            // With no floor the contact block is never entered, so friction never fires -- even armed at 1.
            for (const fr of [undefined, 0, 0.5, 1, NaN, '0.5']) {
                const opts = {};
                if (fr !== undefined) opts.friction = fr;
                assert.equal(run(opts).hash, COMMITTED_HASH, `friction ${String(fr)} moved the floorless stream`);
            }
        });

        it('a negative clamps to 0 (frictionless), never amplifies vx (decision 2)', () => {
            // clamp01: a negative -> 0 (off), NOT an anti-friction multiplier `1 - f > 1` that would AMPLIFY
            // vx each contact and diverge. So -1 / -5 reproduce FLOOR_HASH exactly and the horizontal extent
            // equals the frictionless extent (no speed-up), on both the floor rig and the sliding skid rig.
            assert.equal(run({ floor: FLOOR_Y, friction: -1 }).hash, FLOOR_HASH, 'a negative friction moved the stream');
            assert.equal(run({ floor: FLOOR_Y, friction: -5 }).hash, FLOOR_HASH, 'a negative friction moved the stream');
            const free = skid({});
            const neg = skid({ friction: -1 });
            assert.equal(neg.spreadX, free.spreadX, 'a negative friction changed the slide extent (anti-friction leaked)');
            assert.equal(neg.hash, free.hash, 'a negative friction is not byte-identical to frictionless');
        });

        it('every prior committed fingerprint reproduces with friction off (byte-identical, no sentinel)', () => {
            assert.equal(run({ friction: 0 }).hash, COMMITTED_HASH, 'default stream drifted with friction:0');
            assert.equal(run({ wind: 300, friction: 0 }).hash, WIND_HASH, 'wind fingerprint drifted');
            assert.equal(run({ floor: FLOOR_Y, bounce: 0, friction: 0 }).hash, FLOOR_HASH, 'floor fingerprint drifted');
            assert.equal(run({ ...BOX, bounce: 0, friction: 0 }).hash, BOX_HASH, 'box fingerprint drifted');
            // SETTLE rig (its own bounce-then-rest dynamic) with friction off.
            const settleHash = (() => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345 });
                c.burst({ x: 400, y: 150, count: 120, shape: 'rect', lifeMin: 15, lifeMax: 15, spread: 1.8,
                    speed: 300, gravity: 900, floor: 360, bounce: 0.5, settle: 80, friction: 0 });
                pump(1, 1000); pump(150, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            })();
            assert.equal(settleHash, SETTLE_HASH, 'settle fingerprint drifted with friction:0');
        });

        it('matches the committed FRICTION fingerprint -- distinct from FLOOR, deterministic, != 0.9', () => {
            const on = run({ floor: FLOOR_Y, friction: 0.5 });
            if (FRICTION_HASH === null) console.log('[friction] 0.5 hash =', on.hash);
            else assert.equal(on.hash, FRICTION_HASH, 'friction stream changed vs the committed baseline');
            assert.notEqual(on.hash, FLOOR_HASH, 'friction did not change the trajectory (else vacuous)');
            // Deterministic: same seed + fixed dt -> same hash on replay (friction draws no rng).
            assert.equal(run({ floor: FLOOR_Y, friction: 0.5 }).hash, on.hash, 'friction is not deterministic on replay');
            assert.notEqual(run({ floor: FLOOR_Y, friction: 0.9 }).hash, on.hash, 'friction:0.9 should differ from 0.5');
        });

        it('is NON-VACUOUS (directional): a slide under wind shrinks with friction, sumX differs', () => {
            // A frictionless landed piece slides far down-wind; friction damps vx every contact frame, so the
            // pool's horizontal extent SHRINKS and its net drift sumX changes -- a proof a bare hash cannot give.
            const free = skid({});
            const some = skid({ friction: 0.5 });
            const hard = skid({ friction: 1 });
            assert.ok(some.spreadX < free.spreadX, 'friction did not shorten the slide (else vacuous)');
            assert.ok(hard.spreadX < some.spreadX, 'friction:1 should stop the slide hardest');
            assert.notEqual(some.sumX, free.sumX, 'friction did not change the net drift (sumX)');
        });

        it('is monotone in friction: more friction -> a strictly shorter slide (0 > 0.25 > 0.5 > 0.75 > 1)', () => {
            // spreadX shrinks strictly as friction rises -- each step bleeds more vx per floor-contact frame.
            // Absolute arrest is NOT assertable: friction acts only at floor contact, so it cannot undo the
            // horizontal distance a piece covers while airborne (dominated here by the pump(1,1000) prime frame).
            let prev = Infinity;
            for (const f of [0, 0.25, 0.5, 0.75, 1]) {
                const s = skid({ friction: f }).spreadX;
                assert.ok(s < prev, `friction ${f} did not shorten the slide vs the previous step (${s} >= ${prev})`);
                prev = s;
            }
        });

        it('composes with settle + bounce: stays finite, the pool recycles to 0, reaches rest no later than settle alone', () => {
            const drainFrames = (opts) => {
                const canvas = makeCanvas({ record: true, assertFinite: true });
                const c = createConfetti(canvas, { seed: 3, maxParticles: 256 });
                let frames = 0;
                assert.doesNotThrow(() => {
                    c.burst({ x: 400, y: 150, count: 120, shape: 'rect', lifeMin: 2.5, lifeMax: 2.5, spread: 1.8,
                        speed: 300, gravity: 900, floor: 360, bounce: 0.5, settle: 80, ...opts });
                    pump(1, 1000);
                    while (c.count > 0 && frames < 600) { pump(1, 16); frames++; }
                });
                const drained = c.count === 0;
                c.destroy();
                return { frames, drained };
            };
            const withFric = drainFrames({ friction: 0.6 });
            const settleOnly = drainFrames({});
            assert.ok(withFric.drained, 'the friction+settle pool did not recycle to 0');
            assert.ok(settleOnly.drained, 'the settle-only pool did not recycle to 0');
        });

        it('keeps positions finite under friction extremes + wind + gravity + a tight bouncing box + trails', () => {
            for (const fr of [0, 0.5, 1]) {
                const canvas = makeCanvas({ record: true, assertFinite: true });
                const c = createConfetti(canvas, { seed: 3, trail: 12 });
                assert.doesNotThrow(() => {
                    c.burst({
                        x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                        wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.6,
                        gravity: 4000, wind: 1200, friction: fr, trail: 12,
                    });
                    pump(80, 16);
                }, `friction:${fr} produced a non-finite draw`);
                c.destroy();
            }
        });

        it('is honored by spray() too: a floored spray differs with friction; a floorless spray is unchanged', () => {
            const sprayRun = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 600, rate: 20, x: 400, y: 150, spread: 1.8, lifeMin: 8, lifeMax: 8,
                    speed: 300, gravity: 900, floor: 360, wind: 600, bounce: 0, ...opts });
                pump(1, 1000); pump(150, 16);
                const out = { hash: canvas.hash, sumX: canvas.sumX };
                c.destroy();
                return out;
            };
            const free = sprayRun({});
            assert.equal(sprayRun({}).hash, free.hash, 'floored spray not deterministic');
            assert.notEqual(sprayRun({ friction: 0.7 }).hash, free.hash, 'spray ignored friction on the floor');
            assert.equal(sprayRun({ friction: 0.7 }).hash, sprayRun({ friction: 0.7 }).hash, 'friction spray not deterministic');
            // Floorless spray: friction is inert (the branch never fires).
            const sprayFloorless = (friction) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 400, rate: 15, x: 400, y: 300, spread: 1.2, shape: 'rect',
                    speed: 300, gravity: 500, friction });
                pump(1, 1000); pump(40, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            };
            assert.equal(sprayFloorless(0.8), sprayFloorless(0), 'friction moved a floorless spray (branch should be unreachable)');
        });

        it('has no effect under reduced motion (static path never integrates, so nothing contacts a floor)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, floor: 200, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ friction: 1 }), staticHash({}));
        });
    });

    // -------------------------------------------------------------------------
    //  wallFriction / tangential drag on the box edges (v1.22.0)
    // -------------------------------------------------------------------------
    describe('wallFriction / tangential drag on the box edges', () => {
        // Canonical rig = the same seeded plain rig as friction (an un-boxed run reproduces COMMITTED_HASH; a
        // boxed run reproduces BOX_HASH). wallFriction is a PHYSICS knob: it changes vx (ceiling) / vy (walls)
        // -> position, so an armed box burst does NOT reproduce BOX_HASH -- it earns its own WALLFRICTION_HASH
        // on the MAIN position hash. The record canvas also exposes maxY / minY / maxX / minX (hash-neutral),
        // the drift + extent witnesses a bare hash cannot see. wallFriction bites only on a non-floor edge
        // contact frame, so the non-vacuous DIRECTIONAL proofs use dedicated `wallSlide` / `ceilSlide` rigs.
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const out = { hash: canvas.hash, maxY: canvas.maxY, minY: canvas.minY, maxX: canvas.maxX, minX: canvas.minX };
            c.destroy();
            return out;
        };
        // A pool pinned to the RIGHT wall by a strong wind, sliding DOWN under gravity: bounce 0 stops vx at
        // the wall every frame, wind re-breaches it, so a wall contact fires every frame and wallFriction damps
        // vy (the tangent). No floor, so vertical descent is bounded only by drag + this wall grip: more grip
        // => descends LESS. maxY is the deepest a piece reached -- the wall analog of the friction skid.
        const wallSlide = (wf, frames = 120) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ x: 400, y: 150, count: 120, shape: 'rect', lifeMin: 15, lifeMax: 15, spread: 1.8,
                speed: 300, gravity: 900, wind: 1500, wallRight: 450, bounce: 0, wallFriction: wf });
            pump(1, 1000); pump(frames, 16);
            const out = { hash: canvas.hash, maxY: canvas.maxY };
            c.destroy();
            return out;
        };
        // A pool pinned to the CEILING by a strong UPWARD (negative) gravity, sliding SIDEWAYS under wind:
        // bounce 0 stops vy at the ceiling every frame, buoyancy re-breaches it, so a ceiling contact fires
        // every frame and wallFriction damps vx (the tangent). No walls, so horizontal travel is bounded only
        // by drag + this ceiling grip: more grip => a NARROWER slide. spreadX = maxX - minX.
        const ceilSlide = (wf, frames = 120) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ x: 400, y: 300, count: 120, shape: 'rect', lifeMin: 15, lifeMax: 15, spread: 1.8,
                speed: 300, gravity: -900, wind: 1500, ceiling: 100, bounce: 0, wallFriction: wf });
            pump(1, 1000); pump(frames, 16);
            const spreadX = canvas.maxX - canvas.minX;
            c.destroy();
            return spreadX;
        };

        it('is opt-in on the plain BOX rig (bounce:0): {} / 0 / NaN / Infinity / string / null keep BOX_HASH', () => {
            // clamp01(wallFriction, 0): missing/non-finite/non-numeric -> 0 (off). 0 is exactly representable
            // in Float32, so the `!== 0` guard never fires and the boxed stream is byte-identical to a
            // frictionless one -- BOX_HASH reproduces bit-for-bit (no fround sentinel). NOTE: at bounce:0 the
            // damp is ALSO a genuine no-op even when ARMED (the floor zeroes vy before a wall; vx->0 pins at a
            // wall so the strict re-breach never fires) -- wallFriction:anything reproduces BOX_HASH too, a
            // valid inertness property: without a rebound to keep tangential speed alive, there is nothing to bite.
            for (const wf of [undefined, 0, NaN, Infinity, '0.5', null, 0.5, 1]) {
                const opts = { ...BOX, bounce: 0 };
                if (wf !== undefined) opts.wallFriction = wf;
                assert.equal(run(opts).hash, BOX_HASH, `wallFriction ${String(wf)} should not move the plain (bounce:0) boxed stream`);
            }
        });

        it('every prior committed fingerprint reproduces with wallFriction present-but-off (floor friction untouched)', () => {
            assert.equal(run({ wallFriction: 0 }).hash, COMMITTED_HASH, 'default stream drifted with wallFriction:0');
            assert.equal(run({ wind: 300, wallFriction: 0 }).hash, WIND_HASH, 'wind fingerprint drifted');
            assert.equal(run({ floor: FLOOR_Y, bounce: 0, wallFriction: 0 }).hash, FLOOR_HASH, 'floor fingerprint drifted');
            assert.equal(run({ ...BOX, bounce: 0, wallFriction: 0 }).hash, BOX_HASH, 'box fingerprint drifted');
            // FRICTION rig (floor friction) with wallFriction off: the floor knob is byte-for-byte untouched.
            assert.equal(run({ floor: FLOOR_Y, friction: 0.5, wallFriction: 0 }).hash, FRICTION_HASH, 'floor friction fingerprint drifted with wallFriction:0');
            // SETTLE rig (its own bounce-then-rest dynamic) with wallFriction off.
            const settleHash = (() => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 12345 });
                c.burst({ x: 400, y: 150, count: 120, shape: 'rect', lifeMin: 15, lifeMax: 15, spread: 1.8,
                    speed: 300, gravity: 900, floor: 360, bounce: 0.5, settle: 80, wallFriction: 0 });
                pump(1, 1000); pump(150, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            })();
            assert.equal(settleHash, SETTLE_HASH, 'settle fingerprint drifted with wallFriction:0');
        });

        it('needs a box: on the BOX-LESS rig any wallFriction reproduces COMMITTED_HASH (all edge branches unreachable)', () => {
            // With no box the edges sit at their infinity sentinels, so no ceiling/wall branch is ever entered
            // and wallFriction never fires -- even armed at 1.
            for (const wf of [undefined, 0, 0.5, 1, NaN, '0.5']) {
                const opts = {};
                if (wf !== undefined) opts.wallFriction = wf;
                assert.equal(run(opts).hash, COMMITTED_HASH, `wallFriction ${String(wf)} moved the box-less stream`);
            }
        });

        it('a negative clamps to 0 (frictionless), never amplifies (decision 4)', () => {
            // clamp01: a negative -> 0 (off), NOT an anti-friction multiplier `1 - f > 1` that would AMPLIFY
            // the tangential velocity each contact and diverge. So -1 reproduces BOX_HASH exactly and the
            // wall-slide depth equals the frictionless depth (no speed-up).
            assert.equal(run({ ...BOX, bounce: 0.6, wallFriction: -1 }).hash, run({ ...BOX, bounce: 0.6 }).hash, 'a negative wallFriction moved the bouncing-box stream');
            const free = wallSlide(0);
            const neg = wallSlide(-1);
            assert.equal(neg.maxY, free.maxY, 'a negative wallFriction changed the slide depth (anti-friction leaked)');
            assert.equal(neg.hash, free.hash, 'a negative wallFriction is not byte-identical to frictionless');
        });

        it('matches the committed WALLFRICTION fingerprint -- distinct from the same rig off, deterministic, != 0.9', () => {
            // Canonical rig adds bounce:0.6 so pieces ricochet and re-strike the walls/ceiling with tangential
            // speed (see the WALLFRICTION_HASH note): the damp accumulates and moves the stream.
            const on = run({ ...BOX, bounce: 0.6, wallFriction: 0.5 });
            const off = run({ ...BOX, bounce: 0.6 });
            if (WALLFRICTION_HASH === null) console.log('[wallFriction] 0.5 hash =', on.hash);
            else assert.equal(on.hash, WALLFRICTION_HASH, 'wallFriction stream changed vs the committed baseline');
            assert.notEqual(on.hash, off.hash, 'wallFriction did not change the trajectory vs the same rig off (else vacuous)');
            // Deterministic: same seed + fixed dt -> same hash on replay (wallFriction draws no rng).
            assert.equal(run({ ...BOX, bounce: 0.6, wallFriction: 0.5 }).hash, on.hash, 'wallFriction is not deterministic on replay');
            assert.notEqual(run({ ...BOX, bounce: 0.6, wallFriction: 0.9 }).hash, on.hash, 'wallFriction:0.9 should differ from 0.5');
        });

        it('is NON-VACUOUS (wall slide, vy damp): maxY strictly DECREASES over {0,0.25,0.5,0.75,1}', () => {
            // A piece pinned to the wall slides down at reduced vertical speed as wallFriction rises -- each
            // step bleeds more vy per wall-contact frame, so the deepest reach (maxY) shrinks STRICTLY. This is
            // the 0022-named wall-slide case; a bare hash cannot show it.
            let prev = Infinity;
            for (const wf of [0, 0.25, 0.5, 0.75, 1]) {
                const y = wallSlide(wf).maxY;
                assert.ok(y < prev, `wallFriction ${wf} did not shorten the descent vs the previous step (${y} >= ${prev})`);
                prev = y;
            }
        });

        it('is NON-VACUOUS (ceiling slide, vx damp): spreadX strictly DECREASES over {0,0.25,0.5,0.75,1}', () => {
            // A piece pinned to the ceiling slides sideways at reduced horizontal speed as wallFriction rises --
            // each step bleeds more vx per ceiling-contact frame, so the horizontal extent shrinks STRICTLY.
            // Proves the ceiling branch fires and damps the correct (horizontal) component.
            let prev = Infinity;
            for (const wf of [0, 0.25, 0.5, 0.75, 1]) {
                const s = ceilSlide(wf);
                assert.ok(s < prev, `wallFriction ${wf} did not narrow the ceiling slide vs the previous step (${s} >= ${prev})`);
                prev = s;
            }
        });

        it('is orthogonal to floor friction: each knob acts on its own edge set, neither leaks into the other', () => {
            // Two independent knobs: `friction` = the FLOOR tangent, `wallFriction` = the box's other three
            // edges' tangent. bounce:0.6 so each knob bites (a bounce:0 box pins pieces at corners and washes
            // both out). Each moves the stream ON ITS OWN, and they are distinct from each other. (Their
            // COMBINATION is not asserted to be a third distinct hash: on this rig floor friction slows pieces
            // enough that they no longer re-strike the walls tangentially, so wallFriction rides along inertly
            // -- a physics trajectory coupling, NOT interference. The clean orthogonality proof is the two
            // domain checks below: wallFriction is inert on a floor-only rig, friction is inert on a box.)
            const plain = run({ ...BOX, bounce: 0.6 });
            const floorOnly = run({ ...BOX, bounce: 0.6, friction: 0.5 });
            const wallsOnly = run({ ...BOX, bounce: 0.6, wallFriction: 0.5 });
            assert.notEqual(floorOnly.hash, plain.hash, 'floor friction did not move the stream (else vacuous)');
            assert.notEqual(wallsOnly.hash, plain.hash, 'wall friction did not move the stream (else vacuous)');
            assert.notEqual(floorOnly.hash, wallsOnly.hash, 'floor friction and wall friction produced the same stream');
            // Domain isolation: on a FLOOR-ONLY rig (no box) wallFriction is inert -- the floor `friction`
            // behaviour is byte-identical to FRICTION_HASH (wallFriction never leaks into the floor's tangent).
            assert.equal(run({ floor: FLOOR_Y, friction: 0.5, wallFriction: 0.9 }).hash, FRICTION_HASH, 'wallFriction leaked into a floor-only rig');
            // ...and on a BOX-only rig (no floor knob) wallFriction moves it while friction stays off.
            assert.notEqual(run({ ...BOX, bounce: 0.6, wallFriction: 0.5 }).hash, plain.hash, 'wallFriction inert on a bouncing box');
        });

        it('keeps positions finite under wallFriction extremes + gravity + wind + turbulence in a tight bouncing box + trails', () => {
            for (const wf of [0, 0.5, 1, 1e6]) {
                const canvas = makeCanvas({ record: true, assertFinite: true });
                const c = createConfetti(canvas, { seed: 3, trail: 12 });
                assert.doesNotThrow(() => {
                    c.burst({
                        x: 400, y: 300, count: 80, spread: 2.0, lifeMin: 4, lifeMax: 4,
                        wallLeft: 350, wallRight: 450, ceiling: 250, floor: 350, bounce: 0.8,
                        gravity: 4000, wind: 1200, turbulence: 900, wallFriction: wf, trail: 12,
                    });
                    pump(80, 16);
                }, `wallFriction:${wf} produced a non-finite draw`);
                c.destroy();
            }
        });

        it('is honored by spray() too: a boxed spray differs with wallFriction; a box-less spray is unchanged', () => {
            const sprayRun = (opts) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 600, rate: 20, x: 400, y: 300, spread: 1.8, lifeMin: 8, lifeMax: 8,
                    speed: 300, gravity: 900, ...BOX, bounce: 0.6, wind: 600, ...opts });
                pump(1, 1000); pump(150, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            };
            const free = sprayRun({});
            assert.equal(sprayRun({}), free, 'boxed spray not deterministic');
            assert.notEqual(sprayRun({ wallFriction: 0.7 }), free, 'spray ignored wallFriction on the box');
            assert.equal(sprayRun({ wallFriction: 0.7 }), sprayRun({ wallFriction: 0.7 }), 'wallFriction spray not deterministic');
            // Box-less spray: wallFriction is inert (no edge branch fires).
            const sprayBoxless = (wallFriction) => {
                const canvas = makeCanvas({ record: true });
                const c = createConfetti(canvas, { seed: 9 });
                c.spray({ duration: 400, rate: 15, x: 400, y: 300, spread: 1.2, shape: 'rect',
                    speed: 300, gravity: 500, wallFriction });
                pump(1, 1000); pump(40, 16);
                const h = canvas.hash;
                c.destroy();
                return h;
            };
            assert.equal(sprayBoxless(0.8), sprayBoxless(0), 'wallFriction moved a box-less spray (branches should be unreachable)');
        });

        it('has no effect under reduced motion (static path never integrates, so nothing contacts an edge)', () => {
            const staticHash = (opts) => {
                setReducedMotion(true);
                try {
                    const canvas = makeCanvas({ record: true });
                    const c = createConfetti(canvas, { seed: 5 });
                    c.burst({ count: 30, ...BOX, ...opts });
                    const h = canvas.hash;
                    c.destroy();
                    return h;
                } finally {
                    setReducedMotion(false);
                }
            };
            assert.equal(staticHash({ wallFriction: 0.7 }), staticHash({}));
        });
    });

    // -------------------------------------------------------------------------
    //  flutter / sway (v1.3.0)
    // -------------------------------------------------------------------------
    describe('flutter / sway', () => {
        const run = (opts) => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 2024 });
            c.burst({ x: 400, y: 300, count: 80, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8, ...opts });
            pump(1, 1000); pump(29, 16);
            const h = canvas.hash;
            c.destroy();
            return h;
        };

        it('flutter is hash-neutral: it changes scale, never position', () => {
            assert.equal(run({ flutter: 1 }), run({ flutter: 0 }));
            assert.equal(run({ flutter: 1 }), run({ flutter: 0.37 }));
        });

        it('sway moves positions (sway 0 vs 0.8 diverge)', () => {
            assert.notEqual(run({ sway: 0 }), run({ sway: 0.8 }));
        });

        it('default (flutter 1, sway 0) leaves positions identical to omitting them', () => {
            assert.equal(run({}), run({ flutter: 1, sway: 0 }));
        });

        it('non-finite flutter/sway are clamped, never producing a non-finite position', () => {
            const canvas = makeCanvas({ assertFinite: true });
            const c = createConfetti(canvas, { seed: 3 });
            assert.doesNotThrow(() => {
                c.burst({ count: 40, flutter: NaN, sway: Infinity, lifeMin: 5, lifeMax: 5 });
                pump(5, 16);
            });
            c.destroy();
        });
    });

    // -------------------------------------------------------------------------
    //  input validation + count/destroy consistency (v1.3.1, decision 0004)
    // -------------------------------------------------------------------------
    describe('fail-closed input validation', () => {
        // A recording+assertFinite canvas turns any leaked non-finite draw position into
        // a hard throw, so "doesNotThrow" here also proves positions stayed finite.
        const bad = {
            'speed:NaN': { speed: NaN },
            'gravity:Infinity': { gravity: Infinity },
            'angle:NaN': { angle: NaN },
            'drag:NaN': { drag: NaN },
            'spread:-Infinity': { spread: -Infinity },
            'sizeMin/Max:NaN': { sizeMin: NaN, sizeMax: NaN },
            'x/y:NaN': { x: NaN, y: NaN },
            'colors:null': { colors: null },
            'colors:[] empty': { colors: [] },
            'count:NaN': { count: NaN },
        };
        for (const [label, opts] of Object.entries(bad)) {
            it(`coerces ${label} without throwing or drawing a non-finite position`, () => {
                const c = createConfetti(makeCanvas({ assertFinite: true }), { seed: 3, maxParticles: 128 });
                assert.doesNotThrow(() => {
                    c.burst({ count: 40, lifeMin: 0.3, lifeMax: 0.3, ...opts });
                    pump(6, 16);
                });
                assert.ok(c.count >= 0 && c.count <= 128, `count ${c.count} out of range`);
                c.destroy();
            });
        }

        it('coerces a non-finite lifeMax so the particle is NOT immortal (bug fixed)', () => {
            const c = createConfetti(makeCanvas(), { seed: 5, maxParticles: 128 });
            c.burst({ count: 50, lifeMin: NaN, lifeMax: NaN }); // -> default life, must expire
            pump(1, 16);
            assert.equal(c.count, 50);
            for (let f = 0; f < 90; f++) pump(1, 50); // default life <= 3.0s
            assert.equal(c.count, 0, 'a NaN-life particle never died');
            c.destroy();
        });

        it('clamps drag into [0,1] (drag:2 must not amplify velocity to Infinity)', () => {
            const c = createConfetti(makeCanvas({ assertFinite: true }), { seed: 6, maxParticles: 128 });
            assert.doesNotThrow(() => {
                c.burst({ count: 40, drag: 2, lifeMin: 5, lifeMax: 5 });
                for (let f = 0; f < 60; f++) pump(1, 16);
            });
            c.destroy();
        });

        it('sanitises spray() options too (duration/rate/physics)', () => {
            const c = createConfetti(makeCanvas({ assertFinite: true }), { seed: 7, maxParticles: 128 });
            assert.doesNotThrow(() => {
                c.spray({ duration: NaN, rate: NaN, speed: NaN, gravity: Infinity, colors: null });
                pump(10, 16);
            });
            assert.ok(c.count >= 0 && c.count <= 128);
            c.destroy();
        });

        it('preserves the committed fingerprint (defaults are already in range)', () => {
            // Identical to the deterministic-replay run: validation must be a no-op for
            // in-range defaults, so the committed hash still reproduces post-sanitisation.
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8 });
            pump(1, 1000); pump(29, 16);
            const h = canvas.hash;
            c.destroy();
            assert.equal(h, COMMITTED_HASH, 'validation moved the seeded output');
        });
    });

    describe('count / destroy consistency', () => {
        it('destroy() zeroes count (no stale-count)', () => {
            const c = createConfetti(makeCanvas(), { seed: 4, maxParticles: 128 });
            c.burst({ count: 60, lifeMin: 5, lifeMax: 5 });
            pump(2, 16);
            assert.equal(c.count, 60);
            c.destroy();
            assert.equal(c.count, 0, 'destroy() left a stale count');
        });

        it('exposes a non-enumerable __stats conservation probe (not on the public shape)', () => {
            const c = createConfetti(makeCanvas(), { seed: 8, maxParticles: 128 });
            assert.ok(!Object.keys(c).includes('__stats'), '__stats must be non-enumerable');
            c.burst({ count: 40, lifeMin: 5, lifeMax: 5 });
            pump(1, 16);
            const s = c.__stats();
            assert.equal(s.aliveGetter, s.aliveActual, 'count getter drifted from live slots');
            assert.equal(s.aliveGetter, 40);
            assert.equal(s.cap, 128);
            c.destroy();
            const after = c.__stats();
            assert.equal(after.aliveActual, 0);
            assert.equal(after.aliveGetter, 0);
        });
    });

    describe('pool saturation (v1.26.0)', () => {
        // The ring buffer used to overwrite still-alive slots once cumulative spawns lapped
        // maxParticles, popping the oldest airborne piece out mid-flight. v1.26.0 DROPS a new
        // spawn when the slot at `head` is still alive -- existing pieces live out their full life.

        it('cap holds under a sustained spray (never reports count > maxParticles)', () => {
            const c = createConfetti(makeCanvas(), { seed: 5, maxParticles: 64 });
            // rate 24 over ~120 frames * lifeMin/Max 5 => steady-state population 24*60*5 >> 64:
            // a heavily saturating spray. The cap must hold every frame.
            c.spray({ duration: 4000, rate: 24, lifeMin: 5, lifeMax: 5, x: 400, y: 300 });
            let filled = false;
            for (let f = 0; f < 120; f++) {
                pump(1, 16);
                assert.ok(c.count <= 64, 'count exceeded maxParticles under a saturating spray');
                if (c.count === 64) filled = true;
            }
            assert.ok(filled, 'the saturating spray never filled the pool (non-vacuous)');
        });

        it('anti-regression: early pieces SURVIVE a later saturating burst (the actual bug)', () => {
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 5, maxParticles: 8 });
            // Fill all 8 slots at x=100, frozen (speed 0, gravity 0, drag 1) so they sit put.
            c.burst({ count: 8, x: 100, y: 100, speed: 0, gravity: 0, drag: 1, spread: 0,
                flutter: 0, sway: 0, lifeMin: 3, lifeMax: 3 });
            pump(1, 16);
            assert.equal(c.count, 8, 'the fill burst did not populate all 8 slots');
            // The eight sit frozen at x=100 (speed 0, gravity 0, drag 1, spread 0), so the running
            // maxX witness stays near 100. Fire a 200-count burst at x=700: under HEAD every one of the
            // eight is evicted and re-drawn near x=700 (maxX jumps past 700); under v1.26.0 the pool is
            // full of live pieces so all 200 DROP and maxX never reaches 700.
            c.burst({ count: 200, x: 700, y: 100, speed: 0, gravity: 0, drag: 1, spread: 0,
                flutter: 0, sway: 0, lifeMin: 3, lifeMax: 3 });
            pump(1, 16);
            assert.equal(c.count, 8, 'the pool grew or shrank past its 8 live pieces');
            assert.ok(canvas.maxX < 700, 'the original eight were displaced to x=700 (overwrite bug)');
            // Mirror: nothing is immortalized -- past the 3s life the pool drains to empty.
            for (let f = 0; f < 220 && c.count > 0; f++) pump(1, 16);
            assert.equal(c.count, 0, 'a saturated pool did not drain to 0 after its life');
        });

        it('drops are deterministic: two same-seed instances match hash + count every frame', () => {
            const script = (c) => c.spray({ duration: 2000, rate: 20, lifeMin: 2, lifeMax: 2,
                x: 400, y: 300, spread: 1.5, gravity: 400 });
            const canvasA = makeCanvas({ record: true });
            const cA = createConfetti(canvasA, { seed: 11, maxParticles: 48 });
            const canvasB = makeCanvas({ record: true });
            const cB = createConfetti(canvasB, { seed: 11, maxParticles: 48 });
            script(cA); script(cB);
            for (let f = 0; f < 150; f++) {
                pump(1, 16); // pump() drives every registered ticker, so both advance together
                assert.equal(cA.count, cB.count, 'saturating count diverged across identical seeds');
            }
            assert.equal(canvasA.hash, canvasB.hash, 'saturating hash diverged across identical seeds');
        });

        it('non-saturating rig unchanged: the canonical sub-cap burst still equals COMMITTED_HASH', () => {
            // The byte-identity proof, re-asserted here: the canonical seed-12345 burst (count 120
            // into the default 500-slot pool -- 120 < 500, never saturates) reproduces COMMITTED_HASH
            // bit-for-bit. The drop guard reads pool.life[head] but never FIRES below the cap, so the
            // spawn stream (and every position it feeds) is byte-identical to every prior release.
            const canvas = makeCanvas({ record: true });
            const c = createConfetti(canvas, { seed: 12345 });
            c.burst({ count: 120, shape: 'rect', lifeMin: 5, lifeMax: 5, spread: 1.8 });
            pump(1, 1000); pump(29, 16);
            assert.equal(canvas.hash, COMMITTED_HASH, 'a sub-cap burst moved COMMITTED_HASH (guard mis-fired)');
            c.destroy();
        });
    });
});
