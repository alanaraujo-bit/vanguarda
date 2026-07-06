/**
 * guard.ts — Extrai o userId de um `Authorization: Bearer` válido.
 * Usado por qualquer rota autenticada (perfil, XP, ranking pessoal...).
 */
import type { FastifyRequest } from 'fastify';
import { verifyAccessToken } from './tokens.js';

/** @returns o userId do token, ou null se ausente/expirado/inválido. */
export function requireUserId(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return verifyAccessToken(auth.slice(7)).sub;
  } catch {
    return null;
  }
}
