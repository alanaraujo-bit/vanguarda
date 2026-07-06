/**
 * MatchRoom.ts — Uma sala de partida 1v1 (Fase 0: pareamento por código).
 * O servidor NÃO resimula combate — só relay + validação de economia
 * (energia-sombra) + reconciliação do resultado final. Ver "Modelo de
 * rede — relay com corroboração" no plano para o raciocínio completo.
 */
import type { Socket } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { EnergySystem } from '../../../shared/EnergySystem.js';
import { UNIT_DEFS } from '../../../shared/units.js';
import { MATCH_DURATION, OVERDRIVE_AT } from '../../../shared/constants.js';
import { computeTrophyDelta } from '../../../shared/trophies.js';
import type { UnitKey } from '../../../shared/types.js';
import type { MatchReport } from '../../../shared/netProtocol.js';
import { finalizeMatch, type FinalizeOutcome } from './persist.js';

const START_DELAY_MS = 1500;
const DISCONNECT_GRACE_MS = 20_000;
const REPORT_WAIT_MS = 15_000;
/** Absorve pequenas divergências de latência/tick sem rejeitar um gasto legítimo. */
const ENERGY_TOLERANCE = 0.15;
/** Empate "apertado" no timer: HP% observado pelos dois lados bate dentro dessa margem. */
const RECONCILE_EPS = 0.08;

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
  energy: EnergySystem;
  lastEnergyTick: number;
  connected: boolean;
  report: MatchReport | null;
  disconnectTimer: NodeJS.Timeout | null;
}

export class MatchRoom {
  readonly roomCode: string;
  readonly mode: 'ranked' | 'friendly';
  matchId: string | null = null;
  status: 'waiting' | 'active' | 'resolved' = 'waiting';
  startEpochMs = 0;
  private tick = 0;
  private slots: Slot[] = [];
  private reportWaitTimer: NodeJS.Timeout | null = null;

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
      energy: new EnergySystem(),
      lastEnergyTick: Date.now(),
      connected: true,
      report: null,
      disconnectTimer: null,
    };
    this.slots.push(slot);
    if (this.slots.length === 2) this.start();
    return true;
  }

  private start(): void {
    this.status = 'active';
    this.startEpochMs = Date.now() + START_DELAY_MS;
    this.matchId = randomUUID();
    for (const slot of this.slots) {
      slot.lastEnergyTick = this.startEpochMs;
      slot.socket.emit('match:start', {
        matchId: this.matchId,
        startEpochMs: this.startEpochMs,
        opponent: this.publicInfo(this.other(slot)!),
      });
    }
  }

  handleDeploy(socket: Socket, key: UnitKey, lane: number): void {
    if (this.status !== 'active') return;
    const slot = this.slots.find((s) => s.socket.id === socket.id);
    const opponent = slot && this.other(slot);
    if (!slot || !opponent) return;
    const def = UNIT_DEFS[key];
    if (!def) return;

    this.tickEnergy(slot);
    if (slot.energy.current + ENERGY_TOLERANCE < def.cost) {
      socket.emit('deploy:rejected', { reason: 'insufficient-energy' });
      return;
    }
    slot.energy.current = Math.max(0, slot.energy.current - def.cost);

    this.tick += 1;
    opponent.socket.emit('deploy:relay', { team: 'enemy', key, lane, serverTick: this.tick });
  }

  /** Avança a energia-sombra até agora, aplicando o multiplicador de Sobrecarga. */
  private tickEnergy(slot: Slot): void {
    const now = Date.now();
    const dt = (now - slot.lastEnergyTick) / 1000;
    slot.lastEnergyTick = now;
    const elapsedSec = (now - this.startEpochMs) / 1000;
    slot.energy.mult = elapsedSec >= MATCH_DURATION - OVERDRIVE_AT ? 2 : 1;
    slot.energy.update(Math.max(0, dt));
  }

  handleReport(socket: Socket, report: MatchReport): void {
    const slot = this.slots.find((s) => s.socket.id === socket.id);
    if (!slot || this.status !== 'active') return;
    slot.report = report;

    const opponent = this.other(slot);
    if (opponent?.report) {
      if (this.reportWaitTimer) {
        clearTimeout(this.reportWaitTimer);
        this.reportWaitTimer = null;
      }
      this.resolveFromReports();
      return;
    }
    // Só um relato chegou — espera um pouco pelo do oponente antes de tratar como forfeit.
    this.reportWaitTimer = setTimeout(() => {
      if (this.status !== 'active') return;
      const winner = this.slots.find((s) => s.report);
      if (winner) this.resolveAsForfeit(winner);
    }, REPORT_WAIT_MS);
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
      if (this.status === 'active' && opponent) this.resolveAsForfeit(opponent);
    }, DISCONNECT_GRACE_MS);
  }

  /** Reconcilia os dois relatos independentes — ver protocolo de corroboração no plano. */
  private resolveFromReports(): void {
    const [a, b] = this.slots;
    const ra = a.report!;
    const rb = b.report!;
    let outcome: FinalizeOutcome;

    if (ra.outcome === 'win' && rb.outcome === 'loss') outcome = 'a_win';
    else if (ra.outcome === 'loss' && rb.outcome === 'win') outcome = 'b_win';
    else if (ra.outcome === 'draw' && rb.outcome === 'draw') outcome = 'draw';
    else {
      const aClose = Math.abs(ra.myBaseHpPct - rb.theirBaseHpPctObserved) <= RECONCILE_EPS;
      const bClose = Math.abs(rb.myBaseHpPct - ra.theirBaseHpPctObserved) <= RECONCILE_EPS;
      const tightGapA = Math.abs(ra.myBaseHpPct - ra.theirBaseHpPctObserved) <= RECONCILE_EPS;
      const tightGapB = Math.abs(rb.myBaseHpPct - rb.theirBaseHpPctObserved) <= RECONCILE_EPS;
      outcome = aClose && bClose && tightGapA && tightGapB ? 'draw' : 'voided';
    }

    this.finish(outcome);
  }

  private resolveAsForfeit(winner: Slot): void {
    this.finish(winner === this.slots[0] ? 'a_win' : 'b_win');
  }

  /** Abandono explícito (botão ABANDONAR) — forfeit imediato, sem janela de graça. */
  handleForfeit(socket: Socket): void {
    const slot = this.slots.find((s) => s.socket.id === socket.id);
    const opponent = slot && this.other(slot);
    if (!slot || !opponent || this.status !== 'active') return;
    this.resolveAsForfeit(opponent);
  }

  private finish(outcome: FinalizeOutcome): void {
    if (this.status !== 'active') return;
    this.status = 'resolved';
    const [a, b] = this.slots;
    for (const s of this.slots) {
      if (s.disconnectTimer) clearTimeout(s.disconnectTimer);
    }

    const deltaA =
      outcome === 'voided'
        ? 0
        : computeTrophyDelta(
            a.trophies,
            b.trophies,
            outcome === 'a_win' ? 'win' : outcome === 'b_win' ? 'loss' : 'draw'
          );
    const deltaB =
      outcome === 'voided'
        ? 0
        : computeTrophyDelta(
            b.trophies,
            a.trophies,
            outcome === 'b_win' ? 'win' : outcome === 'a_win' ? 'loss' : 'draw'
          );

    a.socket.emit('match:resolved', {
      outcome: outcome === 'voided' ? 'voided' : outcome === 'a_win' ? 'win' : outcome === 'b_win' ? 'loss' : 'draw',
      trophyDelta: deltaA,
    });
    b.socket.emit('match:resolved', {
      outcome: outcome === 'voided' ? 'voided' : outcome === 'b_win' ? 'win' : outcome === 'a_win' ? 'loss' : 'draw',
      trophyDelta: deltaB,
    });

    // Best-effort: os clientes já têm o resultado: um erro aqui não deve travar a sala.
    void finalizeMatch({
      matchId: this.matchId!,
      mode: this.mode,
      playerAId: a.userId,
      playerBId: b.userId,
      outcome,
      trophyDeltaA: deltaA,
      trophyDeltaB: deltaB,
      startedAtMs: this.startEpochMs,
      reportA: a.report,
      reportB: b.report,
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
