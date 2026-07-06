/**
 * DeckScene.ts — Editor de deck de batalha.
 * O jogador escolhe exatamente 8 cartas da coleção (tropas, construções e
 * feitiços). O deck vive no perfil (SaveManager) e alimenta a mão da HUD.
 * Toque numa carta do deck para removê-la; toque numa da coleção para
 * adicioná-la. Salva automaticamente sempre que o deck está completo.
 */
import Phaser from 'phaser';
import type { CardKey } from '../../shared/types';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH, hex } from '../../shared/constants';
import { CARD_ORDER, DECK_SIZE, DEFAULT_DECK, cardInfo, isSpellKey } from '../../shared/units';
import { AudioEngine } from '../audio/AudioEngine';
import { SaveManager } from '../core/SaveManager';
import { skinById } from '../config/progression';
import { TextureFactory } from '../gfx/TextureFactory';
import { UiButton, UiScrollList, drawPanel, makeText } from '../ui/widgets';

const SLOT_W = 150;
const SLOT_H = 132;
const SLOT_GAP = 8;
const DECK_COLS = 4;
const DECK_X0 = (GAME_WIDTH - (DECK_COLS * SLOT_W + (DECK_COLS - 1) * SLOT_GAP)) / 2;
const DECK_Y0 = 128;

const COLL_TOP = 500;
const COLL_HEIGHT = GAME_HEIGHT - COLL_TOP - 24;

const TYPE_LABEL = { tropa: 'TROPA', construcao: 'CONSTRUÇÃO', feitico: 'FEITIÇO' } as const;

export class DeckScene extends Phaser.Scene {
  private deck: CardKey[] = [];
  private playerColor: number = COLORS.player;
  private deckLayer!: Phaser.GameObjects.Container;
  private statsText!: Phaser.GameObjects.Text;
  private collectionCards = new Map<CardKey, Phaser.GameObjects.Container>();

  constructor() {
    super('Deck');
  }

  create(): void {
    this.playerColor = skinById(SaveManager.data.skin).color;
    TextureFactory.ensureTeam(this, this.playerColor);
    this.deck = [...SaveManager.data.deck];
    this.collectionCards = new Map();

    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'arena').setAlpha(0.3);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bgDeep, 0.66);

    new UiButton(this, 74, 30, '← MENU', {
      width: 108,
      height: 38,
      fontSize: 14,
      variant: 'ghost',
      onClick: () => this.scene.start('Menu'),
    });
    new UiButton(this, GAME_WIDTH - 84, 30, 'PADRÃO', {
      width: 128,
      height: 38,
      fontSize: 14,
      variant: 'ghost',
      onClick: () => {
        this.deck = [...DEFAULT_DECK];
        this.commitAndRefresh();
      },
    });
    makeText(this, GAME_WIDTH / 2, 78, 'MONTE SEU DECK', 24).setOrigin(0.5).setLetterSpacing(3);

    this.deckLayer = this.add.container(0, 0);
    this.statsText = makeText(this, GAME_WIDTH / 2, DECK_Y0 + 2 * SLOT_H + 26, '', 15, CSS.textDim)
      .setOrigin(0.5);

    makeText(this, DECK_X0, COLL_TOP - 42, 'COLEÇÃO', 17, CSS.gold).setLetterSpacing(2);
    makeText(
      this,
      GAME_WIDTH - DECK_X0,
      COLL_TOP - 38,
      'toque para adicionar/remover',
      13,
      CSS.textDim,
      'normal'
    ).setOrigin(1, 0);

    this.buildCollection();
    this.refreshDeck();

    this.cameras.main.fadeIn(250, 5, 7, 15);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Menu'));
  }

  /* --------------------------------- Cartas --------------------------------- */

  /** Mini-carta reutilizada no deck e na coleção. */
  private buildMiniCard(
    key: CardKey,
    onTap: (p: Phaser.Input.Pointer) => void
  ): Phaser.GameObjects.Container {
    const info = cardInfo(key);
    const c = this.add.container(0, 0);
    const g = this.add.graphics();
    drawPanel(g, -SLOT_W / 2, -SLOT_H / 2, SLOT_W, SLOT_H, { radius: 14, stroke: info.accent });
    c.add(g);

    // Selo de custo.
    g.fillStyle(COLORS.energy, 1);
    g.fillCircle(-SLOT_W / 2 + 19, -SLOT_H / 2 + 19, 14);
    g.lineStyle(2, 0x0a0f22, 1);
    g.strokeCircle(-SLOT_W / 2 + 19, -SLOT_H / 2 + 19, 14);
    c.add(makeText(this, -SLOT_W / 2 + 19, -SLOT_H / 2 + 19, String(info.cost), 15).setOrigin(0.5));

    // Ícone.
    const tex = isSpellKey(key)
      ? TextureFactory.spellTexture(key)
      : TextureFactory.unitTexture(key, this.playerColor);
    const src = this.textures.get(tex).getSourceImage() as HTMLImageElement;
    const scale = Math.min(1.15, 58 / Math.max(src.width, src.height));
    c.add(this.add.image(6, -14, tex).setScale(scale));

    // Nome + tipo.
    c.add(makeText(this, 0, SLOT_H / 2 - 36, info.name, 15).setOrigin(0.5));
    c.add(
      makeText(this, 0, SLOT_H / 2 - 17, TYPE_LABEL[info.type], 10, hex(info.accent)).setOrigin(0.5)
    );

    c.setSize(SLOT_W, SLOT_H);
    c.setInteractive({ useHandCursor: true });
    c.on('pointerover', () => AudioEngine.play('ui-hover'));
    // Ignora "toques" que na verdade foram arrasto de rolagem.
    c.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (p.getDistance() < 12) onTap(p);
    });
    return c;
  }

  /* ---------------------------------- Deck ---------------------------------- */

  private refreshDeck(): void {
    this.deckLayer.removeAll(true);

    for (let i = 0; i < DECK_SIZE; i++) {
      const col = i % DECK_COLS;
      const row = Math.floor(i / DECK_COLS);
      const x = DECK_X0 + SLOT_W / 2 + col * (SLOT_W + SLOT_GAP);
      const y = DECK_Y0 + SLOT_H / 2 + row * (SLOT_H + SLOT_GAP);

      const key = this.deck[i];
      if (key) {
        const card = this.buildMiniCard(key, () => this.removeCard(key));
        card.setPosition(x, y);
        this.deckLayer.add(card);
      } else {
        // Slot vazio.
        const g = this.add.graphics();
        g.lineStyle(2, COLORS.uiStroke, 0.5);
        g.strokeRoundedRect(x - SLOT_W / 2, y - SLOT_H / 2, SLOT_W, SLOT_H, 14);
        g.fillStyle(COLORS.uiPanel, 0.3);
        g.fillRoundedRect(x - SLOT_W / 2, y - SLOT_H / 2, SLOT_W, SLOT_H, 14);
        this.deckLayer.add(g);
        this.deckLayer.add(makeText(this, x, y, '+', 34, CSS.textDim).setOrigin(0.5));
      }
    }

    // Custo médio + status de completude.
    const avg =
      this.deck.length > 0
        ? this.deck.reduce((s, k) => s + cardInfo(k).cost, 0) / this.deck.length
        : 0;
    const complete = this.deck.length === DECK_SIZE;
    this.statsText
      .setText(
        complete
          ? `Deck completo  •  custo médio ${avg.toFixed(1)}  •  salvo!`
          : `${this.deck.length}/${DECK_SIZE} cartas — escolha mais ${DECK_SIZE - this.deck.length} na coleção`
      )
      .setColor(complete ? CSS.success : CSS.gold);

    // Badge de "no deck" na coleção.
    for (const [key, container] of this.collectionCards) {
      const inDeck = this.deck.includes(key);
      container.setAlpha(inDeck ? 0.35 : 1);
    }
  }

  private removeCard(key: CardKey): void {
    AudioEngine.play('ui-click');
    this.deck = this.deck.filter((k) => k !== key);
    this.commitAndRefresh();
  }

  private addCard(key: CardKey): void {
    if (this.deck.includes(key)) {
      // Já está no deck: o toque na coleção também remove (atalho natural).
      this.removeCard(key);
      return;
    }
    if (this.deck.length >= DECK_SIZE) {
      AudioEngine.play('ui-error');
      this.tweens.add({ targets: this.statsText, scale: 1.15, duration: 90, yoyo: true });
      return;
    }
    AudioEngine.play('ui-click');
    this.deck.push(key);
    this.commitAndRefresh();
  }

  /** Persiste (só decks completos) e redesenha. */
  private commitAndRefresh(): void {
    if (this.deck.length === DECK_SIZE) SaveManager.setDeck(this.deck);
    this.refreshDeck();
  }

  /* -------------------------------- Coleção --------------------------------- */

  private buildCollection(): void {
    const list = new UiScrollList(this, DECK_X0 - 8, COLL_TOP, GAME_WIDTH - 2 * (DECK_X0 - 8), COLL_HEIGHT);

    CARD_ORDER.forEach((key, i) => {
      const col = i % DECK_COLS;
      const row = Math.floor(i / DECK_COLS);
      const x = 8 + SLOT_W / 2 + col * (SLOT_W + SLOT_GAP);
      const y = SLOT_H / 2 + row * (SLOT_H + SLOT_GAP);
      // Cartas roladas para fora da máscara continuam interativas no Phaser —
      // o filtro por Y garante que só toques dentro do viewport contam.
      const card = this.buildMiniCard(key, (p) => {
        if (p.y >= COLL_TOP && p.y <= COLL_TOP + COLL_HEIGHT) this.addCard(key);
      });
      card.setPosition(x, y);
      list.content.add(card);
      this.collectionCards.set(key, card);
    });

    const rows = Math.ceil(CARD_ORDER.length / DECK_COLS);
    list.setContentHeight(rows * (SLOT_H + SLOT_GAP) + 8);
  }
}
