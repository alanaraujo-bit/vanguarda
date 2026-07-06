/**
 * TextureFactory.ts — Geração procedural de todas as texturas do jogo.
 * Direção de arte: mascotes geométricos carismáticos com olhos expressivos,
 * corpos na cor do time, acentos neon próprios de cada unidade e contorno
 * escuro para leitura instantânea no campo.
 *
 * Todas as unidades são desenhadas olhando para a DIREITA;
 * o time inimigo espelha o sprite em runtime.
 */
import Phaser from 'phaser';
import type { UnitDef, UnitKey } from '../core/types';
import { UNIT_DEFS } from '../config/units';
import { COLORS, GAME_HEIGHT, GAME_WIDTH, LANE_YS } from '../config/constants';

const OUTLINE = 0x0a0f1e;

/** Clareia (pct>0) ou escurece (pct<0) uma cor RGB. */
export function shade(color: number, pct: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const f = (c: number) =>
    Math.max(0, Math.min(255, Math.round(pct > 0 ? c + (255 - c) * pct : c * (1 + pct))));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

function makeGraphics(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  return scene.make.graphics({ x: 0, y: 0 }, false);
}

export const TextureFactory = {
  /** Chave da textura de uma unidade para uma cor de time. */
  unitTexture(key: UnitKey, teamColor: number): string {
    return `unit-${key}-${teamColor.toString(16)}`;
  },

  baseTexture(teamColor: number): string {
    return `base-${teamColor.toString(16)}`;
  },

  /** Gera texturas neutras (uma única vez, no Boot). */
  createShared(scene: Phaser.Scene): void {
    if (scene.textures.exists('p-soft')) return;
    this.particles(scene);
    this.projectiles(scene);
    this.stars(scene);
    this.arena(scene);
    this.icons(scene);
    this.portal(scene);
  },

  /** Garante unidades + base para uma cor de time. */
  ensureTeam(scene: Phaser.Scene, teamColor: number): void {
    if (scene.textures.exists(this.baseTexture(teamColor))) return;
    this.base(scene, teamColor);
    (Object.keys(UNIT_DEFS) as UnitKey[]).forEach((k) =>
      this.unit(scene, UNIT_DEFS[k], teamColor)
    );
  },

  /* ------------------------------- Partículas ------------------------------ */

  particles(scene: Phaser.Scene): void {
    // Círculo suave (glow) — círculos concêntricos com alpha decrescente.
    let g = makeGraphics(scene);
    for (let i = 8; i >= 1; i--) {
      g.fillStyle(0xffffff, 0.09 + (8 - i) * 0.028);
      g.fillCircle(16, 16, i * 2);
    }
    g.generateTexture('p-soft', 32, 32);
    g.destroy();

    // Faísca (losango alongado).
    g = makeGraphics(scene);
    g.fillStyle(0xffffff, 1);
    g.beginPath();
    g.moveTo(8, 0);
    g.lineTo(11, 8);
    g.lineTo(8, 16);
    g.lineTo(5, 8);
    g.closePath();
    g.fillPath();
    g.generateTexture('p-spark', 16, 16);
    g.destroy();

    // Anel (onda de choque / invocação).
    g = makeGraphics(scene);
    g.lineStyle(4, 0xffffff, 1);
    g.strokeCircle(32, 32, 28);
    g.generateTexture('p-ring', 64, 64);
    g.destroy();

    // Quadradinho (detritos).
    g = makeGraphics(scene);
    g.fillStyle(0xffffff, 1);
    g.fillRect(0, 0, 6, 6);
    g.generateTexture('p-square', 6, 6);
    g.destroy();
  },

  /* ------------------------------- Projéteis ------------------------------- */

  projectiles(scene: Phaser.Scene): void {
    // Dardo de plasma (Agulha) — desenhado apontando para a direita.
    let g = makeGraphics(scene);
    g.fillStyle(0xffffff, 0.5);
    g.fillEllipse(14, 6, 26, 8);
    g.fillStyle(0xffffff, 1);
    g.fillEllipse(16, 6, 18, 4);
    g.generateTexture('proj-bolt', 28, 12);
    g.destroy();

    // Granada do Trovão.
    g = makeGraphics(scene);
    g.fillStyle(OUTLINE, 1);
    g.fillCircle(9, 9, 8);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(9, 9, 6);
    g.fillStyle(OUTLINE, 0.5);
    g.fillCircle(11, 7, 2);
    g.generateTexture('proj-shell', 18, 18);
    g.destroy();

    // Pulso de cura (cruz).
    g = makeGraphics(scene);
    g.fillStyle(0xffffff, 0.45);
    g.fillCircle(10, 10, 9);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(7, 3, 6, 14, 2);
    g.fillRoundedRect(3, 7, 14, 6, 2);
    g.generateTexture('proj-heal', 20, 20);
    g.destroy();
  },

  /* --------------------------------- Cenário -------------------------------- */

  stars(scene: Phaser.Scene): void {
    const g = makeGraphics(scene);
    const rng = new Phaser.Math.RandomDataGenerator(['vanguarda-stars']);
    for (let i = 0; i < 110; i++) {
      const x = rng.between(2, 510);
      const y = rng.between(2, 510);
      const r = rng.frac() < 0.85 ? 1 : 2;
      g.fillStyle(0xffffff, rng.realInRange(0.15, 0.7));
      g.fillCircle(x, y, r);
    }
    // Algumas estrelas com brilho em cruz.
    for (let i = 0; i < 6; i++) {
      const x = rng.between(20, 490);
      const y = rng.between(20, 490);
      g.fillStyle(0xffffff, 0.5);
      g.fillCircle(x, y, 1.6);
      g.lineStyle(1, 0xffffff, 0.25);
      g.lineBetween(x - 6, y, x + 6, y);
      g.lineBetween(x, y - 6, x, y + 6);
    }
    g.generateTexture('bg-stars', 512, 512);
    g.destroy();
  },

  /** Céu + plataforma da arena com as três faixas de combate. */
  arena(scene: Phaser.Scene): void {
    const g = makeGraphics(scene);
    // Céu em gradiente vertical profundo.
    g.fillGradientStyle(COLORS.bgMid, COLORS.bgMid, COLORS.bgDeep, COLORS.bgDeep, 1);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    // Nebulosas distantes (elipses translúcidas).
    g.fillStyle(0x24346b, 0.35);
    g.fillEllipse(280, 120, 520, 180);
    g.fillStyle(0x3a2a6b, 0.28);
    g.fillEllipse(980, 90, 460, 150);
    g.fillStyle(0x1b4a6b, 0.22);
    g.fillEllipse(660, 180, 700, 160);

    // Plataforma principal.
    const top = 238;
    const bottom = 648;
    g.fillStyle(COLORS.ground, 1);
    g.fillRoundedRect(34, top, GAME_WIDTH - 68, bottom - top, 26);
    g.lineStyle(3, COLORS.groundLine, 1);
    g.strokeRoundedRect(34, top, GAME_WIDTH - 68, bottom - top, 26);
    // Borda superior iluminada.
    g.lineStyle(2, 0x3f5da8, 0.8);
    g.lineBetween(60, top + 2, GAME_WIDTH - 60, top + 2);

    // Grade vertical sutil.
    g.lineStyle(1, COLORS.groundLine, 0.35);
    for (let x = 120; x < GAME_WIDTH - 60; x += 80) {
      g.lineBetween(x, top + 14, x, bottom - 14);
    }

    // Faixas de combate.
    for (const laneY of LANE_YS) {
      g.fillStyle(COLORS.laneGlow, 0.5);
      g.fillRoundedRect(120, laneY - 46, GAME_WIDTH - 240, 92, 18);
      g.lineStyle(2, 0x2e4a8f, 0.55);
      g.strokeRoundedRect(120, laneY - 46, GAME_WIDTH - 240, 92, 18);
      // Setas direcionais sutis no piso da faixa.
      g.lineStyle(2, 0x3f5da8, 0.22);
      for (let x = 230; x < GAME_WIDTH - 240; x += 130) {
        g.lineBetween(x, laneY - 10, x + 16, laneY);
        g.lineBetween(x + 16, laneY, x, laneY + 10);
      }
    }

    // Linha central da arena.
    g.lineStyle(3, 0x3f5da8, 0.5);
    for (let y = top + 18; y < bottom - 18; y += 26) {
      g.lineBetween(GAME_WIDTH / 2, y, GAME_WIDTH / 2, y + 13);
    }
    g.fillStyle(0x3f5da8, 0.6);
    g.fillCircle(GAME_WIDTH / 2, top + 4, 5);
    g.fillCircle(GAME_WIDTH / 2, bottom - 4, 5);

    g.generateTexture('arena', GAME_WIDTH, GAME_HEIGHT);
    g.destroy();
  },

  /* ---------------------------------- Bases --------------------------------- */

  /** Núcleo-fortaleza do time: torre hexagonal com cristal pulsante. */
  base(scene: Phaser.Scene, color: number): void {
    const key = this.baseTexture(color);
    if (scene.textures.exists(key)) return;
    const w = 176;
    const h = 216;
    const cx = w / 2;
    const g = makeGraphics(scene);

    const dark = shade(color, -0.72);
    const mid = shade(color, -0.45);
    const lite = shade(color, 0.35);

    // Pedestal.
    g.fillStyle(OUTLINE, 1);
    g.fillRoundedRect(12, h - 58, w - 24, 50, 12);
    g.fillStyle(mid, 1);
    g.fillRoundedRect(16, h - 54, w - 32, 42, 10);
    g.fillStyle(dark, 1);
    g.fillRoundedRect(24, h - 46, w - 48, 26, 8);
    // Luzes do pedestal.
    for (let i = 0; i < 4; i++) {
      g.fillStyle(color, 0.9);
      g.fillCircle(40 + i * 32, h - 33, 4);
    }

    // Torre hexagonal.
    const hex = (x: number, y: number, r: number) => {
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.closePath();
      g.fillPath();
    };
    g.fillStyle(OUTLINE, 1);
    hex(cx, 96, 74);
    g.fillStyle(mid, 1);
    hex(cx, 96, 66);
    g.fillStyle(dark, 1);
    hex(cx, 96, 50);

    // Cristal central (o "Núcleo").
    g.fillStyle(color, 0.35);
    g.fillCircle(cx, 96, 42);
    g.fillStyle(color, 1);
    g.beginPath();
    g.moveTo(cx, 60);
    g.lineTo(cx + 26, 96);
    g.lineTo(cx, 132);
    g.lineTo(cx - 26, 96);
    g.closePath();
    g.fillPath();
    g.fillStyle(lite, 1);
    g.beginPath();
    g.moveTo(cx, 72);
    g.lineTo(cx + 13, 96);
    g.lineTo(cx, 120);
    g.lineTo(cx - 13, 96);
    g.closePath();
    g.fillPath();

    // Antenas superiores.
    g.lineStyle(5, mid, 1);
    g.lineBetween(cx - 34, 40, cx - 46, 14);
    g.lineBetween(cx + 34, 40, cx + 46, 14);
    g.fillStyle(color, 1);
    g.fillCircle(cx - 46, 12, 5);
    g.fillCircle(cx + 46, 12, 5);

    g.generateTexture(key, w, h);
    g.destroy();
  },

  /** Portal de invasão (modo Sobrevivência). */
  portal(scene: Phaser.Scene): void {
    const g = makeGraphics(scene);
    const c = 90;
    g.lineStyle(10, 0xff5a3c, 0.9);
    g.strokeCircle(c, c, 70);
    g.lineStyle(4, 0xffa14d, 0.8);
    g.strokeCircle(c, c, 54);
    // Runas na borda.
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      g.fillStyle(0xffd24d, 0.9);
      g.fillCircle(c + Math.cos(a) * 70, c + Math.sin(a) * 70, 6);
    }
    g.generateTexture('portal', 180, 180);
    g.destroy();
  },

  /* --------------------------------- Unidades ------------------------------- */

  unit(scene: Phaser.Scene, def: UnitDef, teamColor: number): void {
    const key = this.unitTexture(def.key, teamColor);
    if (scene.textures.exists(key)) return;
    const S = def.radius * 2 + 28;
    const c = S / 2;
    const g = makeGraphics(scene);

    const body = teamColor;
    const dark = shade(teamColor, -0.4);
    const lite = shade(teamColor, 0.4);
    const acc = def.accent;

    /** Olhos expressivos: escleras brancas + pupilas, deslocados para a direita. */
    const eyes = (
      x: number,
      y: number,
      r: number,
      gap: number,
      angry = false
    ) => {
      g.fillStyle(0xffffff, 1);
      if (angry) {
        g.fillTriangle(x - gap - r, y - r * 0.7, x - gap + r, y + r * 0.6, x - gap - r, y + r * 0.6);
        g.fillTriangle(x + gap + r, y - r * 0.7, x + gap - r, y + r * 0.6, x + gap + r, y + r * 0.6);
        g.fillStyle(OUTLINE, 1);
        g.fillCircle(x - gap, y + r * 0.15, r * 0.32);
        g.fillCircle(x + gap, y + r * 0.15, r * 0.32);
      } else {
        g.fillEllipse(x - gap, y, r * 1.5, r * 1.9);
        g.fillEllipse(x + gap, y, r * 1.5, r * 1.9);
        g.fillStyle(OUTLINE, 1);
        g.fillCircle(x - gap + r * 0.3, y, r * 0.5);
        g.fillCircle(x + gap + r * 0.3, y, r * 0.5);
      }
    };

    switch (def.key) {
      case 'faisca': {
        // Recruta: caixa arredondada com visor e antena.
        g.fillStyle(OUTLINE, 1);
        g.fillRoundedRect(c - 21, c - 19, 42, 40, 11);
        g.fillStyle(body, 1);
        g.fillRoundedRect(c - 18, c - 16, 36, 34, 9);
        g.fillStyle(dark, 1);
        g.fillRoundedRect(c - 18, c + 6, 36, 12, { tl: 0, tr: 0, bl: 9, br: 9 });
        // Antena.
        g.lineStyle(3, dark, 1);
        g.lineBetween(c, c - 16, c - 4, c - 26);
        g.fillStyle(acc, 1);
        g.fillCircle(c - 4, c - 28, 4);
        // Visor.
        g.fillStyle(OUTLINE, 1);
        g.fillRoundedRect(c - 13, c - 11, 30, 15, 7);
        eyes(c + 3, c - 3.5, 3.4, 6.5);
        // Pés.
        g.fillStyle(dark, 1);
        g.fillRoundedRect(c - 14, c + 17, 11, 7, 3);
        g.fillRoundedRect(c + 3, c + 17, 11, 7, 3);
        break;
      }
      case 'agulha': {
        // Atiradora: corpo em gota, lente única e rifle longo.
        g.fillStyle(OUTLINE, 1);
        g.fillEllipse(c - 2, c, 38, 42);
        g.fillStyle(body, 1);
        g.fillEllipse(c - 2, c, 32, 36);
        g.fillStyle(dark, 1);
        g.fillEllipse(c - 8, c + 6, 18, 20);
        // Rifle.
        g.fillStyle(OUTLINE, 1);
        g.fillRoundedRect(c + 2, c - 3, 26, 8, 3);
        g.fillStyle(acc, 1);
        g.fillRoundedRect(c + 4, c - 1, 22, 4, 2);
        g.fillStyle(lite, 1);
        g.fillCircle(c + 27, c + 1, 3);
        // Lente-monóculo.
        g.fillStyle(OUTLINE, 1);
        g.fillCircle(c + 3, c - 8, 8.5);
        g.fillStyle(0xffffff, 1);
        g.fillCircle(c + 3, c - 8, 6.5);
        g.fillStyle(acc, 1);
        g.fillCircle(c + 4.5, c - 8, 3.4);
        g.fillStyle(OUTLINE, 1);
        g.fillCircle(c + 5, c - 8, 1.6);
        break;
      }
      case 'bastiao': {
        // Tanque: hexágono largo com placa-escudo frontal.
        g.fillStyle(OUTLINE, 1);
        g.fillRoundedRect(c - 30, c - 26, 60, 54, 14);
        g.fillStyle(body, 1);
        g.fillRoundedRect(c - 27, c - 23, 54, 48, 12);
        g.fillStyle(dark, 1);
        g.fillRoundedRect(c - 27, c + 4, 54, 21, { tl: 0, tr: 0, bl: 12, br: 12 });
        // Escudo frontal.
        g.fillStyle(OUTLINE, 1);
        g.fillRoundedRect(c + 12, c - 22, 18, 46, 7);
        g.fillStyle(lite, 1);
        g.fillRoundedRect(c + 15, c - 19, 12, 40, 5);
        g.fillStyle(acc, 0.9);
        g.fillCircle(c + 21, c - 10, 2.5);
        g.fillCircle(c + 21, c, 2.5);
        g.fillCircle(c + 21, c + 10, 2.5);
        // Cabecinha.
        g.fillStyle(OUTLINE, 1);
        g.fillRoundedRect(c - 14, c - 34, 24, 16, 6);
        g.fillStyle(body, 1);
        g.fillRoundedRect(c - 12, c - 32, 20, 12, 5);
        eyes(c - 2, c - 26, 2.4, 4.5);
        // Punho traseiro.
        g.fillStyle(dark, 1);
        g.fillCircle(c - 27, c + 8, 9);
        break;
      }
      case 'lamina': {
        // Assassina: seta afiada com lâminas dorsais.
        g.fillStyle(OUTLINE, 1);
        g.beginPath();
        g.moveTo(c + 24, c);
        g.lineTo(c - 12, c - 19);
        g.lineTo(c - 20, c);
        g.lineTo(c - 12, c + 19);
        g.closePath();
        g.fillPath();
        g.fillStyle(body, 1);
        g.beginPath();
        g.moveTo(c + 20, c);
        g.lineTo(c - 10, c - 15);
        g.lineTo(c - 16, c);
        g.lineTo(c - 10, c + 15);
        g.closePath();
        g.fillPath();
        // Lâminas.
        g.fillStyle(acc, 1);
        g.fillTriangle(c - 6, c - 14, c + 4, c - 24, c + 6, c - 12);
        g.fillTriangle(c - 6, c + 14, c + 4, c + 24, c + 6, c + 12);
        // Olhos bravos.
        eyes(c + 4, c - 2, 2.6, 4.6, true);
        break;
      }
      case 'lumen': {
        // Médico: esfera com auréola e emblema de cruz.
        g.fillStyle(acc, 0.25);
        g.fillCircle(c, c, def.radius + 8);
        g.fillStyle(OUTLINE, 1);
        g.fillCircle(c, c + 2, 20);
        g.fillStyle(body, 1);
        g.fillCircle(c, c + 2, 17);
        g.fillStyle(lite, 1);
        g.fillEllipse(c - 5, c - 4, 12, 9);
        // Cruz no peito.
        g.fillStyle(0xffffff, 1);
        g.fillRoundedRect(c - 2.5, c + 4, 5, 13, 2);
        g.fillRoundedRect(c - 6.5, c + 8, 13, 5, 2);
        // Auréola.
        g.lineStyle(3, acc, 0.95);
        g.strokeEllipse(c, c - 22, 22, 8);
        // Olhos gentis.
        eyes(c + 2, c - 4, 2.6, 5.5);
        break;
      }
      case 'trovao': {
        // Artilharia: chassi sobre esteiras com canhão inclinado.
        g.fillStyle(OUTLINE, 1);
        g.fillRoundedRect(c - 24, c + 8, 48, 16, 8);
        g.fillStyle(dark, 1);
        g.fillRoundedRect(c - 21, c + 10, 42, 12, 6);
        g.fillStyle(OUTLINE, 0.8);
        for (let i = 0; i < 4; i++) g.fillCircle(c - 14 + i * 9.5, c + 16, 3);
        // Corpo.
        g.fillStyle(OUTLINE, 1);
        g.fillRoundedRect(c - 20, c - 14, 40, 26, 9);
        g.fillStyle(body, 1);
        g.fillRoundedRect(c - 17, c - 11, 34, 20, 7);
        // Canhão apontando para cima/direita.
        g.save();
        g.translateCanvas(c + 4, c - 10);
        g.rotateCanvas(-0.62);
        g.fillStyle(OUTLINE, 1);
        g.fillRoundedRect(-4, -6, 30, 12, 4);
        g.fillStyle(dark, 1);
        g.fillRoundedRect(-2, -4, 26, 8, 3);
        g.fillStyle(acc, 1);
        g.fillRoundedRect(18, -5, 6, 10, 2);
        g.restore();
        // Visor quadrado.
        g.fillStyle(OUTLINE, 1);
        g.fillRoundedRect(c - 12, c - 8, 16, 12, 4);
        g.fillStyle(acc, 1);
        g.fillRoundedRect(c - 10, c - 6, 12, 8, 3);
        g.fillStyle(OUTLINE, 1);
        g.fillCircle(c - 3, c - 2, 1.8);
        break;
      }
      case 'enxame': {
        // Drone: bolinha com asas e hélice.
        g.fillStyle(OUTLINE, 1);
        g.fillCircle(c, c, 14);
        g.fillStyle(body, 1);
        g.fillCircle(c, c, 11.5);
        g.fillStyle(dark, 1);
        g.fillEllipse(c - 3, c + 5, 14, 8);
        // Asas.
        g.fillStyle(acc, 0.85);
        g.fillEllipse(c - 12, c - 6, 12, 5);
        g.fillEllipse(c - 14, c + 2, 10, 4);
        // Hélice.
        g.lineStyle(2, dark, 1);
        g.lineBetween(c, c - 12, c, c - 17);
        g.lineStyle(2, acc, 0.9);
        g.lineBetween(c - 9, c - 18, c + 9, c - 18);
        // Olho único.
        g.fillStyle(0xffffff, 1);
        g.fillCircle(c + 4, c - 2, 4.5);
        g.fillStyle(OUTLINE, 1);
        g.fillCircle(c + 5.5, c - 2, 2.2);
        break;
      }
      case 'tita': {
        // Colosso: torso maciço, ombreiras, núcleo exposto e coroa.
        g.fillStyle(OUTLINE, 1);
        g.beginPath();
        g.moveTo(c - 30, c - 22);
        g.lineTo(c + 30, c - 22);
        g.lineTo(c + 24, c + 30);
        g.lineTo(c - 24, c + 30);
        g.closePath();
        g.fillPath();
        g.fillStyle(body, 1);
        g.beginPath();
        g.moveTo(c - 26, c - 19);
        g.lineTo(c + 26, c - 19);
        g.lineTo(c + 21, c + 26);
        g.lineTo(c - 21, c + 26);
        g.closePath();
        g.fillPath();
        g.fillStyle(dark, 1);
        g.beginPath();
        g.moveTo(c - 23, c + 8);
        g.lineTo(c + 23, c + 8);
        g.lineTo(c + 21, c + 26);
        g.lineTo(c - 21, c + 26);
        g.closePath();
        g.fillPath();
        // Ombreiras.
        g.fillStyle(OUTLINE, 1);
        g.fillRoundedRect(c - 40, c - 26, 20, 22, 7);
        g.fillRoundedRect(c + 20, c - 26, 20, 22, 7);
        g.fillStyle(lite, 1);
        g.fillRoundedRect(c - 37, c - 23, 14, 16, 5);
        g.fillRoundedRect(c + 23, c - 23, 14, 16, 5);
        // Núcleo no peito.
        g.fillStyle(acc, 0.4);
        g.fillCircle(c, c + 2, 10);
        g.fillStyle(acc, 1);
        g.fillCircle(c, c + 2, 6);
        // Cabeça coroada.
        g.fillStyle(OUTLINE, 1);
        g.fillRoundedRect(c - 13, c - 40, 26, 20, 6);
        g.fillStyle(body, 1);
        g.fillRoundedRect(c - 11, c - 38, 22, 16, 5);
        g.fillStyle(acc, 1);
        g.fillTriangle(c - 11, c - 38, c - 7, c - 46, c - 3, c - 38);
        g.fillTriangle(c - 4, c - 38, c, c - 48, c + 4, c - 38);
        g.fillTriangle(c + 3, c - 38, c + 7, c - 46, c + 11, c - 38);
        eyes(c + 1, c - 30, 2.6, 5, true);
        break;
      }
    }

    g.generateTexture(key, S, S);
    g.destroy();
  },

  /* ---------------------------------- Ícones -------------------------------- */

  icons(scene: Phaser.Scene): void {
    // Raio de energia.
    let g = makeGraphics(scene);
    g.fillStyle(0xffffff, 1);
    g.beginPath();
    g.moveTo(13, 1);
    g.lineTo(4, 13);
    g.lineTo(9, 13);
    g.lineTo(7, 23);
    g.lineTo(17, 10);
    g.lineTo(11, 10);
    g.closePath();
    g.fillPath();
    g.generateTexture('icon-energy', 20, 24);
    g.destroy();

    // Medalha.
    g = makeGraphics(scene);
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(10, 2, 22, 2, 16, 14);
    g.fillCircle(16, 20, 9);
    g.fillStyle(0x000000, 0.35);
    g.fillCircle(16, 20, 5);
    g.generateTexture('icon-medal', 32, 32);
    g.destroy();

    // Estrela.
    g = makeGraphics(scene);
    g.fillStyle(0xffffff, 1);
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 14 : 6;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = 16 + Math.cos(a) * r;
      const y = 16 + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fillPath();
    g.generateTexture('icon-star', 32, 32);
    g.destroy();

    // Caveira.
    g = makeGraphics(scene);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(6, 4, 20, 18, 9);
    g.fillRoundedRect(10, 20, 12, 8, 3);
    g.fillStyle(0x000000, 0.6);
    g.fillCircle(12, 13, 3.4);
    g.fillCircle(20, 13, 3.4);
    g.fillTriangle(16, 16, 14, 20, 18, 20);
    g.generateTexture('icon-skull', 32, 32);
    g.destroy();

    // Raio (conquista).
    g = makeGraphics(scene);
    g.fillStyle(0xffffff, 1);
    g.beginPath();
    g.moveTo(18, 2);
    g.lineTo(7, 18);
    g.lineTo(14, 18);
    g.lineTo(11, 30);
    g.lineTo(25, 13);
    g.lineTo(17, 13);
    g.closePath();
    g.fillPath();
    g.generateTexture('icon-bolt', 32, 32);
    g.destroy();

    // Escudo.
    g = makeGraphics(scene);
    g.fillStyle(0xffffff, 1);
    g.beginPath();
    g.moveTo(16, 2);
    g.lineTo(28, 7);
    g.lineTo(28, 16);
    g.lineTo(16, 30);
    g.lineTo(4, 16);
    g.lineTo(4, 7);
    g.closePath();
    g.fillPath();
    g.fillStyle(0x000000, 0.3);
    g.fillTriangle(16, 6, 24, 10, 16, 26);
    g.generateTexture('icon-shield', 32, 32);
    g.destroy();

    // Coroa.
    g = makeGraphics(scene);
    g.fillStyle(0xffffff, 1);
    g.beginPath();
    g.moveTo(4, 26);
    g.lineTo(4, 10);
    g.lineTo(11, 17);
    g.lineTo(16, 5);
    g.lineTo(21, 17);
    g.lineTo(28, 10);
    g.lineTo(28, 26);
    g.closePath();
    g.fillPath();
    g.generateTexture('icon-crown', 32, 32);
    g.destroy();

    // Pausa.
    g = makeGraphics(scene);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(4, 2, 8, 24, 3);
    g.fillRoundedRect(16, 2, 8, 24, 3);
    g.generateTexture('icon-pause', 28, 28);
    g.destroy();

    // Engrenagem (simplificada).
    g = makeGraphics(scene);
    g.fillStyle(0xffffff, 1);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      g.save();
      g.translateCanvas(16 + Math.cos(a) * 11, 16 + Math.sin(a) * 11);
      g.rotateCanvas(a);
      g.fillRoundedRect(-3.4, -3.4, 6.8, 6.8, 1.5);
      g.restore();
    }
    g.fillCircle(16, 16, 10);
    g.fillStyle(0x000000, 1);
    g.fillCircle(16, 16, 4.4);
    g.generateTexture('icon-gear', 32, 32);
    g.destroy();
  },
};
