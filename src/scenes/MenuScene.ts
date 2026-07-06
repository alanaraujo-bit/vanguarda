/**
 * MenuScene.ts — Tela inicial.
 * Fundo vivo (estrelas em parallax, desfile de unidades), identidade do
 * jogador, seleção de modos e acesso a perfil/configurações.
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONT, GAME_HEIGHT, GAME_WIDTH, hex } from '../config/constants';
import { AudioEngine } from '../audio/AudioEngine';
import { SaveManager } from '../core/SaveManager';
import { InstallPrompt } from '../core/InstallPrompt';
import { levelFromXp, skinById, titleById, xpIntoLevel, DIFFICULTIES } from '../config/progression';
import { TextureFactory } from '../gfx/TextureFactory';
import { UNIT_ORDER } from '../config/units';
import { UiButton, drawPanel, makeText } from '../ui/widgets';
import type { Difficulty, GameMode, UnitKey } from '../core/types';

const IOS_INSTALL_HINT_KEY = 'vanguarda-ios-install-hint-seen';

export class MenuScene extends Phaser.Scene {
  private stars!: Phaser.GameObjects.TileSprite;
  private modePanel!: Phaser.GameObjects.Container;
  private paradeTimer!: Phaser.Time.TimerEvent;
  private installBtn: UiButton | null = null;

  constructor() {
    super('Menu');
  }

  create(): void {
    const playerColor = skinById(SaveManager.data.skin).color;
    TextureFactory.ensureTeam(this, playerColor);

    /* -------------------------------- Fundo -------------------------------- */
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'arena').setAlpha(0.55);
    this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bgDeep, 0.5)
      .setOrigin(0.5);
    this.stars = this.add.tileSprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 'bg-stars');
    this.stars.setAlpha(0.8);

    // Poeira luminosa flutuando.
    this.add.particles(0, 0, 'p-soft', {
      x: { min: 0, max: GAME_WIDTH },
      y: { min: 0, max: GAME_HEIGHT },
      lifespan: 9000,
      speedY: { min: -14, max: -4 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.25, end: 0 },
      quantity: 1,
      frequency: 420,
      tint: [COLORS.player, COLORS.energy, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
    });

    /* -------------------------------- Título -------------------------------- */
    const titleGlow = this.add
      .image(GAME_WIDTH / 2, 168, 'p-soft')
      .setScale(34, 12)
      .setTint(COLORS.player)
      .setAlpha(0.3)
      .setBlendMode(Phaser.BlendModes.ADD);
    const title = this.add
      .text(GAME_WIDTH / 2, 158, 'VANGUARDA', {
        fontFamily: FONT,
        fontSize: '96px',
        fontStyle: 'bold',
        color: CSS.text,
      })
      .setOrigin(0.5)
      .setLetterSpacing(14)
      .setShadow(0, 0, hex(COLORS.player), 24, false, true);
    this.add
      .text(GAME_WIDTH / 2, 228, 'GUERRA PELO NÚCLEO', {
        fontFamily: FONT,
        fontSize: '22px',
        fontStyle: 'bold',
        color: CSS.gold,
      })
      .setOrigin(0.5)
      .setLetterSpacing(10);
    this.tweens.add({
      targets: [titleGlow],
      alpha: 0.45,
      scaleX: 36,
      duration: 1800,
      yoyo: true,
      repeat: -1,
      ease: Phaser.Math.Easing.Sine.InOut,
    });
    this.tweens.add({
      targets: title,
      y: 152,
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: Phaser.Math.Easing.Sine.InOut,
    });

    /* ------------------------------- Botões --------------------------------- */
    new UiButton(this, GAME_WIDTH / 2, 348, 'JOGAR', {
      width: 360,
      height: 68,
      fontSize: 26,
      onClick: () => this.showModes(true),
    });
    new UiButton(this, GAME_WIDTH / 2, 428, 'PERFIL', {
      width: 360,
      height: 56,
      variant: 'ghost',
      onClick: () => this.scene.start('Profile'),
    });
    new UiButton(this, GAME_WIDTH / 2, 500, 'CONFIGURAÇÕES', {
      width: 360,
      height: 56,
      variant: 'ghost',
      onClick: () => this.scene.launch('Settings', { from: 'Menu' }),
    });
    new UiButton(this, GAME_WIDTH / 2, 572, 'ENCICLOPÉDIA', {
      width: 360,
      height: 56,
      variant: 'ghost',
      onClick: () => this.scene.start('Codex'),
    });

    /* --------------------------- Identidade do jogador ----------------------- */
    this.buildPlayerChip();
    this.buildInstallAffordance();

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 18, 'v1.0  •  arquitetura pronta para multiplayer', {
        fontFamily: FONT,
        fontSize: '14px',
        color: CSS.textDim,
      })
      .setOrigin(0.5);

    /* ------------------------------ Desfile --------------------------------- */
    this.paradeTimer = this.time.addEvent({
      delay: 2600,
      loop: true,
      callback: () => this.spawnParadeUnit(playerColor),
    });

    /* ------------------------------ Painel de modos -------------------------- */
    this.modePanel = this.buildModePanel();
    this.modePanel.setVisible(false);

    /* -------------------------------- Áudio ---------------------------------- */
    if (AudioEngine.ready) {
      AudioEngine.duck(false);
      AudioEngine.startMusic('menu');
    }
    this.input.on('pointerdown', () => {
      AudioEngine.unlock();
      AudioEngine.startMusic('menu');
    });

    this.input.keyboard?.on('keydown-ENTER', () => this.showModes(true));
    this.cameras.main.fadeIn(400, 5, 7, 15);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.paradeTimer.remove();
    });
  }

  update(_time: number, delta: number): void {
    this.stars.tilePositionX += delta * 0.004;
    this.stars.tilePositionY += delta * 0.0015;
  }

  private buildPlayerChip(): void {
    const p = SaveManager.data;
    const level = levelFromXp(p.xp);
    const { into, needed } = xpIntoLevel(p.xp);

    const g = this.add.graphics();
    drawPanel(g, 18, 16, 300, 86, { radius: 14 });
    // Medalhão de nível.
    g.fillStyle(COLORS.player, 0.15);
    g.fillCircle(62, 59, 30);
    g.lineStyle(2, COLORS.player, 0.9);
    g.strokeCircle(62, 59, 30);
    makeText(this, 62, 59, String(level), 26).setOrigin(0.5);
    makeText(this, 104, 34, p.name, 20);
    makeText(this, 104, 60, titleById(p.title).name, 14, CSS.gold);
    // Mini barra de XP.
    g.fillStyle(0x0a0f22, 1);
    g.fillRoundedRect(104, 82, 196, 8, 4);
    g.fillStyle(COLORS.player, 1);
    g.fillRoundedRect(104, 82, Math.max(6, 196 * (into / needed)), 8, 4);
  }

  /* ------------------------------ Instalação -------------------------------- */

  private buildInstallAffordance(): void {
    if (InstallPrompt.isStandalone()) return; // já instalado, nada a mostrar

    if (InstallPrompt.canInstall()) {
      this.showInstallButton();
    } else if (!InstallPrompt.isIos()) {
      const onAvailable = () => this.showInstallButton();
      window.addEventListener('vanguarda-install-available', onAvailable);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        window.removeEventListener('vanguarda-install-available', onAvailable);
      });
    }

    if (InstallPrompt.isIos() && !localStorage.getItem(IOS_INSTALL_HINT_KEY)) {
      this.showIosInstallHint();
    }
  }

  private showInstallButton(): void {
    if (this.installBtn) return;
    this.installBtn = new UiButton(this, GAME_WIDTH / 2, 632, 'INSTALAR APP', {
      width: 300,
      height: 42,
      fontSize: 15,
      variant: 'ghost',
      onClick: () => {
        void InstallPrompt.promptInstall().then((accepted) => {
          if (accepted) {
            this.installBtn?.destroy();
            this.installBtn = null;
          }
        });
      },
    });
  }

  private showIosInstallHint(): void {
    const hint = makeText(
      this,
      GAME_WIDTH / 2,
      632,
      'Toque em Compartilhar e depois em "Adicionar à Tela de Início" para instalar',
      15,
      CSS.textDim,
      'normal'
    )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    hint.on('pointerup', () => {
      localStorage.setItem(IOS_INSTALL_HINT_KEY, '1');
      hint.destroy();
    });
  }

  private spawnParadeUnit(playerColor: number): void {
    const key = Phaser.Utils.Array.GetRandom(UNIT_ORDER) as UnitKey;
    const fromLeft = Math.random() < 0.6;
    const color = fromLeft ? playerColor : COLORS.enemy;
    const img = this.add
      .image(fromLeft ? -50 : GAME_WIDTH + 50, Phaser.Math.Between(652, 682), TextureFactory.unitTexture(key, color))
      .setDepth(2)
      .setAlpha(0.9);
    if (!fromLeft) img.setFlipX(true);
    const dur = Phaser.Math.Between(9000, 14000);
    this.tweens.add({
      targets: img,
      x: fromLeft ? GAME_WIDTH + 50 : -50,
      duration: dur,
      onComplete: () => img.destroy(),
    });
    this.tweens.add({
      targets: img,
      y: '-=5',
      duration: 260,
      yoyo: true,
      repeat: Math.floor(dur / 520),
      ease: Phaser.Math.Easing.Sine.InOut,
    });
  }

  /* ------------------------------ Painel de modos ---------------------------- */

  private showModes(on: boolean): void {
    this.modePanel.setVisible(true);
    this.tweens.add({
      targets: this.modePanel,
      alpha: on ? 1 : 0,
      scale: on ? 1 : 0.94,
      duration: 220,
      ease: Phaser.Math.Easing.Quadratic.Out,
      onComplete: () => {
        if (!on) this.modePanel.setVisible(false);
      },
    });
    if (on) {
      this.modePanel.setAlpha(0);
      this.modePanel.setScale(0.94);
    }
  }

  private buildModePanel(): Phaser.GameObjects.Container {
    const panel = this.add.container(0, 0).setDepth(50);

    const blocker = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.65)
      .setInteractive();
    blocker.on('pointerup', () => this.showModes(false));
    panel.add(blocker);

    panel.add(
      makeText(this, GAME_WIDTH / 2, 96, 'ESCOLHA SEU MODO', 34).setOrigin(0.5).setLetterSpacing(6)
    );

    const cardY = 390;
    panel.add(this.buildModeCard(250, cardY, 'TREINAMENTO', 'faisca',
      'Energia acelerada,\ninimigos mansos.\nAprenda as unidades.',
      [{ label: 'INICIAR', variant: 'ghost', action: () => this.startGame('training', 'easy') }]));

    panel.add(this.buildModeCard(GAME_WIDTH / 2, cardY, 'CONTRA IA', 'bastiao',
      'Destrua o Núcleo\ninimigo em 3 minutos.',
      (Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => ({
        label: DIFFICULTIES[d].label.toUpperCase(),
        variant: d === 'hard' ? 'danger' : d === 'normal' ? 'primary' : 'ghost',
        action: () => this.startGame('versus', d),
      }))));

    panel.add(this.buildModeCard(GAME_WIDTH - 250, cardY, 'SOBREVIVÊNCIA', 'tita',
      'Ondas infinitas.\nResista o máximo\nque conseguir.',
      [{ label: 'RESISTIR', variant: 'gold', action: () => this.startGame('survival', 'normal') }]));

    return panel;
  }

  private buildModeCard(
    x: number,
    y: number,
    title: string,
    iconUnit: UnitKey,
    desc: string,
    buttons: { label: string; variant: 'primary' | 'ghost' | 'danger' | 'gold'; action: () => void }[]
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const w = 380;
    const h = 430;
    const g = this.add.graphics();
    drawPanel(g, -w / 2, -h / 2, w, h, { radius: 22 });
    c.add(g);

    const playerColor = skinById(SaveManager.data.skin).color;
    const icon = this.add
      .image(0, -h / 2 + 86, TextureFactory.unitTexture(iconUnit, playerColor))
      .setScale(1.5);
    this.tweens.add({
      targets: icon,
      y: icon.y - 6,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: Phaser.Math.Easing.Sine.InOut,
    });
    c.add(icon);
    c.add(makeText(this, 0, -h / 2 + 158, title, 26).setOrigin(0.5).setLetterSpacing(3));
    c.add(
      this.add
        .text(0, -h / 2 + 218, desc, {
          fontFamily: FONT,
          fontSize: '17px',
          color: CSS.textDim,
          align: 'center',
          lineSpacing: 6,
        })
        .setOrigin(0.5)
    );

    const startY = h / 2 - buttons.length * 58 + 14;
    buttons.forEach((b, i) => {
      c.add(
        new UiButton(this, 0, startY + i * 58, b.label, {
          width: 280,
          height: 48,
          fontSize: 18,
          variant: b.variant,
          onClick: b.action,
        })
      );
    });
    return c;
  }

  private startGame(mode: GameMode, difficulty: Difficulty): void {
    this.cameras.main.fadeOut(300, 5, 7, 15);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('Game', { mode, difficulty });
    });
  }
}
