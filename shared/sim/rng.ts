/**
 * shared/sim/rng.ts — RNG determinístico (mulberry32).
 * Tudo que afeta o estado da simulação (jitter de spawn, sorteio de onda)
 * precisa vir daqui, nunca de Math.random()/Phaser.Math — senão servidor e
 * cliente(s) podem produzir estados diferentes a partir da mesma entrada.
 */

export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Float em [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inteiro em [min, max], inclusive — equivalente a Phaser.Math.Between. */
  between(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.between(0, arr.length - 1)];
  }
}
