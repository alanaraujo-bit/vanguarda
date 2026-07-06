/**
 * ProfileScene.ts — Perfil do comandante.
 * Abas: Estatísticas, Conquistas, Personalizar (skins/títulos) e
 * Missões diárias + histórico de partidas.
 */
import Phaser from 'phaser';
import {
  COLORS,
  CSS,
  FONT,
  GAME_HEIGHT,
  GAME_WIDTH,
  hex,
} from '../config/constants';
import { SaveManager } from '../core/SaveManager';
import {
  ACHIEVEMENTS,
  DIFFICULTIES,
  levelFromXp,
  SKINS,
  TITLES,
  titleById,
  xpIntoLevel,
} from '../config/progression';
import { TextureFactory } from '../gfx/TextureFactory';
import { AudioEngine } from '../audio/AudioEngine';
import { UiButton, drawPanel, makeText } from '../ui/widgets';
import type { MatchRecord } from '../core/types';

const TABS = ['ESTATÍSTICAS', 'CONQUISTAS', 'PERSONALIZAR', 'MISSÕES'] as const;
type Tab = (typeof TABS)[number];

export class ProfileScene extends Phaser.Scene {
  private content!: Phaser.GameObjects.Container;
  private tabButtons = new Map<Tab, UiButton>();

  constructor() {
    super('Profile');
  }

  create(): void {
    // Pré-gera texturas de todas as skins (para os previews).
    for (const skin of SKINS) TextureFactory.ensureTeam(this, skin.color);

    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'arena').setAlpha(0.35);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bgDeep, 0.6);

    new UiButton(this, 96, 42, '← MENU', {
      width: 150,
      height: 46,
      fontSize: 17,
      variant: 'ghost',
      onClick: () => this.scene.start('Menu'),
    });
    makeText(this, GAME_WIDTH / 2, 42, 'PERFIL DO COMANDANTE', 30)
      .setOrigin(0.5)
      .setLetterSpacing(5);

    // Abas.
    const tabW = 230;
    const total = TABS.length * (tabW + 12) - 12;
    TABS.forEach((tab, i) => {
      const btn = new UiButton(
        this,
        GAME_WIDTH / 2 - total / 2 + tabW / 2 + i * (tabW + 12),
        104,
        tab,
        {
          width: tabW,
          height: 44,
          fontSize: 16,
          variant: 'ghost',
          onClick: () => this.showTab(tab),
        }
      );
      this.tabButtons.set(tab, btn);
    });

    this.content = this.add.container(0, 0);
    this.showTab('ESTATÍSTICAS');
    this.cameras.main.fadeIn(300, 5, 7, 15);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Menu'));
  }

  private showTab(tab: Tab): void {
    this.tabButtons.forEach((btn, key) => btn.setAlpha(key === tab ? 1 : 0.55));
    this.content.removeAll(true);
    switch (tab) {
      case 'ESTATÍSTICAS':
        this.buildStats();
        break;
      case 'CONQUISTAS':
        this.buildAchievements();
        break;
      case 'PERSONALIZAR':
        this.buildCustomize();
        break;
      case 'MISSÕES':
        this.buildMissions();
        break;
    }
  }

  /* ------------------------------- Estatísticas ------------------------------- */

  private buildStats(): void {
    const p = SaveManager.data;
    const level = levelFromXp(p.xp);
    const { into, needed } = xpIntoLevel(p.xp);

    const g = this.add.graphics();
    drawPanel(g, 140, 150, 1000, 130, { radius: 20 });
    this.content.add(g);

    // Medalhão de nível + identidade.
    g.fillStyle(COLORS.gold, 0.12);
    g.fillCircle(230, 215, 44);
    g.lineStyle(3, COLORS.gold, 0.9);
    g.strokeCircle(230, 215, 44);
    this.content.add(makeText(this, 230, 215, String(level), 38).setOrigin(0.5));
    this.content.add(makeText(this, 300, 178, p.name, 30));
    this.content.add(makeText(this, 300, 216, titleById(p.title).name, 18, CSS.gold));
    // Barra de XP.
    g.fillStyle(0x0a0f22, 1);
    g.fillRoundedRect(300, 248, 700, 14, 7);
    g.fillStyle(COLORS.gold, 1);
    g.fillRoundedRect(300, 248, Math.max(8, 700 * (into / needed)), 14, 7);
    this.content.add(
      makeText(this, 1010, 255, `${into}/${needed} XP`, 14, CSS.textDim).setOrigin(0, 0.5)
    );

    const s = p.stats;
    const winRate = s.matches > 0 ? `${Math.round((s.wins / s.matches) * 100)}%` : '—';
    const hours = Math.floor(s.playSeconds / 3600);
    const mins = Math.floor((s.playSeconds % 3600) / 60);
    const cells: [string, string][] = [
      ['Partidas', String(s.matches)],
      ['Vitórias', String(s.wins)],
      ['Derrotas', String(s.losses)],
      ['Taxa de vitória', winRate],
      ['Dano total', s.totalDamage.toLocaleString('pt-BR')],
      ['Abates', String(s.totalKills)],
      ['Invocações', String(s.totalDeploys)],
      ['Melhor onda', s.bestWave > 0 ? String(s.bestWave) : '—'],
      ['Tempo em batalha', hours > 0 ? `${hours}h ${mins}m` : `${mins}m`],
    ];
    cells.forEach(([label, value], i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 140 + col * 342;
      const y = 306 + row * 118;
      const cg = this.add.graphics();
      drawPanel(cg, x, y, 316, 100, { radius: 16, fill: COLORS.uiPanelLight });
      this.content.add(cg);
      this.content.add(makeText(this, x + 24, y + 20, label.toUpperCase(), 14, CSS.textDim));
      this.content.add(makeText(this, x + 24, y + 46, value, 30));
    });
  }

  /* -------------------------------- Conquistas -------------------------------- */

  private buildAchievements(): void {
    const unlocked = SaveManager.data.achievements;
    this.content.add(
      makeText(
        this,
        GAME_WIDTH / 2,
        158,
        `${unlocked.length} / ${ACHIEVEMENTS.length} desbloqueadas`,
        17,
        CSS.textDim
      ).setOrigin(0.5)
    );

    ACHIEVEMENTS.forEach((ach, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const x = 62 + col * 292;
      const y = 190 + row * 164;
      const has = unlocked.includes(ach.id);

      const g = this.add.graphics();
      drawPanel(g, x, y, 270, 148, {
        radius: 16,
        fill: has ? 0x1c2b16 : COLORS.uiPanel,
        stroke: has ? COLORS.success : COLORS.uiStroke,
      });
      this.content.add(g);

      const icon = this.add
        .image(x + 40, y + 44, `icon-${ach.icon}`)
        .setScale(1.5)
        .setTint(has ? COLORS.gold : 0x3a4a70);
      this.content.add(icon);
      this.content.add(
        makeText(this, x + 76, y + 22, ach.name, 18, has ? CSS.text : CSS.textDim)
      );
      this.content.add(
        this.add.text(x + 76, y + 50, ach.desc, {
          fontFamily: FONT,
          fontSize: '13px',
          color: CSS.textDim,
          wordWrap: { width: 180 },
        })
      );
      this.content.add(
        makeText(this, x + 24, y + 116, has ? 'DESBLOQUEADA' : 'BLOQUEADA', 13,
          has ? CSS.success : CSS.danger)
      );
    });
  }

  /* ------------------------------- Personalizar ------------------------------- */

  private buildCustomize(): void {
    const p = SaveManager.data;
    const level = levelFromXp(p.xp);

    this.content.add(makeText(this, 80, 156, 'SKIN DAS UNIDADES', 20).setLetterSpacing(3));
    SKINS.forEach((skin, i) => {
      const x = 80 + i * 232;
      const y = 190;
      const owned = level >= skin.level;
      const selected = p.skin === skin.id;

      const g = this.add.graphics();
      drawPanel(g, x, y, 210, 190, {
        radius: 18,
        stroke: selected ? skin.color : COLORS.uiStroke,
        fill: selected ? 0x14213f : COLORS.uiPanel,
      });
      this.content.add(g);

      const preview = this.add
        .image(x + 105, y + 74, TextureFactory.unitTexture('faisca', skin.color))
        .setScale(1.35)
        .setAlpha(owned ? 1 : 0.35);
      this.content.add(preview);
      this.content.add(makeText(this, x + 105, y + 134, skin.name, 16).setOrigin(0.5));
      this.content.add(
        makeText(
          this,
          x + 105,
          y + 160,
          owned ? (selected ? 'EQUIPADA' : 'TOQUE PARA USAR') : `NÍVEL ${skin.level}`,
          13,
          owned ? (selected ? hex(skin.color) : CSS.textDim) : CSS.danger
        ).setOrigin(0.5)
      );

      const zone = this.add
        .zone(x + 105, y + 95, 210, 190)
        .setInteractive({ useHandCursor: owned });
      zone.on('pointerup', () => {
        if (!owned || selected) return;
        SaveManager.setSkin(skin.id);
        AudioEngine.play('achievement');
        this.showTab('PERSONALIZAR');
      });
      this.content.add(zone);
    });

    this.content.add(makeText(this, 80, 420, 'TÍTULO', 20).setLetterSpacing(3));
    TITLES.forEach((title, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = 80 + col * 380;
      const y = 470 + row * 78;
      const owned = level >= title.level;
      const selected = p.title === title.id;

      const g = this.add.graphics();
      drawPanel(g, x, y, 356, 62, {
        radius: 14,
        stroke: selected ? COLORS.gold : COLORS.uiStroke,
        fill: selected ? 0x2b2412 : COLORS.uiPanel,
      });
      this.content.add(g);
      this.content.add(
        makeText(this, x + 22, y + 18, title.name, 19, owned ? CSS.text : CSS.textDim)
      );
      this.content.add(
        makeText(
          this,
          x + 334,
          y + 31,
          owned ? (selected ? 'EM USO' : 'USAR') : `NÍVEL ${title.level}`,
          13,
          owned ? (selected ? CSS.gold : CSS.textDim) : CSS.danger
        ).setOrigin(1, 0.5)
      );
      const zone = this.add.zone(x + 178, y + 31, 356, 62).setInteractive({ useHandCursor: owned });
      zone.on('pointerup', () => {
        if (!owned || selected) return;
        SaveManager.setTitle(title.id);
        AudioEngine.play('ui-click');
        this.showTab('PERSONALIZAR');
      });
      this.content.add(zone);
    });
  }

  /* --------------------------- Missões + histórico ---------------------------- */

  private buildMissions(): void {
    this.content.add(makeText(this, 80, 150, 'MISSÕES DE HOJE', 20).setLetterSpacing(3));
    const missions = SaveManager.todaysMissions();
    missions.forEach((m, i) => {
      const x = 80 + i * 380;
      const y = 186;
      const g = this.add.graphics();
      drawPanel(g, x, y, 356, 120, {
        radius: 16,
        stroke: m.claimed ? COLORS.success : COLORS.uiStroke,
        fill: m.claimed ? 0x14261a : COLORS.uiPanel,
      });
      this.content.add(g);
      this.content.add(makeText(this, x + 22, y + 18, m.def.desc, 18));
      this.content.add(
        makeText(this, x + 22, y + 46, `Recompensa: +${m.def.rewardXp} XP`, 14, CSS.gold)
      );
      const pct = Math.min(1, m.progress / m.def.target);
      g.fillStyle(0x0a0f22, 1);
      g.fillRoundedRect(x + 22, y + 80, 312, 12, 6);
      g.fillStyle(m.claimed ? COLORS.success : COLORS.player, 1);
      g.fillRoundedRect(x + 22, y + 80, Math.max(8, 312 * pct), 12, 6);
      this.content.add(
        makeText(
          this,
          x + 334,
          y + 64,
          m.claimed ? 'CONCLUÍDA' : `${Math.min(m.progress, m.def.target)}/${m.def.target}`,
          13,
          m.claimed ? CSS.success : CSS.textDim
        ).setOrigin(1, 0.5)
      );
    });

    this.content.add(makeText(this, 80, 336, 'HISTÓRICO RECENTE', 20).setLetterSpacing(3));
    const history = SaveManager.data.history.slice(0, 6);
    if (history.length === 0) {
      this.content.add(
        makeText(this, GAME_WIDTH / 2, 470, 'Nenhuma partida registrada ainda. Vá à luta!', 18, CSS.textDim)
          .setOrigin(0.5)
      );
      return;
    }
    history.forEach((rec, i) => {
      const y = 376 + i * 56;
      const g = this.add.graphics();
      drawPanel(g, 80, y, 1120, 48, { radius: 12, fill: COLORS.uiPanelLight });
      this.content.add(g);
      const { label, color } = this.outcomeBadge(rec);
      this.content.add(makeText(this, 104, y + 14, label, 16, color));
      this.content.add(makeText(this, 250, y + 14, this.modeLabel(rec), 16, CSS.text));
      this.content.add(
        makeText(this, 660, y + 14, `${rec.kills} abates`, 15, CSS.textDim)
      );
      this.content.add(makeText(this, 820, y + 14, `+${rec.xpGained} XP`, 15, CSS.gold));
      const d = new Date(rec.date);
      const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const timeStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      this.content.add(
        makeText(this, 1176, y + 24, `${dateStr} ${timeStr}`, 14, CSS.textDim).setOrigin(1, 0.5)
      );
    });
  }

  private outcomeBadge(rec: MatchRecord): { label: string; color: string } {
    if (rec.outcome === 'win') return { label: 'VITÓRIA', color: CSS.success };
    if (rec.outcome === 'draw') return { label: 'EMPATE', color: CSS.gold };
    return { label: 'DERROTA', color: CSS.danger };
  }

  private modeLabel(rec: MatchRecord): string {
    if (rec.mode === 'survival') return `Sobrevivência — onda ${rec.wave ?? 0}`;
    if (rec.mode === 'versus') {
      return `Contra IA (${rec.difficulty ? DIFFICULTIES[rec.difficulty].label : 'Normal'})`;
    }
    return 'Treinamento';
  }
}
