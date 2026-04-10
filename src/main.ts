import { Camera } from './camera';
import { Player } from './player';
import { EnemySpawner } from './enemies';
import { ProjectilePool } from './projectiles';
import { GemManager } from './gems';
import { MagicBolt, Whip, createWeaponByName, type AnyWeapon, type Weapon } from './weapons';
import { LevelUpManager, type Upgrade, type ApplyUpgradeFn } from './levelup';
import { HUD } from './hud';

type GameState = 'playing' | 'levelup' | 'gameover';

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
    if (w) weapons.push(w);
  }
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

// ─── Update ───────────────────────────────────────────────────────────────────
function update(dt: number): void {
  if (state !== 'playing') return;

  elapsed += dt;

  player.update(dt);
  camera.follow(player.x, player.y);
  spawner.update(dt, player);

  for (const w of weapons) {
    if (w instanceof MagicBolt) {
      w.update(dt, player, spawner.enemies, pool);
    } else if (w instanceof Whip) {
      w.update(dt, player, spawner.enemies);
    }
  }

  pool.update(dt, canvas, camera, spawner.enemies);

  const dead = spawner.collectDead();
  for (const e of dead) {
    kills++;
    gems.spawnFromEnemy(e);
  }

  const xpGained = gems.update(dt, player);
  if (xpGained > 0) {
    levelMgr.addXp(xpGained, weapons, addWeapon, player);
  }

  if (!player.alive && state === 'playing') {
    state = 'gameover';
    showGameOver();
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render(): void {
  ctx.fillStyle = '#0d1a0d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  camera.drawGrid(ctx);

  gems.draw(ctx, camera);
  spawner.draw(ctx, camera);
  pool.draw(ctx, camera);
  player.draw(ctx, camera);

  for (const w of weapons) {
    if (w instanceof Whip) {
      w.draw(ctx, camera, player);
    }
  }

  hud.draw(ctx, canvas, player, levelMgr, elapsed, kills, weapons as Weapon[]);
}

// ─── Game Loop ────────────────────────────────────────────────────────────────
function loop(timestamp: number): void {
  if (lastTime === null) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  update(dt);
  render();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
