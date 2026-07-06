/**
 * NetworkController.ts — Conexão Socket.IO de uma partida online (Fase 0:
 * pareamento por código de sala). Camada fina sobre o protocolo compartilhado
 * (shared/netProtocol.ts) — o servidor é a autoridade da simulação; aqui só
 * repassamos snapshots/eventos/pedidos, GameScene decide o que renderizar.
 */
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  MatchSnapshot,
  MatchResolution,
  ServerToClientEvents,
} from '../../shared/netProtocol';
import type { SimEvent } from '../../shared/sim/types';
import type { MatchConfig, Team, UnitKey } from '../../shared/types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface MatchStartInfo {
  matchId: string;
  startEpochMs: number;
  opponentName: string;
  opponentTrophies: number;
  /** Lado do jogador na simulação canônica do servidor (ver server/src/match/perspective.ts). */
  simTeam: Team;
}

/** Extensão client-only de MatchConfig — nunca entra em shared/ (carrega o socket). */
export interface OnlineMatchConfig extends MatchConfig {
  online?: {
    startEpochMs: number;
    opponentName: string;
    network: NetworkController;
  };
}

export class NetworkController {
  private socket: GameSocket;

  constructor(accessToken: string) {
    this.socket = io(API_URL, { auth: { token: accessToken }, transports: ['websocket'] });
  }

  /** Entra na sala pelo código; resolve quando os dois lados estão presentes. */
  joinRoom(roomCode: string): Promise<MatchStartInfo> {
    return new Promise((resolve) => {
      this.socket.once('match:start', (payload) => {
        resolve({
          matchId: payload.matchId,
          startEpochMs: payload.startEpochMs,
          opponentName: payload.opponent.displayName,
          opponentTrophies: payload.opponent.trophies,
          simTeam: payload.simTeam,
        });
      });
      this.socket.emit('room:join', { roomCode });
    });
  }

  sendDeploy(key: UnitKey, lane: number): void {
    this.socket.emit('deploy:request', { key, lane });
  }

  onDeployRejected(cb: (reason: string) => void): void {
    this.socket.on('deploy:rejected', (p) => cb(p.reason));
  }

  /** Estado + eventos discretos de um tick da simulação autoritativa. */
  onTick(cb: (snapshot: MatchSnapshot, events: SimEvent[]) => void): void {
    this.socket.on('match:tick', (p) => cb(p.snapshot, p.events));
  }

  /** Resultado final — decidido uma única vez, pelo servidor. */
  onEnded(cb: (resolution: MatchResolution) => void): void {
    this.socket.on('match:ended', cb);
  }

  onOpponentDisconnected(cb: (graceMs: number) => void): void {
    this.socket.on('match:opponent-disconnected', (p) => cb(p.graceMs));
  }

  onOpponentReconnected(cb: () => void): void {
    this.socket.on('match:opponent-reconnected', cb);
  }

  forfeit(): void {
    this.socket.emit('match:forfeit');
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}
