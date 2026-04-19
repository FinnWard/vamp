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
import { EnemySpawner, damageEvents, setDoTChances, setDifficultyMultipliers, setEnemyStage } from './enemies';
import { ProjectilePool } from './projectiles';
import { GemManager } from './gems';
import { MagicBolt, createWeaponByName, type AnyWeapon, type Weapon } from './weapons';
import { LevelUpManager, MAX_GENERIC_UPGRADES, MAX_WEAPON_UPGRADES, type Upgrade, type ApplyUpgradeFn } from './levelup';
import { HUD, drawSpriteToCanvas } from './hud';
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
  stage: string;
  weapons: Array<{ name: string; damage: number }>;
}

function saveLastRun(data: LastRunData): void {
  try { localStorage.setItem(LAST_RUN_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

// ─── GameState ────────────────────────────────────────────────────────────────
type GameState = 'title' | 'difficulty' | 'playing' | 'levelup' | 'gameover' | 'paused';
let state: GameState = 'title';

// ─── Stage progression ────────────────────────────────────────────────────────
interface StageConfig {
  id: string;
  label: string;
  blurb: string;
  hp: number;
  damage: number;
  spawnRate: number;
  enemyStage: number;
}

const STAGES: StageConfig[] = [
  { id: 'stage1', label: 'STAGE 1: OUTSKIRTS',    blurb: 'Grunts, fast scouts, and tanks.',            hp: 1.00, damage: 1.00, spawnRate: 1.00, enemyStage: 1 },
  { id: 'stage2', label: 'STAGE 2: ASSAULT LINE', blurb: 'Adds chargers and denser pressure.',         hp: 1.12, damage: 1.08, spawnRate: 1.08, enemyStage: 2 },
  { id: 'stage3', label: 'STAGE 3: SPLIT HIVE',   blurb: 'Adds splitters and tougher swarm control.', hp: 1.24, damage: 1.16, spawnRate: 1.16, enemyStage: 3 },
  { id: 'stage4', label: 'STAGE 4: NULL FRONT',   blurb: 'Adds ranged skirmishers, mine layers, and max complexity.', hp: 1.36, damage: 1.26, spawnRate: 1.24, enemyStage: 4 },
] as const;

const STAGE_UNLOCK_KEY = 'vamp_unlocked_stage';

function loadUnlockedStageCount(): number {
  try {
    const raw = parseInt(localStorage.getItem(STAGE_UNLOCK_KEY) ?? '1', 10) || 1;
    return Math.min(STAGES.length, Math.max(1, raw));
  } catch {
    return 1;
  }
}

function saveUnlockedStageCount(count: number): void {
  try {
    localStorage.setItem(STAGE_UNLOCK_KEY, String(Math.min(STAGES.length, Math.max(1, count))));
  } catch {
    // storage unavailable
  }
}

function getStageById(stageId: string): StageConfig {
  return STAGES.find(stage => stage.id === stageId) ?? STAGES[0]!;
}

let unlockedStageCount = loadUnlockedStageCount();
let currentStageId: string = STAGES[0]!.id;

// ─── Per-run mutable state ────────────────────────────────────────────────────
let elapsed = 0;
let kills   = 0;
let lastTime: number | null = null;
let bossesDefeated = 0;
let stageUnlockBanner = '';
let stageUnlockBannerTimer = 0;

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

interface WeaponPerformance {
  weapon: Weapon;
  damage: number;
  activeSeconds: number;
  effectiveDps: number;
  damageSharePct: number;
  fieldPower: number;
}

function getWeaponPerformance(weapons: Weapon[]): WeaponPerformance[] {
  const metrics = weapons.map((weapon) => {
    const damage = weapon.totalDamageDealt ?? 0;
    const activeSeconds = Math.max(weapon.activeTimeSeconds ?? 0, 1);
    return {
      weapon,
      damage,
      activeSeconds,
      effectiveDps: damage / activeSeconds,
    };
  });
  const maxEffectiveDps = Math.max(0, ...metrics.map((entry) => entry.effectiveDps));
  const totalDamage = metrics.reduce((sum, entry) => sum + entry.damage, 0);
  return metrics.map((entry) => ({
    ...entry,
    damageSharePct: totalDamage > 0 ? Math.round((entry.damage / totalDamage) * 100) : 0,
    fieldPower: maxEffectiveDps > 0 ? Math.round((entry.effectiveDps / maxEffectiveDps) * 100) : 0,
  })).sort((a, b) => b.fieldPower - a.fieldPower || b.effectiveDps - a.effectiveDps);
}

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
  weapons[0]!.activeTimeSeconds = 0;
  elapsed       = 0;
  kills         = 0;
  lastTime      = null;
  bossesDefeated = 0;
  stageUnlockBanner = '';
  stageUnlockBannerTimer = 0;

  const stage = getStageById(currentStageId);
  setDifficultyMultipliers(stage.hp, stage.damage, stage.spawnRate);
  setEnemyStage(stage.enemyStage);

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
      w.activeTimeSeconds = 0;
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
const difficultyHint    = document.getElementById('difficultyHint')!;
const diffBtns          = document.getElementById('diffBtns')!;
const levelUpOverlay    = document.getElementById('levelUpOverlay')!;
const upgradeCards      = document.getElementById('upgradeCards')!;
const gameOverOverlay   = document.getElementById('gameOverOverlay')!;
const gameOverStats     = document.getElementById('gameOverStats')!;
const restartBtn        = document.getElementById('restartBtn')!;
const pauseOverlay      = document.getElementById('pauseOverlay')!;
const pauseStats        = document.getElementById('pauseStats')!;
const pauseWeapons      = document.getElementById('pauseWeapons')!;
const pausePowerups     = document.getElementById('pausePowerups')!;
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
  renderStageButtons();
  difficultyOverlay.classList.remove('hidden');
}

function renderStageButtons(): void {
  unlockedStageCount = loadUnlockedStageCount();
  difficultyHint.textContent = unlockedStageCount < STAGES.length
    ? `Beat the 3rd boss in a run to unlock ${STAGES[unlockedStageCount]!.label}.`
    : 'All stages unlocked. Every stage still includes boss fights.';
  diffBtns.innerHTML = '';

  STAGES.forEach((stage, index) => {
    const stageNumber = index + 1;
    const unlocked = stageNumber <= unlockedStageCount;
    const btn = document.createElement('button');
    btn.className = 'diff-btn';
    btn.disabled = !unlocked;
    const statLine = `${stage.hp.toFixed(2)}x HP • ${stage.damage.toFixed(2)}x DMG • ${stage.spawnRate.toFixed(2)}x spawns`;
    const lockLine = unlocked
      ? 'UNLOCKED'
      : `LOCKED — Beat boss 3 in ${STAGES[index - 1]!.label}`;
    btn.innerHTML = `
      <span class="diff-name">${stage.label}</span>
      <span class="diff-desc">${stage.blurb}<br>${statLine}</span>
      <span class="diff-lock">${lockLine}</span>
    `;
    if (unlocked) {
      btn.addEventListener('click', () => {
        currentStageId = stage.id;
        difficultyOverlay.classList.add('hidden');
        startNewRun();
      });
    }
    diffBtns.appendChild(btn);
  });
}

function maybeUnlockNextStage(): void {
  if (bossesDefeated !== 3) return;
  const currentIndex = STAGES.findIndex(stage => stage.id === currentStageId);
  const nextUnlockedStage = currentIndex + 2;
  if (nextUnlockedStage > STAGES.length || unlockedStageCount >= nextUnlockedStage) return;
  unlockedStageCount = nextUnlockedStage;
  saveUnlockedStageCount(unlockedStageCount);
  stageUnlockBanner = `${STAGES[nextUnlockedStage - 1]!.label} UNLOCKED`;
  stageUnlockBannerTimer = 4;
}

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

    // Sprite canvas (shown when an icon key is defined)
    if (choice.icon) {
      const spriteCanvas = document.createElement('canvas');
      spriteCanvas.width  = 24;
      spriteCanvas.height = 24;
      spriteCanvas.className = 'card-sprite';
      drawSpriteToCanvas(spriteCanvas, choice.icon);
      card.appendChild(spriteCanvas);
    }

    const labelEl = document.createElement('span');
    labelEl.className = 'card-label';
    labelEl.textContent = choice.label;
    card.appendChild(labelEl);

    const descEl = document.createElement('span');
    descEl.className = 'card-desc';
    descEl.textContent = choice.desc;
    card.appendChild(descEl);

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
  const wStats = getWeaponPerformance(weapons).map((entry) => ({
    name: entry.weapon.name,
    damage: entry.damage,
    effectiveDps: entry.effectiveDps,
    fieldPower: entry.fieldPower,
  }));

  saveLastRun({
    elapsed,
    kills,
    level: levelMgr.level,
    stage: getStageById(currentStageId).label,
    weapons: wStats,
  });

  const weaponRows = wStats
    .map(w => `<div class="stats-weapon-row"><span>${w.name}</span><span>${w.damage.toLocaleString()} dmg • ${w.effectiveDps.toFixed(1)} dps • PWR ${w.fieldPower}</span></div>`)
    .join('');

  gameOverStats.innerHTML = `
    <div class="stats-line">Survived: <b>${mins}:${secs}</b> &nbsp; Kills: <b>${kills}</b> &nbsp; Level: <b>${levelMgr.level}</b></div>
    <div class="stats-line">Stage: <b>${getStageById(currentStageId).label}</b> &nbsp; Bosses: <b>${bossesDefeated}</b> &nbsp; High Score: <b>${newHs}</b>${isNew ? ' 🏆 NEW!' : ''}</div>
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
  for (const perf of getWeaponPerformance(weapons)) {
    const w = perf.weapon;
    const weaponUpgrades = Math.max(0, w.level - 1);
    const card = document.createElement('div');
    card.className = `pause-weapon-card${w.isEvolution ? ' evolution' : ''}`;
    card.innerHTML = `
      <div class="pause-weapon-name">${w.isEvolution ? '★ ' : ''}${w.name}</div>
      <div class="pause-weapon-level">Level ${w.level}${w.isEvolution ? '  [EVOLVED]' : ''} • Upgrades ${weaponUpgrades}/${MAX_WEAPON_UPGRADES}</div>
      <div class="pause-weapon-stats">${w.getStats()}</div>
      <div class="pause-weapon-stats">FIELD PWR ${perf.fieldPower} • E-DPS ${perf.effectiveDps.toFixed(1)} • SHARE ${perf.damageSharePct}%</div>
    `;
    pauseWeapons.appendChild(card);
  }

  // ── Powerup tracking ──────────────────────────────────────────────────────
  pausePowerups.innerHTML = '';
  const powerupDefs: { key: string; label: string; count: number }[] = [
    { key: 'atk_speed',    label: 'SYS OVERCLOCK',  count: player.atkSpeedUpgrades  },
    { key: 'damage_amp',   label: 'WEAPONS AMP',     count: player.damageUpgrades    },
    { key: 'shield_cap',   label: 'SHIELD CAP',      count: player.hpUpgrades        },
    { key: 'armor',        label: 'TI PLATING',      count: player.armorUpgrades     },
    { key: 'tractor_beam', label: 'TRACTOR BEAM',    count: player.pickupUpgrades    },
    { key: 'burn',         label: 'BURN CATALYST',   count: player.burnUpgrades      },
    { key: 'poison',       label: 'TOXIN CORE',      count: player.poisonUpgrades    },
  ];
  const activePowerups = powerupDefs.filter(p => p.count > 0);
  if (activePowerups.length > 0) {
    const heading = document.createElement('div');
    heading.className = 'pause-powerups-heading';
    heading.textContent = 'POWERUPS';
    pausePowerups.appendChild(heading);
    const grid = document.createElement('div');
    grid.className = 'pause-powerups-grid';
    for (const p of activePowerups) {
      const item = document.createElement('div');
      item.className = 'pause-powerup-item';
      const spriteCanvas = document.createElement('canvas');
      spriteCanvas.width  = 24;
      spriteCanvas.height = 24;
      spriteCanvas.className = 'pause-powerup-sprite';
      drawSpriteToCanvas(spriteCanvas, p.key);
      const nameEl = document.createElement('div');
      nameEl.className = 'pause-powerup-name';
      nameEl.textContent = p.label;
      const stackEl = document.createElement('div');
      stackEl.className = 'pause-powerup-stacks';
      stackEl.textContent = `${p.count}/${MAX_GENERIC_UPGRADES}`;
      item.appendChild(spriteCanvas);
      item.appendChild(nameEl);
      item.appendChild(stackEl);
      grid.appendChild(item);
    }
    pausePowerups.appendChild(grid);
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
  stageUnlockBannerTimer = Math.max(0, stageUnlockBannerTimer - dt);

  // Keep DoT chances in sync with player upgrades
  setDoTChances(player.burnChance, player.poisonChance);

  player.update(dt);
  camera.follow(player.x, player.y);

  const bossSpawned = spawner.update(dt, player);
  if (bossSpawned) {
    audio.bossSpawn();
  }

  for (const w of weapons) {
    w.activeTimeSeconds = (w.activeTimeSeconds ?? 0) + dt;
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
      bossesDefeated++;
      maybeUnlockNextStage();
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
  if (stageUnlockBannerTimer > 0) {
    ctx.save();
    ctx.fillStyle = '#ffd740';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '16px "Press Start 2P", monospace';
    ctx.shadowColor = '#ffd740';
    ctx.shadowBlur = 16;
    ctx.fillText(stageUnlockBanner, canvas.width / 2, 64);
    ctx.restore();
  }
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
