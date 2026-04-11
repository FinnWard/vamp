// ─── main.ts ──────────────────────────────────────────────────────────────────
// Entry point and game-loop orchestrator.
//
// Responsibilities
// ─────────────────
// • Creates and owns all top-level game objects (camera, player, spawner, etc.)
// • Runs the requestAnimationFrame game loop (loop → update → render).
// • Manages the four possible GameStates and transitions between them.
// • Glues the level-up system to the HTML overlay: shows upgrade cards, hides
//   them on selection, and resumes play.
// • Handles the pause menu and game-over screen.
//
// GameState machine
// ──────────────────
//   playing  → levelup  (player gains enough XP)
//   levelup  → playing  (player picks an upgrade card)
//   playing  → paused   (player presses P/Escape or taps the ⏸ button)
//   paused   → playing  (player presses P/Escape or taps ▶ or RESUME)
//   playing  → gameover (player HP hits 0)
//   gameover → playing  (page reloads — simplest reset approach)
//
// Render order (back-to-front)
// ──────────────────────────────
//   1. Black background clear
//   2. Parallax star field
//   3. XP gems
//   4. Enemies
//   5. Projectiles (from the ProjectilePool)
//   6. Player ship
//   7. Weapon effects (arcs, beams, orbs, etc.)
//   8. HUD (always on top)
// ──────────────────────────────────────────────────────────────────────────────

import { Camera } from './camera';
import { Player } from './player';
import { EnemySpawner } from './enemies';
import { ProjectilePool } from './projectiles';
import { GemManager } from './gems';
import { MagicBolt, createWeaponByName, type AnyWeapon, type Weapon } from './weapons';
import { LevelUpManager, type Upgrade, type ApplyUpgradeFn } from './levelup';
import { HUD } from './hud';

/** The four mutually-exclusive states the game can be in. */
type GameState = 'playing' | 'levelup' | 'gameover' | 'paused';

// ─── Canvas Setup ─────────────────────────────────────────────────────────────
// The canvas fills the entire viewport; it is resized whenever the window
// changes size (e.g. phone rotation, browser window resize).
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function resizeCanvas(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ─── Game State ───────────────────────────────────────────────────────────────
let state: GameState = 'playing';
let elapsed = 0;  // total seconds of active gameplay (paused time doesn't count)
let kills = 0;    // total enemies killed this run
/** Timestamp from the previous requestAnimationFrame callback (ms). */
let lastTime: number | null = null;

// ─── Core Objects ─────────────────────────────────────────────────────────────
// All objects are module-level singletons created once and reused for the
// entire run.  Restarting the game does a full page reload rather than
// re-initialising, which keeps the code simple.
const camera   = new Camera(canvas);
const player   = new Player(canvas, camera);
const spawner  = new EnemySpawner(canvas, camera);
const pool     = new ProjectilePool();
const gems     = new GemManager();
const hud      = new HUD();
const levelMgr = new LevelUpManager();

/** Active weapons — starts with just the Laser. */
const weapons: AnyWeapon[] = [new MagicBolt()];

/**
 * Adds a weapon by display name.  Enforces the 4-weapon slot cap, ensures no
 * duplicates, and immediately applies the player's accumulated global speed &
 * damage multipliers so the new weapon matches existing ones.
 */
function addWeapon(name: string): void {
  if (weapons.length >= 4) return;
  if (!weapons.some(w => w.name === name)) {
    const w = createWeaponByName(name);
    if (w) {
      // Scale to current global powerup levels so new weapons aren't weaker
      w.scaleStats(player.attackSpeedMult, player.damageMult);
      weapons.push(w);
    }
  }
}

/**
 * Removes a weapon by display name.  Used by evolution upgrades to consume
 * the two prerequisite weapons before adding the evolved version.
 */
function removeWeapon(name: string): void {
  const idx = weapons.findIndex(w => w.name === name);
  if (idx !== -1) weapons.splice(idx, 1);
}

// ─── Level-up callback ────────────────────────────────────────────────────────
// Wire the LevelUpManager to the HTML overlay.  The manager calls this whenever
// the player gains enough XP; we pause the game and show the upgrade cards.
levelMgr.onLevelUp = (choices: Upgrade[], applyFn: ApplyUpgradeFn) => {
  state = 'levelup';
  showLevelUpUI(choices, applyFn);
};

// ─── Level-up UI ──────────────────────────────────────────────────────────────
const levelUpOverlay = document.getElementById('levelUpOverlay')!;
const upgradeCards   = document.getElementById('upgradeCards')!;

/**
 * Populates and shows the upgrade card overlay.
 * Each choice gets a clickable button; clicking it applies the upgrade and
 * hides the overlay.
 */
function showLevelUpUI(choices: Upgrade[], applyFn: ApplyUpgradeFn): void {
  menuBtn.classList.add('hidden'); // hide pause button while choosing
  upgradeCards.innerHTML = '';
  for (const choice of choices) {
    const card = document.createElement('button');
    card.className = 'upgrade-card';
    card.innerHTML = `<span class="card-label">${choice.label}</span><span class="card-desc">${choice.desc}</span>`;
    card.addEventListener('click', () => {
      applyFn(choice);      // mutate game state
      hideLevelUpUI();      // resume play
    });
    upgradeCards.appendChild(card);
  }
  levelUpOverlay.classList.remove('hidden');
}

function hideLevelUpUI(): void {
  levelUpOverlay.classList.add('hidden');
  menuBtn.classList.remove('hidden');
  state = 'playing'; // resume game loop updates
}

// ─── Game Over UI ─────────────────────────────────────────────────────────────
const gameOverOverlay = document.getElementById('gameOverOverlay')!;
const gameOverStats   = document.getElementById('gameOverStats')!;
const restartBtn      = document.getElementById('restartBtn')!;

/** Shows the game-over screen with the run's final stats. */
function showGameOver(): void {
  menuBtn.classList.add('hidden');
  const mins = Math.floor(elapsed / 60);
  const secs = Math.floor(elapsed % 60).toString().padStart(2, '0');
  gameOverStats.textContent = `Survived: ${mins}:${secs}  |  Kills: ${kills}  |  Level: ${levelMgr.level}`;
  gameOverOverlay.classList.remove('hidden');
}

// Full page reload is the simplest way to reset all game state.
restartBtn.addEventListener('click', () => {
  window.location.reload();
});

// ─── Pause UI ─────────────────────────────────────────────────────────────────
const pauseOverlay  = document.getElementById('pauseOverlay')!;
const pauseStats    = document.getElementById('pauseStats')!;
const pauseWeapons  = document.getElementById('pauseWeapons')!;
const resumeBtn     = document.getElementById('resumeBtn')!;
const menuBtn       = document.getElementById('menuBtn')!;

/** Shows the pause screen with current run stats and equipped weapon details. */
function showPause(): void {
  state = 'paused';
  lastTime = null; // reset dt so resuming doesn't jump forward in time
  menuBtn.textContent = '▶';

  const mins = Math.floor(elapsed / 60);
  const secs = Math.floor(elapsed % 60).toString().padStart(2, '0');
  const hpPct = Math.round((player.hp / player.maxHp) * 100);

  // Populate stat row
  pauseStats.innerHTML = `
    <span><span class="stat-val">${mins}:${secs}</span>TIME</span>
    <span><span class="stat-val">${kills}</span>KILLS</span>
    <span><span class="stat-val">LV ${levelMgr.level}</span>RANK</span>
    <span><span class="stat-val">${hpPct}%</span>SHIELD</span>
  `;

  // Populate weapon cards
  pauseWeapons.innerHTML = '';
  for (const w of weapons) {
    const card = document.createElement('div');
    card.className = `pause-weapon-card${w.isEvolution ? ' evolution' : ''}`;
    card.innerHTML = `
      <div class="pause-weapon-name">${w.isEvolution ? '★ ' : ''}${w.name}</div>
      <div class="pause-weapon-level">Level ${w.level}${w.isEvolution ? '  [EVOLVED]' : ''}</div>
      <div class="pause-weapon-stats">${w.getStats()}</div>
    `;
    pauseWeapons.appendChild(card);
  }

  pauseOverlay.classList.remove('hidden');
}

function hidePause(): void {
  pauseOverlay.classList.add('hidden');
  menuBtn.textContent = '⏸';
  state = 'playing'; // resume game loop updates
}

// Toggle pause via the ⏸ button
menuBtn.addEventListener('click', () => {
  if (state === 'playing') showPause();
  else if (state === 'paused') hidePause();
});

resumeBtn.addEventListener('click', hidePause);

// Toggle pause via Escape or P key
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (state === 'playing') showPause();
    else if (state === 'paused') hidePause();
  }
});

// ─── Update ───────────────────────────────────────────────────────────────────
/**
 * Advances all game simulation by `dt` seconds.
 * No-ops when not in the 'playing' state so paused/levelup/gameover states
 * freeze the simulation cleanly.
 */
function update(dt: number): void {
  if (state !== 'playing') return;

  elapsed += dt;

  // Player movement + input
  player.update(dt);

  // Keep camera centred on player
  camera.follow(player.x, player.y);

  // Spawn and move enemies
  spawner.update(dt, player);

  // Uniform weapon update — all weapons share the same signature
  for (const w of weapons) {
    w.update(dt, player, spawner.enemies, pool);
  }

  // Move projectiles and check hits
  pool.update(dt, canvas, camera, spawner.enemies);

  // Collect kills, spawn gems
  const dead = spawner.collectDead();
  for (const e of dead) {
    kills++;
    gems.spawnFromEnemy(e);
  }

  // Collect gems, add XP (may trigger level-up and suspend 'playing' state)
  const xpGained = gems.update(dt, player);
  if (xpGained > 0) {
    levelMgr.addXp(xpGained, weapons, addWeapon, player, removeWeapon);
  }

  // Check death after all damage has been applied
  if (!player.alive && state === 'playing') {
    state = 'gameover';
    showGameOver();
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
/**
 * Draws one frame.  Called every rAF, even when paused, so the overlays
 * (pause/levelup/gameover) are layered on top of a frozen game frame.
 */
function render(): void {
  ctx.imageSmoothingEnabled = false; // keep pixel art crisp
  // Clear to near-black (not pure black to make stars visible)
  ctx.fillStyle = '#00000e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Parallax star background
  camera.drawStarField(ctx);

  // World objects (back to front)
  gems.draw(ctx, camera);
  spawner.draw(ctx, camera);
  pool.draw(ctx, camera);
  player.draw(ctx, camera);

  // Weapon visual effects (arcs, beams, orbs, etc.)
  // The optional-chain call handles weapons that have no draw() method (e.g. Pulse Cannon).
  for (const w of weapons) {
    w.draw?.(ctx, camera, player);
  }

  // HUD always on top
  hud.draw(ctx, canvas, player, levelMgr, elapsed, kills, weapons as Weapon[]);
}

// ─── Game Loop ────────────────────────────────────────────────────────────────
/**
 * requestAnimationFrame callback.
 *
 * Delta-time computation:
 *   • When paused, dt is forced to 0 and lastTime is reset to null so that
 *     resuming after a long pause doesn't cause a massive dt spike.
 *   • dt is capped at 0.1 s (6 FPS floor) to prevent physics tunnelling on
 *     very slow frames or after the tab goes into the background.
 */
function loop(timestamp: number): void {
  if (lastTime === null) lastTime = timestamp;
  const dt = state === 'paused' ? 0 : Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = state === 'paused' ? null : timestamp;

  update(dt);
  render();

  requestAnimationFrame(loop);
}

// Kick off the first frame
requestAnimationFrame(loop);
