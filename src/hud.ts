// ─── hud.ts ───────────────────────────────────────────────────────────────────
// The HUD (Heads-Up Display) draws directly onto the game canvas in *screen*
// space (not world space) so it always stays in the same place regardless of
// camera movement.
//
// Layout (top to bottom):
//   Top-left   — Shield (HP) bar and XP / Level bar
//   Top-centre — Elapsed time
//   Top-right  — Kill counter
//   Bottom     — Weapon icons (one per active weapon, centred)
//
// Pixel sprites
// ──────────────
// Weapon icons include a small 8×8 pixel sprite per weapon defined in
// WEAPON_SPRITE_GRIDS.  Each row of the grid is a string of 8 characters:
//   '1' = primary color, '2' = secondary color, '.' = transparent
// The sprite is scaled to 2× pixels at the default scale factor so it remains
// crisp on most monitors without needing image files.
//
// Responsive scaling
// ───────────────────
// All sizes are multiplied by `s = canvas.width / 480` (clamped to 1–2.5)
// so the HUD looks reasonable on both desktop and mobile screen sizes.
// ──────────────────────────────────────────────────────────────────────────────

import type { Player } from './player';
import type { LevelUpManager } from './levelup';
import type { Weapon } from './weapons';

// ─── Pixel sprite definitions (8×8 grid, '.' = transparent) ──────────────────
// Each weapon in the game has a matching entry here so its icon can be drawn
// in the weapon slot bar at the bottom of the screen.
// '1' = primary color (from WEAPON_SPRITE_COLORS), '2' = secondary color.

const WEAPON_SPRITE_GRIDS: Record<string, string[]> = {
  'Laser': [
    '...11...',
    '...11...',
    '...11...',
    '11111111',
    '11111111',
    '...11...',
    '...11...',
    '........',
  ],
  'Plasma Whip': [
    '......11',
    '.....11.',
    '...111..',
    '..11....',
    '.11.....',
    '11......',
    '1.......',
    '........',
  ],
  'Plasma Bomb': [
    '.11111..',
    '1222221.',
    '1222221.',
    '1222221.',
    '1222221.',
    '1222221.',
    '.11111..',
    '........',
  ],
  'Ion Chain': [
    '11......',
    '11......',
    '.11.11..',
    '..1111..',
    '..1111..',
    '..11.11.',
    '......11',
    '......11',
  ],
  'Force Field': [
    '.111111.',
    '1......1',
    '1......1',
    '1......1',
    '1......1',
    '1......1',
    '.111111.',
    '........',
  ],
  'Missile Barrage': [
    '......11',
    '....1111',
    '..111111',
    '11111111',
    '..111111',
    '....1111',
    '......11',
    '........',
  ],
  'Pulse Cannon': [
    '1..1..1.',
    '.1.1.1..',
    '..111...',
    '111.1111',
    '..111...',
    '.1.1.1..',
    '1..1..1.',
    '........',
  ],
  'Cryo Beam': [
    '1..1..1.',
    '.1.1.1..',
    '..111...',
    '11111111',
    '..111...',
    '.1.1.1..',
    '1..1..1.',
    '........',
  ],
  'Beam Lash': [
    '.....111',
    '...111..',
    '..11....',
    '.11111..',
    '1111111.',
    '.11.....',
    '..111...',
    '.....111',
  ],
  'Dark Matter': [
    '.111111.',
    '1.1111.1',
    '1.1..1.1',
    '11....11',
    '11....11',
    '1.1..1.1',
    '1.1111.1',
    '.111111.',
  ],
  'Nova Burst': [
    '1..1..1.',
    '.1.1.1..',
    '1.111.1.',
    '1111.111',
    '1111.111',
    '1.111.1.',
    '.1.1.1..',
    '1..1..1.',
  ],
  'Solar Flare': [
    '1..1..1.',
    '.111111.',
    '.11..11.',
    '111..111',
    '111..111',
    '.11..11.',
    '.111111.',
    '1..1..1.',
  ],
  'Quantum Torpedo': [
    '.......1',
    '.....111',
    '...11111',
    '11111111',
    '11111111',
    '...11111',
    '.....111',
    '.......1',
  ],
  'Glacial Storm': [
    '...1....',
    '1..1..1.',
    '.1.1.1..',
    '.11111..',
    '.11111..',
    '.1.1.1..',
    '1..1..1.',
    '...1....',
  ],
};

/**
 * Maps each weapon name to [primaryColor, secondaryColor].
 * These correspond to '1' and '2' characters in WEAPON_SPRITE_GRIDS.
 * Evolution weapons generally have more vivid / distinct palettes.
 */
const WEAPON_SPRITE_COLORS: Record<string, [string, string]> = {
  'Laser':           ['#00e5ff', '#b2ebf2'],
  'Plasma Whip':     ['#40c4ff', '#b2ebf2'],
  'Plasma Bomb':     ['#0091ea', '#40c4ff'],
  'Ion Chain':       ['#00e5ff', '#b2ebf2'],
  'Force Field':     ['#26c6da', '#b2ebf2'],
  'Missile Barrage': ['#ff6d00', '#ffab40'],
  'Pulse Cannon':    ['#ffd740', '#fff9c4'],
  'Cryo Beam':       ['#80d8ff', '#e1f5fe'],
  'Beam Lash':       ['#69ffdf', '#b2dfdb'],
  'Dark Matter':     ['#e040fb', '#ea80fc'],
  'Nova Burst':      ['#00b0ff', '#80d8ff'],
  'Solar Flare':     ['#ffea00', '#fff9c4'],
  'Quantum Torpedo': ['#ce93d8', '#e1bee7'],
  'Glacial Storm':   ['#b3e5fc', '#e1f5fe'],
};

export class HUD {
  /**
   * Main draw call — renders all HUD elements onto `ctx` in screen space.
   * Called once per frame, after the world is drawn.
   *
   * @param ctx          Canvas 2D context.
   * @param canvas       Reference to the canvas (for width/height).
   * @param player       Player state (HP, maxHp).
   * @param levelManager Provides current level and XP progress.
   * @param elapsed      Total seconds elapsed since the game started.
   * @param kills        Total enemy kill count.
   * @param weapons      All currently equipped weapons.
   */
  draw(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    player: Player,
    levelManager: LevelUpManager,
    elapsed: number,
    kills: number,
    weapons: Weapon[],
  ): void {
    // Scale all HUD elements relative to canvas width so it looks good on mobile.
    // At 480 px wide s = 1, at 1200 px wide s = 2.5 (capped).
    const s = Math.max(1, Math.min(canvas.width / 480, 2.5));
    const pad = Math.round(10 * s);
    const barW = Math.round(Math.min(canvas.width * 0.38, 240 * s));
    const barH = Math.round(11 * s);

    // ── Shield and XP bars (top-left) ────────────────────────────────────────
    const hpFrac = Math.max(0, player.hp / player.maxHp);
    this.drawBar(ctx, pad, pad, barW, barH, hpFrac, '#00e5ff', '#01579b', '■ SHIELD', s);
    this.drawBar(ctx, pad, pad + barH + Math.round(7 * s), barW, barH, levelManager.xpFraction, '#69ffdf', '#004d40', `★ LV ${levelManager.level}`, s);

    // ── Timer (top-centre) ────────────────────────────────────────────────────
    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60).toString().padStart(2, '0');
    ctx.save();
    ctx.font = `${Math.round(10 * s)}px "Press Start 2P", monospace`;
    ctx.fillStyle = '#b2ebf2';
    ctx.textAlign = 'center';
    ctx.fillText(`${minutes}:${seconds}`, canvas.width / 2, Math.round(18 * s));

    // ── Kill counter (top-right) ──────────────────────────────────────────────
    ctx.fillStyle = '#ef9a9a';
    ctx.textAlign = 'right';
    // Offset left of the canvas edge to avoid the ⏸ pause button
    ctx.fillText(`✦ ${kills}`, canvas.width - pad - Math.round(44 * s), Math.round(18 * s));
    ctx.restore();

    // ── Weapon icons (bottom-centre) ──────────────────────────────────────────
    const iconW = Math.round(92 * s);  // total icon card width
    const iconH = Math.round(36 * s);  // total icon card height
    const iconGap = Math.round(6 * s); // gap between cards
    const totalW = weapons.length * iconW + (weapons.length - 1) * iconGap;
    let wx = Math.round((canvas.width - totalW) / 2); // starting X for first card
    const iconY = canvas.height - pad - iconH;         // Y aligned to bottom
    const p = Math.max(1, Math.round(2 * s));        // pixels per sprite cell
    const spriteW = 8 * p;                            // total sprite width (8 cells)
    const spriteX = Math.round(3 * s);               // left padding inside icon
    const textX = spriteX + spriteW + Math.round(3 * s); // text x offset from wx

    ctx.save();
    ctx.font = `${Math.round(6 * s)}px "Press Start 2P", monospace`;
    ctx.textAlign = 'left';
    for (const w of weapons) {
      // Card background + border
      ctx.fillStyle = 'rgba(0,10,40,0.75)';
      ctx.fillRect(wx, iconY, iconW, iconH);
      // Evolution weapons get a purple border; base weapons get blue
      ctx.strokeStyle = w.isEvolution ? '#6200ea' : '#01579b';
      ctx.lineWidth = Math.round(1.5 * s);
      ctx.strokeRect(wx, iconY, iconW, iconH);

      // Draw the 8×8 pixel sprite on the left side of the card
      const spriteY = iconY + Math.round((iconH - 8 * p) / 2); // vertically centred
      this.drawWeaponSprite(ctx, wx + spriteX, spriteY, p, w);

      // Weapon name (truncated to 10 chars if too long)
      ctx.fillStyle = w.isEvolution ? '#ea80fc' : '#00e5ff';
      const label = w.name.length > 10 ? w.name.slice(0, 9) + '…' : w.name;
      ctx.fillText(label, wx + textX, iconY + Math.round(13 * s));

      // Level indicator
      ctx.fillStyle = '#ffd740';
      ctx.fillText(`Lv.${w.level}`, wx + textX, iconY + Math.round(26 * s));

      wx += iconW + iconGap; // advance to next card position
    }
    ctx.restore();
  }

  /**
   * Draws an 8×8 pixel sprite for the given weapon using its grid definition
   * and color pair.
   *
   * @param sx,sy  Top-left screen position of the sprite.
   * @param p      Pixel size in canvas pixels (e.g. 2 = each "pixel" is a 2×2 block).
   * @param weapon The weapon whose name is used to look up the sprite data.
   */
  private drawWeaponSprite(
    ctx: CanvasRenderingContext2D,
    sx: number, sy: number,
    p: number,
    weapon: Weapon,
  ): void {
    const grid = WEAPON_SPRITE_GRIDS[weapon.name];
    const colors = WEAPON_SPRITE_COLORS[weapon.name];
    if (!grid || !colors) return; // unknown weapon — no sprite to draw
    const [c1, c2] = colors;
    for (let row = 0; row < grid.length; row++) {
      const rowStr = grid[row]!;
      for (let col = 0; col < rowStr.length; col++) {
        const ch = rowStr[col];
        if (ch === '1') {
          ctx.fillStyle = c1;
          ctx.fillRect(sx + col * p, sy + row * p, p, p);
        } else if (ch === '2') {
          ctx.fillStyle = c2;
          ctx.fillRect(sx + col * p, sy + row * p, p, p);
        }
        // '.' = transparent, nothing drawn
      }
    }
  }

  /**
   * Draws a labelled progress bar with a scanline texture overlay.
   *
   * @param x,y        Top-left position of the bar.
   * @param w,h        Dimensions.
   * @param fraction   Fill amount (0–1).
   * @param colorFill  Color of the filled portion.
   * @param colorBg    Color of the unfilled track.
   * @param label      Short text drawn inside the bar.
   * @param s          Scale factor for font size.
   */
  private drawBar(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    fraction: number,
    colorFill: string, colorBg: string,
    label: string,
    s: number,
  ): void {
    ctx.save();

    // Semi-transparent outer gutter for contrast against busy backgrounds
    ctx.fillStyle = 'rgba(0,5,30,0.7)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);

    // Empty-bar track
    ctx.fillStyle = colorBg;
    ctx.fillRect(x, y, w, h);

    // Filled portion proportional to `fraction`
    ctx.fillStyle = colorFill;
    ctx.fillRect(x, y, Math.round(w * fraction), h);

    // Pixel scanline texture: semi-transparent white lines every 2 px
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let row = y; row < y + h; row += 2) {
      ctx.fillRect(x, row, Math.round(w * fraction), 1);
    }

    // Label text at the left inside the bar
    ctx.fillStyle = '#e0f7fa';
    ctx.font = `${Math.round(6 * s)}px "Press Start 2P", monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(label, x + Math.round(3 * s), y + h - Math.round(1 * s));

    ctx.restore();
  }
}
