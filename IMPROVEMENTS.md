# Vamp – Game Overview & Improvement Suggestions

> This document provides a current snapshot of the game's state and a set of focused
> improvement ideas, each formatted as a ready-to-use agent prompt so any suggestion
> can be handed directly to a new Copilot coding-agent session.

---

## Current Game Overview

### What the game is

**Vamp – Space Survivors** is a browser-based top-down auto-shooter in the style of
*Vampire Survivors*.  The player pilots a spaceship that moves toward the cursor (or
via WASD / arrow keys) while all weapons fire automatically at the nearest enemy.
The goal is to survive as long as possible as enemy waves escalate in number and health.

Built entirely with TypeScript + Canvas 2D (no frameworks, no image assets).  
Bundled and served by Vite.  ~4 000 lines of code across 10 source files.

---

### Core systems (what already exists)

| System | Status | Notes |
|--------|--------|-------|
| Game loop (`main.ts`) | ✅ | rAF loop, dt-capped, 4 states: `playing / levelup / paused / gameover` |
| Player ship (`player.ts`) | ✅ | WASD + mouse/touch input, i-frames, thruster animation, armor / HP |
| Camera + star field (`camera.ts`) | ✅ | World↔screen transforms, 3-layer parallax stars |
| Enemy spawning + AI (`enemies.ts`) | ✅ | 7 enemy types; waves scale by time; HP scales linearly + multiplicatively |
| Weapons (`weapons.ts`) | ✅ | 8 base weapons + 6 evolution weapons, auto-target nearest enemy |
| Projectile pool (`projectiles.ts`) | ✅ | Fast linear bolts with pierce support |
| XP gems (`gems.ts`) | ✅ | Pull radius, collect radius, gem compaction, color tiers |
| Level-up / upgrade system (`levelup.ts`) | ✅ | XP thresholds, 50+ upgrades, evolution merging, 5-stack generic caps |
| HUD (`hud.ts`) | ✅ | HP bar, XP bar, timer, kill counter, weapon icon strip |
| Pause / game-over overlays (HTML/CSS) | ✅ | Pause shows live stats + weapon cards; game-over shows final stats |
| Responsive / mobile support | ✅ | Canvas fills viewport; HUD scales; touch drag movement |
| TypeScript strict mode | ✅ | No `any` leakage, clean tsc build |

### Weapons at a glance

**Base (8):** Laser · Plasma Whip · Plasma Bomb · Ion Chain · Force Field · Missile Barrage · Pulse Cannon · Cryo Beam  
**Evolutions (6):** Beam Lash · Dark Matter · Nova Burst · Solar Flare · Quantum Torpedo · Glacial Storm

### Enemy types (7)

`grunt` · `fast` · `tank` · `charger` · `ranged` · `splitter` · `splitterlet`

### Player upgrades

Generic powerups (each capped at 5 stacks): Thruster Up · Shield Capacity Up · Systems Overclock · Weapons Amplifier · Tractor Beam · Titanium Plating · Emergency Repair  
Per-weapon: damage / rate / range / pierce upgrades for every base and evolution weapon  
Unlocks: one card per weapon slot (max 4 weapons)  
Evolutions: six merge upgrades available when prerequisites are met

### What is currently missing

- ❌ No persistent high score / run history (page reload wipes everything)  
- ❌ No sound effects or music  
- ❌ No title/start screen — game begins immediately on page load  
- ❌ No true boss encounters (tank enemy is "boss-like" but spawns with the regular wave)  
- ❌ No visual hit feedback (damage numbers, screen shake, hit flash on enemies)  
- ❌ No difficulty selector  
- ❌ No achievement / challenge system  
- ❌ No minimap  
- ❌ No status-effect variety beyond slow (no burn, poison, stun)  
- ❌ No character / ship selection  
- ❌ Restart is a full page reload (all state lost, no soft-reset)

---

## Improvement Suggestions as Agent Prompts

Each entry below is a self-contained prompt you can paste into a new Copilot
coding-agent session to implement that feature.

---

### 1 · Persistent High Score with localStorage

```
You are working on the 'FinnWard/vamp' repository — a browser-based top-down
auto-shooter (Vampire Survivors style) built with TypeScript and Canvas 2D.

Task: Add a persistent high-score system using localStorage.

Requirements:
1. At game-over, compare the current run's score (survived time in seconds) against
   the stored best.  If it is a new record, save it and show "NEW BEST!" in the
   game-over overlay.
2. Add a "Best" line to the game-over overlay that always shows the all-time best
   time, kills, and level reached (load from localStorage on startup).
3. Store the record as a JSON object under the key "vamp_best" in localStorage.
   Fields: { time: number, kills: number, level: number }.
4. Keep all changes minimal: no new files unless necessary; add the logic to
   main.ts (game-over section) and update index.html / CSS only as needed.
5. Build must pass: npm run build.
```

---

### 2 · Sound Effects via Web Audio API

```
You are working on the 'FinnWard/vamp' repository — a browser-based top-down
auto-shooter built with TypeScript and Canvas 2D (no external audio assets).

Task: Add procedurally-generated sound effects using the Web Audio API (no audio
files needed — generate all sounds with oscillators and noise buffers).

Sounds to implement (all short, non-intrusive):
- Laser fire: short high-pitched blip (~80 ms, sine, 880 Hz → 440 Hz glide)
- Enemy hit: brief crackle (~60 ms, white noise burst)
- Enemy death: short descending tone (~120 ms)
- Player hit: low thud + brief silence on i-frames (~100 ms)
- Level-up: ascending chime (~400 ms, three notes)
- Gem collect: tiny ping (~40 ms)

Architecture:
1. Create src/audio.ts exporting a singleton AudioManager class.
2. AudioManager.init() must be called on the first user gesture (click/keydown)
   to comply with browser autoplay policies — hook this into main.ts.
3. Expose one method per sound, e.g. AudioManager.play('laser').
4. Weapons call the relevant sound in their update() — pass the manager via
   dependency injection or a module-level singleton.
5. Add a mute toggle (M key) that suspends/resumes the AudioContext.
6. Build must pass: npm run build.
```

---

### 3 · Title / Start Screen

```
You are working on the 'FinnWard/vamp' repository — a browser-based top-down
auto-shooter built with TypeScript and Canvas 2D.

Task: Add a title screen that is shown before gameplay begins.

Requirements:
1. Add a new GameState value 'title' to the state machine in main.ts.
   The game starts in 'title' state instead of 'playing'.
2. Add a #titleOverlay in index.html (same .overlay pattern as the existing
   pause / game-over overlays) containing:
   - The game title "VAMP" styled like the rest of the UI (Press Start 2P font,
     cyan glow text-shadow).
   - A subtitle: "SPACE SURVIVORS".
   - A "LAUNCH" button that transitions to 'playing'.
   - One line of control hints (WASD / mouse to move, weapons auto-fire).
3. While in 'title' state, the game canvas should still render one frozen frame
   (stars only, no player/enemies) as a background — reuse the existing render()
   call for this.
4. Do not add a new file; extend main.ts and index.html / CSS in-place.
5. Build must pass: npm run build.
```

---

### 4 · Soft Restart (no page reload)

```
You are working on the 'FinnWard/vamp' repository — a browser-based top-down
auto-shooter built with TypeScript and Canvas 2D.

Task: Replace the current page-reload restart with a proper in-game soft reset
so that all game state is re-initialised without reloading the page.

Requirements:
1. Create a resetGame() function in main.ts that:
   - Resets elapsed, kills, lastTime.
   - Re-initialises player HP/position/stats to defaults (add a Player.reset()
     method or re-construct the Player).
   - Clears weapons[] back to [new MagicBolt()].
   - Calls spawner.reset() / gems.reset() / pool.reset() / levelMgr.reset()
     (add reset() methods to each class as needed).
   - Sets state = 'playing'.
2. Wire the RESPAWN button in the game-over overlay to resetGame() instead of
   window.location.reload().
3. Ensure no stale state leaks between runs (timers, dead enemies, gems, etc.).
4. Build must pass: npm run build.  Run the game manually to verify a second run
   starts cleanly.
```

---

### 5 · Floating Damage Numbers

```
You are working on the 'FinnWard/vamp' repository — a browser-based top-down
auto-shooter built with TypeScript and Canvas 2D.

Task: Add floating damage numbers that pop up over enemies when they take damage,
giving the player immediate visual feedback on weapon effectiveness.

Requirements:
1. Create a DamageNumber type/class in a new src/damagenumbers.ts file:
   - Stores world position (x, y), value (number), age, lifetime (~0.7 s).
   - Each frame: move upward (~40 px/s), fade out (alpha = 1 - age/lifetime).
   - Drawn in screen space after enemies but before the HUD.
2. Create a DamageNumberPool singleton that batches spawn / update / draw calls.
3. Integrate with the damage path: when a projectile hits an enemy
   (projectiles.ts, pool.update), and when AoE weapons deal damage (weapons.ts,
   inside each weapon's update), call pool.spawn(x, y, amount).
4. Color-code by damage range: white < 15, yellow 15–40, orange 40–80, red > 80.
5. Cap at 80 active numbers to avoid performance issues (drop oldest on overflow).
6. Build must pass: npm run build.
```

---

### 6 · Screen Shake & Enemy Hit Flash

```
You are working on the 'FinnWard/vamp' repository — a browser-based top-down
auto-shooter built with TypeScript and Canvas 2D.

Task: Add two polish effects — screen shake on player damage and a brief white
flash on enemies when they are hit.

Screen shake:
1. Add shake(intensity: number, duration: number) to the Camera class.
   Internally track shakeIntensity and shakeTimer.
2. In Camera.worldToScreen(), add a random pixel offset (±intensity) while the
   timer is active; decay intensity linearly over duration seconds.
3. Trigger shake(6, 0.15) from Player.takeDamage() (only when damage > 0 after
   armor reduction).

Enemy hit flash:
1. Add hitFlashTimer: number = 0 to the Enemy class.
2. In Enemy.takeDamage() (or wherever HP is reduced), set hitFlashTimer = 0.1.
3. In Enemy.draw(), when hitFlashTimer > 0, draw the sprite with globalAlpha = 1
   and a white overlay (ctx.fillStyle = 'rgba(255,255,255,0.6)') on top, then
   decrement the timer.

Build must pass: npm run build.
```

---

### 7 · Boss Enemies

```
You are working on the 'FinnWard/vamp' repository — a browser-based top-down
auto-shooter built with TypeScript and Canvas 2D.

Task: Add a periodic boss encounter that spawns every 2 minutes of elapsed
gameplay time, replacing the normal wave for that spawn cycle.

Requirements:
1. Add a new EnemyType 'boss' to enemies.ts with:
   - radius: 40, speed: 40, base HP: 500 (scaled by the normal hpMultiplier),
     damage: 30/s, xpValue: 25.
   - Distinct pixel-art sprite (large, different color — e.g. deep crimson #b71c1c
     with bright red #ef5350 accents).
   - AI: alternates between charging the player (like 'charger') and projecting
     a rotating slow-moving AoE pulse ring (reuse ExplosionEffect visually, but
     make it deal damage while expanding — attach it to the enemy).
2. In EnemySpawner, track the last boss spawn time.  Every 120 s of elapsed
   gameplay, spawn exactly one 'boss' regardless of the normal wave roll.
3. Add a simple boss health bar to the HUD: when a boss is alive, draw a wide
   red bar at the bottom-centre of the screen above the weapon icons showing its
   HP as a fraction with the label "BOSS".
4. Build must pass: npm run build.
```

---

### 8 · Additional Status Effects (Burn & Poison)

```
You are working on the 'FinnWard/vamp' repository — a browser-based top-down
auto-shooter built with TypeScript and Canvas 2D.

Task: Add two new damage-over-time status effects to enemies: Burn and Poison.
These complement the existing Slow mechanic (used by Cryo Beam) and open the
door to new weapon upgrades.

Shared mechanic (add to Enemy class in enemies.ts):
1. burnTimer: number = 0  — while > 0, deal 8 dmg/s (orange tint on sprite).
2. poisonTimer: number = 0 — while > 0, deal 5 dmg/s and reduce max-speed by 10%
   (green tint on sprite).
3. In Enemy.update(), reduce both timers by dt and apply their damage via
   enemy.takeDamage(amount * dt).
4. Add Enemy.applyBurn(duration) and Enemy.applyPoison(duration) helper methods.

Weapon integration:
5. Make Plasma Bomb apply 2 s burn on hit (in Fireball.update() / explosion logic).
6. Make Ion Chain apply 1.5 s poison on each zap.

New upgrades (add to UPGRADE_POOL in levelup.ts):
7. 'bolt_burn'  — Laser: bolts apply 1 s burn (requires Laser lv2).
8. 'whip_poison' — Plasma Whip: arc applies 1.5 s poison (requires Plasma Whip lv2).

Build must pass: npm run build.
```

---

### 9 · Difficulty Selector

```
You are working on the 'FinnWard/vamp' repository — a browser-based top-down
auto-shooter built with TypeScript and Canvas 2D.

Task: Add a difficulty selector that players choose before starting a run.

Difficulties:
- Easy   — enemy HP ×0.7, spawn interval ×1.3
- Normal — no change (current values)
- Hard   — enemy HP ×1.4, spawn interval ×0.75, damage ×1.25
- Void   — enemy HP ×2.0, spawn interval ×0.55, damage ×1.5, +10% speed

Implementation:
1. Add a GameState 'title' (or extend it if that was already added).  If a title
   screen does not exist yet, add one following the existing overlay pattern
   (#titleOverlay in index.html).
2. Add difficulty radio/button selector on the title/start overlay; persist the
   chosen level in a module variable `difficulty` in main.ts.
3. Pass the multipliers into EnemySpawner as constructor options (or setter) and
   into the HP-scaling formula in enemies.ts.
4. Show the selected difficulty label in the HUD timer area (small text suffix,
   e.g. "2:34 [HARD]").
5. Show it on the game-over screen as well.
6. Build must pass: npm run build.
```

---

### 10 · Minimap

```
You are working on the 'FinnWard/vamp' repository — a browser-based top-down
auto-shooter built with TypeScript and Canvas 2D.

Task: Add a small minimap in the bottom-right corner of the HUD that shows the
positions of nearby enemies relative to the player.

Requirements:
1. Add drawMinimap() to HUD (hud.ts).  Call it at the end of HUD.draw().
2. Map size: 80×80 screen px (scaled by the same `s` factor used elsewhere in
   hud.ts).  Position: bottom-right corner, 10 px margin.
3. Background: semi-transparent dark rect (rgba 0,0,0,0.6) with a thin border.
4. Player: white dot at centre.
5. Enemies: small colored dots (use the same color as each enemy type).  Scale
   world-space positions relative to a 600 px world radius → minimap radius.
   Clamp dots to the edge of the minimap if they are further than 600 px away.
6. XP gems: tiny cyan dots (only show if within 300 px).
7. Do not show enemy counts above a max of 60 dots (sample randomly if there
   are more) to keep the minimap readable.
8. HUD.draw() signature already receives `enemies` indirectly via the spawner —
   update the call in main.ts to also pass spawner.enemies and gems (or pass them
   as extra parameters to HUD.draw).
9. Build must pass: npm run build.
```

---

### 11 · New Base Weapon: Gravity Well

```
You are working on the 'FinnWard/vamp' repository — a browser-based top-down
auto-shooter built with TypeScript and Canvas 2D.

Task: Add a new base weapon called "Gravity Well" that pulls nearby enemies
toward a deployed orb, then detonates.

Mechanic:
1. Every 3 s (upgradeable to 2 s at max level) the player deploys a stationary
   orb at the current player position.
2. For 1.5 s the orb pulls all enemies within 150 px toward itself (force
   proportional to distance, max pull 120 px/s).
3. After 1.5 s it explodes in a 140 px radius dealing 60 base damage and
   launches the enemies outward (knockback impulse: enemies get a 200 px/s burst
   away from orb centre, decaying to 0 over 0.3 s — add a knockbackVx/Vy field
   to Enemy).
4. Visual: pulsing circle that shrinks as the detonation approaches; bright flash
   on explosion (reuse ExplosionEffect).
5. Add the class to weapons.ts following the existing patterns.
6. Add upgrade entries to levelup.ts: unlock, damage up, range up, rate up.
7. Add sprite grid + colors to hud.ts (WEAPON_SPRITE_GRIDS / WEAPON_SPRITE_COLORS).
8. Add a case to createWeaponByName() in weapons.ts.
9. Build must pass: npm run build.
```

---

### 12 · Run Statistics / Post-Run Summary

```
You are working on the 'FinnWard/vamp' repository — a browser-based top-down
auto-shooter built with TypeScript and Canvas 2D.

Task: Expand the game-over screen to show a detailed post-run summary with
per-weapon damage statistics.

Requirements:
1. Track total damage dealt by each weapon during a run.  Add a
   totalDamageDealt: number = 0 field to each weapon class (or a shared wrapper
   in main.ts), and increment it whenever damage is applied to an enemy.
2. On game-over, the #gameOverStats section should show:
   - Survived time, kills, level (already present — keep these).
   - A "WEAPONS" section listing each equipped weapon name and its total damage
     dealt this run, sorted descending.
   - The weapon that dealt the most damage is labelled "MVP".
3. Style the new section using the existing CSS classes (.card-label, .card-desc,
   etc.) — do not add new CSS rules beyond what is needed.
4. Also store the summary in localStorage under "vamp_last_run" (JSON) for
   potential future features.
5. Build must pass: npm run build.
```

---

*Generated from codebase analysis of commit on 2026-04-11.*
