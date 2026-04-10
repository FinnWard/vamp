import { circlesOverlap } from './utils.js';

// ─── Weapon: Magic Bolt ───────────────────────────────────────────────────────
export class MagicBolt {
  constructor() {
    this.name = 'Magic Bolt';
    this.level = 1;
    this.cooldown = 0.8; // seconds between shots
    this.timer = 0;
    this.damage = 15;
    this.speed = 380;
    this.projectileRadius = 6;
    this.pierce = 0;
    this.color = '#ffee58';
  }

  getStats() {
    return `DMG: ${this.damage}  Rate: ${(1 / this.cooldown).toFixed(1)}/s  Pierce: ${this.pierce}`;
  }

  upgrade(stat) {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.15, this.cooldown * 0.75); this.level++; }
    else if (stat === 'pierce') { this.pierce++; this.level++; }
  }

  update(dt, player, enemies, pool) {
    this.timer += dt;
    if (this.timer < this.cooldown) return;
    this.timer = 0;

    // Find nearest enemy
    let nearest = null;
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
    const vx = (dx / dist) * this.speed;
    const vy = (dy / dist) * this.speed;

    pool.spawn(player.x, player.y, vx, vy, this.damage, this.projectileRadius, this.pierce, this.color);
  }
}

// ─── Weapon: Whip ─────────────────────────────────────────────────────────────
export class Whip {
  constructor() {
    this.name = 'Whip';
    this.level = 1;
    this.cooldown = 1.2;
    this.timer = 0;
    this.damage = 30;
    this.range = 120;
    this.arcAngle = Math.PI * 0.8; // sweep arc in radians
    this.swingTimer = 0;
    this.swingDuration = 0.18;
    this.swinging = false;
    this.swingDir = 1; // alternates left/right
    this.color = '#ef9a9a';
  }

  getStats() {
    return `DMG: ${this.damage}  Range: ${this.range}  Rate: ${(1 / this.cooldown).toFixed(1)}/s`;
  }

  upgrade(stat) {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.4, this.cooldown * 0.8); this.level++; }
    else if (stat === 'range') { this.range += 30; this.level++; }
  }

  update(dt, player, enemies) {
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
    this.swingDir *= -1;

    // Determine base angle from nearest enemy or last movement direction
    let angle = 0;
    let bestDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; angle = Math.atan2(dy, dx); }
    }

    // Hit all enemies in the arc
    const hitSet = new Set();
    for (const e of enemies) {
      if (!e.alive || hitSet.has(e)) continue;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > this.range) continue;
      const eAngle = Math.atan2(dy, dx);
      let diff = Math.abs(eAngle - angle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < this.arcAngle / 2) {
        hitSet.add(e);
        e.takeDamage(this.damage);
      }
    }

    this.lastAngle = angle;
    this.hitEnemiesThisSwing = hitSet;
  }

  draw(ctx, camera, player) {
    if (!this.swinging) return;
    const s = camera.worldToScreen(player.x, player.y);
    const progress = this.swingTimer / this.swingDuration;
    const angle = this.lastAngle ?? 0;

    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 12;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 1 - progress;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.range, angle - this.arcAngle / 2, angle + this.arcAngle / 2);
    ctx.stroke();
    ctx.restore();
  }
}

export function createWeaponByName(name) {
  if (name === 'Magic Bolt') return new MagicBolt();
  if (name === 'Whip') return new Whip();
  return null;
}
