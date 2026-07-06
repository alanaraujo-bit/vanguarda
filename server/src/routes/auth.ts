/**
 * auth.ts — Registro, login, refresh (com rotação + detecção de reuso) e logout.
 * Rate limit só nas rotas sensíveis (login/register) — as demais usam o
 * limite padrão do Fastify (nenhum, já que @fastify/rate-limit está com
 * global:false).
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { profiles, refreshTokens, users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { generateRefreshToken, hashToken, signAccessToken, verifyAccessToken } from '../auth/tokens.js';

const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9 _-]+$/, 'apenas letras, números, espaço, _ e -'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

async function issueSession(userId: string) {
  const refresh = generateRefreshToken();
  await db
    .insert(refreshTokens)
    .values({ userId, tokenHash: refresh.hash, expiresAt: refresh.expiresAt });
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, userId) });
  return { accessToken: signAccessToken(userId), refreshToken: refresh.raw, profile };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const body = registerSchema.parse(req.body);
      const email = body.email.toLowerCase();
      const displayNameLower = body.displayName.toLowerCase();

      if (await db.query.users.findFirst({ where: eq(users.email, email) })) {
        return reply.code(409).send({ error: 'email-in-use' });
      }
      if (
        await db.query.profiles.findFirst({ where: eq(profiles.displayNameLower, displayNameLower) })
      ) {
        return reply.code(409).send({ error: 'display-name-in-use' });
      }

      const passwordHash = await hashPassword(body.password);
      const [user] = await db.insert(users).values({ email, passwordHash }).returning();
      await db
        .insert(profiles)
        .values({ userId: user.id, displayName: body.displayName, displayNameLower });

      return reply.code(201).send(await issueSession(user.id));
    }
  );

  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const body = loginSchema.parse(req.body);
      const user = await db.query.users.findFirst({ where: eq(users.email, body.email.toLowerCase()) });
      if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
        return reply.code(401).send({ error: 'invalid-credentials' });
      }
      return reply.send(await issueSession(user.id));
    }
  );

  app.post('/auth/refresh', async (req, reply) => {
    const body = refreshSchema.parse(req.body);
    const tokenHash = hashToken(body.refreshToken);
    const row = await db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, tokenHash) });
    if (!row) return reply.code(401).send({ error: 'invalid-refresh-token' });

    if (row.revokedAt) {
      // Reuso de um token já rotacionado = sinal de roubo: derruba a sessão inteira.
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.userId, row.userId));
      return reply.code(401).send({ error: 'refresh-token-reused' });
    }
    if (row.expiresAt.getTime() < Date.now()) {
      return reply.code(401).send({ error: 'refresh-token-expired' });
    }

    const next = generateRefreshToken();
    const [inserted] = await db
      .insert(refreshTokens)
      .values({ userId: row.userId, tokenHash: next.hash, expiresAt: next.expiresAt })
      .returning();
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedBy: inserted.id })
      .where(eq(refreshTokens.id, row.id));

    return reply.send({ accessToken: signAccessToken(row.userId), refreshToken: next.raw });
  });

  app.post('/auth/logout', async (req, reply) => {
    const body = refreshSchema.parse(req.body);
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, hashToken(body.refreshToken)));
    return reply.code(204).send();
  });

  app.get('/auth/me', async (req, reply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return reply.code(401).send({ error: 'missing-token' });
    try {
      const payload = verifyAccessToken(auth.slice(7));
      const profile = await db.query.profiles.findFirst({ where: eq(profiles.userId, payload.sub) });
      if (!profile) return reply.code(404).send({ error: 'profile-not-found' });
      return reply.send({ profile });
    } catch {
      return reply.code(401).send({ error: 'invalid-token' });
    }
  });
}
