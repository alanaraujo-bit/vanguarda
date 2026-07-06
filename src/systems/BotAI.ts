/**
 * BotAI.ts — O comandante adversário.
 * Projetado para parecer humano: avalia ameaças por faixa, escolhe counters
 * pela tabela tática, economiza para avanços coordenados, comete erros
 * calibrados pela dificuldade e adapta as escolhas ao estilo do jogador.
 *
 * A energia do bot vive em shared/sim (state.energy.enemy) — o motor já
 * cuida do regen e da Sobrecarga simetricamente para os dois lados; aqui só
 * decidimos o que e quando invocar.
 *
 * Decisões em ordem de prioridade:
 *   1. DEFENDER — faixa com ameaça descoberta recebe o counter adequado.
 *   2. CONTINUAR COMBO — termina o avanço que começou (tanque + suporte).
 *   3. AVANÇAR — com energia cheia, ataca a faixa menos defendida.
 */
import Phaser from 'phaser';
import type { CardKey, DifficultyParams, Role } from '../../shared/types';
import {
  PUSH_COMBOS,
  ROLE_COUNTERS,
  UNIT_DEFS,
  UNIT_ORDER,
  cardInfo,
  isSpellKey,
} from '../../shared/units';
import { ENEMY_BASE_Y, LANE_COUNT, PLAYER_BASE_Y } from '../../shared/constants';
import type { SimState } from '../../shared/sim/types';
import type { GameScene } from '../scenes/GameScene';

/** Mínimo de alvos agrupados para o bot "gastar" um feitiço ofensivo. */
const SPELL_MIN_TARGETS: Partial<Record<CardKey, number>> = {
  meteoro: 3,
  pulso: 2,
};

export class BotAI {
  private game: GameScene;
  private params: DifficultyParams;
  private decisionTimer: number;
  private comboQueue: CardKey[] = [];
  private comboLane = 0;
  /** Frequência de papéis usados pelo jogador (adaptação de estratégia). */
  private playerUsage: Partial<Record<Role, number>> = {};

  constructor(game: GameScene, params: DifficultyParams) {
    this.game = game;
    this.params = params;
    this.decisionTimer = params.decisionInterval * 2;
  }

  /** GameScene informa cada invocação do jogador (o bot "observa"). */
  notePlayerDeploy(role: Role): void {
    this.playerUsage[role] = (this.playerUsage[role] ?? 0) + 1;
  }

  update(state: SimState, dt: number): void {
    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.params.decisionInterval;
      this.decide(state);
    }
  }

  /* ------------------------------- Decisão -------------------------------- */

  private decide(state: SimState): void {
    // 1. Defesa da faixa mais ameaçada.
    const lane = this.mostThreatenedLane();
    if (lane !== -1) {
      this.defendLane(state, lane);
      return;
    }
    // 2. Combo de avanço em andamento.
    if (this.comboQueue.length > 0) {
      const next = this.comboQueue[0];
      if (state.energy.enemy.current >= cardInfo(next).cost) {
        this.comboQueue.shift();
        if (isSpellKey(next)) {
          // Feitiço de combo (Fúria): cai sobre as próprias tropas avançando.
          this.castSpellOnOwnPush(next);
        } else {
          this.deploy(next, this.comboLane);
        }
      }
      return;
    }
    // 3. Novo avanço quando a reserva está alta.
    if (state.energy.enemy.current >= this.params.pushThreshold) {
      this.startPush(state);
    }
  }

  /* ------------------------------- Feitiços -------------------------------- */

  /** Centro do grupo de unidades do JOGADOR numa faixa (e o tamanho do grupo). */
  private playerClusterIn(lane: number): { x: number; y: number; count: number } | null {
    const members = this.game.unitsOf('player').filter((u) => u.lane === lane);
    if (members.length === 0) return null;
    const x = members.reduce((s, u) => s + u.x, 0) / members.length;
    const y = members.reduce((s, u) => s + u.y, 0) / members.length;
    return { x, y, count: members.length };
  }

  /** Fúria (ou similar) sobre o próprio avanço na faixa do combo. */
  private castSpellOnOwnPush(key: CardKey): void {
    const own = this.game.unitsOf('enemy').filter((u) => u.lane === this.comboLane);
    if (own.length === 0) return; // avanço já morreu — não desperdiça o feitiço
    // "Frente" do avanço do bot = maior Y (ele desce rumo à base do jogador).
    const front = own.reduce((a, b) => (a.y > b.y ? a : b));
    this.game.localDeploy('enemy', key, this.comboLane, false, front.x, front.y);
  }

  /** Ameaça = custo das unidades do jogador ponderado pela proximidade da minha base. */
  private laneThreat(lane: number): number {
    let threat = 0;
    for (const u of this.game.unitsOf('player')) {
      if (u.lane !== lane) continue;
      // Progresso do jogador rumo à base inimiga (topo): 0 = na própria base, 1 = chegou.
      const progress = Phaser.Math.Clamp(
        (PLAYER_BASE_Y - u.y) / (PLAYER_BASE_Y - ENEMY_BASE_Y),
        0,
        1
      );
      threat += u.power * (0.5 + progress);
    }
    return threat;
  }

  private laneDefense(lane: number, team: 'player' | 'enemy'): number {
    let def = 0;
    for (const u of this.game.unitsOf(team)) {
      if (u.lane === lane) def += u.power;
    }
    return def;
  }

  /** Retorna a faixa que exige defesa imediata, ou -1. */
  private mostThreatenedLane(): number {
    let worst = -1;
    let worstScore = 0;
    for (let lane = 0; lane < LANE_COUNT; lane++) {
      const score = this.laneThreat(lane) - this.laneDefense(lane, 'enemy') * 0.95;
      if (score > 2.4 && score > worstScore) {
        worstScore = score;
        worst = lane;
      }
    }
    return worst;
  }

  private defendLane(state: SimState, lane: number): void {
    // Erro proposital: dificuldades baixas às vezes reagem na faixa errada.
    let targetLane = lane;
    if (Math.random() < this.params.mistakeChance) {
      targetLane = Phaser.Math.Between(0, LANE_COUNT - 1);
    }
    const counter = this.pickCounter(state, lane);
    if (!counter || state.energy.enemy.current < cardInfo(counter).cost) return;

    if (isSpellKey(counter)) {
      // Feitiço defensivo: cai no centro do grupo que ameaça a faixa REAL
      // (feitiço mira posição, não faixa — o erro de faixa não se aplica).
      const cluster = this.playerClusterIn(lane);
      if (cluster) this.game.localDeploy('enemy', counter, lane, false, cluster.x, cluster.y);
      return;
    }
    this.deploy(counter, targetLane);
  }

  /** Escolhe o counter para o papel dominante entre as ameaças da faixa. */
  private pickCounter(state: SimState, lane: number): CardKey | null {
    const byRole = new Map<Role, number>();
    for (const u of this.game.unitsOf('player')) {
      if (u.lane !== lane) continue;
      byRole.set(u.def.role, (byRole.get(u.def.role) ?? 0) + u.power);
    }
    if (byRole.size === 0) return null;
    let dominant: Role = 'shock';
    let max = -1;
    byRole.forEach((v, k) => {
      if (v > max) {
        max = v;
        dominant = k;
      }
    });
    const affordable = (key: CardKey) => state.energy.enemy.current >= cardInfo(key).cost;
    // Erro proposital: escolhe qualquer unidade paga em vez do counter ideal.
    if (Math.random() < this.params.mistakeChance) {
      const pool = UNIT_ORDER.filter(affordable);
      return pool.length > 0 ? Phaser.Utils.Array.GetRandom(pool) : null;
    }
    const cluster = this.playerClusterIn(lane);
    for (const key of ROLE_COUNTERS[dominant]) {
      if (!affordable(key)) continue;
      // Feitiço só vale a pena contra grupo — senão passa para a próxima opção.
      if (isSpellKey(key)) {
        const minTargets = SPELL_MIN_TARGETS[key] ?? 2;
        if (!cluster || cluster.count < minTargets) continue;
      }
      return key;
    }
    // Sem counter pagável: joga o mais barato para ganhar tempo.
    return 'faisca';
  }

  private startPush(state: SimState): void {
    // Ataca a faixa onde o jogador está mais fraco.
    let lane = 0;
    let min = Infinity;
    for (let i = 0; i < LANE_COUNT; i++) {
      const d = this.laneDefense(i, 'player') + this.laneThreat(i);
      if (d < min) {
        min = d;
        lane = i;
      }
    }
    if (Math.random() < this.params.mistakeChance) {
      lane = Phaser.Math.Between(0, LANE_COUNT - 1);
    }

    const affordable = (key: CardKey) => state.energy.enemy.current >= cardInfo(key).cost;

    if (this.params.smartCombos) {
      // Adaptação: se o jogador abusa de enxames, leva dano em área junto.
      const combos = [...PUSH_COMBOS];
      if ((this.playerUsage.swarm ?? 0) >= 3) combos.push(['trovao', 'bastiao'], ['estopim', 'bastiao']);
      if ((this.playerUsage.tank ?? 0) + (this.playerUsage.super ?? 0) >= 3) {
        combos.push(['enxame', 'enxame', 'lamina'], ['gelido', 'enxame']);
      }
      if ((this.playerUsage.flyer ?? 0) >= 2) combos.push(['vigia', 'agulha']);
      if ((this.playerUsage.breaker ?? 0) >= 2) combos.push(['vigia', 'enxame']);
      const combo = Phaser.Utils.Array.GetRandom(combos);
      this.comboLane = lane;
      this.comboQueue = [...combo];
      const first = this.comboQueue.shift();
      if (first && !isSpellKey(first) && affordable(first)) {
        this.deploy(first, lane);
      } else if (first) {
        this.comboQueue.unshift(first);
      }
    } else {
      // Fácil: manda uma tropa aleatória que consiga pagar (sem feitiços/torres).
      const pool = UNIT_ORDER.filter((k) => UNIT_DEFS[k].kind !== 'building' && affordable(k));
      if (pool.length > 0) {
        this.deploy(Phaser.Utils.Array.GetRandom(pool), lane);
      }
    }
  }

  private deploy(key: CardKey, lane: number): void {
    this.game.localDeploy('enemy', key, lane);
  }
}
