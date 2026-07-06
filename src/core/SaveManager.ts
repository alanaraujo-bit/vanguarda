/**
 * SaveManager.ts — Persistência do perfil em localStorage.
 * Singleton com API síncrona; toda mutação salva imediatamente.
 * Versão no nome da chave permite migrações futuras sem corromper saves.
 */
import type { MatchRecord, ProfileData, SettingsData } from './types';
import { missionsForToday, todayKey } from '../config/progression';

const SAVE_KEY = 'vanguarda-save-v1';
const HISTORY_LIMIT = 12;

function defaultSettings(): SettingsData {
  return {
    musicVolume: 0.6,
    sfxVolume: 0.8,
    muted: false,
    particles: 'high',
    showFps: false,
  };
}

function defaultProfile(): ProfileData {
  return {
    name: 'Comandante',
    xp: 0,
    skin: 'ciano',
    title: 'recruta',
    achievements: [],
    missions: { dateKey: todayKey(), progress: {}, claimed: [] },
    stats: {
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      bestWave: 0,
      totalDamage: 0,
      totalKills: 0,
      totalDeploys: 0,
      playSeconds: 0,
      hardWins: 0,
    },
    history: [],
    settings: defaultSettings(),
  };
}

class SaveManagerImpl {
  private profile: ProfileData;

  constructor() {
    this.profile = this.load();
    this.rotateMissionsIfNeeded();
  }

  /** Perfil vivo (referência única — mutar e chamar save()). */
  get data(): ProfileData {
    return this.profile;
  }

  get settings(): SettingsData {
    return this.profile.settings;
  }

  private load(): ProfileData {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultProfile();
      const parsed = JSON.parse(raw) as Partial<ProfileData>;
      // Mescla com defaults: campos novos em versões futuras não quebram saves antigos.
      const base = defaultProfile();
      return {
        ...base,
        ...parsed,
        stats: { ...base.stats, ...(parsed.stats ?? {}) },
        settings: { ...base.settings, ...(parsed.settings ?? {}) },
        missions: { ...base.missions, ...(parsed.missions ?? {}) },
      };
    } catch {
      return defaultProfile();
    }
  }

  save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.profile));
    } catch {
      // Armazenamento indisponível (modo privado etc.) — jogo segue sem persistir.
    }
  }

  /** Garante que as missões pertencem ao dia atual. */
  rotateMissionsIfNeeded(): void {
    const key = todayKey();
    if (this.profile.missions.dateKey !== key) {
      this.profile.missions = { dateKey: key, progress: {}, claimed: [] };
      this.save();
    }
  }

  addXp(amount: number): void {
    this.profile.xp += Math.max(0, Math.round(amount));
    this.save();
  }

  /** @returns true se a conquista era inédita. */
  unlockAchievement(id: string): boolean {
    if (this.profile.achievements.includes(id)) return false;
    this.profile.achievements.push(id);
    this.save();
    return true;
  }

  recordMatch(record: MatchRecord): void {
    const s = this.profile.stats;
    s.matches++;
    if (record.outcome === 'win') s.wins++;
    else if (record.outcome === 'loss') s.losses++;
    else s.draws++;
    if (record.outcome === 'win' && record.difficulty === 'hard') s.hardWins++;
    s.totalDamage += record.damageDealt;
    s.totalKills += record.kills;
    s.totalDeploys += record.deploys;
    s.playSeconds += Math.round(record.durationSec);
    if (record.wave && record.wave > s.bestWave) s.bestWave = record.wave;
    this.profile.history.unshift(record);
    if (this.profile.history.length > HISTORY_LIMIT) {
      this.profile.history.length = HISTORY_LIMIT;
    }
    this.save();
  }

  setSetting<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    this.profile.settings[key] = value;
    this.save();
  }

  setSkin(id: string): void {
    this.profile.skin = id;
    this.save();
  }

  setTitle(id: string): void {
    this.profile.title = id;
    this.save();
  }

  setName(name: string): void {
    this.profile.name = name.trim().slice(0, 16) || 'Comandante';
    this.save();
  }

  /** Apaga todo o progresso (usado nas configurações). */
  reset(): void {
    this.profile = defaultProfile();
    this.save();
  }

  /** Missões do dia com progresso atual. */
  todaysMissions() {
    this.rotateMissionsIfNeeded();
    return missionsForToday().map((def) => ({
      def,
      progress: this.profile.missions.progress[def.id] ?? 0,
      claimed: this.profile.missions.claimed.includes(def.id),
    }));
  }
}

export const SaveManager = new SaveManagerImpl();
