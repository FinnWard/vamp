export class Camera {
  x: number = 0;
  y: number = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  follow(worldX: number, worldY: number): void {
    this.x = worldX;
    this.y = worldY;
  }

  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: wx - this.x + this.canvas.width / 2,
      y: wy - this.y + this.canvas.height / 2,
    };
  }

  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: sx + this.x - this.canvas.width / 2,
      y: sy + this.y - this.canvas.height / 2,
    };
  }

  begin(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(
      this.canvas.width / 2 - this.x,
      this.canvas.height / 2 - this.y,
    );
  }

  end(ctx: CanvasRenderingContext2D): void {
    ctx.restore();
  }

  drawGrid(ctx: CanvasRenderingContext2D): void {
    const gridSize = 80;
    const w = this.canvas.width;
    const h = this.canvas.height;

    const offX = ((this.x % gridSize) + gridSize) % gridSize;
    const offY = ((this.y % gridSize) + gridSize) % gridSize;

    ctx.save();
    ctx.strokeStyle = '#1a2a1a';
    ctx.lineWidth = 1;

    for (let x = -offX; x <= w; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = -offY; y <= h; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }
}
