/**
 * SessionManager.ts — Sessão do modo online, separada do SaveManager local
 * (perfil offline continua intocado). Access token só vive em memória;
 * refresh token e um cache do perfil ficam em localStorage para restaurar
 * a sessão sem pedir login de novo a cada abertura do jogo.
 */
import { ApiClient } from './ApiClient';
import type { PublicProfile } from '../../shared/netProtocol';

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
    const res = await ApiClient.register(email, password, displayName);
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
