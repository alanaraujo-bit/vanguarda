/**
 * NetworkController.ts — Conexão Socket.IO de uma partida online (Fase 0:
 * pareamento por código de sala). Camada fina sobre o protocolo compartilhado
 * (shared/netProtocol.ts) — GameScene decide o que fazer com cada evento.
 */
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  MatchReport,
  MatchResolution,
  ServerToClientEvents,
} from '../../shared/netProtocol';
import type { MatchConfig, UnitKey } from '../../shared/types';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface MatchStartInfo {
  matchId: string;
  startEpochMs: number;
  opponentName: string;
  opponentTrophies: number;
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
        });
      });
      this.socket.emit('room:join', { roomCode });
    });
  }

  sendDeploy(key: UnitKey, lane: number): void {
    this.socket.emit('deploy:request', { key, lane, clientTime: Date.now() });
  }

  onDeployRelay(cb: (key: UnitKey, lane: number) => void): void {
    this.socket.on('deploy:relay', (p) => cb(p.key, p.lane));
  }

  onDeployRejected(cb: (reason: string) => void): void {
    this.socket.on('deploy:rejected', (p) => cb(p.reason));
  }

  sendReport(report: MatchReport): void {
    this.socket.emit('match:report', report);
  }

  onResolved(cb: (resolution: MatchResolution) => void): void {
    this.socket.on('match:resolved', cb);
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
