/**
 * persist.ts — Grava o resultado final de uma partida: a linha em `matches`,
 * os relatos brutos em `match_reports` (auditoria/disputa) e o delta de
 * troféus nos `profiles`. Chamado uma única vez por sala resolvida.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { matches, matchReports, profiles } from '../db/schema.js';
import type { MatchReport } from '../../../shared/netProtocol.js';

export type FinalizeOutcome = 'a_win' | 'b_win' | 'draw' | 'voided';

export interface FinalizeInput {
  matchId: string;
  mode: 'ranked' | 'friendly';
  playerAId: string;
  playerBId: string;
  outcome: FinalizeOutcome;
  trophyDeltaA: number;
  trophyDeltaB: number;
  startedAtMs: number;
  /** Ausente quando o lado nunca chegou a relatar (ex.: forfeit por desconexão). */
  reportA?: MatchReport | null;
  reportB?: MatchReport | null;
}

export async function finalizeMatch(input: FinalizeInput): Promise<void> {
  // Pode ser negativo se a partida resolver antes do START_DELAY_MS decorrer (ex.: forfeit instantâneo).
  const durationSec = Math.max(0, Math.round((Date.now() - input.startedAtMs) / 1000));

  await db.insert(matches).values({
    id: input.matchId,
    playerAId: input.playerAId,
    playerBId: input.playerBId,
    status: input.outcome === 'voided' ? 'voided' : 'completed',
    outcome: input.outcome === 'voided' ? null : input.outcome,
    trophyDeltaA: input.trophyDeltaA,
    trophyDeltaB: input.trophyDeltaB,
    mode: input.mode,
    durationSec,
    startedAt: new Date(input.startedAtMs),
    endedAt: new Date(),
  });

  const reportRows = [
    input.reportA && { userId: input.playerAId, report: input.reportA },
    input.reportB && { userId: input.playerBId, report: input.reportB },
  ].filter((r): r is { userId: string; report: MatchReport } => !!r);

  if (reportRows.length > 0) {
    await db.insert(matchReports).values(
      reportRows.map(({ userId, report }) => ({
        matchId: input.matchId,
        userId,
        outcome: report.outcome,
        myBaseHpPct: report.myBaseHpPct,
        theirBaseHpPctObserved: report.theirBaseHpPctObserved,
      }))
    );
  }

  if (input.outcome === 'voided') return;

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
