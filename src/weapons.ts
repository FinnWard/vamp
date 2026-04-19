// ─── weapons.ts ───────────────────────────────────────────────────────────────
// All weapon classes and their supporting helper classes/effects.
//
// Architecture
// ─────────────
// Every weapon implements the `Weapon` interface, which requires:
//   • name / isEvolution / level  — identity
//   • getStats()                  — short stat string shown in the pause screen
//   • update(dt, player, enemies, pool) — per-frame logic; fire if cooldown reached
//   • draw?(ctx, camera, player)  — optional per-frame visual (arc/beam/orb)
//   • scaleStats(speedMult, damageMult) — apply global multipliers
//
// Weapons are stored in main.ts's `weapons` array and updated/drawn each frame
// by simple for-loops; no type-specific dispatch is needed because the interface
// is uniform.
//
// Base weapons (9)
// ─────────────────
//   Laser (MagicBolt)        — fast single-target bolt, pierce upgrades
//   Plasma Whip (Whip)       — melee arc sweep, facing nearest enemy
//   Plasma Bomb (Fireball)   — slow homing orb that explodes
//   Ion Chain (Lightning)    — chain-zap hitting multiple nearest enemies
//   Force Field (Aura)       — pulsing damage ring around the player
//   Missile Barrage          — homing explosive missiles, salvo of N
//   Pulse Cannon             — N-directional simultaneous burst fire
//   Cryo Beam                — continuous ray to nearest enemy, slows them
//   Gravity Well             — pull field that collapses into a detonation
//
// Evolution weapons (9) — unlocked by merging two base weapons at required levels
// ──────────────────────────────────────────────────────────────────────────────
//   Beam Lash      = Laser lv3 + Plasma Whip lv2  → arc + piercing bolt
//   Dark Matter    = Laser lv3 + Plasma Bomb lv2  → slow singularity + big explosion
//   Nova Burst     = Force Field lv2 + Plasma Bomb lv3 → field + 6-way orbs
//   Solar Flare    = Laser lv2 + Pulse Cannon lv2 → 8-way piercing solar bolts
//   Quantum Torpedo= Missile Barrage lv2 + Plasma Bomb lv2 → giant homing bomb
//   Glacial Storm  = Cryo Beam lv2 + Force Field lv2 → freeze field + cryo pulses
//   Arc Nova       = Ion Chain lv2 + Pulse Cannon lv2 → burst fire + chain lightning
//   Event Horizon  = Ion Chain lv3 + Gravity Well lv2 → pull field + arc surges
//   Frost Barrage  = Missile Barrage lv2 + Cryo Beam lv2 → homing frost missiles
//
// Visual helpers (private to this module)
// ─────────────────────────────────────────
//   ExplosionEffect   — expanding ring that fades out
//   LightningFlash    — short-lived dashed line segments between entities
//   FireOrb           — shared homing orb used by Plasma Bomb and Nova Burst
//   VoidOrbProjectile — long-lived orb used by Dark Matter
//   HomingMissile     — steered missile used by Missile Barrage and Quantum Torpedo
// ──────────────────────────────────────────────────────────────────────────────

import { circlesOverlap } from './utils';
import type { Camera } from './camera';
import type { Player } from './player';
import type { Enemy } from './enemies';
import type { ProjectilePool } from './projectiles';

// ─── Shared interface ─────────────────────────────────────────────────────────

/**
 * Every weapon in the game implements this interface.
 * main.ts stores all active weapons as `AnyWeapon[]` (alias for Weapon[]) and
 * calls update/draw without knowing the concrete type.
 */
export interface Weapon {
  readonly name: string;
  readonly isEvolution: boolean;
  level: number;
  /** Returns a short stat summary shown in the pause screen weapon card. */
  getStats(): string;
  /** Per-frame logic — fires projectiles, applies AoE, etc. */
  update(dt: number, player: Player, enemies: Enemy[], pool: ProjectilePool): void;
  /** Optional per-frame draw (visual effects that aren't projectiles). */
  draw?(ctx: CanvasRenderingContext2D, camera: Camera, player: Player): void;
  /** Scale cooldown by speedMult and damage by damageMult (for global powerups). */
  scaleStats(speedMult: number, damageMult: number): void;
  /** Cumulative damage dealt this run (tracked per weapon for post-run stats). */
  totalDamageDealt?: number;
}

// ─── Visual: explosion ring effect ───────────────────────────────────────────
// A single expanding ring used to visualise weapon explosions and aura pulses.
// The ring fades out over `duration` seconds as it expands to `maxRadius`.

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
    const t = this.age / this.duration; // 0 → 1 over the lifetime
    const s = camera.worldToScreen(this.x, this.y);
    ctx.save();
    ctx.strokeStyle = this.color; ctx.shadowColor = this.color; ctx.shadowBlur = 12;
    ctx.lineWidth = 3 * (1 - t); ctx.globalAlpha = 1 - t;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.maxRadius * t, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

// ─── Visual: lightning flash ──────────────────────────────────────────────────
// Short-lived dashed line segments drawn between connected entities (player →
// enemy chain for Ion Chain, player → targets for Beam Lash).

interface LightningSegment { x1: number; y1: number; x2: number; y2: number }

class LightningFlash {
  private age = 0; done = false;
  private readonly duration = 0.12; // very brief: 120 ms
  constructor(readonly segments: LightningSegment[]) {}
  update(dt: number): void { this.age += dt; if (this.age >= this.duration) this.done = true; }
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (this.done) return;
    const t = this.age / this.duration;
    ctx.save();
    ctx.strokeStyle = '#00e5ff'; ctx.shadowColor = '#00e5ff'; ctx.shadowBlur = 14;
    ctx.lineWidth = 2.5; ctx.globalAlpha = 1 - t; ctx.setLineDash([4, 3]);
    for (const seg of this.segments) {
      const a = camera.worldToScreen(seg.x1, seg.y1);
      const b = camera.worldToScreen(seg.x2, seg.y2);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }
}

// ─── Weapon: Laser ───────────────────────────────────────────────────────────
// Fires a fast piercing bolt at the nearest enemy.  The starting weapon —
// every new game begins with a level-1 Laser already equipped.
export class MagicBolt implements Weapon {
  readonly name = 'Laser';
  readonly isEvolution = false;
  level = 1;
  cooldown = 0.8;
  damage = 30;
  speed = 380;
  projectileRadius = 6;
  pierce = 0;
  totalDamageDealt = 0;
  private readonly color = '#00e5ff';
  private timer = 0;

  getStats(): string {
    return `DMG:${this.damage} Rate:${(1 / this.cooldown).toFixed(1)}/s Pierce:${this.pierce}`;
  }

  upgrade(stat: 'damage' | 'rate' | 'pierce'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.15, this.cooldown * 0.75); this.level++; }
    else if (stat === 'pierce') { this.pierce++; this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult;
    this.damage = Math.round(this.damage * damageMult);
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
      this.damage, this.projectileRadius, this.pierce, this.color,
      (dmg) => { this.totalDamageDealt += dmg; });
  }
}

// ─── Weapon: Plasma Whip ─────────────────────────────────────────────────────
export class Whip implements Weapon {
  readonly name = 'Plasma Whip';
  readonly isEvolution = false;
  level = 1;
  cooldown = 1.2;
  damage = 30;
  range = 120;
  totalDamageDealt = 0;
  private readonly arcAngle = Math.PI * 0.8;
  private readonly swingDuration = 0.18;
  private readonly color = '#40c4ff';
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

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult;
    this.damage = Math.round(this.damage * damageMult);
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
      if (diff < this.arcAngle / 2) { e.takeDamage(this.damage); this.totalDamageDealt += this.damage; }
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
    this.effects.push(new ExplosionEffect(this.x, this.y, this.explosionRadius, 0.5, '#00b0ff'));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);
    ctx.save();
    ctx.fillStyle = '#0091ea'; ctx.shadowColor = '#40c4ff'; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#80d8ff';
    ctx.beginPath(); ctx.arc(s.x - 5, s.y - 5, this.radius * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// ─── Weapon: Plasma Bomb ─────────────────────────────────────────────────────

export class Fireball implements Weapon {
  readonly name = 'Plasma Bomb'; readonly isEvolution = false; level = 1;
  cooldown = 2.0; damage = 25; speed = 110;
  readonly orbRadius = 18; explosionRadius = 90;
  totalDamageDealt = 0;
  private timer = 0; private orbs: FireOrb[] = []; private effects: ExplosionEffect[] = [];
  private cameraRef: Camera | null = null;

  getStats(): string { return `DMG:${this.damage} Blast:${this.explosionRadius}px Rate:${(1 / this.cooldown).toFixed(1)}/s`; }

  upgrade(stat: 'damage' | 'rate' | 'radius'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.35); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.8, this.cooldown * 0.75); this.level++; }
    else if (stat === 'radius') { this.explosionRadius += 30; this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult;
    this.damage = Math.round(this.damage * damageMult);
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

// ─── Weapon: Ion Chain ────────────────────────────────────────────────────────

export class Lightning implements Weapon {
  readonly name = 'Ion Chain'; readonly isEvolution = false; level = 1;
  cooldown = 0.45; damage = 22; chains = 3;
  totalDamageDealt = 0;
  private timer = 0; private flashes: LightningFlash[] = [];

  getStats(): string { return `DMG:${this.damage} Chains:${this.chains} Rate:${(1 / this.cooldown).toFixed(1)}/s`; }

  upgrade(stat: 'damage' | 'chains' | 'rate'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'chains') { this.chains++; this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.15, this.cooldown * 0.8); this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult;
    this.damage = Math.round(this.damage * damageMult);
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
      this.totalDamageDealt += this.damage;
      segs.push({ x1: prevX, y1: prevY, x2: t.x, y2: t.y });
      prevX = t.x; prevY = t.y;
    }
    if (segs.length) this.flashes.push(new LightningFlash(segs));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, _player: Player): void {
    for (const f of this.flashes) f.draw(ctx, camera);
  }
}

// ─── Weapon: Force Field ─────────────────────────────────────────────────────

export class Aura implements Weapon {
  readonly name = 'Force Field'; readonly isEvolution = false; level = 1;
  cooldown = 1.5; damage = 20; range = 80;
  totalDamageDealt = 0;
  private timer = 0; private pulseEffects: ExplosionEffect[] = [];

  getStats(): string { return `DMG:${this.damage} Range:${this.range} Rate:${(1 / this.cooldown).toFixed(1)}/s`; }

  upgrade(stat: 'damage' | 'range' | 'rate'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'range') { this.range += 25; this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.4, this.cooldown * 0.75); this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult;
    this.damage = Math.round(this.damage * damageMult);
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
      if (Math.sqrt(dx * dx + dy * dy) < this.range + e.radius) {
        e.takeDamage(this.damage);
        this.totalDamageDealt += this.damage;
      }
    }
    this.pulseEffects.push(new ExplosionEffect(player.x, player.y, this.range, 0.45, '#40c4ff'));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, player: Player): void {
    const s = camera.worldToScreen(player.x, player.y);
    ctx.save();
    ctx.strokeStyle = '#40c4ff'; ctx.globalAlpha = 0.18; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.range, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    for (const fx of this.pulseEffects) fx.draw(ctx, camera);
  }
}

// ─── Evolution: Beam Lash (Laser lv3 + Plasma Whip lv2) ──────────────────────

export class ThunderStrike implements Weapon {
  readonly name = 'Beam Lash'; readonly isEvolution = true; level = 1;
  private cooldown = 0.5; private damage = 55; private speed = 420;
  private range = 160; private arcAngle = Math.PI * 0.9;
  private readonly color = '#69ffdf';
  private timer = 0; private lastAngle = 0;
  private swingTimer = 0; private swinging = false; private readonly swingDuration = 0.2;
  private flashes: LightningFlash[] = [];

  getStats(): string { return `DMG:${this.damage} ARC+BOLT Rate:${(1 / this.cooldown).toFixed(1)}/s`; }

  upgrade(stat: 'damage' | 'rate'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.25, this.cooldown * 0.8); this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult;
    this.damage = Math.round(this.damage * damageMult);
  }

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
    this.effects.push(new ExplosionEffect(this.x, this.y, blastR, 0.7, '#e040fb'));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);
    const pulse = 1 + Math.sin(this.age * 6) * 0.12;
    ctx.save();
    ctx.fillStyle = '#1a0033'; ctx.shadowColor = '#e040fb'; ctx.shadowBlur = 22; ctx.globalAlpha = 0.92;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.radius * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ea80fc'; ctx.lineWidth = 2; ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.radius * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

// ─── Evolution: Dark Matter (Laser lv3 + Plasma Bomb lv2) ────────────────────

export class VoidOrb implements Weapon {
  readonly name = 'Dark Matter'; readonly isEvolution = true; level = 1;
  private cooldown = 3.5; private damage = 80; private speed = 75;
  private timer = 0; private orbs: VoidOrbProjectile[] = []; private effects: ExplosionEffect[] = [];

  getStats(): string { return `DMG:${this.damage} AoE:x3 Rate:${(1 / this.cooldown).toFixed(1)}/s`; }

  upgrade(stat: 'damage' | 'rate'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(1.5, this.cooldown * 0.8); this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult;
    this.damage = Math.round(this.damage * damageMult);
  }

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

// ─── Evolution: Nova Burst (Force Field lv2 + Plasma Bomb lv3) ────────────────

export class Inferno implements Weapon {
  readonly name = 'Nova Burst'; readonly isEvolution = true; level = 1;
  private auraCooldown = 0.9; private orbCooldown = 2.2;
  private damage = 40; private auraRange = 130;
  private auraTimer = 0; private orbTimer = 0;
  private orbs: FireOrb[] = []; private effects: ExplosionEffect[] = [];
  private cameraRef: Camera | null = null;

  getStats(): string { return `DMG:${this.damage} Range:${this.auraRange} 6-way orbs`; }

  upgrade(stat: 'damage' | 'range'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'range') { this.auraRange += 25; this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.auraCooldown *= speedMult;
    this.orbCooldown *= speedMult;
    this.damage = Math.round(this.damage * damageMult);
  }

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
      this.effects.push(new ExplosionEffect(player.x, player.y, this.auraRange, 0.35, '#00b0ff'));
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
    ctx.save(); ctx.strokeStyle = '#0091ea'; ctx.globalAlpha = 0.2; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.auraRange, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    for (const orb of this.orbs) orb.draw(ctx, camera);
    for (const fx of this.effects) fx.draw(ctx, camera);
  }
}

// ─── Weapon: Missile Barrage ──────────────────────────────────────────────────

class HomingMissile {
  alive = true;
  private age = 0;
  private readonly maxAge = 3.5;
  private hitEnemies = new Set<Enemy>();

  constructor(
    public x: number, public y: number,
    private vx: number, private vy: number,
    private damage: number,
    readonly radius: number,
    private explosionRadius: number,
    private effects: ExplosionEffect[],
  ) {}

  update(dt: number, enemies: Enemy[], camX: number, camY: number): void {
    this.age += dt;
    if (this.age >= this.maxAge || Math.abs(this.x - camX) > 1600 || Math.abs(this.y - camY) > 1600) {
      this.alive = false; return;
    }
    // Home toward nearest alive enemy
    let nearest: Enemy | null = null; let bestDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = (e.x - this.x) ** 2 + (e.y - this.y) ** 2;
      if (d < bestDist) { bestDist = d; nearest = e; }
    }
    if (nearest) {
      const dx = nearest.x - this.x, dy = nearest.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const tx = (dx / dist) * 280, ty = (dy / dist) * 280;
      const turnRate = 4.5;
      this.vx += (tx - this.vx) * turnRate * dt;
      this.vy += (ty - this.vy) * turnRate * dt;
      const spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      if (spd > 280) { this.vx = (this.vx / spd) * 280; this.vy = (this.vy / spd) * 280; }
    }
    this.x += this.vx * dt; this.y += this.vy * dt;
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
      if (Math.sqrt(dx * dx + dy * dy) < this.explosionRadius + e.radius) e.takeDamage(this.damage);
    }
    this.effects.push(new ExplosionEffect(this.x, this.y, this.explosionRadius, 0.45, '#ff6d00'));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);
    const angle = Math.atan2(this.vy, this.vx);
    ctx.save();
    ctx.translate(s.x, s.y); ctx.rotate(angle);
    ctx.fillStyle = '#ff6d00'; ctx.shadowColor = '#ffab40'; ctx.shadowBlur = 10;
    ctx.fillRect(-10, -3, 16, 6);
    ctx.fillStyle = '#ffab40';
    ctx.fillRect(-14, -2, 6, 4);
    ctx.fillStyle = 'rgba(255,109,0,0.4)';
    ctx.fillRect(-22, -3, 10, 6);
    ctx.restore();
  }
}

export class MissileBarrage implements Weapon {
  readonly name = 'Missile Barrage'; readonly isEvolution = false; level = 1;
  cooldown = 1.8; damage = 70; count = 1; explosionRadius = 70;
  totalDamageDealt = 0;
  private timer = 0; private missiles: HomingMissile[] = []; private effects: ExplosionEffect[] = [];
  private cameraRef: Camera | null = null;

  getStats(): string { return `DMG:${this.damage} Blast:${this.explosionRadius}px x${this.count}`; }

  upgrade(stat: 'damage' | 'rate' | 'count'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.6, this.cooldown * 0.78); this.level++; }
    else if (stat === 'count') { this.count++; this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult; this.damage = Math.round(this.damage * damageMult);
  }

  update(dt: number, player: Player, enemies: Enemy[], _pool: ProjectilePool): void {
    this.timer += dt;
    const camX = this.cameraRef?.x ?? 0, camY = this.cameraRef?.y ?? 0;
    for (const m of this.missiles) m.update(dt, enemies, camX, camY);
    for (const fx of this.effects) fx.update(dt);
    this.missiles = this.missiles.filter(m => m.alive);
    this.effects = this.effects.filter(fx => !fx.done);
    if (this.timer < this.cooldown) return;
    this.timer = 0;
    const alive = enemies.filter(e => e.alive);
    if (!alive.length) return;
    for (let i = 0; i < this.count; i++) {
      const spread = (i - (this.count - 1) / 2) * 0.35;
      const base = Math.atan2(alive[0]!.y - player.y, alive[0]!.x - player.x) + spread;
      this.missiles.push(new HomingMissile(
        player.x + Math.cos(base) * 20, player.y + Math.sin(base) * 20,
        Math.cos(base) * 200, Math.sin(base) * 200,
        this.damage, 8, this.explosionRadius, this.effects,
      ));
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, _player: Player): void {
    this.cameraRef = camera;
    for (const m of this.missiles) m.draw(ctx, camera);
    for (const fx of this.effects) fx.draw(ctx, camera);
  }
}

// ─── Weapon: Pulse Cannon ─────────────────────────────────────────────────────

export class PulseCannon implements Weapon {
  readonly name = 'Pulse Cannon'; readonly isEvolution = false; level = 1;
  cooldown = 1.6; damage = 36; directions = 4;
  totalDamageDealt = 0;
  private timer = 0;
  private readonly color = '#ffd740';

  getStats(): string { return `DMG:${this.damage} ${this.directions}-way Rate:${(1 / this.cooldown).toFixed(1)}/s`; }

  upgrade(stat: 'damage' | 'rate' | 'directions'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.5, this.cooldown * 0.8); this.level++; }
    else if (stat === 'directions') { this.directions = Math.min(8, this.directions + 2); this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult; this.damage = Math.round(this.damage * damageMult);
  }

  update(dt: number, player: Player, _enemies: Enemy[], pool: ProjectilePool): void {
    this.timer += dt;
    if (this.timer < this.cooldown) return;
    this.timer = 0;
    for (let i = 0; i < this.directions; i++) {
      const angle = (i / this.directions) * Math.PI * 2;
      pool.spawn(player.x, player.y, Math.cos(angle) * 340, Math.sin(angle) * 340,
        this.damage, 7, 0, this.color,
        (dmg) => { this.totalDamageDealt += dmg; });
    }
  }
}

// ─── Weapon: Cryo Beam ────────────────────────────────────────────────────────

export class CryoBeam implements Weapon {
  readonly name = 'Cryo Beam'; readonly isEvolution = false; level = 1;
  cooldown = 0.25; damage = 8; range = 220; slowFactor = 0.5;
  totalDamageDealt = 0;
  private timer = 0;
  private beamTarget: { x: number; y: number } | null = null;
  private beamAge = 0;

  getStats(): string { return `DPS:${Math.round(this.damage / this.cooldown)} Range:${this.range} Slows`; }

  upgrade(stat: 'damage' | 'range' | 'rate'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'range') { this.range += 40; this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.08, this.cooldown * 0.8); this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult; this.damage = Math.round(this.damage * damageMult);
  }

  update(dt: number, player: Player, enemies: Enemy[], _pool: ProjectilePool): void {
    this.timer += dt;
    this.beamAge += dt;
    let nearest: Enemy | null = null; let bestDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = (e.x - player.x) ** 2 + (e.y - player.y) ** 2;
      if (d < bestDist) { bestDist = d; nearest = e; }
    }
    if (nearest && Math.sqrt(bestDist) < this.range) {
      this.beamTarget = { x: nearest.x, y: nearest.y };
      if (this.timer >= this.cooldown) {
        this.timer = 0;
        nearest.takeDamage(this.damage);
        this.totalDamageDealt += this.damage;
        nearest.slowMultiplier = Math.min(nearest.slowMultiplier, this.slowFactor);
      }
    } else {
      this.beamTarget = null;
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, player: Player): void {
    if (!this.beamTarget) return;
    const a = camera.worldToScreen(player.x, player.y);
    const b = camera.worldToScreen(this.beamTarget.x, this.beamTarget.y);
    const flicker = 0.7 + Math.sin(this.beamAge * 30) * 0.3;
    ctx.save();
    ctx.strokeStyle = '#80d8ff'; ctx.shadowColor = '#80d8ff'; ctx.shadowBlur = 18;
    ctx.lineWidth = 3 * flicker; ctx.globalAlpha = 0.85 * flicker;
    ctx.setLineDash([8, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#e1f5fe'; ctx.globalAlpha = flicker;
    ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

// ─── Evolution: Solar Flare (Laser lv2 + Pulse Cannon lv2) ───────────────────

export class SolarFlare implements Weapon {
  readonly name = 'Solar Flare'; readonly isEvolution = true; level = 1;
  private cooldown = 0.9; private damage = 40; private speed = 420; private directions = 8;
  private timer = 0;
  private readonly color = '#ffea00';

  getStats(): string { return `DMG:${this.damage} ${this.directions}-way pierce Rate:${(1 / this.cooldown).toFixed(1)}/s`; }

  upgrade(stat: 'damage' | 'rate'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.4, this.cooldown * 0.8); this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult; this.damage = Math.round(this.damage * damageMult);
  }

  update(dt: number, player: Player, _enemies: Enemy[], pool: ProjectilePool): void {
    this.timer += dt;
    if (this.timer < this.cooldown) return;
    this.timer = 0;
    for (let i = 0; i < this.directions; i++) {
      const angle = (i / this.directions) * Math.PI * 2;
      pool.spawn(player.x, player.y, Math.cos(angle) * this.speed, Math.sin(angle) * this.speed,
        this.damage, 9, 4, this.color);
    }
  }
}

// ─── Evolution: Quantum Torpedo (Missile Barrage lv2 + Plasma Bomb lv2) ──────

export class QuantumTorpedo implements Weapon {
  readonly name = 'Quantum Torpedo'; readonly isEvolution = true; level = 1;
  private cooldown = 2.5; private damage = 100; private explosionRadius = 160;
  private timer = 0; private missiles: HomingMissile[] = []; private effects: ExplosionEffect[] = [];
  private cameraRef: Camera | null = null;

  getStats(): string { return `DMG:${this.damage} Blast:${this.explosionRadius}px homing`; }

  upgrade(stat: 'damage' | 'rate'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(1.0, this.cooldown * 0.8); this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult; this.damage = Math.round(this.damage * damageMult);
  }

  update(dt: number, player: Player, enemies: Enemy[], _pool: ProjectilePool): void {
    this.timer += dt;
    const camX = this.cameraRef?.x ?? 0, camY = this.cameraRef?.y ?? 0;
    for (const m of this.missiles) m.update(dt, enemies, camX, camY);
    for (const fx of this.effects) fx.update(dt);
    this.missiles = this.missiles.filter(m => m.alive);
    this.effects = this.effects.filter(fx => !fx.done);
    if (this.timer < this.cooldown) return;
    this.timer = 0;
    const alive = enemies.filter(e => e.alive);
    if (!alive.length) return;
    const target = alive[0]!;
    const angle = Math.atan2(target.y - player.y, target.x - player.x);
    this.missiles.push(new HomingMissile(
      player.x, player.y, Math.cos(angle) * 160, Math.sin(angle) * 160,
      this.damage, 18, this.explosionRadius, this.effects,
    ));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, _player: Player): void {
    this.cameraRef = camera;
    for (const m of this.missiles) m.draw(ctx, camera);
    for (const fx of this.effects) fx.draw(ctx, camera);
  }
}

// ─── Evolution: Glacial Storm (Cryo Beam lv2 + Force Field lv2) ──────────────

export class GlacialStorm implements Weapon {
  readonly name = 'Glacial Storm'; readonly isEvolution = true; level = 1;
  private pulseCooldown = 1.0; private tickCooldown = 0.2;
  private damage = 50; private range = 200; private slowFactor = 0.35;
  private pulseTimer = 0; private tickTimer = 0;
  private pulseEffects: ExplosionEffect[] = [];

  getStats(): string { return `DMG:${this.damage} Range:${this.range} Freeze pulse`; }

  upgrade(stat: 'damage' | 'range'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'range') { this.range += 30; this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.pulseCooldown *= speedMult; this.tickCooldown *= speedMult;
    this.damage = Math.round(this.damage * damageMult);
  }

  update(dt: number, player: Player, enemies: Enemy[], _pool: ProjectilePool): void {
    this.pulseTimer += dt; this.tickTimer += dt;
    for (const fx of this.pulseEffects) fx.update(dt);
    this.pulseEffects = this.pulseEffects.filter(fx => !fx.done);

    // Continuous slow tick
    if (this.tickTimer >= this.tickCooldown) {
      this.tickTimer = 0;
      for (const e of enemies) {
        if (!e.alive) continue;
        const d = Math.sqrt((e.x - player.x) ** 2 + (e.y - player.y) ** 2);
        if (d < this.range + e.radius) {
          e.takeDamage(Math.round(this.damage * 0.15));
          e.slowMultiplier = Math.min(e.slowMultiplier, this.slowFactor);
        }
      }
    }
    // Big pulse
    if (this.pulseTimer >= this.pulseCooldown) {
      this.pulseTimer = 0;
      for (const e of enemies) {
        if (!e.alive) continue;
        const d = Math.sqrt((e.x - player.x) ** 2 + (e.y - player.y) ** 2);
        if (d < this.range + e.radius) e.takeDamage(this.damage);
      }
      this.pulseEffects.push(new ExplosionEffect(player.x, player.y, this.range, 0.5, '#80d8ff'));
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, player: Player): void {
    const s = camera.worldToScreen(player.x, player.y);
    ctx.save();
    ctx.strokeStyle = '#80d8ff'; ctx.globalAlpha = 0.22; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.range, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    for (const fx of this.pulseEffects) fx.draw(ctx, camera);
  }
}

// ─── Evolution: Arc Nova (Ion Chain lv2 + Pulse Cannon lv2) ────────────────────

export class ArcNova implements Weapon {
  readonly name = 'Arc Nova'; readonly isEvolution = true; level = 1;
  private cooldown = 1.1; private damage = 34; private speed = 360;
  private directions = 6; private chains = 3;
  totalDamageDealt = 0;
  private timer = 0; private flashes: LightningFlash[] = [];
  private readonly color = '#b388ff';

  getStats(): string { return `DMG:${this.damage} ${this.directions}-way +${this.chains} chains`; }

  upgrade(stat: 'damage' | 'rate'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.45, this.cooldown * 0.82); this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult;
    this.damage = Math.round(this.damage * damageMult);
  }

  update(dt: number, player: Player, enemies: Enemy[], pool: ProjectilePool): void {
    this.timer += dt;
    for (const f of this.flashes) f.update(dt);
    this.flashes = this.flashes.filter(f => !f.done);
    if (this.timer < this.cooldown) return;
    this.timer = 0;

    for (let i = 0; i < this.directions; i++) {
      const angle = (i / this.directions) * Math.PI * 2;
      pool.spawn(player.x, player.y, Math.cos(angle) * this.speed, Math.sin(angle) * this.speed,
        this.damage, 8, 2, this.color);
    }

    const targets = enemies
      .filter(e => e.alive)
      .sort((a, b) =>
        ((a.x - player.x) ** 2 + (a.y - player.y) ** 2) - ((b.x - player.x) ** 2 + (b.y - player.y) ** 2))
      .slice(0, this.chains);
    if (!targets.length) return;

    const chainDamage = Math.round(this.damage * 0.75);
    const segs: LightningSegment[] = [];
    let prevX = player.x;
    let prevY = player.y;
    for (const t of targets) {
      t.takeDamage(chainDamage);
      this.totalDamageDealt += chainDamage;
      segs.push({ x1: prevX, y1: prevY, x2: t.x, y2: t.y });
      prevX = t.x;
      prevY = t.y;
    }
    this.flashes.push(new LightningFlash(segs));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, _player: Player): void {
    for (const f of this.flashes) f.draw(ctx, camera);
  }
}

// ─── Evolution: Event Horizon (Ion Chain lv3 + Gravity Well lv2) ───────────────

export class EventHorizon implements Weapon {
  readonly name = 'Event Horizon'; readonly isEvolution = true; level = 1;
  private pulseCooldown = 1.0; private chainCooldown = 0.55;
  private damage = 42; private range = 180;
  totalDamageDealt = 0;
  private pulseTimer = 0; private chainTimer = 0;
  private pulseEffects: ExplosionEffect[] = []; private flashes: LightningFlash[] = [];

  getStats(): string { return `DMG:${this.damage} Pull:${this.range}px Arc field`; }

  upgrade(stat: 'damage' | 'range'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'range') { this.range += 30; this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.pulseCooldown *= speedMult;
    this.chainCooldown *= speedMult;
    this.damage = Math.round(this.damage * damageMult);
  }

  update(dt: number, player: Player, enemies: Enemy[], _pool: ProjectilePool): void {
    this.pulseTimer += dt;
    this.chainTimer += dt;
    for (const fx of this.pulseEffects) fx.update(dt);
    for (const f of this.flashes) f.update(dt);
    this.pulseEffects = this.pulseEffects.filter(fx => !fx.done);
    this.flashes = this.flashes.filter(f => !f.done);

    const inRange: Enemy[] = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist >= this.range + e.radius) continue;
      inRange.push(e);
      if (dist > 0) {
        const pull = 160 * (1 - dist / this.range) * dt;
        e.x += (dx / dist) * pull;
        e.y += (dy / dist) * pull;
      }
    }

    if (this.chainTimer >= this.chainCooldown && inRange.length) {
      this.chainTimer = 0;
      const chainDamage = Math.round(this.damage * 0.45);
      const segs: LightningSegment[] = [];
      let prevX = player.x;
      let prevY = player.y;
      for (const t of inRange
        .slice()
        .sort((a, b) =>
          ((a.x - player.x) ** 2 + (a.y - player.y) ** 2) - ((b.x - player.x) ** 2 + (b.y - player.y) ** 2))
        .slice(0, 4)) {
        t.takeDamage(chainDamage);
        this.totalDamageDealt += chainDamage;
        segs.push({ x1: prevX, y1: prevY, x2: t.x, y2: t.y });
        prevX = t.x;
        prevY = t.y;
      }
      this.flashes.push(new LightningFlash(segs));
    }

    if (this.pulseTimer >= this.pulseCooldown) {
      this.pulseTimer = 0;
      for (const e of inRange) {
        e.takeDamage(this.damage);
        this.totalDamageDealt += this.damage;
      }
      this.pulseEffects.push(new ExplosionEffect(player.x, player.y, this.range, 0.45, '#ce93d8'));
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, player: Player): void {
    const s = camera.worldToScreen(player.x, player.y);
    ctx.save();
    ctx.strokeStyle = '#ce93d8'; ctx.globalAlpha = 0.22; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, this.range, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    for (const fx of this.pulseEffects) fx.draw(ctx, camera);
    for (const f of this.flashes) f.draw(ctx, camera);
  }
}

// ─── FrostMissile helper ────────────────────────────────────────────────────────

class FrostMissile {
  alive = true;
  private age = 0;
  private readonly maxAge = 3.8;

  constructor(
    public x: number, public y: number,
    private vx: number, private vy: number,
    private damage: number,
    readonly radius: number,
    private explosionRadius: number,
    private slowFactor: number,
    private effects: ExplosionEffect[],
    private onDamage?: (dmg: number) => void,
  ) {}

  update(dt: number, enemies: Enemy[], camX: number, camY: number): void {
    this.age += dt;
    if (this.age >= this.maxAge || Math.abs(this.x - camX) > 1600 || Math.abs(this.y - camY) > 1600) {
      this.alive = false; return;
    }
    let nearest: Enemy | null = null;
    let bestDist = Infinity;
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = (e.x - this.x) ** 2 + (e.y - this.y) ** 2;
      if (d < bestDist) { bestDist = d; nearest = e; }
    }
    if (nearest) {
      const dx = nearest.x - this.x;
      const dy = nearest.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const tx = (dx / dist) * 260;
      const ty = (dy / dist) * 260;
      const turnRate = 4.2;
      this.vx += (tx - this.vx) * turnRate * dt;
      this.vy += (ty - this.vy) * turnRate * dt;
      const spd = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
      if (spd > 260) {
        this.vx = (this.vx / spd) * 260;
        this.vy = (this.vy / spd) * 260;
      }
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    for (const e of enemies) {
      if (!e.alive) continue;
      if (circlesOverlap(this.x, this.y, this.radius, e.x, e.y, e.radius)) { this.explode(enemies); return; }
    }
  }

  explode(enemies: Enemy[]): void {
    this.alive = false;
    for (const e of enemies) {
      if (!e.alive) continue;
      const dx = e.x - this.x;
      const dy = e.y - this.y;
      if (Math.sqrt(dx * dx + dy * dy) < this.explosionRadius + e.radius) {
        e.takeDamage(this.damage);
        e.slowMultiplier = Math.min(e.slowMultiplier, this.slowFactor);
        this.onDamage?.(this.damage);
      }
    }
    this.effects.push(new ExplosionEffect(this.x, this.y, this.explosionRadius, 0.5, '#80d8ff'));
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (!this.alive) return;
    const s = camera.worldToScreen(this.x, this.y);
    const angle = Math.atan2(this.vy, this.vx);
    ctx.save();
    ctx.translate(s.x, s.y); ctx.rotate(angle);
    ctx.fillStyle = '#80d8ff'; ctx.shadowColor = '#e1f5fe'; ctx.shadowBlur = 12;
    ctx.fillRect(-10, -3, 16, 6);
    ctx.fillStyle = '#e1f5fe';
    ctx.fillRect(-14, -2, 6, 4);
    ctx.fillStyle = 'rgba(128,216,255,0.45)';
    ctx.fillRect(-22, -3, 10, 6);
    ctx.restore();
  }
}

// ─── Evolution: Frost Barrage (Missile Barrage lv2 + Cryo Beam lv2) ────────────

export class FrostBarrage implements Weapon {
  readonly name = 'Frost Barrage'; readonly isEvolution = true; level = 1;
  private cooldown = 1.9; private damage = 72; private count = 2;
  private explosionRadius = 110; private slowFactor = 0.35;
  totalDamageDealt = 0;
  private timer = 0; private missiles: FrostMissile[] = []; private effects: ExplosionEffect[] = [];
  private cameraRef: Camera | null = null;

  getStats(): string { return `DMG:${this.damage} Blast:${this.explosionRadius}px x${this.count} freeze`; }

  upgrade(stat: 'damage' | 'rate'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.3); this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(0.8, this.cooldown * 0.82); this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult;
    this.damage = Math.round(this.damage * damageMult);
  }

  update(dt: number, player: Player, enemies: Enemy[], _pool: ProjectilePool): void {
    this.timer += dt;
    const camX = this.cameraRef?.x ?? 0;
    const camY = this.cameraRef?.y ?? 0;
    for (const m of this.missiles) m.update(dt, enemies, camX, camY);
    for (const fx of this.effects) fx.update(dt);
    this.missiles = this.missiles.filter(m => m.alive);
    this.effects = this.effects.filter(fx => !fx.done);
    if (this.timer < this.cooldown) return;
    this.timer = 0;

    const target = enemies
      .filter(e => e.alive)
      .sort((a, b) =>
        ((a.x - player.x) ** 2 + (a.y - player.y) ** 2) - ((b.x - player.x) ** 2 + (b.y - player.y) ** 2))[0];
    if (!target) return;

    const baseAngle = Math.atan2(target.y - player.y, target.x - player.x);
    for (let i = 0; i < this.count; i++) {
      const spread = (i - (this.count - 1) / 2) * 0.28;
      const angle = baseAngle + spread;
      this.missiles.push(new FrostMissile(
        player.x + Math.cos(angle) * 20, player.y + Math.sin(angle) * 20,
        Math.cos(angle) * 190, Math.sin(angle) * 190,
        this.damage, 9, this.explosionRadius, this.slowFactor, this.effects,
        (dmg) => { this.totalDamageDealt += dmg; },
      ));
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, _player: Player): void {
    this.cameraRef = camera;
    for (const m of this.missiles) m.draw(ctx, camera);
    for (const fx of this.effects) fx.draw(ctx, camera);
  }
}

// ─── Weapon: Gravity Well ─────────────────────────────────────────────────────
// Creates a gravitational singularity at the player's position that pulls
// nearby enemies inward for pullDuration seconds then detonates, dealing
// damage that scales with how close each enemy was to the epicentre.

export class GravityWell implements Weapon {
  readonly name = 'Gravity Well';
  readonly isEvolution = false;
  level = 1;
  cooldown = 5.5;
  damage = 55;
  pullRadius = 200;
  pullDuration = 2.0;
  totalDamageDealt = 0;
  private timer = 0;
  private active = false;
  private activeTimer = 0;
  private wellX = 0;
  private wellY = 0;
  private pulseEffects: ExplosionEffect[] = [];

  getStats(): string { return `DMG:${this.damage} Pull:${this.pullRadius}px CD:${this.cooldown.toFixed(1)}s`; }

  upgrade(stat: 'damage' | 'radius' | 'rate'): void {
    if (stat === 'damage') { this.damage = Math.round(this.damage * 1.35); this.level++; }
    else if (stat === 'radius') { this.pullRadius += 40; this.level++; }
    else if (stat === 'rate') { this.cooldown = Math.max(2.5, this.cooldown * 0.80); this.level++; }
  }

  scaleStats(speedMult: number, damageMult: number): void {
    this.cooldown *= speedMult;
    this.damage = Math.round(this.damage * damageMult);
  }

  update(dt: number, player: Player, enemies: Enemy[], _pool: ProjectilePool): void {
    for (const fx of this.pulseEffects) fx.update(dt);
    this.pulseEffects = this.pulseEffects.filter(fx => !fx.done);

    if (this.active) {
      this.activeTimer += dt;

      // Pull living enemies toward the well centre
      for (const e of enemies) {
        if (!e.alive) continue;
        const dx = this.wellX - e.x;
        const dy = this.wellY - e.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0 && dist < this.pullRadius) {
          const pullStr = 180 * (1 - dist / this.pullRadius) * dt;
          e.x += (dx / dist) * pullStr;
          e.y += (dy / dist) * pullStr;
        }
      }

      // Detonate when the active timer expires
      if (this.activeTimer >= this.pullDuration) {
        this.active = false;
        this.activeTimer = 0;
        for (const e of enemies) {
          if (!e.alive) continue;
          const dx = this.wellX - e.x;
          const dy = this.wellY - e.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < this.pullRadius + e.radius) {
            const d = Math.round(this.damage * (1 + 0.5 * Math.max(0, 1 - dist / this.pullRadius)));
            e.takeDamage(d);
            this.totalDamageDealt += d;
          }
        }
        this.pulseEffects.push(new ExplosionEffect(this.wellX, this.wellY, this.pullRadius, 0.5, '#ce93d8'));
      }
    } else {
      this.timer += dt;
      if (this.timer >= this.cooldown) {
        this.timer = 0;
        this.active = true;
        this.activeTimer = 0;
        this.wellX = player.x;
        this.wellY = player.y;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera, _player: Player): void {
    for (const fx of this.pulseEffects) fx.draw(ctx, camera);
    if (!this.active) return;
    const s = camera.worldToScreen(this.wellX, this.wellY);
    const t = this.activeTimer / this.pullDuration;

    ctx.save();
    // Outer pull-field ring
    ctx.globalAlpha = 0.18 + t * 0.30;
    ctx.strokeStyle = '#ce93d8';
    ctx.shadowColor = '#ce93d8';
    ctx.shadowBlur = 16;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.pullRadius, 0, Math.PI * 2);
    ctx.stroke();
    // Rotating inner rings (cosmetic)
    for (let r = 0; r < 2; r++) {
      const ringR = this.pullRadius * (0.45 + r * 0.25);
      const rot   = (Date.now() / 1000) * (r % 2 === 0 ? 1.5 : -1.5);
      ctx.globalAlpha = 0.30 + t * 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, ringR, rot, rot + Math.PI * 1.5);
      ctx.stroke();
    }
    // Core singularity
    ctx.globalAlpha = 0.75 + t * 0.25;
    ctx.fillStyle = '#e040fb';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 6 + t * 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────
// createWeaponByName() is the single place that maps string weapon names to
// concrete class instances.  It is called by main.ts's addWeapon() helper
// (which also applies accumulated speed/damage multipliers so a newly-unlocked
// weapon starts pre-scaled to match current global powerup levels).

export type AnyWeapon = Weapon;

/**
 * Constructs and returns a new weapon instance for the given display name, or
 * null if the name is unrecognised (shouldn't happen in practice).
 */
export function createWeaponByName(name: string): AnyWeapon | null {
  switch (name) {
    case 'Laser':           return new MagicBolt();
    case 'Plasma Whip':     return new Whip();
    case 'Plasma Bomb':     return new Fireball();
    case 'Ion Chain':       return new Lightning();
    case 'Force Field':     return new Aura();
    case 'Missile Barrage': return new MissileBarrage();
    case 'Pulse Cannon':    return new PulseCannon();
    case 'Cryo Beam':       return new CryoBeam();
    case 'Gravity Well':    return new GravityWell();
    case 'Beam Lash':       return new ThunderStrike();
    case 'Dark Matter':     return new VoidOrb();
    case 'Nova Burst':      return new Inferno();
    case 'Solar Flare':     return new SolarFlare();
    case 'Quantum Torpedo': return new QuantumTorpedo();
    case 'Glacial Storm':   return new GlacialStorm();
    case 'Arc Nova':        return new ArcNova();
    case 'Event Horizon':   return new EventHorizon();
    case 'Frost Barrage':   return new FrostBarrage();
    default:                return null;
  }
}
