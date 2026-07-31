/**
 * T8 -- cross-package poison door + shared-ticker retention.
 *
 * lite-bvh's T8 proves poison stops at the package boundary; confetti's boundary is
 * its three runtime deps (lite-color via colorsFromPalette, lite-random via the
 * seed, lite-ticker shared across instances). This tier proves each fails closed:
 *
 *   X1 colorsFromPalette -- fail-closed contract: for ANY poison input it returns a
 *      NON-EMPTY colors array (never [] -> rng.pick undefined -> paints nothing) and
 *      never throws. A valid palette still maps through (the control is not vacuous).
 *   X2 fromElement -- degrades to {...extra} on a bad element, no throw; a real
 *      element yields the centre point.
 *   X3 shared lite-ticker ref-count -- 3 instances share one module ticker; destroy
 *      2 and the 3rd keeps animating (its fingerprint keeps changing). Proves the
 *      ticker is ref-counted, not a global toggled off by the first destroy().
 *   X4 shared-ticker retention (F0's Phase A) -- N create/fire/destroy cycles leave
 *      live == 0: the one thing that could pin a dropped instance is the shared
 *      ticker holding its update() closure, and destroy() unregisters it.
 */

import {
    createConfetti, makeCanvas, pump, colorsFromPalette, fromElement,
    createLeakTracker, settle, HAS_GC, check, capture, withSilencedWarn, log,
} from './harness.mjs';

export async function run() {
    // X1 -- colorsFromPalette never returns empty and never throws.
    {
        const poisons = [null, undefined, [], {}, { stops: [] }, [{ bad: 1 }], 'notacolor', 42, [null, {}, 'x']];
        for (const p of poisons) {
            let out;
            const err = capture(() => { out = colorsFromPalette(p); });
            check(err === null, () => `T8 X1: colorsFromPalette threw on poison ${JSON.stringify(p)}: ${err && err.message}`);
            check(Array.isArray(out) && out.length > 0, () =>
                `T8 X1: colorsFromPalette(${JSON.stringify(p)}) -> not a non-empty array (fail-closed broken)`);
        }
        const good = colorsFromPalette([{ l: 0.7, c: 0.1, h: 120 }, '#ff0000']);
        check(Array.isArray(good) && good.length === 2, () => `T8 X1: valid 2-color palette mapped to length ${good.length} (control vacuous)`);
    }

    // X2 -- fromElement degrades safely, then works on a real element.
    withSilencedWarn(() => {
        for (const bad of [null, undefined, {}, { getBoundingClientRect: 5 }]) {
            let o;
            const err = capture(() => { o = fromElement(bad, { count: 5 }); });
            check(err === null, () => `T8 X2: fromElement(bad) threw ${err && err.message}`);
            check(o && o.count === 5 && o.x === undefined, () => `T8 X2: fromElement(bad) did not degrade to {...extra}`);
        }
        const el = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 40, height: 60 }) };
        const o = fromElement(el, { count: 3 });
        check(o.x === 30 && o.y === 50 && o.count === 3, () => `T8 X2: fromElement(el) centre wrong (${o.x}, ${o.y})`);
    });

    // X3 -- shared ticker is ref-counted: destroying 2 of 3 must not stop the 3rd.
    {
        const cv = makeCanvas({ record: true });
        const a = createConfetti(makeCanvas(), { seed: 1, maxParticles: 64 });
        const b = createConfetti(makeCanvas(), { seed: 2, maxParticles: 64 });
        const cc = createConfetti(cv, { seed: 3, maxParticles: 64 });
        for (const inst of [a, b, cc]) inst.burst({ count: 20, lifeMin: 100, lifeMax: 100, speed: 300 });
        pump(1, 16);
        const h1 = cv.hash;
        a.destroy();
        b.destroy();
        pump(3, 16); // ticker must still drive cc
        check(cv.hash !== h1, () =>
            `T8 X3: after destroying 2 of 3 instances, the survivor stopped animating (hash frozen at ${h1}) -- ticker not ref-counted`);
        cc.destroy();
    }

    // X4 -- shared-ticker retention. Mirrors F0 Phase A.
    if (!HAS_GC) { log('  T8 X4 inconclusive -- run with node --expose-gc'); return; }
    const tracker = createLeakTracker({ name: 'lite-confetti-cross' });
    let handles = [];
    const N = 64;
    for (let i = 0; i < N; i++) {
        const canvas = makeCanvas();
        const inst = createConfetti(canvas, { seed: i, maxParticles: 128 });
        handles.push(tracker.track(canvas, null, 'canvas'));
        handles.push(tracker.track(inst, null, 'instance'));
        inst.burst({ count: 64, lifeMin: 1, lifeMax: 1 });
        pump(1);
        inst.destroy();
    }
    check(tracker.size() === N * 2, () => `T8 X4: tracker registered ${tracker.size()} handles, expected ${N * 2}`);
    for (let i = 0; i < handles.length; i++) tracker.untrack(handles[i]);
    handles = null;
    const remaining = await settle(() => tracker.size());
    check(remaining === 0, () =>
        `T8 X4: destroyed instances left ${remaining} object(s) live -- the shared ticker pinned an instance or canvas after destroy()`);

    log('  T8 ok -- palette/fromElement fail-closed; shared ticker ref-counted and fully released');
}
