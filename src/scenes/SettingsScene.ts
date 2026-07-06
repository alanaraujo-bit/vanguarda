/**
 * SettingsScene.ts — Overlay de configurações.
 * Reutilizado tanto no Menu quanto na pausa da batalha.
 * Persiste tudo imediatamente via SaveManager e aplica no AudioEngine.
 */
import Phaser from 'phaser';
import { COLORS, CSS, GAME_HEIGHT, GAME_WIDTH } from '../config/constants';
import { AudioEngine } from '../audio/AudioEngine';
import { SaveManager } from '../core/SaveManager';
import { UiButton, UiSlider, UiToggle, drawPanel, makeText } from '../ui/widgets';

interface SettingsData {
  from: 'Menu' | 'Hud';
}

export class SettingsScene extends Phaser.Scene {
  private from: 'Menu' | 'Hud' = 'Menu';
  /** Alterações que exigem recarregar a tela de origem (nome/reset). */
  private profileDirty = false;
  private confirmingReset = false;

  constructor() {
    super('Settings');
  }

  init(data: SettingsData): void {
    this.from = data.from ?? 'Menu';
    this.profileDirty = false;
    this.confirmingReset = false;
  }

  create(): void {
    const s = SaveManager.settings;

    this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7)
      .setInteractive();

    const panelW = 560;
    const panelH = 560;
    const px = GAME_WIDTH / 2 - panelW / 2;
    const py = GAME_HEIGHT / 2 - panelH / 2;
    const g = this.add.graphics();
    drawPanel(g, px, py, panelW, panelH, { radius: 24 });

    makeText(this, GAME_WIDTH / 2, py + 44, 'CONFIGURAÇÕES', 32)
      .setOrigin(0.5)
      .setLetterSpacing(6);

    let y = py + 110;
    const labelX = px + 44;
    const controlX = px + panelW - 160;

    /* --------------------------------- Volumes -------------------------------- */
    makeText(this, labelX, y - 10, 'Música', 20);
    new UiSlider(this, controlX, y, 200, s.musicVolume, (v) => {
      SaveManager.setSetting('musicVolume', v);
      AudioEngine.applyVolumes();
    });
    y += 64;
    makeText(this, labelX, y - 10, 'Efeitos sonoros', 20);
    new UiSlider(this, controlX, y, 200, s.sfxVolume, (v) => {
      SaveManager.setSetting('sfxVolume', v);
      AudioEngine.applyVolumes();
      AudioEngine.play('ui-hover');
    });
    y += 64;
    makeText(this, labelX, y - 10, 'Silenciar tudo', 20);
    new UiToggle(this, controlX + 70, y, s.muted, (v) => {
      SaveManager.setSetting('muted', v);
      AudioEngine.applyVolumes();
    });
    y += 64;

    /* --------------------------------- Vídeo ---------------------------------- */
    makeText(this, labelX, y - 10, 'Partículas em alta', 20);
    new UiToggle(this, controlX + 70, y, s.particles === 'high', (v) => {
      SaveManager.setSetting('particles', v ? 'high' : 'low');
    });
    y += 64;
    makeText(this, labelX, y - 10, 'Mostrar FPS', 20);
    new UiToggle(this, controlX + 70, y, s.showFps, (v) => {
      SaveManager.setSetting('showFps', v);
    });
    y += 72;

    /* --------------------------------- Perfil --------------------------------- */
    new UiButton(this, GAME_WIDTH / 2 - 125, y, 'ALTERAR NOME', {
      width: 230,
      height: 48,
      fontSize: 17,
      variant: 'ghost',
      onClick: () => this.changeName(),
    });
    const resetBtn = new UiButton(this, GAME_WIDTH / 2 + 125, y, 'APAGAR PROGRESSO', {
      width: 230,
      height: 48,
      fontSize: 17,
      variant: 'danger',
      onClick: () => {
        if (!this.confirmingReset) {
          this.confirmingReset = true;
          resetBtn.setText('TEM CERTEZA?');
          return;
        }
        SaveManager.reset();
        AudioEngine.applyVolumes();
        this.profileDirty = true;
        resetBtn.setText('APAGADO!').setEnabled(false);
      },
    });

    new UiButton(this, GAME_WIDTH / 2, py + panelH - 52, 'FECHAR', {
      width: 300,
      onClick: () => this.close(),
    });

    this.input.keyboard?.on('keydown-ESC', () => this.close());

    makeText(
      this,
      GAME_WIDTH / 2,
      py + panelH + 26,
      'As configurações são salvas automaticamente.',
      14,
      CSS.textDim
    ).setOrigin(0.5);
    // Reforço visual de que é um overlay.
    g.lineStyle(2, COLORS.player, 0.25);
    g.strokeRoundedRect(px - 6, py - 6, panelW + 12, panelH + 12, 28);
  }

  private changeName(): void {
    const current = SaveManager.data.name;
    const name = window.prompt('Nome do comandante (máx. 16 caracteres):', current);
    if (name && name.trim() && name.trim() !== current) {
      SaveManager.setName(name);
      this.profileDirty = true;
    }
  }

  private close(): void {
    const dirty = this.profileDirty;
    const from = this.from;
    this.scene.stop();
    // Recarrega o Menu se nome/perfil mudou (o chip do jogador é estático).
    if (dirty && from === 'Menu') {
      this.scene.stop('Menu');
      this.scene.start('Menu');
    }
  }
}
