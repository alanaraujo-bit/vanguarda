/**
 * Base.ts — O Núcleo de cada time: objetivo da partida.
 * Possui torreta defensiva de curto alcance e feedback visual
 * proporcional ao dano (rachaduras de luz, tremor, fumaça).
 */
import Phaser from 'phaser';
import type { Targetable, Team } from '../core/types';
import {
  BASE_HP,
  BASE_RADIUS,
  DEPTH,
  TURRET_COOLDOWN,
  TURRET_DAMAGE,
  TURRET_RANGE,
} from '../config/constants';
import { TextureFactory } from '../gfx/TextureFactory';
import { bus, Evt } from '../core/events';
import type { GameScene } from '../scenes/GameScene';

export class Base extends Phaser.GameObjects.Container implements Targetable {
  readonly team: Team;
  hp: number;
  maxHp: number;
  alive = true;
  radius = BASE_RADIUS;
  /** Portais da Sobrevivência não podem ser destruídos. */
  invulnerable = false;

  private battle: GameScene;
  private sprite: Phaser.GameObjects.Image;
  private glow: Phaser.GameObjects.Image;
  private turretTimer = TURRET_COOLDOWN;
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

  update(dt: number): void {
    if (!this.alive) return;
    this.turretTimer -= dt;
    if (this.turretTimer <= 0) {
      const target = this.battle.nearestEnemyUnit(this.team, this.x, this.y, TURRET_RANGE);
      if (target) {
        this.turretTimer = TURRET_COOLDOWN;
        this.battle.fireTurretBolt(this, target, TURRET_DAMAGE);
      } else {
        this.turretTimer = 0.1;
      }
    }
  }

  takeDamage(amount: number): void {
    if (!this.alive || this.invulnerable) return;
    this.hp = Math.max(0, this.hp - amount);
    bus.emit(Evt.BaseHp, this.team, this.hp, this.maxHp);
    // Tremor proporcional + flash do cristal.
    this.battle.tweens.add({
      targets: this.sprite,
      x: Phaser.Math.Between(-4, 4),
      y: Phaser.Math.Between(-3, 3),
      duration: 45,
      yoyo: true,
      repeat: 2,
      onComplete: () => this.sprite.setPosition(0, 0),
    });
    this.battle.onBaseHit(this);
    if (this.hp <= 0) {
      this.alive = false;
      this.battle.onBaseDestroyed(this);
    }
  }

  get teamColor(): number {
    return this.color;
  }
}
