import { randomRange } from './utils';
import type { Camera } from './camera';
import type { Player } from './player';

const PULL_RADIUS = 60;
const PULL_RADIUS_SQ = PULL_RADIUS * PULL_RADIUS;
const COLLECT_RADIUS = 30;
const COLLECT_RADIUS_SQ = COLLECT_RADIUS * COLLECT_RADIUS;

/** Gem compaction kicks in above this count (runs every COMPACT_INTERVAL s). */
const COMPACT_THRESHOLD = 80;
const COMPACT_INTERVAL = 0.4;
/** Gems within this distance of each other can merge. */
const MERGE_DIST_SQ = 55 * 55;

function gemColor(value: number): string {
  if (value >= 25) return '#ffd740'; // gold
  if (value >= 10) return '#e040fb'; // bright magenta
  if (value >= 5)  return '#40c4ff'; // sky blue
  if (value >= 2)  return '#00e5ff'; // cyan
  return '#69ffdf';                  // teal-mint
}

function gemRadius(value: number): number {
  return Math.min(6 + Math.sqrt(value) * 3.5, 26);
}

export class Gem {
  alive = true;
  radius: number;
  color: string;
  private age: number;

  constructor(
    public x: number,
    public y: number,
    public value: number = 1,
  ) {
    this.radius = gemRadius(value);
    this.color = gemColor(value);
    this.age = randomRange(0, Math.PI * 2);
  }

  absorb(other: Gem): void {
    // Weighted-average position, then update appearance
    const total = this.value + other.value;
    this.x = (this.x * this.value + other.x * other.value) / total;
    this.y = (this.y * this.value + other.y * other.value) / total;
    this.value = total;
    this.radius = gemRadius(this.value);
    this.color = gemColor(this.value);
  }

  update(dt: number, player: Player): void {
    this.age += dt * 2;

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < COLLECT_RADIUS_SQ) {
      this.alive = false;
      return;
    }

    if (distSq < PULL_RADIUS_SQ) {
      const dist = Math.sqrt(distSq);
      const speed = 200;
      this.x += (dx / dist) * speed * dt;
      this.y += (dy / dist) * speed * dt;
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, cw: number, ch: number): void {
    const s = camera.worldToScreen(this.x, this.y);
    const r = this.radius;

    // Cull off-screen gems
    if (s.x < -r || s.x > cw + r || s.y < -r || s.y > ch + r) return;

    const bob = Math.sin(this.age) * 2;

    ctx.save();
    ctx.fillStyle = this.color;

    // Only pay shadowBlur cost for larger/valuable gems
    if (this.value >= 5) {
      ctx.shadowColor = this.color;
      ctx.shadowBlur = 12;
    }

    ctx.beginPath();
    ctx.moveTo(s.x,           s.y - r + bob);
    ctx.lineTo(s.x + r * 0.7, s.y + bob);
    ctx.lineTo(s.x,           s.y + r * 0.7 + bob);
    ctx.lineTo(s.x - r * 0.7, s.y + bob);
    ctx.closePath();
    ctx.fill();

    // Inner highlight — only for medium+ gems (skip for tiny ones)
    if (this.value >= 2) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.beginPath();
      ctx.moveTo(s.x - 1,       s.y - r * 0.5 + bob);
      ctx.lineTo(s.x + r * 0.3, s.y + bob * 0.5);
      ctx.lineTo(s.x,           s.y + bob);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }
}

export class GemManager {
  gems: Gem[] = [];
  private compactTimer = 0;

  spawnFromEnemy(enemy: { x: number; y: number; xpValue: number }): void {
    // Scatter offset so gems don't stack exactly on enemy
    const ox = randomRange(-12, 12);
    const oy = randomRange(-12, 12);
    this.gems.push(new Gem(enemy.x + ox, enemy.y + oy, enemy.xpValue));
  }

  /** Merge gems that are spatially close. O(n²) but runs infrequently. */
  private compact(): void {
    const gems = this.gems;
    for (let i = 0; i < gems.length; i++) {
      const a = gems[i]!;
      if (!a.alive) continue;
      for (let j = i + 1; j < gems.length; j++) {
        const b = gems[j]!;
        if (!b.alive) continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        if (dx * dx + dy * dy < MERGE_DIST_SQ) {
          a.absorb(b);
          b.alive = false;
        }
      }
    }
    this.gems = gems.filter(g => g.alive);
  }

  /** Updates all gems and returns total XP collected this frame. */
  update(dt: number, player: Player): number {
    this.compactTimer += dt;
    if (this.gems.length > COMPACT_THRESHOLD && this.compactTimer >= COMPACT_INTERVAL) {
      this.compactTimer = 0;
      this.compact();
    }

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
    const cw = ctx.canvas.width;
    const ch = ctx.canvas.height;
    for (const g of this.gems) {
      g.draw(ctx, camera, cw, ch);
    }
  }
}
