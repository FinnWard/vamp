export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0; // world position of camera center
    this.y = 0;
  }

  follow(worldX, worldY) {
    this.x = worldX;
    this.y = worldY;
  }

  // Convert world coordinates to screen coordinates
  worldToScreen(wx, wy) {
    return {
      x: wx - this.x + this.canvas.width / 2,
      y: wy - this.y + this.canvas.height / 2,
    };
  }

  // Convert screen coordinates to world coordinates
  screenToWorld(sx, sy) {
    return {
      x: sx + this.x - this.canvas.width / 2,
      y: sy + this.y - this.canvas.height / 2,
    };
  }

  // Apply camera transform to canvas context
  begin(ctx) {
    ctx.save();
    ctx.translate(
      this.canvas.width / 2 - this.x,
      this.canvas.height / 2 - this.y
    );
  }

  end(ctx) {
    ctx.restore();
  }

  drawGrid(ctx) {
    const gridSize = 80;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Offset grid so it tiles seamlessly with camera movement
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
