/**
 * CodexScene.ts — Enciclopédia das cartas.
 * Todas as cartas do jogo (tropas, construções e feitiços) em uma lista
 * rolável, com atributos de combate, tipo de ataque e — o mais importante
 * para aprender o jogo — o ponto forte e o ponto fraco de cada uma.
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONT, GAME_HEIGHT, GAME_WIDTH, hex } from '../../shared/constants';
import { SPELL_DEFS, UNIT_DEFS, UNIT_ORDER } from '../../shared/units';
import { SaveManager } from '../core/SaveManager';
import { skinById } from '../config/progression';
import { TextureFactory } from '../gfx/TextureFactory';
import { UiButton, UiScrollList, drawPanel, makeText } from '../ui/widgets';
import type { Role, SpellDef, UnitDef } from '../../shared/types';

const ROLE_LABEL: Record<Role, string> = {
  shock: 'Choque',
  ranged: 'Longo alcance',
  tank: 'Tanque',
  assassin: 'Assassina',
  support: 'Suporte',
  siege: 'Cerco',
  swarm: 'Enxame',
  super: 'Suprema',
  flyer: 'Voadora',
  bomber: 'Kamikaze',
  breaker: 'Demolidor',
  building: 'Construção',
};

function attackType(def: UnitDef): string {
  if (def.kamikaze) return 'Explode no contato';
  if (def.spawn) return 'Fábrica de tropas';
  if (def.energyRate) return 'Gerador de energia';
  if (def.healer) return 'Cura à distância';
  if (def.arcingProjectile) return 'Área (artilharia)';
  if (def.projectileSpeed) return 'À distância';
  return 'Corpo a corpo';
}

/** Traços especiais exibidos como selos na carta. */
function traits(def: UnitDef): string[] {
  const t: string[] = [];
  if (def.flying) t.push('VOA');
  if (def.targetsAir && !def.flying) t.push('ANTIAÉREA');
  if (def.buildingsOnly) t.push('SÓ CONSTRUÇÕES');
  if (def.charge) t.push('INVESTIDA');
  if (def.shield) t.push('ESCUDO');
  if (def.slowOnHit) t.push('CONGELA');
  if (def.splashRadius && !def.kamikaze) t.push('DANO EM ÁREA');
  if (def.lifetime) t.push(`DURA ${def.lifetime}s`);
  return t;
}

const CARD_W = 320;
const CARD_H = 316;
const GAP = 16;
const COLS = 2;
const LIST_TOP = 112;
const HEADER_H = 52;

export class CodexScene extends Phaser.Scene {
  private playerColor: number = COLORS.player;
  private list!: UiScrollList;
  private cursorY = 0;

  constructor() {
    super('Codex');
  }

  create(): void {
    this.playerColor = skinById(SaveManager.data.skin).color;
    TextureFactory.ensureTeam(this, this.playerColor);

    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'arena').setAlpha(0.3);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bgDeep, 0.62);

    new UiButton(this, 74, 30, '← MENU', {
      width: 108,
      height: 38,
      fontSize: 14,
      variant: 'ghost',
      onClick: () => this.scene.start('Menu'),
    });
    makeText(this, GAME_WIDTH / 2, 78, 'ENCICLOPÉDIA DE CARTAS', 22)
      .setOrigin(0.5)
      .setLetterSpacing(2);

    const x0 = (GAME_WIDTH - (COLS * CARD_W + (COLS - 1) * GAP)) / 2;
    this.list = new UiScrollList(this, x0, LIST_TOP, COLS * CARD_W + (COLS - 1) * GAP + 12, GAME_HEIGHT - LIST_TOP - 20);
    this.cursorY = 0;

    // Tropas.
    const troops = UNIT_ORDER.filter((k) => UNIT_DEFS[k].kind !== 'building');
    this.addHeader('TROPAS');
    this.addUnitGrid(troops.map((k) => UNIT_DEFS[k]));

    // Construções.
    const buildings = UNIT_ORDER.filter((k) => UNIT_DEFS[k].kind === 'building');
    this.addHeader('CONSTRUÇÕES');
    this.addUnitGrid(buildings.map((k) => UNIT_DEFS[k]));

    // Feitiços.
    this.addHeader('FEITIÇOS');
    const spells = Object.values(SPELL_DEFS);
    spells.forEach((def, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      this.buildSpellCard(col * (CARD_W + GAP), this.cursorY + row * (CARD_H + GAP), def);
    });
    this.cursorY += Math.ceil(spells.length / COLS) * (CARD_H + GAP);

    this.list.setContentHeight(this.cursorY + 8);

    this.cameras.main.fadeIn(250, 5, 7, 15);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Menu'));
  }

  private addHeader(label: string): void {
    const t = makeText(this, 4, this.cursorY + HEADER_H / 2, label, 18, CSS.gold)
      .setOrigin(0, 0.5)
      .setLetterSpacing(3);
    const line = this.add.graphics();
    line.lineStyle(2, COLORS.uiStroke, 0.7);
    line.lineBetween(t.width + 20, this.cursorY + HEADER_H / 2, COLS * CARD_W + GAP - 8, this.cursorY + HEADER_H / 2);
    this.list.content.add([t, line]);
    this.cursorY += HEADER_H;
  }

  private addUnitGrid(defs: UnitDef[]): void {
    defs.forEach((def, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      this.buildUnitCard(col * (CARD_W + GAP), this.cursorY + row * (CARD_H + GAP), def);
    });
    this.cursorY += Math.ceil(defs.length / COLS) * (CARD_H + GAP);
  }

  /* ----------------------------- Moldura comum ------------------------------ */

  /** Painel, selo de custo, ícone, nome e rótulo de papel — igual para todo tipo. */
  private buildCardShell(
    x: number,
    y: number,
    accent: number,
    cost: number,
    tex: string,
    name: string,
    roleLabel: string
  ): void {
    const g = this.add.graphics();
    drawPanel(g, x, y, CARD_W, CARD_H, { radius: 18, stroke: accent });
    g.fillStyle(COLORS.energy, 1);
    g.fillCircle(x + CARD_W - 26, y + 26, 17);
    g.lineStyle(2, 0x0a0f22, 1);
    g.strokeCircle(x + CARD_W - 26, y + 26, 17);
    g.lineStyle(1, COLORS.uiStroke, 0.6);
    g.lineBetween(x + 16, y + 92, x + CARD_W - 16, y + 92);
    this.list.content.add(g);

    this.list.content.add(makeText(this, x + CARD_W - 26, y + 26, String(cost), 18).setOrigin(0.5));

    const src = this.textures.get(tex).getSourceImage() as HTMLImageElement;
    const scale = Math.min(1.6, 60 / Math.max(src.width, src.height));
    this.list.content.add(this.add.image(x + 54, y + 50, tex).setScale(scale));

    this.list.content.add(makeText(this, x + 104, y + 26, name, 21));
    this.list.content.add(makeText(this, x + 104, y + 52, roleLabel.toUpperCase(), 13, hex(accent)));
  }

  /** Linhas de forte/fraco + descrição (rodapé comum). */
  private buildCardFooter(x: number, y: number, forte: string, fraco: string, desc: string): void {
    this.list.content.add(makeText(this, x + 20, y + 204, '▲', 13, CSS.success));
    this.list.content.add(
      makeText(this, x + 38, y + 205, forte, 12.5, CSS.success, 'normal').setWordWrapWidth(CARD_W - 58)
    );
    this.list.content.add(makeText(this, x + 20, y + 228, '▼', 13, CSS.danger));
    this.list.content.add(
      makeText(this, x + 38, y + 229, fraco, 12.5, CSS.danger, 'normal').setWordWrapWidth(CARD_W - 58)
    );
    this.list.content.add(
      this.add.text(x + 20, y + 258, desc, {
        fontFamily: FONT,
        fontSize: '13px',
        color: CSS.textDim,
        wordWrap: { width: CARD_W - 40 },
        lineSpacing: 3,
      })
    );
  }

  /* --------------------------------- Cartas --------------------------------- */

  private buildUnitCard(x: number, y: number, def: UnitDef): void {
    const tex = TextureFactory.unitTexture(def.key, this.playerColor);
    this.buildCardShell(x, y, def.accent, def.cost, tex, def.name, ROLE_LABEL[def.role]);

    // Atributos em grade 2x2.
    const stat = (col: number, row: number, label: string, value: string) => {
      const sx = x + 20 + col * (CARD_W / 2 - 10);
      const sy = y + 102 + row * 34;
      this.list.content.add(makeText(this, sx, sy, label, 12, CSS.textDim, 'normal'));
      this.list.content.add(makeText(this, sx, sy + 15, value, 18));
    };
    const hpLabel = def.shield ? `${def.hp}+${def.shield}` : String(def.hp * (def.count ?? 1));
    stat(0, 0, def.shield ? 'VIDA + ESCUDO' : 'VIDA', hpLabel);
    stat(1, 0, def.healer ? 'CURA' : 'DANO', def.damage > 0 ? String(def.damage) : '—');
    stat(0, 1, 'VELOCIDADE', def.speed > 0 ? String(def.speed) : 'fixa');
    stat(1, 1, 'ALCANCE', def.range >= 100 ? String(def.range) : def.range > 0 ? 'curto' : '—');

    // Tipo de ataque + selos de traços especiais.
    this.list.content.add(makeText(this, x + 20, y + 176, attackType(def).toUpperCase(), 13, CSS.gold));
    if (def.count && def.count > 1) {
      this.list.content.add(
        makeText(this, x + CARD_W - 20, y + 176, `x${def.count}`, 13, CSS.textDim).setOrigin(1, 0)
      );
    }
    const t = traits(def);
    if (t.length > 0) {
      this.list.content.add(
        makeText(this, x + 20, y + 194, t.join('  •  '), 10.5, hex(def.accent), 'normal')
      );
    }

    this.buildCardFooter(x, y + 6, def.forte, def.fraco, def.desc);
  }

  private buildSpellCard(x: number, y: number, def: SpellDef): void {
    const tex = TextureFactory.spellTexture(def.key);
    this.buildCardShell(x, y, def.accent, def.cost, tex, def.name, 'Feitiço');

    const stat = (col: number, row: number, label: string, value: string) => {
      const sx = x + 20 + col * (CARD_W / 2 - 10);
      const sy = y + 102 + row * 34;
      this.list.content.add(makeText(this, sx, sy, label, 12, CSS.textDim, 'normal'));
      this.list.content.add(makeText(this, sx, sy + 15, value, 18));
    };
    stat(0, 0, 'RAIO', String(def.radius));
    stat(1, 0, 'DANO', def.damage ? String(def.damage) : '—');
    stat(
      0,
      1,
      'EFEITO',
      def.stunDur ? `atordoa ${def.stunDur}s` : def.rageDur ? `fúria ${def.rageDur}s` : 'dano puro'
    );
    stat(1, 1, 'NAS BASES', def.damage ? '50% do dano' : '—');

    this.list.content.add(
      makeText(this, x + 20, y + 176, 'EM QUALQUER PONTO DO CAMPO', 13, CSS.gold)
    );

    this.buildCardFooter(x, y + 6, def.forte, def.fraco, def.desc);
  }
}
