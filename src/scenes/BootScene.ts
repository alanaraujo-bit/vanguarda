/**
 * BootScene.ts — Inicialização.
 * Gera todas as texturas procedurais (não há assets para baixar),
 * remove o loader HTML e entrega o controle ao Menu.
 */
import Phaser from 'phaser';
import { TextureFactory } from '../gfx/TextureFactory';
import { COLORS } from '../config/constants';
import { SaveManager } from '../core/SaveManager';
import { skinById } from '../config/progression';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    TextureFactory.createShared(this);
    // Time inimigo (fixo) + cor da skin atual do jogador.
    TextureFactory.ensureTeam(this, COLORS.enemy);
    TextureFactory.ensureTeam(this, skinById(SaveManager.data.skin).color);

    // Descarta o loader HTML com fade.
    const loader = document.getElementById('boot-loader');
    if (loader) {
      loader.classList.add('hidden');
      setTimeout(() => loader.remove(), 600);
    }

    this.scene.start('Menu');
  }
}
