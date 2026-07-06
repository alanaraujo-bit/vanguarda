/**
 * netProtocol.ts — Contrato de eventos Socket.IO entre client e server.
 * Nenhuma lógica aqui — só os tipos das mensagens trocadas na sala de
 * partida (Fase 0: pareamento por código; a fila de matchmaking da Fase 1
 * usa o mesmo contrato de sala por baixo).
 */
import type { Team, UnitKey } from './types';

/** Eventos que o CLIENTE emite para o servidor. */
export interface ClientToServerEvents {
  /** Entra numa sala pelo código (Fase 0) ou fila de matchmaking (Fase 1). */
  'room:join': (payload: { roomCode: string }) => void;
  /** Pedido de invocação — servidor valida contra a energia-sombra antes de retransmitir. */
  'deploy:request': (payload: { key: UnitKey; lane: number; clientTime: number }) => void;
  /** Relato independente de fim de partida (ver protocolo de corroboração no plano). */
  'match:report': (payload: MatchReport) => void;
  /** Abandono explícito (botão ABANDONAR) — equivale a um forfeit imediato. */
  'match:forfeit': () => void;
}

/** Eventos que o SERVIDOR emite para os clientes. */
export interface ServerToClientEvents {
  /** Os dois jogadores entraram; inclui o epoch canônico de início (ancora os clocks). */
  'match:start': (payload: { matchId: string; startEpochMs: number; opponent: PublicPlayerInfo }) => void;
  /** Comando aceito pela energia-sombra, retransmitido com o tick do servidor (para ambos os lados). */
  'deploy:relay': (payload: { team: Team; key: UnitKey; lane: number; serverTick: number }) => void;
  /** Comando rejeitado (energia insuficiente na sombra) — só o remetente recebe. */
  'deploy:rejected': (payload: { reason: 'insufficient-energy' | 'match-over' }) => void;
  /** Resultado final reconciliado (ver reconciliação de HP% no plano). */
  'match:resolved': (payload: MatchResolution) => void;
  /** Oponente caiu — início da janela de graça antes do forfeit automático. */
  'match:opponent-disconnected': (payload: { graceMs: number }) => void;
  'match:opponent-reconnected': () => void;
}

export interface PublicPlayerInfo {
  userId: string;
  displayName: string;
  trophies: number;
}

export interface MatchReport {
  outcome: 'win' | 'loss' | 'draw';
  myBaseHpPct: number;
  theirBaseHpPctObserved: number;
}

export interface MatchResolution {
  outcome: 'win' | 'loss' | 'draw' | 'voided';
  trophyDelta: number;
}

/* --------------------------------- REST /auth -------------------------------- */

export interface PublicProfile {
  userId: string;
  displayName: string;
  trophies: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  profile: PublicProfile;
}
