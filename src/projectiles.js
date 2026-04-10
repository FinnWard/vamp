import { circlesOverlap } from './utils.js';

export class Projectile {
  constructor(x, y, vx, vy, damage, radius, pierce, color) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.damage = damage;
    this.radius = radius;
    this.pierce = pierce; // how many enemies it can pass through
    this.color = color;
    this.alive = true;
    this.hitEnemies = new Set(); // avoid hitting same enemy twice
  }

  update(dt, canvas, camera) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Kill if far off screen (2x screen size from camera center)
    const limit = Math.max(canvas.width, canvas.height);
    const dx = this.x - camera.x;
    const dy = this.y - camera.y;
    if (Math.abs(dx) > limit || Math.abs(dy) > limit) {
      this.alive = false;
    }
  }

  checkEnemies(enemies) {
    if (!this.alive) return;
    for (const e of enemies) {
      if (!e.alive || this.hitEnemies.has(e)) continue;
      if (circlesOverlap(this.x, this.y, this.radius, e.x, e.y, e.radius)) {
        this.hitEnemies.add(e);
        e.takeDamage(this.damage);
        this.pierce--;
        if (this.pierce < 0) {
          this.alive = false;
          return;
        }
      }
    }
  }

  draw(ctx, camera) {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export class ProjectilePool {
  constructor() {
    this.projectiles = [];
  }

  spawn(x, y, vx, vy, damage, radius = 6, pierce = 0, color = '#ffee58') {
    this.projectiles.push(new Projectile(x, y, vx, vy, damage, radius, pierce, color));
  }

  update(dt, canvas, camera, enemies) {
    for (const p of this.projectiles) {
      p.update(dt, canvas, camera);
      p.checkEnemies(enemies);
    }
    this.projectiles = this.projectiles.filter(p => p.alive);
  }

  draw(ctx, camera) {
    for (const p of this.projectiles) {
      p.draw(ctx, camera);
    }
  }
}
