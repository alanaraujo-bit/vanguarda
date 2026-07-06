/**
 * AuthScene.ts — Tela mínima de login/registro do modo online (Fase 0).
 * window.prompt() como entrada de texto é um placeholder deliberado — o
 * mesmo padrão já usado em SettingsScene.changeName(); um input HTML/DOM
 * decente fica para uma passada de polish depois que o netcode estiver
 * provado ponta a ponta.
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONT, GAME_HEIGHT, GAME_WIDTH } from '../../shared/constants';
import { ApiError } from '../net/ApiClient';
import { SessionManager } from '../net/SessionManager';
import { NetworkController } from '../net/NetworkController';
import { UiButton, drawPanel, makeText } from '../ui/widgets';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid-credentials':
        return 'Email ou senha incorretos.';
      case 'email-in-use':
        return 'Esse email já tem conta.';
      case 'display-name-in-use':
        return 'Esse nome já está em uso.';
      case 'validation-error':
        return 'Dados inválidos — confira email, senha (mín. 8) e nome (3-20).';
      default:
        return 'Erro de conexão. Tente novamente.';
    }
  }
  return 'Erro de conexão. Tente novamente.';
}

export class AuthScene extends Phaser.Scene {
  private content!: Phaser.GameObjects.Container;
  private status!: Phaser.GameObjects.Text;
  private busy = false;

  constructor() {
    super('Auth');
  }

  create(): void {
    this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'arena').setAlpha(0.3);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, COLORS.bgDeep, 0.68);

    new UiButton(this, 74, 30, '← MENU', {
      width: 108,
      height: 38,
      fontSize: 14,
      variant: 'ghost',
      onClick: () => this.scene.start('Menu'),
    });
    makeText(this, GAME_WIDTH / 2, 78, 'MODO ONLINE', 26).setOrigin(0.5).setLetterSpacing(2);

    this.status = this.add
      .text(GAME_WIDTH / 2, 150, '', {
        fontFamily: FONT,
        fontSize: '16px',
        color: CSS.textDim,
        wordWrap: { width: GAME_WIDTH - 120 },
        align: 'center',
      })
      .setOrigin(0.5);

    this.content = this.add.container(0, 0);
    this.render();
    this.cameras.main.fadeIn(250, 5, 7, 15);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Menu'));
  }

  private render(): void {
    this.content.removeAll(true);
    const profile = SessionManager.profile;
    const y0 = 300;

    if (SessionManager.isAuthenticated && profile) {
      const g = this.add.graphics();
      drawPanel(g, GAME_WIDTH / 2 - 260, y0, 520, 250, { radius: 20 });
      this.content.add(g);
      this.content.add(makeText(this, GAME_WIDTH / 2, y0 + 44, profile.displayName, 26).setOrigin(0.5));
      this.content.add(
        makeText(
          this,
          GAME_WIDTH / 2,
          y0 + 84,
          `${profile.trophies} troféus · ${profile.wins}V ${profile.losses}D ${profile.draws}E`,
          16,
          CSS.gold
        ).setOrigin(0.5)
      );
      this.content.add(
        new UiButton(this, GAME_WIDTH / 2, y0 + 138, 'JOGAR ONLINE (BETA)', {
          width: 300,
          variant: 'gold',
          onClick: () => this.promptPlayOnline(),
        })
      );
      this.content.add(
        new UiButton(this, GAME_WIDTH / 2, y0 + 208, 'SAIR DA CONTA', {
          width: 300,
          variant: 'danger',
          onClick: () => this.handle(async () => {
            await SessionManager.logout();
            this.render();
            this.setStatus('Você saiu da conta.');
          }),
        })
      );
      return;
    }

    this.content.add(
      new UiButton(this, GAME_WIDTH / 2, y0, 'ENTRAR', {
        width: 340,
        onClick: () => this.promptLogin(),
      })
    );
    this.content.add(
      new UiButton(this, GAME_WIDTH / 2, y0 + 76, 'CRIAR CONTA', {
        width: 340,
        variant: 'ghost',
        onClick: () => this.promptRegister(),
      })
    );
  }

  private promptLogin(): void {
    const email = window.prompt('Email:');
    if (!email) return;
    const password = window.prompt('Senha:');
    if (!password) return;
    this.handle(async () => {
      await SessionManager.login(email.trim(), password);
      this.render();
      this.setStatus('Login efetuado!');
    });
  }

  private promptRegister(): void {
    const displayName = window.prompt('Nome de comandante (3-20 caracteres):');
    if (!displayName) return;
    const email = window.prompt('Email:');
    if (!email) return;
    const password = window.prompt('Senha (mínimo 8 caracteres):');
    if (!password) return;
    this.handle(async () => {
      await SessionManager.register(email.trim(), password, displayName.trim());
      this.render();
      this.setStatus('Conta criada!');
    });
  }

  /** Fase 0: pareamento manual por código — os dois jogadores combinam o mesmo código. */
  private promptPlayOnline(): void {
    const roomCode = window.prompt('Código da sala (combine com seu oponente):')?.trim();
    if (!roomCode) return;
    const token = SessionManager.getAccessToken();
    if (!token) {
      this.setStatus('Sessão expirada — entre de novo.', true);
      return;
    }

    const network = new NetworkController(token);
    this.setStatus(`Aguardando oponente na sala "${roomCode}"...`);
    network
      .joinRoom(roomCode)
      .then((info) => {
        this.scene.start('Game', {
          mode: 'online',
          difficulty: 'normal',
          online: { startEpochMs: info.startEpochMs, opponentName: info.opponentName, network },
        });
      })
      .catch(() => this.setStatus('Falha ao conectar à partida.', true));
  }

  private setStatus(text: string, isError = false): void {
    this.status.setText(text).setColor(isError ? CSS.danger : CSS.textDim);
  }

  private async handle(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.setStatus('Conectando...');
    try {
      await action();
    } catch (err) {
      this.setStatus(errorMessage(err), true);
    } finally {
      this.busy = false;
    }
  }
}
