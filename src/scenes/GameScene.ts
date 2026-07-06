/**
 * GameScene.ts — O coração do jogo: a batalha em tempo real.
 * Orquestra unidades, bases, projéteis, economia, IA adversária,
 * ondas de sobrevivência, efeitos e o desfecho da partida.
 *
 * A HUD roda como scene paralela e conversa com esta via bus de eventos
 * e chamadas diretas à API pública (playerDeploy, playerEnergy...).
 */
import Phaser from 'phaser';
import type { Targetable, Team, UnitKey } from '../../shared/types';
import { NetworkController, type OnlineMatchConfig } from '../net/NetworkController';
import {
  COLORS,
  DEPTH,
  ENEMY_BASE_Y,
  GAME_HEIGHT,
  GAME_WIDTH,
  LANE_XS,
  MATCH_DURATION,
  MAX_UNITS_PER_TEAM,
  OVERDRIVE_AT,
  PLAYER_BASE_Y,
  SPAWN_OFFSET,
} from '../../shared/constants';
import { UNIT_DEFS } from '../../shared/units';
import { DIFFICULTIES, skinById } from '../config/progression';
import { SaveManager } from '../core/SaveManager';
import { bus, Evt } from '../core/events';
import { WakeLock } from '../core/WakeLock';
import { AudioEngine } from '../audio/AudioEngine';
import { TextureFactory } from '../gfx/TextureFactory';
import { Unit } from '../entities/Unit';
import { Base } from '../entities/Base';
import { Projectile } from '../entities/Projectile';
import { EnergySystem } from '../../shared/EnergySystem';
import { BotAI } from '../systems/BotAI';
import { WaveDirector } from '../systems/WaveDirector';
import { applyMatchResult } from '../systems/Progression';

interface FxSet {
  soft: Phaser.GameObjects.Particles.ParticleEmitter;
  spark: Phaser.GameObjects.Particles.ParticleEmitter;
  debris: Phaser.GameObjects.Particles.ParticleEmitter;
}

export class GameScene extends Phaser.Scene {
  config!: OnlineMatchConfig;
  playerEnergy!: EnergySystem;
  playerBase!: Base;
  enemyBase!: Base;
  matchOver = false;

  private units: Unit[] = [];
  private projectiles: Projectile[] = [];
  private bot: BotAI | null = null;
  private waves: WaveDirector | null = null;
  private network: NetworkController | null = null;
  /** Epoch canônico (do servidor) em que a simulação deve começar — ancora os dois clientes. */
  private onlineStartEpoch: number | null = null;
  private playerColor: number = COLORS.player;
  private fxCache = new Map<number, FxSet>();
  private stars!: Phaser.GameObjects.TileSprite;

  private elapsed = 0;
  private timeLeft = MATCH_DURATION;
  private lastWholeSecond = -1;
  private overdriveOn = false;
  private energyWasFull = false;
  private trainingSpawner: Phaser.Time.TimerEvent | null = null;

  /** Estatísticas do jogador nesta partida. */
  private stats = { damageDealt: 0, kills: 0, deploys: 0 };

  constructor() {
    super('Game');
  }

  init(data: OnlineMatchConfig): void {
    this.config = { mode: data.mode ?? 'versus', difficulty: data.difficulty ?? 'normal', online: data.online };
    // Reset de estado entre partidas (scenes são reutilizadas pelo Phaser).
    this.units = [];
    this.projectiles = [];
    this.fxCache = new Map();
    this.matchOver = false;
    this.elapsed = 0;
    this.timeLeft = MATCH_DURATION;
    this.lastWholeSecond = -1;
    this.overdriveOn = false;
    this.energyWasFull = false;
    this.bot = null;
    this.waves = null;
    this.network = data.online?.network ?? null;
    this.onlineStartEpoch = data.online?.startEpochMs ?? null;
    this.trainingSpawner = null;
    this.stats = { damageDealt: 0, kills: 0, deploys: 0 };
  }

  create(): void {
    // A tela não pode apagar sozinha durante a partida (treino, versus ou
    // sobrevivência) — só volta a poder dormir quando o jogador sai pro menu.
    WakeLock.enable();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => WakeLock.disable());

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
    if (this.config.mode === 'versus') {
      this.bot = new BotAI(this, DIFFICULTIES[this.config.difficulty]);
    } else if (this.config.mode === 'online') {
      this.wireNetwork();
    } else if (this.config.mode === 'survival') {
      this.enemyBase.invulnerable = true;
      this.playerEnergy.mult = 1.15;
      this.waves = new WaveDirector(this);
      // Portal giratório marca a origem das ondas.
      const portal = this.add
        .image(midX, ENEMY_BASE_Y - 40, 'portal')
        .setDepth(DEPTH.bases - 1)
        .setAlpha(0.85);
      this.tweens.add({ targets: portal, rotation: Math.PI * 2, duration: 9000, repeat: -1 });
    } else {
      // Treinamento: energia generosa e alvos ocasionais para praticar.
      this.playerEnergy.mult = 1.9;
      let trainingLane = 0;
      this.trainingSpawner = this.time.addEvent({
        delay: 13000,
        startAt: 8000,
        loop: true,
        callback: () => {
          this.deployUnit('enemy', 'faisca', trainingLane, true);
          trainingLane = (trainingLane + 1) % LANE_XS.length;
        },
      });
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
    net.onDeployRelay((key, lane) => this.deployUnit('enemy', key, lane, true));
    net.onOpponentDisconnected(() =>
      bus.emit(Evt.Announce, 'Oponente desconectou — aguardando reconexão...', COLORS.gold)
    );
    net.onOpponentReconnected(() => bus.emit(Evt.Announce, 'Oponente reconectou!', COLORS.success));
    net.onResolved((resolution) => {
      if (resolution.outcome === 'voided') {
        bus.emit(Evt.Announce, 'Partida anulada (divergência de resultado)', COLORS.gold);
        return;
      }
      const sign = resolution.trophyDelta >= 0 ? '+' : '';
      bus.emit(
        Evt.Announce,
        `Ranqueado: ${sign}${resolution.trophyDelta} troféus`,
        resolution.trophyDelta >= 0 ? COLORS.success : COLORS.danger
      );
    });
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.05);
    this.stars.tilePositionX += delta * 0.006;
    if (this.matchOver) return;
    // Ancora o início da simulação no epoch do servidor — os dois lados começam no mesmo instante.
    if (this.config.mode === 'online' && this.onlineStartEpoch !== null && Date.now() < this.onlineStartEpoch) {
      return;
    }

    this.elapsed += dt;
    this.playerEnergy.update(dt);
    this.notifyEnergyFull();
    this.bot?.update(dt);
    this.waves?.update(dt);
    this.updateVersusClock(dt);

    for (const u of this.units) u.update(dt);
    this.playerBase.update(dt);
    this.enemyBase.update(dt);

    for (const p of this.projectiles) p.update(dt);
    if (this.projectiles.some((p) => p.done)) {
      this.projectiles = this.projectiles.filter((p) => !p.done);
    }
  }

  /* ------------------------------ Relógio/versus ----------------------------- */

  private updateVersusClock(dt: number): void {
    if (this.config.mode !== 'versus' && this.config.mode !== 'online') return;
    if (this.config.mode === 'online' && this.onlineStartEpoch !== null) {
      // Deriva do epoch do servidor em vez de acumular dt local — evita deriva entre os dois clientes.
      this.timeLeft = MATCH_DURATION - (Date.now() - this.onlineStartEpoch) / 1000;
    } else {
      this.timeLeft -= dt;
    }
    const whole = Math.max(0, Math.ceil(this.timeLeft));
    if (whole !== this.lastWholeSecond) {
      this.lastWholeSecond = whole;
      bus.emit(Evt.Timer, whole);
    }
    if (!this.overdriveOn && this.timeLeft <= OVERDRIVE_AT) {
      this.overdriveOn = true;
      this.playerEnergy.mult *= 2;
      this.bot?.setOverdrive();
      bus.emit(Evt.Overdrive);
      bus.emit(Evt.Announce, 'SOBRECARGA! ENERGIA 2X', COLORS.energy);
      AudioEngine.play('overdrive');
    }
    if (this.timeLeft <= 0) {
      const pPct = this.playerBase.hp / this.playerBase.maxHp;
      const ePct = this.enemyBase.hp / this.enemyBase.maxHp;
      this.endMatch(pPct > ePct ? 'win' : pPct < ePct ? 'loss' : 'draw');
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

  /** Invocação pelo jogador (validada). @returns sucesso. */
  playerDeploy(key: UnitKey, lane: number): boolean {
    const ok = this.deployUnit('player', key, lane);
    if (ok) this.network?.sendDeploy(key, lane);
    return ok;
  }

  deployUnit(team: Team, key: UnitKey, lane: number, free = false): boolean {
    if (this.matchOver) return false;
    const def = UNIT_DEFS[key];
    if (this.unitsOf(team).length >= MAX_UNITS_PER_TEAM) {
      if (team === 'player') AudioEngine.play('ui-error');
      return false;
    }
    if (!free) {
      const energy = team === 'player' ? this.playerEnergy : this.bot?.energy;
      if (!energy || !energy.trySpend(def.cost)) {
        if (team === 'player') AudioEngine.play('ui-error');
        return false;
      }
    }

    const color = team === 'player' ? this.playerColor : COLORS.enemy;
    const baseY = team === 'player' ? PLAYER_BASE_Y - SPAWN_OFFSET : ENEMY_BASE_Y + SPAWN_OFFSET;
    const count = def.count ?? 1;
    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 90, () => {
        if (this.matchOver) return;
        const x = LANE_XS[lane] + Phaser.Math.Between(-14, 14);
        const y = baseY + Phaser.Math.Between(-22, 22);
        const unit = new Unit(this, def, team, lane, x, y, color);
        this.units.push(unit);
        this.fxRing(x, y, color, 0.5);
      });
    }
    AudioEngine.play('deploy');

    if (team === 'player') {
      this.stats.deploys++;
      this.bot?.notePlayerDeploy(def.role);
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

  /* -------------------------------- Alvos/IA -------------------------------- */

  /** Inimigo mais próximo na mesma faixa (ou a base inimiga ao alcance). */
  acquireTarget(unit: Unit): Targetable | null {
    const foes = this.unitsOf(unit.team === 'player' ? 'enemy' : 'player');
    let best: Targetable | null = null;
    let bestGap = Infinity;
    for (const f of foes) {
      if (f.lane !== unit.lane) continue;
      const gap =
        Phaser.Math.Distance.Between(unit.x, unit.y, f.x, f.y) - f.radius - unit.radius;
      if (gap < bestGap) {
        bestGap = gap;
        best = f;
      }
    }
    if (best && bestGap <= unit.def.aggroRange) return best;

    const base = unit.team === 'player' ? this.enemyBase : this.playerBase;
    if (base.alive) {
      const gap =
        Phaser.Math.Distance.Between(unit.x, unit.y, base.x, base.y) - base.radius - unit.radius;
      if (gap <= unit.def.aggroRange) return base;
    }
    return null;
  }

  /** Aliado mais ferido ao alcance do curandeiro (qualquer faixa próxima). */
  acquireHealTarget(healer: Unit): Unit | null {
    let best: Unit | null = null;
    let worstPct = 0.999;
    for (const u of this.unitsOf(healer.team)) {
      if (u === healer) continue;
      const pct = u.hp / u.maxHp;
      if (pct >= worstPct) continue;
      const gap =
        Phaser.Math.Distance.Between(healer.x, healer.y, u.x, u.y) - u.radius - healer.radius;
      if (gap <= healer.def.range) {
        worstPct = pct;
        best = u;
      }
    }
    return best;
  }

  nearestEnemyUnit(team: Team, x: number, y: number, range: number): Unit | null {
    const foes = this.unitsOf(team === 'player' ? 'enemy' : 'player');
    let best: Unit | null = null;
    let bestDist = range;
    for (const f of foes) {
      const d = Phaser.Math.Distance.Between(x, y, f.x, f.y) - f.radius;
      if (d < bestDist) {
        bestDist = d;
        best = f;
      }
    }
    return best;
  }

  /* --------------------------------- Combate -------------------------------- */

  /** Aplica dano creditando estatísticas ao time atacante. */
  dealDamage(team: Team, target: Targetable, amount: number): void {
    if (!target.alive) return;
    const before = target.hp;
    target.takeDamage(amount);
    if (team === 'player') {
      this.stats.damageDealt += Math.min(amount, before);
      if (!target.alive && target instanceof Unit) this.stats.kills++;
    }
  }

  /** Golpe direto + dano em área opcional (corpo a corpo). */
  applyHit(attacker: Unit, target: Targetable, damage: number, splashRadius?: number): void {
    if (this.matchOver) return;
    this.dealDamage(attacker.team, target, damage);
    this.fxHit(target.x, target.y - 10, attacker.def.accent);
    AudioEngine.play(attacker.def.radius >= 30 ? 'hit-heavy' : 'hit');
    if (splashRadius) {
      this.splashAround(attacker.team, target.x, target.y, splashRadius, damage * 0.6, target);
    }
  }

  private splashAround(
    team: Team,
    x: number,
    y: number,
    radius: number,
    damage: number,
    exclude: Targetable | null
  ): void {
    const foes = this.unitsOf(team === 'player' ? 'enemy' : 'player');
    for (const f of foes) {
      if (f === exclude) continue;
      if (Phaser.Math.Distance.Between(x, y, f.x, f.y) <= radius + f.radius) {
        this.dealDamage(team, f, damage);
      }
    }
    const base = team === 'player' ? this.enemyBase : this.playerBase;
    if (base !== exclude && base.alive) {
      if (Phaser.Math.Distance.Between(x, y, base.x, base.y) <= radius + base.radius) {
        this.dealDamage(team, base, damage);
      }
    }
  }

  /** Disparo de unidade: dardo reto, granada em arco ou pulso de cura. */
  fireProjectile(shooter: Unit, target: Targetable, healing: boolean): void {
    if (this.matchOver) return;
    const def = shooter.def;
    const team = shooter.team;
    const arc = def.arcingProjectile ?? false;
    const texture = healing ? 'proj-heal' : arc ? 'proj-shell' : 'proj-bolt';
    AudioEngine.play(healing ? 'heal' : arc ? 'mortar' : 'shoot');

    const proj = new Projectile(this, {
      x: shooter.x + shooter.dir * (shooter.radius + 4),
      y: shooter.y - shooter.radius * 0.6,
      texture,
      tint: def.accent,
      target,
      speed: def.projectileSpeed ?? 500,
      arc,
      onHit: (hx, hy) => {
        if (this.matchOver) return;
        if (healing) {
          if (target.alive && target instanceof Unit) target.heal(def.damage);
          this.getFx(COLORS.heal).soft.explode(this.q(5), hx, hy);
          return;
        }
        if (arc && def.splashRadius) {
          AudioEngine.play('explosion');
          this.fxExplosion(hx, hy, def.accent, false);
          this.splashAround(team, hx, hy, def.splashRadius, def.damage, null);
          return;
        }
        if (target.alive) this.dealDamage(team, target, def.damage);
        this.fxHit(hx, hy, def.accent);
      },
    });
    this.projectiles.push(proj);
  }

  /** Tiro da torreta defensiva das bases. */
  fireTurretBolt(base: Base, target: Unit, damage: number): void {
    if (this.matchOver) return;
    const proj = new Projectile(this, {
      x: base.x,
      y: base.y - 92,
      texture: 'proj-bolt',
      tint: base.teamColor,
      target,
      speed: 680,
      onHit: (hx, hy) => {
        if (this.matchOver) return;
        if (target.alive) this.dealDamage(base.team, target, damage);
        this.fxHit(hx, hy, base.teamColor);
      },
    });
    this.projectiles.push(proj);
    AudioEngine.play('shoot');
  }

  /* -------------------------------- Bases/fim -------------------------------- */

  onBaseHit(base: Base): void {
    this.fxHit(base.x + Phaser.Math.Between(-30, 30), base.y - Phaser.Math.Between(20, 80), 0xffffff);
    AudioEngine.play('base-hit');
    this.cameras.main.shake(90, 0.0022);
  }

  onBaseDestroyed(base: Base): void {
    this.fxExplosion(base.x, base.y - 40, base.teamColor, true);
    AudioEngine.play('base-down');
    this.cameras.main.shake(500, 0.012);
    this.tweens.add({ targets: base, alpha: 0.25, duration: 700 });
    this.endMatch(base.team === 'enemy' ? 'win' : 'loss');
  }

  private endMatch(outcome: 'win' | 'loss' | 'draw'): void {
    if (this.matchOver) return;
    this.matchOver = true;
    this.trainingSpawner?.remove();
    AudioEngine.stopMusic();

    if (this.network) {
      this.network.sendReport({
        outcome,
        myBaseHpPct: this.playerBase.hp / this.playerBase.maxHp,
        theirBaseHpPctObserved: this.enemyBase.hp / this.enemyBase.maxHp,
      });
    }

    // Comemoração dos vencedores.
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

    const summary = applyMatchResult(this.config, {
      outcome,
      durationSec: this.elapsed,
      damageDealt: this.stats.damageDealt,
      kills: this.stats.kills,
      deploys: this.stats.deploys,
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
}
