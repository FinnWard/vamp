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

  private keys: Record<string, boolean> = {};

  constructor() {
    this._bindInput();
  }

  private _bindInput(): void {
    window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  }

  takeDamage(amount: number): void {
    if (this.invincibleTimer > 0 || !this.alive) return;
    this.hp -= amount;
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
    if (this.keys['ArrowUp']   || this.keys['KeyW']) dy -= 1;
    if (this.keys['ArrowDown'] || this.keys['KeyS']) dy += 1;
    if (this.keys['ArrowLeft'] || this.keys['KeyA']) dx -= 1;
    if (this.keys['ArrowRight']|| this.keys['KeyD']) dx += 1;

    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) { dx /= len; dy /= len; }

    this.x += dx * this.speed * dt;
    this.y += dy * this.speed * dt;
  }

  draw(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const s = camera.worldToScreen(this.x, this.y);
    const blinking = this.invincibleTimer > 0 && Math.floor(this.invincibleTimer * 10) % 2 === 0;

    ctx.save();
    ctx.globalAlpha = blinking ? 0.3 : 1;

    ctx.fillStyle = '#4fc3f7';
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#81d4fa';
    ctx.beginPath();
    ctx.arc(s.x - 5, s.y - 5, this.radius * 0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
