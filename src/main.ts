// ─── main.ts ──────────────────────────────────────────────────────────────────
// Entry point and game-loop orchestrator.
//
// Responsibilities
// ─────────────────
// • Creates and owns all top-level game objects (camera, player, spawner, etc.)
// • Runs the requestAnimationFrame game loop (loop → update → render).
// • Manages the full GameState machine and transitions between states.
// • Title / difficulty screens, soft-restart (no page reload), high-score,
//   post-run stats, and procedural audio are all orchestrated here.
//
// GameState machine
// ──────────────────
//   title      → difficulty  (player presses PLAY)
//   difficulty → playing     (player selects a difficulty)
//   playing    → levelup     (player gains enough XP)
//   levelup    → playing     (player picks an upgrade card)
//   playing    → paused      (player presses P/Escape or ⏸)
//   paused     → playing     (player presses P/Escape or ▶ / RESUME)
//   playing    → gameover    (player HP hits 0)
//   gameover   → difficulty  (player presses RESTART — soft reset, no page reload)
//
// Render order (back-to-front)
// ──────────────────────────────
//   1. Black background clear
//   2. Parallax star field
//   3. XP gems
//   4. Enemies
//   5. Projectiles
//   6. Player ship
//   7. Weapon effects
//   8. Floating damage numbers
//   9. HUD (always on top)
// ──────────────────────────────────────────────────────────────────────────────

import { Camera } from './camera';
import { Player } from './player';
import { EnemySpawner, damageEvents, setDoTChances, setDifficultyMultipliers } from './enemies';
import { ProjectilePool } from './projectiles';
import { GemManager } from './gems';
import { MagicBolt, createWeaponByName, type AnyWeapon, type Weapon } from './weapons';
import { LevelUpManager, type Upgrade, type ApplyUpgradeFn } from './levelup';
import { HUD } from './hud';
import { AudioManager } from './audio';
import { DamageNumberPool } from './damage-numbers';

// ─── Global singletons (survive restarts) ────────────────────────────────────
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const audio = new AudioManager();

function resizeCanvas(): void {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ─── Persistent high score ────────────────────────────────────────────────────
const HS_KEY = 'vamp_highscore';

function loadHighScore(): number {
  try {
    return parseInt(localStorage.getItem(HS_KEY) ?? '0', 10) || 0;
  } catch { return 0; }
}

function saveHighScore(kills: number): void {
  try {
    const prev = loadHighScore();
    if (kills > prev) localStorage.setItem(HS_KEY, String(kills));
  } catch { /* storage unavailable */ }
}

// ─── Last-run stats (Feature 12) ──────────────────────────────────────────────
const LAST_RUN_KEY = 'vamp_last_run';

interface LastRunData {
  elapsed: number;
  kills: number;
  level: number;
  difficulty: string;
  weapons: Array<{ name: string; damage: number }>;
}

function saveLastRun(data: LastRunData): void {
  try { localStorage.setItem(LAST_RUN_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

// ─── GameState ────────────────────────────────────────────────────────────────
type GameState = 'title' | 'difficulty' | 'playing' | 'levelup' | 'gameover' | 'paused';
let state: GameState = 'title';

// ─── Difficulty ───────────────────────────────────────────────────────────────
interface DifficultyConfig {
  label: string;
  hp: number;
  damage: number;
  spawnRate: number;
}

const DIFFICULTIES: Record<string, DifficultyConfig> = {
  easy:   { label: 'Easy',   hp: 0.75, damage: 0.75, spawnRate: 0.80 },
  normal: { label: 'Normal', hp: 1.00, damage: 1.00, spawnRate: 1.00 },
  hard:   { label: 'Hard',   hp: 1.40, damage: 1.30, spawnRate: 1.20 },
  void:   { label: 'Void',   hp: 2.00, damage: 1.75, spawnRate: 1.50 },
};

let currentDifficulty: string = 'normal';

// ─── Per-run mutable state ────────────────────────────────────────────────────
let elapsed = 0;
let kills   = 0;
let lastTime: number | null = null;

// ─── Game objects (re-created on soft restart) ────────────────────────────────
let camera:   Camera;
let player:   Player;
let spawner:  EnemySpawner;
let pool:     ProjectilePool;
let gems:     GemManager;
let hud:      HUD;
let levelMgr: LevelUpManager;
let weapons:  AnyWeapon[];
let damageNumbers: DamageNumberPool;

function initGameObjects(): void {
  camera        = new Camera(canvas);
  player        = new Player(canvas, camera);
  spawner       = new EnemySpawner(canvas, camera);
  pool          = new ProjectilePool();
  gems          = new GemManager();
  hud           = new HUD();
  levelMgr      = new LevelUpManager();
  damageNumbers = new DamageNumberPool();
  weapons       = [new MagicBolt()];
  elapsed       = 0;
  kills         = 0;
  lastTime      = null;

  const diff = DIFFICULTIES[currentDifficulty]!;
  setDifficultyMultipliers(diff.hp, diff.damage, diff.spawnRate);

  levelMgr.onLevelUp = (choices: Upgrade[], applyFn: ApplyUpgradeFn) => {
    state = 'levelup';
    audio.levelUp();
    showLevelUpUI(choices, applyFn);
  };
}

function addWeapon(name: string): void {
  if (weapons.length >= 4) return;
  if (!weapons.some(w => w.name === name)) {
    const w = createWeaponByName(name);
    if (w) {
      w.scaleStats(player.attackSpeedMult, player.damageMult);
      weapons.push(w);
    }
  }
}

function removeWeapon(name: string): void {
  const idx = weapons.findIndex(w => w.name === name);
  if (idx !== -1) weapons.splice(idx, 1);
}

// ─── HTML elements ────────────────────────────────────────────────────────────
const titleOverlay      = document.getElementById('titleOverlay')!;
const difficultyOverlay = document.getElementById('difficultyOverlay')!;
const levelUpOverlay    = document.getElementById('levelUpOverlay')!;
const upgradeCards      = document.getElementById('upgradeCards')!;
const gameOverOverlay   = document.getElementById('gameOverOverlay')!;
const gameOverStats     = document.getElementById('gameOverStats')!;
const restartBtn        = document.getElementById('restartBtn')!;
const pauseOverlay      = document.getElementById('pauseOverlay')!;
const pauseStats        = document.getElementById('pauseStats')!;
const pauseWeapons      = document.getElementById('pauseWeapons')!;
const resumeBtn         = document.getElementById('resumeBtn')!;
const menuBtn           = document.getElementById('menuBtn')!;
const muteBtn           = document.getElementById('muteBtn')!;
const highScoreDisplay  = document.getElementById('highScoreDisplay')!;

// ─── Title Screen ─────────────────────────────────────────────────────────────
function showTitle(): void {
  state = 'title';
  titleOverlay.classList.remove('hidden');
  difficultyOverlay.classList.add('hidden');
  levelUpOverlay.classList.add('hidden');
  gameOverOverlay.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  menuBtn.classList.add('hidden');
  // Update high-score display
  highScoreDisplay.textContent = `Best: ${loadHighScore()} kills`;
  audio.titleJingle();
}

document.getElementById('playBtn')!.addEventListener('click', () => {
  titleOverlay.classList.add('hidden');
  showDifficulty();
});

// ─── Difficulty Screen ────────────────────────────────────────────────────────
function showDifficulty(): void {
  state = 'difficulty';
  difficultyOverlay.classList.remove('hidden');
}

// Bind difficulty buttons
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const diff = (btn as HTMLElement).dataset['difficulty'] ?? 'normal';
    currentDifficulty = diff;
    difficultyOverlay.classList.add('hidden');
    startNewRun();
  });
});

function startNewRun(): void {
  initGameObjects();
  state = 'playing';
  menuBtn.classList.remove('hidden');
}

// ─── Level-up UI ──────────────────────────────────────────────────────────────
function showLevelUpUI(choices: Upgrade[], applyFn: ApplyUpgradeFn): void {
  menuBtn.classList.add('hidden');
  upgradeCards.innerHTML = '';
  for (const choice of choices) {
    const card = document.createElement('button');
    card.className = 'upgrade-card';
    card.innerHTML = `<span class="card-label">${choice.label}</span><span class="card-desc">${choice.desc}</span>`;
    card.addEventListener('click', () => {
      applyFn(choice);
      hideLevelUpUI();
    });
    upgradeCards.appendChild(card);
  }
  levelUpOverlay.classList.remove('hidden');
}

function hideLevelUpUI(): void {
  levelUpOverlay.classList.add('hidden');
  menuBtn.classList.remove('hidden');
  state = 'playing';
}

// ─── Game Over UI ─────────────────────────────────────────────────────────────
function showGameOver(): void {
  menuBtn.classList.add('hidden');
  audio.gameOver();

  const mins = Math.floor(elapsed / 60);
  const secs = Math.floor(elapsed % 60).toString().padStart(2, '0');
  const hs    = loadHighScore();
  saveHighScore(kills);
  const newHs = loadHighScore();
  const isNew = newHs > hs;

  // Build weapon damage stats
  const wStats = weapons.map(w => ({
    name:   w.name,
    damage: w.totalDamageDealt ?? 0,
  })).sort((a, b) => b.damage - a.damage);

  saveLastRun({
    elapsed,
    kills,
    level: levelMgr.level,
    difficulty: currentDifficulty,
    weapons: wStats,
  });

  const weaponRows = wStats
    .map(w => `<div class="stats-weapon-row"><span>${w.name}</span><span>${w.damage.toLocaleString()} dmg</span></div>`)
    .join('');

  gameOverStats.innerHTML = `
    <div class="stats-line">Survived: <b>${mins}:${secs}</b> &nbsp; Kills: <b>${kills}</b> &nbsp; Level: <b>${levelMgr.level}</b></div>
    <div class="stats-line">Difficulty: <b>${DIFFICULTIES[currentDifficulty]!.label}</b> &nbsp; High Score: <b>${newHs}</b>${isNew ? ' 🏆 NEW!' : ''}</div>
    <div class="stats-weapons">${weaponRows}</div>
  `;

  gameOverOverlay.classList.remove('hidden');
}

// Soft restart — go back to difficulty screen
restartBtn.addEventListener('click', () => {
  gameOverOverlay.classList.add('hidden');
  showDifficulty();
});

// ─── Pause UI ─────────────────────────────────────────────────────────────────
function showPause(): void {
  state = 'paused';
  lastTime = null;
  menuBtn.textContent = '▶';

  const mins  = Math.floor(elapsed / 60);
  const secs  = Math.floor(elapsed % 60).toString().padStart(2, '0');
  const hpPct = Math.round((player.hp / player.maxHp) * 100);

  pauseStats.innerHTML = `
    <span><span class="stat-val">${mins}:${secs}</span>TIME</span>
    <span><span class="stat-val">${kills}</span>KILLS</span>
    <span><span class="stat-val">LV ${levelMgr.level}</span>RANK</span>
    <span><span class="stat-val">${hpPct}%</span>SHIELD</span>
  `;

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
  state = 'playing';
}

menuBtn.addEventListener('click', () => {
  if (state === 'playing') showPause();
  else if (state === 'paused') hidePause();
});

resumeBtn.addEventListener('click', hidePause);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (state === 'playing') showPause();
    else if (state === 'paused') hidePause();
  }
});

// ─── Mute Button ──────────────────────────────────────────────────────────────
muteBtn.addEventListener('click', () => {
  audio.muted = !audio.muted;
  muteBtn.textContent = audio.muted ? '🔇' : '🔊';
});

// ─── Update ───────────────────────────────────────────────────────────────────
function update(dt: number): void {
  if (state !== 'playing') return;

  elapsed += dt;

  // Keep DoT chances in sync with player upgrades
  setDoTChances(player.burnChance, player.poisonChance);

  player.update(dt);
  camera.follow(player.x, player.y);

  const bossSpawned = spawner.update(dt, player);
  if (bossSpawned) {
    audio.bossSpawn();
  }

  for (const w of weapons) {
    w.update(dt, player, spawner.enemies, pool);
  }

  pool.update(dt, canvas, camera, spawner.enemies);

  // Process damage events for floating numbers + audio
  let hitSoundThisFrame = false;
  for (const ev of damageEvents) {
    const color = ev.isBoss ? '#ff8a80' : '#ffffff';
    damageNumbers.spawn(ev.x, ev.y, ev.amount, color);
    if (!hitSoundThisFrame) {
      audio.hit();
      hitSoundThisFrame = true;
    }
  }
  damageEvents.length = 0;

  // Floating numbers advance
  damageNumbers.update(dt);

  const dead = spawner.collectDead();
  for (const e of dead) {
    kills++;
    gems.spawnFromEnemy(e);
    if (e.isBoss) {
      audio.bossDeath();
    } else {
      audio.enemyDeath();
    }
  }

  const xpGained = gems.update(dt, player);
  if (xpGained > 0) {
    audio.gemPickup();
    levelMgr.addXp(xpGained, weapons, addWeapon, player, removeWeapon);
  }

  if (!player.alive && state === 'playing') {
    state = 'gameover';
    showGameOver();
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render(): void {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#00000e';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (state === 'title' || state === 'difficulty') {
    // Draw a simple animated background on title/difficulty screens
    camera.drawStarField(ctx);
    return;
  }

  camera.drawStarField(ctx);
  gems.draw(ctx, camera);
  spawner.draw(ctx, camera);
  pool.draw(ctx, camera);
  player.draw(ctx, camera);

  for (const w of weapons) {
    w.draw?.(ctx, camera, player);
  }

  damageNumbers.draw(ctx, camera);

  hud.draw(
    ctx, canvas, player, levelMgr, elapsed, kills, weapons as Weapon[],
    spawner.enemies, spawner.activeBoss,
  );
}

// ─── Game Loop ────────────────────────────────────────────────────────────────
function loop(timestamp: number): void {
  if (lastTime === null) lastTime = timestamp;
  const dt = state === 'paused' ? 0 : Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = (state === 'paused') ? null : timestamp;

  update(dt);
  render();

  requestAnimationFrame(loop);
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
initGameObjects(); // pre-initialise so render() has valid references
showTitle();
requestAnimationFrame(loop);

