/**
 * Projectile.ts — Projéteis do combate.
 * Dois modos de voo:
 *   - reto/teleguiado (dardos, pulsos de cura, tiros de torreta)
 *   - balístico em arco (artilharia do Trovão)
 * O impacto é delegado por callback: o projétil não conhece regras de dano.
 */
import Phaser from 'phaser';
import type { Targetable } from '../../shared/types';
import { DEPTH } from '../../shared/constants';

export interface ProjectileConfig {
  x: number;
  y: number;
  texture: string;
  tint: number;
  target: Targetable;
  speed: number;
  arc?: boolean;
  onHit: (x: number, y: number) => void;
}

export class Projectile extends Phaser.GameObjects.Image {
  done = false;

  private target: Targetable;
  private speed: number;
  private arc: boolean;
  private onHit: (x: number, y: number) => void;
  /** Últimas coordenadas conhecidas do alvo (caso ele morra em voo). */
  private aimX: number;
  private aimY: number;
  // Estado do voo em arco.
  private startX = 0;
  private startY = 0;
  private flightT = 0;
  private flightDur = 1;
  private arcHeight = 0;

  constructor(scene: Phaser.Scene, cfg: ProjectileConfig) {
    super(scene, cfg.x, cfg.y, cfg.texture);
    this.setTint(cfg.tint);
    this.setDepth(DEPTH.projectiles);
    this.target = cfg.target;
    this.speed = cfg.speed;
    this.arc = cfg.arc ?? false;
    this.onHit = cfg.onHit;
    this.aimX = cfg.target.x;
    this.aimY = cfg.target.y;

    if (this.arc) {
      this.startX = cfg.x;
      this.startY = cfg.y;
      const dist = Phaser.Math.Distance.Between(cfg.x, cfg.y, this.aimX, this.aimY);
      this.flightDur = Math.max(0.35, dist / this.speed);
      this.arcHeight = Phaser.Math.Clamp(dist * 0.32, 40, 150);
    }
    scene.add.existing(this);
  }

  update(dt: number): void {
    if (this.done) return;

    if (this.arc) {
      // Balístico: alvo fixado no disparo (permite esquiva natural).
      this.flightT += dt;
      const t = Math.min(1, this.flightT / this.flightDur);
      const x = Phaser.Math.Linear(this.startX, this.aimX, t);
      const baseY = Phaser.Math.Linear(this.startY, this.aimY, t);
      const y = baseY - Math.sin(t * Math.PI) * this.arcHeight;
      this.setRotation(Math.atan2(y - this.y, x - this.x));
      this.setPosition(x, y);
      if (t >= 1) this.impact();
      return;
    }

    // Teleguiado: persegue enquanto o alvo viver.
    if (this.target.alive) {
      this.aimX = this.target.x;
      this.aimY = this.target.y;
    }
    const dist = Phaser.Math.Distance.Between(this.x, this.y, this.aimX, this.aimY);
    const step = this.speed * dt;
    if (dist <= Math.max(step, 14)) {
      this.impact();
      return;
    }
    const angle = Math.atan2(this.aimY - this.y, this.aimX - this.x);
    this.setRotation(angle);
    this.x += Math.cos(angle) * step;
    this.y += Math.sin(angle) * step;
  }

  private impact(): void {
    this.done = true;
    this.onHit(this.aimX, this.aimY);
    this.destroy();
  }
}
