'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * SSE da fila: recarrega em `ready`, `resync` e a cada evento (rajadas viram uma recarga só).
 * Erro de rede: o EventSource reconecta sozinho e `reconectando` fica true. `encerrado` = perdeu o acesso.
 */
export function useEventos(onRecarregar: () => void): { reconectando: boolean } {
  const router = useRouter();
  const [reconectando, setReconectando] = useState(false);
  const ref = useRef(onRecarregar);
  useEffect(() => {
    ref.current = onRecarregar;
  });

  useEffect(() => {
    let es: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nova: ReturnType<typeof setTimeout> | undefined;
    let tentativas = 0;
    let ativo = true;
    const recarregar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ref.current(), 150);
    };
    const sair = () => {
      es?.close();
      router.replace('/login?motivo=sessao');
    };
    const conectar = () => {
      const atual = new EventSource('/api/eventos');
      es = atual;
      atual.addEventListener('ready', () => {
        tentativas = 0;
        setReconectando(false);
        recarregar();
      });
      atual.addEventListener('message', recarregar); // eventos de OS e `{tipo: 'resync'}` chegam como `data:` sem nome
      atual.addEventListener('encerrado', sair);
      atual.onerror = () => {
        setReconectando(true);
        if (atual.readyState !== EventSource.CLOSED) return; // erro de rede: o navegador tenta de novo sozinho
        // resposta não-200 fecha de vez: sonda o próprio /api/eventos (mesma autorização); 401/403 vai ao login, o resto reabre com backoff
        const sonda = new AbortController();
        fetch('/api/eventos', { signal: sonda.signal, cache: 'no-store', credentials: 'same-origin' })
          .then((r) => {
            sonda.abort(); // 200 abriria um stream a mais: só o status interessa
            return r.status === 401 || r.status === 403;
          }, () => false)
          .then((negado) => {
            if (!ativo) return;
            if (negado) return sair();
            nova = setTimeout(conectar, Math.min(30_000, 1_000 * 2 ** tentativas++));
          });
      };
    };
    conectar();
    return () => {
      ativo = false;
      clearTimeout(timer);
      clearTimeout(nova);
      es?.close();
    };
  }, [router]);

  return { reconectando };
}
