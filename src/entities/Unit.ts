/**
 * Unit.ts — Visão (Phaser) de uma unidade. Toda a regra de combate vive em
 * shared/sim/engine.ts — esta classe só espelha o SimState (posição/HP) e
 * toca a "vida" cosmética: pop de invocação, flash de dano, morte.
 */
import Phaser from 'phaser';
import type { Team, UnitDef } from '../../shared/types';
import { DEPTH, UNIT_VISUAL_SCALE } from '../../shared/constants';
import { TextureFactory } from '../gfx/TextureFactory';
import type { GameScene } from '../scenes/GameScene';

export class Unit extends Phaser.GameObjects.Container {
  readonly def: UnitDef;
  readonly team: Team;
  readonly lane: number;

  hp: number;
  maxHp: number;
  alive = true;
  radius: number;

  private battle: GameScene;
  private sprite: Phaser.GameObjects.Image;
  private shadow: Phaser.GameObjects.Ellipse;
  private hpBar: Phaser.GameObjects.Graphics;

  constructor(
    battle: GameScene,
    def: UnitDef,
    team: Team,
    lane: number,
    x: number,
    y: number,
    teamColor: number
  ) {
    super(battle, x, y);
    this.battle = battle;
    this.def = def;
    this.team = team;
    this.lane = lane;
    this.hp = def.hp;
    this.maxHp = def.hp;
    this.radius = def.radius;

    const vs = UNIT_VISUAL_SCALE;
    this.shadow = battle.add
      .ellipse(0, def.radius * 0.95 * vs, def.radius * 2.1 * vs, def.radius * 0.62 * vs, 0x000000, 0.35)
      .setOrigin(0.5);
    this.sprite = battle.add
      .image(0, 0, TextureFactory.unitTexture(def.key, teamColor))
      .setScale(vs);
    if (team === 'enemy') this.sprite.setFlipX(true);
    this.hpBar = battle.add.graphics();
    this.hpBar.setVisible(false);

    this.add([this.shadow, this.sprite, this.hpBar]);
    this.setDepth(DEPTH.unitsBase + y);
    battle.add.existing(this);

    // Animação de invocação: nasce do nada com um "pop".
    this.setScale(0);
    battle.tweens.add({
      targets: this,
      scale: 1,
      duration: 260,
      ease: Phaser.Math.Easing.Back.Out,
    });
  }

  /** Peso tático usado pela IA do bot (custo da carta). */
  get power(): number {
    return this.def.cost / (this.def.count ?? 1);
  }

  /** Posição/HP vêm do SimState (motor local ou snapshot do servidor) — sem IA aqui. */
  syncFromSim(x: number, y: number, hp: number): void {
    this.x = x;
    this.y = y;
    this.setDepth(DEPTH.unitsBase + y);
    if (hp !== this.hp) {
      if (hp < this.hp) {
        this.sprite.setTintFill(0xffffff);
        this.battle.time.delayedCall(70, () => {
          if (this.sprite.active) this.sprite.clearTint();
        });
      }
      this.hp = hp;
      this.redrawHpBar();
    }
  }

  private redrawHpBar(): void {
    const w = Phaser.Math.Clamp(this.radius * 2.2 * UNIT_VISUAL_SCALE, 42, 84);
    const pct = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    const y = -this.radius * UNIT_VISUAL_SCALE - 22;
    this.hpBar.setVisible(pct < 1);
    this.hpBar.clear();
    this.hpBar.fillStyle(0x000000, 0.65);
    this.hpBar.fillRoundedRect(-w / 2 - 1.5, y - 1.5, w + 3, 10, 4);
    const color = pct > 0.55 ? 0x4dffa1 : pct > 0.25 ? 0xffc94d : 0xff4d6b;
    this.hpBar.fillStyle(color, 1);
    this.hpBar.fillRoundedRect(-w / 2, y, Math.max(4, w * pct), 7, 3);
  }

  /** O motor já decidiu a morte — só toca a animação (som/partículas/fade). */
  die(): void {
    this.alive = false;
    this.battle.onUnitDied(this);
    this.battle.tweens.add({
      targets: this,
      alpha: 0,
      scale: 0.6,
      duration: 220,
      ease: Phaser.Math.Easing.Quadratic.In,
      onComplete: () => this.destroy(),
    });
  }
}
