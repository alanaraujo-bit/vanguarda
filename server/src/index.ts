/**
 * index.ts — Entrypoint do backend do modo online.
 * Um único processo Fastify (REST) + Socket.IO (relay de partidas), como
 * decidido no plano — mais simples de operar num projeto solo no Railway.
 */
import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Server as SocketIOServer } from 'socket.io';
import { ZodError } from 'zod';
import { authRoutes } from './routes/auth.js';
import { registerMatchGateway } from './match/gateway.js';

const PORT = Number(process.env.PORT ?? 8080);
const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = Fastify({ logger: true });

await app.register(cors, { origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : true });
await app.register(rateLimit, { global: false });

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: 'validation-error', issues: err.issues });
  }
  app.log.error(err);
  return reply.code(500).send({ error: 'internal-error' });
});

app.get('/health', async () => ({ ok: true, time: Date.now() }));
await app.register(authRoutes);

await app.ready();

const io = new SocketIOServer(app.server, {
  cors: { origin: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : true },
});

io.on('connection', (socket) => {
  app.log.info({ socketId: socket.id }, 'socket conectado');
  socket.on('disconnect', (reason) => {
    app.log.info({ socketId: socket.id, reason }, 'socket desconectado');
  });
});

registerMatchGateway(io);

await app.listen({ port: PORT, host: '0.0.0.0' });
