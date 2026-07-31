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
 * the context accumulates a position/rotation fingerprint over `translate` and
 * `rotate` calls -- the per-particle draw transform -- readable as `canvas.hash`,
 * which is how the determinism gate proves seeded replays are byte-identical
 * without reaching into private pool arrays.
 */
export function makeCanvas({ record = false, assertFinite = false } = {}) {
    const c = { style: {}, parentElement: null, width: 0, height: 0, id: '' };
    Object.defineProperty(c, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(c, 'clientHeight', { value: 600, configurable: true });
    // Offset, unscaled canvas -- exercises the viewport->canvas coordinate mapping.
    c.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600 });
    c.remove = () => {};

    let hash = 0 >>> 0;
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
        }
        : null;

    const ctx = {
        fillStyle: '', font: '', textAlign: '', textBaseline: '', globalAlpha: 1,
        clearRect() {}, fillRect() {}, beginPath() {}, arc() {}, fill() {}, closePath() {},
        moveTo() {}, lineTo() {}, save() {}, restore() {}, scale() {}, setTransform() {},
        drawImage() {},
        translate(x, y) { if (mix) mix(x, y); },
        rotate() {},
        fillText() { globalThis.__fillTextCount = (globalThis.__fillTextCount || 0) + 1; },
        canvas: c,
    };
    c.getContext = () => ctx;
    Object.defineProperty(c, 'hash', { get() { return hash >>> 0; } });
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
