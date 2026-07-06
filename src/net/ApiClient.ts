/**
 * ApiClient.ts — Cliente HTTP fino para a API REST do servidor (auth).
 * Sem estado próprio: SessionManager decide o que fazer com as respostas.
 */
import type { AuthResponse, LeaderboardResponse, LeaderboardSort, PublicProfile } from '../../shared/netProtocol';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string
  ) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'unknown-error' }));
    throw new ApiError(res.status, (data as { error?: string }).error ?? 'unknown-error');
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const ApiClient = {
  register(email: string, password: string, displayName: string, localXp: number): Promise<AuthResponse> {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName, localXp }),
    });
  },
  login(email: string, password: string): Promise<AuthResponse> {
    return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  },
  refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    return request('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) });
  },
  logout(refreshToken: string): Promise<void> {
    return request('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) });
  },
  me(accessToken: string): Promise<{ profile: PublicProfile }> {
    return request('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } });
  },
  leaderboard(sort: LeaderboardSort, accessToken?: string | null): Promise<LeaderboardResponse> {
    return request(`/leaderboard?sort=${sort}&limit=50`, {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
    });
  },
  reportXp(accessToken: string, delta: number): Promise<{ xp: number }> {
    return request('/profile/xp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ delta }),
    });
  },
};
