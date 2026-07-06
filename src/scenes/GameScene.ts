/**
 * GameScene.ts — O coração do jogo: a batalha em tempo real.
 * Orquestra unidades, bases, energia, IA adversária, ondas de sobrevivência,
 * efeitos e o desfecho da partida. O combate em si (alvo, movimento, dano,
 * projéteis, torreta, cronômetro) vive em shared/sim/engine.ts — esta scene
 * roda esse motor (localmente aqui, ou recebido do servidor no online) e só
 * cuida da apresentação: sprites, tweens, partículas, som, HUD.
 *
 * A HUD roda como scene paralela e conversa com esta via bus de eventos
 * e chamadas diretas à API pública (playerDeploy, playerEnergy...).
 */
import Phaser from 'phaser';
import type { CardKey, SpellKey, Team, UnitKey } from '../../shared/types';
import type { MatchResolution, MatchSnapshot, SnapshotProjectile } from '../../shared/netProtocol';
import { STATUS_RAGE, STATUS_SLOW, STATUS_STUN } from '../../shared/netProtocol';
import { createInitialState, applyDeployCommand, step } from '../../shared/sim/engine';
import { Rng } from '../../shared/sim/rng';
import type { SimEvent, SimState } from '../../shared/sim/types';
import { NetworkController, type OnlineMatchConfig } from '../net/NetworkController';
import {
  BUILDING_OFFSET,
  COLORS,
  DEPTH,
  ENEMY_BASE_Y,
  GAME_HEIGHT,
  GAME_WIDTH,
  LANE_XS,
  MATCH_DURATION,
  PLAYER_BASE_Y,
  SPAWN_OFFSET,
} from '../../shared/constants';
import { SPELL_DEFS, UNIT_DEFS, cardInfo, isSpellKey } from '../../shared/units';
import { DIFFICULTIES, skinById } from '../config/progression';
import { SaveManager } from '../core/SaveManager';
import { bus, Evt } from '../core/events';
import { AudioEngine } from '../audio/AudioEngine';
import { TextureFactory } from '../gfx/TextureFactory';
import { Unit } from '../entities/Unit';
import { Base } from '../entities/Base';
import { EnergySystem } from '../../shared/EnergySystem';
import { BotAI } from '../systems/BotAI';
import { WaveDirector } from '../systems/WaveDirector';
import { applyMatchResult } from '../systems/Progression';

interface FxSet {
  soft: Phaser.GameObjects.Particles.ParticleEmitter;
  spark: Phaser.GameObjects.Particles.ParticleEmitter;
  debris: Phaser.GameObjects.Particles.ParticleEmitter;
}

interface ProjectileVisualSpec {
  team: Team;
  sourceKey: UnitKey | null;
  arc: boolean;
  healing: boolean;
  x: number;
  y: number;
}

/** Duração de partida "sem limite" pra treino/sobrevivência (o motor sempre tem um cronômetro). */
const UNLIMITED_TIME = 1e9;

export class GameScene extends Phaser.Scene {
  config!: OnlineMatchConfig;
  playerEnergy!: EnergySystem;
  playerBase!: Base;
  enemyBase!: Base;
  matchOver = false;

  private units: Unit[] = [];
  private bot: BotAI | null = null;
  private waves: WaveDirector | null = null;
  private network: NetworkController | null = null;
  /** Epoch canônico (do servidor) em que a simulação deve começar — ancora os dois clientes. */
  private onlineStartEpoch: number | null = null;
  private playerColor: number = COLORS.player;

  /** Motor local (versus bot/treino/sobrevivência) — no online, quem roda é o servidor. */
  private localState: SimState | null = null;
  private localRng: Rng | null = null;

  /** Visões (Phaser) mantidas em sincronia com o SimState — local ou snapshot do servidor. */
  private simUnits = new Map<number, Unit>();
  private simProjectiles = new Map<number, Phaser.GameObjects.Image>();

  /* --------------------------- Modo online (renderer) -------------------------
   * O servidor é a autoridade — aqui só guardamos os dois últimos snapshots
   * pra interpolar posição entre ticks. */
  private netPrevSnapshot: MatchSnapshot | null = null;
  private netCurSnapshot: MatchSnapshot | null = null;
  private netCurAt = 0;
  private netTickInterval = 50;
  /** Invocações do próprio jogador ainda não confirmadas pelo servidor (previsão
   * otimista) — feitiços não têm fantasma (ghost = null), só reserva de energia. */
  private pendingDeploys: { key: CardKey; lane: number; ghost: Unit | null; cost: number }[] = [];
  private fxCache = new Map<number, FxSet>();
  private stars!: Phaser.GameObjects.TileSprite;

  private elapsed = 0;
  private lastWholeSecond = -1;
  private energyWasFull = false;
  private trainingSpawner: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super('Game');
  }

  init(data: OnlineMatchConfig): void {
    this.config = { mode: data.mode ?? 'versus', difficulty: data.difficulty ?? 'normal', online: data.online };
    // Reset de estado entre partidas (scenes são reutilizadas pelo Phaser).
    this.units = [];
    this.fxCache = new Map();
    this.matchOver = false;
    this.elapsed = 0;
    this.lastWholeSecond = -1;
    this.energyWasFull = false;
    this.bot = null;
    this.waves = null;
    this.network = data.online?.network ?? null;
    this.onlineStartEpoch = data.online?.startEpochMs ?? null;
    this.trainingSpawner = null;
    this.localState = null;
    this.localRng = null;
    this.simUnits = new Map();
    this.simProjectiles = new Map();
    this.netPrevSnapshot = null;
    this.netCurSnapshot = null;
    this.netCurAt = 0;
    this.netTickInterval = 50;
    this.pendingDeploys = [];
  }

  create(): void {
    this.playerColor = skinById(SaveManager.data.skin).color;
    TextureFactory.ensureTeam(this, this.playerColor);
    TextureFactory.ensureTeam(this, COLORS.enemy);

    /* -------------------------------- Cenário ------------------------------- */
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'arena').setDepth(DEPTH.bg);
    this.stars = this.add
      .tileSprite(GAME_WIDTH / 2, 120, GAME_WIDTH, 240, 'bg-stars')
      .setAlpha(0.6)
      .setDepth(DEPTH.bg);

    /* --------------------------------- Bases -------------------------------- */
    const midX = LANE_XS[1];
    this.playerBase = new Base(this, 'player', midX, PLAYER_BASE_Y, this.playerColor);
    this.enemyBase = new Base(this, 'enemy', midX, ENEMY_BASE_Y, COLORS.enemy);

    /* -------------------------------- Economia ------------------------------- */
    this.playerEnergy = new EnergySystem();

    /* --------------------------------- Modos --------------------------------- */
    if (this.config.mode === 'online') {
      this.wireNetwork();
    } else {
      this.localState = createInitialState();
      this.localRng = new Rng(Date.now() >>> 0);

      if (this.config.mode === 'versus') {
        const params = DIFFICULTIES[this.config.difficulty];
        this.bot = new BotAI(this, params);
        this.localState.energy.enemy.mult = params.regenMult;
      } else if (this.config.mode === 'survival') {
        this.localState.timeLeft = UNLIMITED_TIME;
        this.localState.bases.enemy.invulnerable = true;
        this.localState.energy.player.mult = 1.15;
        this.waves = new WaveDirector(this);
        // Portal giratório marca a origem das ondas.
        const portal = this.add
          .image(midX, ENEMY_BASE_Y - 40, 'portal')
          .setDepth(DEPTH.bases - 1)
          .setAlpha(0.85);
        this.tweens.add({ targets: portal, rotation: Math.PI * 2, duration: 9000, repeat: -1 });
      } else {
        // Treinamento: energia generosa e alvos ocasionais para praticar, sem cronômetro real.
        this.localState.timeLeft = UNLIMITED_TIME;
        this.localState.energy.player.mult = 1.9;
        let trainingLane = 0;
        this.trainingSpawner = this.time.addEvent({
          delay: 13000,
          startAt: 8000,
          loop: true,
          callback: () => {
            this.localDeploy('enemy', 'faisca', trainingLane, true);
            trainingLane = (trainingLane + 1) % LANE_XS.length;
          },
        });
      }
    }

    /* ---------------------------------- HUD ---------------------------------- */
    this.scene.launch('Hud', this.config);

    /* --------------------------------- Áudio --------------------------------- */
    if (AudioEngine.ready) {
      AudioEngine.duck(false);
      AudioEngine.startMusic('battle');
    }
    this.input.once('pointerdown', () => {
      AudioEngine.unlock();
      AudioEngine.startMusic('battle');
    });

    this.cameras.main.fadeIn(350, 5, 7, 15);
    this.time.delayedCall(450, () => {
      const label =
        this.config.mode === 'survival'
          ? 'SOBREVIVA!'
          : this.config.mode === 'training'
            ? 'TREINO LIVRE'
            : 'LUTE!';
      bus.emit(Evt.Announce, label, this.playerColor);
    });
  }

  /** Liga o relay do oponente e os eventos de ciclo de vida da partida online. */
  private wireNetwork(): void {
    const net = this.network;
    if (!net) return;
    net.onTick((snapshot, events) => this.onNetTick(snapshot, events));
    net.onDeployRejected((reason) => this.onDeployRejected(reason));
    net.onOpponentDisconnected(() =>
      bus.emit(Evt.Announce, 'Oponente desconectou — aguardando reconexão...', COLORS.gold)
    );
    net.onOpponentReconnected(() => bus.emit(Evt.Announce, 'Oponente reconectou!', COLORS.success));
    net.onEnded((resolution) => this.finishOnlineMatch(resolution));
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.05);
    this.stars.tilePositionX += delta * 0.006;
    if (this.matchOver) return;

    if (this.config.mode === 'online') {
      this.updateOnlineRender();
      return;
    }

    this.updateLocalSim(dt);
  }

  /* ------------------------------ Motor local --------------------------------
   * Versus bot / treino / sobrevivência: roda shared/sim/engine.ts aqui mesmo,
   * a cada frame, com o dt real — sem rede, sem interpolação (a posição já
   * é exata neste instante). */

  private updateLocalSim(dt: number): void {
    const state = this.localState;
    const rng = this.localRng;
    if (!state || !rng) return;

    this.bot?.update(state, dt);
    this.waves?.update(dt);

    const { events } = step(state, dt, rng, []);
    this.applyLocalEvents(events);

    for (const su of state.units) {
      this.simUnits.get(su.id)?.syncFromSim(su.x, su.y, su.hp, {
        shield: su.shield,
        slow: su.slowT > 0,
        rage: su.rageT > 0,
        stun: su.stunT > 0,
      });
    }
    this.playerBase.syncFromSim(state.bases.player.hp);
    this.enemyBase.syncFromSim(state.bases.enemy.hp);
    this.syncLocalProjectiles(state);

    this.playerEnergy.current = state.energy.player.current;
    this.notifyEnergyFull();
    this.elapsed = state.elapsed;

    if (this.config.mode === 'versus') {
      const whole = Math.max(0, Math.ceil(state.timeLeft));
      if (whole !== this.lastWholeSecond) {
        this.lastWholeSecond = whole;
        bus.emit(Evt.Timer, whole);
      }
    }
  }

  private syncLocalProjectiles(state: SimState): void {
    const seen = new Set<number>();
    for (const sp of state.projectiles) {
      seen.add(sp.id);
      let visual = this.simProjectiles.get(sp.id);
      if (!visual) {
        visual = this.createProjectileVisual(sp);
        this.simProjectiles.set(sp.id, visual);
      }
      visual.setPosition(sp.x, sp.y);
    }
    this.pruneProjectileVisuals(seen);
  }

  private pruneProjectileVisuals(seenIds: Set<number>): void {
    for (const [id, visual] of this.simProjectiles) {
      if (!seenIds.has(id)) {
        visual.destroy();
        this.simProjectiles.delete(id);
      }
    }
  }

  /** Regras compartilhadas de FX/som/spawn/morte a partir dos eventos do motor local. */
  private applyLocalEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'spawn': {
          const color = e.team === 'player' ? this.playerColor : COLORS.enemy;
          const unit = new Unit(this, UNIT_DEFS[e.key], e.team, e.lane, e.x, e.y, color);
          this.units.push(unit);
          this.simUnits.set(e.unitId, unit);
          this.fxRing(e.x, e.y, color, 0.5);
          AudioEngine.play('deploy');
          break;
        }
        case 'death': {
          const unit = this.simUnits.get(e.unitId);
          if (unit) {
            this.simUnits.delete(e.unitId);
            unit.die();
          }
          break;
        }
        case 'spell':
          this.fxSpell(e.key, e.x, e.y);
          break;
        case 'hit':
          this.playHitFx(e.x, e.y, e.team, e.sourceKey);
          break;
        case 'heal-fx':
          this.getFx(COLORS.heal).soft.explode(this.q(5), e.x, e.y);
          break;
        case 'explosion': {
          const color = e.team === 'player' ? this.playerColor : COLORS.enemy;
          this.fxExplosion(e.x, e.y, color, e.big);
          AudioEngine.play('explosion');
          break;
        }
        case 'base-hit': {
          const base = e.team === 'player' ? this.playerBase : this.enemyBase;
          base.jitter();
          this.onBaseHit(base);
          break;
        }
        case 'base-destroyed': {
          const base = e.team === 'player' ? this.playerBase : this.enemyBase;
          base.alive = false;
          this.playBaseDestroyedFx(base);
          this.endMatch(base.team === 'enemy' ? 'win' : 'loss');
          break;
        }
        case 'overdrive':
          bus.emit(Evt.Overdrive);
          bus.emit(Evt.Announce, 'SOBRECARGA! ENERGIA 2X', COLORS.energy);
          AudioEngine.play('overdrive');
          break;
        case 'match-ended':
          this.endMatch(e.winner === 'draw' ? 'draw' : e.winner === 'player' ? 'win' : 'loss');
          break;
      }
    }
  }

  private playHitFx(x: number, y: number, team: Team, sourceKey: UnitKey | null): void {
    const color = sourceKey ? UNIT_DEFS[sourceKey].accent : team === 'player' ? this.playerColor : COLORS.enemy;
    this.fxHit(x, y, color);
    AudioEngine.play(sourceKey && UNIT_DEFS[sourceKey].radius >= 30 ? 'hit-heavy' : 'hit');
  }

  /* ------------------------------ Modo online -------------------------------
   * O servidor É a simulação (shared/sim/engine.ts) — aqui só renderizamos o
   * que ele manda: interpola posição entre os dois últimos snapshots, aplica
   * os eventos discretos (fx/som/spawn/morte) e mantém HUD/energia em sincronia. */

  private onNetTick(snapshot: MatchSnapshot, events: SimEvent[]): void {
    const now = this.time.now;
    if (this.netCurSnapshot) {
      this.netTickInterval = Phaser.Math.Clamp(now - this.netCurAt, 20, 200);
    }
    this.netPrevSnapshot = this.netCurSnapshot;
    this.netCurSnapshot = snapshot;
    this.netCurAt = now;

    this.applyNetEvents(events);
    this.playerBase.syncFromSim(snapshot.baseHp.player);
    this.enemyBase.syncFromSim(snapshot.baseHp.enemy);

    // Enquanto há invocação otimista em voo, confia no valor previsto localmente;
    // sem nada pendente, o snapshot do servidor é sempre a verdade.
    if (this.pendingDeploys.length === 0) {
      this.playerEnergy.current = snapshot.myEnergy;
    }
    this.elapsed = MATCH_DURATION - snapshot.timeLeft;

    const whole = Math.max(0, Math.ceil(snapshot.timeLeft));
    if (whole !== this.lastWholeSecond) {
      this.lastWholeSecond = whole;
      bus.emit(Evt.Timer, whole);
    }
  }

  private applyNetEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'spawn': {
          if (e.team === 'player') {
            const idx = this.pendingDeploys.findIndex(
              (p) => p.key === e.key && p.lane === e.lane && p.ghost !== null
            );
            if (idx !== -1) {
              const [pending] = this.pendingDeploys.splice(idx, 1);
              const ghost = pending.ghost!;
              ghost.setAlpha(1);
              ghost.setPosition(e.x, e.y);
              this.simUnits.set(e.unitId, ghost);
              break;
            }
          }
          const color = e.team === 'player' ? this.playerColor : COLORS.enemy;
          const unit = new Unit(this, UNIT_DEFS[e.key], e.team, e.lane, e.x, e.y, color);
          this.units.push(unit);
          this.simUnits.set(e.unitId, unit);
          this.fxRing(e.x, e.y, color, 0.5);
          AudioEngine.play('deploy');
          break;
        }
        case 'spell': {
          // Confirmação do próprio feitiço em voo (previsão otimista): baixa a reserva.
          if (e.team === 'player') {
            const idx = this.pendingDeploys.findIndex((p) => p.key === e.key);
            if (idx !== -1) this.pendingDeploys.splice(idx, 1);
          }
          this.fxSpell(e.key, e.x, e.y);
          break;
        }
        case 'death': {
          const unit = this.simUnits.get(e.unitId);
          if (unit) {
            this.simUnits.delete(e.unitId);
            unit.die();
          }
          break;
        }
        case 'hit':
          this.playHitFx(e.x, e.y, e.team, e.sourceKey);
          break;
        case 'heal-fx':
          this.getFx(COLORS.heal).soft.explode(this.q(5), e.x, e.y);
          break;
        case 'explosion': {
          const color = e.team === 'player' ? this.playerColor : COLORS.enemy;
          this.fxExplosion(e.x, e.y, color, e.big);
          AudioEngine.play('explosion');
          break;
        }
        case 'base-hit': {
          const base = e.team === 'player' ? this.playerBase : this.enemyBase;
          base.jitter();
          this.onBaseHit(base);
          break;
        }
        case 'base-destroyed': {
          const base = e.team === 'player' ? this.playerBase : this.enemyBase;
          base.alive = false;
          this.playBaseDestroyedFx(base);
          break;
        }
        case 'overdrive':
          bus.emit(Evt.Overdrive);
          bus.emit(Evt.Announce, 'SOBRECARGA! ENERGIA 2X', COLORS.energy);
          AudioEngine.play('overdrive');
          break;
        case 'match-ended':
          break; // tratado via match:ended dedicado (troféus/stats autoritativos)
      }
    }
  }

  private onDeployRejected(reason: string): void {
    const pending = this.pendingDeploys.shift();
    if (pending) {
      this.playerEnergy.current = Math.min(
        this.playerEnergy.max,
        this.playerEnergy.current + pending.cost
      );
      if (pending.ghost) {
        this.units = this.units.filter((u) => u !== pending.ghost);
        pending.ghost.destroy();
      }
    }
    if (reason !== 'match-over') {
      AudioEngine.play('ui-error');
      bus.emit(Evt.Announce, 'Invocação recusada', COLORS.danger);
    }
  }

  /** Roda a cada frame renderizado — interpola entre os dois últimos snapshots recebidos. */
  private updateOnlineRender(): void {
    if (this.onlineStartEpoch !== null && Date.now() < this.onlineStartEpoch) return;
    const cur = this.netCurSnapshot;
    if (!cur) return;
    const prev = this.netPrevSnapshot ?? cur;
    const t = Phaser.Math.Clamp((this.time.now - this.netCurAt) / this.netTickInterval, 0, 1);

    const prevUnits = new Map(prev.units.map((u) => [u.id, u] as const));
    for (const su of cur.units) {
      const unit = this.simUnits.get(su.id);
      if (!unit) continue;
      const pu = prevUnits.get(su.id) ?? su;
      const x = Phaser.Math.Linear(pu.x, su.x, t);
      const y = Phaser.Math.Linear(pu.y, su.y, t);
      const st = su.st ?? 0;
      unit.syncFromSim(x, y, su.hp, {
        shield: su.sh ?? 0,
        slow: (st & STATUS_SLOW) !== 0,
        rage: (st & STATUS_RAGE) !== 0,
        stun: (st & STATUS_STUN) !== 0,
      });
    }

    const prevProj = new Map(prev.projectiles.map((p) => [p.id, p] as const));
    const seen = new Set<number>();
    for (const sp of cur.projectiles) {
      seen.add(sp.id);
      let visual = this.simProjectiles.get(sp.id);
      if (!visual) {
        visual = this.createProjectileVisual(sp);
        this.simProjectiles.set(sp.id, visual);
      }
      const pp = prevProj.get(sp.id) ?? sp;
      visual.setPosition(Phaser.Math.Linear(pp.x, sp.x, t), Phaser.Math.Linear(pp.y, sp.y, t));
    }
    this.pruneProjectileVisuals(seen);
  }

  private createProjectileVisual(sp: ProjectileVisualSpec | SnapshotProjectile): Phaser.GameObjects.Image {
    const texture = sp.healing
      ? 'proj-heal'
      : sp.arc
        ? 'proj-shell'
        : sp.sourceKey === 'gelido'
          ? 'proj-shard'
          : 'proj-bolt';
    const tint = sp.sourceKey
      ? UNIT_DEFS[sp.sourceKey].accent
      : sp.team === 'player'
        ? this.playerColor
        : COLORS.enemy;
    return this.add.image(sp.x, sp.y, texture).setTint(tint).setDepth(DEPTH.projectiles);
  }

  /** Previsão otimista: spawna a unidade na hora, reconciliada quando o servidor confirmar. */
  private playerDeployOnline(key: CardKey, lane: number, x?: number, y?: number): boolean {
    const cost = cardInfo(key).cost;
    if (this.playerEnergy.current < cost) {
      AudioEngine.play('ui-error');
      return false;
    }
    this.playerEnergy.current -= cost;

    if (isSpellKey(key)) {
      // Feitiço: sem fantasma — o FX chega no evento 'spell' do servidor.
      this.pendingDeploys.push({ key, lane, ghost: null, cost });
    } else {
      const def = UNIT_DEFS[key];
      const gx = LANE_XS[lane];
      const gy =
        def.kind === 'building' ? PLAYER_BASE_Y - BUILDING_OFFSET : PLAYER_BASE_Y - SPAWN_OFFSET;
      const ghost = new Unit(this, def, 'player', lane, gx, gy, this.playerColor);
      ghost.setAlpha(0.6);
      this.units.push(ghost);
      this.pendingDeploys.push({ key, lane, ghost, cost });
      this.fxRing(gx, gy, this.playerColor, 0.5);
      AudioEngine.play('deploy');
    }

    this.network?.sendDeploy(key, lane, x, y);
    return true;
  }

  private finishOnlineMatch(resolution: MatchResolution): void {
    if (this.matchOver) return;
    this.matchOver = true;
    AudioEngine.stopMusic();

    const sign = resolution.trophyDelta >= 0 ? '+' : '';
    bus.emit(
      Evt.Announce,
      `Ranqueado: ${sign}${resolution.trophyDelta} troféus`,
      resolution.trophyDelta >= 0 ? COLORS.success : COLORS.danger
    );

    this.celebrateWinners(resolution.outcome);

    const summary = applyMatchResult(this.config, {
      outcome: resolution.outcome,
      durationSec: this.elapsed,
      damageDealt: resolution.stats.damageDealt,
      kills: resolution.stats.kills,
      deploys: resolution.stats.deploys,
    });

    this.time.delayedCall(1500, () => {
      bus.emit(Evt.MatchEnd, summary);
      this.scene.launch('Result', summary);
      this.scene.pause('Hud');
      this.scene.pause();
    });
  }

  private celebrateWinners(outcome: 'win' | 'loss' | 'draw'): void {
    const winners = this.unitsOf(outcome === 'win' ? 'player' : 'enemy');
    for (const u of winners) {
      this.tweens.add({
        targets: u,
        y: u.y - 14,
        duration: 320,
        yoyo: true,
        repeat: 3,
        ease: Phaser.Math.Easing.Quadratic.Out,
      });
    }
  }

  private notifyEnergyFull(): void {
    const full = this.playerEnergy.current >= this.playerEnergy.max - 0.001;
    if (full && !this.energyWasFull) AudioEngine.play('energy-full');
    this.energyWasFull = full;
  }

  /* ------------------------------- API de tropas ----------------------------- */

  unitsOf(team: Team): Unit[] {
    return this.units.filter((u) => u.team === team && u.alive);
  }

  /** Abandono explícito de uma partida online (botão ABANDONAR na pausa). */
  forfeitOnline(): void {
    if (!this.matchOver) this.network?.forfeit();
  }

  /** Invocação pelo jogador (validada). `x`/`y` = alvo de feitiço. @returns sucesso. */
  playerDeploy(key: CardKey, lane: number, x?: number, y?: number): boolean {
    if (this.config.mode === 'online') return this.playerDeployOnline(key, lane, x, y);
    return this.localDeploy('player', key, lane, false, x, y);
  }

  /** Invocação no motor local (bot/ondas/treino também passam por aqui). @returns sucesso. */
  localDeploy(team: Team, key: CardKey, lane: number, free = false, x?: number, y?: number): boolean {
    if (!this.localState || !this.localRng || this.matchOver) return false;
    const events: SimEvent[] = [];
    const result = applyDeployCommand(
      this.localState,
      { team, key, lane, free, x, y },
      this.localRng,
      events
    );
    if (!result.ok) {
      if (team === 'player') AudioEngine.play('ui-error');
      return false;
    }
    this.applyLocalEvents(events);
    if (team === 'player') {
      if (!isSpellKey(key)) this.bot?.notePlayerDeploy(UNIT_DEFS[key].role);
      bus.emit(Evt.UnitDeployed);
    }
    return true;
  }

  onUnitDied(unit: Unit): void {
    this.units = this.units.filter((u) => u !== unit);
    const color = unit.team === 'player' ? this.playerColor : COLORS.enemy;
    const fx = this.getFx(color);
    fx.soft.explode(this.q(7), unit.x, unit.y);
    fx.debris.explode(this.q(5), unit.x, unit.y);
    AudioEngine.play('death');
  }

  /* -------------------------------- Bases/fim -------------------------------- */

  onBaseHit(base: Base): void {
    this.fxHit(base.x + Phaser.Math.Between(-30, 30), base.y - Phaser.Math.Between(20, 80), 0xffffff);
    AudioEngine.play('base-hit');
    this.cameras.main.shake(90, 0.0022);
  }

  /** FX/som/tremor da base destruída — usado tanto localmente quanto pelo evento online. */
  playBaseDestroyedFx(base: Base): void {
    this.fxExplosion(base.x, base.y - 40, base.teamColor, true);
    AudioEngine.play('base-down');
    this.cameras.main.shake(500, 0.012);
    this.tweens.add({ targets: base, alpha: 0.25, duration: 700 });
  }

  private endMatch(outcome: 'win' | 'loss' | 'draw'): void {
    if (this.matchOver) return;
    this.matchOver = true;
    this.trainingSpawner?.remove();
    AudioEngine.stopMusic();

    this.celebrateWinners(outcome);

    const stats = this.localState?.stats.player ?? { damageDealt: 0, kills: 0, deploys: 0 };
    const summary = applyMatchResult(this.config, {
      outcome,
      durationSec: this.elapsed,
      damageDealt: stats.damageDealt,
      kills: stats.kills,
      deploys: stats.deploys,
      wave: this.waves ? Math.max(1, this.waves.wave) : undefined,
    });

    this.time.delayedCall(1500, () => {
      bus.emit(Evt.MatchEnd, summary);
      this.scene.launch('Result', summary);
      this.scene.pause('Hud');
      this.scene.pause();
    });
  }

  /* ---------------------------------- FX ------------------------------------ */

  /** Quantidade de partículas ajustada pela qualidade configurada. */
  private q(n: number): number {
    return SaveManager.settings.particles === 'low' ? Math.max(1, Math.floor(n / 2)) : n;
  }

  private getFx(color: number): FxSet {
    let set = this.fxCache.get(color);
    if (set) return set;
    set = {
      soft: this.add.particles(0, 0, 'p-soft', {
        speed: { min: 30, max: 150 },
        scale: { start: 1.1, end: 0 },
        alpha: { start: 0.9, end: 0 },
        lifespan: { min: 260, max: 620 },
        tint: color,
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      }),
      spark: this.add.particles(0, 0, 'p-spark', {
        speed: { min: 120, max: 280 },
        scale: { start: 0.9, end: 0 },
        rotate: { min: 0, max: 360 },
        lifespan: { min: 180, max: 380 },
        tint: color,
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      }),
      debris: this.add.particles(0, 0, 'p-square', {
        speed: { min: 60, max: 220 },
        angle: { min: 200, max: 340 },
        gravityY: 420,
        scale: { start: 1, end: 0.2 },
        rotate: { min: 0, max: 360 },
        lifespan: { min: 400, max: 800 },
        tint: color,
        emitting: false,
      }),
    };
    set.soft.setDepth(DEPTH.fxHigh);
    set.spark.setDepth(DEPTH.fxHigh);
    set.debris.setDepth(DEPTH.fxLow);
    this.fxCache.set(color, set);
    return set;
  }

  private fxHit(x: number, y: number, color: number): void {
    this.getFx(color).spark.explode(this.q(5), x, y);
  }

  private fxRing(x: number, y: number, color: number, scale = 1): void {
    const ring = this.add
      .image(x, y, 'p-ring')
      .setTint(color)
      .setScale(scale * 0.3)
      .setAlpha(0.9)
      .setDepth(DEPTH.fxHigh)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({
      targets: ring,
      scale: scale * 1.7,
      alpha: 0,
      duration: 380,
      ease: Phaser.Math.Easing.Quadratic.Out,
      onComplete: () => ring.destroy(),
    });
  }

  fxExplosion(x: number, y: number, color: number, big: boolean): void {
    const fx = this.getFx(color);
    fx.soft.explode(this.q(big ? 26 : 12), x, y);
    fx.spark.explode(this.q(big ? 16 : 8), x, y);
    fx.debris.explode(this.q(big ? 18 : 8), x, y);
    this.fxRing(x, y, color, big ? 2.6 : 1.2);
    if (!big) this.cameras.main.shake(70, 0.002);
  }

  /* ------------------------------ FX de feitiços ------------------------------ */

  /** Círculo com o raio REAL do feitiço — comunica a área de efeito com precisão. */
  private fxSpellArea(x: number, y: number, radius: number, color: number): void {
    const area = this.add.graphics().setDepth(DEPTH.fxLow);
    area.fillStyle(color, 0.14);
    area.fillCircle(x, y, radius);
    area.lineStyle(3, color, 0.8);
    area.strokeCircle(x, y, radius);
    this.tweens.add({
      targets: area,
      alpha: 0,
      duration: 520,
      ease: Phaser.Math.Easing.Quadratic.Out,
      onComplete: () => area.destroy(),
    });
  }

  private fxSpell(key: SpellKey, x: number, y: number): void {
    const def = SPELL_DEFS[key];
    this.fxSpellArea(x, y, def.radius, def.accent);

    switch (key) {
      case 'meteoro': {
        // Cometa cai do alto até o ponto e detona.
        const comet = this.add
          .image(x + 180, y - 560, 'spell-meteoro')
          .setDepth(DEPTH.fxHigh)
          .setScale(1.4)
          .setRotation(0.6);
        this.tweens.add({
          targets: comet,
          x,
          y,
          duration: 430,
          ease: Phaser.Math.Easing.Quadratic.In,
          onComplete: () => {
            comet.destroy();
            this.fxExplosion(x, y, def.accent, true);
            AudioEngine.play('explosion');
            this.cameras.main.shake(240, 0.006);
          },
        });
        break;
      }
      case 'pulso': {
        // Descarga instantânea: anel elétrico + faíscas.
        const fx = this.getFx(def.accent);
        fx.spark.explode(this.q(18), x, y);
        fx.soft.explode(this.q(8), x, y);
        this.fxRing(x, y, def.accent, 1.8);
        AudioEngine.play('hit-heavy');
        this.cameras.main.shake(90, 0.003);
        break;
      }
      case 'furia': {
        // Onda de fúria: anel vermelho + partículas subindo na área.
        const fx = this.getFx(def.accent);
        fx.soft.explode(this.q(16), x, y);
        this.fxRing(x, y, def.accent, 2.2);
        const rise = this.add.particles(0, 0, 'p-spark', {
          x: { min: x - def.radius * 0.8, max: x + def.radius * 0.8 },
          y: { min: y - 10, max: y + def.radius * 0.6 },
          speedY: { min: -140, max: -60 },
          scale: { start: 0.8, end: 0 },
          lifespan: { min: 300, max: 620 },
          quantity: 2,
          frequency: 40,
          tint: def.accent,
          blendMode: Phaser.BlendModes.ADD,
        }).setDepth(DEPTH.fxHigh);
        this.time.delayedCall(700, () => {
          rise.stop();
          this.time.delayedCall(700, () => rise.destroy());
        });
        AudioEngine.play('wave');
        break;
      }
    }
  }
}
