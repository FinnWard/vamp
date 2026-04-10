import type { Player } from './player';
import type { LevelUpManager } from './levelup';
import type { Weapon } from './weapons';

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
    const iconW = Math.round(88 * s);
    const iconH = Math.round(32 * s);
    const iconGap = Math.round(6 * s);
    const totalW = weapons.length * iconW + (weapons.length - 1) * iconGap;
    let wx = Math.round((canvas.width - totalW) / 2);
    const iconY = canvas.height - pad - iconH;

    ctx.save();
    ctx.font = `${Math.round(6 * s)}px "Press Start 2P", monospace`;
    ctx.textAlign = 'left';
    for (const w of weapons) {
      ctx.fillStyle = 'rgba(0,10,40,0.75)';
      ctx.fillRect(wx, iconY, iconW, iconH);
      ctx.strokeStyle = w.isEvolution ? '#6200ea' : '#01579b';
      ctx.lineWidth = Math.round(1.5 * s);
      ctx.strokeRect(wx, iconY, iconW, iconH);
      ctx.fillStyle = w.isEvolution ? '#ea80fc' : '#00e5ff';
      ctx.fillText(w.name.length > 12 ? w.name.slice(0, 11) + '…' : w.name, wx + Math.round(4 * s), iconY + Math.round(12 * s));
      ctx.fillStyle = '#ffd740';
      ctx.fillText(`Lv.${w.level}`, wx + Math.round(4 * s), iconY + Math.round(25 * s));
      wx += iconW + iconGap;
    }
    ctx.restore();
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
