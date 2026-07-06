/**
 * HUDScene.ts — Interface de batalha (scene paralela à GameScene).
 * Responsável por: mão de cartas estilo Clash Royale (4 na mão + próxima,
 * deck ciclando a cada invocação), energia, barras das bases, cronômetro,
 * anúncios, pausa e dicas de treino.
 * Toda comunicação com a partida passa pelo bus ou pela API pública
 * da GameScene — a HUD nunca toca nas entidades diretamente.
 */
import Phaser from 'phaser';
import type { MatchConfig, UnitKey } from '../core/types';
import {
  COLORS,
  CSS,
  DEPTH,
  FIELD_BOTTOM,
  FIELD_TOP,
  FONT,
  GAME_HEIGHT,
  GAME_WIDTH,
  LANE_XS,
  MATCH_DURATION,
  UNIT_VISUAL_SCALE,
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

/* ------------------------------ Layout da bandeja ---------------------------
 * A bandeja ocupa o rodapé inteiro (estilo Clash Royale):
 *   [nome + HP do jogador]
 *   [PRÓXIMA]  [carta] [carta] [carta] [carta]
 *   [⚡ N  ▮▮▮▮▮▮▮▮▮▮]
 */
const TRAY_TOP = 1012;
const HAND_SIZE = 4;
const CARD_W = 138;
const CARD_H = 176;
const CARD_GAP = 8;
const HAND_X0 = 112;
const CARD_Y = 1140;
const NEXT_W = 84;
const NEXT_H = 108;
const NEXT_X = 54;
const NEXT_Y = 1174;
const ENERGY_Y = 1240;
const ENERGY_H = 28;
/** Barras de HP: X inicial compartilhado (topo e bandeja). */
const STATUS_BAR_X = 24;
const TOP_BAR_H = 110;

const TRAINING_TIPS = [
  'Toque numa carta e depois numa faixa para invocar.',
  'Você também pode ARRASTAR a carta até a faixa.',
  'Ao usar uma carta, a PRÓXIMA do deck entra na mão.',
  'Enxames derretem tanques como o Bastião e o Titã.',
  'O Trovão limpa grupos inteiros com dano em área.',
  'A Lâmina caça atiradores e artilharia rapidamente.',
  'O Lúmen cura o aliado mais ferido ao seu alcance.',
  'Guarde energia para responder aos avanços inimigos.',
];

interface CardView {
  slot: number;
  key: UnitKey;
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  costText: Phaser.GameObjects.Text;
  x: number;
  /** Cache do último estado desenhado ("selecionada|paga|carta"). */
  lastState: string;
  /** Em transição de ciclo (a carta jogada saindo, a nova entrando). */
  cycling: boolean;
}

export class HUDScene extends Phaser.Scene {
  private game_!: GameScene;
  private config!: MatchConfig;
  private playerColor: number = COLORS.player;

  private cards: CardView[] = [];
  /** Cartas fora da mão, na ordem em que voltarão (fila do deck). */
  private queue: UnitKey[] = [];
  private nextIcon!: Phaser.GameObjects.Image;
  private nextCostText!: Phaser.GameObjects.Text;
  private nextContainer!: Phaser.GameObjects.Container;

  private selectedSlot: number | null = null;
  private pressedSlot: number | null = null;
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
    this.queue = [];
    this.selectedSlot = null;
    this.pressedSlot = null;
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
    this.buildTray();
    this.buildEnergyBar();
    this.buildCards();
    this.buildAnnounce();
    this.buildPausePanel();
    if (this.config.mode === 'training') this.buildTips();
    if (SaveManager.settings.showFps) {
      this.fpsText = makeText(this, GAME_WIDTH - 10, TOP_BAR_H + 16, '', 13, CSS.textDim)
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
      const keys = ['ONE', 'TWO', 'THREE', 'FOUR'];
      keys.forEach((k, slot) => kb.on(`keydown-${k}`, () => this.toggleSelect(slot)));
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
    g.fillStyle(COLORS.bgDeep, 0.6);
    g.fillRect(0, 0, GAME_WIDTH, TOP_BAR_H);
    g.lineStyle(1, COLORS.uiStroke, 0.5);
    g.lineBetween(0, TOP_BAR_H, GAME_WIDTH, TOP_BAR_H);

    // Faixa do inimigo (topo) — a do jogador fica perto do polegar, na bandeja.
    this.enemyHpBar = this.add.graphics().setDepth(DEPTH.announce - 9);
    const rightLabel = this.config.mode === 'survival' ? 'PORTAL' : 'INIMIGO';
    makeText(this, STATUS_BAR_X, 10, rightLabel, 15, CSS.enemy);
    this.playerHpBar = this.add.graphics().setDepth(DEPTH.announce - 9);
    makeText(this, STATUS_BAR_X, TRAY_TOP + 22, SaveManager.data.name.toUpperCase(), 15, hex(this.playerColor))
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.announce - 9);
    this.redrawHpBars();

    // Cronômetro / contador central.
    const startLabel =
      this.config.mode === 'versus'
        ? this.formatTime(MATCH_DURATION)
        : this.config.mode === 'survival'
          ? 'ONDA 1'
          : 'TREINO';
    this.timerText = makeText(this, GAME_WIDTH / 2, 80, startLabel, 34)
      .setOrigin(0.5)
      .setDepth(DEPTH.announce - 8)
      .setLetterSpacing(2);

    // Botão de pausa (canto superior direito).
    const pauseBtn = this.add
      .container(GAME_WIDTH - 44, 42, [])
      .setDepth(DEPTH.announce - 8)
      .setSize(52, 52)
      .setInteractive({ useHandCursor: true });
    const pbg = this.add.graphics();
    pbg.fillStyle(COLORS.uiPanel, 0.9);
    pbg.fillRoundedRect(-26, -26, 52, 52, 14);
    pbg.lineStyle(2, COLORS.uiStroke, 0.9);
    pbg.strokeRoundedRect(-26, -26, 52, 52, 14);
    pauseBtn.add([pbg, this.add.image(0, 0, 'icon-pause').setScale(0.85)]);
    pauseBtn.on('pointerup', () => this.togglePause());
  }

  /** Fundo da bandeja de comando (rodapé inteiro). */
  private buildTray(): void {
    const g = this.add.graphics().setDepth(DEPTH.announce - 11);
    g.fillStyle(0x070c1a, 0.94);
    g.fillRect(0, TRAY_TOP, GAME_WIDTH, GAME_HEIGHT - TRAY_TOP);
    g.lineStyle(2, COLORS.uiStroke, 0.6);
    g.lineBetween(0, TRAY_TOP, GAME_WIDTH, TRAY_TOP);
  }

  private redrawHpBars(): void {
    const h = 18;
    const draw = (
      g: Phaser.GameObjects.Graphics,
      x: number,
      y: number,
      w: number,
      pct: number,
      color: number
    ) => {
      g.clear();
      g.fillStyle(0x0a0f22, 1);
      g.fillRoundedRect(x, y, w, h, 9);
      const fillW = Math.max(8, w * Phaser.Math.Clamp(pct, 0, 1));
      g.fillStyle(color, 1);
      g.fillRoundedRect(x, y, fillW, h, 9);
      g.lineStyle(2, COLORS.uiStroke, 0.9);
      g.strokeRoundedRect(x, y, w, h, 9);
    };
    draw(
      this.enemyHpBar,
      STATUS_BAR_X,
      34,
      578,
      this.config.mode === 'survival' ? 1 : this.enemyHpPct,
      this.config.mode === 'survival' ? 0x5a3a1a : COLORS.enemy
    );
    draw(this.playerHpBar, 210, TRAY_TOP + 13, GAME_WIDTH - 210 - 24, this.playerHpPct, this.playerColor);
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
    this.add
      .image(30, ENERGY_Y + ENERGY_H / 2, 'icon-energy')
      .setTint(COLORS.energy)
      .setScale(1.25)
      .setDepth(DEPTH.announce - 8);
    this.energyText = makeText(this, 50, ENERGY_Y + ENERGY_H / 2, '', 30, CSS.energy)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.announce - 8);
  }

  private redrawEnergy(): void {
    const e = this.game_.playerEnergy;
    // Evita redesenhar sem mudança visível (granularidade de 1/8 de célula).
    const quantized = Math.floor(e.current * 8);
    if (quantized === this.lastEnergyDrawn) return;
    this.lastEnergyDrawn = quantized;

    const x0 = 118;
    const gap = 4;
    const segW = (GAME_WIDTH - x0 - STATUS_BAR_X - (e.max - 1) * gap) / e.max;
    const g = this.energyBar;
    g.clear();
    for (let i = 0; i < e.max; i++) {
      const x = x0 + i * (segW + gap);
      g.fillStyle(0x0a0f22, 0.9);
      g.fillRoundedRect(x, ENERGY_Y, segW, ENERGY_H, 8);
      const fill = Phaser.Math.Clamp(e.current - i, 0, 1);
      if (fill > 0) {
        g.fillStyle(this.overdrive ? 0xc59bff : COLORS.energy, 1);
        g.fillRoundedRect(x, ENERGY_Y, Math.max(8, segW * fill), ENERGY_H, 8);
      }
      g.lineStyle(1, COLORS.uiStroke, 0.8);
      g.strokeRoundedRect(x, ENERGY_Y, segW, ENERGY_H, 8);
    }
    this.energyText.setText(String(Math.floor(e.current)));
  }

  /* --------------------------------- Cartas ----------------------------------
   * Mão de 4 cartas + fila (estilo Clash Royale): ao invocar, a carta jogada
   * vai para o fim da fila e a próxima entra no mesmo slot. O painel
   * "PRÓXIMA" mostra a primeira da fila.
   */

  private buildCards(): void {
    this.queue = Phaser.Utils.Array.Shuffle([...UNIT_ORDER]);

    for (let slot = 0; slot < HAND_SIZE; slot++) {
      const x = HAND_X0 + CARD_W / 2 + slot * (CARD_W + CARD_GAP);
      const container = this.add.container(x, CARD_Y).setDepth(DEPTH.announce - 5);
      const bg = this.add.graphics();
      const icon = this.add.image(0, -22, '__DEFAULT');
      const nameText = this.add
        .text(0, 48, '', {
          fontFamily: FONT,
          fontSize: '17px',
          fontStyle: 'bold',
          color: CSS.text,
        })
        .setOrigin(0.5);
      const costText = this.add
        .text(-CARD_W / 2 + 24, -CARD_H / 2 + 24, '', {
          fontFamily: FONT,
          fontSize: '23px',
          fontStyle: 'bold',
          color: '#ffffff',
        })
        .setOrigin(0.5);
      // Atalho de teclado (discreto, canto superior direito).
      const hint = this.add
        .text(CARD_W / 2 - 12, -CARD_H / 2 + 12, String(slot + 1), {
          fontFamily: FONT,
          fontSize: '12px',
          color: CSS.textDim,
        })
        .setOrigin(0.5);
      container.add([bg, icon, nameText, costText, hint]);

      const view: CardView = {
        slot,
        key: this.queue.shift()!,
        container,
        bg,
        icon,
        nameText,
        costText,
        x,
        lastState: '',
        cycling: false,
      };
      this.cards.push(view);
      this.setCardUnit(view, view.key);

      container.setSize(CARD_W, CARD_H);
      container.setInteractive({ useHandCursor: true });
      container.on('pointerdown', (p: Phaser.Input.Pointer) => {
        if (this.paused || this.matchOver || view.cycling) return;
        this.downPos.set(p.x, p.y);
        this.pressedSlot = slot;
        this.dragging = false;
      });
      container.on('pointerover', () => AudioEngine.play('ui-hover'));
    }

    this.buildNextPreview();
  }

  /** Troca a carta exibida num slot (ícone, nome e custo). */
  private setCardUnit(view: CardView, key: UnitKey): void {
    view.key = key;
    const def = UNIT_DEFS[key];
    const tex = TextureFactory.unitTexture(key, this.playerColor);
    const src = this.textures.get(tex).getSourceImage() as HTMLImageElement;
    view.icon.setTexture(tex).setScale(Math.min(1.5, 88 / Math.max(src.width, src.height)));
    view.nameText.setText(def.name);
    view.costText.setText(String(def.cost));
    view.lastState = '';
  }

  private drawCard(view: CardView, selected: boolean, affordable: boolean): void {
    const g = view.bg;
    g.clear();
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(-CARD_W / 2 + 3, -CARD_H / 2 + 5, CARD_W, CARD_H, 16);
    g.fillStyle(selected ? 0x1c3a63 : COLORS.uiPanel, 0.97);
    g.fillRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 16);
    g.fillStyle(0xffffff, 0.05);
    g.fillRoundedRect(-CARD_W / 2 + 3, -CARD_H / 2 + 3, CARD_W - 6, CARD_H * 0.35, {
      tl: 14,
      tr: 14,
      bl: 0,
      br: 0,
    });
    g.lineStyle(selected ? 3 : 2, selected ? this.playerColor : COLORS.uiStroke, selected ? 1 : 0.8);
    g.strokeRoundedRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 16);
    // Selo de custo (canto superior esquerdo, estilo gota de elixir).
    g.fillStyle(COLORS.energy, 1);
    g.fillCircle(-CARD_W / 2 + 24, -CARD_H / 2 + 24, 19);
    g.lineStyle(2.5, 0x0a0f22, 1);
    g.strokeCircle(-CARD_W / 2 + 24, -CARD_H / 2 + 24, 19);

    view.container.setScale(selected ? 1.05 : 1);
    if (!view.cycling) view.container.setAlpha(affordable ? 1 : 0.5);
    view.costText.setColor(affordable ? '#ffffff' : CSS.danger);
  }

  private updateCardAffordability(): void {
    const e = this.game_.playerEnergy.current;
    for (const c of this.cards) {
      const selected = this.selectedSlot === c.slot;
      const affordable = UNIT_DEFS[c.key].cost <= e;
      const state = `${selected ? 'S' : '-'}${affordable ? 'A' : '-'}${c.key}`;
      if (state === c.lastState) continue;
      c.lastState = state;
      this.drawCard(c, selected, affordable);
    }
  }

  /** Painel "PRÓXIMA" — primeira carta da fila do deck. */
  private buildNextPreview(): void {
    makeText(this, NEXT_X, NEXT_Y - NEXT_H / 2 - 16, 'PRÓXIMA', 12, CSS.textDim)
      .setOrigin(0.5)
      .setDepth(DEPTH.announce - 5)
      .setLetterSpacing(1);

    this.nextContainer = this.add.container(NEXT_X, NEXT_Y).setDepth(DEPTH.announce - 5);
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.4);
    bg.fillRoundedRect(-NEXT_W / 2 + 2, -NEXT_H / 2 + 4, NEXT_W, NEXT_H, 12);
    bg.fillStyle(COLORS.uiPanelLight, 0.85);
    bg.fillRoundedRect(-NEXT_W / 2, -NEXT_H / 2, NEXT_W, NEXT_H, 12);
    bg.lineStyle(2, COLORS.uiStroke, 0.7);
    bg.strokeRoundedRect(-NEXT_W / 2, -NEXT_H / 2, NEXT_W, NEXT_H, 12);
    bg.fillStyle(COLORS.energy, 0.95);
    bg.fillCircle(-NEXT_W / 2 + 15, -NEXT_H / 2 + 15, 12);
    bg.lineStyle(2, 0x0a0f22, 1);
    bg.strokeCircle(-NEXT_W / 2 + 15, -NEXT_H / 2 + 15, 12);

    this.nextIcon = this.add.image(0, 4, '__DEFAULT');
    this.nextCostText = this.add
      .text(-NEXT_W / 2 + 15, -NEXT_H / 2 + 15, '', {
        fontFamily: FONT,
        fontSize: '15px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    this.nextContainer.add([bg, this.nextIcon, this.nextCostText]);
    this.refreshNextPreview(false);
  }

  private refreshNextPreview(bounce = true): void {
    const key = this.queue[0];
    if (!key) return;
    const tex = TextureFactory.unitTexture(key, this.playerColor);
    const src = this.textures.get(tex).getSourceImage() as HTMLImageElement;
    this.nextIcon.setTexture(tex).setScale(Math.min(1, 54 / Math.max(src.width, src.height)));
    this.nextCostText.setText(String(UNIT_DEFS[key].cost));
    if (bounce) {
      this.tweens.killTweensOf(this.nextContainer);
      this.nextContainer.setScale(0.86);
      this.tweens.add({
        targets: this.nextContainer,
        scale: 1,
        duration: 220,
        ease: Phaser.Math.Easing.Back.Out,
      });
    }
  }

  /** Ciclo do deck: a carta jogada sai, a primeira da fila entra no slot. */
  private cycleSlot(slot: number): void {
    const view = this.cards[slot];
    this.queue.push(view.key);
    const next = this.queue.shift()!;
    view.cycling = true;
    this.tweens.killTweensOf(view.container);
    this.tweens.add({
      targets: view.container,
      y: CARD_Y + 30,
      alpha: 0,
      duration: 110,
      ease: Phaser.Math.Easing.Quadratic.In,
      onComplete: () => {
        this.setCardUnit(view, next);
        const affordable = UNIT_DEFS[next].cost <= this.game_.playerEnergy.current;
        this.drawCard(view, false, affordable);
        this.tweens.add({
          targets: view.container,
          y: CARD_Y,
          alpha: affordable ? 1 : 0.5,
          duration: 200,
          ease: Phaser.Math.Easing.Back.Out,
          onComplete: () => {
            view.cycling = false;
            view.lastState = '';
          },
        });
      },
    });
    this.refreshNextPreview();
  }

  /* ------------------------- Seleção, arrasto e invocação --------------------- */

  private buildLaneHighlights(): void {
    const fieldMidY = (FIELD_TOP + FIELD_BOTTOM) / 2;
    for (const x of LANE_XS) {
      const r = this.add
        .rectangle(x, fieldMidY, 116, FIELD_BOTTOM - FIELD_TOP, this.playerColor, 0.08)
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

  private onPointerMove(p: Phaser.Input.Pointer): void {
    if (this.paused || this.matchOver) return;
    if (this.pressedSlot !== null && !this.dragging && p.isDown) {
      if (Phaser.Math.Distance.Between(p.x, p.y, this.downPos.x, this.downPos.y) > 14) {
        this.dragging = true;
        this.selectedSlot = this.pressedSlot;
        const tex = TextureFactory.unitTexture(this.cards[this.pressedSlot].key, this.playerColor);
        // Fantasma acima do dedo, para o toque não esconder a unidade.
        this.dragGhost = this.add
          .image(p.x, p.y - 36, tex)
          .setScale(UNIT_VISUAL_SCALE)
          .setAlpha(0.75)
          .setDepth(DEPTH.announce);
        this.showLanes(true);
      }
    }
    if (this.dragging && this.dragGhost) {
      this.dragGhost.setPosition(p.x, p.y - 36);
      this.showLanes(true, this.laneAt(p.x));
    }
  }

  private onPointerUp(p: Phaser.Input.Pointer): void {
    if (this.paused || this.matchOver) {
      this.pressedSlot = null;
      return;
    }
    if (this.dragging) {
      // Fim do arrasto: solta na faixa (se estiver sobre o campo).
      const lane = this.laneAt(p.x);
      if (lane !== -1 && p.y > FIELD_TOP && p.y < FIELD_BOTTOM) {
        this.deploySelected(lane);
      }
      this.endDrag();
      this.pressedSlot = null;
      return;
    }
    if (this.pressedSlot !== null) {
      // Toque na carta: alterna seleção.
      this.toggleSelect(this.pressedSlot);
      this.pressedSlot = null;
      return;
    }
    // Toque no campo com carta selecionada: invoca na faixa mais próxima.
    if (this.selectedSlot !== null && p.y > FIELD_TOP && p.y < FIELD_BOTTOM) {
      const lane = this.laneAt(p.x);
      if (lane !== -1) this.deploySelected(lane);
    }
  }

  /** Faixa mais próxima do X tocado (sem zona morta entre faixas). */
  private laneAt(x: number): number {
    let best = -1;
    let bestDist = Infinity;
    LANE_XS.forEach((laneX, i) => {
      const d = Math.abs(x - laneX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    return best;
  }

  private toggleSelect(slot: number): void {
    if (this.matchOver || this.cards[slot].cycling) return;
    AudioEngine.play('ui-click');
    this.selectedSlot = this.selectedSlot === slot ? null : slot;
    this.showLanes(this.selectedSlot !== null);
  }

  private deploySelected(lane: number): void {
    if (this.selectedSlot === null || this.matchOver) return;
    const view = this.cards[this.selectedSlot];
    if (view.cycling) return;
    const ok = this.game_.playerDeploy(view.key, lane);
    if (ok) {
      // Carta usada vai para o fim do deck; a seleção termina (a carta mudou).
      this.cycleSlot(view.slot);
      this.selectedSlot = null;
      this.showLanes(false);
    }
  }

  private clearSelection(): void {
    this.selectedSlot = null;
    this.showLanes(false);
    this.endDrag();
  }

  private endDrag(): void {
    this.dragging = false;
    this.dragGhost?.destroy();
    this.dragGhost = null;
    if (this.selectedSlot === null) this.showLanes(false);
  }

  /* --------------------------------- Anúncios --------------------------------- */

  private buildAnnounce(): void {
    this.announceText = this.add
      .text(GAME_WIDTH / 2, 460, '', {
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
          y: 440,
          delay: 1100,
          duration: 420,
          onComplete: () => this.announceText.setY(460),
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
      .text(GAME_WIDTH / 2, TOP_BAR_H + 26, TRAINING_TIPS[0], {
        fontFamily: FONT,
        fontSize: '18px',
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
