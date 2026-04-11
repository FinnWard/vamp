// ─── damage-numbers.ts ────────────────────────────────────────────────────────
// Floating damage numbers that appear at the world position where an enemy
// takes damage.  Numbers drift upward and fade out over their lifetime.
//
// Usage
// ──────
// 1. Call spawn(x, y, damage) when an enemy takes damage.
// 2. Call update(dt) every frame.
// 3. Call draw(ctx, camera) after world objects but before the HUD.
// ──────────────────────────────────────────────────────────────────────────────

import type { Camera } from './camera';

interface DamageNumber {
  x: number;        // world-space X (slightly randomised on spawn)
  y: number;        // world-space Y (drifts upward each frame)
  value: number;
  color: string;
  age: number;      // seconds since spawn
  duration: number; // total lifetime in seconds
  critical: boolean;
}

const DURATION    = 0.85;  // seconds before fully faded
const FLOAT_SPEED = 48;    // world px / s upward drift

export class DamageNumberPool {
  private pool: DamageNumber[] = [];

  /**
   * Spawns a floating damage number at a world-space position.
   *
   * @param x        World X (enemy centre)
   * @param y        World Y (enemy centre)
   * @param damage   Raw damage value to display
   * @param color    CSS color string (default white)
   * @param critical Show a star prefix and use gold color
   */
  spawn(x: number, y: number, damage: number, color = '#ffffff', critical = false): void {
    this.pool.push({
      x: x + (Math.random() - 0.5) * 24,
      y,
      value: Math.round(damage),
      color: critical ? '#ffd740' : color,
      age: 0,
      duration: DURATION,
      critical,
    });
  }

  /** Advances all damage numbers by dt seconds and removes expired ones. */
  update(dt: number): void {
    for (const n of this.pool) {
      n.age += dt;
      n.y -= FLOAT_SPEED * dt;
    }
    this.pool = this.pool.filter(n => n.age < n.duration);
  }

  /** Draws all active damage numbers in screen space. */
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (this.pool.length === 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    for (const n of this.pool) {
      const t = n.age / n.duration;
      ctx.globalAlpha = Math.max(0, 1 - t * t);
      const size = n.critical
        ? Math.round(13 - t * 4)
        : Math.round(9 - t * 2);
      ctx.font = `${Math.max(6, size)}px "Press Start 2P", monospace`;
      ctx.fillStyle = n.color;
      const s = camera.worldToScreen(n.x, n.y);
      ctx.fillText(n.critical ? `★${n.value}` : String(n.value), s.x, s.y);
    }
    ctx.restore();
  }
}
