/**
 * ranks.ts — Escada de patentes do modo ranqueado, orientada por troféus.
 * Sistema separado do XP/nível/título offline (config/progression.ts), que
 * continua intocado para o PvE local. Patente nunca é persistida: é sempre
 * derivada do total de troféus através de rankForTrophies().
 */

export interface RankDef {
  id: string;
  name: string;
  minTrophies: number;
}

export const RANKS: RankDef[] = [
  { id: 'recruta', name: 'Recruta', minTrophies: 0 },
  { id: 'soldado', name: 'Soldado', minTrophies: 300 },
  { id: 'cabo', name: 'Cabo', minTrophies: 600 },
  { id: 'sargento', name: 'Sargento', minTrophies: 1000 },
  { id: 'tenente', name: 'Tenente', minTrophies: 1400 },
  { id: 'capitao', name: 'Capitão', minTrophies: 1800 },
  { id: 'major', name: 'Major', minTrophies: 2300 },
  { id: 'coronel', name: 'Coronel', minTrophies: 2800 },
  { id: 'general', name: 'General', minTrophies: 3400 },
  { id: 'comandante-supremo', name: 'Comandante Supremo', minTrophies: 4000 },
  { id: 'lenda-vanguarda', name: 'Lenda da Vanguarda', minTrophies: 5000 },
];

/** Patente correspondente a um total de troféus (a de maior limiar atingido). */
export function rankForTrophies(trophies: number): RankDef {
  let best = RANKS[0];
  for (const r of RANKS) {
    if (trophies >= r.minTrophies) best = r;
  }
  return best;
}
