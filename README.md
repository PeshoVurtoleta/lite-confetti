# @zakkster/lite-confetti

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-confetti.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-confetti)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-confetti?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-confetti)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-confetti?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-confetti)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-confetti?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-confetti)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

Deterministic confetti engine with OKLCH colors, 5 built-in shapes plus custom
`registerShape()` shapes (vector or image sprite), per-particle multi-shape mixing,
tunable flutter, lateral wind, turbulence + gust (living-air forces), a vortex/attractor
point force, a full bounding box (floor, walls, ceiling) with bounce, settle-and-pile,
zero-GC motion trails, color-over-life ramps, spawn emitter shapes (line / ring / box),
staggered emission (a burst cascades in over a ms window), velocity-aligned orientation
(pieces bank broadside to their flight, like leaves), tunable tumble speed (slow drift to
reverse spin), size-over-life ramps (shrink-out / bloom), tunable wobble speed (lazy flutter
to fast shimmer), birth-opacity ramps (materialize-in), and reduced-motion support.

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
| `bounce` | number | 0 | Restitution `0–1` on **any** boundary contact (floor and walls alike): `0` rests (pile-up), `1` is perfectly elastic. Shared by the whole [bounding box](#bounding-box). |
| `settle` | number | 0 | Rest-speed threshold in px/s. A piece whose post-bounce speed drops below it **freezes** on the `floor` and piles up (keeps aging + fades). Opt-in; `0` = off. Needs a `floor`. See [Settle & pile](#settle--pile). |
| `friction` | number | 0 | Tangential **floor** drag `0–1`. On each floor-contact frame, the horizontal velocity is bled by `1 - friction` (the complement to `bounce`, which reflects the vertical component): `0` = frictionless (default), `1` = full grip (horizontal stop on contact), `0.2` = a long skid. Opt-in; needs a `floor`. A physics knob (it moves the position fingerprint). See [Friction](#friction). |
| `wallFriction` | number | 0 | Tangential drag `0–1` on the box's three **non-floor** edges — the tangential twin of `friction` (which covers the floor) and the analog to `bounce`'s one shared restitution. On a non-floor-edge contact it bleeds the *tangential* velocity (the ceiling damps horizontal `vx`, each wall damps vertical `vy` — always the component `bounce` does **not** reflect there, so it never cancels the rebound). Opt-in; needs a box. A physics knob (it moves the position fingerprint). See [Friction](#friction). |
| `wallLeft` | number | -Infinity | Left wall X in CSS px — the X-min edge of the [bounding box](#bounding-box). Particles reaching it clamp and reflect `vx`. Opt-in; `-Infinity` = no wall. |
| `wallRight` | number | Infinity | Right wall X in CSS px — the X-max edge. Opt-in; `Infinity` = no wall. |
| `ceiling` | number | -Infinity | Ceiling Y in CSS px — the Y-min edge, the mirror of `floor`. Particles rising past it clamp and reflect `vy`. Opt-in; `-Infinity` = no ceiling. |
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
| `turbulence` | number | 0 | Per-particle rotating acceleration in px/s² — organic wander, so a burst fans out and mills. Opt-in; `0` = none. Draws no rng. See [Living air](#living-air). |
| `gust` | number | 0 | Global oscillating horizontal acceleration in px/s² layered on `wind` — the whole burst swells side to side in ~3s waves. Opt-in; `0` = none. See [Living air](#living-air). |
| `gustRate` | number | `GUST_HZ` | Gust **swell frequency** — the speed knob to `gust`'s depth (the mirror `gust:gustRate :: flutter:flutterRate`). `6` triples the swell rate (a fast breeze), `0.5` a long ocean roll, `0` freezes the phase (inert — the gust force collapses to `sin(0) = 0`), a **negative** reverses the phase (the breeze leans the other way first). Default `GUST_HZ` (= `TAU/3`, today's baked ~3s swell). Read only inside the `gust != 0` branch, so a gust-off burst is byte-identical for any value. Coerced with `num` (signed — a frequency has a direction): non-finite → the default (off); no upper cap. A **physics** knob (it moves the position fingerprint). Honored by `burst()` **and** `spray()`; zero-rng; inert under reduced motion. See [Living air](#living-air). |
| `attract` | number | 0 | Vortex radial spring strength (1/s², scaled by distance): `+` pulls toward the center, `−` repels. Opt-in; `0` = none. See [Vortex](#vortex). |
| `swirl` | number | 0 | Vortex tangential strength (1/s²): spins particles around the center; sign = spin direction. Opt-in; `0` = none. See [Vortex](#vortex). |
| `attractX` | number | burst x | Vortex center X (CSS px). Defaults to the burst origin. |
| `attractY` | number | burst y | Vortex center Y (CSS px). Defaults to the burst origin. |
| `trail` | number | capacity | Per-particle trail length `0..capacity` — how many recent positions this burst's ribbon spans. Needs a construction `trail` budget; ignored without one. `0` opts a burst out. See [Motion trails](#motion-trails). |
| `colors` | Array | 7 OKLCH defaults | Array of OKLCH objects `{ l, c, h }` or CSS strings |
| `lifeColors` | Array | — | Multi-stop OKLCH life ramp (≥ 2 stops, birth-color first). The **body** sweeps it as each piece ages (sparks cooling white→red); the trail stays the flat `colors` pick. Opt-in; invalid falls back to flat. See [Color over life](#color-over-life). |
| `emit` | string | — | Spawn-origin shape: `'line'` (horizontal curtain), `'ring'` (firework shell, velocity radial-outward), or `'box'` (square area), sized by `emitSize`. Default: a single point. Opt-in; unknown / `emitSize ≤ 0` = point spawn. See [Emitter shapes](#emitter-shapes). |
| `emitSize` | number | — | Emitter extent in px: line half-length / ring radius / box square half-extent. Needs a shape in `emit`; `≤ 0` or non-finite = point spawn. |
| `stagger` | number | — | Staggered-emission window in ms: spread the `count` births evenly over it (piece `i` wakes at `stagger·i/count`), so the burst cascades in instead of appearing at once. **Burst-only** (a spray already emits over time; it ignores `stagger`). Opt-in; off / `≤ 0` / non-finite = synchronous spawn, byte-identical. See [Staggered emission](#staggered-emission). |
| `align` | number | `0` | Velocity-align blend `0..1`: rotate each piece **broadside** to its live velocity (its flat face meets the airflow, like a leaf), `0` = pure random spin, `1` = fully locked. Coerced to `[0, 1]`. A pure orientation overlay — the seeded position stream is byte-identical off or on. Honored by `burst()` **and** `spray()`. See [Velocity-aligned orientation](#velocity-aligned-orientation). |
| `spinRate` | number | `1` | Tumble-speed multiplier on the seeded random spin: `1` = as seeded, `0` = rigid at the random birth tilt, `0.3` = slow drift, `2` = double, negative = reverse. Coerced with `num` (non-finite → `1`; `0` and negatives are valid). A pure render-orientation overlay — the seeded position stream is byte-identical off or on, **even with `turbulence` armed**. Honored by `burst()` **and** `spray()`. See [Tumble speed](#tumble-speed). |
| `spinDrag` | number | `1` | Angular-velocity **retention** in `0–1` — the angular mirror of the linear `drag`. Each frame, before the spin advance, `spinV *= spinDrag`, so the tumble decays exactly as `drag` decays translation. `1` = off (tumble forever, today's look), `0.95` = settle to a lazy drift, `0` = freeze at the birth angle. Coerced with `clamp01` (like `drag`/`bounce`): a **negative** clamps to `0` (freeze — a retention has no direction, unlike `spinRate`'s reverse); non-finite → `1`. A contraction (`\|spinV\|` never grows; no accel cap). Damps `spinV` only, never `tiltV`. A **hybrid physics** knob: with `turbulence` off it moves only the render rotation (position byte-identical), with `turbulence` on the curl reads the slower spin and it moves the position fingerprint — **not** a pure render overlay. Honored by `burst()` **and** `spray()`. See [Spin drag](#spin-drag). |
| `scaleTo` | number | `1` | Size-over-life target: lerp each piece's **rendered** size from `scaleFrom` at birth to `scaleTo` at death (isotropic, both axes). `0.2` shrinks out, `2` grows/blooms, `0` vanishes at death; `1` = constant size. Coerced with `nonneg`: a **negative** clamps to `0` (a size has no direction — not a mirror flip, not a fallback to `1`); non-finite → `1`. A pure render-scale overlay folded into flutter's `ctx.scale` — `pool.w`/`pool.h` untouched, so the seeded position stream is byte-identical off or on; the trail keeps its birth width. Honored by `burst()` **and** `spray()`. See [Size over life](#size-over-life). |
| `scaleFrom` | number | `1` | Size-over-life **origin**: the birth endpoint of the ramp `scaleTo` targets, turning the one-endpoint `1 → scaleTo` ramp into a two-endpoint `scaleFrom → scaleTo` envelope — `s = scaleFrom + (scaleTo − scaleFrom) × (1 − lifeT)`, isotropic. `0.2` blooms up from a fifth-size, `2` starts double and settles, `1` = today's look (the ramp starts at birth size); `scaleFrom == scaleTo` is a constant size multiplier. Coerced with `nonneg`: a **negative** clamps to `0` (born invisible — a size has no direction, not a fallback to `1`); non-finite → `1`. Folded into the same single `ctx.scale` as `scaleTo` — `pool.w`/`pool.h` untouched, so the seeded position stream is byte-identical off or on; the trail keeps its birth width. Honored by `burst()` **and** `spray()`. See [Size over life](#size-over-life). |
| `flutterRate` | number | `1` | Tumble-wobble **speed** multiplier on the seeded flutter (the speed knob to `flutter`'s depth): `1` = as seeded, `0` = frozen at the random birth tilt, `0.3` = slow lazy flutter, `2` = fast shimmer, negative = reversed. Coerced with `num` (`0` and negatives valid; non-finite → `1`). **Inert when `flutter` is 0** (a zero-depth wobble has no speed). A pure render-phase overlay about a birth pivot that never touches `pool.tilt` — the seeded position stream is byte-identical off, on, or on-with-turbulence. Honored by `burst()` **and** `spray()`. See [Wobble speed](#wobble-speed). |
| `fadeIn` | number | `0` | Birth-**opacity** ramp: fade each piece up from transparent over the **first `fadeIn` fraction** of its life (`0.4` = ease in over the first 40%, `1` = ramp across the whole life; `0` = instant-on). The mirror of the hardcoded death fade-out, **multiplying** the same `alpha`. Coerced with `clamp01` (non-finite/negative → `0` off, `> 1` → `1`). A pure render overlay on `ctx.globalAlpha` that never touches `pool.x/y/vx/vy` — the seeded position stream is byte-identical off or on (and rotate/scale/stroke/color too). The trail materializes in with the body. Honored by `burst()` **and** `spray()`; inert under reduced motion. See [Birth opacity](#birth-opacity). |
| `fadeOut` | number | `0.3` | Death-**opacity** window: the **fraction of life** over which each piece dissolves *out* at the END. `0.6` fades over the last 60% (a long gentle dissolve), `0.1` a quick blink-out, `0` a hard cut (full opacity then gone), `1` across the whole life; default `0.3` = today's exact look. The mirror of `fadeIn`, **multiplying** the same `alpha` to compose the full opacity envelope. Coerced with `clamp01` against a `Math.fround(0.3)` sentinel (non-finite/undefined → the `0.3` default; **negative → `0`** = hard cut, *not* a fallback to the default; `> 1` → `1`). A pure render overlay on `ctx.globalAlpha` that never touches `pool.x/y/vx/vy` — the seeded position stream is byte-identical at the default or off (and rotate/scale/stroke/color too). The trail dissolves out with the body. Honored by `burst()` **and** `spray()`; inert under reduced motion. Reuses `fadeIn`'s determinism probe with no harness change. |
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
| `trail` | number | 0 | Motion-trail capacity: ring-buffer depth for the per-particle ribbon. `0` = off (no buffers). Sized once here (zero-GC); capped at 64. See [Motion trails](#motion-trails). |

---

## Particle Physics Pipeline

Every frame, each alive particle runs through this pipeline:

```
--  SPAWN       origin = EMIT ? point-on(line | ring | box, emitSize) : (x, y)   (opt-in, at BIRTH; ring also fires velocity radially outward)
0a. UNBORN?     if STAGGER delayed this piece's birth, skip steps 0b–13 entirely   (opt-in; frozen + invisible, life not yet counting, until its delay elapses)
0b. FROZEN?     if the piece has SETTLED (landed on the floor), skip steps 1–13 entirely   (opt-in; it still ages, fades, and draws)
1.  GRAVITY     vy += gravity × dt        (downward acceleration)
2.  WIND        vx += wind × dt           (opt-in lateral acceleration)
3.  TURBULENCE  vx += cos(p) × turb × dt, vy += sin(p) × turb × dt   (opt-in, p = tilt+spin phase)
4.  GUST        vx += sin(elapsed × GUST_HZ) × gust × dt   (opt-in, global oscillating wind)
5.  VORTEX      vx += (attract·rx − swirl·ry) × dt, vy += (attract·ry + swirl·rx) × dt   (opt-in, r = center − pos; capped)
6.  DRAG        vx *= drag, vy *= drag    (air resistance)
7.  POSITION    x += vx × dt, y += vy × dt
8.  FLOOR       if y > floor:   y = floor,   vy = −vy × bounce   (opt-in, box Y-max)
                 └─ SETTLE: if |vy| < settle, freeze the piece here (landed = true)   (opt-in; bounce-then-rest)
9.  CEILING     if y < ceiling: y = ceiling, vy = −vy × bounce   (opt-in, box Y-min)
10. SWAY        x += sin(tiltPhase) × sway × dt   (opt-in horizontal drift)
11. WALLS       if x < wallLeft:  x = wallLeft,  vx = −vx × bounce   (opt-in, box X-min)
                if x > wallRight: x = wallRight, vx = −vx × bounce   (opt-in, box X-max)
12. SPIN        rotation += spinVelocity × dt
13. TILT        tiltPhase += tiltSpeed × dt
14. OPACITY     fade to 0 in last 30% of life
15. TRAIL       record (x,y) in the ring → stroke the ribbon through recent positions   (opt-in RENDER overlay — world-space stroke, touches no physics state)
16. RENDER      translate → rotate → flutter-scale → draw shape
                 └─ COLOR: body fillStyle = lifeColors ? ramp[lifeFraction] : flat colors[i]   (opt-in; pure color overlay)
```

Steps 1–13 are **physics** (they mutate `x/y/vx/vy`); steps 14–16 are **rendering**. `trail` (step 15) is the first purely-render feature: it *reads* the position but draws a stroked polyline in world space (never `translate`), so it cannot move the determinism fingerprint — every committed physics hash is preserved at any trail depth. `lifeColors` (the COLOR sub-step of 16) is the second: it only chooses which pre-baked color string the body paints, touching no position, so it too preserves every physics fingerprint. Step 0 is the first **behaviour** feature: once a piece has `settle`d it is `landed`, so the whole physics block is skipped and it lies frozen — but it keeps ageing and drawing, so nothing else about the pipeline changes. The **SPAWN** line runs once at birth, before the per-frame pipeline: `emit` (the first **emission-geometry** feature) chooses the origin — a point, or a point on a line / ring / box — and for a ring also aims the launch velocity radially outward. With `emit` off it is exactly the point `(x, y)`, so the seeded stream is untouched.

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

### Bounding box

**`wallLeft`**, **`wallRight`**, and **`ceiling`** (added in v1.7.0) are the three remaining edges that complete `floor` into a full axis-aligned **bounding box** — an X-min wall, an X-max wall, and a Y-min ceiling (the mirror of the `floor` Y-max). Each is an absolute CSS-px coordinate; a particle reaching an edge is clamped onto it and the perpendicular velocity component reflected. Restitution reuses the same **`bounce`**, so the whole box shares one bounciness.

```js
const w = innerWidth, h = innerHeight;
c.burst({ x: w / 2, y: h / 2, ceiling: 0, floor: h, wallLeft: 0, wallRight: w, bounce: 0.4 });
// a burst that stays fully inside the viewport, bouncing off every edge
```

Each edge defaults to an infinity sentinel (`-Infinity` for `wallLeft`/`ceiling`, `Infinity` for `wallRight`), and its guard (`x < wallLeft`, `x > wallRight`, `y < ceiling`) can never fire at that default — so a box-less burst does no extra work and its seeded positions stay byte-identical. **Both** committed fingerprints — the default *and* the v1.6.0 floored — are preserved. The wall clamp runs *after* `sway` (the frame's last horizontal move), so a swaying particle is still contained. Like the floor, the box draws no random values (a boxed burst replays identically under a fixed seed), `bounce` stays clamped so no edge can add energy (an elastic particle in a tight box never escapes), a degenerate inverted box clamps deterministically without a NaN, and the box has no effect under reduced motion.

### Living air

Every force so far is *constant in time* — a fixed `gravity`, a fixed `wind` — so a wide fall reads like parallel rain. **`turbulence`** and **`gust`** (added in v1.8.0) are the first **time-varying** forces, and they read as moving air:

- **`turbulence`** is a per-particle *rotating* acceleration (px/s²). Each particle's push direction curls at its own rate, so a burst fans out and mills instead of falling in lockstep. Unlike `sway` (which oscillates on one axis and nets to zero), turbulence drives both axes and genuinely spreads the pool.
- **`gust`** is a *global*, sinusoidally-oscillating horizontal acceleration (px/s²) layered on `wind`. The whole burst shares one phase, so it swells one way then the other in ~3s waves — a breeze gusting, not per-particle noise.

```js
c.burst({ turbulence: 400, gust: 250 });
// confetti drifting on living air — each piece wandering, the whole pool breathing side to side
```

Both draw **zero random values**: `turbulence` is a pure function of the seeded tumble phases the engine already advances, and `gust` of a shared elapsed-time clock — so a turbulent/gusty burst replays identically under a fixed seed (with its own committed fingerprints in the test suite), while the default `0` keeps every prior fingerprint (default, floored, and box) byte-for-byte unchanged. Both are accelerations applied *before* drag, exactly like `wind`, so they damp toward a terminal velocity and never run away; inside a [bounding box](#bounding-box) the edge clamps still hold, so a turbulent burst stays contained. Garbage fails closed to `0`; negatives are allowed (they flip direction). Neither has any effect under reduced motion.

### Motion trails

Every feature above changes the **physics**. Trails (added in v1.9.0) are the first purely **visual** one: each particle leaves a fading ribbon through its recent positions, so a fast burst reads as motion streaks instead of hard dots. Trails are **opt-in at construction**, because the ribbon needs a *fixed* ring buffer of past positions — and a zero-GC engine can't grow one lazily, so its depth (the *capacity*) is set once when you create the instance:

```js
const c = createConfetti(canvas, { trail: 16 });   // capacity: 16 samples of history per particle
c.burst({ count: 120, speed: 500 });               // every particle now trails by default
c.burst({ count: 40, trail: 6 });                  // a shorter ribbon for this burst
c.burst({ count: 40, trail: 0 });                  // …or none for this one
```

The per-burst `trail` sets the ribbon *length* (`0..capacity`); omit it and a trail-capable instance trails at full capacity. On an instance created without a `trail` budget the per-burst option is simply ignored (fail-closed, no throw).

The ribbon is a single **flat-alpha** stroke — one uniform-opacity line through the particle's recent positions, so the whole streak stays clearly visible. (A per-segment taper to a transparent tail was tried in 1.9.0 and reverted in 1.10.0: it read as too faint.)

Trails are a **pure render overlay**. The ribbon is stroked in *world space* (`moveTo`/`lineTo`/`stroke`) — it never uses `translate` and never touches `x/y/vx/vy`, so it **cannot** perturb the determinism fingerprint: a trailed burst reproduces the exact same committed physics hash as an untrailed one, at any depth. The ribbon geometry is itself deterministic (its own committed `strokeHash` gate). Storage is a `Float32Array` ring buffer allocated **once** at construction (so `trail: 0`, the default, allocates nothing and is byte-identical to no trails), and recording + stroking are allocation-free on the hot path — verified at ~0 B/frame with a full trailed pool under the torture alloc gate. A garbage capacity fails closed to off or the 64-sample cap; on pool reuse a recycled slot's stale history can never leak (the live sample count resets at spawn). No effect under reduced motion.

### Vortex

Every force so far is uniform in space (`gravity`, `wind`, `gust`) or per-particle random (`turbulence`). A **vortex** (added in v1.10.0) is the first force aimed at a *place* — a point that pulls, pushes, and spins the burst around itself, so confetti can collapse into a logo, drain into a hole, or spiral like a galaxy.

```js
c.burst({ attract: 6, swirl: 4 });                 // spiral inward around the burst origin
c.burst({ attract: -8, x: cx, y: cy });            // blow the burst apart from its center
c.burst({ swirl: 6, attractX: 400, attractY: 300 }); // orbit a fixed point, no net pull
```

- **`attract`** is a *linear spring*: the pull is `attract × (center − pos)`, so it grows with distance and is **zero at the center** — no `1/r` singularity, no NaN. A positive `attract` is a damped oscillator that spirals inward (`drag` bleeds the energy); a negative one repels.
- **`swirl`** adds the perpendicular (tangential) component, turning the pull into a spiral; its sign picks the spin direction. Together `(attract, swirl)` apply the matrix `[[attract, −swirl], [swirl, attract]]` to the radius vector.
- **`attractX` / `attractY`** set the center; they default to the **burst origin**, so a bare `attract`/`swirl` spins around where you fired.

Like every force, the vortex draws **zero random values** — it's a pure function of the particle's own position and the burst center — so a vortexed burst replays identically under a fixed seed (with its own committed fingerprints for attract-only, swirl-only, and both), while the default `0` keeps every prior fingerprint byte-for-byte unchanged. It's applied *before* drag, so it damps toward the center and never runs away; inside a [bounding box](#bounding-box) the edge clamps still contain it. A negative `attract` is an unstable anti-spring, so a fail-closed acceleration cap guarantees a repeller can **never** drive a position to a non-finite value. Garbage fails closed (strengths → `0`, center → the burst origin); negatives are valid. No effect under reduced motion.

### Settle & pile

Every earlier feature changed how a particle *moves* or *draws*. **Settle** (added in v1.11.0) is the first one that changes how a particle *ends*: instead of bouncing on the `floor` forever, a piece comes to **rest** and piles up — snow settling, ticker-tape drifting on the ground.

```js
c.burst({ floor: 520, bounce: 0.4, settle: 60 });   // fall, bounce a few times, then pile up
```

- **`settle`** is a *rest-speed threshold* in px/s. Each frame a piece bounces on the floor it loses energy (to `bounce` < 1 and `drag`); once the rebound is too weak to lift it — its post-bounce speed drops below `settle` — the piece **freezes**: velocity zeroed, pinned on the floor line, physics skipped. With `bounce = 0` a piece rests on first contact; a higher `bounce` just makes it bounce longer before it settles (`drag` still bleeds energy each frame), and with no `floor` nothing settles at all.
- **It needs a `floor`.** Settle only ever fires as a piece lands on the floor, so with no floor set nothing settles (fail-closed).
- **A settled piece keeps ageing and fades in place**, then its slot recycles — so the pile is a *transient drift* that builds and melts, and the fixed particle pool never fills up. (A permanent pile would saturate the pool and block new bursts, so it's deliberately not the default.)
- A frozen piece is truly still: its **rotation is frozen too**, and lateral forces (`wind`, `gust`, `sway`) can't nudge it — a pile lies where it landed.

Like every knob, settle draws **zero random values** (a pure function of the piece's own post-bounce velocity), so a settling burst replays identically under a fixed seed with its own committed fingerprint, and the default `0` keeps every prior fingerprint byte-for-byte unchanged. A garbage threshold fails closed to `0` (off). No effect under reduced motion — the static render never integrates, so nothing lands.

### Friction

`settle` freezes a piece the instant it comes to rest; **friction** (added in v1.21.0) is the softer, physical in-between — a piece that lands with sideways speed **skids** and slows along the floor instead of sliding forever. It's the first new physics knob since settle, and the tangential complement to `bounce`: on a floor contact, `bounce` reflects the *vertical* (normal) component while `friction` bleeds the *horizontal* (tangent) one.

```js
c.burst({ floor: 520, wind: 700, friction: 0.85 });   // fire sideways, land, skid to a stop
```

- **`friction`** is a coefficient `0–1`. On every floor-contact frame the horizontal velocity is multiplied by `1 - friction`: `0` is frictionless (the default — today's exact behaviour), `1` is full grip (a horizontal stop on the first contact), `0.2` a long skid, `0.8` a short one. With `bounce = 0` a piece is in contact every frame, so `vx` decays geometrically to a stop; with `bounce > 0` it bleeds a little speed on each landing.
- **It needs a `floor`.** Friction only ever acts as a piece contacts the floor, so with no floor set nothing happens (fail-closed) — the same rule as `settle`.
- **It's a *physics* knob, not a render overlay.** Unlike `align`/`scaleTo`/`fadeIn`/`fadeOut`, friction changes `vx` → position, so a friction burst has its **own** committed fingerprint; at `friction: 0` every prior fingerprint reproduces byte-for-byte (the guard is a plain `!= 0`, and `0` is exactly representable, so nothing drifts when off).
- **Finite by construction.** The factor `1 - friction` is always in `[0, 1]` (a negative `friction` clamps to `0`, never an anti-friction speed-up), so it's a contraction — horizontal speed can only shrink, never grow, and no acceleration cap is needed. Zero random draws; no effect under reduced motion.
- **`wallFriction` (v1.22.0)** extends the same idea to the box's other three edges. On a contact with a wall or the ceiling it bleeds the *tangential* component by `1 - wallFriction` — the ceiling damps horizontal `vx`, each wall damps vertical `vy`, always the component `bounce` does *not* reflect there, so it never cancels the rebound. It is **one shared coefficient** for the box's non-floor edges (the tangential analog to `bounce`'s single restitution; the ceiling rides along because `bounce` never split the box edge-by-edge). Like `friction` it is a contraction (finite, no acceleration cap), needs a box or no edge fires, and moves the position fingerprint (its own committed hash), while the floor keeps its separate `friction`. One subtlety: on a **resting** box (`bounce: 0`) `wallFriction` is *inert* — once the normal velocity is killed a piece pins to the edge and the strict guard never re-fires, so there's no tangential speed left to bleed and the committed box fingerprint is byte-identical; the grip bites only once pieces ricochet (`bounce > 0`) or are re-driven into an edge by sustained wind.

```js
c.burst({ ceiling: 40, wallLeft: 60, wallRight: 740, floor: 560, bounce: 0.6, wallFriction: 0.6, wind: 300 });
```

### Spin drag

`drag` has damped a piece's **translation** every frame since day one — but its **spin** was drawn once at birth and tumbled at that rate forever. **`spinDrag`** (added in v1.23.0) is the angular mirror: each frame, immediately before the spin advance, `spinV *= spinDrag`, so the tumble decays exactly as `drag` decays motion. It's the last unmirrored asymmetry in the integrator closed.

```js
c.burst({ spinDrag: 0.9, turbulence: 300 });   // pieces tumble fast, then settle to a lazy drift
```

- **`spinDrag`** is a retention `0–1`: `1` = off (tumble forever, today's exact look), `0.95` a gentle decay to a lazy drift, `0` an instant freeze at the birth angle. Coerced with `clamp01` like `drag`/`bounce` — a **negative** clamps to `0` (freeze; a retention has no direction, unlike `spinRate`'s reverse), non-finite → `1`, `> 1` → `1` (which would otherwise *amplify* spin and diverge). It's a contraction, so `|spinV|` can only shrink and no acceleration cap is needed. It damps `spinV` only, never `tiltV` (the wobble phase feeds `sway` and the turbulence curl).
- **It's a *hybrid physics* knob, not a pure render overlay.** `pool.spin` is read in exactly two places — the render rotation and the turbulence curl (`tilt*1.7 + spin`). So with **`turbulence` off** a slower spin moves only the render rotation and the seeded **position** stream is byte-identical (only `rotateHash` moves, its own committed fingerprint); with **`turbulence` on** the curl reads the slower spin, so it moves positions too (a second committed fingerprint on the same turbulence baseline). At `spinDrag: 1` every prior fingerprint — `rotateHash` included — reproduces byte-for-byte. Zero random draws; no effect under reduced motion (the static render never advances spin).

### Color over life

Until now a piece was painted **one flat color** from birth to death. **`lifeColors`** (added in v1.12.0) lets the **body** of each piece sweep a multi-stop OKLCH ramp as it *ages* — a spark cooling white → orange → red, an ember dimming, a firework tail shifting hue.

```js
c.burst({
    lifeColors: [
        { l: 0.98, c: 0.02, h: 90 },  // birth: near-white
        { l: 0.72, c: 0.22, h: 60 },  // mid: gold
        { l: 0.40, c: 0.15, h: 30 },  // death: deep orange
    ],
});
```

- **`lifeColors`** is an ordered list of **≥ 2 OKLCH stops**, birth-color first, death-color last. Each piece's body color is read from the ramp by its life fraction (birth = first stop, death = last).
- **Baked once per burst.** The ramp is interpolated in OKLCH into a small lookup table of CSS strings ([`bakeCssGradient`](../LiteColor)) when the burst fires, so the render loop is a pure array read — no per-frame color math, no allocation.
- **The trail stays flat.** Only the body sweeps the ramp; the motion-trail ribbon keeps drawing the piece's flat `colors` pick (the trail is a simple flat overlay). The palette `colors` is still picked per particle — it's the trail color, and the body color when `lifeColors` is off.
- **All pieces share one ramp.** Variety comes from pieces being at *different* life phases, so a stream reads as a coherent gradient of ages (perfect for sparks).

`lifeColors` is a **pure color overlay**: it draws **zero random values** and moves no particle, so a `lifeColors` burst replays with the exact same positions as a plain one — every physics fingerprint is preserved byte-for-byte. An invalid or too-short ramp fails closed to the flat color. No effect under reduced motion — the static render paints the flat color.

### Emitter shapes

Every burst so far spawned from the **single point** `(x, y)`. **`emit`** (added in v1.13.0) distributes the spawn **origin** over a shape, sized by the single `emitSize` scalar — so confetti can rain from a line, expand from a shell, or fill an area.

```js
// A firework shell: pieces fly radially OUTWARD from a ring.
c.burst({ x: 400, y: 300, emit: 'ring', emitSize: 140, speed: 6, count: 160 });

// A rain / snow curtain: spawn along a horizontal line across the top, fall under gravity.
c.spray({ x: 400, y: 0, emit: 'line', emitSize: 300, angle: Math.PI / 2, gravity: 0.4 });
```

- **`emit: 'line'`** — a horizontal segment centered on `(x, y)`, half-length `emitSize` (a rain / snow curtain).
- **`emit: 'ring'`** — the circle of radius `emitSize` around `(x, y)`. Each piece is fired **radially outward** from the centre, so `speed` becomes the shell expansion rate and `spread` the angular fuzz — a firework shell.
- **`emit: 'box'`** — the square `[x ± emitSize, y ± emitSize]` (an area burst).
- **Line and box move only the origin** — velocity stays governed by `angle` / `spread`. The radial-outward coupling is **ring-only**.

`emit` is a **pure origin choice**: it is the first knob to draw a random value *at spawn* (the position along the shape), so it is opt-in by construction — with `emit` off, unknown, or `emitSize ≤ 0`, the burst spawns at the point and every committed fingerprint is byte-identical. Each shape has its own deterministic fingerprint when on. Fails closed to a point spawn on a bad shape or size; no effect under reduced motion.

### Staggered emission

`emit` chose *where* a piece is born; **`stagger`** (added in v1.14.0) chooses *when*. A burst has always spawned its whole `count` at frame 0; `stagger` (a duration in **ms**) spreads those births evenly across the window, so a burst **cascades / ripples in** instead of appearing all at once.

```js
// A 120-piece burst that pours in over 400ms instead of popping instantly.
c.burst({ x: 400, y: 300, count: 120, stagger: 400 });
```

- Piece `i` wakes at `stagger · i / count` ms and then lives its **full life from birth** — so a late piece outlives the early ones by the width of the window.
- **Burst-only.** This is the burst analog of a spray's `duration`; a `spray()` already emits over time, so it ignores `stagger`.
- **How it stays deterministic.** All `count` pieces still spawn at call time, drawing the *identical* rng sequence as a synchronous burst; each is stamped with a **no-rng** per-index delay, and an unborn piece is frozen and invisible until it elapses. So with `stagger` off (or `≤ 0` / non-finite) the burst spawns synchronously and every committed fingerprint is byte-identical; on, it earns its own deterministic fingerprint purely from birth *timing*. Fails closed; no effect under reduced motion.

### Velocity-aligned orientation

For fourteen releases a piece's rotation was only ever *random tumble*. **`align`** (added in v1.15.0, a `0..1` blend) rotates each piece **broadside to its live velocity** — its flat face square to the airflow, like a falling leaf — re-banking every frame as gravity, wind, or a vortex bend its path.

```js
// Leaves banking into a gentle drift — face-first to wherever the air pushes them.
c.burst({ x: 400, y: 200, count: 80, gravity: 200, wind: 300, spread: 0.4, align: 1 });
```

- **`0`** is pure random spin (the classic look); **`1`** is fully velocity-locked; partial values blend the two along the shortest arc.
- **Live + broadside.** The heading is recomputed from the current velocity each frame and offset by 90° so the broad face meets the direction of travel. Draws **no rng**.
- **A pure orientation overlay.** `align` changes only *rotation*, never position — so the seeded position stream (and every committed fingerprint) is byte-identical whether `align` is off or on; only the rotation earns its own deterministic fingerprint. Honored by both `burst()` and `spray()`. Fails closed (coerced to `[0, 1]`); no effect under reduced motion.

### Tumble speed

`align` opened *which way* a piece faces; **`spinRate`** (added in v1.16.0) tunes *how fast* it tumbles. For fifteen releases the tumble rate was a fixed seeded random, so slow drifting petals, frozen rigid chips, and reverse tumble were all unreachable. `spinRate` is a plain multiplier on the accumulated tumble.

```js
// Slow, lazy petals drifting down — a third of the seeded tumble rate.
c.burst({ spinRate: 0.3, gravity: 200 });
```

- **`1`** (default) is the seeded rate as-is; **`0`** is rigid — frozen at each piece's *random birth tilt* (varied, not axis-aligned); **`0.3`** is a lazy drift; **`2`** doubles the tumble; a **negative** value reverses it. Coerced with `num` (`0` and negatives are valid; non-finite → `1`), never `clamp01` — a rate multiplier is not a `0..1` blend.
- **A pure orientation overlay, turbulence-safe.** `spinRate` is a render-time *angle scale*: it scales only the accumulated tumble about the birth orientation and **never touches the physics spin** the turbulence phase reads. So it is fully decoupled from `turbulence`, and the seeded position stream (and every committed fingerprint) is byte-identical whether off, on, or on-with-turbulence — only the rotation earns its own deterministic fingerprint. Composes with `align` (the tumble scale runs first, then `align` blends toward the velocity heading). Draws **no rng**. Honored by both `burst()` and `spray()`; inert under reduced motion.

### Size over life

Every render axis had been opened *except* size: for sixteen releases a piece's size was fixed at birth (`pool.w`/`pool.h` drawn once and never changed), so a piece that **shrinks away to nothing** or an ember that **blooms as it dies** was unreachable. **`scaleTo`** (added in v1.17.0) lerps each piece's *rendered* size from `1.0` at birth to `scaleTo` at death, by the **same** age fraction the `lifeColors` ramp uses.

```js
// Sparks that shrink out as they cool — scaleTo composes with the color ramp on one life fraction.
c.burst({ scaleTo: 0.1, gravity: 300, lifeColors: ['#fff', '#f80', '#a00'] });
// A bloom: pieces grow as they fade.
c.burst({ scaleTo: 2.5, gravity: 200, shape: 'circle' });
// Pop-in: born small, settle to full size as the birth fade eases in (v1.24.0).
c.burst({ scaleFrom: 0.2, scaleTo: 1.4, fadeIn: 0.3 });
```

- **`1`** (default) is constant size; **`0.2`** shrinks out, **`2`** grows/blooms, **`0`** vanishes at death. `s = scaleFrom + (scaleTo − scaleFrom) × (1 − lifeT)`, reusing the life fraction already computed for the opacity fade and the color ramp. Coerced with `nonneg`: a **negative** clamps to `0` (a size has no direction — *not* a mirror flip, *not* a fallback to `1`; `scaleTo: -2` renders like `scaleTo: 0`), non-finite → `1`. `scaleTo: 0` is a legitimate value (the size analog of `spinRate: 0`).
- **`scaleFrom`** (v1.24.0) is the **birth endpoint** — the mirror `scaleFrom:scaleTo :: fadeIn:fadeOut` that closes the render-scale axis. Default `1` leaves the ramp starting at birth size (today's exact look); `scaleFrom: 0.2` blooms up from a fifth-size, `scaleFrom: 2` starts double and settles, and `scaleFrom == scaleTo` is an emergent constant multiplier. It supersedes the `0018` deferral note (which wrongly assumed `sizeMin`/`sizeMax` already covered a birth-size *override* — those set the constant birth size, they don't move the ramp's origin). Same `nonneg` coercion (a negative is born invisible, not a fallback to `1`); folded into the **same single** `ctx.scale` as `scaleTo`.
- **Isotropic, one `ctx.scale`.** The factor is applied to **both** axes and **folded into flutter's single existing `ctx.scale` call** — the X-wobble and the size ramp multiply on one transform, never a second call. `pool.w`/`pool.h` are **never touched**.
- **A pure render overlay.** Scale never enters `ctx.translate`, so the seeded position stream (and every committed fingerprint) is byte-identical whether off or on — a scaled burst reproduces the same-seed plain burst's position hash exactly (invisible to the rotation and color fingerprints too); only the size fold earns its own deterministic fingerprint. The **trail ribbon keeps its birth width** (the ramp scales the body, not the streak). Draws **no rng**. Honored by both `burst()` and `spray()`; inert under reduced motion.

### Wobble speed

`spinRate` tuned how fast a piece *tumbles*; **`flutterRate`** (added in v1.18.0) tunes how fast it *wobbles* — the speed knob to what `flutter` opened as depth. `flutter` sets the depth of the 3D-ish X-scale wobble (`wobbleScale = 1 − flutter × 0.5 × (1 − |cos(tilt)|)`), driven by the per-particle tilt phase the integrator advances every frame; but its *speed* (`tiltV`) was a fixed seeded random, so a slow lazy flutter, a wobble frozen at a chosen tilt, or a fast shimmer were all unreachable. `flutterRate` is a plain multiplier on the accumulated wobble phase about a stored birth pivot.

```js
// A wobble frozen at each piece's own birth tilt — flutter must be on for a rate to matter.
c.burst({ flutterRate: 0, flutter: 1, gravity: 200 });
// A fast shimmer: the wobble advances twice as quickly.
c.burst({ flutterRate: 2, flutter: 1 });
```

- **`1`** (default) is the seeded rate as-is; **`0`** freezes the wobble at each piece's *own random birth tilt* (a varied constant per piece, not collapsed to one value); **`0.3`** is a slow lazy flutter; **`2`** is a fast shimmer; a **negative** value reverses the phase. Coerced with `num` (`0` and negatives are valid; non-finite → `1`), never `clamp01` — a rate multiplier is not a `0..1` blend.
- **Inert when `flutter` is 0.** `flutter` (depth) multiplies the whole `(1 − |cos|)` term; at `flutter: 0` the wobble is `1` regardless of the phase, so there is no speed to scale. So a `flutterRate` demo always sets `flutter: 1`.
- **A pure render overlay, turbulence-safe.** `flutterRate` is a render-time *phase scale* about a birth pivot `tilt0`: it scales only the accumulated wobble phase and **never touches `pool.tilt`** — the phase the `turbulence` curl and `sway` read. So it is fully decoupled from both, and the seeded position stream (and every committed fingerprint) is byte-identical whether off, on, or on-with-turbulence — only the wobble earns its own deterministic fingerprint (reusing the `scaleHash` probe, no new channel). Draws **no rng**. Honored by both `burst()` and `spray()`; inert under reduced motion.

### Birth opacity

For eighteen releases a piece's *opacity* had exactly one hardcoded behaviour: a death fade-*out* over the last 30% of life. **`fadeIn`** (added in v1.19.0) opens the render-opacity axis — an opt-in scalar that **ramps a piece up from transparent over the first `fadeIn` fraction of its life**, so it *materializes in*. It is the mirror of the death fade, on the same `alpha` scalar, by the same age fraction (`1 − life/maxL`) the death-fade and `lifeColors` already use.

```js
// Materialize in over the first 40% of life, then the built-in death fade takes it out.
c.burst({ fadeIn: 0.4, gravity: 300 });
// Compose with size-over-life: a piece that fades in AND shrinks out.
c.burst({ fadeIn: 0.4, scaleTo: 0.2, gravity: 200 });
```

- **`0`** (default) is today's instant-on look; **`0.4`** eases in over the first 40% of life; **`1`** ramps across the whole life. Coerced with `clamp01` (non-finite / non-numeric / undefined / negative → `0` off; `> 1` → `1`), exactly like `align` — a fraction of life, not a rate.
- **It multiplies the existing alpha.** The birth fade-in and the hardcoded death fade-out act on the *same* `alpha`: for a normal life they fall in disjoint windows (in near birth, out near death); for a very short life they overlap and correctly multiply. The death fade-out is unchanged.
- **The cleanest pure render overlay in the suite.** `fadeIn` changes only `ctx.globalAlpha` — it never touches `pool.x/y/vx/vy` or `ctx.translate`, draws **no rng**, and reads only the life fraction, so the seeded position stream (and the rotate/scale/stroke/color fingerprints) is byte-identical whether off or on; only the alpha earns its own deterministic fingerprint. Unlike `spinRate`/`flutterRate` it needs no birth pivot and no decoupling machinery — nothing downstream reads alpha.
- **The trail materializes in with the body.** The ribbon already tracks the body `alpha` (the death fade dims it too); folding `fadeIn` in before the trail block makes the streak fade up with the body for free — no independent trail opacity, and the trail *geometry* fingerprint is untouched. Honored by both `burst()` and `spray()`; inert under reduced motion (the constant static opacity is untouched).

### Death opacity

For nineteen releases the *other* half of the opacity envelope — the death fade — was a magic `0.3` baked into the render body (dissolve over the last 30% of life). **`fadeOut`** (added in v1.20.0) parameterizes it: the **fraction of life over which a piece dissolves out at the end**. Together with `fadeIn` it **completes the opacity envelope** — materialize in, hold, dissolve out — both multiplying one shared `alpha`.

```js
// The full envelope: fade in over the first 20%, dissolve out over the last 90%.
c.burst({ fadeIn: 0.2, fadeOut: 0.9, gravity: 200 });
// A hard cut — full opacity, then gone (no death fade at all).
c.burst({ fadeOut: 0 });
```

- **`0.3`** (default) is today's exact look; **`0.6`** is a long gentle dissolve; **`0.1`** a quick blink-out; **`0`** a hard cut; **`1`** dissolves across the whole life. Coerced with `clamp01` against a `Math.fround(0.3)` sentinel — non-finite / undefined → the `0.3` default; **negative → `0`** (a hard cut, *not* a fallback to the default), `> 1` → `1`.
- **The `Math.fround(0.3)` sentinel is the whole off-identity story.** The default `0.3` lives in a `Float32Array`, and `Math.fround(0.3) !== 0.3` (the round-trip is lossy), so the render guard compares against the *frounded* sentinel and leaves the original double-`0.3` death-fade line byte-for-byte unchanged. At the default the guard never fires, so the committed opacity fingerprint is preserved bit-for-bit. (Contrast `scaleTo`/`scaleFrom`/`spinDrag`, whose default `1` *is* Float32-exact — `Math.fround(1) === 1` — so their `!= 1` guards need no sentinel.)
- **Always written at spawn — load-bearing here.** Unlike `fadeIn` (whose zero-init `0` happens to mean "off"), a zero-init `0` for `fadeOut` means "hard cut, no death fade" — a *wrong* default — so the unconditional spawn write is a fail-closed requirement, not just house style.
- **Reuses `fadeIn`'s probe with no harness change.** As the second knob on the opacity axis, `fadeOut` rides the exact determinism probe v1.19.0 built — the first render feature to cost no new test-harness plumbing. The trail dissolves out with the body; inert under reduced motion.

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

## Zero-GC design notes

<details>
<summary>What the hot path allocates (nothing), and how it stays that way.</summary>

One `createConfetti` allocates every buffer it will ever touch **once, at construction**: the particle pool is a flat **structure-of-arrays** (one typed array per attribute, indexed by a power-of-two-free ring `head`), plus three plain reference arrays for the values a `TypedArray` can't hold. The per-frame `update()` afterward does nothing but integer/float arithmetic on those pre-allocated arrays and `ctx` draw calls — it never allocates, so a running burst never feeds the collector.

The pool is `maxParticles` wide. Per particle, the **always-on** columns cost a fixed number of bytes; each `Float32Array` column is 4 B/particle, each `Uint8Array` column 1 B:

| Column | Type | B/particle | Running total |
|---|---|---:|---:|
| `x` | Float32 | 4 | 4 |
| `y` | Float32 | 4 | 8 |
| `vx` | Float32 | 4 | 12 |
| `vy` | Float32 | 4 | 16 |
| `spin` | Float32 | 4 | 20 |
| `spinV` | Float32 | 4 | 24 |
| `sdrag` | Float32 | 4 | 28 |
| `tilt` | Float32 | 4 | 32 |
| `tiltV` | Float32 | 4 | 36 |
| `w` | Float32 | 4 | 40 |
| `h` | Float32 | 4 | 44 |
| `life` | Float32 | 4 | 48 |
| `maxL` | Float32 | 4 | 52 |
| `grav` | Float32 | 4 | 56 |
| `wind` | Float32 | 4 | 60 |
| `floor` | Float32 | 4 | 64 |
| `bounce` | Float32 | 4 | 68 |
| `wallL` | Float32 | 4 | 72 |
| `wallR` | Float32 | 4 | 76 |
| `ceil` | Float32 | 4 | 80 |
| `drag` | Float32 | 4 | 84 |
| `flut` | Float32 | 4 | 88 |
| `sway` | Float32 | 4 | 92 |
| `align` | Float32 | 4 | 96 |
| `spin0` | Float32 | 4 | 100 |
| `spinRate` | Float32 | 4 | 104 |
| `scaleTo` | Float32 | 4 | 108 |
| `scaleFrom` | Float32 | 4 | 112 |
| `tilt0` | Float32 | 4 | 116 |
| `flutterRate` | Float32 | 4 | 120 |
| `fadeIn` | Float32 | 4 | 124 |
| `fadeOut` | Float32 | 4 | 128 |
| `turb` | Float32 | 4 | 132 |
| `gust` | Float32 | 4 | 136 |
| `grate` | Float32 | 4 | 140 |
| `vortX` | Float32 | 4 | 144 |
| `vortY` | Float32 | 4 | 148 |
| `attract` | Float32 | 4 | 152 |
| `swirl` | Float32 | 4 | 156 |
| `settle` | Float32 | 4 | 160 |
| `friction` | Float32 | 4 | 164 |
| `wfric` | Float32 | 4 | 168 |
| `delay` | Float32 | 4 | 172 |
| `landed` | Uint8 | 1 | 173 |
| `shape` | Uint8 | 1 | 174 |
| **always-on total** | **43×F32 + 2×U8** | **174** | **174** |

The render-orientation / render-scale / render-opacity family added over v1.15.0–v1.24.0 is nine of those columns — `align` + `spin0` + `spinRate` + `scaleTo` + `scaleFrom` + `tilt0` + `flutterRate` + `fadeIn` + `fadeOut` = 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 = **36 B/particle** — each a birth pivot or a render-time multiplier that never enters `ctx.translate`, so they cost bytes but move no fingerprint. `scaleFrom` (v1.24.0) is the birth endpoint of the size ramp `scaleTo` targets — the two now fold a two-endpoint size envelope into one `ctx.scale`, still touching no position. `fadeIn` (birth) and `fadeOut` (death) now bracket the full opacity envelope on one shared `alpha`. `friction` (v1.21.0) is a **physics** column — the tangential complement to `bounce`, damping `vx` on each floor contact — so unlike those nine it *does* move the position fingerprint. `wfric` (`wallFriction`, v1.22.0) is a second physics column — the same tangential drag on the box's three non-floor edges (ceiling damps `vx`, walls damp `vy`) — so it, too, moves the fingerprint. `sdrag` (`spinDrag`, v1.23.0) is a third — the angular mirror of `drag`, damping `spinV` every frame — which moves the fingerprint only when `turbulence` is armed (the sole path that couples `spin` back into position). `grate` (`gustRate`, v1.25.0) is a fourth physics column — the swell frequency parameterizing the baked `GUST_HZ` in the gust `vx` term — read only when `gust` is armed and, like the others, moving the position fingerprint (never a render channel).

Two more classes sit **outside** the always-on 174 B:

| Buffer | Type | B/particle | When |
|---|---|---:|---|
| `trailX` | Float32 | `capacity`×4 | opt-in — **0** when `trail` is off |
| `trailY` | Float32 | `capacity`×4 | opt-in — **0** when `trail` is off |
| `trailN` | Uint8 | 1 | opt-in — **0** when `trail` is off |
| `trailLen` | Uint8 | 1 | opt-in — **0** when `trail` is off |
| `colors` | Array ref | 1 ref | per-particle palette pick (not a `TypedArray`) |
| `emojis` | Array ref | 1 ref | per-particle emoji glyph (not a `TypedArray`) |
| `colorRamp` | Array ref | 1 ref | per-particle baked `lifeColors` LUT, or null |

The trail ring buffers are allocated **only** when the instance is built with a `trail` capacity (`maxParticles × capacity` floats each, plus two `Uint8` bookkeeping columns); a default instance pays **zero** extra bytes for them. The three reference arrays hold values a typed array can't (a CSS color string, an emoji, a baked ramp), so they're plain `Array`s of length `maxParticles` — one slot per particle, always re-assigned at spawn so a recycled slot can never inherit a prior burst's value.

The gated quality numbers the torture harness commits, so a regression fails CI as loudly as a leak:

- **Alloc gate.** `update()` over a **full `maxParticles` pool** — including a custom vector shape, an image sprite, the living-air forces, and a trailed pool — retains **~0 B/frame**, measured against a retained-bytes floor of **8.0 B/frame** (`RETAIN_FLOOR_BPF`). A per-frame-allocating control provably exceeds it.
- **Determinism.** Every feature-off path preserves the committed default determinism fingerprint **`1569828004`** byte-for-byte (each opt-in feature — wind, floor, box, living air, trails, vortex, settle, life colors, emit, stagger, align, spinRate, scaleTo, scaleFrom, flutterRate, fadeIn, fadeOut, friction, wallFriction, spinDrag, gustRate — carries its own committed fingerprint when on, and leaves the default untouched when off).
- **GC budget.** The full-pool loop runs under `@zakkster/lite-gc-profiler` with `maxMajor: 0` and 0 retained bytes under `@zakkster/lite-leak`, all under `--expose-gc`.

</details>

---

## Testing

**281 deterministic tests, all pass** (`node:test`), plus a torture gate that proves both leak-freedom and the zero-alloc + determinism claims.

```bash
npm test          # 281 node:test cases (contract + boundary + fingerprint)
npm run torture   # @zakkster/lite-leak + lite-gc-profiler under --expose-gc
npm run verify    # test + torture, the publish gate
```

The unit suite (`test/Confetti.test.mjs`) covers the full options surface, fail-closed input sanitisation, per-feature determinism fingerprints, shape dispatch (built-in + `registerShape` vector/sprite + `shapes` mixing), the bounding box, living-air and vortex forces, settle/pile lifecycle, color-over-life, emitter shapes, staggered emission, and the render-orientation / render-scale / render-opacity overlays (`align`, `spinRate`, `scaleTo`, `scaleFrom`, `flutterRate`, `fadeIn`).

The torture harness (`node --expose-gc test/torture.mjs`) runs nine tiers strictly sequentially — **T0** metamorphic laws, **T1** degenerate inputs, **T3** adversarial op orders, **T4** handle / stub / buffer abuse, **T5** differential determinism, **T6** the zero-alloc gate (hard), **T7** soak + occupancy conservation, **T8** cross-package poison + shared-ticker retention, **T9** controls — with T2 (aliasing) intentionally omitted, as confetti shares no caller-owned buffers. The gate pairs `@zakkster/lite-leak` (retention returns to `size 0`) with `@zakkster/lite-gc-profiler` (`maxMajor: 0`). **T9** is the negative-control tier: every gate is shown a workload that *must* trip it, so a clean read is never a vacuous pass. Without `--expose-gc` the memory tiers degrade to inconclusive and the gate exits 0. No gate output is a FAIL.

---

## Changelog

Full history in [CHANGELOG.md](./CHANGELOG.md).

### v1.19.0

**Birth opacity.** The first feature on the *render-opacity* axis — for eighteen releases opacity had one hardcoded behaviour, a death fade-out over the last 30% of life; now a piece can **materialize in**, fading up from transparent over the first fraction of its life.

- `fadeIn: number` on `burst()` **and** `spray()`. `0` (default) = instant-on, `0.4` = ease in over the first 40% of life, `1` = ramp across the whole life. The mirror of the death fade, multiplying the same `alpha`. Coerced with `clamp01` (non-finite / negative → `0` off, `> 1` → `1`).
- The **cleanest pure render overlay** in the suite: it changes only `ctx.globalAlpha`, never touches `pool.x/y/vx/vy`, draws no rng, and reads only the life fraction, so the seeded position stream (and the rotate/scale/stroke/color fingerprints) is byte-identical whether off or on; only the alpha earns its own deterministic fingerprint. No birth pivot, no decoupling machinery. The trail materializes in with the body. Inert under reduced motion. See [Birth opacity](#birth-opacity).

### v1.18.0

**Wobble speed.** The third tumble-axis knob and the flutter analog of `spinRate` — `flutter` opened the *depth* of the wobble; this tunes its *speed*. For seventeen releases the wobble rate was a fixed seeded random, so a slow lazy flutter, a wobble frozen at birth, or a fast shimmer were all unreachable.

- `flutterRate: number` on `burst()` **and** `spray()`. `1` (default) = as seeded, `0` = frozen at the random birth tilt, `0.3` = slow lazy flutter, `2` = fast shimmer, negative = reversed. Coerced with `num` (`0` and negatives valid; non-finite → `1`). Inert when `flutter` is 0.
- A **pure render overlay**, turbulence-safe: a render-time phase scale about a birth pivot `tilt0` that never touches `pool.tilt` (the phase the turbulence curl and sway read), so the seeded position stream (and every committed fingerprint) is byte-identical whether off, on, or on-with-turbulence; only the wobble earns its own deterministic fingerprint (reusing the `scaleHash` probe, no new channel). Draws no rng; inert under reduced motion. See [Wobble speed](#wobble-speed).

### v1.17.0

**Size over life.** The first feature on the *render-scale* axis — for sixteen releases a piece's size was fixed at birth; now it can **shrink out** or **bloom** as it ages.

- `scaleTo: number` on `burst()` **and** `spray()`. `1` (default) = constant size, `0.2` = shrink out, `2` = grow/bloom, `0` = vanish at death. Lerped by the same life fraction the `lifeColors` ramp uses. Coerced with `nonneg` (a negative clamps to `0`, not a mirror flip and not a fallback to `1`; non-finite → `1`).
- `scaleFrom: number` on `burst()` **and** `spray()` (v1.24.0). The **birth endpoint** of the size ramp: `1` (default) starts at birth size, `0.2` blooms up from a fifth-size, `2` starts double and settles to `scaleTo`. Together with `scaleTo` it is a two-endpoint size envelope folded into one `ctx.scale`. Coerced with `nonneg` (a negative is born invisible, not a fallback to `1`; non-finite → `1`).
- A **pure render overlay**: isotropic, folded into flutter's single existing `ctx.scale` call (`pool.w`/`pool.h` untouched), so the seeded position stream (and every committed fingerprint) is byte-identical whether off or on; the trail keeps its birth width; only the size fold earns its own deterministic fingerprint. Draws no rng; inert under reduced motion. See [Size over life](#size-over-life).

### v1.16.0

**Tumble speed.** The second feature on the *render-orientation* axis — `align` opened *which way* a piece faces; this tunes *how fast* it tumbles. For fifteen releases the tumble rate was a fixed seeded random; now it is a plain multiplier.

- `spinRate: number` on `burst()` **and** `spray()`. `1` (default) = as seeded, `0` = rigid at the random birth tilt, `0.3` = slow drift, `2` = double, negative = reverse. Coerced with `num` (`0` and negatives valid; non-finite → `1`).
- A **pure orientation overlay, turbulence-safe**: a render-time angle scale that never touches the physics spin the turbulence phase reads, so it is decoupled from `turbulence` and the seeded position stream (and every committed fingerprint) is byte-identical whether off, on, or on-with-turbulence; only the rotation earns its own deterministic fingerprint. Composes with `align`. Draws no rng; inert under reduced motion. See [Tumble speed](#tumble-speed).

### v1.15.0

**Velocity-aligned orientation.** The first feature on a new *render-orientation* axis — for fourteen releases rotation was only ever random tumble; now a piece can bank **broadside to its live velocity**, its flat face square to the airflow like a falling leaf.

- `align: number` (`0..1`) on `burst()` **and** `spray()`. `0` = random spin, `1` = fully velocity-locked, partial blends along the shortest arc. The heading (`atan2(vy, vx) + 90°`) is recomputed each frame, so pieces re-bank as forces curve their path.
- A **pure orientation overlay**: it changes only rotation, never position, so the seeded position stream (and every committed fingerprint) is byte-identical whether off or on; only the rotation earns its own deterministic fingerprint. Draws no rng; fails closed (coerced to `[0, 1]`); inert under reduced motion. See [Velocity-aligned orientation](#velocity-aligned-orientation).

### v1.14.0

**Staggered emission.** The first feature on a new *emission-timing* axis — a burst can cascade / ripple in over a ms window instead of spawning its whole `count` at once. The burst analog of a spray's `duration`.

- `stagger: number` (ms) on `burst()`. Spreads the `count` births evenly across the window (piece `i` wakes at `stagger·i/count`); each piece lives its full life from birth. Burst-only (a spray already emits over time).
- A birth-delay gate: all pieces spawn at call time, so the rng sequence is **byte-identical** to a synchronous burst; each carries a no-rng delay and is frozen + invisible until it elapses. Off / `≤ 0` / non-finite spawns synchronously (every prior fingerprint preserved); on earns its own deterministic fingerprint. Fails closed; inert under reduced motion. See [Staggered emission](#staggered-emission).

### v1.13.0

**Spawn emitter shapes.** The first feature on a new *emission-geometry* axis — a burst can spawn from a shape instead of a point: a `line` curtain (rain / snow), a `ring` firework shell, or a `box` area, sized by one `emitSize` scalar.

- `emit: 'line' | 'ring' | 'box'` + `emitSize: number` on `burst()`/`spray()`. Ring fires each piece radially outward (`speed` = expansion, `spread` = fuzz); line/box move only the origin.
- The first knob to draw a random value *at spawn*, so it is opt-in by construction: off / unknown / `emitSize ≤ 0` spawns at the point, byte-identical to a point burst (every prior fingerprint preserved). Each shape has its own deterministic fingerprint; fails closed on a bad shape or size. See [Emitter shapes](#emitter-shapes).

### v1.12.0

**Color over life.** The second *render* feature (after trails) — the body of each piece sweeps a multi-stop OKLCH ramp as it ages, so sparks cool white → red and embers dim. Opt-in, zero-rng, a pure color overlay.

- `lifeColors: Array<OklchColor | string>` — a multi-stop life ramp (≥ 2 stops, birth-color first). Baked once per burst into a lookup table and indexed by life fraction; the hot path is a pure array read.
- The trail stays the flat `colors` pick — only the body sweeps the ramp. Draws no rng and moves no particle, so every physics fingerprint is preserved byte-for-byte; an invalid ramp fails closed to the flat color. See [Color over life](#color-over-life).

### v1.11.0

**Settle & pile.** The first *behaviour* (lifecycle) feature — a piece bounces on the `floor` until the rebound is too weak to lift it, then freezes and piles up instead of bouncing forever. Opt-in, zero-rng, fingerprint-safe.

- `settle: number` — rest-speed threshold (px/s). A piece whose post-bounce speed drops below it freezes on the floor. Needs a `floor`; with `bounce = 0` it rests on first contact, with `bounce = 1` never.
- A settled piece keeps ageing and fades in place, then recycles — the pile is a transient drift, so the fixed pool never saturates. Rotation freezes too; wind/gust/sway can't nudge a landed piece. Its own committed fingerprint; every prior physics + trail hash is preserved. See [Settle & pile](#settle--pile).

### v1.10.0

**Vortex / attractor.** The first *directed* (point) force — a burst can collapse into, blow out from, or spin around a chosen point. Opt-in, zero-rng, fingerprint-safe.

- `attract: number` — a linear-spring pull toward the center (`+` in, `−` out); zero at the center, so no singularity, damped into an inward spiral.
- `swirl: number` — the tangential (spin) component; sign = direction.
- `attractX` / `attractY` — the center, defaulting to the burst origin. A negative `attract` is an unstable anti-spring, guarded by a fail-closed acceleration cap so a repeller can never draw a non-finite position. Its own committed fingerprints (attract / swirl / both); every prior physics + trail hash is preserved. See [Vortex](#vortex).

### v1.9.0

**Motion trails.** The first *render-path* feature — each particle leaves a fading ribbon through its recent positions. A **pure overlay**: it draws a world-space stroke (never `translate`) and never touches physics state, so every committed physics fingerprint (default, mixed, wind, floored, box, turbulence, gust) is preserved byte-for-byte at any depth.

- `trail: number` on `createConfetti()` — the trail *capacity* (ring-buffer depth). Sized once at construction (zero-GC, no lazy growth); default `0` = off, allocates nothing. Capped at 64, fails closed.
- `trail: number` on `burst()`/`spray()` — the per-particle *length* `0..capacity` (default: full). `0` opts a burst out; needs a construction budget, ignored without one. The ribbon geometry has its own committed determinism gate; recording + stroking are ~0 B/frame (torture-verified); no effect under reduced motion. See [Motion trails](#motion-trails).

### v1.8.0

**Living air (turbulence + gust).** The first *time-varying* forces; opt-in and fingerprint-safe — the default, v1.6.0 floored, and v1.7.0 box determinism fingerprints are all byte-for-byte unchanged.

- `turbulence: number` on `burst()`/`spray()` — a per-particle rotating acceleration (px/s²) for organic wander, so a burst fans out and mills (default `0` = none).
- `gust: number` — a global, sinusoidally-oscillating horizontal acceleration (px/s²) layered on `wind`, so the whole burst swells side to side in ~3s waves (default `0` = none). Both draw no rng (turbulence reuses the seeded tumble phases, gust a shared elapsed clock), so a forced burst replays identically; both damp like `wind` and stay contained inside a box; fail closed; no effect under reduced motion. See [Living air](#living-air).

### v1.7.0

**Bounding box (walls + ceiling).** Completes `floor` into a full axis-aligned box; opt-in and fingerprint-safe — both the default *and* the v1.6.0 floored determinism fingerprints are byte-for-byte unchanged.

- `wallLeft` / `wallRight: number` on `burst()`/`spray()` — the X-min / X-max edges; a particle reaching a wall clamps and reflects `vx` (defaults `-Infinity` / `Infinity` = no wall).
- `ceiling: number` — the Y-min edge, the mirror of `floor`; a particle rising past it clamps and reflects `vy` (default `-Infinity` = no ceiling). Restitution reuses `bounce` for the whole box; draws no rng; fails closed; no escape from a tight elastic box; no effect under reduced motion. See [Bounding box](#bounding-box).

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
