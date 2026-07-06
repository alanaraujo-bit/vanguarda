/**
 * shared/sim/types.ts — Estado de simulação puro (sem Phaser).
 * Nenhum tipo aqui referencia GameObjects: é o mesmo formato usado pelo
 * servidor (autoridade) e pelo cliente (renderer), então precisa ser
 * serializável (JSON-safe) de ponta a ponta.
 */
import type { CardKey, SpellKey, Team, UnitKey } from '../types';

export interface SimUnit {
  id: number;
  key: UnitKey;
  team: Team;
  lane: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  /** Cooldown de ataque restante, em segundos. */
  attackTimer: number;
  /** Investida corpo-a-corpo em andamento — o dano é aplicado quando `remaining` chega a 0. */
  meleeSwing: MeleeSwing | null;
  /** Escudo de energia restante (Sentinela) — absorve dano antes do HP. */
  shield: number;
  /** Segundos restantes de atordoamento (Pulso) — não age enquanto > 0. */
  stunT: number;
  /** Segundos restantes de lentidão (Gélido). */
  slowT: number;
  /** Segundos restantes de Fúria. */
  rageT: number;
  /** Distância acumulada desde o último ataque (investida do Aríete). */
  chargeDist: number;
  /** Cronômetro até a próxima invocação (construções-fábrica). */
  spawnT: number;
}

export interface MeleeSwing {
  targetId: TargetRef;
  remaining: number;
  damage: number;
  splashRadius?: number;
}

/** Referência a um alvo: unidade (id) ou a base de um time. */
export type TargetRef = { kind: 'unit'; id: number } | { kind: 'base'; team: Team };

export interface SimBase {
  team: Team;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  invulnerable: boolean;
  turretTimer: number;
}

export interface SimProjectile {
  id: number;
  team: Team;
  /** Chave da unidade que disparou (torreta = null) — define dano/splash/textura no cliente. */
  sourceKey: UnitKey | null;
  targetId: TargetRef;
  healing: boolean;
  damage: number;
  splashRadius?: number;
  speed: number;
  arc: boolean;
  x: number;
  y: number;
  /** Última posição conhecida do alvo (guiado) ou destino fixo (arco). */
  aimX: number;
  aimY: number;
  startX: number;
  startY: number;
  flightT: number;
  flightDur: number;
  arcHeight: number;
  done: boolean;
}

export interface SimEnergy {
  current: number;
  max: number;
  /** Multiplicador de regeneração — dificuldade do bot, Sobrecarga etc. Ajustado pelo chamador. */
  mult: number;
}

export interface SimStats {
  damageDealt: number;
  kills: number;
  deploys: number;
}

export interface SimState {
  elapsed: number;
  timeLeft: number;
  overdriveOn: boolean;
  matchOver: boolean;
  /** Vencedor decidido (base destruída ou cronômetro zerado). `null` enquanto a partida corre. */
  winner: Team | 'draw' | null;
  units: SimUnit[];
  projectiles: SimProjectile[];
  bases: Record<Team, SimBase>;
  energy: Record<Team, SimEnergy>;
  stats: Record<Team, SimStats>;
  pendingSpawns: PendingSpawn[];
  nextUnitId: number;
  nextProjectileId: number;
}

export interface PendingSpawn {
  team: Team;
  key: UnitKey;
  lane: number;
  delay: number;
  /** Posição explícita (construções-fábrica invocam na própria porta). */
  x?: number;
  y?: number;
}

export interface DeployCommand {
  team: Team;
  key: CardKey;
  lane: number;
  /** Invocação gratuita (bot/ondas) — pula a checagem/gasto de energia. */
  free?: boolean;
  /** Alvo do feitiço em coordenadas de campo (ignorado por tropas/construções). */
  x?: number;
  y?: number;
}

export interface DeployResult {
  ok: boolean;
  reason?: 'insufficient-energy' | 'unit-cap' | 'unknown-unit';
}

export type SimEvent =
  | { type: 'spawn'; unitId: number; key: UnitKey; team: Team; lane: number; x: number; y: number }
  | { type: 'spell'; key: SpellKey; team: Team; x: number; y: number }
  | { type: 'death'; unitId: number; team: Team; x: number; y: number }
  | { type: 'hit'; x: number; y: number; team: Team; sourceKey: UnitKey | null }
  | { type: 'heal-fx'; x: number; y: number }
  | { type: 'explosion'; x: number; y: number; team: Team; big: boolean }
  | { type: 'base-hit'; team: Team }
  | { type: 'base-destroyed'; team: Team }
  | { type: 'overdrive' }
  | { type: 'match-ended'; winner: Team | 'draw' };
