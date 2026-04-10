import { randomRange } from './utils';
import type { Camera } from './camera';
import type { Player } from './player';

export class Gem {
  alive: boolean = true;
  readonly radius: number;
  readonly color: string;

  private age: number;
  private readonly pullRadius = 60;
  private readonly collectRadius = 30;

  constructor(
    public x: number,
    public y: number,
    readonly value: number = 1,
  ) {
    this.radius = 7 + value * 2;
    this.color = value >= 3 ? '#ce93d8' : '#69f0ae';
    this.age = randomRange(0, Math.PI * 2);
  }

  update(dt: number, player: Player): void {
    this.age += dt * 2;

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < this.pullRadius && dist > 0) {
      const speed = 200;
      this.x += (dx / dist) * speed * dt;
      this.y += (dy / dist) * speed * dt;
    }

    if (dist < this.collectRadius) {
      this.alive = false;
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);
    const bob = Math.sin(this.age) * 2;

    ctx.save();
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 10;

    ctx.beginPath();
    ctx.moveTo(s.x, s.y - this.radius + bob);
    ctx.lineTo(s.x + this.radius * 0.7, s.y + bob);
    ctx.lineTo(s.x, s.y + this.radius * 0.7 + bob);
    ctx.lineTo(s.x - this.radius * 0.7, s.y + bob);
    ctx.closePath();
    ctx.fill();

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
  gems: Gem[] = [];

  spawnFromEnemy(enemy: { x: number; y: number; xpValue: number }): void {
    this.gems.push(new Gem(enemy.x, enemy.y, enemy.xpValue));
  }

  /** Updates all gems and returns total XP collected this frame. */
  update(dt: number, player: Player): number {
    let xpGained = 0;
    for (const g of this.gems) {
      if (!g.alive) continue;
      g.update(dt, player);
      if (!g.alive) xpGained += g.value;
    }
    this.gems = this.gems.filter(g => g.alive);
    return xpGained;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    for (const g of this.gems) {
      g.draw(ctx, camera);
    }
  }
}
