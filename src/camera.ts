// ─── camera.ts ────────────────────────────────────────────────────────────────
// The Camera converts between *world* coordinates (infinite game space) and
// *screen* coordinates (canvas pixels).
//
// Design notes
// ─────────────
// • The camera is always centred on its (x, y) world position.  Calling
//   follow() each frame makes it track the player.
// • worldToScreen() is the hot-path transform used by every draw() call; it
//   simply offsets by −camera + canvasCenter.
// • The star-field is drawn by the camera rather than a separate object because
//   it needs the camera offset to implement parallax (different layers scroll at
//   different speeds so distant stars appear slower).
// ──────────────────────────────────────────────────────────────────────────────

export class Camera {
  /** World-space X position the camera is centred on. */
  x: number = 0;
  /** World-space Y position the camera is centred on. */
  y: number = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  // ── Coordinate transforms ──────────────────────────────────────────────────

  /**
   * Snap the camera to look at a world position.
   * Called every frame with the player's position so the view follows them.
   */
  follow(worldX: number, worldY: number): void {
    this.x = worldX;
    this.y = worldY;
  }

  /**
   * Converts a world-space point to canvas pixel coordinates.
   * Formula: screen = world − cameraOrigin + canvasCenter
   * This is the inverse of screenToWorld.
   */
  worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: wx - this.x + this.canvas.width / 2,
      y: wy - this.y + this.canvas.height / 2,
    };
  }

  /**
   * Converts a canvas pixel coordinate back to a world-space point.
   * Used when translating mouse/touch input (which arrives in screen space)
   * into the game's coordinate system.
   */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: sx + this.x - this.canvas.width / 2,
      y: sy + this.y - this.canvas.height / 2,
    };
  }

  // ── ctx.save/restore helpers (currently unused by main render path) ─────────

  /**
   * Applies a canvas translation so subsequent draw calls can use world coords
   * directly without calling worldToScreen().  Must be paired with end().
   * (Kept for reference; the project currently uses explicit worldToScreen()
   * calls instead of this approach.)
   */
  begin(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.translate(
      this.canvas.width / 2 - this.x,
      this.canvas.height / 2 - this.y,
    );
  }

  /** Restores the canvas state pushed by begin(). */
  end(ctx: CanvasRenderingContext2D): void {
    ctx.restore();
  }

  // ── Background ─────────────────────────────────────────────────────────────

  /**
   * Draws a tiled, parallax star field directly onto the canvas.
   *
   * Implementation strategy
   * ────────────────────────
   * Stars are *deterministically* placed in a virtual infinite grid using a
   * hash function (_starHash).  This avoids storing a list of stars in memory
   * and means the field is always consistent regardless of camera position.
   *
   * Three layers with different parallax factors create an illusion of depth:
   *   • factor 0.04 → barely moves (far background)
   *   • factor 0.15 → mid-layer
   *   • factor 0.40 → moves noticeably (near layer, 2 px stars)
   *
   * For each layer we compute which grid cells are currently visible and
   * draw one star per cell at a sub-cell offset derived from the hash.
   */
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
      // Shift the virtual grid origin by the layer's parallax factor
      const ox = this.x * factor;
      const oy = this.y * factor;

      // Determine which grid cells are visible on screen (+1 cell margin for safety)
      const startGx = Math.floor((ox - w / 2) / cellSize) - 1;
      const endGx   = Math.ceil((ox + w / 2) / cellSize) + 1;
      const startGy = Math.floor((oy - h / 2) / cellSize) - 1;
      const endGy   = Math.ceil((oy + h / 2) / cellSize) + 1;

      for (let gx = startGx; gx <= endGx; gx++) {
        for (let gy = startGy; gy <= endGy; gy++) {
          // Hash the grid cell to get a deterministic pseudo-random value
          const hash = this._starHash(gx, gy, idx);
          // Use the lower 16 bits for the sub-cell (x, y) offset
          const lx = (hash & 0xFF) / 255;
          const ly = ((hash >> 8) & 0xFF) / 255;
          // Use the next 7 bits for star brightness (0.35–1.0 range)
          const brightness = 0.35 + ((hash >> 16) & 0x7F) / 127 * 0.65;

          // Convert to screen coordinates
          const sx = Math.round((gx + lx) * cellSize - ox + w / 2);
          const sy = Math.round((gy + ly) * cellSize - oy + h / 2);

          ctx.fillStyle = `rgba(200,220,255,${brightness.toFixed(2)})`;
          ctx.fillRect(sx, sy, starSize, starSize);
        }
      }
    }
    ctx.restore();
  }

  /**
   * Fast integer hash mixing three inputs (grid x, grid y, layer index).
   * Based on a variant of the Murmur/Wang hash; produces a 32-bit unsigned
   * integer whose bits are used as pseudo-random star placement data.
   */
  private _starHash(x: number, y: number, layer: number): number {
    let h = (((x * 1619) ^ (y * 31337) ^ (layer * 6271)) | 0) >>> 0;
    h ^= h >>> 16;
    h = (Math.imul(h, 0x45d9f3b)) >>> 0;
    h ^= h >>> 16;
    return h;
  }
}
