'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** SSE do link público: recarrega a página (servidor) em `ready` e a cada evento. O token vem da URL, não de props. */
export function AoVivo() {
  const router = useRouter();
  const pathname = usePathname();
  const [reconectando, setReconectando] = useState(false);

  useEffect(() => {
    let es: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nova: ReturnType<typeof setTimeout> | undefined;
    const recarregar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 150);
    };
    const conectar = () => {
      const atual = new EventSource(`/api${pathname}/eventos`);
      es = atual;
      atual.addEventListener('ready', () => {
        setReconectando(false);
        recarregar();
      });
      atual.addEventListener('message', recarregar);
      atual.onerror = () => {
        setReconectando(true);
        if (atual.readyState !== EventSource.CLOSED) return; // erro de rede: o navegador tenta de novo sozinho
        // recusado (expirou ou limite): a página decide; expirada vira a genérica e este componente sai da tela
        recarregar();
        nova = setTimeout(conectar, 30_000);
      };
    };
    conectar();
    return () => {
      clearTimeout(timer);
      clearTimeout(nova);
      es?.close();
    };
  }, [router, pathname]);

  return (
    <p role="status" className="text-sm text-suave">
      {reconectando ? 'Reconectando…' : 'Esta página se atualiza sozinha.'}
    </p>
  );
}
