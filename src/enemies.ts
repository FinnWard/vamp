import { circlesOverlap, randomRange } from './utils';
import type { Camera } from './camera';
import type { Player } from './player';

type EnemyType = 'grunt' | 'fast' | 'tank';

interface EnemyStats {
  radius: number;
  speed: number;
  hp: number;
  damage: number;
  xpValue: number;
  color: string;
}

const ENEMY_TYPES: Record<EnemyType, EnemyStats> = {
  grunt: { radius: 16, speed: 70,  hp: 20, damage: 12, xpValue: 1, color: '#e53935' },
  fast:  { radius: 12, speed: 130, hp: 10, damage: 8,  xpValue: 1, color: '#ff7043' },
  tank:  { radius: 26, speed: 40,  hp: 80, damage: 20, xpValue: 3, color: '#7b1fa2' },
};

export class Enemy {
  x: number;
  y: number;
  readonly type: EnemyType;
  alive: boolean = true;
  readonly radius: number;
  readonly speed: number;
  readonly maxHp: number;
  hp: number;
  readonly damage: number;
  readonly xpValue: number;
  readonly color: string;

  constructor(x: number, y: number, type: EnemyType = 'grunt') {
    this.x = x;
    this.y = y;
    this.type = type;

    const stats = ENEMY_TYPES[type];
    this.radius = stats.radius;
    this.speed = stats.speed;
    this.maxHp = stats.hp;
    this.hp = stats.hp;
    this.damage = stats.damage;
    this.xpValue = stats.xpValue;
    this.color = stats.color;
  }

  takeDamage(amount: number): void {
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  update(dt: number, player: Player): void {
    if (!this.alive) return;

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 0) {
      this.x += (dx / dist) * this.speed * dt;
      this.y += (dy / dist) * this.speed * dt;
    }

    if (circlesOverlap(this.x, this.y, this.radius, player.x, player.y, player.radius)) {
      player.takeDamage(this.damage * dt);
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);

    ctx.save();
    ctx.translate(s.x, s.y);

    if (this.type === 'grunt') {
      this._drawGrunt(ctx);
    } else if (this.type === 'fast') {
      this._drawFast(ctx);
    } else {
      this._drawTank(ctx);
    }

    // HP bar
    const barW = this.radius * 2;
    const barH = 3;
    const bx = -this.radius;
    const by = -this.radius - 7;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = '#ff1744';
    ctx.fillRect(bx, by, Math.round(barW * (this.hp / this.maxHp)), barH);

    ctx.restore();
  }

  private _drawGrunt(ctx: CanvasRenderingContext2D): void {
    // Space invader style grunt
    // Antennae
    ctx.fillStyle = '#ef5350';
    ctx.fillRect(-7, -14, 3, 5);
    ctx.fillRect(4, -14, 3, 5);
    // Head / body
    ctx.fillStyle = '#e53935';
    ctx.fillRect(-8, -9, 16, 12);
    // Claws
    ctx.fillStyle = '#ef5350';
    ctx.fillRect(-12, -4, 5, 6);
    ctx.fillRect(7, -4, 5, 6);
    // Feet
    ctx.fillStyle = '#b71c1c';
    ctx.fillRect(-10, 3, 4, 4);
    ctx.fillRect(-2, 3, 4, 4);
    ctx.fillRect(6, 3, 4, 4);
    // Eyes (white)
    ctx.fillStyle = '#ffcdd2';
    ctx.fillRect(-6, -7, 4, 4);
    ctx.fillRect(2, -7, 4, 4);
    // Pupils (dark)
    ctx.fillStyle = '#4a0000';
    ctx.fillRect(-5, -6, 2, 2);
    ctx.fillRect(3, -6, 2, 2);
  }

  private _drawFast(ctx: CanvasRenderingContext2D): void {
    // Dart-shaped fast enemy
    ctx.fillStyle = '#ff7043';
    // Nose
    ctx.fillRect(-2, -11, 4, 4);
    ctx.fillStyle = '#ff5722';
    ctx.fillRect(-1, -14, 2, 4);
    // Body
    ctx.fillRect(-3, -7, 6, 14);
    // Side fins
    ctx.fillStyle = '#ff8a65';
    ctx.fillRect(-7, -3, 4, 7);
    ctx.fillRect(3, -3, 4, 7);
    // Engine
    ctx.fillStyle = '#bf360c';
    ctx.fillRect(-3, 7, 6, 3);
    // Eye slit
    ctx.fillStyle = '#ffccbc';
    ctx.fillRect(-2, -5, 4, 2);
  }

  private _drawTank(ctx: CanvasRenderingContext2D): void {
    // Large blocky alien boss
    ctx.fillStyle = '#6a1b9a';
    // Side armor plates
    ctx.fillRect(-14, -6, 5, 10);
    ctx.fillRect(9, -6, 5, 10);
    // Main body
    ctx.fillStyle = '#7b1fa2';
    ctx.fillRect(-9, -10, 18, 18);
    // Turret top
    ctx.fillStyle = '#8e24aa';
    ctx.fillRect(-6, -14, 12, 5);
    ctx.fillStyle = '#ab47bc';
    ctx.fillRect(-2, -17, 4, 4);
    // Center core
    ctx.fillStyle = '#e040fb';
    ctx.fillRect(-4, -4, 8, 8);
    // Core glow pixel
    ctx.fillStyle = '#f8bbd0';
    ctx.fillRect(-2, -2, 4, 4);
    // Eyes
    ctx.fillStyle = '#ce93d8';
    ctx.fillRect(-7, -6, 4, 3);
    ctx.fillRect(3, -6, 4, 3);
    ctx.fillStyle = '#4a148c';
    ctx.fillRect(-6, -5, 2, 1);
    ctx.fillRect(4, -5, 2, 1);
  }
}

export class EnemySpawner {
  enemies: Enemy[] = [];
  elapsed: number = 0;

  private timer: number = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
  ) {}

  private spawnInterval(): number {
    return Math.max(0.35, 1.5 - this.elapsed * 0.003);
  }

  private spawnCount(): number {
    return Math.floor(1 + this.elapsed / 30);
  }

  private pickType(): EnemyType {
    const roll = Math.random();
    if (this.elapsed > 90 && roll < 0.1) return 'tank';
    if (this.elapsed > 30 && roll < 0.25) return 'fast';
    return 'grunt';
  }

  private spawnPosition(player: Player): { x: number; y: number } {
    const margin = 80;
    const hw = this.canvas.width / 2 + margin;
    const hh = this.canvas.height / 2 + margin;
    const side = Math.floor(Math.random() * 4);
    let sx: number;
    let sy: number;
    if (side === 0)      { sx = randomRange(-hw, hw); sy = -hh; }
    else if (side === 1) { sx = randomRange(-hw, hw); sy = hh; }
    else if (side === 2) { sx = -hw; sy = randomRange(-hh, hh); }
    else                 { sx = hw;  sy = randomRange(-hh, hh); }
    return { x: player.x + sx, y: player.y + sy };
  }

  update(dt: number, player: Player): void {
    this.elapsed += dt;
    this.timer += dt;

    const interval = this.spawnInterval();
    while (this.timer >= interval) {
      this.timer -= interval;
      const count = this.spawnCount();
      for (let i = 0; i < count; i++) {
        const pos = this.spawnPosition(player);
        this.enemies.push(new Enemy(pos.x, pos.y, this.pickType()));
      }
    }

    for (const e of this.enemies) {
      e.update(dt, player);
    }
  }

  /** Returns enemies killed this frame and removes them from the active list. */
  collectDead(): Enemy[] {
    const dead = this.enemies.filter(e => !e.alive);
    this.enemies = this.enemies.filter(e => e.alive);
    return dead;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    for (const e of this.enemies) {
      e.draw(ctx, camera);
    }
  }
}
