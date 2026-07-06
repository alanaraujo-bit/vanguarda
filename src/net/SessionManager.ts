/**
 * SessionManager.ts — Sessão do modo online, separada do SaveManager local
 * (perfil offline continua intocado). Access token só vive em memória;
 * refresh token e um cache do perfil ficam em localStorage para restaurar
 * a sessão sem pedir login de novo a cada abertura do jogo.
 */
import { ApiClient } from './ApiClient';
import { SaveManager } from '../core/SaveManager';
import type { LeaderboardResponse, LeaderboardSort, PublicProfile } from '../../shared/netProtocol';

const REFRESH_KEY = 'vanguarda-refresh-token';
const PROFILE_CACHE_KEY = 'vanguarda-online-profile';

class SessionManagerImpl {
  private accessToken: string | null = null;
  private _profile: PublicProfile | null = null;

  constructor() {
    const cached = localStorage.getItem(PROFILE_CACHE_KEY);
    if (cached) {
      try {
        this._profile = JSON.parse(cached) as PublicProfile;
      } catch {
        // cache corrompido — ignora, segue deslogado até novo login/restore.
      }
    }
  }

  get profile(): PublicProfile | null {
    return this._profile;
  }

  get isAuthenticated(): boolean {
    return this.accessToken !== null;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  async register(email: string, password: string, displayName: string): Promise<PublicProfile> {
    // O XP já acumulado localmente vira o XP inicial da conta nova — é a
    // "adoção" do progresso do aparelho pela conta (estilo Clash Royale).
    const res = await ApiClient.register(email, password, displayName, SaveManager.data.xp);
    this.applySession(res.accessToken, res.refreshToken, res.profile);
    return res.profile;
  }

  async login(email: string, password: string): Promise<PublicProfile> {
    const res = await ApiClient.login(email, password);
    this.applySession(res.accessToken, res.refreshToken, res.profile);
    return res.profile;
  }

  /** Tenta restaurar a sessão a partir do refresh token salvo (chamado no boot). */
  async restore(): Promise<boolean> {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return false;
    try {
      const rotated = await ApiClient.refresh(refreshToken);
      const me = await ApiClient.me(rotated.accessToken);
      this.applySession(rotated.accessToken, rotated.refreshToken, me.profile);
      return true;
    } catch {
      this.clear();
      return false;
    }
  }

  /** Ranking global — pública, mas inclui `me` se estivermos logados. */
  fetchLeaderboard(sort: LeaderboardSort): Promise<LeaderboardResponse> {
    return ApiClient.leaderboard(sort, this.accessToken);
  }

  /**
   * Reporta XP ganho em modo offline (versus IA/sobrevivência) pra conta
   * logada — best-effort, nunca deve travar o fluxo de partida. Partidas
   * online não passam por aqui: o servidor já credita sozinho.
   */
  async reportXpGain(delta: number): Promise<void> {
    if (!this.accessToken || delta <= 0) return;
    try {
      const res = await ApiClient.reportXp(this.accessToken, delta);
      if (this._profile) {
        this._profile = { ...this._profile, xp: res.xp };
        localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(this._profile));
      }
    } catch {
      // Sem rede/servidor fora do ar — o XP local já foi salvo, só a conta
      // que fica um pouco atrasada até a próxima partida reportar de novo.
    }
  }

  async logout(): Promise<void> {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (refreshToken) {
      try {
        await ApiClient.logout(refreshToken);
      } catch {
        // já pode estar revogado/expirado — segue limpando o lado do cliente.
      }
    }
    this.clear();
  }

  private applySession(accessToken: string, refreshToken: string, profile: PublicProfile): void {
    this.accessToken = accessToken;
    this._profile = profile;
    localStorage.setItem(REFRESH_KEY, refreshToken);
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
  }

  private clear(): void {
    this.accessToken = null;
    this._profile = null;
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(PROFILE_CACHE_KEY);
  }
}

export const SessionManager = new SessionManagerImpl();
