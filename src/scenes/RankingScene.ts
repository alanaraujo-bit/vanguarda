/**
 * RankingScene.ts — Ranking Global: troféus, vitórias ranqueadas e XP de
 * conta, com todas as contas vinculadas (ver server/src/routes/leaderboard.ts).
 * Reaproveita o padrão de abas/painéis de ProfileScene; a novidade é a lista
 * rolável (UiScrollList) pra caber um top 50 numa tela só.
 */
import Phaser from 'phaser';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH } from '../../shared/constants';
import { levelFromXp } from '../config/progression';
import { rankForTrophies } from '../../shared/ranks';
import { SessionManager } from '../net/SessionManager';
import { UiButton, UiScrollList, drawPanel, makeText } from '../ui/widgets';
import type { LeaderboardEntry, LeaderboardResponse, LeaderboardSort } from '../../shared/netProtocol';

const TABS: { sort: LeaderboardSort; label: string }[] = [
  { sort: 'trophies', label: 'TROFÉUS' },
  { sort: 'wins', label: 'VITÓRIAS (RANQ.)' },
  { sort: 'xp', label: 'XP' },
];

const MEDAL_COLORS: Record<number, number> = { 1: 0xffd54f, 2: 0xd7dde8, 3: 0xd08a4c };
const TOP = 174;
const BOTTOM_MARGIN = 40;
const ROW_H = 68;
const ROW_GAP = 10;
const FOOTER_H = 88;

export class RankingScene extends Phaser.Scene {
  private content!: Phaser.GameObjects.Container;
  private tabButtons = new Map<LeaderboardSort, UiButton>();
  private currentSort: LeaderboardSort = 'trophies';
  private requestSeq = 0;

  constructor() {
    super('Ranking');
  }

  create(): void {
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'arena').setAlpha(0.35);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bgDeep, 0.6);

    new UiButton(this, 74, 30, '← MENU', {
      width: 108,
      height: 38,
      fontSize: 14,
      variant: 'ghost',
      onClick: () => this.scene.start('Menu'),
    });
    makeText(this, GAME_WIDTH / 2, 78, 'RANKING GLOBAL', 24).setOrigin(0.5).setLetterSpacing(2);

    const tabW = (GAME_WIDTH - 80 - 2 * 8) / 3;
    const total = TABS.length * (tabW + 8) - 8;
    TABS.forEach(({ sort, label }, i) => {
      const btn = new UiButton(
        this,
        GAME_WIDTH / 2 - total / 2 + tabW / 2 + i * (tabW + 8),
        128,
        label,
        {
          width: tabW,
          height: 44,
          fontSize: 12,
          variant: 'ghost',
          onClick: () => this.selectTab(sort, true),
        }
      );
      this.tabButtons.set(sort, btn);
    });

    this.content = this.add.container(0, 0);
    this.selectTab('trophies', true);
    this.cameras.main.fadeIn(300, 5, 7, 15);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Menu'));
  }

  private selectTab(sort: LeaderboardSort, force: boolean): void {
    if (!force && sort === this.currentSort) return;
    this.currentSort = sort;
    this.tabButtons.forEach((btn, key) => btn.setAlpha(key === sort ? 1 : 0.55));
    this.content.removeAll(true);
    this.content.add(
      makeText(this, GAME_WIDTH / 2, TOP + 40, 'Carregando…', 17, CSS.textDim).setOrigin(0.5)
    );

    const seq = ++this.requestSeq;
    SessionManager.fetchLeaderboard(sort)
      .then((res) => {
        if (seq !== this.requestSeq) return; // resposta de uma aba já trocada
        this.content.removeAll(true);
        this.renderLeaderboard(res);
      })
      .catch(() => {
        if (seq !== this.requestSeq) return;
        this.content.removeAll(true);
        this.renderError();
      });
  }

  private renderError(): void {
    this.content.add(
      makeText(
        this,
        GAME_WIDTH / 2,
        TOP + 60,
        'Não foi possível carregar o ranking agora.\nVerifique sua conexão.',
        16,
        CSS.textDim,
        'normal'
      )
        .setOrigin(0.5)
        .setAlign('center')
    );
    this.content.add(
      new UiButton(this, GAME_WIDTH / 2, TOP + 150, 'TENTAR NOVAMENTE', {
        width: 260,
        height: 48,
        fontSize: 15,
        variant: 'ghost',
        onClick: () => this.selectTab(this.currentSort, true),
      })
    );
  }

  private renderLeaderboard(res: LeaderboardResponse): void {
    const myId = SessionManager.profile?.userId;
    const iAmVisible = myId !== undefined && res.entries.some((e) => e.userId === myId);
    const showFooter = !SessionManager.isAuthenticated || (res.me !== null && !iAmVisible);
    const viewportH = GAME_HEIGHT - TOP - BOTTOM_MARGIN - (showFooter ? FOOTER_H + 16 : 0);
    const px = 40;
    const pw = GAME_WIDTH - 80;

    if (res.entries.length === 0) {
      this.content.add(
        makeText(this, GAME_WIDTH / 2, TOP + 60, 'Ninguém no ranking ainda — seja o primeiro!', 17, CSS.textDim)
          .setOrigin(0.5)
      );
      return;
    }

    const list = new UiScrollList(this, px, TOP, pw, viewportH);
    this.content.add(list);
    res.entries.forEach((entry, i) => {
      const row = this.buildRow(entry, pw, entry.userId === myId);
      row.setPosition(0, i * (ROW_H + ROW_GAP));
      list.content.add(row);
    });
    list.setContentHeight(res.entries.length * (ROW_H + ROW_GAP) - ROW_GAP);

    if (!showFooter) return;
    const footerY = TOP + viewportH + 16;
    if (SessionManager.isAuthenticated && res.me) {
      const row = this.buildRow(res.me, pw, true, 'SUA POSIÇÃO');
      row.setPosition(px, footerY);
      this.content.add(row);
    } else if (!SessionManager.isAuthenticated) {
      const g = this.add.graphics();
      drawPanel(g, px, footerY, pw, FOOTER_H, { radius: 16 });
      this.content.add(g);
      this.content.add(
        makeText(this, px + 24, footerY + FOOTER_H / 2, 'Conecte-se pra ver sua posição', 15, CSS.textDim, 'normal')
          .setOrigin(0, 0.5)
      );
      this.content.add(
        new UiButton(this, px + pw - 90, footerY + FOOTER_H / 2, 'CONECTAR', {
          width: 140,
          height: 42,
          fontSize: 13,
          variant: 'primary',
          onClick: () => this.scene.start('Auth'),
        })
      );
    }
  }

  private buildRow(
    entry: LeaderboardEntry,
    width: number,
    highlight: boolean,
    overrideLabel?: string
  ): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    const g = this.add.graphics();
    drawPanel(g, 0, 0, width, ROW_H, {
      radius: 14,
      stroke: highlight ? COLORS.gold : COLORS.uiStroke,
      fill: highlight ? 0x2b2412 : COLORS.uiPanelLight,
    });
    c.add(g);

    const medal = MEDAL_COLORS[entry.rank];
    const badgeX = 42;
    g.fillStyle(medal ?? COLORS.uiPanel, medal ? 0.9 : 0.5);
    g.fillCircle(badgeX, ROW_H / 2, 24);
    g.lineStyle(2, medal ?? COLORS.uiStroke, 1);
    g.strokeCircle(badgeX, ROW_H / 2, 24);
    c.add(
      makeText(this, badgeX, ROW_H / 2, `#${entry.rank}`, medal ? 15 : 14, medal ? '#1a1206' : CSS.textDim)
        .setOrigin(0.5)
    );

    const nameX = badgeX + 42;
    c.add(makeText(this, nameX, ROW_H / 2 - 15, overrideLabel ?? entry.displayName, 17).setOrigin(0, 0.5));
    c.add(
      makeText(this, nameX, ROW_H / 2 + 14, this.subtitleFor(entry), 12, CSS.textDim, 'normal').setOrigin(0, 0.5)
    );

    const { value, unit } = this.valueFor(entry);
    c.add(makeText(this, width - 24, ROW_H / 2 - 10, value, 20, CSS.gold).setOrigin(1, 0.5));
    c.add(makeText(this, width - 24, ROW_H / 2 + 14, unit, 11, CSS.textDim, 'normal').setOrigin(1, 0.5));

    return c;
  }

  private subtitleFor(entry: LeaderboardEntry): string {
    if (this.currentSort === 'xp') return `Nível ${levelFromXp(entry.xp)}`;
    if (this.currentSort === 'wins') return `${entry.wins}V ${entry.losses}D ${entry.draws}E`;
    return rankForTrophies(entry.trophies).name;
  }

  private valueFor(entry: LeaderboardEntry): { value: string; unit: string } {
    if (this.currentSort === 'xp') return { value: entry.xp.toLocaleString('pt-BR'), unit: 'XP' };
    if (this.currentSort === 'wins') return { value: String(entry.wins), unit: 'VITÓRIAS' };
    return { value: entry.trophies.toLocaleString('pt-BR'), unit: 'TROFÉUS' };
  }
}
