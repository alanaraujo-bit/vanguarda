/**
 * types.ts — Contratos de dados compartilhados por todo o jogo.
 * Nenhum módulo de gameplay deve definir tipos estruturais próprios:
 * tudo que cruza fronteiras de sistema vive aqui.
 */

/** Lado do combate. */
export type Team = 'player' | 'enemy';

/** Identificadores canônicos das unidades. */
export type UnitKey =
  | 'faisca'
  | 'agulha'
  | 'bastiao'
  | 'lamina'
  | 'lumen'
  | 'trovao'
  | 'enxame'
  | 'tita';

/** Papel tático — usado pela IA para escolher counters. */
export type Role =
  | 'shock'
  | 'ranged'
  | 'tank'
  | 'assassin'
  | 'support'
  | 'siege'
  | 'swarm'
  | 'super';

export type GameMode = 'training' | 'versus' | 'survival' | 'online';
export type Difficulty = 'easy' | 'normal' | 'hard';

/** Definição estática (data-driven) de uma unidade. */
export interface UnitDef {
  key: UnitKey;
  name: string;
  role: Role;
  desc: string;
  /** Custo em energia. */
  cost: number;
  hp: number;
  /** Dano por ataque (ou cura por pulso, se healer). */
  damage: number;
  /** Segundos entre ataques. */
  attackCooldown: number;
  /** Alcance de ataque em pixels. */
  range: number;
  /** Velocidade de deslocamento em px/s. */
  speed: number;
  /** Raio visual/colisão do corpo. */
  radius: number;
  /** Distância na qual a unidade percebe inimigos. */
  aggroRange: number;
  /** Dano em área ao redor do impacto, se definido. */
  splashRadius?: number;
  /** true = cura aliados em vez de priorizar ataque. */
  healer?: boolean;
  /** Quantas cópias são invocadas por carta (enxames). */
  count?: number;
  /** Se definido, ataque é à distância com projétil nessa velocidade (px/s). */
  projectileSpeed?: number;
  /** Projétil em arco balístico (artilharia). */
  arcingProjectile?: boolean;
  /** Cor de destaque própria da unidade (visor/emblema). */
  accent: number;
}

/** Parâmetros de personalidade/dificuldade do bot. */
export interface DifficultyParams {
  label: string;
  /** Multiplicador de regeneração de energia do bot. */
  regenMult: number;
  /** Intervalo entre decisões, em segundos. */
  decisionInterval: number;
  /** Chance (0..1) de tomar uma decisão subótima. */
  mistakeChance: number;
  /** Energia mínima antes de iniciar um avanço ofensivo. */
  pushThreshold: number;
  /** Usa combos coordenados (tanque + suporte) nos avanços. */
  smartCombos: boolean;
}

/** Resultado consolidado de uma partida (persistido no histórico). */
export interface MatchRecord {
  mode: GameMode;
  difficulty?: Difficulty;
  /** 'win' | 'loss' | 'draw' — treino não gera registro. */
  outcome: 'win' | 'loss' | 'draw';
  durationSec: number;
  damageDealt: number;
  kills: number;
  deploys: number;
  wave?: number;
  xpGained: number;
  /** Timestamp epoch ms. */
  date: number;
}

/** Configurações do jogador (persistidas). */
export interface SettingsData {
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  particles: 'high' | 'low';
  showFps: boolean;
}

/** Estado de progresso das missões diárias. */
export interface MissionState {
  /** Chave AAAA-MM-DD do dia em que as missões foram geradas. */
  dateKey: string;
  /** Progresso por id de missão. */
  progress: Record<string, number>;
  /** Missões já recompensadas. */
  claimed: string[];
}

/** Perfil persistido do jogador. */
export interface ProfileData {
  name: string;
  xp: number;
  skin: string;
  title: string;
  achievements: string[];
  missions: MissionState;
  stats: {
    matches: number;
    wins: number;
    losses: number;
    draws: number;
    bestWave: number;
    totalDamage: number;
    totalKills: number;
    totalDeploys: number;
    playSeconds: number;
    hardWins: number;
  };
  history: MatchRecord[];
  settings: SettingsData;
}

export interface AchievementDef {
  id: string;
  name: string;
  desc: string;
  /** Ícone (chave de textura gerada proceduralmente). */
  icon: 'medal' | 'star' | 'skull' | 'bolt' | 'shield' | 'crown';
  check(profile: ProfileData, last?: MatchRecord): boolean;
}

export interface SkinDef {
  id: string;
  name: string;
  /** Cor primária das unidades do jogador. */
  color: number;
  /** Nível necessário. */
  level: number;
}

export interface TitleDef {
  id: string;
  name: string;
  level: number;
}

export interface MissionDef {
  id: string;
  desc: string;
  /** Estatística observada por partida. */
  stat: 'damageDealt' | 'kills' | 'deploys' | 'wins' | 'matches';
  target: number;
  rewardXp: number;
}

/** Dados passados à GameScene ao iniciar uma partida. */
export interface MatchConfig {
  mode: GameMode;
  difficulty: Difficulty;
}

/** Resumo entregue à ResultScene ao fim da partida. */
export interface MatchSummary {
  config: MatchConfig;
  outcome: 'win' | 'loss' | 'draw';
  record: MatchRecord | null;
  levelBefore: number;
  levelAfter: number;
  xpBefore: number;
  xpAfter: number;
  unlockedAchievements: string[];
  completedMissions: string[];
  newSkins: string[];
  newTitles: string[];
}
