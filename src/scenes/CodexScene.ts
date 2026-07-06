/**
 * CodexScene.ts — Enciclopédia das unidades.
 * Uma "carta" por unidade com todos os atributos de combate, no espírito
 * das telas de informação de cartas de jogos de estratégia mobile.
 * Versão inicial simples: grade estática 4x2, sem paginação/filtro.
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONT, GAME_HEIGHT, GAME_WIDTH, hex } from '../../shared/constants';
import { UNIT_DEFS, UNIT_ORDER } from '../../shared/units';
import { SaveManager } from '../core/SaveManager';
import { skinById } from '../config/progression';
import { TextureFactory } from '../gfx/TextureFactory';
import { UiButton, drawPanel, makeText } from '../ui/widgets';
import type { Role, UnitDef } from '../../shared/types';

const ROLE_LABEL: Record<Role, string> = {
  shock: 'Choque',
  ranged: 'Longo alcance',
  tank: 'Tanque',
  assassin: 'Assassina',
  support: 'Suporte',
  siege: 'Cerco',
  swarm: 'Enxame',
  super: 'Suprema',
};

function attackType(def: UnitDef): string {
  if (def.healer) return 'Cura à distância';
  if (def.arcingProjectile) return 'Área (artilharia)';
  if (def.projectileSpeed) return 'À distância';
  return 'Corpo a corpo';
}

const CARD_W = 320;
const CARD_H = 250;
const GAP = 16;
const COLS = 2;

export class CodexScene extends Phaser.Scene {
  constructor() {
    super('Codex');
  }

  create(): void {
    const playerColor = skinById(SaveManager.data.skin).color;
    TextureFactory.ensureTeam(this, playerColor);

    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'arena').setAlpha(0.3);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bgDeep, 0.62);

    new UiButton(this, 74, 30, '← MENU', {
      width: 108,
      height: 38,
      fontSize: 14,
      variant: 'ghost',
      onClick: () => this.scene.start('Menu'),
    });
    makeText(this, GAME_WIDTH / 2, 78, 'ENCICLOPÉDIA DE UNIDADES', 22)
      .setOrigin(0.5)
      .setLetterSpacing(2);

    const x0 = (GAME_WIDTH - (COLS * CARD_W + (COLS - 1) * GAP)) / 2;
    const y0 = 120;

    UNIT_ORDER.forEach((key, i) => {
      const def = UNIT_DEFS[key];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = x0 + col * (CARD_W + GAP);
      const y = y0 + row * (CARD_H + GAP);
      this.buildCard(x, y, def, playerColor);
    });

    this.cameras.main.fadeIn(250, 5, 7, 15);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Menu'));
  }

  private buildCard(x: number, y: number, def: UnitDef, playerColor: number): void {
    const g = this.add.graphics();
    drawPanel(g, x, y, CARD_W, CARD_H, { radius: 18, stroke: def.accent });

    // Selo de custo (canto superior direito).
    g.fillStyle(COLORS.energy, 1);
    g.fillCircle(x + CARD_W - 26, y + 26, 17);
    g.lineStyle(2, 0x0a0f22, 1);
    g.strokeCircle(x + CARD_W - 26, y + 26, 17);
    makeText(this, x + CARD_W - 26, y + 26, String(def.cost), 18).setOrigin(0.5);

    // Ícone.
    const tex = TextureFactory.unitTexture(def.key, playerColor);
    const src = this.textures.get(tex).getSourceImage() as HTMLImageElement;
    const scale = Math.min(1.6, 60 / Math.max(src.width, src.height));
    this.add.image(x + 54, y + 50, tex).setScale(scale);

    // Nome + papel.
    makeText(this, x + 104, y + 26, def.name, 21);
    makeText(this, x + 104, y + 52, ROLE_LABEL[def.role].toUpperCase(), 13, hex(def.accent));

    // Linha divisória.
    g.lineStyle(1, COLORS.uiStroke, 0.6);
    g.lineBetween(x + 16, y + 92, x + CARD_W - 16, y + 92);

    // Atributos em grade 2x2.
    const stat = (col: number, row: number, label: string, value: string) => {
      const sx = x + 20 + col * (CARD_W / 2 - 10);
      const sy = y + 104 + row * 34;
      makeText(this, sx, sy, label, 12, CSS.textDim, 'normal');
      makeText(this, sx, sy + 15, value, 18);
    };
    stat(0, 0, 'VIDA', String(def.hp * (def.count ?? 1)));
    stat(1, 0, def.healer ? 'CURA' : 'DANO', String(def.damage));
    stat(0, 1, 'VELOCIDADE', String(def.speed));
    stat(1, 1, 'ALCANCE', def.range >= 100 ? String(def.range) : 'curto');

    // Tipo de ataque.
    makeText(this, x + 20, y + 178, attackType(def).toUpperCase(), 13, CSS.gold);
    if (def.count && def.count > 1) {
      makeText(this, x + CARD_W - 20, y + 178, `x${def.count}`, 13, CSS.textDim).setOrigin(1, 0);
    }

    // Descrição.
    this.add.text(x + 20, y + 200, def.desc, {
      fontFamily: FONT,
      fontSize: '13px',
      color: CSS.textDim,
      wordWrap: { width: CARD_W - 40 },
      lineSpacing: 3,
    });
  }
}
