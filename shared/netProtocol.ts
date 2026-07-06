/**
 * netProtocol.ts — Contrato de eventos Socket.IO entre client e server.
 * Nenhuma lógica aqui — só os tipos das mensagens trocadas na sala de
 * partida. O servidor é a autoridade única da simulação (ver
 * shared/sim/engine.ts): ele manda snapshots/eventos, o cliente só
 * renderiza e informa seus pedidos de invocação.
 */
import type { DeployResult, SimEvent } from './sim/types';
import type { CardKey, Team, UnitKey } from './types';

/** Eventos que o CLIENTE emite para o servidor. */
export interface ClientToServerEvents {
  /** Entra numa sala pelo código (Fase 0) ou fila de matchmaking (Fase 1). */
  'room:join': (payload: { roomCode: string }) => void;
  /** Pedido de invocação — servidor valida contra a energia real da simulação.
   * `x`/`y` são o alvo de feitiços, na perspectiva de quem envia (o servidor
   * espelha para a simulação canônica). */
  'deploy:request': (payload: { key: CardKey; lane: number; x?: number; y?: number }) => void;
  /** Abandono explícito (botão ABANDONAR) — equivale a um forfeit imediato. */
  'match:forfeit': () => void;
}

/** Eventos que o SERVIDOR emite para os clientes. */
export interface ServerToClientEvents {
  /** Os dois jogadores entraram; inclui o epoch canônico de início e o time do
   * destinatário na simulação (a partir daqui os dois sempre se veem como "player"
   * — a tradução acontece no cliente, não na simulação). */
  'match:start': (payload: {
    matchId: string;
    startEpochMs: number;
    opponent: PublicPlayerInfo;
    simTeam: Team;
  }) => void;
  /** Estado + eventos discretos de um tick da simulação autoritativa. */
  'match:tick': (payload: { snapshot: MatchSnapshot; events: SimEvent[] }) => void;
  /** Pedido de invocação rejeitado (energia, limite de tropas, partida encerrada). */
  'deploy:rejected': (payload: { reason: NonNullable<DeployResult['reason']> | 'match-over' }) => void;
  /** Resultado final — decidido uma única vez, pelo servidor. */
  'match:ended': (payload: MatchResolution) => void;
  /** Oponente caiu — início da janela de graça antes do forfeit automático. */
  'match:opponent-disconnected': (payload: { graceMs: number }) => void;
  'match:opponent-reconnected': () => void;
}

export interface PublicPlayerInfo {
  userId: string;
  displayName: string;
  trophies: number;
}

/** Bits de status sincronizados por unidade (SnapshotUnit.st). */
export const STATUS_SLOW = 1;
export const STATUS_RAGE = 2;
export const STATUS_STUN = 4;

export interface SnapshotUnit {
  id: number;
  key: UnitKey;
  team: Team;
  lane: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Escudo restante (só presente quando > 0). */
  sh?: number;
  /** Bitmask de status (STATUS_SLOW | STATUS_RAGE | STATUS_STUN), ausente = nenhum. */
  st?: number;
}

export interface SnapshotProjectile {
  id: number;
  team: Team;
  sourceKey: UnitKey | null;
  arc: boolean;
  healing: boolean;
  x: number;
  y: number;
}

/** Estado sincronizado a cada tick. `myEnergy` é sempre a energia de quem recebe. */
export interface MatchSnapshot {
  timeLeft: number;
  overdriveOn: boolean;
  myEnergy: number;
  baseHp: { player: number; enemy: number };
  units: SnapshotUnit[];
  projectiles: SnapshotProjectile[];
}

export interface MatchResolution {
  outcome: 'win' | 'loss' | 'draw';
  trophyDelta: number;
  /** Estatísticas autoritativas do próprio lado — a base da progressão/XP local. */
  stats: { damageDealt: number; kills: number; deploys: number };
}

/* --------------------------------- REST /auth -------------------------------- */

export interface PublicProfile {
  userId: string;
  displayName: string;
  trophies: number;
  wins: number;
  losses: number;
  draws: number;
  /** XP vitalício da conta (qualquer modo) — distinto do XP local de skins/títulos. */
  xp: number;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  profile: PublicProfile;
}

/* ------------------------------- Ranking global ------------------------------ */

export type LeaderboardSort = 'trophies' | 'wins' | 'xp';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  trophies: number;
  wins: number;
  losses: number;
  draws: number;
  xp: number;
}

export interface LeaderboardResponse {
  sort: LeaderboardSort;
  entries: LeaderboardEntry[];
  /** Posição de quem pediu, mesmo fora do topo — null se anônimo. */
  me: LeaderboardEntry | null;
}
