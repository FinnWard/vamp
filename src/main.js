import { Camera } from './camera.js';
import { Player } from './player.js';
import { EnemySpawner } from './enemies.js';
import { ProjectilePool } from './projectiles.js';
import { GemManager } from './gems.js';
import { MagicBolt, createWeaponByName } from './weapons.js';
import { LevelUpManager } from './levelup.js';
import { HUD } from './hud.js';

// ─── Canvas Setup ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ─── Game State ───────────────────────────────────────────────────────────────
let state = 'playing'; // 'playing' | 'levelup' | 'gameover'
let elapsed = 0;
let kills = 0;
let lastTime = null;
let pendingLevelUpChoices = null;
let pendingApplyFn = null;

// ─── Core Objects ─────────────────────────────────────────────────────────────
const camera   = new Camera(canvas);
const player   = new Player();
const spawner  = new EnemySpawner(canvas, camera);
const pool     = new ProjectilePool();
const gems     = new GemManager();
const hud      = new HUD();
const levelMgr = new LevelUpManager();

const weapons = [new MagicBolt()];

function addWeapon(name) {
  if (!weapons.some(w => w.name === name)) {
    weapons.push(createWeaponByName(name));
  }
}

// ─── Level-up callback ────────────────────────────────────────────────────────
levelMgr.onLevelUp = (choices, applyFn) => {
  state = 'levelup';
  pendingLevelUpChoices = choices;
  pendingApplyFn = applyFn;
  showLevelUpUI(choices, applyFn);
};

// ─── Level-up UI ──────────────────────────────────────────────────────────────
const levelUpOverlay = document.getElementById('levelUpOverlay');
const upgradeCards   = document.getElementById('upgradeCards');

function showLevelUpUI(choices, applyFn) {
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

function hideLevelUpUI() {
  levelUpOverlay.classList.add('hidden');
  state = 'playing';
  pendingLevelUpChoices = null;
  pendingApplyFn = null;
}

// ─── Game Over UI ─────────────────────────────────────────────────────────────
const gameOverOverlay = document.getElementById('gameOverOverlay');
const gameOverStats   = document.getElementById('gameOverStats');
const restartBtn      = document.getElementById('restartBtn');

function showGameOver() {
  const mins = Math.floor(elapsed / 60);
  const secs = Math.floor(elapsed % 60).toString().padStart(2, '0');
  gameOverStats.textContent = `Survived: ${mins}:${secs}  |  Kills: ${kills}  |  Level: ${levelMgr.level}`;
  gameOverOverlay.classList.remove('hidden');
}

restartBtn.addEventListener('click', () => {
  window.location.reload();
});

// ─── Update ───────────────────────────────────────────────────────────────────
function update(dt) {
  if (state !== 'playing') return;

  elapsed += dt;

  player.update(dt);
  camera.follow(player.x, player.y);
  spawner.update(dt, player);

  // Weapons fire
  for (const w of weapons) {
    if (w.name === 'Magic Bolt') {
      w.update(dt, player, spawner.enemies, pool);
    } else if (w.name === 'Whip') {
      w.update(dt, player, spawner.enemies);
    }
  }

  // Projectiles deal damage (no kill callback — collected below)
  pool.update(dt, canvas, camera, spawner.enemies);

  // Collect all enemies killed this frame (projectiles + whip), spawn gems, tally kills
  const dead = spawner.collectDead();
  for (const e of dead) {
    kills++;
    gems.spawnFromEnemy(e);
  }

  // Gems / XP
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
function render() {
  ctx.fillStyle = '#0d1a0d';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  camera.drawGrid(ctx);

  // All entities use camera.worldToScreen() internally — no canvas transform needed
  gems.draw(ctx, camera);
  spawner.draw(ctx, camera);
  pool.draw(ctx, camera);
  player.draw(ctx, camera);

  // Whip arc uses worldToScreen for player position
  for (const w of weapons) {
    if (w.name === 'Whip' && w.draw) {
      w.draw(ctx, camera, player);
    }
  }

  hud.draw(ctx, canvas, player, levelMgr, elapsed, kills, weapons);
}

// ─── Game Loop ────────────────────────────────────────────────────────────────
function loop(timestamp) {
  if (lastTime === null) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1); // cap at 100ms
  lastTime = timestamp;

  update(dt);
  render();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
