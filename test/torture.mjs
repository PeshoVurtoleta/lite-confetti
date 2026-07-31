/**
 * @zakkster/lite-confetti -- torture gate.
 *
 *     node --expose-gc test/torture.mjs        -> prints "ok", exit 0
 *     npm run torture
 *
 * The DONE-WHEN of every confetti session. lite-confetti's contract is a GC-free
 * render loop over a fixed particle pool driven, in these tests, through the real
 * @zakkster/lite-ticker via the pumpable requestAnimationFrame in test/_env.mjs --
 * no shipped-code hook, Confetti.js byte-unchanged.
 *
 * Nine tiers share one harness (test/torture/harness.mjs), modelled on
 * @zakkster/lite-bvh. All assertions are BLACK-BOX: confetti's pool is encapsulated,
 * so the tiers observe only the public surface -- count() and the instrumented-ctx
 * draw fingerprint -- never private typed arrays.
 *
 *     T0  metamorphic laws            T1  degenerate inputs
 *     T3  adversarial op orders       T4  handle / stub / buffer abuse
 *     T5  differential determinism    T6  the zero-alloc gate (HARD)
 *     T7  soak + occupancy conservation
 *     T8  cross-package poison + shared-ticker retention
 *     T9  controls (every gate must be able to fail)
 *
 * T2 (aliasing) is intentionally omitted -- confetti has no caller-shared buffers to
 * alias, exactly as lite-bvh reserves its own T2.
 *
 * lite-gc-profiler is one-measurement-at-a-time, so tiers run STRICTLY SEQUENTIALLY
 * -- never nested, never concurrent. lite-gc-profiler and lite-leak are
 * devDependencies only.
 *
 * Controls:
 *   CONFETTI_TORTURE_BREAK=1 node --expose-gc test/torture.mjs   -> must exit non-zero
 *   TORTURE_CONTROL=alloc    node --expose-gc test/torture.mjs   -> must exit non-zero
 *   TORTURE_SEED=<n>         replays the fuzz tiers deterministically
 * Without --expose-gc the memory tiers degrade to "inconclusive" and the gate exits 0.
 *
 * @license MIT
 */

import { SEED, BREAK } from './torture/harness.mjs';
import { run as t0 } from './torture/t0-laws.mjs';
import { run as t1 } from './torture/t1-degenerate.mjs';
import { run as t3 } from './torture/t3-adversarial.mjs';
import { run as t4 } from './torture/t4-handles.mjs';
import { run as t5 } from './torture/t5-fuzz.mjs';
import { run as t6 } from './torture/t6-alloc.mjs';
import { run as t7 } from './torture/t7-soak.mjs';
import { run as t8 } from './torture/t8-cross.mjs';
import { run as t9 } from './torture/t9-controls.mjs';

const TIERS = [
    ['T0 laws', t0],
    ['T1 degenerate', t1],
    ['T3 adversarial', t3],
    ['T4 handles', t4],
    ['T5 fuzz', t5],
    ['T6 alloc', t6],
    ['T7 soak', t7],
    ['T8 cross', t8],
    ['T9 controls', t9],
];

async function main() {
    if (typeof globalThis.gc !== 'function') {
        // The memory tiers degrade to "inconclusive" and skip; the correctness tiers
        // still run. A no-gc run is not a FAIL, but it is not a full proof either.
        process.stderr.write(
            'torture: no --expose-gc -- memory tiers inconclusive. Full proof:  node --expose-gc test/torture.mjs\n');
    }

    for (const [name, run] of TIERS) {
        try {
            // eslint-disable-next-line no-await-in-loop
            await run();
        } catch (err) {
            // Tiers normally fail via die() (which exits). A thrown error is an
            // unexpected fault -- surface it with the replay seed and stop.
            process.stderr.write(
                'torture: FAIL -- ' + name + ' threw: ' + (err && err.stack || err) +
                '\n  replay: TORTURE_SEED=' + SEED + ' node --expose-gc test/torture.mjs\n');
            process.exit(1);
        }
    }

    // Reaching here in BREAK mode means T6's injected allocation did not trip the
    // gate -- a fault. A gate that cannot fail is decorative.
    if (BREAK) {
        process.stderr.write('torture: FAIL -- CONFETTI_TORTURE_BREAK set but the gate still passed\n');
        process.exit(1);
    }

    process.stdout.write('ok\n');
    process.exit(0);
}

main();
