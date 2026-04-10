import { circlesOverlap } from './utils';
import type { Camera } from './camera';
import type { Player } from './player';
import type { Enemy } from './enemies';
import type { ProjectilePool } from './projectiles';

// ─── Shared interface ─────────────────────────────────────────────────────────

export interface Weapon {
  readonly name: string;
  readonly isEvolution: boolean;
  level: number;
  getStats(): string;
  update(dt: number, player: Player, enemies: Enemy[], pool: ProjectilePool): void;
  draw?(ctx: CanvasRenderingContext2D, camera: Camera, player: Player): void;
}

// ─── Visual: explosion ring effect ───────────────────────────────────────────

class ExplosionEffect {
  private age = 0;
  done = false;
  constructor(
    readonly x: number, readonly y: number,
    readonly maxRadius: number,
    private readonly duration: number,
    private readonly color: string,
  ) {}
  update(dt: number): void {
    this.age += dt;
    if (this.age >= this.duration) this.done = true;
  }
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (this.done) return;
    const t = this.age / this.duration;
    const s = camera.worldToScreen(this.x, this.y);
    ctx.save();
    ctx.strokeStyle = this.color; ctx.shadowColor = this.color; ctx.shadowBlur = 12;
    ctx.lineWidth = 3 * (1 - t); ctx.globalAlpha = 1 - t;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.maxRadius * t, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

// ─── Visual: lightning flash ──────────────────────────────────────────────────

interface LightningSegment { x1: number; y1: number; x2: number; y2: number }

class LightningFlash {
  private age = 0; done = false;
  private readonly duration = 0.12;
  constructor(readonly segments: LightningSegment[]) {}
  update(dt: number): void { this.age += dt; if (this.age >= this.duration) this.done = true; }
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (this.done) return;
    const t = this.age / this.duration;
    ctx.save();
    ctx.strokeStyle = '#ffe082'; ctx.shadowColor = '#ffe082'; ctx.shadowBlur = 14;
    ctx.lineWidth = 2.5; ctx.globalAlpha = 1 - t; ctx.setLineDash([4, 3]);
    for (const seg of this.segments) {
      const a = camera.worldToScreen(seg.x1, seg.y1);
      const b = camera.worldToScreen(seg.x2, seg.y2);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }
}

// ─── Weapon: Magic Bolt ───────────────────────────────────────────────────────
export class MagicBolt implements Weapon {
  readonly name = 'Magic Bolt';
  readonly isEvolution = false;
  level = 1;
  cooldown = 0.8;
  damage = 15;
  speed = 380;
  projectileRadius = 6;
  pierce = 0;
  private readonly color = '#ffee58';
  private timer = 0;

  getStats(): string {
    return `DMG:${this.damage} Rate:${(1 / this.cooldown).toFixed(1)}/s Pierce:${this.pierce}`;
  }

  upgrade(stat: 'damage' | 'rate' | 'pierce'): void {
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
  readonly isEvolution = false;
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
  lastAngle = 0;

  getStats(): string {
    return `DMG:${this.damage} Range:${this.range} Rate:${(1 / this.cooldown).toFixed(1)}/s`;
  }

  upgrade(stat: 'damage' | 'rate' | 'range'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.4, this.cooldown * 0.8); this.level++; }
    else if (stat === 'range') { this.range += 30; this.level++; }
  }

  update(dt: number, player: Player, enemies: Enemy[], _pool: ProjectilePool): void {
    this.timer += dt;
    if (this.swinging) {
      this.swingTimer += dt;
      if (this.swingTimer >= this.swingDuration) { this.swinging = false; this.swingTimer = 0; }
      return;
    }
    if (this.timer < this.cooldown) return;
    this.timer = 0; this.swinging = true; this.swingTimer = 0;

    let angle = 0, bestDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = (e.x - player.x) ** 2 + (e.y - player.y) ** 2;
      if (d < bestDist) { bestDist = d; angle = Math.atan2(e.y - player.y, e.x - player.x); }
    }
    this.doSwingDamage(player, enemies, angle);
    this.lastAngle = angle;
  }

  doSwingDamage(player: Player, enemies: Enemy[], angle: number): void {
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - player.x, dy = e.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > this.range) continue;
      let diff = Math.abs(Math.atan2(dy, dx) - angle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < this.arcAngle / 2) e.takeDamage(this.damage);
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, player: Player): void {
    if (!this.swinging) return;
    const s = camera.worldToScreen(player.x, player.y);
    const progress = this.swingTimer / this.swingDuration;
    ctx.save();
    ctx.strokeStyle = this.color; ctx.shadowColor = this.color; ctx.shadowBlur = 12;
    ctx.lineWidth = 4; ctx.globalAlpha = 1 - progress;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.range, this.lastAngle - this.arcAngle / 2, this.lastAngle + this.arcAngle / 2);
    ctx.stroke(); ctx.restore();
  }
}

// ─── FireOrb helper (shared by Fireball + Inferno) ────────────────────────────

class FireOrb {
  alive = true;
  private hitEnemies = new Set<Enemy>();

  constructor(
    public x: number, public y: number,
    private vx: number, private vy: number,
    readonly damage: number, readonly radius: number,
    readonly explosionRadius: number, readonly explosionDamage: number,
    private effects: ExplosionEffect[],
  ) {}

  update(dt: number, enemies: Enemy[], camX: number, camY: number, limit: number): void {
    this.x += this.vx * dt; this.y += this.vy * dt;
    if (Math.abs(this.x - camX) > limit || Math.abs(this.y - camY) > limit) { this.alive = false; return; }
    for (const e of enemies) {
      if (!e.alive || this.hitEnemies.has(e)) continue;
      if (circlesOverlap(this.x, this.y, this.radius, e.x, e.y, e.radius)) { this.explode(enemies); return; }
    }
  }

  explode(enemies: Enemy[]): void {
    this.alive = false;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - this.x, dy = e.y - this.y;
      if (Math.sqrt(dx * dx + dy * dy) < this.explosionRadius + e.radius) e.takeDamage(this.explosionDamage);
    }
    this.effects.push(new ExplosionEffect(this.x, this.y, this.explosionRadius, 0.5, '#ff6f00'));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);
    ctx.save();
    ctx.fillStyle = '#ff6f00'; ctx.shadowColor = '#ff9800'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffcc02';
    ctx.beginPath(); ctx.arc(s.x - 5, s.y - 5, this.radius * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// ─── Weapon: Fireball ─────────────────────────────────────────────────────────

export class Fireball implements Weapon {
  readonly name = 'Fireball'; readonly isEvolution = false; level = 1;
  cooldown = 2.0; damage = 25; speed = 110;
  readonly orbRadius = 18; explosionRadius = 90;
  private timer = 0; private orbs: FireOrb[] = []; private effects: ExplosionEffect[] = [];
  private cameraRef: Camera | null = null;

  getStats(): string { return `DMG:${this.damage} Blast:${this.explosionRadius}px Rate:${(1 / this.cooldown).toFixed(1)}/s`; }

  upgrade(stat: 'damage' | 'rate' | 'radius'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.35); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.8, this.cooldown * 0.75); this.level++; }
    else if (stat === 'radius') { this.explosionRadius += 30; this.level++; }
  }

  update(dt: number, player: Player, enemies: Enemy[], _pool: ProjectilePool): void {
    this.timer += dt;
    const camX = this.cameraRef ? this.cameraRef.x : 0;
    const camY = this.cameraRef ? this.cameraRef.y : 0;
    for (const orb of this.orbs) orb.update(dt, enemies, camX, camY, 1400);
    for (const fx of this.effects) fx.update(dt);
    this.orbs = this.orbs.filter(o => o.alive);
    this.effects = this.effects.filter(fx => !fx.done);
    if (this.timer < this.cooldown) return;
    this.timer = 0;
    let nearest: Enemy | null = null, bestDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = (e.x - player.x) ** 2 + (e.y - player.y) ** 2;
      if (d < bestDist) { bestDist = d; nearest = e; }
    }
    if (!nearest) return;
    const dx = nearest.x - player.x, dy = nearest.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    this.orbs.push(new FireOrb(player.x, player.y, (dx / dist) * this.speed, (dy / dist) * this.speed,
      this.damage, this.orbRadius, this.explosionRadius, this.damage * 2, this.effects));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, _player: Player): void {
    this.cameraRef = camera;
    for (const orb of this.orbs) orb.draw(ctx, camera);
    for (const fx of this.effects) fx.draw(ctx, camera);
  }
}

// ─── Weapon: Lightning ────────────────────────────────────────────────────────

export class Lightning implements Weapon {
  readonly name = 'Lightning'; readonly isEvolution = false; level = 1;
  cooldown = 0.45; damage = 22; chains = 3;
  private timer = 0; private flashes: LightningFlash[] = [];

  getStats(): string { return `DMG:${this.damage} Chains:${this.chains} Rate:${(1 / this.cooldown).toFixed(1)}/s`; }

  upgrade(stat: 'damage' | 'chains' | 'rate'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'chains') { this.chains++; this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.15, this.cooldown * 0.8); this.level++; }
  }

  update(dt: number, player: Player, enemies: Enemy[], _pool: ProjectilePool): void {
    this.timer += dt;
    for (const f of this.flashes) f.update(dt);
    this.flashes = this.flashes.filter(f => !f.done);
    if (this.timer < this.cooldown) return;
    this.timer = 0;
    const alive = enemies.filter(e => e.alive);
    if (!alive.length) return;
    const sorted = [...alive].sort((a, b) =>
      ((a.x - player.x) ** 2 + (a.y - player.y) ** 2) - ((b.x - player.x) ** 2 + (b.y - player.y) ** 2));
    const targets = sorted.slice(0, this.chains);
    const segs: LightningSegment[] = [];
    let prevX = player.x, prevY = player.y;
    for (const t of targets) {
      t.takeDamage(this.damage);
      segs.push({ x1: prevX, y1: prevY, x2: t.x, y2: t.y });
      prevX = t.x; prevY = t.y;
    }
    if (segs.length) this.flashes.push(new LightningFlash(segs));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, _player: Player): void {
    for (const f of this.flashes) f.draw(ctx, camera);
  }
}

// ─── Weapon: Aura ─────────────────────────────────────────────────────────────

export class Aura implements Weapon {
  readonly name = 'Aura'; readonly isEvolution = false; level = 1;
  cooldown = 1.5; damage = 20; range = 80;
  private timer = 0; private pulseEffects: ExplosionEffect[] = [];

  getStats(): string { return `DMG:${this.damage} Range:${this.range} Rate:${(1 / this.cooldown).toFixed(1)}/s`; }

  upgrade(stat: 'damage' | 'range' | 'rate'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'range') { this.range += 25; this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.4, this.cooldown * 0.75); this.level++; }
  }

  update(dt: number, player: Player, enemies: Enemy[], _pool: ProjectilePool): void {
    this.timer += dt;
    for (const fx of this.pulseEffects) fx.update(dt);
    this.pulseEffects = this.pulseEffects.filter(fx => !fx.done);
    if (this.timer < this.cooldown) return;
    this.timer = 0;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - player.x, dy = e.y - player.y;
      if (Math.sqrt(dx * dx + dy * dy) < this.range + e.radius) e.takeDamage(this.damage);
    }
    this.pulseEffects.push(new ExplosionEffect(player.x, player.y, this.range, 0.45, '#ce93d8'));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, player: Player): void {
    const s = camera.worldToScreen(player.x, player.y);
    ctx.save();
    ctx.strokeStyle = '#ce93d8'; ctx.globalAlpha = 0.18; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.range, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    for (const fx of this.pulseEffects) fx.draw(ctx, camera);
  }
}

// ─── Evolution: Thunder Strike (MagicBolt lv3 + Whip lv2) ────────────────────

export class ThunderStrike implements Weapon {
  readonly name = 'Thunder Strike'; readonly isEvolution = true; level = 1;
  private cooldown = 0.5; private damage = 55; private speed = 420;
  private range = 160; private arcAngle = Math.PI * 0.9;
  private readonly color = '#ffe082';
  private timer = 0; private lastAngle = 0;
  private swingTimer = 0; private swinging = false; private readonly swingDuration = 0.2;
  private flashes: LightningFlash[] = [];

  getStats(): string { return `DMG:${this.damage} ARC+BOLT Rate:${(1 / this.cooldown).toFixed(1)}/s`; }

  update(dt: number, player: Player, enemies: Enemy[], pool: ProjectilePool): void {
    this.timer += dt;
    for (const f of this.flashes) f.update(dt);
    this.flashes = this.flashes.filter(f => !f.done);
    if (this.swinging) {
      this.swingTimer += dt;
      if (this.swingTimer >= this.swingDuration) { this.swinging = false; this.swingTimer = 0; }
    }
    if (this.timer < this.cooldown) return;
    this.timer = 0;
    let nearest: Enemy | null = null, bestDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = (e.x - player.x) ** 2 + (e.y - player.y) ** 2;
      if (d < bestDist) { bestDist = d; nearest = e; }
    }
    let angle = 0;
    if (nearest) {
      const dx = nearest.x - player.x, dy = nearest.y - player.y;
      angle = Math.atan2(dy, dx);
      const dist = Math.sqrt(dx * dx + dy * dy);
      pool.spawn(player.x, player.y, (dx / dist) * this.speed, (dy / dist) * this.speed, this.damage, 10, 3, this.color);
    }
    const segs: LightningSegment[] = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - player.x, dy = e.y - player.y;
      if (Math.sqrt(dx * dx + dy * dy) > this.range) continue;
      let diff = Math.abs(Math.atan2(dy, dx) - angle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < this.arcAngle / 2) {
        e.takeDamage(this.damage * 0.8);
        segs.push({ x1: player.x, y1: player.y, x2: e.x, y2: e.y });
      }
    }
    if (segs.length) this.flashes.push(new LightningFlash(segs));
    this.lastAngle = angle; this.swinging = true; this.swingTimer = 0;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, player: Player): void {
    for (const f of this.flashes) f.draw(ctx, camera);
    if (this.swinging) {
      const s = camera.worldToScreen(player.x, player.y);
      const progress = this.swingTimer / this.swingDuration;
      ctx.save();
      ctx.strokeStyle = this.color; ctx.shadowColor = this.color; ctx.shadowBlur = 16;
      ctx.lineWidth = 5; ctx.globalAlpha = (1 - progress) * 0.9;
      ctx.beginPath();
      ctx.arc(s.x, s.y, this.range, this.lastAngle - this.arcAngle / 2, this.lastAngle + this.arcAngle / 2);
      ctx.stroke(); ctx.restore();
    }
  }
}

// ─── VoidOrbProjectile helper ─────────────────────────────────────────────────

class VoidOrbProjectile {
  alive = true;
  private age = 0; private readonly maxAge = 5.0;
  private hitEnemies = new Set<Enemy>();

  constructor(
    public x: number, public y: number, private vx: number, private vy: number,
    private damage: number, readonly radius: number, private effects: ExplosionEffect[],
  ) {}

  update(dt: number, enemies: Enemy[]): void {
    this.age += dt; this.x += this.vx * dt; this.y += this.vy * dt;
    for (const e of enemies) {
      if (!e.alive || this.hitEnemies.has(e)) continue;
      if (circlesOverlap(this.x, this.y, this.radius, e.x, e.y, e.radius)) {
        this.hitEnemies.add(e); e.takeDamage(this.damage);
      }
    }
    if (this.age >= this.maxAge) this.explode(enemies);
  }

  explode(enemies: Enemy[]): void {
    const blastR = 180; this.alive = false;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - this.x, dy = e.y - this.y;
      if (Math.sqrt(dx * dx + dy * dy) < blastR + e.radius) e.takeDamage(this.damage * 3);
    }
    this.effects.push(new ExplosionEffect(this.x, this.y, blastR, 0.7, '#b39ddb'));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);
    const pulse = 1 + Math.sin(this.age * 6) * 0.12;
    ctx.save();
    ctx.fillStyle = '#4a148c'; ctx.shadowColor = '#b39ddb'; ctx.shadowBlur = 22; ctx.globalAlpha = 0.92;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.radius * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ce93d8'; ctx.lineWidth = 2; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.radius * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

// ─── Evolution: Void Orb (MagicBolt lv3 + Fireball lv2) ──────────────────────

export class VoidOrb implements Weapon {
  readonly name = 'Void Orb'; readonly isEvolution = true; level = 1;
  private cooldown = 3.5; private damage = 80; private speed = 75;
  private timer = 0; private orbs: VoidOrbProjectile[] = []; private effects: ExplosionEffect[] = [];

  getStats(): string { return `DMG:${this.damage} AoE:x3 Rate:${(1 / this.cooldown).toFixed(1)}/s`; }

  update(dt: number, player: Player, enemies: Enemy[], _pool: ProjectilePool): void {
    this.timer += dt;
    for (const orb of this.orbs) orb.update(dt, enemies);
    for (const fx of this.effects) fx.update(dt);
    this.orbs = this.orbs.filter(o => o.alive);
    this.effects = this.effects.filter(fx => !fx.done);
    if (this.timer < this.cooldown) return;
    this.timer = 0;
    let nearest: Enemy | null = null, bestDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = (e.x - player.x) ** 2 + (e.y - player.y) ** 2;
      if (d < bestDist) { bestDist = d; nearest = e; }
    }
    if (!nearest) return;
    const dx = nearest.x - player.x, dy = nearest.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    this.orbs.push(new VoidOrbProjectile(player.x, player.y, (dx / dist) * this.speed, (dy / dist) * this.speed,
      this.damage, 28, this.effects));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, _player: Player): void {
    for (const orb of this.orbs) orb.draw(ctx, camera);
    for (const fx of this.effects) fx.draw(ctx, camera);
  }
}

// ─── Evolution: Inferno (Aura lv2 + Fireball lv3) ─────────────────────────────

export class Inferno implements Weapon {
  readonly name = 'Inferno'; readonly isEvolution = true; level = 1;
  private auraCooldown = 0.9; private orbCooldown = 2.2;
  private damage = 40; private auraRange = 130;
  private auraTimer = 0; private orbTimer = 0;
  private orbs: FireOrb[] = []; private effects: ExplosionEffect[] = [];
  private cameraRef: Camera | null = null;

  getStats(): string { return `DMG:${this.damage} Range:${this.auraRange} 6-way orbs`; }

  update(dt: number, player: Player, enemies: Enemy[], _pool: ProjectilePool): void {
    this.auraTimer += dt; this.orbTimer += dt;
    const camX = this.cameraRef ? this.cameraRef.x : 0;
    const camY = this.cameraRef ? this.cameraRef.y : 0;
    for (const orb of this.orbs) orb.update(dt, enemies, camX, camY, 1800);
    for (const fx of this.effects) fx.update(dt);
    this.orbs = this.orbs.filter(o => o.alive);
    this.effects = this.effects.filter(fx => !fx.done);
    if (this.auraTimer >= this.auraCooldown) {
      this.auraTimer = 0;
      for (const e of enemies) {
        if (!e.alive) continue;
        const dx = e.x - player.x, dy = e.y - player.y;
        if (Math.sqrt(dx * dx + dy * dy) < this.auraRange + e.radius) e.takeDamage(this.damage);
      }
      this.effects.push(new ExplosionEffect(player.x, player.y, this.auraRange, 0.35, '#ff6f00'));
    }
    if (this.orbTimer >= this.orbCooldown) {
      this.orbTimer = 0;
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        this.orbs.push(new FireOrb(player.x, player.y, Math.cos(angle) * 130, Math.sin(angle) * 130,
          this.damage, 14, 70, this.damage * 1.5, this.effects));
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, player: Player): void {
    this.cameraRef = camera;
    const s = camera.worldToScreen(player.x, player.y);
    ctx.save(); ctx.strokeStyle = '#ff6f00'; ctx.globalAlpha = 0.2; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.auraRange, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    for (const orb of this.orbs) orb.draw(ctx, camera);
    for (const fx of this.effects) fx.draw(ctx, camera);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export type AnyWeapon = Weapon;

export function createWeaponByName(name: string): AnyWeapon | null {
  switch (name) {
    case 'Magic Bolt':     return new MagicBolt();
    case 'Whip':           return new Whip();
    case 'Fireball':       return new Fireball();
    case 'Lightning':      return new Lightning();
    case 'Aura':           return new Aura();
    case 'Thunder Strike': return new ThunderStrike();
    case 'Void Orb':       return new VoidOrb();
    case 'Inferno':        return new Inferno();
    default:               return null;
  }
}
