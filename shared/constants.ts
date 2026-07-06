/**
 * constants.ts — Constantes de layout, paleta e balanceamento global.
 * Toda dimensão de tela deriva da resolução de design 720x1280 (retrato,
 * estilo Clash Royale — escalada com Scale.FIT para qualquer dispositivo).
 * Base inimiga no topo, base do jogador embaixo, faixas verticais.
 */

export const GAME_WIDTH = 720;
export const GAME_HEIGHT = 1280;

/** Pilha tipográfica do jogo (sem fontes externas — carregamento instantâneo). */
export const FONT = '"Segoe UI", "Trebuchet MS", Verdana, sans-serif';

/* ---------------------------------- Campo --------------------------------- */

/** Coordenadas X do centro de cada faixa de combate (verticais). */
export const LANE_XS = [150, 360, 570] as const;
export const LANE_COUNT = LANE_XS.length;
/** Meia-largura visual de uma faixa. */
export const LANE_HALF_WIDTH = 56;

/** Extensão vertical tocável do campo (abaixo da barra superior, acima da bandeja). */
export const FIELD_TOP = 120;
export const FIELD_BOTTOM = 1005;

export const ENEMY_BASE_Y = FIELD_TOP + 100;
export const PLAYER_BASE_Y = FIELD_BOTTOM - 95;
/** Unidades nascem à frente da própria base. */
export const SPAWN_OFFSET = 90;
/** Construções são erguidas mais à frente, defendendo a própria metade. */
export const BUILDING_OFFSET = 175;

/* ------------------------- Efeitos de status/feitiços ---------------------- */

/** Multiplicador de velocidade/cadência sob lentidão (Gélido). */
export const SLOW_FACTOR = 0.65;
/** Multiplicador de velocidade/cadência sob Fúria. */
export const RAGE_FACTOR = 1.4;
/** Feitiços de dano acertam bases com dano reduzido (anti-spam de feitiço). */
export const SPELL_BASE_DAMAGE_MULT = 0.5;

/**
 * Escala visual das unidades no campo (só o sprite/sombra — o balanceamento
 * de combate usa `radius` das defs e não muda). Aumenta a leitura no celular.
 */
export const UNIT_VISUAL_SCALE = 1.35;

/* --------------------------------- Bases ---------------------------------- */

export const BASE_HP = 3000;
export const BASE_RADIUS = 78;
export const TURRET_DAMAGE = 34;
export const TURRET_RANGE = 250;
export const TURRET_COOLDOWN = 1.15;

/* --------------------------------- Energia -------------------------------- */

export const ENERGY_MAX = 10;
/** Energia por segundo em ritmo normal. */
export const ENERGY_REGEN = 1 / 1.4;
export const ENERGY_START = 5;
/** Multiplicador na fase final da partida ("Sobrecarga"). */
export const OVERDRIVE_MULT = 2;

/* --------------------------------- Partida -------------------------------- */

/** Duração do modo versus, em segundos. */
export const MATCH_DURATION = 180;
/** Últimos N segundos entram em Sobrecarga (energia 2x). */
export const OVERDRIVE_AT = 60;
/** Limite de unidades vivas por lado (desempenho + legibilidade). */
export const MAX_UNITS_PER_TEAM = 32;

/* --------------------------------- Paleta --------------------------------- */

export const COLORS = {
  /** Fundo profundo do espaço. */
  bgDeep: 0x05070f,
  bgMid: 0x0b1226,
  /** Superfície da arena. */
  ground: 0x101a33,
  groundLine: 0x22335f,
  laneGlow: 0x1b2c55,
  /** Time do jogador (padrão — skins alteram). */
  player: 0x38e1ff,
  /** Time inimigo. */
  enemy: 0xff5a3c,
  /** Interface. */
  uiPanel: 0x0d1530,
  uiPanelLight: 0x16224a,
  uiStroke: 0x2e4a8f,
  uiText: 0xeaf6ff,
  uiTextDim: 0x8fa8d8,
  gold: 0xffc94d,
  danger: 0xff4d6b,
  success: 0x4dffa1,
  energy: 0x7b5cff,
  heal: 0x6cff9e,
} as const;

/** Versões CSS ('#rrggbb') das cores usadas em estilos de texto. */
export const CSS = {
  text: '#eaf6ff',
  textDim: '#8fa8d8',
  gold: '#ffc94d',
  danger: '#ff4d6b',
  success: '#4dffa1',
  player: '#38e1ff',
  enemy: '#ff5a3c',
  energy: '#a98cff',
} as const;

/* --------------------------------- Camadas -------------------------------- */

export const DEPTH = {
  bg: 0,
  lanes: 5,
  bases: 10,
  /** Unidades usam depth = y (ordenação vertical natural) dentro desta banda. */
  unitsBase: 100,
  projectiles: 2000,
  fxLow: 2100,
  fxHigh: 2500,
  announce: 3000,
} as const;

/** Converte cor numérica para string CSS. */
export function hex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}
