/**
 * WaveDirector.ts — Modo Sobrevivência.
 * Gera ondas com orçamento crescente, composição variada e ritmo
 * que aperta gradualmente. Ondas múltiplas de 5 trazem um Titã.
 */
import Phaser from 'phaser';
import type { UnitKey } from '../core/types';
import { UNIT_DEFS } from '../config/units';
import { LANE_COUNT } from '../config/constants';
import { bus, Evt } from '../core/events';
import type { GameScene } from '../scenes/GameScene';

/** Unidades elegíveis por peso (mais barato = mais comum). */
const WAVE_POOL: { key: UnitKey; weight: number; minWave: number }[] = [
  { key: 'faisca', weight: 5, minWave: 1 },
  { key: 'enxame', weight: 4, minWave: 1 },
  { key: 'agulha', weight: 4, minWave: 2 },
  { key: 'lamina', weight: 3, minWave: 3 },
  { key: 'lumen', weight: 2, minWave: 4 },
  { key: 'bastiao', weight: 3, minWave: 4 },
  { key: 'trovao', weight: 2, minWave: 6 },
  { key: 'tita', weight: 1, minWave: 8 },
];

export class WaveDirector {
  wave = 0;

  private game: GameScene;
  private timer = 4; // primeira onda chega rápido para dar o tom

  constructor(game: GameScene) {
    this.game = game;
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.wave++;
      this.timer = Math.max(12, 24 - this.wave * 0.6);
      this.spawnWave();
    }
  }

  private spawnWave(): void {
    bus.emit(Evt.Wave, this.wave);
    let budget = 4 + this.wave * 1.7;
    const picks: UnitKey[] = [];

    // Onda de chefe a cada 5: Titã garantido.
    if (this.wave % 5 === 0) {
      picks.push('tita');
      budget -= UNIT_DEFS.tita.cost;
    }
    const pool = WAVE_POOL.filter((p) => p.minWave <= this.wave);
    let guard = 40;
    while (budget >= 2 && guard-- > 0) {
      const total = pool.reduce((s, p) => s + p.weight, 0);
      let roll = Math.random() * total;
      for (const p of pool) {
        roll -= p.weight;
        if (roll <= 0) {
          if (UNIT_DEFS[p.key].cost <= budget) {
            picks.push(p.key);
            budget -= UNIT_DEFS[p.key].cost;
          }
          break;
        }
      }
    }

    // Invoca escalonado, distribuído entre as faixas.
    picks.forEach((key, i) => {
      const lane =
        i < LANE_COUNT ? i % LANE_COUNT : Phaser.Math.Between(0, LANE_COUNT - 1);
      this.game.time.delayedCall(i * 450, () => {
        this.game.deployUnit('enemy', key, lane, true);
      });
    });
  }
}
