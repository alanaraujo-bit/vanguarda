/**
 * shared/sim/engine.ts — Regras de combate, sem Phaser (alvo por faixa,
 * investida corpo-a-corpo, projétil reto/em arco, torreta, energia,
 * cronômetro/Sobrecarga, voo/anti-aéreo, escudo, investida do Aríete,
 * kamikaze, lentidão/atordoo/Fúria, construções e feitiços) sobre um estado
 * plano e serializável. É a mesma função que roda no servidor (autoridade,
 * modo online) e no cliente (modos offline: versus bot/treino/sobrevivência)
 * — GameScene/Unit/Base só espelham esse estado; nenhum deles decide regra
 * de combate.
 */
import type { SpellDef, Team, UnitDef, UnitKey } from '../types';
import { SPELL_DEFS, UNIT_DEFS, isSpellKey } from '../units';
import {
  BASE_HP,
  BASE_RADIUS,
  BUILDING_OFFSET,
  ENEMY_BASE_Y,
  ENERGY_MAX,
  ENERGY_REGEN,
  ENERGY_START,
  FIELD_BOTTOM,
  FIELD_TOP,
  GAME_WIDTH,
  LANE_XS,
  MATCH_DURATION,
  MAX_UNITS_PER_TEAM,
  OVERDRIVE_AT,
  PLAYER_BASE_Y,
  RAGE_FACTOR,
  SLOW_FACTOR,
  SPAWN_OFFSET,
  SPELL_BASE_DAMAGE_MULT,
  TURRET_COOLDOWN,
  TURRET_DAMAGE,
  TURRET_RANGE,
} from '../constants';
import { Rng } from './rng';
import type {
  DeployCommand,
  DeployResult,
  PendingSpawn,
  SimBase,
  SimEnergy,
  SimEvent,
  SimProjectile,
  SimState,
  SimStats,
  SimUnit,
  TargetRef,
} from './types';

const TEAMS: readonly Team[] = ['player', 'enemy'];

/* ------------------------------- Fábrica de estado ------------------------------ */

export function createInitialState(): SimState {
  const makeEnergy = (): SimEnergy => ({ current: ENERGY_START, max: ENERGY_MAX, mult: 1 });
  const makeBase = (team: Team): SimBase => ({
    team,
    x: LANE_XS[1],
    y: team === 'player' ? PLAYER_BASE_Y : ENEMY_BASE_Y,
    hp: BASE_HP,
    maxHp: BASE_HP,
    alive: true,
    invulnerable: false,
    turretTimer: TURRET_COOLDOWN,
  });
  const makeStats = (): SimStats => ({ damageDealt: 0, kills: 0, deploys: 0 });

  return {
    elapsed: 0,
    timeLeft: MATCH_DURATION,
    overdriveOn: false,
    matchOver: false,
    winner: null,
    units: [],
    projectiles: [],
    bases: { player: makeBase('player'), enemy: makeBase('enemy') },
    energy: { player: makeEnergy(), enemy: makeEnergy() },
    stats: { player: makeStats(), enemy: makeStats() },
    pendingSpawns: [],
    nextUnitId: 1,
    nextProjectileId: 1,
  };
}

/* ---------------------------------- Utilidades ----------------------------------- */

function otherTeam(team: Team): Team {
  return team === 'player' ? 'enemy' : 'player';
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function findUnit(state: SimState, id: number): SimUnit | undefined {
  return state.units.find((u) => u.id === id);
}

interface ResolvedTarget {
  x: number;
  y: number;
  radius: number;
  alive: boolean;
}

/** Posição/estado atual de um alvo referenciado — usado para mirar e calcular alcance. */
function resolveTarget(state: SimState, ref: TargetRef): ResolvedTarget | null {
  if (ref.kind === 'unit') {
    const u = findUnit(state, ref.id);
    if (!u) return null;
    return { x: u.x, y: u.y, radius: UNIT_DEFS[u.key].radius, alive: u.alive };
  }
  const b = state.bases[ref.team];
  return { x: b.x, y: b.y, radius: BASE_RADIUS, alive: b.alive };
}

/* ----------------------------------- Alvos/IA ------------------------------------ */

/** A unidade consegue mirar neste alvo? (regras de voo e de "só construções"). */
function canEngage(attacker: UnitDef, target: UnitDef): boolean {
  if (target.flying && !attacker.flying && !attacker.targetsAir) return false;
  if (attacker.buildingsOnly && target.kind !== 'building') return false;
  return true;
}

function acquireTarget(state: SimState, unit: SimUnit): TargetRef | null {
  const def = UNIT_DEFS[unit.key];
  const foeTeam = otherTeam(unit.team);
  let best: SimUnit | null = null;
  let bestGap = Infinity;
  for (const f of state.units) {
    if (!f.alive || f.team !== foeTeam || f.lane !== unit.lane) continue;
    if (!canEngage(def, UNIT_DEFS[f.key])) continue;
    const gap = dist(unit.x, unit.y, f.x, f.y) - UNIT_DEFS[f.key].radius - def.radius;
    if (gap < bestGap) {
      bestGap = gap;
      best = f;
    }
  }
  if (best && bestGap <= def.aggroRange) return { kind: 'unit', id: best.id };

  const base = state.bases[foeTeam];
  if (base.alive) {
    const gap = dist(unit.x, unit.y, base.x, base.y) - BASE_RADIUS - def.radius;
    if (gap <= def.aggroRange) return { kind: 'base', team: foeTeam };
  }
  return null;
}

function acquireHealTarget(state: SimState, healer: SimUnit): SimUnit | null {
  const def = UNIT_DEFS[healer.key];
  let best: SimUnit | null = null;
  let worstPct = 0.999;
  for (const u of state.units) {
    if (!u.alive || u === healer || u.team !== healer.team) continue;
    // Construções drenam HP por vida útil — curá-las é enxugar gelo e
    // roubaria toda a cura das tropas. O médico ignora construções.
    if (UNIT_DEFS[u.key].lifetime) continue;
    const pct = u.hp / u.maxHp;
    if (pct >= worstPct) continue;
    const gap = dist(healer.x, healer.y, u.x, u.y) - UNIT_DEFS[u.key].radius - def.radius;
    if (gap <= def.range) {
      worstPct = pct;
      best = u;
    }
  }
  return best;
}

function nearestEnemyUnit(state: SimState, team: Team, x: number, y: number, range: number): SimUnit | null {
  const foeTeam = otherTeam(team);
  let best: SimUnit | null = null;
  let bestDist = range;
  for (const f of state.units) {
    if (!f.alive || f.team !== foeTeam) continue;
    const d = dist(x, y, f.x, f.y) - UNIT_DEFS[f.key].radius;
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  return best;
}

/* --------------------------------- Dano/splash ------------------------------------ */

function damageTarget(state: SimState, attackerTeam: Team, ref: TargetRef, amount: number, events: SimEvent[]): void {
  if (ref.kind === 'unit') {
    const u = findUnit(state, ref.id);
    if (!u || !u.alive) return;
    // Escudo de energia: engole o golpe inteiro (sem transbordar para o HP).
    if (u.shield > 0) {
      state.stats[attackerTeam].damageDealt += Math.min(amount, u.shield);
      u.shield = Math.max(0, u.shield - amount);
      return;
    }
    const before = u.hp;
    u.hp -= amount;
    state.stats[attackerTeam].damageDealt += Math.min(amount, before);
    if (u.hp <= 0) {
      u.alive = false;
      state.stats[attackerTeam].kills++;
      events.push({ type: 'death', unitId: u.id, team: u.team, x: u.x, y: u.y });
    }
  } else {
    const b = state.bases[ref.team];
    if (!b.alive || b.invulnerable) return;
    const before = b.hp;
    b.hp = Math.max(0, b.hp - amount);
    state.stats[attackerTeam].damageDealt += Math.min(amount, before);
    events.push({ type: 'base-hit', team: b.team });
    if (b.hp <= 0) {
      b.alive = false;
      events.push({ type: 'base-destroyed', team: b.team });
    }
  }
}

function splashAround(
  state: SimState,
  team: Team,
  x: number,
  y: number,
  radius: number,
  damage: number,
  exclude: TargetRef | null,
  events: SimEvent[],
  baseMult = 1
): void {
  const foeTeam = otherTeam(team);
  for (const f of state.units) {
    if (!f.alive || f.team !== foeTeam) continue;
    if (exclude && exclude.kind === 'unit' && exclude.id === f.id) continue;
    const r = UNIT_DEFS[f.key].radius;
    if (dist(x, y, f.x, f.y) <= radius + r) {
      damageTarget(state, team, { kind: 'unit', id: f.id }, damage, events);
    }
  }
  const base = state.bases[foeTeam];
  const excludedBase = !!exclude && exclude.kind === 'base' && exclude.team === foeTeam;
  if (!excludedBase && base.alive) {
    if (dist(x, y, base.x, base.y) <= radius + BASE_RADIUS) {
      damageTarget(state, team, { kind: 'base', team: foeTeam }, damage * baseMult, events);
    }
  }
}

/* ---------------------------------- Investidas ------------------------------------ */

function resolveMeleeSwings(state: SimState, dt: number, events: SimEvent[]): void {
  for (const u of state.units) {
    if (!u.alive || !u.meleeSwing) continue;
    u.meleeSwing.remaining -= dt;
    if (u.meleeSwing.remaining > 0) continue;
    const swing = u.meleeSwing;
    u.meleeSwing = null;
    // Simplificação deliberada: se o alvo já não existe mais (removido em um tick
    // anterior), o golpe não produz FX. Alvo morto NESTE mesmo tick ainda resolve
    // normalmente (dealDamage vira no-op, mas o impacto/splash aparece).
    const pos = resolveTarget(state, swing.targetId);
    if (!pos) continue;
    damageTarget(state, u.team, swing.targetId, swing.damage, events);
    events.push({ type: 'hit', x: pos.x, y: pos.y - 10, team: u.team, sourceKey: u.key });
    if (swing.splashRadius) {
      splashAround(state, u.team, pos.x, pos.y, swing.splashRadius, swing.damage * 0.6, swing.targetId, events);
    }
  }
}

/* --------------------------------- Projéteis --------------------------------------- */

function spawnProjectile(
  state: SimState,
  team: Team,
  sourceKey: UnitKey | null,
  originX: number,
  originY: number,
  targetRef: TargetRef,
  aimX: number,
  aimY: number,
  speed: number,
  damage: number,
  arc: boolean,
  healing: boolean,
  splashRadius: number | undefined
): void {
  const distToTarget = dist(originX, originY, aimX, aimY);
  const proj: SimProjectile = {
    id: state.nextProjectileId++,
    team,
    sourceKey,
    targetId: targetRef,
    healing,
    damage,
    splashRadius,
    speed,
    arc,
    x: originX,
    y: originY,
    aimX,
    aimY,
    startX: originX,
    startY: originY,
    flightT: 0,
    flightDur: arc ? Math.max(0.35, distToTarget / speed) : 1,
    arcHeight: arc ? clamp(distToTarget * 0.32, 40, 150) : 0,
    done: false,
  };
  state.projectiles.push(proj);
}

function impactProjectile(state: SimState, p: SimProjectile, events: SimEvent[]): void {
  p.done = true;
  if (p.healing) {
    const target = p.targetId.kind === 'unit' ? findUnit(state, p.targetId.id) : undefined;
    if (target && target.alive) {
      target.hp = Math.min(target.maxHp, target.hp + p.damage);
      events.push({ type: 'heal-fx', x: p.aimX, y: p.aimY });
    }
    return;
  }
  if (p.arc && p.splashRadius) {
    events.push({ type: 'explosion', x: p.aimX, y: p.aimY, team: p.team, big: false });
    splashAround(state, p.team, p.aimX, p.aimY, p.splashRadius, p.damage, null, events);
    return;
  }
  const target = resolveTarget(state, p.targetId);
  if (target && target.alive) {
    damageTarget(state, p.team, p.targetId, p.damage, events);
    // Efeito de gelo: o disparo congela o ritmo do alvo por alguns segundos.
    const slowDur = p.sourceKey ? UNIT_DEFS[p.sourceKey].slowOnHit : undefined;
    if (slowDur && p.targetId.kind === 'unit') {
      const u = findUnit(state, p.targetId.id);
      if (u && u.alive) u.slowT = Math.max(u.slowT, slowDur);
    }
  }
  events.push({ type: 'hit', x: p.aimX, y: p.aimY, team: p.team, sourceKey: p.sourceKey });
}

function updateProjectiles(state: SimState, dt: number, events: SimEvent[]): void {
  for (const p of state.projectiles) {
    if (p.done) continue;
    if (p.arc) {
      p.flightT += dt;
      const t = Math.min(1, p.flightT / p.flightDur);
      p.x = lerp(p.startX, p.aimX, t);
      const baseY = lerp(p.startY, p.aimY, t);
      p.y = baseY - Math.sin(t * Math.PI) * p.arcHeight;
      if (t >= 1) impactProjectile(state, p, events);
      continue;
    }
    const target = resolveTarget(state, p.targetId);
    if (target && target.alive) {
      p.aimX = target.x;
      p.aimY = target.y;
    }
    const d = dist(p.x, p.y, p.aimX, p.aimY);
    const step = p.speed * dt;
    if (d <= Math.max(step, 14)) {
      impactProjectile(state, p, events);
      continue;
    }
    const angle = Math.atan2(p.aimY - p.y, p.aimX - p.x);
    p.x += Math.cos(angle) * step;
    p.y += Math.sin(angle) * step;
  }
  state.projectiles = state.projectiles.filter((p) => !p.done);
}

/* ----------------------------------- Unidades --------------------------------------- */

/** Cadência efetiva de ataque considerando lentidão e Fúria. */
function effectiveCooldown(u: SimUnit, def: UnitDef): number {
  let cd = def.attackCooldown;
  if (u.slowT > 0) cd /= SLOW_FACTOR;
  if (u.rageT > 0) cd /= RAGE_FACTOR;
  return cd;
}

function engageAttack(state: SimState, u: SimUnit, targetRef: TargetRef, target: ResolvedTarget, events: SimEvent[]): void {
  const def = UNIT_DEFS[u.key];
  if (u.attackTimer > 0) return;

  // Kamikaze (Estopim): ao alcançar o alvo, explode em área e morre.
  if (def.kamikaze) {
    u.alive = false;
    events.push({ type: 'death', unitId: u.id, team: u.team, x: u.x, y: u.y });
    events.push({ type: 'explosion', x: u.x, y: u.y, team: u.team, big: false });
    splashAround(state, u.team, u.x, u.y, def.splashRadius ?? 60, def.damage, null, events);
    return;
  }

  u.attackTimer = effectiveCooldown(u, def);

  // Investida (Aríete): com embalo acumulado, o golpe multiplica o dano.
  let damage = def.damage;
  if (def.charge && u.chargeDist >= def.charge.dist) {
    damage *= def.charge.mult;
  }
  u.chargeDist = 0;

  if (def.projectileSpeed) {
    const dir = u.team === 'player' ? -1 : 1;
    spawnProjectile(
      state,
      u.team,
      u.key,
      u.x + dir * (def.radius + 4),
      u.y - def.radius * 0.6,
      targetRef,
      target.x,
      target.y,
      def.projectileSpeed,
      damage,
      false,
      false,
      def.splashRadius
    );
  } else if (!u.meleeSwing) {
    u.meleeSwing = { targetId: targetRef, remaining: 0.07, damage, splashRadius: def.splashRadius };
  }
}

function engageHeal(state: SimState, u: SimUnit, ally: SimUnit): void {
  const def = UNIT_DEFS[u.key];
  if (u.attackTimer > 0) return;
  u.attackTimer = effectiveCooldown(u, def);
  const dir = u.team === 'player' ? -1 : 1;
  spawnProjectile(
    state,
    u.team,
    u.key,
    u.x + dir * (def.radius + 4),
    u.y - def.radius * 0.6,
    { kind: 'unit', id: ally.id },
    ally.x,
    ally.y,
    def.projectileSpeed ?? 500,
    def.damage,
    false,
    true,
    undefined
  );
}

function updateUnits(state: SimState, dt: number, events: SimEvent[]): void {
  for (const u of state.units) {
    if (!u.alive) continue;
    const def = UNIT_DEFS[u.key];
    u.attackTimer -= dt;
    if (u.stunT > 0) u.stunT -= dt;
    if (u.slowT > 0) u.slowT -= dt;
    if (u.rageT > 0) u.rageT -= dt;

    // Construções: vida útil drena o HP até a demolição natural.
    if (def.lifetime) {
      u.hp -= (u.maxHp / def.lifetime) * dt;
      if (u.hp <= 0) {
        u.alive = false;
        events.push({ type: 'death', unitId: u.id, team: u.team, x: u.x, y: u.y });
        continue;
      }
    }

    // Gerador (Dínamo): energia extra para o dono.
    if (def.energyRate) {
      const e = state.energy[u.team];
      e.current = Math.min(e.max, e.current + def.energyRate * dt);
    }

    // Fábrica (Forja): invoca tropas na própria porta, rumo ao inimigo.
    if (def.spawn) {
      u.spawnT -= dt;
      if (u.spawnT <= 0) {
        u.spawnT = def.spawn.every;
        const dir = u.team === 'player' ? -1 : 1;
        state.pendingSpawns.push({
          team: u.team,
          key: def.spawn.key,
          lane: u.lane,
          delay: 0,
          x: u.x,
          y: u.y + dir * (def.radius + 26),
        });
      }
    }

    // Atordoado: não age (o embalo da investida também já foi zerado).
    if (u.stunT > 0) continue;

    // Construções sem ataque (Forja/Dínamo) são puramente passivas.
    if (def.damage <= 0 && !def.healer) continue;

    if (def.healer) {
      const ally = acquireHealTarget(state, u);
      if (ally) {
        const gap = dist(u.x, u.y, ally.x, ally.y) - UNIT_DEFS[ally.key].radius - def.radius;
        if (gap <= def.range) {
          engageHeal(state, u, ally);
          continue;
        }
      }
    }

    // Velocidade efetiva: lentidão, Fúria e o embalo da investida.
    let speed = def.speed;
    if (u.slowT > 0) speed *= SLOW_FACTOR;
    if (u.rageT > 0) speed *= RAGE_FACTOR;
    if (def.charge && u.chargeDist >= def.charge.dist) speed *= def.charge.speedMult;

    const targetRef = acquireTarget(state, u);
    if (targetRef) {
      const target = resolveTarget(state, targetRef)!;
      const gap = dist(u.x, u.y, target.x, target.y) - target.radius - def.radius;
      if (gap <= def.range) {
        engageAttack(state, u, targetRef, target, events);
        continue;
      }
      if (def.kind === 'building') continue; // torres não perseguem
      const ang = Math.atan2(target.y - u.y, target.x - u.x);
      u.x += Math.cos(ang) * speed * dt;
      u.y += Math.sin(ang) * speed * dt;
      u.chargeDist += speed * dt;
    } else {
      if (def.kind === 'building') continue;
      u.y += (u.team === 'player' ? -1 : 1) * speed * dt;
      u.chargeDist += speed * dt;
    }
  }
}

/* ------------------------------------- Bases ----------------------------------------- */

function updateBases(state: SimState, dt: number): void {
  for (const team of TEAMS) {
    const base = state.bases[team];
    if (!base.alive) continue;
    base.turretTimer -= dt;
    if (base.turretTimer <= 0) {
      const target = nearestEnemyUnit(state, team, base.x, base.y, TURRET_RANGE);
      if (target) {
        base.turretTimer = TURRET_COOLDOWN;
        spawnProjectile(
          state,
          team,
          null,
          base.x,
          base.y - 92,
          { kind: 'unit', id: target.id },
          target.x,
          target.y,
          680,
          TURRET_DAMAGE,
          false,
          false,
          undefined
        );
      } else {
        base.turretTimer = 0.1;
      }
    }
  }
}

/* ---------------------------------- Cronômetro/fim ------------------------------------- */

function finishMatch(state: SimState, winner: Team | 'draw', events: SimEvent[]): void {
  if (state.matchOver) return;
  state.matchOver = true;
  state.winner = winner;
  events.push({ type: 'match-ended', winner });
}

function updateClock(state: SimState, dt: number, events: SimEvent[]): void {
  state.elapsed += dt;
  state.timeLeft -= dt;
  if (!state.overdriveOn && state.timeLeft <= OVERDRIVE_AT) {
    state.overdriveOn = true;
    state.energy.player.mult *= 2;
    state.energy.enemy.mult *= 2;
    events.push({ type: 'overdrive' });
  }
  if (state.matchOver) return;
  if (!state.bases.player.alive) {
    finishMatch(state, 'enemy', events);
  } else if (!state.bases.enemy.alive) {
    finishMatch(state, 'player', events);
  } else if (state.timeLeft <= 0) {
    const pPct = state.bases.player.hp / state.bases.player.maxHp;
    const ePct = state.bases.enemy.hp / state.bases.enemy.maxHp;
    finishMatch(state, pPct > ePct ? 'player' : pPct < ePct ? 'enemy' : 'draw', events);
  }
}

/* ------------------------------------ Energia ------------------------------------------ */

function updateEnergy(state: SimState, dt: number): void {
  for (const team of TEAMS) {
    const e = state.energy[team];
    if (e.current < e.max) {
      e.current = Math.min(e.max, e.current + ENERGY_REGEN * e.mult * dt);
    }
  }
}

/* ------------------------------------ Invocação ----------------------------------------- */

function spawnUnitNow(
  state: SimState,
  team: Team,
  key: UnitKey,
  lane: number,
  rng: Rng,
  events: SimEvent[],
  at?: { x: number; y: number }
): void {
  // Guarda do limite aqui também: fábricas (Forja) invocam sem passar pelo deploy.
  const aliveCount = state.units.filter((u) => u.alive && u.team === team).length;
  if (aliveCount >= MAX_UNITS_PER_TEAM) return;

  const def = UNIT_DEFS[key];
  let x: number;
  let y: number;
  if (at) {
    x = at.x;
    y = at.y;
  } else if (def.kind === 'building') {
    // Construções são erguidas na própria metade, sem jitter (posição tática exata).
    x = LANE_XS[lane];
    y = team === 'player' ? PLAYER_BASE_Y - BUILDING_OFFSET : ENEMY_BASE_Y + BUILDING_OFFSET;
  } else {
    const baseY = team === 'player' ? PLAYER_BASE_Y - SPAWN_OFFSET : ENEMY_BASE_Y + SPAWN_OFFSET;
    x = LANE_XS[lane] + rng.between(-14, 14);
    y = baseY + rng.between(-22, 22);
  }
  const unit: SimUnit = {
    id: state.nextUnitId++,
    key,
    team,
    lane,
    x,
    y,
    hp: def.hp,
    maxHp: def.hp,
    alive: true,
    attackTimer: def.attackCooldown * 0.5,
    meleeSwing: null,
    shield: def.shield ?? 0,
    stunT: 0,
    slowT: 0,
    rageT: 0,
    chargeDist: 0,
    spawnT: def.spawn ? def.spawn.every : 0,
  };
  state.units.push(unit);
  events.push({ type: 'spawn', unitId: unit.id, key, team, lane, x, y });
}

function materializePendingSpawns(state: SimState, dt: number, rng: Rng, events: SimEvent[]): void {
  const remaining: PendingSpawn[] = [];
  for (const p of state.pendingSpawns) {
    p.delay -= dt;
    if (p.delay <= 0) {
      spawnUnitNow(state, p.team, p.key, p.lane, rng, events, p.x !== undefined && p.y !== undefined ? { x: p.x, y: p.y } : undefined);
    } else {
      remaining.push(p);
    }
  }
  state.pendingSpawns = remaining;
}

/* ------------------------------------ Feitiços ------------------------------------ */

function castSpell(state: SimState, def: SpellDef, team: Team, x: number, y: number, events: SimEvent[]): void {
  events.push({ type: 'spell', key: def.key, team, x, y });
  const foeTeam = otherTeam(team);

  if (def.damage || def.stunDur) {
    for (const f of state.units) {
      if (!f.alive || f.team !== foeTeam) continue;
      if (dist(x, y, f.x, f.y) > def.radius + UNIT_DEFS[f.key].radius) continue;
      if (def.stunDur) {
        f.stunT = Math.max(f.stunT, def.stunDur);
        f.chargeDist = 0; // atordoar zera o embalo da investida
      }
      if (def.damage) {
        damageTarget(state, team, { kind: 'unit', id: f.id }, def.damage, events);
      }
    }
    // Bases sofrem dano reduzido de feitiço (senão viraria rota de dano "grátis").
    const base = state.bases[foeTeam];
    if (def.damage && base.alive && dist(x, y, base.x, base.y) <= def.radius + BASE_RADIUS) {
      damageTarget(state, team, { kind: 'base', team: foeTeam }, def.damage * SPELL_BASE_DAMAGE_MULT, events);
    }
  }

  if (def.rageDur) {
    for (const f of state.units) {
      if (!f.alive || f.team !== team) continue;
      if (dist(x, y, f.x, f.y) <= def.radius + UNIT_DEFS[f.key].radius) {
        f.rageT = Math.max(f.rageT, def.rageDur);
      }
    }
  }
}

export function applyDeployCommand(state: SimState, cmd: DeployCommand, rng: Rng, events: SimEvent[]): DeployResult {
  // Feitiço: efeito instantâneo na área apontada — não invoca unidade.
  if (isSpellKey(cmd.key)) {
    const spell = SPELL_DEFS[cmd.key];
    if (!cmd.free) {
      const energy = state.energy[cmd.team];
      if (energy.current < spell.cost) return { ok: false, reason: 'insufficient-energy' };
      energy.current -= spell.cost;
    }
    const x = clamp(cmd.x ?? LANE_XS[cmd.lane], 50, GAME_WIDTH - 50);
    const y = clamp(cmd.y ?? (FIELD_TOP + FIELD_BOTTOM) / 2, FIELD_TOP, FIELD_BOTTOM);
    castSpell(state, spell, cmd.team, x, y, events);
    state.stats[cmd.team].deploys++;
    return { ok: true };
  }

  const def = UNIT_DEFS[cmd.key];
  if (!def) return { ok: false, reason: 'unknown-unit' };

  const aliveCount = state.units.filter((u) => u.alive && u.team === cmd.team).length;
  if (aliveCount >= MAX_UNITS_PER_TEAM) return { ok: false, reason: 'unit-cap' };

  if (!cmd.free) {
    const energy = state.energy[cmd.team];
    if (energy.current < def.cost) return { ok: false, reason: 'insufficient-energy' };
    energy.current -= def.cost;
  }

  const count = def.count ?? 1;
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      spawnUnitNow(state, cmd.team, cmd.key, cmd.lane, rng, events);
    } else {
      state.pendingSpawns.push({ team: cmd.team, key: cmd.key, lane: cmd.lane, delay: i * 0.09 });
    }
  }
  state.stats[cmd.team].deploys++;
  return { ok: true };
}

/* -------------------------------------- Tick ---------------------------------------------- */

export interface StepResult {
  events: SimEvent[];
  results: DeployResult[];
}

/**
 * Avança a simulação em `dt` segundos. `commands` são os pedidos de invocação
 * chegados desde o último tick (servidor) ou o input do frame (offline).
 * Ordem: comandos -> spawns escalonados -> energia -> IA/movimento -> torretas
 * -> resolução de golpes/projéteis -> cronômetro/fim de partida.
 */
export function step(state: SimState, dt: number, rng: Rng, commands: DeployCommand[] = []): StepResult {
  const events: SimEvent[] = [];

  if (state.matchOver) {
    return { events, results: commands.map(() => ({ ok: false })) };
  }

  const results = commands.map((cmd) => applyDeployCommand(state, cmd, rng, events));

  materializePendingSpawns(state, dt, rng, events);
  updateEnergy(state, dt);
  updateUnits(state, dt, events);
  updateBases(state, dt);
  resolveMeleeSwings(state, dt, events);
  updateProjectiles(state, dt, events);
  updateClock(state, dt, events);

  state.units = state.units.filter((u) => u.alive);

  return { events, results };
}
