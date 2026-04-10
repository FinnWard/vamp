import { circlesOverlap, randomRange } from './utils.js';

export class Gem {
  constructor(x, y, value = 1) {
    this.x = x;
    this.y = y;
    this.value = value;
    this.radius = 7 + value * 2;
    this.alive = true;
    this.pullRadius = 60;
    this.collectRadius = 30;
    // Slight bobbing animation
    this.age = randomRange(0, Math.PI * 2);
    this.color = value >= 3 ? '#ce93d8' : '#69f0ae';
  }

  update(dt, player) {
    this.age += dt * 2;

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Magnetic pull toward player
    if (dist < this.pullRadius && dist > 0) {
      const speed = 200;
      this.x += (dx / dist) * speed * dt;
      this.y += (dy / dist) * speed * dt;
    }

    // Collect
    if (dist < this.collectRadius) {
      this.alive = false;
    }
  }

  draw(ctx, camera) {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);
    const bob = Math.sin(this.age) * 2;

    ctx.save();
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 10;

    // Diamond shape
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - this.radius + bob);
    ctx.lineTo(s.x + this.radius * 0.7, s.y + bob);
    ctx.lineTo(s.x, s.y + this.radius * 0.7 + bob);
    ctx.lineTo(s.x - this.radius * 0.7, s.y + bob);
    ctx.closePath();
    ctx.fill();

    // Shine
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(s.x - 1, s.y - this.radius * 0.5 + bob);
    ctx.lineTo(s.x + this.radius * 0.3, s.y + bob * 0.5);
    ctx.lineTo(s.x, s.y + bob);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}

export class GemManager {
  constructor() {
    this.gems = [];
    this.pendingXp = 0;
  }

  spawnFromEnemy(enemy) {
    this.gems.push(new Gem(enemy.x, enemy.y, enemy.xpValue));
  }

  update(dt, player) {
    let xpGained = 0;
    for (const g of this.gems) {
      if (!g.alive) continue;
      g.update(dt, player);
      if (!g.alive) xpGained += g.value;
    }
    this.gems = this.gems.filter(g => g.alive);
    return xpGained;
  }

  draw(ctx, camera) {
    for (const g of this.gems) {
      g.draw(ctx, camera);
    }
  }
}
