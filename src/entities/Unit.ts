/**
 * Unit.ts — Entidade de combate.
 * Cada unidade é um agente autônomo com sua própria máquina de estados:
 *   avançar -> engajar (atacar/curar) -> morrer.
 * Animações são 100% procedurais (bob de caminhada, investida de ataque,
 * flash de dano, tremor de recuo), o que dá vida sem spritesheets.
 */
import Phaser from 'phaser';
import type { Targetable, Team, UnitDef } from '../../shared/types';
import { DEPTH, UNIT_VISUAL_SCALE } from '../../shared/constants';
import { TextureFactory } from '../gfx/TextureFactory';
import type { GameScene } from '../scenes/GameScene';

export class Unit extends Phaser.GameObjects.Container implements Targetable {
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
  private attackTimer: number;
  private walkPhase = Math.random() * Math.PI * 2;
  private flashTimer = 0;
  private lunging = false;

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
    this.attackTimer = def.attackCooldown * 0.5;

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

  /** Direção de avanço no eixo Y (jogador sobe, inimigo desce). */
  get dir(): number {
    return this.team === 'player' ? -1 : 1;
  }

  /** Peso tático usado pela IA (custo da carta). */
  get power(): number {
    return this.def.cost / (this.def.count ?? 1);
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.attackTimer -= dt;
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) this.sprite.clearTint();
    }

    // 1) Suporte: curar aliado ferido tem prioridade.
    if (this.def.healer) {
      const ally = this.battle.acquireHealTarget(this);
      if (ally && this.gapTo(ally) <= this.def.range) {
        this.engageHeal(ally);
        return;
      }
    }

    // 2) Combate: inimigo ao alcance.
    const target = this.battle.acquireTarget(this);
    if (target && this.gapTo(target) <= this.def.range) {
      this.engageAttack(target);
      return;
    }

    // 3) Avanço. Com alvo adquirido (ex.: a base, que fica no centro),
    // converge até ele — senão, unidades das faixas laterais passariam
    // reto pela base e sairiam do campo.
    if (target) {
      const ang = Math.atan2(target.y - this.y, target.x - this.x);
      this.x += Math.cos(ang) * this.def.speed * dt;
      this.y += Math.sin(ang) * this.def.speed * dt;
    } else {
      this.y += this.dir * this.def.speed * dt;
    }
    this.walkPhase += dt * (6 + this.def.speed * 0.06);
    this.sprite.y = -Math.abs(Math.sin(this.walkPhase)) * 4;
    this.sprite.rotation = Math.sin(this.walkPhase) * 0.05;
    this.setDepth(DEPTH.unitsBase + this.y);
  }

  /** Distância borda-a-borda até um alvo. */
  private gapTo(t: Targetable): number {
    return (
      Phaser.Math.Distance.Between(this.x, this.y, t.x, t.y) - t.radius - this.radius
    );
  }

  private engageAttack(target: Targetable): void {
    this.sprite.rotation = 0;
    this.sprite.y = 0;
    if (this.attackTimer > 0) return;
    this.attackTimer = this.def.attackCooldown;

    if (this.def.projectileSpeed) {
      this.battle.fireProjectile(this, target, false);
    } else {
      // Investida corpo a corpo.
      this.melee(target);
    }
  }

  private melee(target: Targetable): void {
    if (this.lunging) return;
    this.lunging = true;
    // Investida na direção real do alvo (eixo Y — o corredor de avanço).
    const lungeY = this.dir * 14;
    this.battle.tweens.add({
      targets: this.sprite,
      y: lungeY,
      duration: 70,
      yoyo: true,
      ease: Phaser.Math.Easing.Quadratic.Out,
      onYoyo: () => {
        if (!this.alive) return;
        this.battle.applyHit(this, target, this.def.damage, this.def.splashRadius);
      },
      onComplete: () => {
        this.lunging = false;
        if (this.sprite.active) this.sprite.y = 0;
      },
    });
  }

  private engageHeal(ally: Unit): void {
    this.sprite.rotation = 0;
    this.sprite.y = 0;
    if (this.attackTimer > 0) return;
    this.attackTimer = this.def.attackCooldown;
    this.battle.fireProjectile(this, ally, true);
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.sprite.setTintFill(0xffffff);
    this.flashTimer = 0.07;
    this.redrawHpBar();
    if (this.hp <= 0) this.die();
  }

  heal(amount: number): void {
    if (!this.alive || this.hp >= this.maxHp) return;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    this.sprite.setTint(0x9dffb8);
    this.flashTimer = 0.12;
    this.redrawHpBar();
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

  private die(): void {
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
