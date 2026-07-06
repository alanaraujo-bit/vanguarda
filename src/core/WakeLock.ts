/**
 * WakeLock.ts — Mantém a tela do celular acesa durante uma partida.
 * O sistema operacional revoga o lock automaticamente quando a aba/app
 * vai para segundo plano; por isso reconquistamos assim que a página
 * volta a ficar visível, enquanto ainda estivermos "em partida".
 */

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

async function acquire(): Promise<void> {
  if (!wanted || sentinel || !('wakeLock' in navigator)) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    // Sem permissão de ativação recente ou API indisponível — silenciosamente ignorado.
    sentinel = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void acquire();
});

export const WakeLock = {
  /** Chame ao entrar em uma partida (treino, versus, sobrevivência...). */
  enable(): void {
    if (wanted) return;
    wanted = true;
    void acquire();
  },
  /** Chame ao sair da partida (volta ao menu). */
  disable(): void {
    wanted = false;
    void sentinel?.release();
    sentinel = null;
  },
};
