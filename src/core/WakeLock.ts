/**
 * WakeLock.ts — Mantém a tela do celular acesa enquanto o jogo estiver aberto
 * (menu, partida, tela de espera de oponente, etc.). O sistema operacional
 * revoga o lock quando a aba/app vai para segundo plano ou por conta própria
 * (ex.: economia de bateria); por isso reconquistamos sempre que a página
 * volta a ficar visível e sempre que o próprio navegador libera o lock.
 */

let sentinel: WakeLockSentinel | null = null;
let started = false;

async function acquire(): Promise<void> {
  if (sentinel || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
      // O navegador pode revogar o lock por motivos próprios (não só troca de
      // aba); se ainda estivermos visíveis, tenta readquirir imediatamente.
      if (started) void acquire();
    });
  } catch {
    // Sem permissão de ativação recente ou API indisponível — silenciosamente ignorado.
    sentinel = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && started) void acquire();
});

export const WakeLock = {
  /** Chame uma única vez, ao iniciar o jogo. */
  start(): void {
    if (started) return;
    started = true;
    void acquire();
  },
};
