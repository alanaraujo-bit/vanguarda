/**
 * InstallPrompt.ts — Instalação como app (PWA).
 * Android/Chromium expõem `beforeinstallprompt`; o evento só dispara uma vez
 * e precisa ser capturado assim que o módulo carrega (antes de qualquer UI
 * existir). iOS não tem API de instalação — só Compartilhar → Tela de Início.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredEvent: BeforeInstallPromptEvent | null = null;

window.addEventListener('beforeinstallprompt', (e: Event) => {
  e.preventDefault();
  deferredEvent = e as BeforeInstallPromptEvent;
  window.dispatchEvent(new Event('vanguarda-install-available'));
});

window.addEventListener('appinstalled', () => {
  deferredEvent = null;
});

export const InstallPrompt = {
  /** Há um prompt nativo de instalação disponível agora (Android/Chromium). */
  canInstall(): boolean {
    return deferredEvent !== null;
  },

  /** Dispara o prompt nativo. @returns true se o usuário aceitou instalar. */
  async promptInstall(): Promise<boolean> {
    if (!deferredEvent) return false;
    const event = deferredEvent;
    deferredEvent = null;
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === 'accepted';
  },

  /** iPhone/iPad — inclui iPadOS 13+, que se anuncia como "MacIntel". */
  isIos(): boolean {
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  },

  /** Já rodando instalado (standalone), em qualquer plataforma. */
  isStandalone(): boolean {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  },
};
