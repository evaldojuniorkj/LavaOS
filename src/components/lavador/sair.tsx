'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { authClient } from '@/lib/auth/client';

export function Sair() {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);
  return (
    <button
      type="button"
      disabled={saindo}
      onClick={async () => {
        setSaindo(true);
        await authClient.signOut().catch(() => {}); // sem sessão no servidor o resultado é o mesmo: voltar ao login
        router.replace('/login');
      }}
      className="min-h-12 min-w-12 shrink-0 touch-manipulation rounded-md px-3 text-base font-semibold text-white/80 disabled:opacity-60"
    >
      {saindo ? 'Saindo…' : 'Sair'}
    </button>
  );
}
