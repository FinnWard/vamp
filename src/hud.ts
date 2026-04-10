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
    const pad = 14;
    const barW = 200;
    const barH = 12;

    const hpFrac = Math.max(0, player.hp / player.maxHp);
    this.drawBar(ctx, pad, pad, barW, barH, hpFrac, '#00e5ff', '#01579b', '■ SHIELD');
    this.drawBar(ctx, pad, pad + barH + 8, barW, barH, levelManager.xpFraction, '#69ffdf', '#004d40', `★ LV ${levelManager.level}`);

    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60).toString().padStart(2, '0');
    ctx.save();
    ctx.font = '11px "Press Start 2P", monospace';
    ctx.fillStyle = '#b2ebf2';
    ctx.textAlign = 'center';
    ctx.fillText(`${minutes}:${seconds}`, canvas.width / 2, 22);
    ctx.fillStyle = '#ef9a9a';
    ctx.textAlign = 'right';
    ctx.fillText(`✦ ${kills}`, canvas.width - pad, 22);
    ctx.restore();

    let wx = pad;
    const iconY = canvas.height - pad - 38;
    ctx.save();
    ctx.font = '7px "Press Start 2P", monospace';
    ctx.textAlign = 'left';
    for (const w of weapons) {
      ctx.fillStyle = 'rgba(0,10,40,0.7)';
      ctx.fillRect(wx, iconY, 96, 34);
      ctx.strokeStyle = '#01579b';
      ctx.lineWidth = 1;
      ctx.strokeRect(wx, iconY, 96, 34);
      ctx.fillStyle = '#00e5ff';
      ctx.fillText(w.name, wx + 5, iconY + 13);
      ctx.fillStyle = '#4dd0e1';
      ctx.fillText(`Lv.${w.level}`, wx + 5, iconY + 27);
      wx += 104;
    }
    ctx.restore();
  }

  private drawBar(
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    fraction: number,
    colorFill: string, colorBg: string,
    label: string,
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
    ctx.font = '7px "Press Start 2P", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 4, y + h - 1);
    ctx.restore();
  }
}
