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
    const barH = 14;

    const hpFrac = Math.max(0, player.hp / player.maxHp);
    this.drawBar(ctx, pad, pad, barW, barH, hpFrac, '#e53935', '#b71c1c', '❤ HP');
    this.drawBar(ctx, pad, pad + barH + 6, barW, barH, levelManager.xpFraction, '#69f0ae', '#1b5e20', `✦ LVL ${levelManager.level}`);

    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60).toString().padStart(2, '0');
    ctx.save();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${minutes}:${seconds}`, canvas.width / 2, 26);
    ctx.textAlign = 'right';
    ctx.fillText(`☠ ${kills}`, canvas.width - pad, 26);
    ctx.restore();

    let wx = pad;
    const iconY = canvas.height - pad - 40;
    ctx.save();
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    for (const w of weapons) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(wx, iconY, 90, 36);
      ctx.fillStyle = '#fff';
      ctx.fillText(w.name, wx + 5, iconY + 14);
      ctx.fillStyle = '#aaa';
      ctx.fillText(`Lv.${w.level}`, wx + 5, iconY + 28);
      wx += 98;
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
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = colorBg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = colorFill;
    ctx.fillRect(x, y, Math.round(w * fraction), h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + 4, y + h - 2);
    ctx.restore();
  }
}
