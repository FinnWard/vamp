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

  drawStarField(ctx: CanvasRenderingContext2D): void {
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Three parallax layers: distant (slow), mid, near (fast)
    const layers = [
      { factor: 0.04, cellSize: 70,  starSize: 1,   idx: 0 },
      { factor: 0.15, cellSize: 55,  starSize: 1,   idx: 1 },
      { factor: 0.40, cellSize: 90,  starSize: 2,   idx: 2 },
    ];

    ctx.save();
    for (const layer of layers) {
      const { factor, cellSize, starSize, idx } = layer;
      const ox = this.x * factor;
      const oy = this.y * factor;

      const startGx = Math.floor((ox - w / 2) / cellSize) - 1;
      const endGx   = Math.ceil((ox + w / 2) / cellSize) + 1;
      const startGy = Math.floor((oy - h / 2) / cellSize) - 1;
      const endGy   = Math.ceil((oy + h / 2) / cellSize) + 1;

      for (let gx = startGx; gx <= endGx; gx++) {
        for (let gy = startGy; gy <= endGy; gy++) {
          const hash = this._starHash(gx, gy, idx);
          const lx = (hash & 0xFF) / 255;
          const ly = ((hash >> 8) & 0xFF) / 255;
          const brightness = 0.35 + ((hash >> 16) & 0x7F) / 127 * 0.65;

          const sx = Math.round((gx + lx) * cellSize - ox + w / 2);
          const sy = Math.round((gy + ly) * cellSize - oy + h / 2);

          ctx.fillStyle = `rgba(200,220,255,${brightness.toFixed(2)})`;
          ctx.fillRect(sx, sy, starSize, starSize);
        }
      }
    }
    ctx.restore();
  }

  private _starHash(x: number, y: number, layer: number): number {
    let h = (((x * 1619) ^ (y * 31337) ^ (layer * 6271)) | 0) >>> 0;
    h ^= h >>> 16;
    h = (Math.imul(h, 0x45d9f3b)) >>> 0;
    h ^= h >>> 16;
    return h;
  }
}
