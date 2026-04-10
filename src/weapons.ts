import { circlesOverlap } from './utils';
import type { Camera } from './camera';
import type { Player } from './player';
import type { Enemy } from './enemies';
import type { ProjectilePool } from './projectiles';

type BoltStat = 'damage' | 'rate' | 'pierce';
type WhipStat = 'damage' | 'rate' | 'range';

export interface Weapon {
  readonly name: string;
  level: number;
  getStats(): string;
  draw?(ctx: CanvasRenderingContext2D, camera: Camera, player: Player): void;
}

// ─── Weapon: Magic Bolt ───────────────────────────────────────────────────────
export class MagicBolt implements Weapon {
  readonly name = 'Magic Bolt';
  level = 1;
  cooldown = 0.8;
  damage = 15;
  speed = 380;
  projectileRadius = 6;
  pierce = 0;
  private readonly color = '#ffee58';
  private timer = 0;

  getStats(): string {
    return `DMG: ${this.damage}  Rate: ${(1 / this.cooldown).toFixed(1)}/s  Pierce: ${this.pierce}`;
  }

  upgrade(stat: BoltStat): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.15, this.cooldown * 0.75); this.level++; }
    else if (stat === 'pierce') { this.pierce++; this.level++; }
  }

  update(dt: number, player: Player, enemies: Enemy[], pool: ProjectilePool): void {
    this.timer += dt;
    if (this.timer < this.cooldown) return;
    this.timer = 0;

    let nearest: Enemy | null = null;
    let bestDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; nearest = e; }
    }

    if (!nearest) return;

    const dx = nearest.x - player.x;
    const dy = nearest.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    pool.spawn(player.x, player.y, (dx / dist) * this.speed, (dy / dist) * this.speed,
      this.damage, this.projectileRadius, this.pierce, this.color);
  }
}

// ─── Weapon: Whip ─────────────────────────────────────────────────────────────
export class Whip implements Weapon {
  readonly name = 'Whip';
  level = 1;
  cooldown = 1.2;
  damage = 30;
  range = 120;
  private readonly arcAngle = Math.PI * 0.8;
  private readonly swingDuration = 0.18;
  private readonly color = '#ef9a9a';
  private timer = 0;
  private swingTimer = 0;
  private swinging = false;
  private lastAngle = 0;

  getStats(): string {
    return `DMG: ${this.damage}  Range: ${this.range}  Rate: ${(1 / this.cooldown).toFixed(1)}/s`;
  }

  upgrade(stat: WhipStat): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.4, this.cooldown * 0.8); this.level++; }
    else if (stat === 'range') { this.range += 30; this.level++; }
  }

  update(dt: number, player: Player, enemies: Enemy[]): void {
    this.timer += dt;

    if (this.swinging) {
      this.swingTimer += dt;
      if (this.swingTimer >= this.swingDuration) {
        this.swinging = false;
        this.swingTimer = 0;
      }
      return;
    }

    if (this.timer < this.cooldown) return;
    this.timer = 0;
    this.swinging = true;
    this.swingTimer = 0;

    let angle = 0;
    let bestDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; angle = Math.atan2(dy, dx); }
    }

    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > this.range) continue;
      const eAngle = Math.atan2(dy, dx);
      let diff = Math.abs(eAngle - angle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < this.arcAngle / 2) e.takeDamage(this.damage);
    }

    this.lastAngle = angle;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, player: Player): void {
    if (!this.swinging) return;
    const s = camera.worldToScreen(player.x, player.y);
    const progress = this.swingTimer / this.swingDuration;

    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 1 - progress;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.range, this.lastAngle - this.arcAngle / 2, this.lastAngle + this.arcAngle / 2);
    ctx.stroke();
    ctx.restore();
  }
}

export type AnyWeapon = MagicBolt | Whip;

export function createWeaponByName(name: string): AnyWeapon | null {
  if (name === 'Magic Bolt') return new MagicBolt();
  if (name === 'Whip') return new Whip();
  return null;
}
