/**
 * ResultScene.ts — Tela de fim de partida (overlay sobre o campo).
 * Banner de vitória/derrota, estatísticas, barra de XP animada com
 * level-up, e desfile de desbloqueios (conquistas, missões, skins, títulos).
 */
import Phaser from 'phaser';
import type { MatchSummary } from '../core/types';
import { COLORS, CSS, FONT, GAME_HEIGHT, GAME_WIDTH, hex } from '../config/constants';
import { AudioEngine } from '../audio/AudioEngine';
import {
  ACHIEVEMENTS,
  MISSION_POOL,
  levelFromXp,
  skinById,
  titleById,
  xpIntoLevel,
} from '../config/progression';
import { UiButton, drawPanel, makeText } from '../ui/widgets';

export class ResultScene extends Phaser.Scene {
  private summary!: MatchSummary;

  constructor() {
    super('Result');
  }

  init(data: MatchSummary): void {
    this.summary = data;
  }

  create(): void {
    const s = this.summary;
    const isTraining = s.config.mode === 'training';
    const isSurvival = s.config.mode === 'survival';

    AudioEngine.duck(true);
    AudioEngine.play(s.outcome === 'win' ? 'victory' : isTraining ? 'ui-click' : 'defeat');

    this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.72)
      .setInteractive();

    /* --------------------------------- Banner --------------------------------- */
    const bannerText = isTraining
      ? 'TREINO ENCERRADO'
      : isSurvival
        ? `ONDA ${s.record?.wave ?? 0} ALCANÇADA`
        : s.outcome === 'win'
          ? 'VITÓRIA'
          : s.outcome === 'draw'
            ? 'EMPATE'
            : 'DERROTA';
    const bannerColor = s.outcome === 'win' ? COLORS.success : isTraining || isSurvival ? COLORS.gold : s.outcome === 'draw' ? COLORS.gold : COLORS.danger;

    const banner = this.add
      .text(GAME_WIDTH / 2, 110, bannerText, {
        fontFamily: FONT,
        fontSize: '68px',
        fontStyle: 'bold',
        color: hex(bannerColor),
      })
      .setOrigin(0.5)
      .setLetterSpacing(10)
      .setShadow(0, 0, hex(bannerColor), 26, false, true)
      .setScale(0.4)
      .setAlpha(0);
    this.tweens.add({
      targets: banner,
      scale: 1,
      alpha: 1,
      duration: 450,
      ease: Phaser.Math.Easing.Back.Out,
    });

    // Confete na vitória.
    if (s.outcome === 'win') {
      this.add.particles(0, 0, 'p-square', {
        x: { min: 0, max: GAME_WIDTH },
        y: -12,
        speedY: { min: 120, max: 260 },
        speedX: { min: -40, max: 40 },
        rotate: { min: 0, max: 360 },
        scale: { start: 1.4, end: 0.6 },
        lifespan: 4200,
        quantity: 2,
        frequency: 90,
        tint: [COLORS.success, COLORS.gold, COLORS.player, 0xffffff],
      });
    }

    /* ------------------------------ Estatísticas ------------------------------ */
    const g = this.add.graphics();
    drawPanel(g, GAME_WIDTH / 2 - 300, 170, 600, 176, { radius: 20 });
    const rows: [string, string][] = [
      ['Dano causado', String(Math.round(s.record?.damageDealt ?? 0))],
      ['Abates', String(s.record?.kills ?? 0)],
      ['Invocações', String(s.record?.deploys ?? 0)],
      [
        'Duração',
        `${Math.floor((s.record?.durationSec ?? 0) / 60)}m ${(s.record?.durationSec ?? 0) % 60}s`,
      ],
    ];
    rows.forEach(([label, value], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = GAME_WIDTH / 2 - 270 + col * 300;
      const y = 205 + row * 70;
      makeText(this, x, y, label.toUpperCase(), 14, CSS.textDim);
      makeText(this, x, y + 22, value, 26);
    });

    /* --------------------------------- XP bar --------------------------------- */
    if (!isTraining) {
      this.buildXpBar();
    } else {
      makeText(this, GAME_WIDTH / 2, 396, 'O treino não gera XP — vá à luta!', 18, CSS.textDim)
        .setOrigin(0.5);
    }

    /* ------------------------------ Desbloqueios ------------------------------- */
    this.showUnlocks();

    /* --------------------------------- Botões ---------------------------------- */
    new UiButton(this, GAME_WIDTH / 2 - 165, GAME_HEIGHT - 70, 'JOGAR NOVAMENTE', {
      width: 300,
      onClick: () => this.restart(),
    });
    new UiButton(this, GAME_WIDTH / 2 + 165, GAME_HEIGHT - 70, 'MENU', {
      width: 300,
      variant: 'ghost',
      onClick: () => this.toMenu(),
    });
  }

  private buildXpBar(): void {
    const s = this.summary;
    const y = 400;
    const w = 520;

    makeText(this, GAME_WIDTH / 2, y - 26, `+${s.record?.xpGained ?? 0} XP`, 22, CSS.gold)
      .setOrigin(0.5);
    const levelText = makeText(this, GAME_WIDTH / 2 - w / 2 - 34, y + 8, String(s.levelBefore), 26)
      .setOrigin(0.5);

    const bar = this.add.graphics();
    const drawBar = (xp: number) => {
      const lvl = levelFromXp(xp);
      const { into, needed } = xpIntoLevel(xp);
      levelText.setText(String(lvl));
      bar.clear();
      bar.fillStyle(0x0a0f22, 1);
      bar.fillRoundedRect(GAME_WIDTH / 2 - w / 2, y, w, 16, 8);
      bar.fillStyle(COLORS.gold, 1);
      bar.fillRoundedRect(GAME_WIDTH / 2 - w / 2, y, Math.max(8, w * (into / needed)), 16, 8);
      bar.lineStyle(2, COLORS.uiStroke, 1);
      bar.strokeRoundedRect(GAME_WIDTH / 2 - w / 2, y, w, 16, 8);
    };
    drawBar(s.xpBefore);

    let shownLevel = s.levelBefore;
    this.tweens.addCounter({
      from: s.xpBefore,
      to: s.xpAfter,
      duration: 1400,
      delay: 500,
      ease: Phaser.Math.Easing.Cubic.Out,
      onUpdate: (tw) => {
        const xp = tw.getValue() ?? s.xpAfter;
        drawBar(xp);
        const lvl = levelFromXp(xp);
        if (lvl > shownLevel) {
          shownLevel = lvl;
          AudioEngine.play('levelup');
          this.tweens.add({ targets: levelText, scale: 1.7, duration: 160, yoyo: true });
        }
      },
    });
  }

  /** Lista sequencial de tudo que foi desbloqueado nesta partida. */
  private showUnlocks(): void {
    const s = this.summary;
    const lines: { text: string; color: string }[] = [];
    for (const id of s.unlockedAchievements) {
      const a = ACHIEVEMENTS.find((x) => x.id === id);
      if (a) lines.push({ text: `🏅 Conquista: ${a.name}`, color: CSS.gold });
    }
    for (const id of s.completedMissions) {
      const m = MISSION_POOL.find((x) => x.id === id);
      if (m) lines.push({ text: `✔ Missão: ${m.desc} (+${m.rewardXp} XP)`, color: CSS.success });
    }
    for (const id of s.newSkins) {
      lines.push({ text: `★ Nova skin: ${skinById(id).name}`, color: CSS.player });
    }
    for (const id of s.newTitles) {
      lines.push({ text: `♦ Novo título: ${titleById(id).name}`, color: CSS.energy });
    }
    lines.slice(0, 5).forEach((line, i) => {
      const t = this.add
        .text(GAME_WIDTH / 2, 452 + i * 30, line.text, {
          fontFamily: FONT,
          fontSize: '18px',
          fontStyle: 'bold',
          color: line.color,
        })
        .setOrigin(0.5)
        .setAlpha(0);
      this.tweens.add({
        targets: t,
        alpha: 1,
        x: GAME_WIDTH / 2,
        delay: 1200 + i * 350,
        duration: 300,
        onStart: () => AudioEngine.play('achievement'),
      });
    });
  }

  private restart(): void {
    AudioEngine.duck(false);
    this.scene.stop('Hud');
    this.scene.stop('Game');
    this.scene.start('Game', this.summary.config);
  }

  private toMenu(): void {
    AudioEngine.duck(false);
    AudioEngine.stopMusic();
    this.scene.stop('Hud');
    this.scene.stop('Game');
    this.scene.start('Menu');
  }
}
