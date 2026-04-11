import type { Player } from './player';
import type { LevelUpManager } from './levelup';
import type { Weapon } from './weapons';

// ─── Pixel sprite definitions (8×8 grid, '.' = transparent) ──────────────────

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
  draw(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    player: Player,
    levelManager: LevelUpManager,
    elapsed: number,
    kills: number,
    weapons: Weapon[],
  ): void {
    // Scale all HUD elements relative to canvas width so it looks good on mobile
    const s = Math.max(1, Math.min(canvas.width / 480, 2.5));
    const pad = Math.round(10 * s);
    const barW = Math.round(Math.min(canvas.width * 0.38, 240 * s));
    const barH = Math.round(11 * s);

    const hpFrac = Math.max(0, player.hp / player.maxHp);
    this.drawBar(ctx, pad, pad, barW, barH, hpFrac, '#00e5ff', '#01579b', '■ SHIELD', s);
    this.drawBar(ctx, pad, pad + barH + Math.round(7 * s), barW, barH, levelManager.xpFraction, '#69ffdf', '#004d40', `★ LV ${levelManager.level}`, s);

    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60).toString().padStart(2, '0');
    ctx.save();
    ctx.font = `${Math.round(10 * s)}px "Press Start 2P", monospace`;
    ctx.fillStyle = '#b2ebf2';
    ctx.textAlign = 'center';
    ctx.fillText(`${minutes}:${seconds}`, canvas.width / 2, Math.round(18 * s));
    ctx.fillStyle = '#ef9a9a';
    ctx.textAlign = 'right';
    ctx.fillText(`✦ ${kills}`, canvas.width - pad - Math.round(44 * s), Math.round(18 * s));
    ctx.restore();

    // Weapon icons along the bottom
    const iconW = Math.round(92 * s);
    const iconH = Math.round(36 * s);
    const iconGap = Math.round(6 * s);
    const totalW = weapons.length * iconW + (weapons.length - 1) * iconGap;
    let wx = Math.round((canvas.width - totalW) / 2);
    const iconY = canvas.height - pad - iconH;
    const p = Math.max(1, Math.round(2 * s));        // sprite pixel size
    const spriteW = 8 * p;                            // total sprite width
    const spriteX = Math.round(3 * s);               // left padding inside icon
    const textX = spriteX + spriteW + Math.round(3 * s); // text x offset from wx

    ctx.save();
    ctx.font = `${Math.round(6 * s)}px "Press Start 2P", monospace`;
    ctx.textAlign = 'left';
    for (const w of weapons) {
      ctx.fillStyle = 'rgba(0,10,40,0.75)';
      ctx.fillRect(wx, iconY, iconW, iconH);
      ctx.strokeStyle = w.isEvolution ? '#6200ea' : '#01579b';
      ctx.lineWidth = Math.round(1.5 * s);
      ctx.strokeRect(wx, iconY, iconW, iconH);

      // Draw pixel sprite
      const spriteY = iconY + Math.round((iconH - 8 * p) / 2);
      this.drawWeaponSprite(ctx, wx + spriteX, spriteY, p, w);

      // Draw text to the right of sprite
      ctx.fillStyle = w.isEvolution ? '#ea80fc' : '#00e5ff';
      const label = w.name.length > 10 ? w.name.slice(0, 9) + '…' : w.name;
      ctx.fillText(label, wx + textX, iconY + Math.round(13 * s));
      ctx.fillStyle = '#ffd740';
      ctx.fillText(`Lv.${w.level}`, wx + textX, iconY + Math.round(26 * s));
      wx += iconW + iconGap;
    }
    ctx.restore();
  }

  private drawWeaponSprite(
    ctx: CanvasRenderingContext2D,
    sx: number, sy: number,
    p: number,
    weapon: Weapon,
  ): void {
    const grid = WEAPON_SPRITE_GRIDS[weapon.name];
    const colors = WEAPON_SPRITE_COLORS[weapon.name];
    if (!grid || !colors) return;
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
      }
    }
  }

  private drawBar(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    fraction: number,
    colorFill: string, colorBg: string,
    label: string,
    s: number,
  ): void {
    ctx.save();
    ctx.fillStyle = 'rgba(0,5,30,0.7)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = colorBg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = colorFill;
    ctx.fillRect(x, y, Math.round(w * fraction), h);
    // Pixel scanline
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let row = y; row < y + h; row += 2) {
      ctx.fillRect(x, row, Math.round(w * fraction), 1);
    }
    ctx.fillStyle = '#e0f7fa';
    ctx.font = `${Math.round(6 * s)}px "Press Start 2P", monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(label, x + Math.round(3 * s), y + h - Math.round(1 * s));
    ctx.restore();
  }
}
