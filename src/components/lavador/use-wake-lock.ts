'use client';

import { useEffect } from 'react';

/** Mantém a tela acesa enquanto `ativo`; o navegador solta o lock ao esconder a aba, então pede de novo ao voltar. Sem a API, ignora. */
export function useWakeLock(ativo: boolean): void {
  useEffect(() => {
    if (!ativo || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let vivo = true;
    const pedir = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then(
        (l) => (vivo ? (lock = l) : void l.release().catch(() => {})),
        () => {}, // recusado (bateria fraca, permissão): a fila segue funcionando
      );
    };
    pedir();
    document.addEventListener('visibilitychange', pedir);
    return () => {
      vivo = false;
      document.removeEventListener('visibilitychange', pedir);
      lock?.release().catch(() => {});
    };
  }, [ativo]);
}
