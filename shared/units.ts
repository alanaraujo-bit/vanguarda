/**
 * units.ts — Definições data-driven das cartas (tropas, construções e feitiços).
 * Todo o balanceamento de combate vive aqui: ajustar o jogo
 * não exige tocar em código de sistema.
 *
 * Teia de counters (pedra-papel-tesoura):
 *  - Bastião/Titã/Sentinela (muito HP) <- derretidos por Enxame/Fagulha (muitos golpes)
 *  - Enxame/grupos                     <- varridos por Trovão, Meteoro e Estopim (área)
 *  - Trovão/Agulha/Gélido/Lúmen        <- assassinados por Lâmina e Vespa (rápidas)
 *  - Lâmina                            <- parada por Bastião, Sentinela e Faísca
 *  - Vespa (voadora)                   <- só cai para Agulha, Gélido, Vigia e feitiços
 *  - Aríete (só construções)           <- cercado por tropas baratas; Pulso zera a investida
 *  - Construções                       <- Aríete, Trovão e feitiços as punem de longe
 *  - Avanços sustentados               <- Lúmen mantém a linha viva; Fúria acelera o golpe final
 */
import type { CardKey, Role, SpellDef, SpellKey, UnitDef, UnitKey } from './types';

export const UNIT_DEFS: Record<UnitKey, UnitDef> = {
  /* -------------------------------- Tropas -------------------------------- */

  faisca: {
    key: 'faisca',
    name: 'Faísca',
    role: 'shock',
    desc: 'Recruta de choque. Barata, honesta e sempre pronta pra briga.',
    forte: 'Custo-benefício em qualquer defesa',
    fraco: 'Perde trocas contra especialistas',
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
  fagulha: {
    key: 'fagulha',
    name: 'Fagulha',
    role: 'swarm',
    desc: 'Dupla de mini-bots descartáveis. Distração honesta por 1 de energia.',
    forte: 'Cicla o deck e distrai por quase nada',
    fraco: 'Morre com qualquer golpe',
    cost: 1,
    hp: 55,
    damage: 11,
    attackCooldown: 0.55,
    range: 36,
    speed: 95,
    radius: 12,
    aggroRange: 250,
    count: 2,
    accent: 0xffd24d,
  },
  agulha: {
    key: 'agulha',
    name: 'Agulha',
    role: 'ranged',
    desc: 'Atiradora de plasma. Fere de longe, chora de perto.',
    forte: 'Derruba voadores e fere de longe',
    fraco: 'Frágil se a linha de frente cair',
    cost: 3,
    hp: 140,
    damage: 27,
    attackCooldown: 0.9,
    range: 225,
    speed: 55,
    radius: 18,
    aggroRange: 300,
    projectileSpeed: 520,
    targetsAir: true,
    accent: 0xa1ff6e,
  },
  gelido: {
    key: 'gelido',
    name: 'Gélido',
    role: 'support',
    desc: 'Mago de gelo. Cada disparo congela o ritmo do alvo.',
    forte: 'Lentidão desmonta investidas e tanques',
    fraco: 'Dano baixo; caça fácil para assassinas',
    cost: 3,
    hp: 150,
    damage: 18,
    attackCooldown: 1.0,
    range: 210,
    speed: 50,
    radius: 18,
    aggroRange: 280,
    projectileSpeed: 480,
    targetsAir: true,
    slowOnHit: 2,
    accent: 0x8ae8ff,
  },
  lamina: {
    key: 'lamina',
    name: 'Lâmina',
    role: 'assassin',
    desc: 'Assassina veloz. Caça atiradores e artilharia sem dó.',
    forte: 'Alcança a retaguarda em segundos',
    fraco: 'Derrete sob foco de tanques e grupos',
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
  estopim: {
    key: 'estopim',
    name: 'Estopim',
    role: 'bomber',
    desc: 'Corre, abraça e explode. Simples assim.',
    forte: 'Explosão devastadora em área',
    fraco: 'Se morrer antes de chegar, não explode',
    cost: 3,
    hp: 240,
    damage: 230,
    attackCooldown: 1.0,
    range: 40,
    speed: 96,
    radius: 17,
    aggroRange: 280,
    kamikaze: true,
    splashRadius: 85,
    accent: 0xff8a3c,
  },
  enxame: {
    key: 'enxame',
    name: 'Enxame',
    role: 'swarm',
    desc: 'Trio de drones furiosos. Individualmente fracos, juntos… um problema.',
    forte: 'Derrete tanques e colossos',
    fraco: 'Some com qualquer dano em área',
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
  lumen: {
    key: 'lumen',
    name: 'Lúmen',
    role: 'support',
    desc: 'Droide médico. Mantém o avanço respirando.',
    forte: 'Sustenta qualquer avanço por trás',
    fraco: 'Inofensivo sozinho; alvo prioritário',
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
  vespa: {
    key: 'vespa',
    name: 'Vespa',
    role: 'flyer',
    desc: 'Caça voadora. Quem luta no chão só pode assistir.',
    forte: 'Imune a golpes corpo a corpo',
    fraco: 'Atiradores e torres a derrubam rápido',
    cost: 4,
    hp: 290,
    damage: 40,
    attackCooldown: 0.7,
    range: 42,
    speed: 88,
    radius: 18,
    aggroRange: 300,
    flying: true,
    targetsAir: true,
    accent: 0xb46eff,
  },
  sentinela: {
    key: 'sentinela',
    name: 'Sentinela',
    role: 'tank',
    desc: 'Duelista com escudo de energia que engole golpes inteiros.',
    forte: 'Escudo anula os golpes mais pesados',
    fraco: 'Golpes rápidos corroem o escudo',
    cost: 4,
    hp: 400,
    damage: 52,
    attackCooldown: 0.9,
    range: 48,
    speed: 58,
    radius: 22,
    aggroRange: 260,
    shield: 260,
    accent: 0x6ee7c8,
  },
  ariete: {
    key: 'ariete',
    name: 'Aríete',
    role: 'breaker',
    desc: 'Só enxerga construções. Ganha embalo e dobra o primeiro golpe.',
    forte: 'Ignora tropas e esmaga construções',
    fraco: 'Indefeso contra quem o cerca',
    cost: 4,
    hp: 820,
    damage: 95,
    attackCooldown: 1.5,
    range: 50,
    speed: 52,
    radius: 26,
    aggroRange: 400,
    buildingsOnly: true,
    charge: { dist: 150, mult: 2, speedMult: 1.7 },
    accent: 0xd8b46e,
  },
  bastiao: {
    key: 'bastiao',
    name: 'Bastião',
    role: 'tank',
    desc: 'Muralha ambulante. Absorve dano enquanto o time trabalha.',
    forte: 'Segura a linha de frente sozinho',
    fraco: 'Enxames o desmontam em segundos',
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
  trovao: {
    key: 'trovao',
    name: 'Trovão',
    role: 'siege',
    desc: 'Artilharia de cerco. Cada disparo redecora o campo.',
    forte: 'Limpa grupos inteiros de longe',
    fraco: 'Não mira voadores; frágil de perto',
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
  tita: {
    key: 'tita',
    name: 'Titã',
    role: 'super',
    desc: 'A palavra final. Lento, colossal, inevitável.',
    forte: 'Golpes em área que ninguém segura só',
    fraco: 'Lento — enxames e lentidão o punem',
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

  /* ------------------------------ Construções ------------------------------ */

  vigia: {
    key: 'vigia',
    name: 'Torre Vigia',
    role: 'building',
    desc: 'Sentinela fixa: metralha ar e terra até a bateria acabar.',
    forte: 'Segura avanços e derruba voadores',
    fraco: 'Bateria esgota; feitiços a ferem de graça',
    cost: 4,
    hp: 620,
    damage: 38,
    attackCooldown: 0.75,
    range: 240,
    speed: 0,
    radius: 26,
    aggroRange: 240,
    projectileSpeed: 620,
    targetsAir: true,
    kind: 'building',
    lifetime: 32,
    accent: 0x9adcff,
  },
  forja: {
    key: 'forja',
    name: 'Forja',
    role: 'building',
    desc: 'Cabana-fábrica: solta Fagulhas enquanto durar.',
    forte: 'Pressão constante na faixa inteira',
    fraco: 'Cerco e feitiços a desmontam de longe',
    cost: 5,
    hp: 520,
    damage: 0,
    attackCooldown: 1.0,
    range: 0,
    speed: 0,
    radius: 28,
    aggroRange: 0,
    kind: 'building',
    lifetime: 40,
    spawn: { key: 'fagulha', every: 5.5 },
    accent: 0xffb35c,
  },
  dinamo: {
    key: 'dinamo',
    name: 'Dínamo',
    role: 'building',
    desc: 'Reator auxiliar: converte tempo em energia.',
    forte: 'Vantagem de energia no fim do jogo',
    fraco: 'Investimento que o inimigo pode punir',
    cost: 5,
    hp: 380,
    damage: 0,
    attackCooldown: 1.0,
    range: 0,
    speed: 0,
    radius: 26,
    aggroRange: 0,
    kind: 'building',
    lifetime: 42,
    energyRate: 0.22,
    accent: 0xc59bff,
  },
};

/* --------------------------------- Feitiços -------------------------------- */

export const SPELL_DEFS: Record<SpellKey, SpellDef> = {
  meteoro: {
    key: 'meteoro',
    name: 'Meteoro',
    desc: 'Chamado orbital: dano pesado onde você apontar.',
    forte: 'Apaga enxames e suportes agrupados',
    fraco: 'Desperdício contra alvo único',
    cost: 4,
    radius: 95,
    damage: 190,
    accent: 0xff6a3c,
  },
  pulso: {
    key: 'pulso',
    name: 'Pulso',
    desc: 'Descarga estática: dano leve e atordoamento instantâneo.',
    forte: 'Interrompe investidas e reseta ataques',
    fraco: 'Dano baixo; efeito passageiro',
    cost: 2,
    radius: 85,
    damage: 60,
    stunDur: 1.1,
    accent: 0xffe36e,
  },
  furia: {
    key: 'furia',
    name: 'Fúria',
    desc: 'Injeta fúria nos aliados: mais rápidos, mais cruéis.',
    forte: 'Transforma um avanço em avalanche',
    fraco: 'Não faz nada sozinho',
    cost: 3,
    radius: 120,
    rageDur: 6,
    accent: 0xff4d6b,
  },
};

/* ------------------------------ Visão de carta ------------------------------ */

export type CardType = 'tropa' | 'construcao' | 'feitico';

/** Subconjunto comum a qualquer carta — o que HUD/deck/enciclopédia precisam. */
export interface CardInfo {
  key: CardKey;
  name: string;
  cost: number;
  desc: string;
  forte: string;
  fraco: string;
  accent: number;
  type: CardType;
}

export function isSpellKey(key: CardKey): key is SpellKey {
  return key in SPELL_DEFS;
}

export function cardInfo(key: CardKey): CardInfo {
  if (isSpellKey(key)) {
    const s = SPELL_DEFS[key];
    return { key, name: s.name, cost: s.cost, desc: s.desc, forte: s.forte, fraco: s.fraco, accent: s.accent, type: 'feitico' };
  }
  const u = UNIT_DEFS[key];
  return {
    key,
    name: u.name,
    cost: u.cost,
    desc: u.desc,
    forte: u.forte,
    fraco: u.fraco,
    accent: u.accent,
    type: u.kind === 'building' ? 'construcao' : 'tropa',
  };
}

/* --------------------------------- Ordens ---------------------------------- */

/** Ordem canônica das unidades (tropas por custo, depois construções). */
export const UNIT_ORDER: UnitKey[] = [
  'fagulha',
  'faisca',
  'enxame',
  'lamina',
  'agulha',
  'gelido',
  'estopim',
  'lumen',
  'vespa',
  'sentinela',
  'ariete',
  'bastiao',
  'trovao',
  'tita',
  'vigia',
  'forja',
  'dinamo',
];

/** Ordem de exibição de TODAS as cartas (enciclopédia/editor de deck). */
export const CARD_ORDER: CardKey[] = [...UNIT_ORDER, 'pulso', 'furia', 'meteoro'];

/** Deck inicial (o clássico dos 8 — o jogador monta o seu no editor). */
export const DEFAULT_DECK: CardKey[] = [
  'faisca',
  'enxame',
  'lamina',
  'agulha',
  'lumen',
  'bastiao',
  'trovao',
  'tita',
];

/** Tamanho obrigatório do deck de batalha. */
export const DECK_SIZE = 8;

/** Tabela de counters usada pelo bot: papel da ameaça -> respostas ideais (cartas). */
export const ROLE_COUNTERS: Record<Role, CardKey[]> = {
  tank: ['enxame', 'lamina', 'estopim', 'trovao'],
  super: ['enxame', 'estopim', 'lamina', 'lumen'],
  swarm: ['meteoro', 'trovao', 'pulso', 'faisca'],
  ranged: ['lamina', 'vespa', 'bastiao', 'faisca'],
  shock: ['agulha', 'faisca', 'bastiao'],
  siege: ['lamina', 'vespa', 'enxame', 'agulha'],
  support: ['lamina', 'vespa', 'agulha', 'enxame'],
  assassin: ['sentinela', 'faisca', 'bastiao', 'enxame'],
  flyer: ['agulha', 'gelido', 'vigia', 'vespa'],
  bomber: ['agulha', 'gelido', 'fagulha'],
  breaker: ['enxame', 'lamina', 'pulso', 'faisca'],
  building: ['ariete', 'trovao', 'vespa'],
};

/** Combos de avanço que o bot usa em dificuldades maiores (mesma faixa, em sequência). */
export const PUSH_COMBOS: CardKey[][] = [
  ['bastiao', 'agulha'],
  ['bastiao', 'lumen'],
  ['bastiao', 'gelido'],
  ['tita', 'lumen'],
  ['tita', 'lumen', 'furia'],
  ['trovao', 'faisca'],
  ['bastiao', 'enxame'],
  ['lamina', 'enxame'],
  ['sentinela', 'agulha'],
  ['sentinela', 'lumen'],
  ['ariete', 'gelido'],
  ['ariete', 'furia'],
  ['vespa', 'gelido'],
  ['forja', 'faisca'],
];
