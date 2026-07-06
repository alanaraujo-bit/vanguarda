/**
 * profile.ts — Sincronização do XP de conta ganho em modos offline (versus IA,
 * sobrevivência). Partidas ranqueadas online não passam por aqui: o servidor já
 * credita o XP sozinho em match/persist.ts, como única fonte de verdade daquele
 * modo. Aqui confiamos no cliente (sem simulação autoritativa pra validar), por
 * isso o clamp generoso porém finito no delta.
 */
import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { profiles } from '../db/schema.js';
import { requireUserId } from '../auth/guard.js';

const xpSchema = z.object({
  delta: z.number(),
});

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/profile/xp',
    { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const userId = requireUserId(req);
      if (!userId) return reply.code(401).send({ error: 'missing-token' });

      const body = xpSchema.parse(req.body);
      // Uma sobrevivência bem longa com bônus de conquista/missão ainda cabe
      // aqui; valores maiores só podem ser erro de cliente ou abuso.
      const delta = Math.round(Math.max(0, Math.min(3000, body.delta)));
      if (delta === 0) {
        const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
        if (!profile) return reply.code(404).send({ error: 'profile-not-found' });
        return reply.send({ xp: profile.xp });
      }

      const [updated] = await db
        .update(profiles)
        .set({ xp: sql`${profiles.xp} + ${delta}` })
        .where(eq(profiles.userId, userId))
        .returning({ xp: profiles.xp });
      if (!updated) return reply.code(404).send({ error: 'profile-not-found' });
      return reply.send({ xp: updated.xp });
    }
  );
}
