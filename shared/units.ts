/**
 * units.ts — Definições data-driven das unidades.
 * Todo o balanceamento de combate vive aqui: ajustar o jogo
 * não exige tocar em código de sistema.
 *
 * Teia de counters (pedra-papel-tesoura):
 *  - Bastião/Titã (muito HP)  <- derretidos por Enxame (muitos golpes)
 *  - Enxame/grupos            <- varridos por Trovão (dano em área)
 *  - Trovão/Agulha/Lumen      <- assassinados por Lâmina (rápida)
 *  - Lâmina                   <- parada por Bastião e Faísca (corpo a corpo barato)
 *  - Avanços sustentados      <- Lumen mantém a linha viva
 */
import type { Role, UnitDef, UnitKey } from './types';

export const UNIT_DEFS: Record<UnitKey, UnitDef> = {
  faisca: {
    key: 'faisca',
    name: 'Faísca',
    role: 'shock',
    desc: 'Recruta de choque. Barata, honesta e sempre pronta pra briga.',
    cost: 2,
    hp: 230,
    damage: 30,
    attackCooldown: 0.8,
    range: 46,
    speed: 62,
    radius: 20,
    aggroRange: 240,
    accent: 0xffe36e,
  },
  agulha: {
    key: 'agulha',
    name: 'Agulha',
    role: 'ranged',
    desc: 'Atiradora de plasma. Fere de longe, chora de perto.',
    cost: 3,
    hp: 140,
    damage: 27,
    attackCooldown: 0.9,
    range: 225,
    speed: 55,
    radius: 18,
    aggroRange: 300,
    projectileSpeed: 520,
    accent: 0xa1ff6e,
  },
  bastiao: {
    key: 'bastiao',
    name: 'Bastião',
    role: 'tank',
    desc: 'Muralha ambulante. Absorve dano enquanto o time trabalha.',
    cost: 5,
    hp: 950,
    damage: 42,
    attackCooldown: 1.3,
    range: 52,
    speed: 34,
    radius: 30,
    aggroRange: 220,
    accent: 0x6ec9ff,
  },
  lamina: {
    key: 'lamina',
    name: 'Lâmina',
    role: 'assassin',
    desc: 'Assassina veloz. Caça atiradores e artilharia sem dó.',
    cost: 3,
    hp: 135,
    damage: 58,
    attackCooldown: 0.6,
    range: 44,
    speed: 118,
    radius: 18,
    aggroRange: 320,
    accent: 0xff6ee1,
  },
  lumen: {
    key: 'lumen',
    name: 'Lúmen',
    role: 'support',
    desc: 'Droide médico. Mantém o avanço respirando.',
    cost: 4,
    hp: 190,
    damage: 24,
    attackCooldown: 0.85,
    range: 185,
    speed: 50,
    radius: 19,
    aggroRange: 260,
    healer: true,
    projectileSpeed: 430,
    accent: 0x6cff9e,
  },
  trovao: {
    key: 'trovao',
    name: 'Trovão',
    role: 'siege',
    desc: 'Artilharia de cerco. Cada disparo redecora o campo.',
    cost: 6,
    hp: 210,
    damage: 74,
    attackCooldown: 2.3,
    range: 310,
    speed: 30,
    radius: 24,
    aggroRange: 340,
    splashRadius: 72,
    projectileSpeed: 330,
    arcingProjectile: true,
    accent: 0xffa14d,
  },
  enxame: {
    key: 'enxame',
    name: 'Enxame',
    role: 'swarm',
    desc: 'Trio de drones furiosos. Individualmente fracos, juntos… um problema.',
    cost: 3,
    hp: 62,
    damage: 15,
    attackCooldown: 0.5,
    range: 38,
    speed: 92,
    radius: 13,
    aggroRange: 260,
    count: 3,
    accent: 0xc4f54d,
  },
  tita: {
    key: 'tita',
    name: 'Titã',
    role: 'super',
    desc: 'A palavra final. Lento, colossal, inevitável.',
    cost: 8,
    hp: 1500,
    damage: 115,
    attackCooldown: 1.6,
    range: 64,
    speed: 27,
    radius: 36,
    aggroRange: 240,
    splashRadius: 60,
    accent: 0xff4d6b,
  },
};

/** Ordem das cartas na HUD. */
export const UNIT_ORDER: UnitKey[] = [
  'faisca',
  'enxame',
  'lamina',
  'agulha',
  'lumen',
  'bastiao',
  'trovao',
  'tita',
];

/** Tabela de counters usada pelo bot: papel da ameaça -> respostas ideais. */
export const ROLE_COUNTERS: Record<Role, UnitKey[]> = {
  tank: ['enxame', 'lamina', 'trovao'],
  super: ['enxame', 'lamina', 'lumen'],
  swarm: ['trovao', 'faisca', 'tita'],
  ranged: ['lamina', 'bastiao', 'faisca'],
  shock: ['agulha', 'faisca', 'bastiao'],
  siege: ['lamina', 'enxame', 'agulha'],
  support: ['lamina', 'agulha', 'enxame'],
  assassin: ['faisca', 'bastiao', 'enxame'],
};

/** Combos de avanço que o bot usa em dificuldades maiores. */
export const PUSH_COMBOS: UnitKey[][] = [
  ['bastiao', 'agulha'],
  ['bastiao', 'lumen'],
  ['tita', 'lumen'],
  ['trovao', 'faisca'],
  ['bastiao', 'enxame'],
  ['lamina', 'enxame'],
];
