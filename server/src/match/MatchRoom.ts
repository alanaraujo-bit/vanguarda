/**
 * MatchRoom.ts — Uma sala de partida 1v1 (Fase 0: pareamento por código).
 * O servidor É a simulação: mantém o SimState canônico e roda shared/sim
 * (engine.step) em tick fixo — os clientes só recebem snapshots/eventos e
 * mandam pedidos de invocação. Só existe um veredito, calculado uma vez,
 * aqui. Ver plano "Multiplayer: simulação autoritativa no servidor".
 */
import type { Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { createInitialState, step } from '../../../shared/sim/engine.js';
import { Rng } from '../../../shared/sim/rng.js';
import type { DeployCommand, SimState } from '../../../shared/sim/types.js';
import { computeTrophyDelta } from '../../../shared/trophies.js';
import type { Team, UnitKey } from '../../../shared/types.js';
import { buildSnapshot, mapEvents } from './perspective.js';
import { finalizeMatch } from './persist.js';

const START_DELAY_MS = 1500;
const DISCONNECT_GRACE_MS = 20_000;
const TICK_MS = 50;
const TICK_SECONDS = TICK_MS / 1000;

export interface PlayerInfo {
  userId: string;
  displayName: string;
  trophies: number;
}

interface Slot {
  userId: string;
  displayName: string;
  trophies: number;
  socket: Socket;
  /** Lado fixo na simulação canônica — sempre o mesmo, do join até o fim da partida. */
  simTeam: Team;
  connected: boolean;
  disconnectTimer: NodeJS.Timeout | null;
  pendingCommands: DeployCommand[];
}

export class MatchRoom {
  readonly roomCode: string;
  readonly mode: 'ranked' | 'friendly';
  matchId: string | null = null;
  status: 'waiting' | 'active' | 'resolved' = 'waiting';
  startEpochMs = 0;

  private slots: Slot[] = [];
  private state: SimState | null = null;
  private rng: Rng | null = null;
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(
    roomCode: string,
    private readonly onEmpty: (room: MatchRoom) => void,
    mode: 'ranked' | 'friendly' = 'ranked'
  ) {
    this.roomCode = roomCode;
    this.mode = mode;
  }

  get isFull(): boolean {
    return this.slots.length >= 2;
  }

  /** @returns false se a sala já estava cheia (chamador deve rejeitar o socket). */
  join(socket: Socket, info: PlayerInfo): boolean {
    // Reconexão: mesmo usuário, sala ainda ativa, slot dele desconectado.
    const existing = this.slots.find((s) => s.userId === info.userId);
    if (existing) {
      existing.socket = socket;
      existing.connected = true;
      if (existing.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = null;
      }
      this.other(existing)?.socket.emit('match:opponent-reconnected');
      if (this.status === 'active') {
        socket.emit('match:start', {
          matchId: this.matchId!,
          startEpochMs: this.startEpochMs,
          opponent: this.publicInfo(this.other(existing)!),
          simTeam: existing.simTeam,
        });
      }
      return true;
    }

    if (this.isFull) return false;
    const slot: Slot = {
      userId: info.userId,
      displayName: info.displayName,
      trophies: info.trophies,
      socket,
      // Primeiro a entrar fica no lado canônico 'player' (embaixo); o segundo, 'enemy'.
      simTeam: this.slots.length === 0 ? 'player' : 'enemy',
      connected: true,
      disconnectTimer: null,
      pendingCommands: [],
    };
    this.slots.push(slot);
    if (this.slots.length === 2) this.start();
    return true;
  }

  private start(): void {
    this.status = 'active';
    this.startEpochMs = Date.now() + START_DELAY_MS;
    this.matchId = randomUUID();
    this.state = createInitialState();
    this.rng = new Rng(Date.now() >>> 0);

    for (const slot of this.slots) {
      slot.socket.emit('match:start', {
        matchId: this.matchId,
        startEpochMs: this.startEpochMs,
        opponent: this.publicInfo(this.other(slot)!),
        simTeam: slot.simTeam,
      });
    }
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  handleDeploy(socket: Socket, key: UnitKey, lane: number): void {
    const slot = this.slots.find((s) => s.socket.id === socket.id);
    if (!slot) return;
    if (this.status !== 'active') {
      socket.emit('deploy:rejected', { reason: 'match-over' });
      return;
    }
    slot.pendingCommands.push({ team: slot.simTeam, key, lane });
  }

  private tick(): void {
    if (this.status !== 'active' || !this.state || !this.rng) return;
    // Aguarda o epoch combinado — os dois lados começam no mesmo instante.
    if (Date.now() < this.startEpochMs) return;

    const combined: { slot: Slot; cmd: DeployCommand }[] = [];
    for (const slot of this.slots) {
      for (const cmd of slot.pendingCommands) combined.push({ slot, cmd });
      slot.pendingCommands = [];
    }

    const { events, results } = step(this.state, TICK_SECONDS, this.rng, combined.map((c) => c.cmd));

    results.forEach((r, i) => {
      if (!r.ok) combined[i].slot.socket.emit('deploy:rejected', { reason: r.reason! });
    });

    for (const slot of this.slots) {
      if (!slot.connected) continue;
      slot.socket.emit('match:tick', {
        snapshot: buildSnapshot(this.state!, slot.simTeam),
        events: mapEvents(events, slot.simTeam),
      });
    }

    if (this.state.matchOver) this.finish(this.state.winner!);
  }

  handleDisconnect(socket: Socket): void {
    const slot = this.slots.find((s) => s.socket.id === socket.id);
    if (!slot) return;
    slot.connected = false;
    if (this.status !== 'active') {
      if (this.slots.every((s) => !s.connected)) this.onEmpty(this);
      return;
    }
    const opponent = this.other(slot);
    opponent?.socket.emit('match:opponent-disconnected', { graceMs: DISCONNECT_GRACE_MS });
    slot.disconnectTimer = setTimeout(() => {
      if (this.status === 'active' && opponent) this.finish(opponent.simTeam);
    }, DISCONNECT_GRACE_MS);
  }

  /** Abandono explícito (botão ABANDONAR) — forfeit imediato, sem janela de graça. */
  handleForfeit(socket: Socket): void {
    const slot = this.slots.find((s) => s.socket.id === socket.id);
    const opponent = slot && this.other(slot);
    if (!slot || !opponent || this.status !== 'active') return;
    this.finish(opponent.simTeam);
  }

  private finish(winner: Team | 'draw'): void {
    if (this.status !== 'active') return;
    this.status = 'resolved';
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    for (const s of this.slots) {
      if (s.disconnectTimer) clearTimeout(s.disconnectTimer);
    }

    const [a, b] = this.slots; // a.simTeam === 'player', b.simTeam === 'enemy' (fixado no join)
    const outcomeFor = (slot: Slot): 'win' | 'loss' | 'draw' =>
      winner === 'draw' ? 'draw' : winner === slot.simTeam ? 'win' : 'loss';

    const deltaA = computeTrophyDelta(a.trophies, b.trophies, outcomeFor(a));
    const deltaB = computeTrophyDelta(b.trophies, a.trophies, outcomeFor(b));
    const state = this.state!;

    a.socket.emit('match:ended', { outcome: outcomeFor(a), trophyDelta: deltaA, stats: state.stats[a.simTeam] });
    b.socket.emit('match:ended', { outcome: outcomeFor(b), trophyDelta: deltaB, stats: state.stats[b.simTeam] });

    // Best-effort: os clientes já têm o resultado: um erro aqui não deve travar a sala.
    void finalizeMatch({
      matchId: this.matchId!,
      mode: this.mode,
      playerAId: a.userId,
      playerBId: b.userId,
      outcome: winner === 'draw' ? 'draw' : winner === 'player' ? 'a_win' : 'b_win',
      trophyDeltaA: deltaA,
      trophyDeltaB: deltaB,
      startedAtMs: this.startEpochMs,
    }).catch((err) => console.error('[match] falha ao persistir resultado:', err));

    this.onEmpty(this);
  }

  private other(slot: Slot): Slot | undefined {
    return this.slots.find((s) => s !== slot);
  }

  private publicInfo(slot: Slot): { userId: string; displayName: string; trophies: number } {
    return { userId: slot.userId, displayName: slot.displayName, trophies: slot.trophies };
  }
}
