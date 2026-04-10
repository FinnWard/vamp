export class Player {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.radius = 18;
    this.speed = 180; // pixels per second
    this.maxHp = 100;
    this.hp = 100;
    this.invincibleTimer = 0;
    this.invincibleDuration = 0.5; // seconds of iframes after hit
    this.alive = true;

    // Input state
    this.keys = {};
    this._bindInput();
  }

  _bindInput() {
    window.addEventListener('keydown', e => { this.keys[e.code] = true; });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
  }

  takeDamage(amount) {
    if (this.invincibleTimer > 0 || !this.alive) return;
    this.hp -= amount;
    this.invincibleTimer = this.invincibleDuration;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  update(dt) {
    if (!this.alive) return;

    if (this.invincibleTimer > 0) {
      this.invincibleTimer -= dt;
    }

    let dx = 0;
    let dy = 0;
    if (this.keys['ArrowUp'] || this.keys['KeyW']) dy -= 1;
    if (this.keys['ArrowDown'] || this.keys['KeyS']) dy += 1;
    if (this.keys['ArrowLeft'] || this.keys['KeyA']) dx -= 1;
    if (this.keys['ArrowRight'] || this.keys['KeyD']) dx += 1;

    // Normalize diagonal movement
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0) {
      dx /= len;
      dy /= len;
    }

    this.x += dx * this.speed * dt;
    this.y += dy * this.speed * dt;
  }

  draw(ctx, camera) {
    const s = camera.worldToScreen(this.x, this.y);
    const blinking = this.invincibleTimer > 0 && Math.floor(this.invincibleTimer * 10) % 2 === 0;

    ctx.save();
    ctx.globalAlpha = blinking ? 0.3 : 1;

    // Body
    ctx.fillStyle = '#4fc3f7';
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius, 0, Math.PI * 2);
    ctx.fill();

    // Highlight
    ctx.fillStyle = '#81d4fa';
    ctx.beginPath();
    ctx.arc(s.x - 5, s.y - 5, this.radius * 0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
