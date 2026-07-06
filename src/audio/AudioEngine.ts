/**
 * AudioEngine.ts — Motor de áudio 100% procedural via Web Audio API.
 * Nenhum arquivo de som: todos os efeitos são sintetizados e a música
 * é gerada por um sequenciador com lookahead scheduling.
 *
 * Grafo: [osciladores/ruído] -> sfxGain|musicGain -> masterGain -> destino.
 */
import { SaveManager } from '../core/SaveManager';

export type SfxKey =
  | 'ui-click'
  | 'ui-hover'
  | 'ui-error'
  | 'deploy'
  | 'hit'
  | 'hit-heavy'
  | 'shoot'
  | 'mortar'
  | 'explosion'
  | 'heal'
  | 'death'
  | 'base-hit'
  | 'base-down'
  | 'energy-full'
  | 'overdrive'
  | 'wave'
  | 'victory'
  | 'defeat'
  | 'levelup'
  | 'achievement';

type MusicTrack = 'menu' | 'battle';

/** Escala usada pela música generativa (Lá menor pentatônica + cor). */
const SCALE = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33];

class AudioEngineImpl {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private sfxGain!: GainNode;

  private musicTimer: number | null = null;
  private currentTrack: MusicTrack | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private noiseBuffer: AudioBuffer | null = null;
  private ducked = false;

  /** Cria o contexto (deve ser chamado a partir de um gesto do usuário). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain.connect(this.master);
    this.sfxGain.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.applyVolumes();

    // Buffer de ruído branco reutilizado por vários efeitos.
    const len = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Suspende o contexto e pausa o sequenciador (aba/app em segundo plano). */
  suspend(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  /** Retoma o contexto e, se havia música tocando, o sequenciador. */
  resume(): void {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.currentTrack && this.musicTimer === null) {
      this.nextNoteTime = this.ctx.currentTime + 0.1;
      this.musicTimer = window.setInterval(() => this.scheduleMusic(), 80);
    }
  }

  applyVolumes(): void {
    if (!this.ctx) return;
    const s = SaveManager.settings;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : 1, now, 0.02);
    this.musicGain.gain.setTargetAtTime(
      s.musicVolume * 0.5 * (this.ducked ? 0.35 : 1),
      now,
      0.05
    );
    this.sfxGain.gain.setTargetAtTime(s.sfxVolume * 0.9, now, 0.05);
  }

  /** Abaixa a música temporariamente (pausa / telas de resultado). */
  duck(on: boolean): void {
    this.ducked = on;
    this.applyVolumes();
  }

  /* -------------------------------- Música -------------------------------- */

  startMusic(track: MusicTrack): void {
    if (!this.ctx) return;
    if (this.currentTrack === track) return;
    this.stopMusic();
    this.currentTrack = track;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    // Lookahead scheduler: agenda notas 200ms à frente, checando a cada 80ms.
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 80);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.currentTrack = null;
  }

  private scheduleMusic(): void {
    if (!this.ctx || !this.currentTrack) return;
    const stepDur = this.currentTrack === 'battle' ? 0.17 : 0.24; // ~88 / ~62 BPM (semicolcheias)
    while (this.nextNoteTime < this.ctx.currentTime + 0.25) {
      this.scheduleStep(this.step, this.nextNoteTime, this.currentTrack, stepDur);
      this.nextNoteTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  /** Um passo do sequenciador: baixo, pads, arpejo e percussão sintética. */
  private scheduleStep(step: number, t: number, track: MusicTrack, stepDur: number): void {
    const bar = Math.floor(step / 16) % 4;
    const beat = step % 16;
    // Progressão: Am — F(maj alusão) — C — G, transposta na escala.
    const rootIdx = [0, 3, 1, 4][bar];

    // Baixo: fundamental no tempo forte.
    if (beat === 0 || beat === 8) {
      this.tone(SCALE[rootIdx] / 2, t, stepDur * 7, 'triangle', 0.30, this.musicGain);
    }
    // Pad suave no início do compasso.
    if (beat === 0) {
      this.tone(SCALE[rootIdx], t, stepDur * 14, 'sine', 0.12, this.musicGain);
      this.tone(SCALE[(rootIdx + 2) % SCALE.length], t, stepDur * 14, 'sine', 0.09, this.musicGain);
    }
    // Arpejo: padrão determinístico com variação por compasso.
    const arpPattern = [0, 2, 4, 6, 4, 2, 5, 3];
    if (beat % 2 === 0) {
      const idx = (rootIdx + arpPattern[(beat / 2 + bar) % arpPattern.length]) % SCALE.length;
      const vol = track === 'battle' ? 0.10 : 0.07;
      this.tone(SCALE[idx] * 2, t, stepDur * 1.6, 'square', vol, this.musicGain, 900);
    }
    // Percussão apenas na batalha: kick sintético + hats de ruído.
    if (track === 'battle') {
      if (beat === 0 || beat === 8) this.kick(t);
      if (beat % 4 === 2) this.noiseHit(t, 0.05, 6000, 0.04, this.musicGain);
    }
  }

  /* --------------------------------- SFX ---------------------------------- */

  play(key: SfxKey): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (key) {
      case 'ui-click':
        this.tone(660, t, 0.06, 'square', 0.25, this.sfxGain, 1400);
        this.tone(990, t + 0.04, 0.05, 'square', 0.15, this.sfxGain, 1800);
        break;
      case 'ui-hover':
        this.tone(880, t, 0.03, 'sine', 0.08, this.sfxGain);
        break;
      case 'ui-error':
        this.tone(220, t, 0.12, 'sawtooth', 0.2, this.sfxGain, 700);
        this.tone(180, t + 0.09, 0.14, 'sawtooth', 0.18, this.sfxGain, 600);
        break;
      case 'deploy':
        this.sweep(300, 720, t, 0.16, 'triangle', 0.3);
        this.noiseHit(t, 0.08, 2500, 0.1);
        break;
      case 'shoot':
        this.sweep(900, 380, t, 0.09, 'sawtooth', 0.12, 2200);
        break;
      case 'mortar':
        this.sweep(200, 90, t, 0.25, 'sawtooth', 0.25, 900);
        this.noiseHit(t, 0.1, 1200, 0.15);
        break;
      case 'hit':
        this.noiseHit(t, 0.06, 2000, 0.18);
        this.tone(160, t, 0.05, 'square', 0.12, this.sfxGain, 800);
        break;
      case 'hit-heavy':
        this.noiseHit(t, 0.12, 900, 0.3);
        this.tone(90, t, 0.12, 'square', 0.2, this.sfxGain, 500);
        break;
      case 'explosion':
        this.noiseHit(t, 0.5, 500, 0.5);
        this.sweep(160, 40, t, 0.5, 'sawtooth', 0.3, 400);
        break;
      case 'heal':
        this.tone(780, t, 0.1, 'sine', 0.12, this.sfxGain);
        this.tone(1170, t + 0.07, 0.12, 'sine', 0.1, this.sfxGain);
        break;
      case 'death':
        this.sweep(500, 120, t, 0.22, 'square', 0.14, 1200);
        this.noiseHit(t + 0.02, 0.15, 1500, 0.12);
        break;
      case 'base-hit':
        this.noiseHit(t, 0.2, 700, 0.35);
        this.tone(70, t, 0.2, 'sine', 0.35, this.sfxGain);
        break;
      case 'base-down':
        this.noiseHit(t, 0.9, 400, 0.5);
        this.sweep(220, 30, t, 0.9, 'sawtooth', 0.35, 500);
        break;
      case 'energy-full':
        this.tone(1040, t, 0.08, 'sine', 0.1, this.sfxGain);
        break;
      case 'overdrive':
        this.sweep(220, 880, t, 0.4, 'sawtooth', 0.2, 2600);
        this.tone(880, t + 0.35, 0.25, 'square', 0.15, this.sfxGain, 2000);
        break;
      case 'wave':
        this.tone(330, t, 0.15, 'square', 0.18, this.sfxGain, 1000);
        this.tone(440, t + 0.13, 0.2, 'square', 0.18, this.sfxGain, 1200);
        break;
      case 'victory':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this.tone(f, t + i * 0.14, 0.35, 'triangle', 0.25, this.sfxGain)
        );
        break;
      case 'defeat':
        [392.0, 329.63, 261.63, 196.0].forEach((f, i) =>
          this.tone(f, t + i * 0.18, 0.4, 'triangle', 0.22, this.sfxGain, 900)
        );
        break;
      case 'levelup':
        [440, 554.37, 659.25, 880].forEach((f, i) =>
          this.tone(f, t + i * 0.09, 0.25, 'sine', 0.22, this.sfxGain)
        );
        break;
      case 'achievement':
        this.tone(660, t, 0.12, 'triangle', 0.22, this.sfxGain);
        this.tone(880, t + 0.1, 0.12, 'triangle', 0.22, this.sfxGain);
        this.tone(1320, t + 0.2, 0.2, 'triangle', 0.2, this.sfxGain);
        break;
    }
  }

  /* ------------------------------ Sintetizadores ---------------------------- */

  /** Nota simples com envelope AD e filtro passa-baixa opcional. */
  private tone(
    freq: number,
    time: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    dest: GainNode = this.sfxGain,
    filterFreq?: number
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    if (filterFreq) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      osc.connect(filter).connect(gain).connect(dest);
    } else {
      osc.connect(gain).connect(dest);
    }
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  /** Varredura de frequência (whoosh/laser/queda). */
  private sweep(
    from: number,
    to: number,
    time: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    filterFreq = 3000
  ): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    osc.type = type;
    osc.frequency.setValueAtTime(from, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), time + dur);
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(filter).connect(gain).connect(this.sfxGain);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  /** Rajada de ruído filtrado (impactos/explosões/hats). */
  private noiseHit(
    time: number,
    dur: number,
    filterFreq: number,
    vol: number,
    dest: GainNode = this.sfxGain
  ): void {
    if (!this.ctx || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = filterFreq > 3000 ? 'highpass' : 'lowpass';
    filter.frequency.value = filterFreq;
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(filter).connect(gain).connect(dest);
    src.start(time, Math.random() * 0.4, dur + 0.05);
  }

  /** Bumbo sintético (queda rápida de pitch). */
  private kick(time: number): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.12);
    gain.gain.setValueAtTime(0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);
    osc.connect(gain).connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.2);
  }
}

export const AudioEngine = new AudioEngineImpl();
