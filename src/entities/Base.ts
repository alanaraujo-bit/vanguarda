/**
 * Base.ts — Visão (Phaser) do núcleo de cada time. A torreta e a regra de
 * dano vivem em shared/sim/engine.ts — esta classe só espelha o HP do
 * SimState e toca o feedback visual (tremor, brilho, fade na destruição).
 */
import Phaser from 'phaser';
import type { Team } from '../../shared/types';
import { BASE_HP, BASE_RADIUS, DEPTH } from '../../shared/constants';
import { TextureFactory } from '../gfx/TextureFactory';
import { bus, Evt } from '../core/events';
import type { GameScene } from '../scenes/GameScene';

export class Base extends Phaser.GameObjects.Container {
  readonly team: Team;
  hp: number;
  maxHp: number;
  alive = true;
  radius = BASE_RADIUS;

  private battle: GameScene;
  private sprite: Phaser.GameObjects.Image;
  private glow: Phaser.GameObjects.Image;
  private color: number;

  constructor(battle: GameScene, team: Team, x: number, y: number, color: number, hp = BASE_HP) {
    super(battle, x, y);
    this.battle = battle;
    this.team = team;
    this.color = color;
    this.hp = hp;
    this.maxHp = hp;

    this.glow = battle.add.image(0, -12, 'p-soft').setScale(7).setTint(color).setAlpha(0.4);
    this.sprite = battle.add.image(0, 0, TextureFactory.baseTexture(color)).setOrigin(0.5, 0.62);
    if (team === 'enemy') this.sprite.setFlipX(true);
    this.add([this.glow, this.sprite]);
    this.setDepth(DEPTH.bases);
    battle.add.existing(this);

    // Pulso do núcleo.
    battle.tweens.add({
      targets: this.glow,
      alpha: 0.55,
      scale: 7.8,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: Phaser.Math.Easing.Sine.InOut,
    });
  }

  get teamColor(): number {
    return this.color;
  }

  /** HP vem do SimState (motor local ou snapshot do servidor). */
  syncFromSim(hp: number): void {
    if (this.hp === hp) return;
    this.hp = Math.max(0, hp);
    bus.emit(Evt.BaseHp, this.team, this.hp, this.maxHp);
  }

  /** Tremor cosmético de impacto — chamado pelo handler do evento 'base-hit'. */
  jitter(): void {
    this.battle.tweens.add({
      targets: this.sprite,
      x: Phaser.Math.Between(-4, 4),
      y: Phaser.Math.Between(-3, 3),
      duration: 45,
      yoyo: true,
      repeat: 2,
      onComplete: () => this.sprite.setPosition(0, 0),
    });
  }
}
