# @zakkster/lite-confetti

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-confetti.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-confetti)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-confetti?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-confetti)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-confetti?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-confetti)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-confetti?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-confetti)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

Deterministic confetti engine with OKLCH colors, 5 shapes, and reduced-motion support.

**The confetti library that canvas-confetti wishes it was.**

**[→ Live Interactive Playground](https://codepen.io/Zahari-Shinikchiev/debug/dPpzGLG)**

## Why lite-confetti?

| Feature | lite-confetti | canvas-confetti | react-confetti | party.js |
|---|---|---|---|---|
| **Deterministic (seeded)** | **Yes** | No | No | No |
| **OKLCH colors** | **Yes** | No | No | No |
| **Reduced motion** | **Yes (auto)** | No | No | No |
| **Shapes** | **5 (rect, circle, star, triangle, emoji)** | 2 | 2 | 3 |
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
| `drag` | number | 0.98 | Per-frame velocity retention (0–1). 0.98 = 2% speed loss per frame. |
| `sizeMin` | number | 5 | Minimum particle width in CSS pixels |
| `sizeMax` | number | 12 | Maximum particle width in CSS pixels |
| `lifeMin` | number | 1.5 | Minimum particle lifetime in seconds |
| `lifeMax` | number | 3.0 | Maximum particle lifetime in seconds |
| `shape` | string | `'rect'` | Particle shape: `'rect'`, `'circle'`, `'star'`, `'triangle'`, `'emoji'` |
| `emoji` | string | `'🎉'` | Emoji character (only used when `shape` is `'emoji'`) |
| `colors` | Array | 7 OKLCH defaults | Array of OKLCH objects `{ l, c, h }` or CSS strings |
| `angle` | number | `-Math.PI / 2` | Center angle of emission cone in radians. -π/2 = upward. |
| `onComplete` | Function | — | Called when all burst particles have died |

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
1. GRAVITY     vy += gravity × dt        (downward acceleration)
2. DRAG        vx *= drag, vy *= drag    (air resistance)
3. POSITION    x += vx × dt, y += vy × dt
4. SPIN        rotation += spinVelocity × dt
5. TILT        tiltPhase += tiltSpeed × dt
6. OPACITY     fade to 0 in last 30% of life
7. RENDER      translate → rotate → wobble-scale → draw shape
```

### Rotation & 3D Tumbling

Each particle has two rotational properties:

**Spin** — continuous rotation around the particle's center. Angular velocity is randomized at spawn: `(rng.next() - 0.5) * 10` radians/second. This produces particles spinning between -5 and +5 rad/s — some clockwise, some counterclockwise, all at different speeds.

**Tilt** — a wobble phase that drives a cosine-based X-scale oscillation: `wobbleScale = 0.5 + |cos(tiltPhase)| × 0.5`. This makes particles appear to tumble in 3D — they visually "flip" as the cosine oscillates, creating the illusion of a thin piece of paper turning in space. Tilt speed is randomized between 1 and 5 rad/s per particle.

The combination of spin rotation + tilt wobble produces the realistic confetti tumbling you see in the real world.

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
