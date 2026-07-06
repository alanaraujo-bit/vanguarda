/**
 * BotAI.ts — O comandante adversário.
 * Projetado para parecer humano: avalia ameaças por faixa, escolhe counters
 * pela tabela tática, economiza para avanços coordenados, comete erros
 * calibrados pela dificuldade e adapta as escolhas ao estilo do jogador.
 *
 * Decisões em ordem de prioridade:
 *   1. DEFENDER — faixa com ameaça descoberta recebe o counter adequado.
 *   2. CONTINUAR COMBO — termina o avanço que começou (tanque + suporte).
 *   3. AVANÇAR — com energia cheia, ataca a faixa menos defendida.
 */
import Phaser from 'phaser';
import type { DifficultyParams, Role, UnitKey } from '../core/types';
import { PUSH_COMBOS, ROLE_COUNTERS, UNIT_DEFS, UNIT_ORDER } from '../config/units';
import { ENEMY_BASE_Y, LANE_COUNT, PLAYER_BASE_Y } from '../config/constants';
import { EnergySystem } from './EnergySystem';
import type { GameScene } from '../scenes/GameScene';

export class BotAI {
  readonly energy: EnergySystem;

  private game: GameScene;
  private params: DifficultyParams;
  private decisionTimer: number;
  private comboQueue: UnitKey[] = [];
  private comboLane = 0;
  /** Frequência de papéis usados pelo jogador (adaptação de estratégia). */
  private playerUsage: Partial<Record<Role, number>> = {};

  constructor(game: GameScene, params: DifficultyParams) {
    this.game = game;
    this.params = params;
    this.energy = new EnergySystem();
    this.energy.mult = params.regenMult;
    this.decisionTimer = params.decisionInterval * 2;
  }

  /** Sobrecarga: mantém a proporção da dificuldade. */
  setOverdrive(): void {
    this.energy.mult = this.params.regenMult * 2;
  }

  /** GameScene informa cada invocação do jogador (o bot "observa"). */
  notePlayerDeploy(role: Role): void {
    this.playerUsage[role] = (this.playerUsage[role] ?? 0) + 1;
  }

  update(dt: number): void {
    this.energy.update(dt);
    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = this.params.decisionInterval;
      this.decide();
    }
  }

  /* ------------------------------- Decisão -------------------------------- */

  private decide(): void {
    // 1. Defesa da faixa mais ameaçada.
    const lane = this.mostThreatenedLane();
    if (lane !== -1) {
      this.defendLane(lane);
      return;
    }
    // 2. Combo de avanço em andamento.
    if (this.comboQueue.length > 0) {
      const next = this.comboQueue[0];
      if (this.energy.canAfford(UNIT_DEFS[next].cost)) {
        this.comboQueue.shift();
        this.deploy(next, this.comboLane);
      }
      return;
    }
    // 3. Novo avanço quando a reserva está alta.
    if (this.energy.current >= this.params.pushThreshold) {
      this.startPush();
    }
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

  private defendLane(lane: number): void {
    // Erro proposital: dificuldades baixas às vezes reagem na faixa errada.
    let targetLane = lane;
    if (Math.random() < this.params.mistakeChance) {
      targetLane = Phaser.Math.Between(0, LANE_COUNT - 1);
    }
    const counter = this.pickCounter(lane);
    if (counter && this.energy.canAfford(UNIT_DEFS[counter].cost)) {
      this.deploy(counter, targetLane);
    }
  }

  /** Escolhe o counter para o papel dominante entre as ameaças da faixa. */
  private pickCounter(lane: number): UnitKey | null {
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
    // Erro proposital: escolhe qualquer unidade paga em vez do counter ideal.
    if (Math.random() < this.params.mistakeChance) {
      const affordable = UNIT_ORDER.filter((k) => this.energy.canAfford(UNIT_DEFS[k].cost));
      return affordable.length > 0 ? Phaser.Utils.Array.GetRandom(affordable) : null;
    }
    for (const key of ROLE_COUNTERS[dominant]) {
      if (this.energy.canAfford(UNIT_DEFS[key].cost)) return key;
    }
    // Sem counter pagável: joga o mais barato para ganhar tempo.
    return 'faisca';
  }

  private startPush(): void {
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

    if (this.params.smartCombos) {
      // Adaptação: se o jogador abusa de enxames, leva dano em área junto.
      const combos = [...PUSH_COMBOS];
      if ((this.playerUsage.swarm ?? 0) >= 3) combos.push(['trovao', 'bastiao']);
      if ((this.playerUsage.tank ?? 0) + (this.playerUsage.super ?? 0) >= 3) {
        combos.push(['enxame', 'enxame', 'lamina']);
      }
      const combo = Phaser.Utils.Array.GetRandom(combos);
      this.comboLane = lane;
      this.comboQueue = [...combo];
      const first = this.comboQueue.shift();
      if (first && this.energy.canAfford(UNIT_DEFS[first].cost)) {
        this.deploy(first, lane);
      } else if (first) {
        this.comboQueue.unshift(first);
      }
    } else {
      // Fácil: manda uma unidade aleatória que consiga pagar.
      const affordable = UNIT_ORDER.filter((k) => this.energy.canAfford(UNIT_DEFS[k].cost));
      if (affordable.length > 0) {
        this.deploy(Phaser.Utils.Array.GetRandom(affordable), lane);
      }
    }
  }

  private deploy(key: UnitKey, lane: number): void {
    this.game.deployUnit('enemy', key, lane);
  }
}
