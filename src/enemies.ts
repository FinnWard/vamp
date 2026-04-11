import { circlesOverlap, randomRange } from './utils';
import type { Camera } from './camera';
import type { Player } from './player';

type EnemyType = 'grunt' | 'fast' | 'tank' | 'charger' | 'ranged' | 'splitter' | 'splitterlet';

interface EnemyStats {
  radius: number;
  speed: number;
  hp: number;
  damage: number;
  xpValue: number;
  color: string;
}

/** Hard cap on enemy movement speed (px/s) — keeps fast enemies from being extreme. */
const MAX_ENEMY_SPEED = 160;

/** HP multiplier added linearly per minute of real-time elapsed. */
const HP_SCALE_LINEAR_PER_MIN = 0.25;
/** HP multiplier applied multiplicatively per minute of real-time elapsed. */
const HP_SCALE_MULT_PER_MIN = 1.04;

const ENEMY_TYPES: Record<EnemyType, EnemyStats> = {
  grunt:      { radius: 16, speed: 90,  hp: 18, damage: 12, xpValue: 1, color: '#e53935' },
  fast:       { radius: 12, speed: 155, hp: 10, damage: 8,  xpValue: 1, color: '#ff7043' },
  tank:       { radius: 26, speed: 52,  hp: 70, damage: 20, xpValue: 3, color: '#7b1fa2' },
  charger:    { radius: 15, speed: 85,  hp: 25, damage: 18, xpValue: 2, color: '#f57f17' },
  ranged:     { radius: 13, speed: 75,  hp: 12, damage: 10, xpValue: 2, color: '#00897b' },
  splitter:   { radius: 22, speed: 55,  hp: 45, damage: 15, xpValue: 3, color: '#558b2f' },
  splitterlet:{ radius: 9,  speed: 120, hp: 8,  damage: 6,  xpValue: 1, color: '#8bc34a' },
};

export class Enemy {
  x: number;
  y: number;
  readonly type: EnemyType;
  alive: boolean = true;
  readonly radius: number;
  readonly speed: number;
  /** Multiplier applied to speed each frame — reset toward 1 over time. Used by cryo weapons. */
  slowMultiplier: number = 1.0;
  readonly maxHp: number;
  hp: number;
  readonly damage: number;
  readonly xpValue: number;
  readonly color: string;
  /** Cosmetic variant index (0 = default, 1 = alternate shade). */
  readonly variant: number;
  /** HP multiplier used at construction — stored so splitter children inherit the same scale. */
  readonly hpMultiplier: number;

  // ── Charger-specific state ────────────────────────────────────────────────
  private _chargeCooldown: number;   // seconds until next charge
  private _chargeActive: number = 0; // seconds remaining in active dash
  private _chargeVelX: number = 0;
  private _chargeVelY: number = 0;

  // ── Ranged-specific preferred distance ───────────────────────────────────
  private static readonly RANGED_PREF_DIST = 220;

  constructor(x: number, y: number, type: EnemyType = 'grunt', hpMultiplier: number = 1) {
    this.x = x;
    this.y = y;
    this.type = type;
    this.variant = Math.random() < 0.3 ? 1 : 0; // ~30% chance of alternate variant

    const stats = ENEMY_TYPES[type];
    this.radius = stats.radius;
    this.speed = Math.min(stats.speed, MAX_ENEMY_SPEED);
    const scaledHp = Math.round(stats.hp * hpMultiplier);
    this.hpMultiplier = hpMultiplier;
    this.maxHp = scaledHp;
    this.hp = scaledHp;
    this.damage = stats.damage;
    this.xpValue = stats.xpValue;
    this.color = stats.color;

    // Charger: stagger initial charge timing so not all charge at once
    this._chargeCooldown = type === 'charger' ? 1 + Math.random() * 2 : 0;
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

    // Recover from slow over time
    if (this.slowMultiplier < 1.0) {
      this.slowMultiplier = Math.min(1.0, this.slowMultiplier + dt * 1.5);
    }

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ndx = dist > 0 ? dx / dist : 0;
    const ndy = dist > 0 ? dy / dist : 0;

    if (this.type === 'charger') {
      this._updateCharger(dt, ndx, ndy);
    } else if (this.type === 'ranged') {
      this._updateRanged(dt, dist, ndx, ndy);
    } else {
      // Standard homing movement (grunt, fast, tank, splitter, splitterlet)
      const effectiveSpeed = Math.min(this.speed, MAX_ENEMY_SPEED) * this.slowMultiplier;
      this.x += ndx * effectiveSpeed * dt;
      this.y += ndy * effectiveSpeed * dt;
    }

    if (circlesOverlap(this.x, this.y, this.radius, player.x, player.y, player.radius)) {
      player.takeDamage(this.damage * dt);
    }
  }

  private _updateCharger(dt: number, ndx: number, ndy: number): void {
    if (this._chargeActive > 0) {
      // Intentionally exceeds MAX_ENEMY_SPEED during the burst — the whole point of
      // the charger type is this brief high-speed lunge; capping it would remove the threat.
      const effectiveSpeed = Math.min(this.speed * 3.5, MAX_ENEMY_SPEED * 2) * this.slowMultiplier;
      this.x += this._chargeVelX * effectiveSpeed * dt;
      this.y += this._chargeVelY * effectiveSpeed * dt;
      this._chargeActive -= dt;
    } else {
      // Patrol slowly toward player
      const effectiveSpeed = Math.min(this.speed * 0.6, MAX_ENEMY_SPEED) * this.slowMultiplier;
      this.x += ndx * effectiveSpeed * dt;
      this.y += ndy * effectiveSpeed * dt;
      // Count down to next charge
      this._chargeCooldown -= dt;
      if (this._chargeCooldown <= 0) {
        // Lock direction toward player and start charge
        this._chargeVelX = ndx;
        this._chargeVelY = ndy;
        this._chargeActive = 0.5;
        this._chargeCooldown = 2.5 + Math.random() * 1.5;
      }
    }
  }

  private _updateRanged(dt: number, dist: number, ndx: number, ndy: number): void {
    const pref = Enemy.RANGED_PREF_DIST;
    let moveMult: number;
    if (dist < pref - 30) {
      // Too close — back away
      moveMult = -1;
    } else if (dist > pref + 30) {
      // Too far — close in
      moveMult = 1;
    } else {
      // In comfortable range — strafe slightly (use perpendicular)
      moveMult = 0;
      const perpX = -ndy;
      const perpY = ndx;
      const effectiveSpeed = Math.min(this.speed * 0.4, MAX_ENEMY_SPEED) * this.slowMultiplier;
      this.x += perpX * effectiveSpeed * dt;
      this.y += perpY * effectiveSpeed * dt;
      return;
    }
    const effectiveSpeed = Math.min(this.speed, MAX_ENEMY_SPEED) * this.slowMultiplier;
    this.x += ndx * moveMult * effectiveSpeed * dt;
    this.y += ndy * moveMult * effectiveSpeed * dt;
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
    } else if (this.type === 'charger') {
      this._drawCharger(ctx);
    } else if (this.type === 'ranged') {
      this._drawRanged(ctx);
    } else if (this.type === 'splitter') {
      this._drawSplitter(ctx);
    } else if (this.type === 'splitterlet') {
      this._drawSplitterlet(ctx);
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
    // Space invader style grunt — variant 1 uses a blue-red palette
    const main   = this.variant === 1 ? '#c62828' : '#e53935';
    const light  = this.variant === 1 ? '#ef9a9a' : '#ef5350';
    const dark   = this.variant === 1 ? '#7f0000' : '#b71c1c';
    const eyeW   = this.variant === 1 ? '#ffcdd2' : '#ffcdd2';
    // Antennae
    ctx.fillStyle = light;
    ctx.fillRect(-7, -14, 3, 5);
    ctx.fillRect(4, -14, 3, 5);
    // Head / body
    ctx.fillStyle = main;
    ctx.fillRect(-8, -9, 16, 12);
    // Claws
    ctx.fillStyle = light;
    ctx.fillRect(-12, -4, 5, 6);
    ctx.fillRect(7, -4, 5, 6);
    // Feet
    ctx.fillStyle = dark;
    ctx.fillRect(-10, 3, 4, 4);
    ctx.fillRect(-2, 3, 4, 4);
    ctx.fillRect(6, 3, 4, 4);
    // Eyes (white)
    ctx.fillStyle = eyeW;
    ctx.fillRect(-6, -7, 4, 4);
    ctx.fillRect(2, -7, 4, 4);
    // Pupils (dark)
    ctx.fillStyle = '#4a0000';
    ctx.fillRect(-5, -6, 2, 2);
    ctx.fillRect(3, -6, 2, 2);
  }

  private _drawFast(ctx: CanvasRenderingContext2D): void {
    // Dart-shaped fast enemy — variant 1 is a yellow-orange palette
    const main   = this.variant === 1 ? '#ffa000' : '#ff7043';
    const body   = this.variant === 1 ? '#ff8f00' : '#ff5722';
    const fin    = this.variant === 1 ? '#ffca28' : '#ff8a65';
    const engine = this.variant === 1 ? '#e65100' : '#bf360c';
    const eye    = this.variant === 1 ? '#fff9c4' : '#ffccbc';
    ctx.fillStyle = main;
    // Nose
    ctx.fillRect(-2, -11, 4, 4);
    ctx.fillStyle = body;
    ctx.fillRect(-1, -14, 2, 4);
    // Body
    ctx.fillRect(-3, -7, 6, 14);
    // Side fins
    ctx.fillStyle = fin;
    ctx.fillRect(-7, -3, 4, 7);
    ctx.fillRect(3, -3, 4, 7);
    // Engine
    ctx.fillStyle = engine;
    ctx.fillRect(-3, 7, 6, 3);
    // Eye slit
    ctx.fillStyle = eye;
    ctx.fillRect(-2, -5, 4, 2);
  }

  private _drawTank(ctx: CanvasRenderingContext2D): void {
    // Large blocky alien boss — variant 1 is deep blue instead of purple
    const armor  = this.variant === 1 ? '#1565c0' : '#6a1b9a';
    const body   = this.variant === 1 ? '#1976d2' : '#7b1fa2';
    const turret = this.variant === 1 ? '#1e88e5' : '#8e24aa';
    const barrel = this.variant === 1 ? '#42a5f5' : '#ab47bc';
    const core   = this.variant === 1 ? '#40c4ff' : '#e040fb';
    const glow   = this.variant === 1 ? '#e1f5fe' : '#f8bbd0';
    const eyeL   = this.variant === 1 ? '#90caf9' : '#ce93d8';
    const eyeD   = this.variant === 1 ? '#0d47a1' : '#4a148c';
    ctx.fillStyle = armor;
    // Side armor plates
    ctx.fillRect(-14, -6, 5, 10);
    ctx.fillRect(9, -6, 5, 10);
    // Main body
    ctx.fillStyle = body;
    ctx.fillRect(-9, -10, 18, 18);
    // Turret top
    ctx.fillStyle = turret;
    ctx.fillRect(-6, -14, 12, 5);
    ctx.fillStyle = barrel;
    ctx.fillRect(-2, -17, 4, 4);
    // Center core
    ctx.fillStyle = core;
    ctx.fillRect(-4, -4, 8, 8);
    // Core glow pixel
    ctx.fillStyle = glow;
    ctx.fillRect(-2, -2, 4, 4);
    // Eyes
    ctx.fillStyle = eyeL;
    ctx.fillRect(-7, -6, 4, 3);
    ctx.fillRect(3, -6, 4, 3);
    ctx.fillStyle = eyeD;
    ctx.fillRect(-6, -5, 2, 1);
    ctx.fillRect(4, -5, 2, 1);
  }

  private _drawCharger(ctx: CanvasRenderingContext2D): void {
    // Wedge / arrowhead shape — orange with a flared wing and charge indicator
    const main   = this.variant === 1 ? '#e65100' : '#f57f17';
    const wing   = this.variant === 1 ? '#ff8f00' : '#ffa000';
    const tip    = this.variant === 1 ? '#fff3e0' : '#ffe0b2';
    const tail   = this.variant === 1 ? '#bf360c' : '#e65100';
    const charge = this._chargeActive > 0 ? '#fff9c4' : '#ff6f00';
    // Wings spread wide
    ctx.fillStyle = wing;
    ctx.fillRect(-13, 0, 6, 5);
    ctx.fillRect(7, 0, 6, 5);
    // Body wedge
    ctx.fillStyle = main;
    ctx.fillRect(-5, -12, 10, 20);
    // Nose tip
    ctx.fillStyle = tip;
    ctx.fillRect(-2, -15, 4, 4);
    // Tail
    ctx.fillStyle = tail;
    ctx.fillRect(-4, 8, 8, 4);
    // Charge glow in center — bright when charging
    ctx.fillStyle = charge;
    ctx.fillRect(-3, -4, 6, 6);
    // Eye
    ctx.fillStyle = '#4e342e';
    ctx.fillRect(-3, -9, 2, 2);
    ctx.fillRect(1, -9, 2, 2);
  }

  private _drawRanged(ctx: CanvasRenderingContext2D): void {
    // Angular / crystalline teal shape
    const main  = this.variant === 1 ? '#004d40' : '#00695c';
    const light = this.variant === 1 ? '#00897b' : '#26a69a';
    const tip   = this.variant === 1 ? '#80cbc4' : '#b2dfdb';
    const core  = this.variant === 1 ? '#e0f2f1' : '#ffffff';
    // Outer hexagon approximated with rects
    ctx.fillStyle = main;
    ctx.fillRect(-4, -13, 8, 4);
    ctx.fillRect(-4, 9, 8, 4);
    ctx.fillStyle = light;
    ctx.fillRect(-11, -7, 22, 14);
    ctx.fillStyle = main;
    ctx.fillRect(-8, -11, 16, 22);
    // Inner diamond
    ctx.fillStyle = light;
    ctx.fillRect(-5, -5, 10, 10);
    // Core crystal
    ctx.fillStyle = core;
    ctx.fillRect(-2, -2, 4, 4);
    // Tip accents
    ctx.fillStyle = tip;
    ctx.fillRect(-2, -12, 4, 2);
    ctx.fillRect(-2, 10, 4, 2);
  }

  private _drawSplitter(ctx: CanvasRenderingContext2D): void {
    // Segmented green blob that looks like it could split
    const main  = this.variant === 1 ? '#33691e' : '#558b2f';
    const light = this.variant === 1 ? '#558b2f' : '#7cb342';
    const dark  = this.variant === 1 ? '#1b5e20' : '#33691e';
    const crack = '#c8e6c9';
    // Outer body
    ctx.fillStyle = main;
    ctx.fillRect(-11, -11, 22, 22);
    // Corner bevels (dark)
    ctx.fillStyle = dark;
    ctx.fillRect(-11, -11, 4, 4);
    ctx.fillRect(7, -11, 4, 4);
    ctx.fillRect(-11, 7, 4, 4);
    ctx.fillRect(7, 7, 4, 4);
    // Highlight
    ctx.fillStyle = light;
    ctx.fillRect(-7, -9, 14, 14);
    // Crack line down center (shows it will split)
    ctx.fillStyle = crack;
    ctx.fillRect(-1, -10, 2, 20);
    // Eyes
    ctx.fillStyle = '#f1f8e9';
    ctx.fillRect(-6, -5, 3, 3);
    ctx.fillRect(3, -5, 3, 3);
    ctx.fillStyle = '#1b5e20';
    ctx.fillRect(-5, -4, 1, 1);
    ctx.fillRect(4, -4, 1, 1);
  }

  private _drawSplitterlet(ctx: CanvasRenderingContext2D): void {
    // Small version of the splitter, no crack
    const main  = this.variant === 1 ? '#558b2f' : '#7cb342';
    const light = this.variant === 1 ? '#7cb342' : '#9ccc65';
    const dark  = this.variant === 1 ? '#33691e' : '#558b2f';
    ctx.fillStyle = main;
    ctx.fillRect(-6, -6, 12, 12);
    // Corner bevels
    ctx.fillStyle = dark;
    ctx.fillRect(-6, -6, 2, 2);
    ctx.fillRect(4, -6, 2, 2);
    ctx.fillRect(-6, 4, 2, 2);
    ctx.fillRect(4, 4, 2, 2);
    // Highlight
    ctx.fillStyle = light;
    ctx.fillRect(-4, -4, 8, 8);
    // Single eye
    ctx.fillStyle = '#f1f8e9';
    ctx.fillRect(-2, -3, 4, 3);
    ctx.fillStyle = '#1b5e20';
    ctx.fillRect(-1, -2, 2, 1);
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
    return Math.max(0.2, 0.9 - this.elapsed * 0.007);
  }

  private spawnCount(): number {
    return Math.floor(1 + this.elapsed / 20);
  }

  /** Combined HP multiplier: linear ramp + per-minute multiplicative factor. */
  private hpScale(): number {
    const mins = this.elapsed / 60;
    const linear = 1 + mins * HP_SCALE_LINEAR_PER_MIN;
    const mult   = Math.pow(HP_SCALE_MULT_PER_MIN, mins);
    return linear * mult;
  }

  private pickType(): EnemyType {
    const roll = Math.random();
    if (this.elapsed > 120 && roll < 0.08) return 'ranged';
    if (this.elapsed > 90  && roll < 0.12) return 'splitter';
    if (this.elapsed > 60  && roll < 0.18) return 'charger';
    if (this.elapsed > 50  && roll < 0.28) return 'tank';
    if (this.elapsed > 12  && roll < 0.42) return 'fast';
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
    const scale    = this.hpScale();
    while (this.timer >= interval) {
      this.timer -= interval;
      const count = this.spawnCount();
      for (let i = 0; i < count; i++) {
        const pos = this.spawnPosition(player);
        this.enemies.push(new Enemy(pos.x, pos.y, this.pickType(), scale));
      }
    }

    for (const e of this.enemies) {
      e.update(dt, player);
    }
  }

  /** Returns enemies killed this frame and removes them from the active list.
   *  Splitter enemies spawn splitterlets near their death position. */
  collectDead(): Enemy[] {
    const dead = this.enemies.filter(e => !e.alive);
    this.enemies = this.enemies.filter(e => e.alive);

    // Splitters spawn two splitterlets on death — inherit the parent's HP scale
    for (const e of dead) {
      if (e.type === 'splitter') {
        const offsets = [{ x: -20, y: 0 }, { x: 20, y: 0 }];
        for (const off of offsets) {
          this.enemies.push(new Enemy(e.x + off.x, e.y + off.y, 'splitterlet', e.hpMultiplier));
        }
      }
    }

    return dead;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    for (const e of this.enemies) {
      e.draw(ctx, camera);
    }
  }
}
