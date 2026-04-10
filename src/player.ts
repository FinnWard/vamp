import type { Camera } from './camera.ts';

export class Player {
  x: number = 0;
  y: number = 0;
  readonly radius: number = 18;
  speed: number = 180;
  maxHp: number = 100;
  hp: number = 100;
  invincibleTimer: number = 0;
  readonly invincibleDuration: number = 0.5;
  alive: boolean = true;

  /** Gem attraction radius (px) — increased by Tractor Beam upgrades. */
  pickupRadius: number = 60;
  /** Flat damage reduction per hit. */
  armor: number = 0;
  /** Accumulated speed multiplier applied to newly unlocked weapons. */
  attackSpeedMult: number = 1.0;
  /** Accumulated damage multiplier applied to newly unlocked weapons. */
  damageMult: number = 1.0;

  facingAngle: number = -Math.PI / 2; // default: facing up
  private _isMoving: boolean = false;
  private _thrusterAge: number = 0;

  private keys: Record<string, boolean> = {};

  /** World-space target set by mouse/touch hold. Null = not active. */
  private _pointerTarget: { x: number; y: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private camera: Camera) {
    this._bindInput();
  }

  private _bindInput(): void {
    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    // Mouse: move while button held
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this._setPointerFromEvent(e.clientX, e.clientY);
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (e.buttons & 1) this._setPointerFromEvent(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this._pointerTarget = null;
    });

    // Touch: move toward finger
    this.canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
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

  private _setPointerFromEvent(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    const screenX = (clientX - rect.left) * scaleX;
    const screenY = (clientY - rect.top) * scaleY;
    this._pointerTarget = this.camera.screenToWorld(screenX, screenY);
  }

  takeDamage(amount: number): void {
    if (this.invincibleTimer > 0 || !this.alive) return;
    this.hp -= Math.max(1, amount - this.armor);
    this.invincibleTimer = this.invincibleDuration;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  update(dt: number): void {
    if (!this.alive) return;

    if (this.invincibleTimer > 0) this.invincibleTimer -= dt;

    let dx = 0;
    let dy = 0;

    // Keyboard input
    if (this.keys['ArrowUp']    || this.keys['KeyW']) dy -= 1;
    if (this.keys['ArrowDown']  || this.keys['KeyS']) dy += 1;
    if (this.keys['ArrowLeft']  || this.keys['KeyA']) dx -= 1;
    if (this.keys['ArrowRight'] || this.keys['KeyD']) dx += 1;

    // Pointer (mouse/touch): only apply when no keyboard key is held
    if (dx === 0 && dy === 0 && this._pointerTarget) {
      const pdx = this._pointerTarget.x - this.x;
      const pdy = this._pointerTarget.y - this.y;
      const distSq = pdx * pdx + pdy * pdy;
      if (distSq > 16 * 16) {
        const dist = Math.sqrt(distSq);
        dx = pdx / dist;
        dy = pdy / dist;
      }
    }

    const len = Math.sqrt(dx * dx + dy * dy);
    this._isMoving = len > 0;
    if (len > 0) {
      dx /= len;
      dy /= len;
      this.facingAngle = Math.atan2(dy, dx);
    }

    this.x += dx * this.speed * dt;
    this.y += dy * this.speed * dt;

    if (this._isMoving) this._thrusterAge += dt * 12;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const s = camera.worldToScreen(this.x, this.y);
    const blinking = this.invincibleTimer > 0 && Math.floor(this.invincibleTimer * 10) % 2 === 0;

    ctx.save();
    ctx.globalAlpha = blinking ? 0.3 : 1;
    ctx.translate(s.x, s.y);
    // Ship sprite faces up (-y); rotate to face movement direction
    ctx.rotate(this.facingAngle + Math.PI / 2);

    // Thruster glow (behind the ship)
    if (this._isMoving) {
      const flicker = 3 + Math.sin(this._thrusterAge) * 2;
      ctx.fillStyle = '#ff9100';
      ctx.fillRect(-3, 8, 6, Math.round(flicker));
      ctx.fillStyle = '#ffeb3b';
      ctx.fillRect(-2, 7, 4, 3);
    }

    // Engine nozzle
    ctx.fillStyle = '#004d6b';
    ctx.fillRect(-4, 4, 8, 4);

    // Wings
    ctx.fillStyle = '#00838f';
    ctx.fillRect(-11, -2, 5, 8);
    ctx.fillRect(6, -2, 5, 8);

    // Wing tips (accent pixels)
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(-12, 2, 2, 2);
    ctx.fillRect(10, 2, 2, 2);

    // Main hull body
    ctx.fillStyle = '#00bcd4';
    ctx.fillRect(-4, -10, 8, 18);

    // Nose
    ctx.fillStyle = '#00acc1';
    ctx.fillRect(-3, -13, 6, 4);
    ctx.fillStyle = '#00e5ff';
    ctx.fillRect(-2, -16, 4, 4);
    ctx.fillStyle = '#b2ebf2';
    ctx.fillRect(-1, -17, 2, 2);

    // Cockpit window
    ctx.fillStyle = '#1a237e';
    ctx.fillRect(-2, -9, 4, 6);
    ctx.fillStyle = 'rgba(100,200,255,0.75)';
    ctx.fillRect(-1, -8, 2, 4);

    ctx.restore();
  }
}
