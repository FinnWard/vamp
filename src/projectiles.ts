import { circlesOverlap } from './utils';
import type { Camera } from './camera';
import type { Enemy } from './enemies';

class Projectile {
  alive: boolean = true;
  private hitEnemies: Set<Enemy> = new Set();

  constructor(
    public x: number,
    public y: number,
    private vx: number,
    private vy: number,
    private damage: number,
    private radius: number,
    private pierce: number,
    private color: string,
  ) {}

  update(dt: number, canvas: HTMLCanvasElement, camera: Camera): void {
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    const limit = Math.max(canvas.width, canvas.height);
    const dx = this.x - camera.x;
    const dy = this.y - camera.y;
    if (Math.abs(dx) > limit || Math.abs(dy) > limit) {
      this.alive = false;
    }
  }

  checkEnemies(enemies: Enemy[]): void {
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

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);
    const angle = Math.atan2(this.vy, this.vx);
    const len = Math.max(8, this.radius * 2.5);
    const w = Math.max(2, this.radius * 0.6);

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(angle);
    // Outer glow
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 6;
    ctx.fillRect(-len / 2, -w / 2, len, w);
    // Bright core
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-len / 2 + 1, -1, len - 2, 2);
    ctx.restore();
  }
}

export class ProjectilePool {
  private projectiles: Projectile[] = [];

  spawn(
    x: number, y: number,
    vx: number, vy: number,
    damage: number,
    radius = 6,
    pierce = 0,
    color = '#ffee58',
  ): void {
    this.projectiles.push(new Projectile(x, y, vx, vy, damage, radius, pierce, color));
  }

  update(dt: number, canvas: HTMLCanvasElement, camera: Camera, enemies: Enemy[]): void {
    for (const p of this.projectiles) {
      p.update(dt, canvas, camera);
      p.checkEnemies(enemies);
    }
    this.projectiles = this.projectiles.filter(p => p.alive);
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    for (const p of this.projectiles) {
      p.draw(ctx, camera);
    }
  }
}
