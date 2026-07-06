/**
 * persist.ts — Grava o resultado final de uma partida: a linha em `matches`
 * e o delta de troféus nos `profiles`. Chamado uma única vez por sala
 * resolvida. `match_reports` não recebe mais linhas — era a auditoria dos
 * relatos independentes de cada cliente, e o servidor agora é a única fonte
 * de verdade (nada para reconciliar/disputar). A tabela fica no schema por
 * enquanto (histórico de partidas antigas), mas pode ser removida depois.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { matches, profiles } from '../db/schema.js';

export type FinalizeOutcome = 'a_win' | 'b_win' | 'draw';

export interface FinalizeInput {
  matchId: string;
  mode: 'ranked' | 'friendly';
  playerAId: string;
  playerBId: string;
  outcome: FinalizeOutcome;
  trophyDeltaA: number;
  trophyDeltaB: number;
  startedAtMs: number;
}

export async function finalizeMatch(input: FinalizeInput): Promise<void> {
  // Pode ser negativo se a partida resolver antes do START_DELAY_MS decorrer (ex.: forfeit instantâneo).
  const durationSec = Math.max(0, Math.round((Date.now() - input.startedAtMs) / 1000));

  await db.insert(matches).values({
    id: input.matchId,
    playerAId: input.playerAId,
    playerBId: input.playerBId,
    status: 'completed',
    outcome: input.outcome,
    trophyDeltaA: input.trophyDeltaA,
    trophyDeltaB: input.trophyDeltaB,
    mode: input.mode,
    durationSec,
    startedAt: new Date(input.startedAtMs),
    endedAt: new Date(),
  });

  await applyTrophyDelta(
    input.playerAId,
    input.trophyDeltaA,
    input.outcome === 'a_win' ? 'win' : input.outcome === 'b_win' ? 'loss' : 'draw'
  );
  await applyTrophyDelta(
    input.playerBId,
    input.trophyDeltaB,
    input.outcome === 'b_win' ? 'win' : input.outcome === 'a_win' ? 'loss' : 'draw'
  );
}

async function applyTrophyDelta(
  userId: string,
  delta: number,
  outcome: 'win' | 'loss' | 'draw'
): Promise<void> {
  const statColumn =
    outcome === 'win' ? { wins: sql`${profiles.wins} + 1` } :
    outcome === 'loss' ? { losses: sql`${profiles.losses} + 1` } :
    { draws: sql`${profiles.draws} + 1` };

  await db
    .update(profiles)
    .set({ trophies: sql`GREATEST(0, ${profiles.trophies} + ${delta})`, ...statColumn })
    .where(eq(profiles.userId, userId));
}
