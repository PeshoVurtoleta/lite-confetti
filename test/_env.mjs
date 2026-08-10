/**
 * Minimal browser environment for running lite-confetti under node:test and the
 * torture gate. lite-confetti reads `window.matchMedia` at module-evaluation time
 * (reduced-motion detection) and drives its render loop through
 * `@zakkster/lite-ticker`, which schedules via `requestAnimationFrame` and reads
 * `performance.now()`. Node has neither `window`/`document` nor rAF, so this shim
 * installs them.
 *
 * IMPORTANT: import this module BEFORE '../Confetti.js'. ESM evaluates the first
 * import's module graph fully before the next import statement, so a
 * `import './_env.mjs'` placed above `import '../Confetti.js'` guarantees these
 * globals exist when Confetti.js reads `window.matchMedia`.
 *
 * The rAF here is a PUMP, not a live loop: it queues callbacks, and `pump(frames,
 * dtMs)` invokes them with a controlled virtual clock. That drives lite-ticker's
 * real `_tick` (and thus confetti's real `update()`) deterministically, one frame
 * per pumped frame, with no shipped-code change. `Ticker._tick` caps a large first
 * dt to 16.66ms, so the initial pump is well-behaved regardless of wall time.
 *
 * ASCII-only, per the suite Law.
 */

// --- requestAnimationFrame pump ------------------------------------------------

let _rafQueue = [];
let _clock = performance.now();

globalThis.requestAnimationFrame = (cb) => { _rafQueue.push(cb); return _rafQueue.length; };
globalThis.cancelAnimationFrame = () => {};

/**
 * Advance the virtual clock and drive every queued rAF callback `frames` times,
 * `dtMs` apart. lite-ticker re-registers its `_tick` each frame, so pumping
 * repeatedly runs the real per-frame update loop. Returns nothing.
 */
export function pump(frames = 1, dtMs = 16) {
    for (let f = 0; f < frames; f++) {
        _clock += dtMs;
        const q = _rafQueue;
        _rafQueue = [];
        for (let i = 0; i < q.length; i++) q[i](_clock);
    }
}

// --- window (reduced motion + pointer events) ---------------------------------

let _rmChange = null;
const _mq = {
    matches: false,
    addEventListener(ev, cb) { if (ev === 'change') _rmChange = cb; },
    removeEventListener() {},
};

const _win = {
    devicePixelRatio: 1,
    innerWidth: 1024,
    innerHeight: 768,
    _listeners: { pointermove: [] },
    matchMedia() { return _mq; },
    addEventListener(type, fn) { (_win._listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
        const a = _win._listeners[type];
        if (!a) return;
        const i = a.indexOf(fn);
        if (i >= 0) a.splice(i, 1);
    },
};

/** Toggle prefers-reduced-motion by firing the media-query change listener. */
export function setReducedMotion(on) {
    _mq.matches = !!on;
    if (_rmChange) _rmChange({ matches: !!on });
}

/** Dispatch a synthetic pointermove to every bound window listener. */
export function firePointerMove(clientX, clientY) {
    for (const fn of (_win._listeners.pointermove || []).slice()) fn({ clientX, clientY });
}

/** How many pointermove listeners are currently bound (leak assertions). */
export function pointerListenerCount() { return (_win._listeners.pointermove || []).length; }

// --- document + canvas --------------------------------------------------------

/**
 * A headless canvas whose 2D context is a set of no-op sinks. With `record:true`
 * the context accumulates a POSITION fingerprint over `translate(x, y)` calls only
 * -- the per-particle draw origin -- readable as `canvas.hash`, which is how the
 * determinism gate proves seeded replays are byte-identical without reaching into
 * private pool arrays. Rotation is deliberately NOT in `hash` (so `flutter`/`align`
 * and any orientation-only feature are provable pure overlays); it feeds the separate
 * `rotateHash` probe instead, kept out of the position mix like strokeHash/colorHash.
 * Scale is likewise kept out of `hash` and folded into its own `scaleHash`/`lastScale`
 * pair (v1.17.0), so `scaleTo` (size-over-life) is a provable pure render overlay too;
 * `lastScaleX` witnesses the X wobble factor (where flutter/flutterRate live) alongside it.
 */
export function makeCanvas({ record = false, assertFinite = false } = {}) {
    const c = { style: {}, parentElement: null, width: 0, height: 0, id: '' };
    Object.defineProperty(c, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(c, 'clientHeight', { value: 600, configurable: true });
    // Offset, unscaled canvas -- exercises the viewport->canvas coordinate mapping.
    c.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600 });
    c.remove = () => {};

    let hash = 0 >>> 0;
    // Net signed sum of integer draw X positions, accumulated ONLY in the record branch
    // and kept entirely out of the `hash` mix -- so every committed fingerprint is
    // byte-identical whether or not this is read. It lets a test measure net drift
    // DIRECTION (e.g. wind: +K drifts right => larger sumX than wind: -K), the analog of
    // "count dispatches, not positions": a bare hash proves determinism but not sign.
    let sumX = 0;
    // Largest integer draw Y seen, accumulated ONLY in the record branch and kept out of
    // the `hash` mix (so every committed fingerprint is byte-identical whether or not this
    // is read). It measures the floor CONTAINMENT invariant a bare hash cannot see: a
    // floored burst gives `maxY <= floor` (the boundary held), while the same seed with no
    // floor gives `maxY > floor` (the floor actually did something) -- the Y-axis analog of
    // `sumX`'s drift-direction proof.
    let maxY = -Infinity;
    // Bounding-box CONTAINMENT probes (v1.7.0): the smallest/largest integer draw X and the
    // smallest draw Y, accumulated ONLY in the record branch and kept out of the `hash` mix
    // (fingerprints stay byte-identical whether or not these are read). They measure the
    // invariant a bare hash cannot see -- the X/Y-min analogs of `maxY`: a walled/ceilinged
    // burst gives `maxX <= wallRight`, `minX >= wallLeft`, `minY >= ceiling` (each edge held),
    // while the same seed with no box breaches each (the edge actually did something).
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    // Motion-trail GEOMETRY probe (v1.9.0). Trails render as world-space stroked polylines
    // (beginPath -> moveTo/lineTo... -> stroke), never via `translate`, so they contribute
    // NOTHING to the position `hash` -- that is what makes trails a provable pure overlay. To
    // still prove the ribbon geometry is deterministic, `strokeHash` folds each stroked path's
    // rounded points, committed ONLY on stroke(); `strokes` counts stroke() calls. Both are
    // kept out of `hash` (like sumX/maxY), so every committed position fingerprint is byte-
    // identical whether or not they are read. Shapes fill() (never stroke()), so `pathHash`
    // built for a filled shape is simply never committed -- strokeHash/strokes are trail-only.
    let strokeHash = 0 >>> 0;
    let strokes = 0;
    // Staggered-emission PROBE (v1.14.0). Every DRAWN piece calls ctx.translate exactly once per
    // frame (the body transform); an unborn (staggered) piece `continue`s before that, so it emits no
    // translate. `translates` counts translate() calls in record mode -- the "pieces actually drawn"
    // tally a bare position hash cannot expose. Kept OUT of `hash` (like strokes/colorHash), so every
    // committed position fingerprint is byte-identical whether or not it is read. It is the
    // non-vacuous witness that `stagger` delays births: a staggered burst draws strictly fewer pieces
    // in the early frames than a synchronous one, converging once the window elapses.
    let translates = 0;
    // Velocity-aligned-orientation PROBE (v1.15.0). `align` changes ONLY the argument to ctx.rotate;
    // it never moves ctx.translate, so it adds NOTHING to the position `hash` -- that is what makes it
    // a provable pure orientation overlay (an aligned burst reproduces the same-seed plain burst's
    // position hash EXACTLY). To still prove the rotation is deterministic and non-vacuous, `rotateHash`
    // folds the QUANTIZED angle at each rotate() call in record mode (kept OUT of `hash`, like
    // strokeHash/colorHash/translates), and `lastRotate` keeps the most recent angle -- a hash-neutral
    // DIRECTION witness (the sumX analog) so a test can assert the rotation TRACKS the velocity heading,
    // not merely "some different number".
    let rotateHash = 0 >>> 0;
    let lastRotate = 0;
    // Size-over-life PROBE (v1.17.0). `scaleTo` changes ONLY the arguments to ctx.scale; it never moves
    // ctx.translate, so it adds NOTHING to the position `hash` -- that is what makes it a provable pure
    // RENDER overlay (a scaled burst reproduces the same-seed plain burst's position hash EXACTLY). To
    // still prove the size ramp is deterministic and non-vacuous, `scaleHash` folds the QUANTIZED scale
    // factors at each scale() call in record mode (kept OUT of `hash`, exactly like rotateHash), and
    // `lastScale` keeps the most recent ISOTROPIC Y factor -- a hash-neutral witness (the lastRotate
    // analog) so a test can assert the size ramp TRACKS the life fraction (birth ~1, shrinking toward
    // scaleTo). Identity sentinel 1 (not 0): scale is multiplicative, and updateSize() folds one (1,1)
    // at construction before any burst -- deterministic, baked into every committed SCALE_HASH.
    // `lastScaleX` is the X-factor analog (v1.18.0): flutter/flutterRate live on X (the wobble), while Y
    // is the isotropic scaleTo factor, so a flutterRate test needs the X witness to see the wobble move.
    let scaleHash = 0 >>> 0;
    let lastScale = 1;
    let lastScaleX = 1;
    // Color-over-life PROBE (v1.12.0). A `lifeColors` burst moves ONLY ctx.fillStyle; it draws no
    // translate, so it adds NOTHING to the position `hash` (colorHash is kept entirely out of the mix,
    // like strokeHash/sumX/maxY -- every committed position fingerprint is byte-identical whether or
    // not this is read). To still prove the body color sequence is deterministic AND that a ramp
    // actually changes it, `colorHash` folds the current fillStyle STRING at each real paint op
    // (fill / fillRect / fillText) in record mode. A `lifeColors` burst's colorHash differs from the
    // same-seed plain burst's; the flat trail (strokeStyle) is unaffected. foldStr is a test-only
    // char-code fold (allocation here is irrelevant -- shipped code never runs it).
    let colorHash = 0 >>> 0;
    const foldStr = (h, s) => {
        for (let k = 0; k < s.length; k++) h = (Math.imul(h ^ s.charCodeAt(k), 16777619)) >>> 0;
        return h >>> 0;
    };
    let pathHash = 2166136261 >>> 0; // FNV-1a offset basis; reset per beginPath in record mode
    // Fingerprint INTEGER-pixel draw positions only. Rounding to whole pixels
    // absorbs the sub-pixel divergence libm sin/cos can show across platforms, so
    // a committed baseline is portable; rotations (radians) are deliberately not
    // hashed for the same reason. Positions still encode the full physics
    // integration (velocity, gravity, drag), so this is a strong regression tripwire.
    //
    // `assertFinite` is the torture suite's black-box NaN detector. Confetti's pool
    // is encapsulated, so a NaN that leaks into a particle's position cannot be seen
    // by reading columns -- and it would hash SILENTLY as 0 (Math.round(NaN)|0 === 0).
    // With this flag the draw path throws the instant a non-finite position appears,
    // so a NaN is loud instead of invisible. Default OFF: the committed unit-test
    // fingerprint (all-finite) is byte-identical whether or not this is enabled.
    const mix = (record || assertFinite)
        ? (x, y) => {
            if (assertFinite && !(Number.isFinite(x) && Number.isFinite(y))) {
                throw new Error('non-finite draw position: translate(' + x + ', ' + y + ')');
            }
            if (!record) return;
            hash = (Math.imul(hash ^ (Math.round(x) | 0), 16777619)) >>> 0;
            hash = (Math.imul(hash ^ (Math.round(y) | 0), 16777619)) >>> 0;
            const rx = Math.round(x) | 0; // wind drift + wall-containment probes; NOT hashed
            sumX += rx; // drift-direction probe; does NOT feed `hash`
            if (rx < minX) minX = rx;
            if (rx > maxX) maxX = rx;
            const ry = Math.round(y) | 0; // floor/ceiling-containment probe; does NOT feed `hash`
            if (ry > maxY) maxY = ry;
            if (ry < minY) minY = ry;
        }
        : null;

    // Path-point sink for moveTo/lineTo, the trail-geometry analog of `mix` for translate: under
    // assertFinite it throws on a non-finite point (a NaN trail coord is loud, not invisible);
    // under record it folds the rounded point into the current subpath's `pathHash`. Built-in
    // vector shapes (star/triangle) also call moveTo/lineTo with constant local coords, but those
    // paths are fill()ed, never stroke()d, so their pathHash is never committed to strokeHash.
    const onPathPt = (record || assertFinite)
        ? (x, y) => {
            if (assertFinite && !(Number.isFinite(x) && Number.isFinite(y))) {
                throw new Error('non-finite draw position: path point (' + x + ', ' + y + ')');
            }
            if (!record) return;
            pathHash = (Math.imul(pathHash ^ (Math.round(x) | 0), 16777619)) >>> 0;
            pathHash = (Math.imul(pathHash ^ (Math.round(y) | 0), 16777619)) >>> 0;
        }
        : null;

    const ctx = {
        fillStyle: '', strokeStyle: '', lineWidth: 1, lineJoin: '', lineCap: '',
        font: '', textAlign: '', textBaseline: '', globalAlpha: 1,
        clearRect() {},
        // Body paints: fold the current fillStyle into the color-over-life probe. Covers rect
        // (fillRect), circle (arc + fill), and star/triangle/custom-vector (fill). Sprites blit
        // via drawImage with no fillStyle, so they are intentionally not color-probed.
        fillRect() { if (record) colorHash = foldStr(colorHash, ctx.fillStyle); },
        arc() {}, fill() { if (record) colorHash = foldStr(colorHash, ctx.fillStyle); }, closePath() {},
        beginPath() { if (record) pathHash = 2166136261 >>> 0; }, // reset the subpath signature
        moveTo(x, y) { if (onPathPt) onPathPt(x, y); },
        lineTo(x, y) { if (onPathPt) onPathPt(x, y); },
        // Commit the current subpath into the trail-only strokeHash and count it. Shapes fill()
        // and so never reach here; only the trail ribbon strokes.
        stroke() { if (record) { strokeHash = (Math.imul(strokeHash ^ pathHash, 16777619)) >>> 0; strokes++; } },
        save() {}, restore() {}, setTransform() {},
        scale(x, y) {
            if (record) {
                lastScale = y;   // isotropic size factor; flutter touches X only, so Y is clean
                lastScaleX = x;   // X wobble factor (flutter/flutterRate live on X; Y is the isotropic scaleTo factor)
                // Quantize each factor (round to 1/4096) before folding, mirroring the rotate() precedent
                // so the fingerprint is stable across runs. Kept out of `hash`, like rotateHash.
                scaleHash = (Math.imul(scaleHash ^ (Math.round(x * 4096) | 0), 16777619)) >>> 0;
                scaleHash = (Math.imul(scaleHash ^ (Math.round(y * 4096) | 0), 16777619)) >>> 0;
            }
        },
        drawImage() {},
        translate(x, y) { if (record) translates++; if (mix) mix(x, y); },
        rotate(a) {
            if (record) {
                lastRotate = a;
                // Quantize the angle (round to 1/4096 rad) before folding, mirroring the translate
                // `Math.round` precedent so the fingerprint is stable across runs. Kept out of `hash`.
                rotateHash = (Math.imul(rotateHash ^ (Math.round(a * 4096) | 0), 16777619)) >>> 0;
            }
        },
        fillText() { if (record) colorHash = foldStr(colorHash, ctx.fillStyle); globalThis.__fillTextCount = (globalThis.__fillTextCount || 0) + 1; },
        canvas: c,
    };
    c.getContext = () => ctx;
    Object.defineProperty(c, 'hash', { get() { return hash >>> 0; } });
    Object.defineProperty(c, 'sumX', { get() { return sumX; } });
    Object.defineProperty(c, 'maxY', { get() { return maxY; } });
    Object.defineProperty(c, 'minX', { get() { return minX; } });
    Object.defineProperty(c, 'maxX', { get() { return maxX; } });
    Object.defineProperty(c, 'minY', { get() { return minY; } });
    Object.defineProperty(c, 'strokeHash', { get() { return strokeHash >>> 0; } });
    Object.defineProperty(c, 'strokes', { get() { return strokes; } });
    Object.defineProperty(c, 'translates', { get() { return translates; } });
    Object.defineProperty(c, 'rotateHash', { get() { return rotateHash >>> 0; } });
    Object.defineProperty(c, 'lastRotate', { get() { return lastRotate; } });
    Object.defineProperty(c, 'scaleHash', { get() { return scaleHash >>> 0; } });
    Object.defineProperty(c, 'lastScale', { get() { return lastScale; } });
    Object.defineProperty(c, 'lastScaleX', { get() { return lastScaleX; } });
    Object.defineProperty(c, 'colorHash', { get() { return colorHash >>> 0; } });
    return c;
}

const _doc = {
    createElement(tag) { return tag === 'canvas' ? makeCanvas() : { style: {} }; },
    getElementById() { return null; },
    body: { appendChild() {} },
};

globalThis.window = _win;
globalThis.document = _doc;
globalThis.ResizeObserver = class {
    constructor(cb) { this._cb = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
};
