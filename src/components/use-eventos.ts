'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * SSE da fila: recarrega em `ready`, `resync` e a cada evento (rajadas viram uma recarga só).
 * O EventSource reconecta sozinho; enquanto isso `reconectando` fica true. `encerrado` = perdeu o acesso.
 */
export function useEventos(onRecarregar: () => void): { reconectando: boolean } {
  const router = useRouter();
  const [reconectando, setReconectando] = useState(false);
  const ref = useRef(onRecarregar);
  useEffect(() => {
    ref.current = onRecarregar;
  });

  useEffect(() => {
    const es = new EventSource('/api/eventos');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const recarregar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ref.current(), 150);
    };
    const pronto = () => {
      setReconectando(false);
      recarregar();
    };
    es.addEventListener('ready', pronto);
    es.addEventListener('message', recarregar); // eventos de OS e `{tipo: 'resync'}` chegam como `data:` sem nome
    es.addEventListener('encerrado', () => {
      es.close();
      router.replace('/login?motivo=sessao');
    });
    es.onerror = () => setReconectando(true);
    return () => {
      clearTimeout(timer);
      es.close();
    };
  }, [router]);

  return { reconectando };
}
