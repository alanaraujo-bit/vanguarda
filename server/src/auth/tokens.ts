/**
 * tokens.ts — JWT de acesso (HS256, curto) + refresh token opaco (hash em DB).
 * O refresh token nunca é armazenado em texto puro — só o hash SHA-256, para
 * que um vazamento do banco não exponha tokens utilizáveis diretamente.
 */
import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET não definida (veja server/.env.example)');

const ACCESS_TTL = process.env.JWT_ACCESS_TTL ?? '15m';
const REFRESH_TTL_MS = parseTtlToMs(process.env.JWT_REFRESH_TTL ?? '30d');

export interface AccessTokenPayload {
  sub: string;
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET as string, {
    expiresIn: ACCESS_TTL,
    algorithm: 'HS256',
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, JWT_SECRET as string, { algorithms: ['HS256'] }) as AccessTokenPayload;
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(48).toString('hex');
  return { raw, hash: hashToken(raw), expiresAt: new Date(Date.now() + REFRESH_TTL_MS) };
}

function parseTtlToMs(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!m) throw new Error(`TTL inválida: "${ttl}" (use algo como 15m, 30d)`);
  const n = Number(m[1]);
  const mult = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 's' | 'm' | 'h' | 'd'];
  return n * mult;
}
