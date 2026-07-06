/**
 * trophies.ts — Cálculo de delta de troféus (estilo ELO leve).
 * Roda SÓ no servidor (nunca confiar em delta vindo do cliente): o
 * resultado depende dos troféus dos dois lados, não é um valor fixo, o que
 * desincentiva smurfing (vencer alguém muito mais fraco rende pouco).
 */

const K_FACTOR = 30;

/** Probabilidade esperada de vitória de "mine" contra "opponent" (Elo). */
function expectedScore(mine: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - mine) / 400));
}

/**
 * Delta de troféus para o lado "mine" dado o resultado da partida.
 * @returns inteiro (pode ser negativo); aplicar com floor em 0 no total final.
 */
export function computeTrophyDelta(
  mine: number,
  opponent: number,
  outcome: 'win' | 'loss' | 'draw'
): number {
  const score = outcome === 'win' ? 1 : outcome === 'loss' ? 0 : 0.5;
  const delta = K_FACTOR * (score - expectedScore(mine, opponent));
  return Math.round(delta);
}
