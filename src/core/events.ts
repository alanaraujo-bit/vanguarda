/**
 * events.ts — Barramento de eventos global + utilitário de assinatura segura.
 * Scenes se comunicam exclusivamente por aqui (HUD <-> Game <-> Result),
 * o que mantém os sistemas desacoplados e prepara o terreno para
 * substituir a fonte dos eventos por uma camada de rede no futuro.
 */
import Phaser from 'phaser';

/** Nomes canônicos de eventos do jogo. */
export const Evt = {
  /** (current: number, max: number) energia do jogador mudou. */
  EnergyChanged: 'energy-changed',
  /** (team: Team, hp: number, maxHp: number) HP de uma base mudou. */
  BaseHp: 'base-hp',
  /** (secondsLeft: number) tick do cronômetro do versus. */
  Timer: 'timer',
  /** (wave: number) nova onda na sobrevivência. */
  Wave: 'wave',
  /** (text: string, color?: number) anúncio central na tela. */
  Announce: 'announce',
  /** () jogador invocou unidade (para HUD reagir). */
  UnitDeployed: 'unit-deployed',
  /** (summary: MatchSummary) fim de partida. */
  MatchEnd: 'match-end',
  /** () sobrecarga de energia ativada. */
  Overdrive: 'overdrive',
} as const;

export type EvtName = (typeof Evt)[keyof typeof Evt];

/** Emissor global único. */
export const bus = new Phaser.Events.EventEmitter();

/**
 * Assina um evento no bus e remove a assinatura automaticamente
 * quando a scene for desligada — evita listeners duplicados após
 * restart de scenes (bug clássico de Phaser).
 */
export function subscribe(
  scene: Phaser.Scene,
  event: EvtName,
  fn: (...args: never[]) => void,
  context?: object
): void {
  bus.on(event, fn as (...args: unknown[]) => void, context);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    bus.off(event, fn as (...args: unknown[]) => void, context);
  });
}
