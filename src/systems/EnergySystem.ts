/**
 * EnergySystem.ts — Economia de energia de um lado do combate.
 * Instanciado duas vezes por partida (jogador e bot), com multiplicadores
 * independentes (dificuldade, Sobrecarga, modo treino).
 */
import { ENERGY_MAX, ENERGY_REGEN, ENERGY_START } from '../config/constants';

export class EnergySystem {
  current: number;
  readonly max: number;
  /** Multiplicador de regeneração (dificuldade, sobrecarga...). */
  mult = 1;

  private regen: number;

  constructor(regenPerSec = ENERGY_REGEN, start = ENERGY_START, max = ENERGY_MAX) {
    this.regen = regenPerSec;
    this.current = start;
    this.max = max;
  }

  update(dt: number): void {
    if (this.current < this.max) {
      this.current = Math.min(this.max, this.current + this.regen * this.mult * dt);
    }
  }

  canAfford(cost: number): boolean {
    return this.current >= cost;
  }

  trySpend(cost: number): boolean {
    if (!this.canAfford(cost)) return false;
    this.current -= cost;
    return true;
  }
}
