// ─── projectiles.ts ───────────────────────────────────────────────────────────
// A simple object-pool for fast-moving linear projectiles (used by the Laser
// weapon and other bolt-style shots).
//
// Why a pool?
// ────────────
// Projectiles are created and destroyed frequently.  Allocating new objects
// on every shot is fine in JavaScript (the GC handles it), but keeping them in
// a flat array and filtering out dead ones every frame is cheap and readable.
// A true pre-allocated pool would avoid GC churn, but at this scale the
// difference is negligible.
//
// Pierce mechanic
// ────────────────
// Each Projectile has a `pierce` counter (0 = no pierce, 1 = passes through
// 1 extra enemy, etc.).  A Set<Enemy> tracks which enemies have already been
// hit by this projectile so the same enemy cannot be damaged twice by the
// same bolt.  The pierce counter decrements on each new hit; when it goes
// below 0 the projectile dies.
// ──────────────────────────────────────────────────────────────────────────────

import { circlesOverlap } from './utils';
import type { Camera } from './camera';
import type { Enemy } from './enemies';

// ─── Projectile ───────────────────────────────────────────────────────────────
// A single in-flight projectile.  Private to this module — callers use
// ProjectilePool.spawn() and never instantiate Projectile directly.

class Projectile {
  /** False once the projectile goes off-screen or runs out of pierces. */
  alive: boolean = true;

  /**
   * Tracks enemies already struck by this projectile.
   * Prevents a bolt from repeatedly damaging the same target it's overlapping.
   */
  private hitEnemies: Set<Enemy> = new Set();

  constructor(
    public x: number,
    public y: number,
    private vx: number,  // horizontal velocity (px/s)
    private vy: number,  // vertical velocity (px/s)
    private damage: number,
    private radius: number,   // collision + visual radius
    private pierce: number,   // how many extra enemies the bolt can pass through
    private color: string,    // CSS color string used for glow + body
    /** Optional callback invoked every time this projectile hits an enemy. */
    private onHit?: (damage: number) => void,
  ) {}

  /**
   * Moves the projectile and culls it when it travels too far off-screen.
   * The cull distance is the larger canvas dimension so bolts live long enough
   * to hit enemies near the screen edge.
   */
  update(dt: number, canvas: HTMLCanvasElement, camera: Camera): void {
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // Cull when more than one canvas-length away from the camera centre
    const limit = Math.max(canvas.width, canvas.height);
    const dx = this.x - camera.x;
    const dy = this.y - camera.y;
    if (Math.abs(dx) > limit || Math.abs(dy) > limit) {
      this.alive = false;
    }
  }

  /**
   * Checks for hits against every alive enemy.  Already-hit enemies are
   * skipped to prevent double-damage.  Each new hit decrements `pierce`;
   * when pierce drops below 0 the projectile is destroyed.
   */
  checkEnemies(enemies: Enemy[]): void {
    if (!this.alive) return;
    for (const e of enemies) {
      if (!e.alive || this.hitEnemies.has(e)) continue;
      if (circlesOverlap(this.x, this.y, this.radius, e.x, e.y, e.radius)) {
        this.hitEnemies.add(e);
        e.takeDamage(this.damage);
        this.onHit?.(this.damage);
        this.pierce--;
        if (this.pierce < 0) {
          this.alive = false;
          return; // no need to check further
        }
      }
    }
  }

  /**
   * Draws the projectile as a glowing oriented capsule.
   * The bolt is rotated to face its velocity direction so it always looks like
   * it's flying forward, regardless of angle.
   */
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);
    const angle = Math.atan2(this.vy, this.vx);
    const len = Math.max(8, this.radius * 2.5); // elongated along travel axis
    const w = Math.max(2, this.radius * 0.6);

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(angle);

    // Outer glow rectangle
    ctx.fillStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 6;
    ctx.fillRect(-len / 2, -w / 2, len, w);

    // Bright white core (1 px shorter on each end to give a capsule look)
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-len / 2 + 1, -1, len - 2, 2);

    ctx.restore();
  }
}

// ─── ProjectilePool ────────────────────────────────────────────────────────────
// Manages the full collection of active projectiles.  Weapons call spawn() to
// fire a new bolt; the pool handles updating, collision testing, and drawing.

export class ProjectilePool {
  private projectiles: Projectile[] = [];

  /**
   * Creates and adds a new projectile to the pool.
   *
   * @param x,y       World-space spawn position (usually the player's centre).
   * @param vx,vy     Velocity in world pixels per second.
   * @param damage    Damage applied to each enemy hit.
   * @param radius    Collision/visual radius in pixels.
   * @param pierce    Extra enemies the bolt passes through (0 = hits 1 enemy).
   * @param color     CSS hex color for the glow and body.
   */
  spawn(
    x: number, y: number,
    vx: number, vy: number,
    damage: number,
    radius = 6,
    pierce = 0,
    color = '#ffee58',
    onHit?: (damage: number) => void,
  ): void {
    this.projectiles.push(new Projectile(x, y, vx, vy, damage, radius, pierce, color, onHit));
  }

  /**
   * Per-frame update: moves all projectiles, checks collisions, then removes
   * dead ones from the array (filter creates a new array, which is fine given
   * typical projectile counts of < 50).
   */
  update(dt: number, canvas: HTMLCanvasElement, camera: Camera, enemies: Enemy[]): void {
    for (const p of this.projectiles) {
      p.update(dt, canvas, camera);
      p.checkEnemies(enemies);
    }
    this.projectiles = this.projectiles.filter(p => p.alive);
  }

  /** Draws every live projectile. */
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    for (const p of this.projectiles) {
      p.draw(ctx, camera);
    }
  }
}
