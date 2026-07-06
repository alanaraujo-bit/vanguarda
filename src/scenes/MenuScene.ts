/**
 * MenuScene.ts — Tela inicial.
 * Fundo cósmico vivo (nebulosas, estrelas em parallax, poeira luminosa,
 * desfile de tropas no horizonte), chip de perfil tocável, logo com brilho,
 * mascote-herói personalizado e seleção de modos.
 *
 * Layout desenhado sobre a grade de design 720x1280 (retrato), com margens
 * e ritmo vertical consistentes — sem sobras nem elementos desalinhados.
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONT, GAME_HEIGHT, GAME_WIDTH, hex } from '../../shared/constants';
import { AudioEngine } from '../audio/AudioEngine';
import { SaveManager } from '../core/SaveManager';
import { InstallPrompt } from '../core/InstallPrompt';
import { levelFromXp, skinById, titleById, xpIntoLevel, DIFFICULTIES } from '../config/progression';
import { TextureFactory } from '../gfx/TextureFactory';
import { UNIT_ORDER } from '../../shared/units';
import { UiButton, drawPanel, makeText } from '../ui/widgets';
import { SessionManager } from '../net/SessionManager';
import type { Difficulty, GameMode, UnitKey } from '../../shared/types';

const IOS_INSTALL_HINT_KEY = 'vanguarda-ios-install-hint-seen';

/* ------------------------------- Ritmo vertical ---------------------------- */
const MARGIN = 40;
const CHIP = { cx: 214, cy: 88, w: 372, h: 108 };
const GEAR = { x: GAME_WIDTH - 60, y: 78 };
const TITLE_Y = 300;
const SUBTITLE_Y = 366;
const DIVIDER_Y = 398;
const HERO_Y = 526;
const PLAY_Y = 762;
const ROW_Y = 874;
const INSTALL_Y = 950;
const PARADE_Y = 1120;
const VERSION_Y = 1246;

/* ------------------------------- Profundidades ----------------------------- */
const Z = {
  bg: -20,
  nebula: -18,
  stars: -16,
  dust: -14,
  vignette: -12,
  horizon: -11,
  parade: -10,
  crest: -6,
  heroGlow: -5,
  heroShadow: -4,
  hero: -3,
  playGlow: 8,
  title: 10,
  ui: 12,
} as const;

export class MenuScene extends Phaser.Scene {
  private stars!: Phaser.GameObjects.TileSprite;
  private modePanel!: Phaser.GameObjects.Container;
  private paradeTimer!: Phaser.Time.TimerEvent;
  private installBtn: UiButton | null = null;
  private playerColor: number = COLORS.player;

  constructor() {
    super('Menu');
  }

  create(): void {
    this.playerColor = skinById(SaveManager.data.skin).color;
    TextureFactory.ensureTeam(this, this.playerColor);

    this.buildBackground();
    this.buildProfileChip();
    this.buildIconButton(GEAR.x, GEAR.y, 'icon-gear', () =>
      this.scene.launch('Settings', { from: 'Menu' })
    );
    this.buildIconButton(GEAR.x - 72, GEAR.y, 'icon-shield', () => this.scene.start('Auth'));
    this.buildLogo();
    this.buildHero();
    this.buildButtons();
    this.buildInstallAffordance();

    this.add
      .text(GAME_WIDTH / 2, VERSION_Y, 'v1.0  •  arquitetura pronta para multiplayer', {
        fontFamily: FONT,
        fontSize: '14px',
        color: CSS.textDim,
      })
      .setOrigin(0.5)
      .setDepth(Z.ui);

    /* ------------------------------ Desfile --------------------------------- */
    this.paradeTimer = this.time.addEvent({
      delay: 2200,
      loop: true,
      callback: () => this.spawnParadeUnit(),
    });
    // Semeia alguns já em campo para o horizonte não começar vazio.
    for (let i = 0; i < 3; i++) this.time.delayedCall(i * 700, () => this.spawnParadeUnit());

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

  /* -------------------------------- Fundo ----------------------------------- */

  private buildBackground(): void {
    const color = this.playerColor;

    // Gradiente profundo (mais vivo em cima, quase preto embaixo).
    const bg = this.add.graphics().setDepth(Z.bg);
    bg.fillGradientStyle(0x0c1533, 0x0c1533, COLORS.bgDeep, COLORS.bgDeep, 1);
    bg.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Nebulosas translúcidas (glows suaves tingidos).
    this.add
      .image(140, 300, 'p-soft')
      .setScale(20, 15)
      .setTint(color)
      .setAlpha(0.12)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(Z.nebula);
    this.add
      .image(600, 860, 'p-soft')
      .setScale(17, 17)
      .setTint(COLORS.energy)
      .setAlpha(0.1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(Z.nebula);

    // Estrelas em parallax.
    this.stars = this.add
      .tileSprite(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 'bg-stars')
      .setAlpha(0.8)
      .setDepth(Z.stars);

    // Poeira luminosa subindo devagar.
    this.add
      .particles(0, 0, 'p-soft', {
        x: { min: 0, max: GAME_WIDTH },
        y: { min: 0, max: GAME_HEIGHT },
        lifespan: 9000,
        speedY: { min: -14, max: -4 },
        scale: { start: 0.5, end: 0 },
        alpha: { start: 0.22, end: 0 },
        quantity: 1,
        frequency: 440,
        tint: [color, COLORS.energy, 0xffffff],
        blendMode: Phaser.BlendModes.ADD,
      })
      .setDepth(Z.dust);

    // Vinheta: escurece topo e base para o chip e o rodapé respirarem.
    const vg = this.add.graphics().setDepth(Z.vignette);
    vg.fillGradientStyle(COLORS.bgDeep, COLORS.bgDeep, COLORS.bgDeep, COLORS.bgDeep, 0.9, 0.9, 0, 0);
    vg.fillRect(0, 0, GAME_WIDTH, 210);
    vg.fillGradientStyle(COLORS.bgDeep, COLORS.bgDeep, COLORS.bgDeep, COLORS.bgDeep, 0, 0, 0.95, 0.95);
    vg.fillRect(0, GAME_HEIGHT - 280, GAME_WIDTH, 280);

    // Brilho de horizonte atrás do desfile.
    this.add
      .image(GAME_WIDTH / 2, PARADE_Y + 26, 'p-soft')
      .setScale(34, 2.6)
      .setTint(color)
      .setAlpha(0.12)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(Z.horizon);
  }

  /* ----------------------------- Chip de perfil ------------------------------ */

  private buildProfileChip(): void {
    const p = SaveManager.data;
    const level = levelFromXp(p.xp);
    const { into, needed } = xpIntoLevel(p.xp);
    const { cx, cy, w, h } = CHIP;
    const color = this.playerColor;

    const chip = this.add
      .container(cx, cy)
      .setDepth(Z.ui)
      .setSize(w, h)
      .setInteractive({ useHandCursor: true });

    const g = this.add.graphics();
    drawPanel(g, -w / 2, -h / 2, w, h, { radius: 20 });

    // Medalhão de nível.
    const bx = -w / 2 + 60;
    g.fillStyle(color, 0.16);
    g.fillCircle(bx, 0, 40);
    g.lineStyle(3, color, 0.9);
    g.strokeCircle(bx, 0, 40);

    // Barra de XP.
    const barX = -w / 2 + 118;
    const barW = 196;
    const barY = 30;
    g.fillStyle(0x0a0f22, 1);
    g.fillRoundedRect(barX, barY, barW, 9, 4);
    g.fillStyle(color, 1);
    g.fillRoundedRect(barX, barY, Math.max(6, barW * (into / needed)), 9, 4);
    chip.add(g);

    chip.add(makeText(this, bx, -1, String(level), 30).setOrigin(0.5));
    chip.add(makeText(this, barX, -22, p.name, 22).setOrigin(0, 0.5));
    chip.add(makeText(this, barX, 4, titleById(p.title).name, 14, CSS.gold).setOrigin(0, 0.5));
    chip.add(
      makeText(this, barX + barW, 4, `${into}/${needed}`, 12, CSS.textDim, 'normal').setOrigin(1, 0.5)
    );

    // Selo de troféus — só aparece com a conta online conectada (mesmo comandante,
    // status de fora do modo online visível sem precisar abrir a tela de conta).
    if (SessionManager.isAuthenticated && SessionManager.profile) {
      const trophies = SessionManager.profile.trophies;
      const bw = 118;
      const bh = 30;
      const bcx = w / 2 - bw / 2 - 10;
      const bcy = -h / 2 + bh / 2 + 10;
      g.fillStyle(0x2b2412, 0.95);
      g.fillRoundedRect(bcx - bw / 2, bcy - bh / 2, bw, bh, 10);
      g.lineStyle(2, COLORS.gold, 0.9);
      g.strokeRoundedRect(bcx - bw / 2, bcy - bh / 2, bw, bh, 10);
      chip.add(makeText(this, bcx, bcy, `${trophies} troféus`, 12, CSS.gold).setOrigin(0.5));
    }

    chip.on('pointerover', () => chip.setScale(1.03));
    chip.on('pointerout', () => chip.setScale(1));
    chip.on('pointerup', () => {
      AudioEngine.play('ui-click');
      this.scene.start('Profile');
    });
  }

  /** Botão-ícone circular arredondado (engrenagem etc.). */
  private buildIconButton(x: number, y: number, icon: string, onClick: () => void): void {
    const s = 60;
    const btn = this.add
      .container(x, y)
      .setDepth(Z.ui)
      .setSize(s, s)
      .setInteractive({ useHandCursor: true });
    const g = this.add.graphics();
    const draw = (hover: boolean) => {
      g.clear();
      g.fillStyle(0x000000, 0.35);
      g.fillRoundedRect(-s / 2 + 2, -s / 2 + 3, s, s, 16);
      g.fillStyle(hover ? COLORS.uiPanelLight : COLORS.uiPanel, 0.96);
      g.fillRoundedRect(-s / 2, -s / 2, s, s, 16);
      g.lineStyle(2, COLORS.uiStroke, hover ? 1 : 0.85);
      g.strokeRoundedRect(-s / 2, -s / 2, s, s, 16);
    };
    draw(false);
    btn.add([g, this.add.image(0, 0, icon).setScale(1.15)]);
    btn.on('pointerover', () => {
      draw(true);
      AudioEngine.play('ui-hover');
    });
    btn.on('pointerout', () => draw(false));
    btn.on('pointerup', () => {
      AudioEngine.play('ui-click');
      onClick();
    });
  }

  /* -------------------------------- Logo ------------------------------------ */

  private buildLogo(): void {
    const color = this.playerColor;

    const titleGlow = this.add
      .image(GAME_WIDTH / 2, TITLE_Y + 4, 'p-soft')
      .setScale(30, 9)
      .setTint(color)
      .setAlpha(0.28)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(Z.title - 1);

    const title = this.add
      .text(GAME_WIDTH / 2, TITLE_Y, 'VANGUARDA', {
        fontFamily: FONT,
        fontSize: '92px',
        fontStyle: 'bold',
        color: CSS.text,
      })
      .setOrigin(0.5)
      .setLetterSpacing(12)
      .setShadow(0, 0, hex(color), 26, false, true)
      .setDepth(Z.title);
    // Garante margem: o logo nunca encosta nas bordas.
    const fit = Math.min(1, (GAME_WIDTH - MARGIN * 2) / title.width);
    title.setScale(fit);

    this.add
      .text(GAME_WIDTH / 2, SUBTITLE_Y, 'GUERRA PELO NÚCLEO', {
        fontFamily: FONT,
        fontSize: '22px',
        fontStyle: 'bold',
        color: CSS.gold,
      })
      .setOrigin(0.5)
      .setLetterSpacing(10)
      .setDepth(Z.title);

    // Divisória com losangos nas pontas.
    const div = this.add.graphics().setDepth(Z.title);
    const halfW = 168;
    div.lineStyle(2, color, 0.5);
    div.lineBetween(GAME_WIDTH / 2 - halfW, DIVIDER_Y, GAME_WIDTH / 2 - 16, DIVIDER_Y);
    div.lineBetween(GAME_WIDTH / 2 + 16, DIVIDER_Y, GAME_WIDTH / 2 + halfW, DIVIDER_Y);
    div.fillStyle(color, 0.9);
    div.fillPoints(
      [
        new Phaser.Geom.Point(GAME_WIDTH / 2, DIVIDER_Y - 6),
        new Phaser.Geom.Point(GAME_WIDTH / 2 + 8, DIVIDER_Y),
        new Phaser.Geom.Point(GAME_WIDTH / 2, DIVIDER_Y + 6),
        new Phaser.Geom.Point(GAME_WIDTH / 2 - 8, DIVIDER_Y),
      ],
      true
    );

    this.tweens.add({
      targets: titleGlow,
      alpha: 0.42,
      scaleX: 33,
      duration: 1900,
      yoyo: true,
      repeat: -1,
      ease: Phaser.Math.Easing.Sine.InOut,
    });
    this.tweens.add({
      targets: title,
      y: TITLE_Y - 6,
      duration: 2600,
      yoyo: true,
      repeat: -1,
      ease: Phaser.Math.Easing.Sine.InOut,
    });
  }

  /* -------------------------------- Herói ----------------------------------- */

  private buildHero(): void {
    const cx = GAME_WIDTH / 2;
    const cy = HERO_Y;
    const color = this.playerColor;

    // Crest hexagonal girando devagar (eco das bases e do carregamento).
    const crest = this.add.graphics().setDepth(Z.crest);
    const hexPath = (r: number, alpha: number, lw: number) => {
      crest.lineStyle(lw, color, alpha);
      crest.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) crest.moveTo(px, py);
        else crest.lineTo(px, py);
      }
      crest.closePath();
      crest.strokePath();
    };
    hexPath(150, 0.12, 2);
    hexPath(118, 0.08, 1.5);
    crest.setPosition(cx, cy);
    this.tweens.add({ targets: crest, rotation: Math.PI * 2, duration: 64000, repeat: -1 });

    // Glow + anel pulsante.
    this.add
      .image(cx, cy, 'p-soft')
      .setScale(11, 11)
      .setTint(color)
      .setAlpha(0.18)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(Z.heroGlow);
    const ring = this.add
      .image(cx, cy, 'p-ring')
      .setTint(color)
      .setAlpha(0.35)
      .setScale(3.4)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(Z.heroGlow);
    this.tweens.add({ targets: ring, rotation: Math.PI * 2, duration: 26000, repeat: -1 });
    this.tweens.add({
      targets: ring,
      scale: 3.7,
      alpha: 0.2,
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: Phaser.Math.Easing.Sine.InOut,
    });

    // Sombra + mascote (na cor do jogador).
    this.add.ellipse(cx, cy + 98, 150, 34, 0x000000, 0.35).setDepth(Z.heroShadow);
    const hero = this.add
      .image(cx, cy, TextureFactory.unitTexture('tita', color))
      .setScale(2.4)
      .setDepth(Z.hero);
    this.tweens.add({
      targets: hero,
      y: cy - 14,
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: Phaser.Math.Easing.Sine.InOut,
    });
  }

  /* -------------------------------- Botões ---------------------------------- */

  private buildButtons(): void {
    // Brilho pulsante atrás do CTA principal.
    const glow = this.add
      .image(GAME_WIDTH / 2, PLAY_Y, 'p-soft')
      .setScale(16, 5)
      .setTint(this.playerColor)
      .setAlpha(0.16)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(Z.playGlow);
    this.tweens.add({
      targets: glow,
      alpha: 0.3,
      scaleX: 18,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: Phaser.Math.Easing.Sine.InOut,
    });

    new UiButton(this, GAME_WIDTH / 2, PLAY_Y, 'JOGAR', {
      width: 444,
      height: 82,
      fontSize: 29,
      onClick: () => this.showModes(true),
    }).setDepth(Z.ui);

    // Três botões lado a lado (perfil também é acessível pelo chip do topo).
    const rowW = 200;
    const rowGap = 20;
    new UiButton(this, GAME_WIDTH / 2 - (rowW + rowGap), ROW_Y, 'PERFIL', {
      width: rowW,
      height: 64,
      fontSize: 15,
      variant: 'ghost',
      onClick: () => this.scene.start('Profile'),
    }).setDepth(Z.ui);
    new UiButton(this, GAME_WIDTH / 2, ROW_Y, 'RANKING', {
      width: rowW,
      height: 64,
      fontSize: 15,
      variant: 'ghost',
      onClick: () => this.scene.start('Ranking'),
    }).setDepth(Z.ui);
    new UiButton(this, GAME_WIDTH / 2 + (rowW + rowGap), ROW_Y, 'ENCICLOPÉDIA', {
      width: rowW,
      height: 64,
      fontSize: 15,
      variant: 'ghost',
      onClick: () => this.scene.start('Codex'),
    }).setDepth(Z.ui);
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
    this.installBtn = new UiButton(this, GAME_WIDTH / 2, INSTALL_Y, 'INSTALAR APP', {
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
    this.installBtn.setDepth(Z.ui);
  }

  private showIosInstallHint(): void {
    const hint = makeText(
      this,
      GAME_WIDTH / 2,
      INSTALL_Y,
      'Toque em Compartilhar e depois em "Adicionar à Tela de Início" para instalar',
      15,
      CSS.textDim,
      'normal'
    )
      .setOrigin(0.5)
      .setDepth(Z.ui)
      .setWordWrapWidth(600)
      .setAlign('center')
      .setInteractive({ useHandCursor: true });
    hint.on('pointerup', () => {
      localStorage.setItem(IOS_INSTALL_HINT_KEY, '1');
      hint.destroy();
    });
  }

  /* -------------------------------- Desfile --------------------------------- */

  private spawnParadeUnit(): void {
    const key = Phaser.Utils.Array.GetRandom(UNIT_ORDER) as UnitKey;
    const fromLeft = Math.random() < 0.55;
    const color = fromLeft ? this.playerColor : COLORS.enemy;
    const y = PARADE_Y + Phaser.Math.Between(-6, 10);
    const img = this.add
      .image(fromLeft ? -60 : GAME_WIDTH + 60, y, TextureFactory.unitTexture(key, color))
      .setScale(1.15)
      .setDepth(Z.parade)
      .setAlpha(0.85);
    if (!fromLeft) img.setFlipX(true);
    const dur = Phaser.Math.Between(10000, 15000);
    this.tweens.add({
      targets: img,
      x: fromLeft ? GAME_WIDTH + 60 : -60,
      duration: dur,
      onComplete: () => img.destroy(),
    });
    // Passinho de marcha.
    this.tweens.add({
      targets: img,
      y: y - 6,
      duration: 300,
      yoyo: true,
      repeat: Math.floor(dur / 600),
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
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x050912, 0.96)
      .setInteractive();
    blocker.on('pointerup', () => this.showModes(false));
    panel.add(blocker);

    panel.add(
      makeText(this, GAME_WIDTH / 2, 96, 'ESCOLHA SEU MODO', 34).setOrigin(0.5).setLetterSpacing(6)
    );

    // Três modos empilhados verticalmente (a tela é retrato: sobra altura, não largura).
    const cardH = 350;
    const gap = 30;
    const startY = 150 + cardH / 2;
    panel.add(this.buildModeCard(GAME_WIDTH / 2, startY, 'TREINAMENTO', 'faisca',
      'Energia acelerada, inimigos mansos. Aprenda as unidades.',
      [{ label: 'INICIAR', variant: 'ghost', action: () => this.startGame('training', 'easy') }]));

    panel.add(this.buildModeCard(GAME_WIDTH / 2, startY + (cardH + gap), 'CONTRA IA', 'bastiao',
      'Destrua o Núcleo inimigo em 3 minutos.',
      (Object.keys(DIFFICULTIES) as Difficulty[]).map((d) => ({
        label: DIFFICULTIES[d].label.toUpperCase(),
        variant: d === 'hard' ? 'danger' : d === 'normal' ? 'primary' : 'ghost',
        action: () => this.startGame('versus', d),
      }))));

    panel.add(this.buildModeCard(GAME_WIDTH / 2, startY + 2 * (cardH + gap), 'SOBREVIVÊNCIA', 'tita',
      'Ondas infinitas. Resista o máximo que conseguir.',
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
    const w = 640;
    const h = 350;
    const g = this.add.graphics();
    drawPanel(g, -w / 2, -h / 2, w, h, { radius: 22 });
    c.add(g);

    const playerColor = skinById(SaveManager.data.skin).color;
    const icon = this.add
      .image(-w / 2 + 90, -h / 2 + 90, TextureFactory.unitTexture(iconUnit, playerColor))
      .setScale(1.4);
    this.tweens.add({
      targets: icon,
      y: icon.y - 6,
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: Phaser.Math.Easing.Sine.InOut,
    });
    c.add(icon);
    c.add(
      makeText(this, -w / 2 + 150, -h / 2 + 66, title, 24).setOrigin(0, 0.5).setLetterSpacing(2)
    );
    c.add(
      this.add
        .text(-w / 2 + 150, -h / 2 + 108, desc, {
          fontFamily: FONT,
          fontSize: '16px',
          color: CSS.textDim,
          lineSpacing: 5,
          wordWrap: { width: w - 190 },
        })
        .setOrigin(0, 0.5)
    );

    // Botões em linha única — o card agora é largo o bastante pra caber lado a lado.
    const btnW = buttons.length > 1 ? 186 : 280;
    const btnGap = 20;
    const totalW = buttons.length * btnW + (buttons.length - 1) * btnGap;
    const startX = -totalW / 2 + btnW / 2;
    const buttonY = h / 2 - 48;
    buttons.forEach((b, i) => {
      c.add(
        new UiButton(this, startX + i * (btnW + btnGap), buttonY, b.label, {
          width: btnW,
          height: 46,
          fontSize: 16,
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
