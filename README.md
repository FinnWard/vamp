# Vamp – Space Survivors

A browser-based top-down space shooter in the style of *Vampire Survivors*.  
No frameworks. No image assets. Pure TypeScript, Canvas 2D, and Vite.

---

## Table of Contents

- [Gameplay Overview](#gameplay-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Architecture Deep-Dive](#architecture-deep-dive)
  - [Game Loop](#game-loop)
  - [Coordinate System](#coordinate-system)
  - [State Machine](#state-machine)
  - [Weapons System](#weapons-system)
  - [Enemy AI & Spawning](#enemy-ai--spawning)
  - [Levelling & Upgrades](#levelling--upgrades)
  - [XP Gems](#xp-gems)
  - [HUD](#hud)
- [Getting Started](#getting-started)
- [Controls](#controls)

---

## Gameplay Overview

- You pilot a small spaceship that **moves automatically toward your cursor / touch point** (or with WASD / arrow keys).
- All weapons **auto-fire** at the nearest enemy — no manual aiming.
- Enemies spawn in waves from off-screen and home in on the player.
- Killing enemies drops **XP gems**. Collecting enough gems triggers a **level-up** where you pick one of three random upgrades.
- Upgrades can improve individual weapons, unlock new ones, or evolve two weapons into a single powerful form.
- The goal is to survive as long as possible as enemy HP and spawn rate escalate over time.

---

## Tech Stack

| Tool | Role |
|------|------|
| **TypeScript** | All game logic — strict types, no `any` outside necessary casts |
| **Vite** | Dev server + production bundler (ES modules, HMR) |
| **Canvas 2D API** | All rendering — no WebGL, no sprites, no image assets |
| **Google Fonts** | *Press Start 2P* pixel font loaded via CDN |

### Why no framework?

The game's rendering is entirely imperative (`ctx.fillRect`, `ctx.arc`, etc.) so a UI framework like React would add complexity with no benefit. DOM is only touched for the overlay screens (level-up cards, pause menu, game-over).

---

## Project Structure

```
vamp/
├── index.html          ← Single-page app shell + CSS for all overlays
├── package.json        ← npm scripts (dev / build / preview)
├── tsconfig.json       ← TypeScript config
├── vite.config.ts      ← Vite config (if present)
└── src/
    ├── main.ts         ← Entry point: game loop, state machine, HTML ↔ game glue
    ├── camera.ts       ← World↔screen coordinate transforms, parallax star field
    ├── player.ts       ← Player ship: stats, input handling, drawing
    ├── enemies.ts      ← All enemy types, AI, HP scaling, EnemySpawner
    ├── weapons.ts      ← All 14 weapon classes + shared visual helpers
    ├── projectiles.ts  ← Fast-moving linear projectile pool (Laser bolts etc.)
    ├── gems.ts         ← XP gem pickups, attraction, compaction
    ├── levelup.ts      ← XP thresholds, UPGRADE_POOL, LevelUpManager
    ├── hud.ts          ← Canvas HUD: bars, timer, kill counter, weapon icons
    └── utils.ts        ← Pure math helpers (Vec2, circlesOverlap, shuffle, …)
```

---

## Architecture Deep-Dive

### Game Loop

`main.ts` drives everything via a single `requestAnimationFrame` loop:

```
requestAnimationFrame(loop)
  └─ loop(timestamp)
       ├─ compute dt (delta time, capped at 0.1 s)
       ├─ update(dt)   ← advances simulation
       └─ render()     ← draws one frame
```

**`update(dt)`** calls in order:
1. `player.update(dt)` — movement & invincibility timer
2. `camera.follow(player.x, player.y)` — snap camera to player
3. `spawner.update(dt, player)` — spawn + move enemies
4. Each weapon's `update()` — fire logic
5. `pool.update()` — move projectiles & check hits
6. `spawner.collectDead()` — gather killed enemies, spawn gems
7. `gems.update()` — move gems toward player, collect, return XP gained
8. `levelMgr.addXp()` — check for level-up

**`render()`** calls in back-to-front order:
1. Black background fill
2. `camera.drawStarField()` — parallax stars
3. `gems.draw()`, `spawner.draw()`, `pool.draw()`, `player.draw()`
4. `w.draw?.()` for each weapon (optional arc/beam/orb visuals)
5. `hud.draw()` — always on top

---

### Coordinate System

The game uses two coordinate spaces:

| Space | Description |
|-------|-------------|
| **World space** | Infinite 2-D plane. `(0, 0)` is the player start position. All game objects live here. |
| **Screen space** | Canvas pixels. `(0, 0)` = top-left corner of the canvas. |

`camera.worldToScreen(wx, wy)` converts world → screen:
```
screen.x = wx − camera.x + canvas.width / 2
screen.y = wy − camera.y + canvas.height / 2
```

The camera always centres on the player, so the player is always in the middle of the screen.

`camera.screenToWorld(sx, sy)` is the inverse, used to convert mouse/touch input back to world coordinates.

---

### State Machine

```
         level-up                pick upgrade
playing ──────────► levelup ────────────────► playing
   │                                              ▲
   │  P / Escape                        P / Escape│
   ▼                                              │
paused ────────────────────────────────────────────
   
playing ──────────► gameover ──► (page reload) ──► playing
         HP = 0
```

`state` is a string union: `'playing' | 'levelup' | 'paused' | 'gameover'`.  
`update()` is a no-op in every state except `'playing'`.  
`render()` runs every frame regardless of state so overlays appear over a frozen scene.

---

### Weapons System

All weapons implement a common `Weapon` interface:

```ts
interface Weapon {
  name: string;
  isEvolution: boolean;
  level: number;
  getStats(): string;
  update(dt, player, enemies, pool): void;
  draw?(ctx, camera, player): void;       // optional
  scaleStats(speedMult, damageMult): void;
}
```

`main.ts` holds `weapons: AnyWeapon[]` and calls `update/draw` uniformly — no type-specific dispatch needed.

#### Base Weapons (8)

| Display Name | Class | Mechanic |
|---|---|---|
| Laser | `MagicBolt` | Fast piercing bolt fired at the nearest enemy |
| Plasma Whip | `Whip` | Melee arc sweep in a wide angle toward nearest |
| Plasma Bomb | `Fireball` | Slow homing orb that explodes on contact |
| Ion Chain | `Lightning` | Chain-zap hitting the N nearest enemies |
| Force Field | `Aura` | Pulsing damage ring centred on the player |
| Missile Barrage | `MissileBarrage` | N homing missiles per salvo |
| Pulse Cannon | `PulseCannon` | Simultaneous burst in N evenly-spaced directions |
| Cryo Beam | `CryoBeam` | Continuous freeze ray to nearest enemy, slows them |

#### Evolution Weapons (6)

Evolutions consume two base weapons and replace them with a stronger combined form:

| Evolution | Requires | What it does |
|---|---|---|
| Beam Lash | Laser lv3 + Plasma Whip lv2 | Simultaneous piercing bolt + arc swing |
| Dark Matter | Laser lv3 + Plasma Bomb lv2 | Slow singularity orb with massive final explosion |
| Nova Burst | Force Field lv2 + Plasma Bomb lv3 | Damage ring + 6-way radial orbs |
| Solar Flare | Laser lv2 + Pulse Cannon lv2 | 8-way piercing solar bolts |
| Quantum Torpedo | Missile Barrage lv2 + Plasma Bomb lv2 | Giant homing bomb |
| Glacial Storm | Cryo Beam lv2 + Force Field lv2 | Freeze field + cryo pulses |

#### Adding a new weapon

1. Add a class implementing `Weapon` to `weapons.ts`.
2. Add a `case` to `createWeaponByName()` in `weapons.ts`.
3. Add `add_<name>` and stat upgrade entries to `UPGRADE_POOL` in `levelup.ts`.
4. Add sprite grid + color entries to `WEAPON_SPRITE_GRIDS` / `WEAPON_SPRITE_COLORS` in `hud.ts`.

---

### Enemy AI & Spawning

**`EnemySpawner`** manages:

- **Spawn interval**: starts at 0.9 s, floors at 0.2 s as time passes.
- **Spawn count**: 1 enemy per batch initially, grows by 1 every 20 seconds.
- **HP scaling**: combined linear + multiplicative formula tied to elapsed minutes so early-game enemies are manageable but late-game enemies are significantly tankier.
- **Type selection**: roll-based weighted probability; rarer types (ranged, splitter) unlock after certain time thresholds.
- **Spawn position**: one of the four screen edges, offset just beyond the visible area.

**Per-type AI**:

| Type | Behaviour |
|---|---|
| `grunt` | Constant homing movement |
| `fast` | Fast constant homing |
| `tank` | Slow constant homing, high HP |
| `charger` | Patrols slowly, then dashes at the player every 2.5–4 s |
| `ranged` | Maintains ~220 px preferred distance; backs away if too close, strafes when comfortable |
| `splitter` | Homing; on death spawns two `splitterlet` children |
| `splitterlet` | Fast homing child of a splitter |

**Slow mechanic**: cryo weapons set `enemy.slowMultiplier < 1`; it recovers at 1.5 per second.

---

### Levelling & Upgrades

`LevelUpManager` tracks `xp` and `xpToNext`.  
When XP overflows the threshold it increments `level`, calls `xpForLevel(level)` to get the next threshold, and fires `onLevelUp`.

`onLevelUp` is set by `main.ts` to pause the game and show three randomly-sampled upgrades from `UPGRADE_POOL` that pass their `requires()` predicate.

**Upgrade categories**:
- **Weapon stat upgrades** — damage / rate / range / pierce per weapon
- **Weapon unlocks** — add a new weapon slot (up to 4 total)
- **Evolution upgrades** — consume two base weapons, add one evolution
- **Generic powerups** — speed, max HP, armor, pickup radius, global damage / fire-rate

Each generic powerup caps at **5 stacks** (`MAX_GENERIC_UPGRADES`) tracked on Player fields (`atkSpeedUpgrades`, `damageUpgrades`, etc.).  
Base weapons cap at level **5**, evolutions at level **3**.

---

### XP Gems

`GemManager` holds a flat `gems: Gem[]` array.

Each frame:
1. Gems within the player's **pull radius** fly toward the player at 200 px/s.
2. Gems within the **collect radius** (30 px) are marked dead and their value is returned as XP.
3. When the gem count exceeds **80**, a periodic **compaction** pass (every 0.4 s) merges nearby gems using a weighted-average position, keeping visual clutter down.

Gem color and size scale with XP value so rare/merged gems are visually distinctive:

| Value | Color |
|---|---|
| 1 | Teal-mint |
| 2–4 | Cyan |
| 5–9 | Sky blue |
| 10–24 | Magenta |
| 25+ | Gold |

---

### HUD

`HUD.draw()` is called once per frame in screen space (no camera transform).

Elements:
- **Shield bar** (top-left) — player HP as a fraction.
- **XP bar** (top-left, below shield) — current XP within the level.
- **Timer** (top-centre) — elapsed gameplay seconds formatted as `M:SS`.
- **Kill counter** (top-right) — `✦ N` kills.
- **Weapon icons** (bottom-centre) — one card per active weapon showing an 8×8 pixel sprite, name, and level.

All sizes are scaled by `s = clamp(canvas.width / 480, 1, 2.5)` so the HUD remains proportional on both desktop and mobile.

Weapon sprites are defined as 8-row string arrays in `WEAPON_SPRITE_GRIDS`; `'1'` = primary color, `'2'` = secondary color, `'.'` = transparent.

---

## Getting Started

```bash
npm install
npm run dev      # starts the Vite dev server at http://localhost:5173
npm run build    # TypeScript compile + Vite production bundle → dist/
npm run preview  # locally preview the production build
```

---

## Controls

| Input | Action |
|---|---|
| **WASD** / **Arrow keys** | Move ship |
| **Left-click + drag** | Move toward cursor |
| **Touch + drag** | Move toward finger |
| **P** / **Escape** | Pause / resume |
| **⏸ button** | Pause / resume |
| Upgrade card click | Pick level-up upgrade |
| RESPAWN button | Restart (page reload) |

Weapons fire automatically — no manual shooting required.
