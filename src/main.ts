/**
 * main.ts — Ponto de entrada.
 * Configura o Phaser (escala responsiva, 60 FPS) e registra as scenes.
 */
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config/constants';
import { AudioEngine } from './audio/AudioEngine';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { HUDScene } from './scenes/HUDScene';
import { ResultScene } from './scenes/ResultScene';
import { SettingsScene } from './scenes/SettingsScene';
import { ProfileScene } from './scenes/ProfileScene';
import { CodexScene } from './scenes/CodexScene';
import './core/InstallPrompt';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#05070f',
  // FIT renderiza sempre no buffer lógico 1280x720 e deixa o navegador
  // escalar via CSS até o tamanho físico da tela — o custo de fill-rate da
  // GPU não cresce com a densidade de pixels do aparelho (DPR do celular).
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  render: {
    antialias: true,
    powerPreference: 'high-performance',
  },
  fps: {
    target: 60,
    smoothStep: true,
  },
  input: {
    activePointers: 3, // multi-touch em celulares
  },
  disableContextMenu: true,
  scene: [
    BootScene,
    MenuScene,
    GameScene,
    HUDScene,
    ResultScene,
    SettingsScene,
    ProfileScene,
    CodexScene,
  ],
});

// Poupa bateria/CPU e evita glitches de áudio quando a tela do celular
// bloqueia ou o app/aba vai para segundo plano (o loop de render do Phaser
// já pausa sozinho nesse caso; aqui fechamos a lacuna do áudio).
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    AudioEngine.suspend();
  } else {
    AudioEngine.resume();
  }
});

// Handle de depuração/testes automatizados (inofensivo em produção).
declare global {
  interface Window {
    __VANGUARDA__?: Phaser.Game;
  }
}
window.__VANGUARDA__ = game;
