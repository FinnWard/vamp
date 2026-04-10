import { circlesOverlap, randomRange } from './utils.js';

export class Enemy {
  constructor(x, y, type = 'grunt') {
    this.x = x;
    this.y = y;
    this.type = type;
    this.alive = true;

    const stats = ENEMY_TYPES[type];
    this.radius = stats.radius;
    this.speed = stats.speed;
    this.maxHp = stats.hp;
    this.hp = stats.hp;
    this.damage = stats.damage; // damage per second on contact
    this.xpValue = stats.xpValue;
    this.color = stats.color;
  }

  takeDamage(amount) {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  update(dt, player) {
    if (!this.alive) return;

    // Move toward player
    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      this.x += (dx / dist) * this.speed * dt;
      this.y += (dy / dist) * this.speed * dt;
    }

    // Damage player on overlap
    if (circlesOverlap(this.x, this.y, this.radius, player.x, player.y, player.radius)) {
      player.takeDamage(this.damage * dt);
    }
  }

  draw(ctx, camera) {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);

    ctx.save();

    // Body
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s.x - 5, s.y - 4, 4, 0, Math.PI * 2);
    ctx.arc(s.x + 5, s.y - 4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(s.x - 4, s.y - 4, 2, 0, Math.PI * 2);
    ctx.arc(s.x + 6, s.y - 4, 2, 0, Math.PI * 2);
    ctx.fill();

    // HP bar
    const barW = this.radius * 2;
    const barH = 4;
    const bx = s.x - this.radius;
    const by = s.y - this.radius - 8;
    ctx.fillStyle = '#333';
    ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = '#e53935';
    ctx.fillRect(bx, by, barW * (this.hp / this.maxHp), barH);

    ctx.restore();
  }
}

const ENEMY_TYPES = {
  grunt: { radius: 16, speed: 70, hp: 20, damage: 12, xpValue: 1, color: '#e53935' },
  fast:  { radius: 12, speed: 130, hp: 10, damage: 8,  xpValue: 1, color: '#ff7043' },
  tank:  { radius: 26, speed: 40,  hp: 80, damage: 20, xpValue: 3, color: '#7b1fa2' },
};

export class EnemySpawner {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.timer = 0;
    this.elapsed = 0; // total game time for scaling
    this.enemies = [];
  }

  _spawnInterval() {
    // Starts at 1.5s, ramps down to 0.35s over 5 minutes
    return Math.max(0.35, 1.5 - this.elapsed * 0.003);
  }

  _spawnCount() {
    return Math.floor(1 + this.elapsed / 30);
  }

  _pickType() {
    const roll = Math.random();
    if (this.elapsed > 90 && roll < 0.1) return 'tank';
    if (this.elapsed > 30 && roll < 0.25) return 'fast';
    return 'grunt';
  }

  _spawnPosition(player) {
    // Spawn just outside the visible screen
    const margin = 80;
    const hw = this.canvas.width / 2 + margin;
    const hh = this.canvas.height / 2 + margin;
    const side = Math.floor(Math.random() * 4);
    let sx, sy;
    if (side === 0) { sx = randomRange(-hw, hw); sy = -hh; }
    else if (side === 1) { sx = randomRange(-hw, hw); sy = hh; }
    else if (side === 2) { sx = -hw; sy = randomRange(-hh, hh); }
    else { sx = hw; sy = randomRange(-hh, hh); }
    return { x: player.x + sx, y: player.y + sy };
  }

  update(dt, player) {
    this.elapsed += dt;
    this.timer += dt;

    const interval = this._spawnInterval();
    while (this.timer >= interval) {
      this.timer -= interval;
      const count = this._spawnCount();
      for (let i = 0; i < count; i++) {
        const pos = this._spawnPosition(player);
        this.enemies.push(new Enemy(pos.x, pos.y, this._pickType()));
      }
    }

    for (const e of this.enemies) {
      e.update(dt, player);
    }
  }

  // Call after all weapons/projectiles have run.
  // Returns newly dead enemies, then removes them from the active list.
  collectDead() {
    const dead = this.enemies.filter(e => !e.alive);
    this.enemies = this.enemies.filter(e => e.alive);
    return dead;
  }

  draw(ctx, camera) {
    for (const e of this.enemies) {
      e.draw(ctx, camera);
    }
  }
}
