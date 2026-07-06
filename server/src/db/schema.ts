/**
 * schema.ts — Schema Drizzle v1 (Fase 0).
 * Clãs/amizades ficam fora por enquanto (Fase 2). Patente não é uma coluna:
 * é sempre derivada de profiles.trophies via shared/ranks.ts.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const matchStatusEnum = pgEnum('match_status', [
  'pending',
  'active',
  'completed',
  'voided',
  'forfeited',
]);
export const matchOutcomeEnum = pgEnum('match_outcome', ['a_win', 'b_win', 'draw']);
/** Outcome relativo autorreportado por um jogador (ele não sabe se é "a" ou "b"). */
export const selfOutcomeEnum = pgEnum('self_outcome', ['win', 'loss', 'draw']);
export const matchModeEnum = pgEnum('match_mode', ['ranked', 'friendly']);
export const challengeStatusEnum = pgEnum('challenge_status', [
  'pending',
  'accepted',
  'declined',
  'expired',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  // Reuso de um token já rotacionado revoga a família inteira (detecção de roubo).
  replacedBy: uuid('replaced_by'),
});

export const profiles = pgTable(
  'profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    // Coluna normalizada só para a unicidade — evita "Alan"/"alan" coexistindo.
    displayNameLower: text('display_name_lower').notNull(),
    trophies: integer('trophies').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    losses: integer('losses').notNull().default(0),
    draws: integer('draws').notNull().default(0),
    // XP vitalício da conta (qualquer modo, não só ranqueado) — ver shared/netProtocol.ts.
    // Distinto do XP local do SaveManager (por aparelho, moeda de skins/títulos).
    xp: integer('xp').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('profiles_display_name_lower_idx').on(t.displayNameLower),
    index('profiles_trophies_idx').on(t.trophies),
    index('profiles_wins_idx').on(t.wins),
    index('profiles_xp_idx').on(t.xp),
  ]
);

export const matches = pgTable('matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerAId: uuid('player_a_id')
    .notNull()
    .references(() => users.id),
  playerBId: uuid('player_b_id')
    .notNull()
    .references(() => users.id),
  status: matchStatusEnum('status').notNull().default('pending'),
  outcome: matchOutcomeEnum('outcome'),
  trophyDeltaA: integer('trophy_delta_a'),
  trophyDeltaB: integer('trophy_delta_b'),
  mode: matchModeEnum('mode').notNull().default('ranked'),
  durationSec: integer('duration_sec'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
});

/** Os dois relatos independentes de cada partida — nunca uma única fonte de verdade. */
export const matchReports = pgTable(
  'match_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    outcome: selfOutcomeEnum('outcome').notNull(),
    myBaseHpPct: real('my_base_hp_pct').notNull(),
    theirBaseHpPctObserved: real('their_base_hp_pct_observed').notNull(),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('match_reports_match_id_idx').on(t.matchId)]
);

export const challenges = pgTable(
  'challenges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromUserId: uuid('from_user_id')
      .notNull()
      .references(() => users.id),
    toUserId: uuid('to_user_id')
      .notNull()
      .references(() => users.id),
    status: challengeStatusEnum('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    matchId: uuid('match_id').references(() => matches.id),
  },
  (t) => [
    // Só um convite pendente por par por vez (parcial: não conta aceito/recusado/expirado).
    uniqueIndex('challenges_pending_pair_idx')
      .on(t.fromUserId, t.toUserId)
      .where(sql`status = 'pending'`),
  ]
);
