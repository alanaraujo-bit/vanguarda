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
} from '../../shared/constants';
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
import type { MatchRecord } from '../../shared/types';

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

    new UiButton(this, 74, 30, '← MENU', {
      width: 108,
      height: 38,
      fontSize: 14,
      variant: 'ghost',
      onClick: () => this.scene.start('Menu'),
    });
    makeText(this, GAME_WIDTH / 2, 78, 'PERFIL DO COMANDANTE', 24)
      .setOrigin(0.5)
      .setLetterSpacing(2);

    // Abas.
    const tabW = (GAME_WIDTH - 80 - 3 * 8) / 4;
    const total = TABS.length * (tabW + 8) - 8;
    TABS.forEach((tab, i) => {
      const btn = new UiButton(
        this,
        GAME_WIDTH / 2 - total / 2 + tabW / 2 + i * (tabW + 8),
        128,
        tab,
        {
          width: tabW,
          height: 44,
          fontSize: 13,
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
    const px = 40;
    const pw = GAME_WIDTH - 80;
    const top = 174;

    const g = this.add.graphics();
    drawPanel(g, px, top, pw, 170, { radius: 20 });
    this.content.add(g);

    // Medalhão de nível + identidade.
    g.fillStyle(COLORS.gold, 0.12);
    g.fillCircle(px + 55, top + 55, 40);
    g.lineStyle(3, COLORS.gold, 0.9);
    g.strokeCircle(px + 55, top + 55, 40);
    this.content.add(makeText(this, px + 55, top + 55, String(level), 34).setOrigin(0.5));
    this.content.add(makeText(this, px + 112, top + 28, p.name, 26));
    this.content.add(makeText(this, px + 112, top + 60, titleById(p.title).name, 17, CSS.gold));
    // Barra de XP.
    g.fillStyle(0x0a0f22, 1);
    g.fillRoundedRect(px + 30, top + 128, pw - 60, 14, 7);
    g.fillStyle(COLORS.gold, 1);
    g.fillRoundedRect(px + 30, top + 128, Math.max(8, (pw - 60) * (into / needed)), 14, 7);
    this.content.add(
      makeText(this, px + pw - 30, top + 114, `${into}/${needed} XP`, 13, CSS.textDim).setOrigin(1, 0)
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
    const cellW = (pw - 16) / 2;
    cells.forEach(([label, value], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = px + col * (cellW + 16);
      const y = top + 172 + row * 118;
      const cg = this.add.graphics();
      drawPanel(cg, x, y, cellW, 100, { radius: 16, fill: COLORS.uiPanelLight });
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
        182,
        `${unlocked.length} / ${ACHIEVEMENTS.length} desbloqueadas`,
        17,
        CSS.textDim
      ).setOrigin(0.5)
    );

    const achW = (GAME_WIDTH - 80 - 16) / 2;
    ACHIEVEMENTS.forEach((ach, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 40 + col * (achW + 16);
      const y = 214 + row * 164;
      const has = unlocked.includes(ach.id);

      const g = this.add.graphics();
      drawPanel(g, x, y, achW, 148, {
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

    const gridTop = 214;
    this.content.add(makeText(this, 40, gridTop - 34, 'SKIN DAS UNIDADES', 20).setLetterSpacing(3));
    // 3 colunas — 5 skins cabem em 2 linhas (3 + 2).
    const skinCols = 3;
    const skinW = (GAME_WIDTH - 80 - (skinCols - 1) * 16) / skinCols;
    const skinH = 190;
    SKINS.forEach((skin, i) => {
      const col = i % skinCols;
      const row = Math.floor(i / skinCols);
      const x = 40 + col * (skinW + 16);
      const y = gridTop + row * (skinH + 16);
      const owned = level >= skin.level;
      const selected = p.skin === skin.id;

      const g = this.add.graphics();
      drawPanel(g, x, y, skinW, skinH, {
        radius: 18,
        stroke: selected ? skin.color : COLORS.uiStroke,
        fill: selected ? 0x14213f : COLORS.uiPanel,
      });
      this.content.add(g);

      const cx = x + skinW / 2;
      const preview = this.add
        .image(cx, y + 74, TextureFactory.unitTexture('faisca', skin.color))
        .setScale(1.35)
        .setAlpha(owned ? 1 : 0.35);
      this.content.add(preview);
      this.content.add(makeText(this, cx, y + 134, skin.name, 16).setOrigin(0.5));
      this.content.add(
        makeText(
          this,
          cx,
          y + 160,
          owned ? (selected ? 'EQUIPADA' : 'TOQUE PARA USAR') : `NÍVEL ${skin.level}`,
          13,
          owned ? (selected ? hex(skin.color) : CSS.textDim) : CSS.danger
        ).setOrigin(0.5)
      );

      const zone = this.add
        .zone(cx, y + skinH / 2, skinW, skinH)
        .setInteractive({ useHandCursor: owned });
      zone.on('pointerup', () => {
        if (!owned || selected) return;
        SaveManager.setSkin(skin.id);
        AudioEngine.play('achievement');
        this.showTab('PERSONALIZAR');
      });
      this.content.add(zone);
    });

    // Linhas necessárias pras skins (5 itens / 3 colunas = 2 linhas).
    const skinRows = Math.ceil(SKINS.length / skinCols);
    const titlesY = gridTop + skinRows * (skinH + 16) + 40;
    this.content.add(makeText(this, 40, titlesY, 'TÍTULO', 20).setLetterSpacing(3));
    const titleW = GAME_WIDTH - 80;
    TITLES.forEach((title, i) => {
      const x = 40;
      const y = titlesY + 34 + i * 74;
      const owned = level >= title.level;
      const selected = p.title === title.id;

      const g = this.add.graphics();
      drawPanel(g, x, y, titleW, 62, {
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
          x + titleW - 22,
          y + 31,
          owned ? (selected ? 'EM USO' : 'USAR') : `NÍVEL ${title.level}`,
          13,
          owned ? (selected ? CSS.gold : CSS.textDim) : CSS.danger
        ).setOrigin(1, 0.5)
      );
      const zone = this.add
        .zone(x + titleW / 2, y + 31, titleW, 62)
        .setInteractive({ useHandCursor: owned });
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
    const listTop = 214;
    this.content.add(makeText(this, 40, listTop - 24, 'MISSÕES DE HOJE', 20).setLetterSpacing(3));
    const missions = SaveManager.todaysMissions();
    const mx = 40;
    const mw = GAME_WIDTH - 80;
    const mh = 120;
    missions.forEach((m, i) => {
      const y = listTop + i * (mh + 16);
      const g = this.add.graphics();
      drawPanel(g, mx, y, mw, mh, {
        radius: 16,
        stroke: m.claimed ? COLORS.success : COLORS.uiStroke,
        fill: m.claimed ? 0x14261a : COLORS.uiPanel,
      });
      this.content.add(g);
      this.content.add(makeText(this, mx + 22, y + 18, m.def.desc, 18));
      this.content.add(
        makeText(this, mx + 22, y + 46, `Recompensa: +${m.def.rewardXp} XP`, 14, CSS.gold)
      );
      const barW = mw - 140;
      const pct = Math.min(1, m.progress / m.def.target);
      g.fillStyle(0x0a0f22, 1);
      g.fillRoundedRect(mx + 22, y + 80, barW, 12, 6);
      g.fillStyle(m.claimed ? COLORS.success : COLORS.player, 1);
      g.fillRoundedRect(mx + 22, y + 80, Math.max(8, barW * pct), 12, 6);
      this.content.add(
        makeText(
          this,
          mx + mw - 22,
          y + 64,
          m.claimed ? 'CONCLUÍDA' : `${Math.min(m.progress, m.def.target)}/${m.def.target}`,
          13,
          m.claimed ? CSS.success : CSS.textDim
        ).setOrigin(1, 0.5)
      );
    });

    const historyY = listTop + missions.length * (mh + 16) + 40;
    this.content.add(makeText(this, 40, historyY, 'HISTÓRICO RECENTE', 20).setLetterSpacing(3));
    const history = SaveManager.data.history.slice(0, 6);
    if (history.length === 0) {
      this.content.add(
        makeText(this, GAME_WIDTH / 2, historyY + 120, 'Nenhuma partida registrada ainda. Vá à luta!', 18, CSS.textDim)
          .setOrigin(0.5)
      );
      return;
    }
    const rowH = 64;
    history.forEach((rec, i) => {
      const y = historyY + 36 + i * (rowH + 8);
      const g = this.add.graphics();
      drawPanel(g, mx, y, mw, rowH, { radius: 12, fill: COLORS.uiPanelLight });
      this.content.add(g);
      const { label, color } = this.outcomeBadge(rec);
      this.content.add(makeText(this, mx + 22, y + 12, `${label} · ${this.modeLabel(rec)}`, 16, color));
      const d = new Date(rec.date);
      const dateStr = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      const timeStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      this.content.add(
        makeText(
          this,
          mx + 22,
          y + 38,
          `${rec.kills} abates · +${rec.xpGained} XP · ${dateStr} ${timeStr}`,
          14,
          CSS.textDim
        )
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
