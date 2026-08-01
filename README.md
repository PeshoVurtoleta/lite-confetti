# @zakkster/lite-confetti

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-confetti.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-confetti)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-confetti?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-confetti)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-confetti?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-confetti)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-confetti?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-confetti)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

Deterministic confetti engine with OKLCH colors, 5 built-in shapes plus custom
`registerShape()` shapes (vector or image sprite), per-particle multi-shape mixing,
tunable flutter, lateral wind, a settle floor with bounce, and reduced-motion support.

**The confetti library that canvas-confetti wishes it was.**

**[→ Live Interactive Playground](https://codepen.io/Zahari-Shinikchiev/debug/dPpzGLG)**

## Why lite-confetti?

| Feature | lite-confetti | canvas-confetti | react-confetti | party.js |
|---|---|---|---|---|
| **Deterministic (seeded)** | **Yes** | No | No | No |
| **OKLCH colors** | **Yes** | No | No | No |
| **Reduced motion** | **Yes (auto)** | No | No | No |
| **Shapes** | **5 built-in + custom (registerShape: vector or sprite)** | 2 | 2 | 3 |
| **Spray mode** | **Yes** | No | No | No |
| **Shared ticker** | **Yes** | Own RAF | Own RAF | Own RAF |
| **SoA flat arrays** | **Yes** | No | No | No |
| **Timeline composable** | **Yes** | No | No | No |
| **Zero-GC hot path** | **Yes** | No | No | No |
| **ResizeObserver** | **Yes** | window.resize | No | No |
| **Bundle size** | **< 4KB** | ~6KB | ~5KB | ~8KB |

## Installation

```bash
npm install @zakkster/lite-confetti
```

## Quick Start

### One-Liner (Fire and Forget)

```javascript
import { confetti } from '@zakkster/lite-confetti';

// Creates overlay canvas, fires burst, cleans up automatically
confetti();
```

### Full Control

```javascript
import { createConfetti } from '@zakkster/lite-confetti';

const c = createConfetti(overlayCanvas, { seed: 42 });

c.burst({ count: 80, spread: 1.2, shape: 'star' });
c.burst({ x: 200, y: 100, shape: 'emoji', emoji: '🎊', count: 30 });

// Later
c.seed(42);  // reset for deterministic replay
c.destroy();
```

---

## Full Options Reference

### Burst Options

Every parameter is optional. Sensible defaults produce a beautiful upward confetti burst.

| Option | Type | Default | Description |
|---|---|---|---|
| `x` | number | canvas center | Burst origin X position (CSS pixels) |
| `y` | number | canvas height × 0.33 | Burst origin Y position (CSS pixels) |
| `count` | number | 80 | Number of particles to spawn |
| `spread` | number | 1.2 | Emission cone width in radians (π = half-circle) |
| `speed` | number | 400 | Initial particle speed center (px/s) |
| `speedVariance` | number | 200 | Speed randomness range. Actual speed: `speed ± speedVariance` |
| `gravity` | number | 600 | Downward acceleration in px/s². Higher = falls faster. |
| `wind` | number | 0 | Lateral acceleration in px/s² — the sideways mirror of `gravity`. Positive drifts right, negative left. Opt-in; `0` = straight down. See [Wind](#wind--lateral-drift). |
| `floor` | number | Infinity | Settle-boundary Y in CSS px. Particles that reach it land on the line instead of falling forever. Opt-in; `Infinity` = no floor. See [Floor](#floor--settle--bounce). |
| `bounce` | number | 0 | Restitution `0–1` on floor contact: `0` rests (pile-up), `1` is perfectly elastic. Only with a finite `floor`. |
| `drag` | number | 0.98 | Per-frame velocity retention, clamped to `0–1`. 0.98 = 2% speed loss per frame. |
| `sizeMin` | number | 5 | Minimum particle width in CSS pixels |
| `sizeMax` | number | 12 | Maximum particle width in CSS pixels |
| `lifeMin` | number | 1.5 | Minimum particle lifetime in seconds |
| `lifeMax` | number | 3.0 | Maximum particle lifetime in seconds |
| `shape` | string | `'rect'` | `'rect'`, `'circle'`, `'star'`, `'triangle'`, `'emoji'`, or a name from `registerShape()`. Unknown names fall back to `'rect'`. |
| `shapes` | string[] | — | Mix multiple shapes in one burst, chosen per particle. Repetition weights the mix. Overrides `shape`; unknown names are dropped. See [Mixing shapes](#mixing-shapes). |
| `emoji` | string | party popper | Emoji character (only used when `shape` is `'emoji'`) |
| `flutter` | number | 1 | Tumble depth, 0–1. `1` = full wobble (classic), `0` = rigid. Affects scale only, never position. |
| `sway` | number | 0 | Horizontal drift, 0–1. `0` = straight fall; higher values sway side-to-side like real paper. |
| `colors` | Array | 7 OKLCH defaults | Array of OKLCH objects `{ l, c, h }` or CSS strings |
| `angle` | number | `-Math.PI / 2` | Center angle of emission cone in radians. -π/2 = upward. |
| `onComplete` | Function | — | Called when all burst particles have died |

**Inputs fail closed.** Every numeric option is sanitised before it can reach a particle: a non-finite value (`NaN`/`Infinity`, or a stray non-number) coerces to its default, `drag` clamps to `0–1`, and a `null`/empty `colors` falls back to the defaults. A call-time typo degrades gracefully — it never throws mid-animation or paints a `NaN` position — the same fail-closed stance as an unknown `shape` name falling back to `'rect'`. (`registerShape` is the one exception: a bad shape *definition* throws, because it is setup, not a per-call tunable.)

### Spray Options

Spray accepts all burst options plus:

| Option | Type | Default | Description |
|---|---|---|---|
| `duration` | number | 1000 | Spray duration in milliseconds |
| `rate` | number | 5 | Particles spawned per frame |
| `followPointer` | boolean | false | Stream follows the live pointer inside this canvas (see below) |

### createConfetti Options

| Option | Type | Default | Description |
|---|---|---|---|
| `seed` | number | `Date.now()` | RNG seed for deterministic output |
| `maxParticles` | number | 500 | Pool size (ring buffer — overwrites oldest when full) |
| `respectReducedMotion` | boolean | true | Honor `prefers-reduced-motion: reduce` |

---

## Particle Physics Pipeline

Every frame, each alive particle runs through this pipeline:

```
1.  GRAVITY     vy += gravity × dt        (downward acceleration)
2.  WIND        vx += wind × dt           (opt-in lateral acceleration)
3.  DRAG        vx *= drag, vy *= drag    (air resistance)
4.  POSITION    x += vx × dt, y += vy × dt
5.  FLOOR       if y > floor: y = floor, vy = −vy × bounce   (opt-in settle boundary)
6.  SWAY        x += sin(tiltPhase) × sway × dt   (opt-in horizontal drift)
7.  SPIN        rotation += spinVelocity × dt
8.  TILT        tiltPhase += tiltSpeed × dt
9.  OPACITY     fade to 0 in last 30% of life
10. RENDER      translate → rotate → flutter-scale → draw shape
```

### Rotation & 3D Tumbling

Each particle has two rotational properties:

**Spin** — continuous rotation around the particle's center. Angular velocity is randomized at spawn: `(rng.next() - 0.5) * 10` radians/second. This produces particles spinning between -5 and +5 rad/s — some clockwise, some counterclockwise, all at different speeds.

**Tilt** — a wobble phase that drives a cosine-based X-scale oscillation. The **`flutter`** option sets its depth: `wobbleScale = 1 − flutter × 0.5 × (1 − |cos(tiltPhase)|)`. At `flutter: 1` (the default) this is the classic `0.5 + |cos| × 0.5`, making particles "flip" like a thin piece of paper turning in space; at `flutter: 0` they stay rigid. Tilt speed is randomized between 1 and 5 rad/s per particle. Because flutter scales only, it never moves a particle — output stays byte-identical under a fixed seed regardless of its value.

**Sway** — the opt-in **`sway`** option adds a horizontal drift driven by the same tilt phase, so pieces drift side-to-side as they fall (real confetti rarely falls straight). It defaults to `0`, which keeps the exact straight-fall positions of earlier versions.

The combination of spin rotation + flutter wobble (+ optional sway) produces the realistic confetti tumbling you see in the real world.

### Wind / lateral drift

**`wind`** (added in v1.5.0) is a lateral acceleration in px/s² — the sideways mirror of `gravity`. Where `sway` *oscillates* around the fall line and nets to zero, `wind` is a sustained force: the whole burst drifts. Because it shares gravity's units, `gravity` (down) and `wind` (across) read as one 2D force vector.

```js
c.burst({ wind: 300 });                    // a burst slanting to the right
c.burst({ wind: -200, gravity: 250 });     // drifting left as it falls
c.burst({ ...presets.snow, wind: 60 });    // snow on a gentle breeze
```

Wind is applied *before* drag, so — exactly like gravity's terminal fall speed — a particle approaches a terminal lateral velocity rather than accelerating forever. It defaults to `0` and the integrator skips the term entirely at `0`, so a default burst does no extra work and its seeded positions stay byte-identical (the committed determinism fingerprint is preserved). A windy burst draws no random values, so it too replays identically under a fixed seed. Wind has no effect under reduced motion (the static render has no velocity to push).

### Floor / settle & bounce

Where `gravity` and `wind` set the *force*, **`floor`** (added in v1.6.0) sets the *boundary*: a settle line, given as an absolute Y in CSS px, that a falling particle lands on instead of dropping forever. **`bounce`** is its restitution — `0` rests the piece on the line (confetti piles up), `1` reflects its vertical velocity perfectly (a lively rebound), anything between damps out.

```js
c.burst({ y: 0, floor: innerHeight - 20 });                 // confetti settles at the bottom
c.burst({ y: 0, floor: innerHeight - 20, bounce: 0.5 });    // …and bounces on the way down
c.spray({ floor: 400, bounce: 0.3, duration: 1500 });       // a spray that piles up on a shelf
```

On contact the particle is clamped onto the floor and its `vy` is reflected, scaled by `bounce`. Restitution is clamped to `0–1` so a rebound can never *add* energy, and drag still damps `vy` every frame, so even `bounce: 1` loses energy and eventually rests — never a runaway. `floor` defaults to `Infinity`, and the integrator's collision branch (`if (y > floor)`) can never fire at that default, so a floor-less burst does no extra work and its seeded positions stay byte-identical (the committed determinism fingerprint is preserved). Like wind, the collision draws no random values, so a floored burst replays identically under a fixed seed. Floor has no effect under reduced motion (the static render does no integration to collide).

### Canvas Sizing

lite-confetti uses **ResizeObserver** (not polling) to track canvas dimensions. The observer watches the canvas's parent element, RAF-deduped to prevent double-fire. `clientWidth` / `clientHeight` are never read in the hot loop — only cached `cw` / `ch` variables are used during rendering. This prevents layout thrashing at 60fps.

---

## Shapes

| Shape | Description |
|---|---|
| `'rect'` | Classic confetti rectangle (default). Height varies 40–100% of width for natural variation. |
| `'circle'` | Round confetti dots |
| `'star'` | 5-pointed star with 40% inner radius |
| `'triangle'` | Equilateral triangle piece |
| `'emoji'` | Any emoji character — set via `emoji` option (e.g. `'🌟'`, `'🎊'`, `'❤️'`) |

Emoji shapes are rendered through a **glyph atlas**: each unique emoji is rasterized once to a small offscreen canvas the first time it is used, then drawn per particle as a cheap `drawImage` blit. This keeps a burst of hundreds of emoji particles as cheap as any other shape. (Earlier versions set `ctx.font` and called `fillText` per particle per frame, which re-rasterized the colour glyph every time — a burst of many emoji could stall the main thread.)

### Custom shapes — `registerShape(name, def)`

Register your own shape on an instance, then use it as `burst({ shape: name })`. Shapes are **per-instance**: they are invisible to other instances and released on `destroy()`, so registration never leaks across instances and determinism stays sealed to the seed.

```js
const c = createConfetti(canvas);

// 1. A VECTOR shape — a draw function. The engine sets fillStyle to the particle's
//    colour before calling, so a plain fill() is coloured for you. Drawn centred at (0,0).
c.registerShape('heart', (ctx, w) => {
  const s = w / 16;
  ctx.beginPath();
  ctx.moveTo(0, 4 * s);
  ctx.bezierCurveTo(-7 * s, -3 * s, -3 * s, -8 * s, 0, -3 * s);
  ctx.bezierCurveTo(3 * s, -8 * s, 7 * s, -3 * s, 0, 4 * s);
  ctx.fill();
});
c.burst({ shape: 'heart', count: 80 });

// 2. An IMAGE SPRITE — prerendered once, then blitted per particle (same fast path as emoji).
const logo = new Image();
logo.src = '/logo.png';
c.registerShape('logo', { image: logo });     // an <img>, a <canvas>, or an ImageBitmap
c.spray({ shape: 'logo', duration: 1500 });
```

`registerShape` returns the assigned shape id (`>= 5`; built-ins keep `0–4`). Re-registering a custom name replaces it and keeps its id. It **fails closed** — an empty/non-string name, a built-in override (`'rect'`, `'emoji'`, …), or a malformed `def` throws. A typo'd `shape` name at `burst()` time does not throw; it falls back to `'rect'`.

### Mixing shapes

Pass `shapes` (plural) to mix several shapes in **one** burst — each particle picks its own, so you get a confetti spread of stars *and* circles *and* rectangles without firing three overlapping bursts:

```js
c.burst({ shapes: ['star', 'circle', 'rect'] });

// Repetition weights the mix — this is ~2:1 stars to circles:
c.burst({ shapes: ['star', 'star', 'circle'] });

// Custom registerShape() names compose for free:
c.registerShape('logo', { image: logo });
c.burst({ shapes: ['rect', 'logo', 'star'] });
```

`shapes` overrides the singular `shape`. It **fails closed** the same way everything else does: unknown names are dropped, and an empty / non-array / all-unknown `shapes` falls back to `shape`. Mixing is deterministic under a seed and per-instance (a `shapes` entry naming another instance's custom shape is dropped, never borrowed). Omitting `shapes` is free — the single-shape path is byte-for-byte unchanged, committed fingerprint and all.

Custom shapes go through the same zero-allocation dispatch as the built-ins — the torture gate proves a live pool of a custom vector shape + an image sprite renders at ~0 bytes/frame.

---

## Presets

Four drop-in configs for iconic effects. Spread them into `burst()` or `spray()`:

```js
import { createConfetti, presets } from '@zakkster/lite-confetti';

const c = createConfetti(canvas, { seed: 1 });
c.burst({ ...presets.fireworks });          // stars, explosive, upward
c.burst({ ...presets.cannons, x: 0 });      // angled launch — override origin
c.spray({ ...presets.snow, duration: 8000 }); // gentle falling, long life
c.burst({ ...presets.pride });              // OKLCH rainbow palette baked in
```

Because a preset is just an options object, anything you add after the spread wins — `{ ...presets.snow, gravity: 200 }` keeps the snow look but drops faster. Every preset's `shape` is one of the five the engine renders, and every preset stays deterministic under a fixed seed (the test suite checks both).

## Palette import (lite-hueforge)

`colorsFromPalette()` turns a [lite-hueforge](https://github.com/PeshoVurtoleta/lite-hueforge) `toGradientStops()` result straight into a `colors` array:

```js
import { colorsFromPalette } from '@zakkster/lite-confetti';
import { toGradientStops } from '@zakkster/lite-hueforge';

const stops = toGradientStops(myPalette);        // [{ color: {l,c,h}, stop }, ...]
c.burst({ colors: colorsFromPalette(stops), count: 120 });
```

It also accepts a `{ stops }` wrapper, a plain colors array (pass-through), or a single color. It **never returns an empty array** — an empty `colors` would make the picker paint nothing, so bad input falls back to the default palette.

## Burst from an element

`fromElement()` reads `getBoundingClientRect()` **once** and returns the element's centre as a burst origin:

```js
import { fromElement, presets } from '@zakkster/lite-confetti';

button.addEventListener('click', () => {
  confetti(fromElement(button, { ...presets.cannons }));
});
```

**Coordinate space matters.** The returned `x`/`y` are in *viewport* coordinates — correct as-is for a full-screen overlay canvas (what `confetti()` creates, and what most apps use). For an **inline or offset** canvas, subtract that canvas's own rect:

```js
const o = fromElement(button);
const cr = canvas.getBoundingClientRect();
c.burst({ x: o.x - cr.left, y: o.y - cr.top, count: 60 });
```

## Pointer-follow spray

`spray({ followPointer: true })` makes the stream chase the pointer inside the canvas:

```js
c.spray({ ...presets.fireworks, duration: 4000, followPointer: true });
```

The pointer is tracked by a **passive** listener that binds only while a follow-spray is running, and unbinds when it ends (or on `destroy()`). Nothing is installed at import time, so a page that never follows the pointer pays nothing. Coordinates are converted from viewport space into the canvas's own space, so it works for inline and CSS-scaled canvases, not just full-screen overlays.

One caveat, by design: **pointer-follow is not deterministic** — it injects live pointer positions the seed can't know. It consumes no RNG draw, so a *non*-following spray still replays identically from a seed; a following one won't.

## Recipes

<details>
<summary><strong>Checkout Success</strong></summary>

```javascript
import { confetti } from '@zakkster/lite-confetti';

submitBtn.addEventListener('click', () => {
    confetti({
        count: 100,
        spread: 1.5,
        colors: [
            { l: 0.7, c: 0.25, h: 130 }, // green
            { l: 0.8, c: 0.2, h: 60 },   // gold
        ],
    });
});
```

</details>

<details>
<summary><strong>Emoji Rain</strong></summary>

```javascript
const c = createConfetti(canvas);
c.spray({
    shape: 'emoji',
    emoji: '🌟',
    duration: 2000,
    rate: 4,
    gravity: 300,
    speed: 100,
});
```

</details>

<details>
<summary><strong>Heavy Snowfall (Low Gravity, High Drag)</strong></summary>

```javascript
const c = createConfetti(canvas);
c.spray({
    shape: 'circle',
    rate: 3,
    duration: 5000,
    gravity: 80,
    drag: 0.995,
    speed: 50,
    speedVariance: 30,
    sizeMin: 2,
    sizeMax: 5,
    spread: Math.PI,
    angle: Math.PI / 2,
    colors: [{ l: 0.95, c: 0.01, h: 220 }],
});
```

</details>

<details>
<summary><strong>Explosive Side Cannon</strong></summary>

```javascript
confetti({
    x: 0,
    y: window.innerHeight,
    angle: -Math.PI / 4,
    spread: 0.4,
    speed: 800,
    gravity: 400,
    count: 60,
    shape: 'star',
});
```

</details>

<details>
<summary><strong>Timeline Integration</strong></summary>

```javascript
import { createTimeline } from '@zakkster/lite-timeline';
import { confetti } from '@zakkster/lite-confetti';
import { easeOut } from '@zakkster/lite-lerp';

const tl = createTimeline();

tl.add({ duration: 400, ease: easeOut, onUpdate: t => {
    modal.style.opacity = t;
}})
.add({ duration: 0, onComplete: () => confetti({ y: 200, shape: 'star' }) })
.play();
```

</details>

<details>
<summary><strong>Deterministic Replay</strong></summary>

```javascript
const c = createConfetti(canvas, { seed: 42 });
c.burst({ count: 50 });

c.seed(42);
c.burst({ count: 50 }); // exact same output
```

</details>

<details>
<summary><strong>Brand-Colored Confetti with lite-theme-gen</strong></summary>

```javascript
import { generateTheme } from '@zakkster/lite-theme-gen';
import { confetti } from '@zakkster/lite-confetti';

const theme = generateTheme({ l: 0.6, c: 0.25, h: 280 });

confetti({
    colors: [theme.accent, theme['accent-300'], theme['accent-700']],
    shape: 'circle',
    count: 60,
});
```

</details>

---

## Reduced Motion

lite-confetti automatically detects `prefers-reduced-motion: reduce`. When active:

- Particles appear **instantly** at their spread positions (no flight animation)
- Hold for **1.5 seconds** so users see the celebration
- **Fade out** gracefully via CSS opacity transition
- `onComplete` still fires

Zero developer effort required. Just call `confetti()` and it works for everyone.

---

## API

### `confetti(options?)` — Fire and forget

Creates a temporary overlay canvas, fires a burst, cleans up automatically when all particles die.

### `createConfetti(canvas, options?)` — Full control

| Method | Description |
|---|---|
| `.burst(options?)` | Classic burst. See full options table above. |
| `.spray(options?)` | Continuous stream. Supports `followPointer`. See spray options above. |
| `.clear()` | Kill all particles immediately |
| `.count` | Number of alive particles (getter) |
| `.seed(n)` | Reset RNG for deterministic replay |
| `.destroy()` | Clean up everything. Disconnects ResizeObserver + any pointer listener. Idempotent. |

### Named exports

| Export | Description |
|---|---|
| `presets` | `{ fireworks, cannons, snow, pride }` — drop-in configs to spread into burst/spray. |
| `colorsFromPalette(input)` | lite-hueforge gradient stops (or a palette) → a `colors` array. |
| `fromElement(el, extra?)` | Element centre as a burst origin (viewport coords), measured once. |

---

## Changelog

Full history in [CHANGELOG.md](./CHANGELOG.md).

### v1.6.0

**Floor / settle & bounce.** Opt-in and fingerprint-safe; the fall-forever default and committed determinism fingerprint are byte-for-byte unchanged.

- `floor: number` on `burst()`/`spray()` — a settle-boundary Y in CSS px; a particle that reaches it is clamped onto the line instead of falling forever (default `Infinity` = no floor).
- `bounce: number` — restitution `0–1` reflecting `vy` on floor contact (`0` rests/piles up, `1` elastic); clamped so a rebound can never add energy, and drag still damps it to rest. Draws no rng; fails closed (garbage `floor` → `Infinity`); no effect under reduced motion. See [Floor](#floor--settle--bounce).

### v1.5.0

**Wind / lateral drift.** Opt-in and fingerprint-safe; the straight-fall default and committed determinism fingerprint are byte-for-byte unchanged.

- `wind: number` on `burst()`/`spray()` — a sustained lateral acceleration in px/s², the sideways mirror of `gravity` (positive drifts right, negative left). Applied before drag, so it approaches a terminal lateral velocity. Fails closed (garbage → `0`); no effect under reduced motion. See [Wind](#wind--lateral-drift).

### v1.4.0

**Multi-shape mixing.** Opt-in and fingerprint-safe; the single-shape path and committed determinism fingerprint are byte-for-byte unchanged.

- `shapes: string[]` on `burst()`/`spray()` — mix multiple shapes in one burst, chosen per particle (repetition weights the mix). Custom `registerShape()` names compose. Overrides `shape`; unknown names are dropped (fail closed). See [Mixing shapes](#mixing-shapes).

### v1.3.1

**Fail-closed input validation + count fix.** No new public API; default look and the
committed determinism fingerprint unchanged.

- Every numeric `burst()`/`spray()` option is sanitised — a non-finite value coerces to its default, `drag` clamps to `0–1`, `null`/empty `colors` falls back to defaults. Fixes: `speed: NaN` drawing a `NaN` position, `lifeMax: NaN` making a particle immortal, `colors: null` throwing.
- `destroy()` now zeroes the `.count` getter (was left reporting the last integrated count).

### v1.3.0

**Custom shapes + tunable flutter/sway.**

- `registerShape(name, def)` — per-instance, seed-sealed custom **vector** or **image-sprite** shapes, usable as `burst({ shape: name })`. Fails closed on a bad name/def.
- `flutter` (0–1, tumble depth, scale-only) and `sway` (0–1, horizontal drift). Defaults reproduce the pre-1.3.0 look and fingerprint exactly.

### v1.2.0

**Presets + palette import + pointer-follow.**

- `presets.fireworks / cannons / snow / pride` — named configs, spread into `burst()`/`spray()`. Every shape is engine-valid and every preset stays seed-deterministic.
- `colorsFromPalette()` — consumes lite-hueforge `toGradientStops()` (and `{ stops }`, plain arrays, single colors) directly. Never yields an empty array.
- `fromElement(el)` — burst origin from `getBoundingClientRect()`, once. Documented viewport-vs-canvas coordinate handling.
- `spray({ followPointer: true })` — per-instance, opt-in, passive listener bound only while active and released on end/destroy. Coordinates converted into the canvas's own space. Non-deterministic by nature; consumes no RNG draw.

### v1.1.0

**Performance: Zero-GC OKLCH rendering**

Moved `toCssOklch()` color conversion out of the render loop entirely. Colors are now pre-parsed to CSS strings once per `burst()` / `spray()` call, before any particles spawn. The render loop reads pre-computed string references with zero allocation.

Before (v1.0.0 — inside render loop, runs every frame for every particle):
```javascript
ctx.fillStyle = typeof c === 'string' ? c : toCssOklch(c);  // 30,000 strings/sec
```

After (v1.1.0 — inside burst/spray, runs once per call):
```javascript
const parsedColors = colors.map(c => typeof c === 'string' ? c : toCssOklch(c));
// render loop:
ctx.fillStyle = colorsArr[i];  // pure reference, zero allocation
```

**Stability: Identity matrix reset on canvas resize**

Enforced strict `setTransform(1,0,0,1,0,0)` identity reset before applying DPR scaling in `updateSize()`. Prevents potential cumulative scaling bugs when the canvas resizes multiple times during its lifecycle.

```javascript
ctx.setTransform(1, 0, 0, 1, 0, 0);  // 1. Reset to identity
ctx.scale(dpr, dpr);                   // 2. Apply exact DPR
```

**Stability: RAF-debounced ResizeObserver**

Added `requestAnimationFrame` batching to the `ResizeObserver` callback. No matter how many times the observer fires during a CSS Grid/Flex reflow, `updateSize()` executes at most once per frame — preventing layout thrashing.


## License

MIT
