/**
 * AuthScene.ts — Login/registro do modo online e entrada em partida por
 * código de sala. Um só painel, com alternância ENTRAR/CRIAR CONTA e campos
 * de verdade (UiTextInput, DOM Element do Phaser) — sem window.prompt().
 */
import Phaser from 'phaser';
import { COLORS, CSS, FONT, GAME_HEIGHT, GAME_WIDTH } from '../../shared/constants';
import { ApiError } from '../net/ApiClient';
import { SessionManager } from '../net/SessionManager';
import { NetworkController } from '../net/NetworkController';
import { rankForTrophies } from '../../shared/ranks';
import { UiButton, UiTextInput, drawPanel, makeText } from '../ui/widgets';
import type { PublicProfile } from '../../shared/netProtocol';

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

type Mode = 'login' | 'register';

export class AuthScene extends Phaser.Scene {
  private content!: Phaser.GameObjects.Container;
  private status!: Phaser.GameObjects.Text;
  private busy = false;
  private mode: Mode = 'login';
  private showRoomInput = false;

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
    this.mode = 'login';
    this.showRoomInput = false;
    this.render();
    this.cameras.main.fadeIn(250, 5, 7, 15);
    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('Menu'));
  }

  private render(): void {
    this.content.removeAll(true);
    const profile = SessionManager.profile;
    const y0 = 280;

    if (SessionManager.isAuthenticated && profile) {
      this.renderLoggedIn(profile, y0);
    } else {
      this.renderForm(y0);
    }
  }

  /* ------------------------------ Logado -------------------------------- */

  private renderLoggedIn(profile: PublicProfile, y0: number): void {
    const rank = rankForTrophies(profile.trophies);
    const panelH = this.showRoomInput ? 300 : 260;
    const g = this.add.graphics();
    drawPanel(g, GAME_WIDTH / 2 - 260, y0, 520, panelH, { radius: 20 });
    this.content.add(g);
    this.content.add(makeText(this, GAME_WIDTH / 2, y0 + 40, profile.displayName, 26).setOrigin(0.5));
    this.content.add(
      makeText(this, GAME_WIDTH / 2, y0 + 74, `${rank.name} · ${profile.trophies} troféus`, 16, CSS.gold).setOrigin(
        0.5
      )
    );
    this.content.add(
      makeText(
        this,
        GAME_WIDTH / 2,
        y0 + 100,
        `${profile.wins}V ${profile.losses}D ${profile.draws}E`,
        14,
        CSS.textDim
      ).setOrigin(0.5)
    );

    if (this.showRoomInput) {
      const roomInput = new UiTextInput(this, GAME_WIDTH / 2, y0 + 152, {
        width: 300,
        height: 52,
        placeholder: 'Código da sala',
        maxLength: 24,
        onEnter: () => this.submitRoomCode(roomInput.value),
      });
      this.content.add(roomInput);
      this.content.add(
        new UiButton(this, GAME_WIDTH / 2, y0 + 218, 'ENTRAR NA PARTIDA', {
          width: 300,
          variant: 'gold',
          onClick: () => this.submitRoomCode(roomInput.value),
        })
      );
      roomInput.focusInput();
    } else {
      this.content.add(
        new UiButton(this, GAME_WIDTH / 2, y0 + 148, 'JOGAR ONLINE (BETA)', {
          width: 300,
          variant: 'gold',
          onClick: () => {
            this.showRoomInput = true;
            this.render();
          },
        })
      );
      this.content.add(
        new UiButton(this, GAME_WIDTH / 2, y0 + 216, 'SAIR DA CONTA', {
          width: 300,
          variant: 'danger',
          onClick: () =>
            this.handle(async () => {
              await SessionManager.logout();
              this.showRoomInput = false;
              this.render();
              this.setStatus('Você saiu da conta.');
            }),
        })
      );
    }
  }

  private submitRoomCode(raw: string): void {
    const roomCode = raw.trim();
    if (!roomCode) {
      this.setStatus('Digite o código da sala.', true);
      return;
    }
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

  /* -------------------------- Login / registro ---------------------------- */

  private renderForm(y0: number): void {
    const isRegister = this.mode === 'register';
    const panelH = isRegister ? 350 : 280;
    const g = this.add.graphics();
    drawPanel(g, GAME_WIDTH / 2 - 260, y0, 520, panelH, { radius: 20 });
    this.content.add(g);

    let fieldY = y0 + 40;
    let nameInput: UiTextInput | null = null;
    if (isRegister) {
      nameInput = new UiTextInput(this, GAME_WIDTH / 2, fieldY, {
        width: 440,
        height: 52,
        placeholder: 'Nome de comandante (3-20)',
        maxLength: 20,
      });
      this.content.add(nameInput);
      fieldY += 72;
    }

    const emailInput = new UiTextInput(this, GAME_WIDTH / 2, fieldY, {
      width: 440,
      height: 52,
      placeholder: 'Email',
      type: 'email',
    });
    this.content.add(emailInput);
    fieldY += 72;

    const passInput = new UiTextInput(this, GAME_WIDTH / 2, fieldY, {
      width: 440,
      height: 52,
      placeholder: 'Senha (mín. 8 caracteres)',
      type: 'password',
      onEnter: () => submit(),
    });
    this.content.add(passInput);
    fieldY += 76;

    const submit = (): void => {
      const email = emailInput.value.trim();
      const password = passInput.value;
      if (!email || !password) {
        this.setStatus('Preencha email e senha.', true);
        return;
      }
      if (isRegister) {
        const displayName = nameInput!.value.trim();
        if (!displayName) {
          this.setStatus('Escolha um nome de comandante.', true);
          return;
        }
        this.handle(async () => {
          await SessionManager.register(email, password, displayName);
          this.render();
          this.setStatus('Conta criada!');
        });
      } else {
        this.handle(async () => {
          await SessionManager.login(email, password);
          this.render();
          this.setStatus('Login efetuado!');
        });
      }
    };

    this.content.add(
      new UiButton(this, GAME_WIDTH / 2, fieldY, isRegister ? 'CRIAR CONTA' : 'ENTRAR', {
        width: 300,
        onClick: submit,
      })
    );
    fieldY += 60;

    this.content.add(
      makeText(
        this,
        GAME_WIDTH / 2,
        fieldY,
        isRegister ? 'Já tem conta? Entrar' : 'Não tem conta? Criar',
        15,
        CSS.textDim,
        'normal'
      )
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerup', () => {
          this.mode = isRegister ? 'login' : 'register';
          this.render();
        })
    );

    (isRegister ? nameInput! : emailInput).focusInput();
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
