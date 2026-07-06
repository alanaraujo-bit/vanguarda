/**
 * Progression.ts — Converte o resultado bruto de uma partida em progresso:
 * XP, nível, conquistas, missões diárias, skins e títulos desbloqueados.
 * Toda a avaliação é declarativa (config/progression.ts); aqui só orquestramos.
 */
import type { MatchConfig, MatchRecord, MatchSummary } from '../../shared/types';
import { SaveManager } from '../core/SaveManager';
import { SessionManager } from '../net/SessionManager';
import {
  ACHIEVEMENTS,
  levelFromXp,
  missionsForToday,
  SKINS,
  TITLES,
} from '../config/progression';

export interface RawMatchOutcome {
  outcome: 'win' | 'loss' | 'draw';
  durationSec: number;
  damageDealt: number;
  kills: number;
  deploys: number;
  wave?: number;
}

const ACHIEVEMENT_BONUS_XP = 40;

export function applyMatchResult(config: MatchConfig, raw: RawMatchOutcome): MatchSummary {
  const profile = SaveManager.data;
  const xpBefore = profile.xp;
  const levelBefore = levelFromXp(xpBefore);

  // Treino não pontua nem registra — é uma academia.
  if (config.mode === 'training') {
    return {
      config,
      outcome: raw.outcome,
      record: null,
      levelBefore,
      levelAfter: levelBefore,
      xpBefore,
      xpAfter: xpBefore,
      unlockedAchievements: [],
      completedMissions: [],
      newSkins: [],
      newTitles: [],
    };
  }

  /* ------------------------------ XP da partida ----------------------------- */
  let xp = raw.damageDealt / 80 + raw.kills * 2;
  if (config.mode === 'survival') {
    xp += (raw.wave ?? 0) * 12;
  } else {
    xp += raw.outcome === 'win' ? 60 : raw.outcome === 'draw' ? 25 : 15;
    if (raw.outcome === 'win' && config.difficulty === 'hard') xp += 30;
  }
  xp = Math.round(xp);

  /* ------------------------------- Registro --------------------------------- */
  const record: MatchRecord = {
    mode: config.mode,
    difficulty: config.mode === 'versus' ? config.difficulty : undefined,
    outcome: raw.outcome,
    durationSec: Math.round(raw.durationSec),
    damageDealt: Math.round(raw.damageDealt),
    kills: raw.kills,
    deploys: raw.deploys,
    wave: raw.wave,
    xpGained: xp, // atualizado abaixo com bônus
    date: Date.now(),
  };
  SaveManager.recordMatch(record);

  /* ---------------------------- Missões diárias ------------------------------ */
  const completedMissions: string[] = [];
  SaveManager.rotateMissionsIfNeeded();
  const missions = profile.missions;
  for (const def of missionsForToday()) {
    if (missions.claimed.includes(def.id)) continue;
    const delta =
      def.stat === 'damageDealt'
        ? raw.damageDealt
        : def.stat === 'kills'
          ? raw.kills
          : def.stat === 'deploys'
            ? raw.deploys
            : def.stat === 'wins'
              ? (raw.outcome === 'win' ? 1 : 0)
              : 1; // matches
    const next = (missions.progress[def.id] ?? 0) + delta;
    missions.progress[def.id] = next;
    if (next >= def.target) {
      missions.claimed.push(def.id);
      completedMissions.push(def.id);
      xp += def.rewardXp;
    }
  }

  /* ------------------------------ Conquistas --------------------------------- */
  const unlockedAchievements: string[] = [];
  for (const ach of ACHIEVEMENTS) {
    if (profile.achievements.includes(ach.id)) continue;
    if (ach.check(profile, record)) {
      SaveManager.unlockAchievement(ach.id);
      unlockedAchievements.push(ach.id);
      xp += ACHIEVEMENT_BONUS_XP;
    }
  }

  /* --------------------------------- XP final -------------------------------- */
  record.xpGained = xp;
  SaveManager.addXp(xp);
  // Partidas online já têm o XP de conta creditado pelo próprio servidor
  // (autoritativo, ver server/src/match/persist.ts) — só reportamos aqui o
  // que vem de modos offline, onde o servidor não tem como calcular sozinho.
  if (config.mode !== 'online') void SessionManager.reportXpGain(xp);
  const xpAfter = profile.xp;
  const levelAfter = levelFromXp(xpAfter);

  // Desbloqueios por nível alcançado nesta partida.
  const newSkins = SKINS.filter((s) => s.level > levelBefore && s.level <= levelAfter).map(
    (s) => s.id
  );
  const newTitles = TITLES.filter((t) => t.level > levelBefore && t.level <= levelAfter).map(
    (t) => t.id
  );
  SaveManager.save();

  return {
    config,
    outcome: raw.outcome,
    record,
    levelBefore,
    levelAfter,
    xpBefore,
    xpAfter,
    unlockedAchievements,
    completedMissions,
    newSkins,
    newTitles,
  };
}
