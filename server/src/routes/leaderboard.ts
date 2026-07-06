/**
 * leaderboard.ts — Ranking global público, por troféus, vitórias (ranqueadas)
 * ou XP de conta. Rota pública (não exige login); se vier um Bearer válido,
 * a resposta inclui `me` com a posição de quem pediu, mesmo fora do topo.
 * Cache em memória curto (processo único do Fastify — ver index.ts) evita
 * bater no Postgres toda vez que alguém abre a tela.
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, gt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { profiles } from '../db/schema.js';
import { requireUserId } from '../auth/guard.js';

const SORT_COLUMNS = {
  trophies: profiles.trophies,
  wins: profiles.wins,
  xp: profiles.xp,
} as const;
type Sort = keyof typeof SORT_COLUMNS;

const querySchema = z.object({
  sort: z.enum(['trophies', 'wins', 'xp']).default('trophies'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

interface Entry {
  rank: number;
  userId: string;
  displayName: string;
  trophies: number;
  wins: number;
  losses: number;
  draws: number;
  xp: number;
}

const CACHE_TTL_MS = 20_000;
const topCache = new Map<string, { at: number; entries: Entry[] }>();

async function fetchTop(sort: Sort, limit: number): Promise<Entry[]> {
  const key = `${sort}:${limit}`;
  const cached = topCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.entries;

  const col = SORT_COLUMNS[sort];
  const rows = await db
    .select({
      userId: profiles.userId,
      displayName: profiles.displayName,
      trophies: profiles.trophies,
      wins: profiles.wins,
      losses: profiles.losses,
      draws: profiles.draws,
      xp: profiles.xp,
    })
    .from(profiles)
    .orderBy(desc(col), asc(profiles.userId))
    .limit(limit);

  const entries = rows.map((r, i) => ({ rank: i + 1, ...r }));
  topCache.set(key, { at: Date.now(), entries });
  return entries;
}

/** Posição de `userId` no critério `sort` — via contagem, sem depender do cache do topo. */
async function fetchMyRank(sort: Sort, userId: string): Promise<Entry | null> {
  const col = SORT_COLUMNS[sort];
  const me = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  if (!me) return null;

  const [{ ahead }] = await db
    .select({ ahead: sql<number>`count(*)::int` })
    .from(profiles)
    .where(or(gt(col, me[sort]), and(eq(col, me[sort]), sql`${profiles.userId} < ${userId}`)));

  return {
    rank: ahead + 1,
    userId: me.userId,
    displayName: me.displayName,
    trophies: me.trophies,
    wins: me.wins,
    losses: me.losses,
    draws: me.draws,
    xp: me.xp,
  };
}

export async function leaderboardRoutes(app: FastifyInstance): Promise<void> {
  app.get('/leaderboard', async (req, reply) => {
    const { sort, limit } = querySchema.parse(req.query);

    const entries = await fetchTop(sort, limit);
    const userId = requireUserId(req);
    const me = userId ? await fetchMyRank(sort, userId) : null;

    return reply.send({ sort, entries, me });
  });
}
