// ─── player.ts ────────────────────────────────────────────────────────────────
// The Player class owns everything specific to the human-controlled ship:
//   • Stats (HP, speed, armor, weapon multipliers, upgrade counters)
//   • Input handling (keyboard + mouse + touch)
//   • Per-frame movement logic
//   • Pixel-art ship rendering with a thruster flame animation
//
// Coordinate system
// ──────────────────
// (x, y) is the ship's *world-space* centre.  The ship radius is used for
// collision checks (circlesOverlap) but the sprite itself is drawn centred at
// the camera's screen projection of (x, y).
//
// Invincibility frames
// ─────────────────────
// After taking damage the player becomes briefly invincible (invincibleTimer).
// During this window takeDamage() is a no-op.  The sprite blinks at 10 Hz to
// give visual feedback.
// ──────────────────────────────────────────────────────────────────────────────

import type { Camera } from './camera.ts';

export class Player {
  // ── World position ─────────────────────────────────────────────────────────
  x: number = 0;
  y: number = 0;

  /** Collision circle radius in world-space pixels. */
  readonly radius: number = 18;

  // ── Movement ───────────────────────────────────────────────────────────────
  /** Movement speed in world pixels per second. Increased by Thruster upgrades. */
  speed: number = 180;

  // ── Health / shield ────────────────────────────────────────────────────────
  maxHp: number = 100;
  hp: number = 100;

  /** Seconds of remaining invincibility after the last hit. */
  invincibleTimer: number = 0;
  /** How long (seconds) each hit grants invincibility. */
  readonly invincibleDuration: number = 0.5;

  /** True while the player is alive; set to false on fatal damage. */
  alive: boolean = true;

  // ── Upgrade-driven stats ───────────────────────────────────────────────────
  /** Gem attraction radius (px) — increased by Tractor Beam upgrades. */
  pickupRadius: number = 60;

  /** Flat damage reduction per hit (increased by Titanium Plating upgrades). */
  armor: number = 0;

  /**
   * Cooldown multiplier baked into all currently-held weapons and applied to
   * any weapon unlocked in the future.  Values < 1 mean faster fire.
   * Updated by "Systems Overclock" generic upgrades.
   */
  attackSpeedMult: number = 1.0;

  /**
   * Damage multiplier applied to all weapons.  Values > 1 mean more damage.
   * Updated by "Weapons Amplifier" generic upgrades.
   */
  damageMult: number = 1.0;

  // ── Generic upgrade counters (used to enforce per-upgrade caps) ────────────
  /** How many "Systems Overclock" upgrades have been taken. */
  atkSpeedUpgrades = 0;
  /** How many "Weapons Amplifier" upgrades have been taken. */
  damageUpgrades = 0;
  /** How many "Tractor Beam" upgrades have been taken. */
  pickupUpgrades = 0;
  /** How many "Titanium Plating" upgrades have been taken. */
  armorUpgrades = 0;
  /** How many "Shield Capacity Up" upgrades have been taken. */
  hpUpgrades = 0;
  /** How many "Burn Catalyst" upgrades have been taken. */
  burnUpgrades = 0;
  /** How many "Toxin Core" upgrades have been taken. */
  poisonUpgrades = 0;

  /**
   * Probability (0–1) that a hit applies a burn DoT.
   * Incremented by Burn Catalyst upgrade entries.
   */
  burnChance: number = 0;

  /**
   * Probability (0–1) that a hit applies a poison DoT.
   * Incremented by Toxin Core upgrade entries.
   */
  poisonChance: number = 0;

  // ── Facing / animation ─────────────────────────────────────────────────────
  /**
   * Current facing direction in radians (standard math convention: 0 = right).
   * Updated each frame to match the movement vector so the sprite always points
   * in the direction of travel.  Default −π/2 = facing up.
   */
  facingAngle: number = -Math.PI / 2; // default: facing up

  /** True while the player moved this frame — used to show/hide the thruster. */
  private _isMoving: boolean = false;

  /**
   * An age counter that ticks up while the player moves; fed into Math.sin()
   * to make the thruster flame flicker at a natural frequency.
   */
  private _thrusterAge: number = 0;

  // ── Input state ────────────────────────────────────────────────────────────
  /** Map of currently pressed key codes, set by the keydown/keyup listeners. */
  private keys: Record<string, boolean> = {};

  /**
   * World-space target set by holding mouse button / touch.
   * The player moves toward this point until released (null = inactive).
   * Keyboard input takes priority: if any WASD/arrow key is held,
   * the pointer target is ignored.
   */
  private _pointerTarget: { x: number; y: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private camera: Camera) {
    this._bindInput();
  }

  // ── Input binding ──────────────────────────────────────────────────────────

  /**
   * Registers all input event listeners.  Called once in the constructor.
   * Using window for keyboard events (so focus doesn't need to be on the canvas)
   * and canvas for pointer events (to avoid interfering with page scroll).
   */
  private _bindInput(): void {
    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    // Mouse: move while button held
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this._setPointerFromEvent(e.clientX, e.clientY);
    });
    this.canvas.addEventListener('mousemove', (e) => {
      // e.buttons is a bitmask; bit 0 = primary (left) button
      if (e.buttons & 1) this._setPointerFromEvent(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._pointerTarget = null;
    });

    // Touch: move toward finger
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault(); // prevent scroll / tap-zoom on mobile
      const t = e.touches[0];
      if (t) this._setPointerFromEvent(t.clientX, t.clientY);
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) this._setPointerFromEvent(t.clientX, t.clientY);
    }, { passive: false });
    this.canvas.addEventListener('touchend', () => { this._pointerTarget = null; });
    this.canvas.addEventListener('touchcancel', () => { this._pointerTarget = null; });
  }

  /**
   * Converts a client-space pointer position (from a MouseEvent or TouchEvent)
   * into a world-space coordinate and stores it as the current pointer target.
   *
   * We must account for the canvas potentially being CSS-scaled differently from
   * its pixel dimensions (getBoundingClientRect vs canvas.width/height).
   */
  private _setPointerFromEvent(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    // Scale factors handle any CSS transform applied to the canvas element
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const screenX = (clientX - rect.left) * scaleX;
    const screenY = (clientY - rect.top) * scaleY;
    // Convert canvas pixel → world coordinate using the camera
    this._pointerTarget = this.camera.screenToWorld(screenX, screenY);
  }

  // ── Game logic ─────────────────────────────────────────────────────────────

  /**
   * Applies damage to the player, respecting invincibility frames and armor.
   * Enemies call this every frame while overlapping the player (damage × dt),
   * so the value received here can be fractional.
   *
   * Armor provides flat reduction (minimum 1 damage gets through so the player
   * can never become completely immune via armor alone).
   */
  takeDamage(amount: number): void {
    if (this.invincibleTimer > 0 || !this.alive) return;
    this.hp -= Math.max(1, amount - this.armor);
    this.invincibleTimer = this.invincibleDuration;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  /**
   * Per-frame update.  Called by main.ts with the delta-time in seconds.
   *
   * Order of operations:
   *   1. Tick down invincibility timer.
   *   2. Collect input into a (dx, dy) movement vector.
   *   3. Normalize the vector (diagonal movement isn't faster).
   *   4. Translate the position and update facingAngle.
   *   5. Advance the thruster animation age.
   */
  update(dt: number): void {
    if (!this.alive) return;

    // Decrement i-frames timer each frame
    if (this.invincibleTimer > 0) this.invincibleTimer -= dt;

    let dx = 0;
    let dy = 0;

    // Keyboard input: WASD and arrow keys
    if (this.keys['ArrowUp']    || this.keys['KeyW']) dy -= 1;
    if (this.keys['ArrowDown']  || this.keys['KeyS']) dy += 1;
    if (this.keys['ArrowLeft']  || this.keys['KeyA']) dx -= 1;
    if (this.keys['ArrowRight'] || this.keys['KeyD']) dx += 1;

    // Pointer (mouse/touch): only apply when no keyboard key is held
    if (dx === 0 && dy === 0 && this._pointerTarget) {
      const pdx = this._pointerTarget.x - this.x;
      const pdy = this._pointerTarget.y - this.y;
      const distSq = pdx * pdx + pdy * pdy;
      // Dead-zone of 16 px — stops micro-jitter when the pointer is on top
      if (distSq > 16 * 16) {
        const dist = Math.sqrt(distSq);
        dx = pdx / dist;
        dy = pdy / dist;
      }
    }

    // Normalize so diagonal movement isn't faster than cardinal
    const len = Math.sqrt(dx * dx + dy * dy);
    this._isMoving = len > 0;
    if (len > 0) {
      dx /= len;
      dy /= len;
      // Keep the sprite facing the direction of travel
      this.facingAngle = Math.atan2(dy, dx);
    }

    // Apply movement scaled by speed and frame time
    this.x += dx * this.speed * dt;
    this.y += dy * this.speed * dt;

    // Advance thruster flicker animation (rate = 12 rad/s)
    if (this._isMoving) this._thrusterAge += dt * 12;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  /**
   * Draws the pixel-art spaceship sprite at the player's screen position.
   *
   * The sprite is built from axis-aligned rectangles (fillRect) — no image
   * assets needed.  ctx.rotate() aligns the ship to facingAngle so it always
   * points in the direction of movement.
   *
   * Sprite anatomy (in local space, before rotation):
   *   y < 0 → nose (tip points up in local space)
   *   y > 0 → engine end
   *   Wings extend to x ± ~11
   *
   * The thruster flame behind the engine nozzle flickers using a sine wave
   * driven by _thrusterAge.
   */
  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const s = camera.worldToScreen(this.x, this.y);

    // Blink at 10 Hz during invincibility (alternating visible/transparent)
    const blinking = this.invincibleTimer > 0 && Math.floor(this.invincibleTimer * 10) % 2 === 0;

    ctx.save();
    ctx.globalAlpha = blinking ? 0.3 : 1;
    ctx.translate(s.x, s.y);
    // Ship sprite faces up (−y); rotate so it faces the movement direction.
    // facingAngle 0 = right (+x), so we add π/2 to align the up-facing sprite.
    ctx.rotate(this.facingAngle + Math.PI / 2);

    // ── Thruster flame (drawn first so the ship body covers its base) ─────────
    if (this._isMoving) {
      // Flicker length oscillates between ~1 and ~5 px
      const flicker = 3 + Math.sin(this._thrusterAge) * 2;
      ctx.fillStyle = '#ff9100'; // orange outer flame
      ctx.fillRect(-3, 8, 6, Math.round(flicker));
      ctx.fillStyle = '#ffeb3b'; // yellow inner flame core
      ctx.fillRect(-2, 7, 4, 3);
    }

    // ── Engine nozzle (dark teal base below the body) ─────────────────────────
    ctx.fillStyle = '#004d6b';
    ctx.fillRect(-4, 4, 8, 4);

    // ── Wings ─────────────────────────────────────────────────────────────────
    ctx.fillStyle = '#00838f';
    ctx.fillRect(-11, -2, 5, 8); // left wing
    ctx.fillRect(6, -2, 5, 8);   // right wing

    // Wing tips (bright accent pixels at the outermost corner)
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(-12, 2, 2, 2); // left tip
    ctx.fillRect(10, 2, 2, 2);  // right tip

    // ── Main hull ─────────────────────────────────────────────────────────────
    ctx.fillStyle = '#00bcd4';
    ctx.fillRect(-4, -10, 8, 18);

    // ── Nose section ──────────────────────────────────────────────────────────
    ctx.fillStyle = '#00acc1';
    ctx.fillRect(-3, -13, 6, 4);  // nose base
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(-2, -16, 4, 4);  // nose tip
    ctx.fillStyle = '#b2ebf2';
    ctx.fillRect(-1, -17, 2, 2);  // very tip highlight pixel

    // ── Cockpit window ────────────────────────────────────────────────────────
    ctx.fillStyle = '#1a237e';           // dark canopy frame
    ctx.fillRect(-2, -9, 4, 6);
    ctx.fillStyle = 'rgba(100,200,255,0.75)'; // semi-transparent glass
    ctx.fillRect(-1, -8, 2, 4);

    ctx.restore();
  }
}
