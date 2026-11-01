'use client';

import { Button } from '@/components/ui/button';

/** Rede de segurança: erro não tratado numa tela mostra isto, em vez da página de erro do Next. */
export default function Erro({ retry }: { retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-2xl font-bold text-tinta">Algo deu errado</h1>
      <p className="text-base text-suave">Confira a internet e tente de novo.</p>
      <Button onClick={() => retry()}>Tentar de novo</Button>
    </main>
  );
}
