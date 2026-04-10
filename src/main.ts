import { Camera } from './camera';
import { Player } from './player';
import { EnemySpawner } from './enemies';
import { ProjectilePool } from './projectiles';
import { GemManager } from './gems';
import { MagicBolt, createWeaponByName, type AnyWeapon, type Weapon } from './weapons';
import { LevelUpManager, type Upgrade, type ApplyUpgradeFn } from './levelup';
import { HUD } from './hud';

type GameState = 'playing' | 'levelup' | 'gameover' | 'paused';

// ─── Canvas Setup ─────────────────────────────────────────────────────────────
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
let elapsed = 0;
let kills = 0;
let lastTime: number | null = null;

// ─── Core Objects ─────────────────────────────────────────────────────────────
const camera   = new Camera(canvas);
const player   = new Player();
const spawner  = new EnemySpawner(canvas, camera);
const pool     = new ProjectilePool();
const gems     = new GemManager();
const hud      = new HUD();
const levelMgr = new LevelUpManager();

const weapons: AnyWeapon[] = [new MagicBolt()];

function addWeapon(name: string): void {
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

// ─── Level-up callback ────────────────────────────────────────────────────────
levelMgr.onLevelUp = (choices: Upgrade[], applyFn: ApplyUpgradeFn) => {
  state = 'levelup';
  showLevelUpUI(choices, applyFn);
};

// ─── Level-up UI ──────────────────────────────────────────────────────────────
const levelUpOverlay = document.getElementById('levelUpOverlay')!;
const upgradeCards   = document.getElementById('upgradeCards')!;

function showLevelUpUI(choices: Upgrade[], applyFn: ApplyUpgradeFn): void {
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
  state = 'playing';
}

// ─── Game Over UI ─────────────────────────────────────────────────────────────
const gameOverOverlay = document.getElementById('gameOverOverlay')!;
const gameOverStats   = document.getElementById('gameOverStats')!;
const restartBtn      = document.getElementById('restartBtn')!;

function showGameOver(): void {
  const mins = Math.floor(elapsed / 60);
  const secs = Math.floor(elapsed % 60).toString().padStart(2, '0');
  gameOverStats.textContent = `Survived: ${mins}:${secs}  |  Kills: ${kills}  |  Level: ${levelMgr.level}`;
  gameOverOverlay.classList.remove('hidden');
}

restartBtn.addEventListener('click', () => {
  window.location.reload();
});

// ─── Pause UI ─────────────────────────────────────────────────────────────────
const pauseOverlay  = document.getElementById('pauseOverlay')!;
const pauseStats    = document.getElementById('pauseStats')!;
const pauseWeapons  = document.getElementById('pauseWeapons')!;
const resumeBtn     = document.getElementById('resumeBtn')!;

function showPause(): void {
  state = 'paused';
  lastTime = null; // reset dt so resuming doesn't jump

  const mins = Math.floor(elapsed / 60);
  const secs = Math.floor(elapsed % 60).toString().padStart(2, '0');
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
  state = 'playing';
}

resumeBtn.addEventListener('click', hidePause);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (state === 'playing') showPause();
    else if (state === 'paused') hidePause();
  }
});

// ─── Update ───────────────────────────────────────────────────────────────────
function update(dt: number): void {
  if (state !== 'playing') return;

  elapsed += dt;

  player.update(dt);
  camera.follow(player.x, player.y);
  spawner.update(dt, player);

  // Uniform weapon update — all weapons share the same signature
  for (const w of weapons) {
    w.update(dt, player, spawner.enemies, pool);
  }

  pool.update(dt, canvas, camera, spawner.enemies);

  const dead = spawner.collectDead();
  for (const e of dead) {
    kills++;
    gems.spawnFromEnemy(e);
  }

  const xpGained = gems.update(dt, player);
  if (xpGained > 0) {
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

  camera.drawStarField(ctx);

  gems.draw(ctx, camera);
  spawner.draw(ctx, camera);
  pool.draw(ctx, camera);
  player.draw(ctx, camera);

  // Draw all weapons that have a draw method
  for (const w of weapons) {
    w.draw?.(ctx, camera, player);
  }

  hud.draw(ctx, canvas, player, levelMgr, elapsed, kills, weapons as Weapon[]);
}

// ─── Game Loop ────────────────────────────────────────────────────────────────
function loop(timestamp: number): void {
  if (lastTime === null) lastTime = timestamp;
  const dt = state === 'paused' ? 0 : Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = state === 'paused' ? null : timestamp;

  update(dt);
  render();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
