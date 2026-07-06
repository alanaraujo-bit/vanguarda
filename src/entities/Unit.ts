/**
 * Unit.ts — Visão (Phaser) de uma unidade. Toda a regra de combate vive em
 * shared/sim/engine.ts — esta classe só espelha o SimState (posição/HP/status)
 * e toca a "vida" cosmética: pop de invocação, flash de dano, flutuação de
 * voadoras, barra de escudo, tinturas de lentidão/atordoo/Fúria e morte.
 */
import Phaser from 'phaser';
import type { Team, UnitDef } from '../../shared/types';
import { DEPTH, UNIT_VISUAL_SCALE } from '../../shared/constants';
import { TextureFactory } from '../gfx/TextureFactory';
import type { GameScene } from '../scenes/GameScene';

/** Status sincronizados da simulação (motor local ou snapshot do servidor). */
export interface UnitStatus {
  shield: number;
  slow: boolean;
  rage: boolean;
  stun: boolean;
}

const TINT_SLOW = 0x9fd0ff;
const TINT_RAGE = 0xffb0a0;
const TINT_STUN = 0xd8d8ff;

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
  private status: UnitStatus;
  private maxShield: number;
  private flashing = false;

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
    this.maxShield = def.shield ?? 0;
    this.status = { shield: this.maxShield, slow: false, rage: false, stun: false };

    const vs = UNIT_VISUAL_SCALE;
    // Voadoras: sombra mais distante/apertada, sprite flutuando com bob contínuo.
    const hover = def.flying ? 16 : 0;
    this.shadow = battle.add
      .ellipse(
        0,
        def.radius * 0.95 * vs + hover * 0.6,
        def.radius * (def.flying ? 1.6 : 2.1) * vs,
        def.radius * (def.flying ? 0.45 : 0.62) * vs,
        0x000000,
        def.flying ? 0.25 : 0.35
      )
      .setOrigin(0.5);
    this.sprite = battle.add
      .image(0, -hover, TextureFactory.unitTexture(def.key, teamColor))
      .setScale(vs);
    if (team === 'enemy') this.sprite.setFlipX(true);
    if (def.flying) {
      battle.tweens.add({
        targets: this.sprite,
        y: -hover - 7,
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: Phaser.Math.Easing.Sine.InOut,
      });
    }
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

  /** Posição/HP/status vêm do SimState (motor local ou snapshot do servidor) — sem IA aqui. */
  syncFromSim(x: number, y: number, hp: number, status?: UnitStatus): void {
    this.x = x;
    this.y = y;
    this.setDepth(DEPTH.unitsBase + y);

    let barDirty = false;
    if (status) {
      if (status.shield !== this.status.shield) barDirty = true;
      const statusChanged =
        status.slow !== this.status.slow ||
        status.rage !== this.status.rage ||
        status.stun !== this.status.stun;
      this.status = { ...status };
      if (statusChanged && !this.flashing) this.applyStatusTint();
    }

    if (hp !== this.hp) {
      if (hp < this.hp) this.flashDamage();
      this.hp = hp;
      barDirty = true;
    }
    if (barDirty) this.redrawHpBar();
  }

  /** Flash branco de dano; ao terminar, restaura a tintura do status atual. */
  private flashDamage(): void {
    this.flashing = true;
    this.sprite.setTintFill(0xffffff);
    this.battle.time.delayedCall(70, () => {
      this.flashing = false;
      if (this.sprite.active) this.applyStatusTint();
    });
  }

  /** Tintura conforme o status dominante (atordoado > lento > enfurecido). */
  private applyStatusTint(): void {
    if (this.status.stun) this.sprite.setTint(TINT_STUN);
    else if (this.status.slow) this.sprite.setTint(TINT_SLOW);
    else if (this.status.rage) this.sprite.setTint(TINT_RAGE);
    else this.sprite.clearTint();
  }

  private redrawHpBar(): void {
    const w = Phaser.Math.Clamp(this.radius * 2.2 * UNIT_VISUAL_SCALE, 42, 84);
    const pct = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    const shieldPct =
      this.maxShield > 0 ? Phaser.Math.Clamp(this.status.shield / this.maxShield, 0, 1) : 0;
    const y = -this.radius * UNIT_VISUAL_SCALE - 22;
    // Visível quando ferida ou com escudo parcial (escudo cheio + HP cheio = limpa).
    this.hpBar.setVisible(pct < 1 || (this.maxShield > 0 && shieldPct < 1 && shieldPct > 0));
    this.hpBar.clear();
    this.hpBar.fillStyle(0x000000, 0.65);
    this.hpBar.fillRoundedRect(-w / 2 - 1.5, y - 1.5, w + 3, 10, 4);
    const color = pct > 0.55 ? 0x4dffa1 : pct > 0.25 ? 0xffc94d : 0xff4d6b;
    this.hpBar.fillStyle(color, 1);
    this.hpBar.fillRoundedRect(-w / 2, y, Math.max(4, w * pct), 7, 3);
    // Barra fina de escudo acima da vida (branca-azulada).
    if (this.maxShield > 0 && shieldPct > 0) {
      this.hpBar.fillStyle(0x000000, 0.65);
      this.hpBar.fillRoundedRect(-w / 2 - 1.5, y - 8, w + 3, 6, 3);
      this.hpBar.fillStyle(0xcfefff, 1);
      this.hpBar.fillRoundedRect(-w / 2, y - 7, Math.max(4, w * shieldPct), 4, 2);
    }
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
