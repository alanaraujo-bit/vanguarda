/**
 * progression.ts — Curva de XP, conquistas, skins, títulos e missões diárias.
 * Regras de desbloqueio são declarativas; o sistema de progressão apenas
 * as avalia após cada partida.
 */
import type {
  AchievementDef,
  DifficultyParams,
  Difficulty,
  MissionDef,
  SkinDef,
  TitleDef,
} from '../../shared/types';

/* ----------------------------------- XP ----------------------------------- */

/** XP necessário para ir do nível n para o n+1. */
export function xpToNext(level: number): number {
  return 100 + (level - 1) * 65;
}

/** Nível (1-based) correspondente a um total de XP. */
export function levelFromXp(xp: number): number {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpToNext(level) && level < 99) {
    remaining -= xpToNext(level);
    level++;
  }
  return level;
}

/** XP acumulado dentro do nível atual (para a barra de progresso). */
export function xpIntoLevel(xp: number): { into: number; needed: number } {
  let level = 1;
  let remaining = xp;
  while (remaining >= xpToNext(level) && level < 99) {
    remaining -= xpToNext(level);
    level++;
  }
  return { into: remaining, needed: xpToNext(level) };
}

/* ------------------------------- Dificuldade ------------------------------- */

export const DIFFICULTIES: Record<Difficulty, DifficultyParams> = {
  easy: {
    label: 'Fácil',
    regenMult: 0.72,
    decisionInterval: 1.1,
    mistakeChance: 0.35,
    pushThreshold: 9,
    smartCombos: false,
  },
  normal: {
    label: 'Normal',
    regenMult: 0.95,
    decisionInterval: 0.6,
    mistakeChance: 0.12,
    pushThreshold: 8,
    smartCombos: true,
  },
  hard: {
    label: 'Difícil',
    regenMult: 1.12,
    decisionInterval: 0.4,
    mistakeChance: 0.03,
    pushThreshold: 7,
    smartCombos: true,
  },
};

/* --------------------------------- Skins ---------------------------------- */

export const SKINS: SkinDef[] = [
  { id: 'ciano', name: 'Ciano Vanguarda', color: 0x38e1ff, level: 1 },
  { id: 'esmeralda', name: 'Esmeralda', color: 0x3dffa8, level: 3 },
  { id: 'ametista', name: 'Ametista', color: 0xa46bff, level: 5 },
  { id: 'solar', name: 'Ouro Solar', color: 0xffc94d, level: 8 },
  { id: 'magenta', name: 'Pulso Magenta', color: 0xff5ad2, level: 12 },
];

export function skinById(id: string): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

/* --------------------------------- Títulos --------------------------------- */

export const TITLES: TitleDef[] = [
  { id: 'recruta', name: 'Recruta', level: 1 },
  { id: 'soldado', name: 'Soldado', level: 3 },
  { id: 'veterano', name: 'Veterano', level: 5 },
  { id: 'capitao', name: 'Capitão', level: 8 },
  { id: 'comandante', name: 'Comandante', level: 10 },
  { id: 'lenda', name: 'Lenda da Vanguarda', level: 15 },
];

export function titleById(id: string): TitleDef {
  return TITLES.find((t) => t.id === id) ?? TITLES[0];
}

/* -------------------------------- Conquistas ------------------------------- */

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'primeira-vitoria',
    name: 'Primeiro Sangue',
    desc: 'Vença sua primeira partida',
    icon: 'medal',
    check: (p) => p.stats.wins >= 1,
  },
  {
    id: 'veterano',
    name: 'Veterano',
    desc: 'Vença 10 partidas',
    icon: 'medal',
    check: (p) => p.stats.wins >= 10,
  },
  {
    id: 'conquistador',
    name: 'Conquistador',
    desc: 'Vença 25 partidas',
    icon: 'crown',
    check: (p) => p.stats.wins >= 25,
  },
  {
    id: 'destruidor',
    name: 'Destruidor',
    desc: 'Cause 50.000 de dano acumulado',
    icon: 'skull',
    check: (p) => p.stats.totalDamage >= 50_000,
  },
  {
    id: 'comandante-campo',
    name: 'Comandante de Campo',
    desc: 'Invoque 200 unidades',
    icon: 'star',
    check: (p) => p.stats.totalDeploys >= 200,
  },
  {
    id: 'sobrevivente',
    name: 'Sobrevivente',
    desc: 'Alcance a onda 5 na Sobrevivência',
    icon: 'shield',
    check: (p) => p.stats.bestWave >= 5,
  },
  {
    id: 'resistencia',
    name: 'Resistência',
    desc: 'Alcance a onda 10 na Sobrevivência',
    icon: 'shield',
    check: (p) => p.stats.bestWave >= 10,
  },
  {
    id: 'lenda-viva',
    name: 'Lenda Viva',
    desc: 'Alcance a onda 15 na Sobrevivência',
    icon: 'crown',
    check: (p) => p.stats.bestWave >= 15,
  },
  {
    id: 'relampago',
    name: 'Relâmpago',
    desc: 'Vença uma partida em menos de 2 minutos',
    icon: 'bolt',
    check: (_p, last) =>
      !!last && last.outcome === 'win' && last.mode === 'versus' && last.durationSec < 120,
  },
  {
    id: 'estrategista',
    name: 'Estrategista',
    desc: 'Vença no modo Difícil',
    icon: 'star',
    check: (p) => p.stats.hardWins >= 1,
  },
  {
    id: 'exterminador',
    name: 'Exterminador',
    desc: 'Elimine 500 unidades inimigas',
    icon: 'skull',
    check: (p) => p.stats.totalKills >= 500,
  },
  {
    id: 'ascensao',
    name: 'Ascensão',
    desc: 'Alcance o nível 10',
    icon: 'crown',
    check: (p) => levelFromXp(p.xp) >= 10,
  },
];

/* --------------------------------- Missões --------------------------------- */

/** Catálogo de missões possíveis; 3 são sorteadas por dia (seed = data). */
export const MISSION_POOL: MissionDef[] = [
  { id: 'dano-4k', desc: 'Cause 4.000 de dano', stat: 'damageDealt', target: 4000, rewardXp: 60 },
  { id: 'dano-8k', desc: 'Cause 8.000 de dano', stat: 'damageDealt', target: 8000, rewardXp: 110 },
  { id: 'abates-15', desc: 'Elimine 15 unidades', stat: 'kills', target: 15, rewardXp: 60 },
  { id: 'abates-30', desc: 'Elimine 30 unidades', stat: 'kills', target: 30, rewardXp: 100 },
  { id: 'invocar-20', desc: 'Invoque 20 unidades', stat: 'deploys', target: 20, rewardXp: 50 },
  { id: 'invocar-40', desc: 'Invoque 40 unidades', stat: 'deploys', target: 40, rewardXp: 90 },
  { id: 'vencer-1', desc: 'Vença 1 partida', stat: 'wins', target: 1, rewardXp: 80 },
  { id: 'vencer-3', desc: 'Vença 3 partidas', stat: 'wins', target: 3, rewardXp: 150 },
  { id: 'jogar-3', desc: 'Jogue 3 partidas', stat: 'matches', target: 3, rewardXp: 70 },
];

/** Chave AAAA-MM-DD de hoje (fuso local). */
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

/** Sorteia deterministicamente as 3 missões do dia. */
export function missionsForToday(): MissionDef[] {
  const key = todayKey();
  let seed = 0;
  for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const pool = [...MISSION_POOL];
  const picked: MissionDef[] = [];
  while (picked.length < 3 && pool.length > 0) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    picked.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return picked;
}
