/**
 * widgets.ts — Kit de interface reutilizável (botões, sliders, toggles, painéis).
 * Todos os componentes seguem a mesma linguagem visual: cantos arredondados,
 * traço luminoso, feedback de hover/pressão e som de UI integrado.
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONT } from '../../shared/constants';
import { AudioEngine } from '../audio/AudioEngine';
import { shade } from '../gfx/TextureFactory';

export type ButtonVariant = 'primary' | 'ghost' | 'danger' | 'gold';

const VARIANT_COLORS: Record<ButtonVariant, { fill: number; stroke: number; text: string }> = {
  primary: { fill: 0x1a4a66, stroke: COLORS.player, text: CSS.text },
  ghost: { fill: COLORS.uiPanelLight, stroke: COLORS.uiStroke, text: CSS.textDim },
  danger: { fill: 0x5c1a2a, stroke: COLORS.danger, text: CSS.text },
  gold: { fill: 0x5c4713, stroke: COLORS.gold, text: CSS.text },
};

export interface ButtonOptions {
  width?: number;
  height?: number;
  variant?: ButtonVariant;
  fontSize?: number;
  onClick: () => void;
}

/** Botão retangular com estados visuais e sonoros. */
export class UiButton extends Phaser.GameObjects.Container {
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private btnW: number;
  private btnH: number;
  private variant: ButtonVariant;
  private enabled = true;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    opts: ButtonOptions
  ) {
    super(scene, x, y);
    this.btnW = opts.width ?? 300;
    this.btnH = opts.height ?? 58;
    this.variant = opts.variant ?? 'primary';

    this.bg = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, text, {
        fontFamily: FONT,
        fontSize: `${opts.fontSize ?? 22}px`,
        fontStyle: 'bold',
        color: VARIANT_COLORS[this.variant].text,
      })
      .setOrigin(0.5);

    this.add([this.bg, this.label]);
    this.draw(0);
    this.setSize(this.btnW, this.btnH);
    this.setInteractive({ useHandCursor: true });

    this.on('pointerover', () => {
      if (!this.enabled) return;
      this.draw(1);
      AudioEngine.play('ui-hover');
    });
    this.on('pointerout', () => this.enabled && this.draw(0));
    this.on('pointerdown', () => {
      if (!this.enabled) return;
      this.draw(2);
      this.scene.tweens.add({ targets: this, scale: 0.96, duration: 60, yoyo: true });
    });
    this.on('pointerup', () => {
      if (!this.enabled) return;
      this.draw(1);
      AudioEngine.play('ui-click');
      opts.onClick();
    });

    scene.add.existing(this);
  }

  /** state: 0 normal, 1 hover, 2 pressionado. */
  private draw(state: number): void {
    const v = VARIANT_COLORS[this.variant];
    const fill = state === 1 ? shade(v.fill, 0.18) : state === 2 ? shade(v.fill, -0.2) : v.fill;
    const bw = this.btnW;
    const bh = this.btnH;
    this.bg.clear();
    this.bg.fillStyle(0x000000, 0.35);
    this.bg.fillRoundedRect(-bw / 2 + 3, -bh / 2 + 4, bw, bh, 14);
    this.bg.fillStyle(fill, 1);
    this.bg.fillRoundedRect(-bw / 2, -bh / 2, bw, bh, 14);
    this.bg.lineStyle(2, v.stroke, state === 0 ? 0.75 : 1);
    this.bg.strokeRoundedRect(-bw / 2, -bh / 2, bw, bh, 14);
    // Brilho superior sutil.
    this.bg.fillStyle(0xffffff, state === 2 ? 0.03 : 0.07);
    this.bg.fillRoundedRect(-bw / 2 + 3, -bh / 2 + 3, bw - 6, bh * 0.4, {
      tl: 11,
      tr: 11,
      bl: 0,
      br: 0,
    });
  }

  setEnabled(on: boolean): this {
    this.enabled = on;
    this.setAlpha(on ? 1 : 0.45);
    return this;
  }

  setText(text: string): this {
    this.label.setText(text);
    return this;
  }
}

/** Slider horizontal 0..1 com knob arrastável. */
export class UiSlider extends Phaser.GameObjects.Container {
  private track: Phaser.GameObjects.Graphics;
  private knob: Phaser.GameObjects.Graphics;
  private value: number;
  private trackW: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    initial: number,
    private onChange: (v: number) => void
  ) {
    super(scene, x, y);
    this.trackW = width;
    this.value = Phaser.Math.Clamp(initial, 0, 1);

    this.track = scene.add.graphics();
    this.knob = scene.add.graphics();
    this.add([this.track, this.knob]);
    this.redraw();

    this.setSize(width + 28, 36);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerdown', (p: Phaser.Input.Pointer) => this.pick(p));
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (p.isDown && this.dragging) this.pick(p);
    });
    scene.input.on('pointerup', () => (this.dragging = false));
    scene.add.existing(this);
  }

  private dragging = false;

  private pick(p: Phaser.Input.Pointer): void {
    this.dragging = true;
    const local = this.toLocal(p.x, p.y);
    this.value = Phaser.Math.Clamp(local.x / this.trackW + 0.5, 0, 1);
    this.redraw();
    this.onChange(this.value);
  }

  private toLocal(x: number, y: number): Phaser.Math.Vector2 {
    const m = this.getWorldTransformMatrix();
    const out = new Phaser.Math.Vector2();
    m.applyInverse(x, y, out);
    return out;
  }

  private redraw(): void {
    const half = this.trackW / 2;
    this.track.clear();
    this.track.fillStyle(0x0a0f22, 1);
    this.track.fillRoundedRect(-half, -5, this.trackW, 10, 5);
    this.track.fillStyle(COLORS.player, 0.9);
    this.track.fillRoundedRect(-half, -5, Math.max(10, this.trackW * this.value), 10, 5);
    this.track.lineStyle(1, COLORS.uiStroke, 1);
    this.track.strokeRoundedRect(-half, -5, this.trackW, 10, 5);

    this.knob.clear();
    this.knob.fillStyle(0xffffff, 1);
    this.knob.fillCircle(-half + this.trackW * this.value, 0, 11);
    this.knob.fillStyle(COLORS.player, 1);
    this.knob.fillCircle(-half + this.trackW * this.value, 0, 6);
  }

  setValue(v: number): void {
    this.value = Phaser.Math.Clamp(v, 0, 1);
    this.redraw();
  }
}

/** Interruptor liga/desliga em formato pílula. */
export class UiToggle extends Phaser.GameObjects.Container {
  private gfx: Phaser.GameObjects.Graphics;
  private value: boolean;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    initial: boolean,
    private onChange: (v: boolean) => void
  ) {
    super(scene, x, y);
    this.value = initial;
    this.gfx = scene.add.graphics();
    this.add(this.gfx);
    this.redraw();
    this.setSize(64, 34);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerup', () => {
      this.value = !this.value;
      AudioEngine.play('ui-click');
      this.redraw();
      this.onChange(this.value);
    });
    scene.add.existing(this);
  }

  private redraw(): void {
    this.gfx.clear();
    this.gfx.fillStyle(this.value ? 0x1a4a66 : 0x1a2038, 1);
    this.gfx.fillRoundedRect(-30, -15, 60, 30, 15);
    this.gfx.lineStyle(2, this.value ? COLORS.player : COLORS.uiStroke, 1);
    this.gfx.strokeRoundedRect(-30, -15, 60, 30, 15);
    this.gfx.fillStyle(this.value ? COLORS.player : 0x5a6a90, 1);
    this.gfx.fillCircle(this.value ? 14 : -14, 0, 11);
  }

  setValue(v: boolean): void {
    this.value = v;
    this.redraw();
  }
}

export interface TextInputOptions {
  width?: number;
  height?: number;
  type?: 'text' | 'password' | 'email';
  placeholder?: string;
  maxLength?: number;
  /** Disparado no Enter — normalmente pra submeter o formulário. */
  onEnter?: () => void;
}

/**
 * Input de texto real sobreposto ao canvas (Phaser DOM Element — requer
 * `dom: { createContainer: true }` na config do jogo, ver src/main.ts).
 * Estilo em `.vg-input`/`.vg-input-error` no <style> de index.html.
 */
export class UiTextInput extends Phaser.GameObjects.DOMElement {
  constructor(scene: Phaser.Scene, x: number, y: number, opts: TextInputOptions = {}) {
    const el = document.createElement('input');
    el.className = 'vg-input';
    el.type = opts.type ?? 'text';
    el.placeholder = opts.placeholder ?? '';
    el.autocomplete = opts.type === 'password' ? 'current-password' : 'off';
    if (opts.maxLength) el.maxLength = opts.maxLength;
    el.style.width = `${opts.width ?? 340}px`;
    el.style.height = `${opts.height ?? 56}px`;

    super(scene, x, y, el);

    if (opts.onEnter) {
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') opts.onEnter!();
      });
    }
    scene.add.existing(this);
  }

  get value(): string {
    return (this.node as HTMLInputElement).value;
  }

  set value(v: string) {
    (this.node as HTMLInputElement).value = v;
  }

  setError(on: boolean): this {
    this.node.classList.toggle('vg-input-error', on);
    return this;
  }

  focusInput(): this {
    (this.node as HTMLInputElement).focus();
    return this;
  }
}

/**
 * Lista rolável (arrasto touch/mouse + roda do mouse), mascarada pro viewport.
 * Ao contrário dos outros widgets deste arquivo, `x`/`y` aqui são o canto
 * superior esquerdo do viewport (mais natural pra empilhar linhas de cima
 * pra baixo). Quem chama só usa `.content` (um Container comum) pra
 * adicionar as linhas e depois informa a altura total com `setContentHeight`.
 */
export class UiScrollList extends Phaser.GameObjects.Container {
  readonly content: Phaser.GameObjects.Container;
  private readonly viewportW: number;
  private readonly viewportH: number;
  private readonly maskShape: Phaser.GameObjects.Graphics;
  private readonly track: Phaser.GameObjects.Graphics;
  private contentH = 0;
  private scrollY = 0;
  private dragging = false;
  private dragStartY = 0;
  private scrollStartY = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number) {
    super(scene, x, y);
    this.viewportW = width;
    this.viewportH = height;

    this.content = scene.add.container(0, 0);
    this.add(this.content);

    this.maskShape = scene.make.graphics({}, false);
    this.maskShape.fillStyle(0xffffff);
    this.maskShape.fillRect(x, y, width, height);
    this.content.setMask(this.maskShape.createGeometryMask());

    this.track = scene.add.graphics();
    this.add(this.track);

    this.setSize(width, height);
    this.setInteractive();

    const bounds = new Phaser.Geom.Rectangle(x, y, width, height);
    this.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragging = true;
      this.dragStartY = p.y;
      this.scrollStartY = this.scrollY;
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.dragging || !p.isDown) return;
      this.setScroll(this.scrollStartY - (p.y - this.dragStartY));
    });
    scene.input.on('pointerup', () => (this.dragging = false));
    scene.input.on('wheel', (p: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
      if (Phaser.Geom.Rectangle.Contains(bounds, p.x, p.y)) this.setScroll(this.scrollY + dy * 0.5);
    });

    scene.add.existing(this);
  }

  /** Chame depois de popular `.content` — define o quanto dá pra rolar. */
  setContentHeight(h: number): void {
    this.contentH = h;
    this.setScroll(this.scrollY);
    this.redrawTrack();
  }

  /** Esvazia a lista (ex.: trocando de aba) sem destruir o widget em si. */
  clear(): void {
    this.content.removeAll(true);
    this.contentH = 0;
    this.setScroll(0);
    this.track.clear();
  }

  private get maxScroll(): number {
    return Math.max(0, this.contentH - this.viewportH);
  }

  private setScroll(y: number): void {
    this.scrollY = Phaser.Math.Clamp(y, 0, this.maxScroll);
    this.content.y = -this.scrollY;
    this.redrawTrack();
  }

  private redrawTrack(): void {
    this.track.clear();
    if (this.maxScroll <= 0) return;
    const tx = this.viewportW - 6;
    this.track.fillStyle(0xffffff, 0.08);
    this.track.fillRoundedRect(tx, 0, 4, this.viewportH, 2);
    const thumbH = Math.max(30, (this.viewportH / this.contentH) * this.viewportH);
    const thumbY = (this.scrollY / this.maxScroll) * (this.viewportH - thumbH);
    this.track.fillStyle(COLORS.gold, 0.6);
    this.track.fillRoundedRect(tx, thumbY, 4, thumbH, 2);
  }

  destroy(fromScene?: boolean): void {
    this.maskShape.destroy();
    super.destroy(fromScene);
  }
}

/** Desenha um painel padrão no Graphics fornecido. */
export function drawPanel(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { fill?: number; stroke?: number; radius?: number; alpha?: number } = {}
): void {
  const { fill = COLORS.uiPanel, stroke = COLORS.uiStroke, radius = 18, alpha = 0.96 } = opts;
  g.fillStyle(0x000000, 0.4);
  g.fillRoundedRect(x + 4, y + 6, w, h, radius);
  g.fillStyle(fill, alpha);
  g.fillRoundedRect(x, y, w, h, radius);
  g.lineStyle(2, stroke, 0.9);
  g.strokeRoundedRect(x, y, w, h, radius);
}

/** Atalho para texto padronizado. */
export function makeText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  size: number,
  color: string = CSS.text,
  style: 'normal' | 'bold' = 'bold'
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, {
    fontFamily: FONT,
    fontSize: `${size}px`,
    fontStyle: style,
    color,
  });
}
