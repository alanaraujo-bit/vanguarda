/**
 * HUDScene.ts — Interface de batalha (scene paralela à GameScene).
 * Responsável por: cartas de invocação (toque e arrastar), energia,
 * barras das bases, cronômetro, anúncios, pausa e dicas de treino.
 * Toda comunicação com a partida passa pelo bus ou pela API pública
 * da GameScene — a HUD nunca toca nas entidades diretamente.
 */
import Phaser from 'phaser';
import type { MatchConfig, UnitKey } from '../core/types';
import {
  COLORS,
  CSS,
  DEPTH,
  FONT,
  GAME_HEIGHT,
  GAME_WIDTH,
  LANE_YS,
  MATCH_DURATION,
  hex,
} from '../config/constants';
import { UNIT_DEFS, UNIT_ORDER } from '../config/units';
import { Evt, subscribe } from '../core/events';
import { AudioEngine } from '../audio/AudioEngine';
import { SaveManager } from '../core/SaveManager';
import { skinById } from '../config/progression';
import { TextureFactory } from '../gfx/TextureFactory';
import { UiButton, drawPanel, makeText } from '../ui/widgets';
import type { GameScene } from './GameScene';

const CARD_W = 88;
const CARD_H = 112;
const CARD_Y = GAME_HEIGHT - 62;
const FIELD_TOP = 150;
const FIELD_BOTTOM = GAME_HEIGHT - 124;

const TRAINING_TIPS = [
  'Toque numa carta e depois numa faixa para invocar.',
  'Você também pode ARRASTAR a carta até a faixa.',
  'Enxames derretem tanques como o Bastião e o Titã.',
  'O Trovão limpa grupos inteiros com dano em área.',
  'A Lâmina caça atiradores e artilharia rapidamente.',
  'O Lúmen cura o aliado mais ferido ao seu alcance.',
  'Guarde energia para responder aos avanços inimigos.',
  'A torreta da sua base defende sozinha o alcance curto.',
];

interface CardView {
  key: UnitKey;
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  costText: Phaser.GameObjects.Text;
  x: number;
}

export class HUDScene extends Phaser.Scene {
  private game_!: GameScene;
  private config!: MatchConfig;
  private playerColor: number = COLORS.player;

  private cards: CardView[] = [];
  private selected: UnitKey | null = null;
  private dragGhost: Phaser.GameObjects.Image | null = null;
  private dragging = false;
  private downPos = new Phaser.Math.Vector2();
  private laneHighlights: Phaser.GameObjects.Rectangle[] = [];

  private energyBar!: Phaser.GameObjects.Graphics;
  private energyText!: Phaser.GameObjects.Text;
  private lastEnergyDrawn = -1;
  private overdrive = false;

  private playerHpBar!: Phaser.GameObjects.Graphics;
  private enemyHpBar!: Phaser.GameObjects.Graphics;
  private playerHpPct = 1;
  private enemyHpPct = 1;

  private timerText!: Phaser.GameObjects.Text;
  private announceText!: Phaser.GameObjects.Text;
  private fpsText: Phaser.GameObjects.Text | null = null;
  private pausePanel!: Phaser.GameObjects.Container;
  private paused = false;
  private matchOver = false;

  constructor() {
    super('Hud');
  }

  init(data: MatchConfig): void {
    this.config = data;
    this.cards = [];
    this.selected = null;
    this.dragGhost = null;
    this.dragging = false;
    this.laneHighlights = [];
    this.lastEnergyDrawn = -1;
    this.overdrive = false;
    this.playerHpPct = 1;
    this.enemyHpPct = 1;
    this.paused = false;
    this.matchOver = false;
    this.fpsText = null;
  }

  create(): void {
    this.game_ = this.scene.get('Game') as GameScene;
    this.playerColor = skinById(SaveManager.data.skin).color;

    this.buildLaneHighlights();
    this.buildTopBar();
    this.buildEnergyBar();
    this.buildCards();
    this.buildAnnounce();
    this.buildPausePanel();
    if (this.config.mode === 'training') this.buildTips();
    if (SaveManager.settings.showFps) {
      this.fpsText = makeText(this, GAME_WIDTH - 12, GAME_HEIGHT - 20, '', 13, CSS.textDim)
        .setOrigin(1, 0.5)
        .setDepth(DEPTH.announce);
    }

    /* ------------------------------ Eventos do jogo ---------------------------- */
    subscribe(this, Evt.BaseHp, (team: 'player' | 'enemy', hp: number, max: number) => {
      if (team === 'player') this.playerHpPct = hp / max;
      else this.enemyHpPct = hp / max;
      this.redrawHpBars();
    });
    subscribe(this, Evt.Timer, (sec: number) => this.updateTimer(sec));
    subscribe(this, Evt.Announce, (text: string, color?: number) => this.announce(text, color));
    subscribe(this, Evt.Overdrive, () => {
      this.overdrive = true;
    });
    subscribe(this, Evt.Wave, (wave: number) => {
      AudioEngine.play('wave');
      this.timerText.setText(`ONDA ${wave}`);
      this.announce(`ONDA ${wave}`, COLORS.enemy);
    });
    subscribe(this, Evt.MatchEnd, () => {
      this.matchOver = true;
      this.clearSelection();
    });

    /* ------------------------------ Entrada global ----------------------------- */
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointerUp(p));

    const kb = this.input.keyboard;
    if (kb) {
      const keys = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT'];
      keys.forEach((k, i) =>
        kb.on(`keydown-${k}`, () => this.toggleSelect(UNIT_ORDER[i]))
      );
      (['Q', 'W', 'E'] as const).forEach((k, lane) =>
        kb.on(`keydown-${k}`, () => this.deploySelected(lane))
      );
      kb.on('keydown-ESC', () => this.togglePause());
    }
  }

  update(): void {
    this.redrawEnergy();
    this.updateCardAffordability();
    if (this.fpsText) this.fpsText.setText(`${Math.round(this.game.loop.actualFps)} FPS`);
  }

  /* ------------------------------- Barra superior ---------------------------- */

  private buildTopBar(): void {
    const g = this.add.graphics().setDepth(DEPTH.announce - 10);
    g.fillStyle(COLORS.bgDeep, 0.55);
    g.fillRect(0, 0, GAME_WIDTH, 54);
    g.lineStyle(1, COLORS.uiStroke, 0.5);
    g.lineBetween(0, 54, GAME_WIDTH, 54);

    this.playerHpBar = this.add.graphics().setDepth(DEPTH.announce - 9);
    this.enemyHpBar = this.add.graphics().setDepth(DEPTH.announce - 9);
    makeText(this, 20, 10, SaveManager.data.name.toUpperCase(), 14, hex(this.playerColor));
    const rightLabel = this.config.mode === 'survival' ? 'PORTAL' : 'INIMIGO';
    makeText(this, GAME_WIDTH - 20, 10, rightLabel, 14, CSS.enemy).setOrigin(1, 0);
    this.redrawHpBars();

    // Cronômetro / contador central.
    const startLabel =
      this.config.mode === 'versus'
        ? this.formatTime(MATCH_DURATION)
        : this.config.mode === 'survival'
          ? 'ONDA 1'
          : 'TREINO';
    this.timerText = makeText(this, GAME_WIDTH / 2, 27, startLabel, 26)
      .setOrigin(0.5)
      .setDepth(DEPTH.announce - 8)
      .setLetterSpacing(2);

    // Botão de pausa.
    const pauseBtn = this.add
      .container(GAME_WIDTH - 40, 90)
      .setDepth(DEPTH.announce - 8)
      .setSize(52, 52)
      .setInteractive({ useHandCursor: true });
    const pbg = this.add.graphics();
    pbg.fillStyle(COLORS.uiPanel, 0.9);
    pbg.fillRoundedRect(-24, -24, 48, 48, 12);
    pbg.lineStyle(2, COLORS.uiStroke, 0.9);
    pbg.strokeRoundedRect(-24, -24, 48, 48, 12);
    pauseBtn.add([pbg, this.add.image(0, 0, 'icon-pause').setScale(0.8)]);
    pauseBtn.on('pointerup', () => this.togglePause());
  }

  private redrawHpBars(): void {
    const w = 350;
    const h = 16;
    const draw = (
      g: Phaser.GameObjects.Graphics,
      x: number,
      pct: number,
      color: number,
      rightAligned: boolean
    ) => {
      g.clear();
      g.fillStyle(0x0a0f22, 1);
      g.fillRoundedRect(x, 30, w, h, 8);
      const fillW = Math.max(6, w * Phaser.Math.Clamp(pct, 0, 1));
      g.fillStyle(color, 1);
      g.fillRoundedRect(rightAligned ? x + w - fillW : x, 30, fillW, h, 8);
      g.lineStyle(2, COLORS.uiStroke, 0.9);
      g.strokeRoundedRect(x, 30, w, h, 8);
    };
    draw(this.playerHpBar, 20, this.playerHpPct, this.playerColor, false);
    if (this.config.mode === 'survival') {
      draw(this.enemyHpBar, GAME_WIDTH - 20 - w, 1, 0x5a3a1a, true);
    } else {
      draw(this.enemyHpBar, GAME_WIDTH - 20 - w, this.enemyHpPct, COLORS.enemy, true);
    }
  }

  private formatTime(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  private updateTimer(sec: number): void {
    this.timerText.setText(this.formatTime(sec));
    if (this.overdrive) {
      this.timerText.setColor(CSS.energy);
    } else if (sec <= 30) {
      this.timerText.setColor(CSS.danger);
    }
    if (sec <= 10 && sec > 0) {
      this.tweens.add({ targets: this.timerText, scale: 1.25, duration: 120, yoyo: true });
    }
  }

  /* -------------------------------- Energia ---------------------------------- */

  private buildEnergyBar(): void {
    this.energyBar = this.add.graphics().setDepth(DEPTH.announce - 9);
    this.energyText = makeText(this, GAME_WIDTH / 2 + 262, GAME_HEIGHT - 132, '', 18, CSS.energy)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.announce - 8);
    this.add
      .image(GAME_WIDTH / 2 - 262, GAME_HEIGHT - 132, 'icon-energy')
      .setTint(COLORS.energy)
      .setDepth(DEPTH.announce - 8)
      .setOrigin(1, 0.5);
  }

  private redrawEnergy(): void {
    const e = this.game_.playerEnergy;
    // Evita redesenhar sem mudança visível (granularidade de 1/8 de célula).
    const quantized = Math.floor(e.current * 8);
    if (quantized === this.lastEnergyDrawn) return;
    this.lastEnergyDrawn = quantized;

    const segW = 46;
    const gap = 5;
    const total = e.max * segW + (e.max - 1) * gap;
    const x0 = GAME_WIDTH / 2 - total / 2;
    const y = GAME_HEIGHT - 142;
    const g = this.energyBar;
    g.clear();
    for (let i = 0; i < e.max; i++) {
      const x = x0 + i * (segW + gap);
      g.fillStyle(0x0a0f22, 0.9);
      g.fillRoundedRect(x, y, segW, 18, 6);
      const fill = Phaser.Math.Clamp(e.current - i, 0, 1);
      if (fill > 0) {
        g.fillStyle(this.overdrive ? 0xc59bff : COLORS.energy, 1);
        g.fillRoundedRect(x, y, Math.max(6, segW * fill), 18, 6);
      }
      g.lineStyle(1, COLORS.uiStroke, 0.8);
      g.strokeRoundedRect(x, y, segW, 18, 6);
    }
    this.energyText.setText(`${Math.floor(e.current)}/${e.max}`);
  }

  /* --------------------------------- Cartas ---------------------------------- */

  private buildCards(): void {
    const total = UNIT_ORDER.length * (CARD_W + 6) - 6;
    const x0 = GAME_WIDTH / 2 - total / 2 + CARD_W / 2;

    UNIT_ORDER.forEach((key, i) => {
      const def = UNIT_DEFS[key];
      const x = x0 + i * (CARD_W + 6);
      const container = this.add.container(x, CARD_Y).setDepth(DEPTH.announce - 5);
      const bg = this.add.graphics();
      container.add(bg);

      const tex = TextureFactory.unitTexture(key, this.playerColor);
      const src = this.textures.get(tex).getSourceImage() as HTMLImageElement;
      const scale = Math.min(1.1, 52 / Math.max(src.width, src.height));
      container.add(this.add.image(0, -18, tex).setScale(scale));

      container.add(
        this.add
          .text(0, 22, def.name, {
            fontFamily: FONT,
            fontSize: '13px',
            fontStyle: 'bold',
            color: CSS.text,
          })
          .setOrigin(0.5)
      );
      // Selo de custo.
      const costBg = this.add.graphics();
      costBg.fillStyle(COLORS.energy, 1);
      costBg.fillCircle(0, 42, 12);
      costBg.lineStyle(2, 0x0a0f22, 1);
      costBg.strokeCircle(0, 42, 12);
      container.add(costBg);
      const costText = this.add
        .text(0, 42, String(def.cost), {
          fontFamily: FONT,
          fontSize: '15px',
          fontStyle: 'bold',
          color: '#ffffff',
        })
        .setOrigin(0.5);
      container.add(costText);
      // Número do atalho de teclado.
      container.add(
        this.add
          .text(-CARD_W / 2 + 9, -CARD_H / 2 + 8, String(i + 1), {
            fontFamily: FONT,
            fontSize: '12px',
            color: CSS.textDim,
          })
          .setOrigin(0.5)
      );

      container.setSize(CARD_W, CARD_H);
      container.setInteractive({ useHandCursor: true });
      container.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (this.paused || this.matchOver) return;
        this.downPos.set(p.x, p.y);
        this.beginPress(key);
      });
      container.on('pointerover', () => AudioEngine.play('ui-hover'));

      const view: CardView = { key, container, bg, costText, x };
      this.cards.push(view);
      this.drawCard(view, false, true);
    });
  }

  private drawCard(view: CardView, selected: boolean, affordable: boolean): void {
    const g = view.bg;
    g.clear();
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(-CARD_W / 2 + 2, -CARD_H / 2 + 4, CARD_W, CARD_H, 14);
    g.fillStyle(selected ? 0x1c3a63 : COLORS.uiPanel, 0.97);
    g.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 14);
    g.lineStyle(2, selected ? this.playerColor : COLORS.uiStroke, selected ? 1 : 0.8);
    g.strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 14);
    view.container.setAlpha(affordable ? 1 : 0.45);
    view.costText.setColor(affordable ? '#ffffff' : CSS.danger);
  }

  private updateCardAffordability(): void {
    const e = this.game_.playerEnergy.current;
    for (const c of this.cards) {
      this.drawCard(c, this.selected === c.key, UNIT_DEFS[c.key].cost <= e);
    }
  }

  /* ------------------------- Seleção, arrasto e invocação --------------------- */

  private buildLaneHighlights(): void {
    for (const y of LANE_YS) {
      const r = this.add
        .rectangle(GAME_WIDTH / 2, y, GAME_WIDTH - 250, 92, this.playerColor, 0.08)
        .setStrokeStyle(2, this.playerColor, 0.35)
        .setVisible(false)
        .setDepth(DEPTH.lanes);
      this.laneHighlights.push(r);
    }
  }

  private showLanes(on: boolean, hotLane = -1): void {
    this.laneHighlights.forEach((r, i) => {
      r.setVisible(on);
      r.setFillStyle(this.playerColor, i === hotLane ? 0.2 : 0.07);
    });
  }

  private beginPress(key: UnitKey): void {
    // O gesto decide: soltar em cima da carta = toque (seleciona);
    // mover além do limiar = arrasto com fantasma.
    this.pressedKey = key;
    this.dragging = false;
  }

  private pressedKey: UnitKey | null = null;

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (this.paused || this.matchOver) return;
    if (this.pressedKey && !this.dragging && p.isDown) {
      if (Phaser.Math.Distance.Between(p.x, p.y, this.downPos.x, this.downPos.y) > 14) {
        this.dragging = true;
        this.selected = this.pressedKey;
        const tex = TextureFactory.unitTexture(this.pressedKey, this.playerColor);
        this.dragGhost = this.add
          .image(p.x, p.y, tex)
          .setAlpha(0.75)
          .setDepth(DEPTH.announce);
        this.showLanes(true);
      }
    }
    if (this.dragging && this.dragGhost) {
      this.dragGhost.setPosition(p.x, p.y);
      this.showLanes(true, this.laneAt(p.y));
    }
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (this.paused || this.matchOver) {
      this.pressedKey = null;
      return;
    }
    if (this.dragging) {
      // Fim do arrasto: solta na faixa (se estiver sobre o campo).
      const lane = this.laneAt(p.y);
      if (lane !== -1 && p.y > FIELD_TOP && p.y < FIELD_BOTTOM) {
        this.deploySelected(lane);
      }
      this.endDrag();
      this.pressedKey = null;
      return;
    }
    if (this.pressedKey) {
      // Toque na carta: alterna seleção.
      this.toggleSelect(this.pressedKey);
      this.pressedKey = null;
      return;
    }
    // Toque no campo com carta selecionada: invoca.
    if (this.selected && p.y > FIELD_TOP && p.y < FIELD_BOTTOM) {
      const lane = this.laneAt(p.y);
      if (lane !== -1) this.deploySelected(lane);
    }
  }

  private laneAt(y: number): number {
    let best = -1;
    let bestDist = 80;
    LANE_YS.forEach((laneY, i) => {
      const d = Math.abs(y - laneY);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  private toggleSelect(key: UnitKey): void {
    if (this.matchOver) return;
    AudioEngine.play('ui-click');
    this.selected = this.selected === key ? null : key;
    this.showLanes(this.selected !== null);
  }

  private deploySelected(lane: number): void {
    if (!this.selected || this.matchOver) return;
    const ok = this.game_.playerDeploy(this.selected, lane);
    if (ok) {
      // Mantém a seleção para invocações em sequência.
      this.showLanes(true);
    }
  }

  private clearSelection(): void {
    this.selected = null;
    this.showLanes(false);
    this.endDrag();
  }

  private endDrag(): void {
    this.dragging = false;
    this.dragGhost?.destroy();
    this.dragGhost = null;
    if (!this.selected) this.showLanes(false);
  }

  /* --------------------------------- Anúncios --------------------------------- */

  private buildAnnounce(): void {
    this.announceText = this.add
      .text(GAME_WIDTH / 2, 260, '', {
        fontFamily: FONT,
        fontSize: '54px',
        fontStyle: 'bold',
        color: CSS.text,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.announce)
      .setLetterSpacing(8)
      .setAlpha(0);
  }

  private announce(text: string, color = 0xffffff): void {
    this.tweens.killTweensOf(this.announceText);
    this.announceText
      .setText(text)
      .setColor(hex(color === 0xffffff ? 0xeaf6ff : color))
      .setShadow(0, 0, hex(color), 18, false, true)
      .setAlpha(0)
      .setScale(0.7);
    this.tweens.add({
      targets: this.announceText,
      alpha: 1,
      scale: 1,
      duration: 260,
      ease: Phaser.Math.Easing.Back.Out,
      onComplete: () => {
        this.tweens.add({
          targets: this.announceText,
          alpha: 0,
          y: 240,
          delay: 1100,
          duration: 420,
          onComplete: () => this.announceText.setY(260),
        });
      },
    });
  }

  /* ---------------------------------- Pausa ----------------------------------- */

  private buildPausePanel(): void {
    this.pausePanel = this.add.container(0, 0).setDepth(DEPTH.announce + 10).setVisible(false);
    const dim = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7)
      .setInteractive();
    const g = this.add.graphics();
    drawPanel(g, GAME_WIDTH / 2 - 220, 170, 440, 380, { radius: 22 });
    this.pausePanel.add([dim, g]);
    this.pausePanel.add(
      makeText(this, GAME_WIDTH / 2, 226, 'PAUSA', 36).setOrigin(0.5).setLetterSpacing(8)
    );
    this.pausePanel.add(
      new UiButton(this, GAME_WIDTH / 2, 306, 'CONTINUAR', {
        width: 330,
        onClick: () => this.togglePause(),
      })
    );
    this.pausePanel.add(
      new UiButton(this, GAME_WIDTH / 2, 380, 'CONFIGURAÇÕES', {
        width: 330,
        variant: 'ghost',
        onClick: () => this.scene.launch('Settings', { from: 'Hud' }),
      })
    );
    const quitLabel = this.config.mode === 'training' ? 'ENCERRAR TREINO' : 'ABANDONAR';
    this.pausePanel.add(
      new UiButton(this, GAME_WIDTH / 2, 480, quitLabel, {
        width: 330,
        variant: 'danger',
        onClick: () => this.quitToMenu(),
      })
    );
  }

  private togglePause(): void {
    if (this.matchOver) return;
    // Com o overlay de configurações aberto, o ESC pertence a ele.
    if (this.scene.isActive('Settings')) return;
    this.paused = !this.paused;
    this.clearSelection();
    this.pausePanel.setVisible(this.paused);
    AudioEngine.duck(this.paused);
    AudioEngine.play('ui-click');
    if (this.paused) this.scene.pause('Game');
    else this.scene.resume('Game');
  }

  private quitToMenu(): void {
    AudioEngine.duck(false);
    AudioEngine.stopMusic();
    this.scene.stop('Game');
    this.scene.start('Menu');
  }

  /* ---------------------------------- Dicas ----------------------------------- */

  private buildTips(): void {
    const tip = this.add
      .text(GAME_WIDTH / 2, 78, TRAINING_TIPS[0], {
        fontFamily: FONT,
        fontSize: '17px',
        color: CSS.gold,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.announce - 8);
    let idx = 0;
    this.time.addEvent({
      delay: 7000,
      loop: true,
      callback: () => {
        idx = (idx + 1) % TRAINING_TIPS.length;
        this.tweens.add({
          targets: tip,
          alpha: 0,
          duration: 250,
          onComplete: () => {
            tip.setText(TRAINING_TIPS[idx]);
            this.tweens.add({ targets: tip, alpha: 1, duration: 250 });
          },
        });
      },
    });
  }
}
