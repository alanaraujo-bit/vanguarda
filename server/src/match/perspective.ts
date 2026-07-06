/**
 * perspective.ts — Traduz o estado canônico da simulação (times fixos
 * 'player'=embaixo/'enemy'=em cima) para o ponto de vista de cada socket.
 * Os dois jogadores sempre se enxergam como "player" (embaixo) — igual ao
 * modo offline — então quem está no lado canônico 'enemy' recebe os times
 * trocados e o Y espelhado.
 */
import { ENEMY_BASE_Y, PLAYER_BASE_Y } from '../../../shared/constants.js';
import type { MatchSnapshot, SnapshotProjectile, SnapshotUnit } from '../../../shared/netProtocol.js';
import type { SimEvent, SimState } from '../../../shared/sim/types.js';
import type { Team } from '../../../shared/types.js';

/** Base 'player' e base 'enemy' são simétricas em torno desse eixo — espelhar Y em torno
 * dele troca exatamente a posição de uma pela da outra (mesmo valendo para spawn/unidades). */
export const MIRROR_AXIS = PLAYER_BASE_Y + ENEMY_BASE_Y;

function otherTeam(team: Team): Team {
  return team === 'player' ? 'enemy' : 'player';
}

export function buildSnapshot(state: SimState, viewerTeam: Team): MatchSnapshot {
  const foeTeam = otherTeam(viewerTeam);
  const mapTeam = (t: Team): Team => (t === viewerTeam ? 'player' : 'enemy');
  const mapY = (y: number): number => (viewerTeam === 'player' ? y : MIRROR_AXIS - y);

  const units: SnapshotUnit[] = state.units
    .filter((u) => u.alive)
    .map((u) => {
      const st = (u.slowT > 0 ? 1 : 0) | (u.rageT > 0 ? 2 : 0) | (u.stunT > 0 ? 4 : 0);
      return {
        id: u.id,
        key: u.key,
        team: mapTeam(u.team),
        lane: u.lane,
        x: u.x,
        y: mapY(u.y),
        hp: u.hp,
        maxHp: u.maxHp,
        ...(u.shield > 0 ? { sh: u.shield } : {}),
        ...(st ? { st } : {}),
      };
    });

  const projectiles: SnapshotProjectile[] = state.projectiles.map((p) => ({
    id: p.id,
    team: mapTeam(p.team),
    sourceKey: p.sourceKey,
    arc: p.arc,
    healing: p.healing,
    x: p.x,
    y: mapY(p.y),
  }));

  return {
    timeLeft: Math.max(0, state.timeLeft),
    overdriveOn: state.overdriveOn,
    myEnergy: state.energy[viewerTeam].current,
    baseHp: { player: state.bases[viewerTeam].hp, enemy: state.bases[foeTeam].hp },
    units,
    projectiles,
  };
}

export function mapEvents(events: SimEvent[], viewerTeam: Team): SimEvent[] {
  const mapTeam = (t: Team): Team => (t === viewerTeam ? 'player' : 'enemy');
  const mapY = (y: number): number => (viewerTeam === 'player' ? y : MIRROR_AXIS - y);

  return events.map((e): SimEvent => {
    switch (e.type) {
      case 'spawn':
        return { ...e, team: mapTeam(e.team), y: mapY(e.y) };
      case 'spell':
        return { ...e, team: mapTeam(e.team), y: mapY(e.y) };
      case 'death':
        return { ...e, team: mapTeam(e.team), y: mapY(e.y) };
      case 'hit':
        return { ...e, team: mapTeam(e.team), y: mapY(e.y) };
      case 'heal-fx':
        return { ...e, y: mapY(e.y) };
      case 'explosion':
        return { ...e, team: mapTeam(e.team), y: mapY(e.y) };
      case 'base-hit':
        return { ...e, team: mapTeam(e.team) };
      case 'base-destroyed':
        return { ...e, team: mapTeam(e.team) };
      case 'overdrive':
        return e;
      case 'match-ended':
        return { ...e, winner: e.winner === 'draw' ? 'draw' : mapTeam(e.winner) };
    }
  });
}
