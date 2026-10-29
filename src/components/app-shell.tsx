'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth/client';
import type { Perfil } from '@/lib/auth/types';
import { cn } from '@/lib/utils';

export const PERFIL_ROTULO: Record<Perfil, string> = { dono: 'Dono', gerente: 'Gerente', recepcao: 'Recepção', lavador: 'Lavador' };

/** Navegação só para telas existentes; o itens Equipe e Catálogo são conveniência, a regra é do servidor. */
export function AppShell({ nome, perfil, podeEquipe, podeCatalogo, podeClientes, children }: { nome: string; perfil: Perfil; podeEquipe: boolean; podeCatalogo: boolean; podeClientes: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);
  const itens = [{ href: '/inicio', rotulo: 'Início' }, ...(podeClientes ? [{ href: '/clientes', rotulo: 'Clientes' }] : []),
    ...(podeEquipe ? [{ href: '/configuracoes/equipe', rotulo: 'Equipe' }] : []),
    ...(podeCatalogo ? [{ href: '/configuracoes/catalogo', rotulo: 'Catálogo' }] : []),
  ];

  async function sair() {
    setSaindo(true);
    await authClient.signOut().catch(() => {}); // sem sessão no servidor o resultado é o mesmo: voltar ao login
    router.replace('/login');
  }

  return (
    <div className="min-h-screen bg-enxague">
      <header className="bg-tinta text-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="text-xl font-extrabold tracking-tight">
            Lava<span className="text-sinal">OS</span>
          </span>
          <nav aria-label="Principal" className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
            {itens.map((i) => (
              <Link
                key={i.href}
                href={i.href}
                aria-current={pathname === i.href ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-md px-3 font-semibold text-white/80 hover:bg-white/10 hover:text-white',
                  'aria-[current=page]:bg-white/15 aria-[current=page]:text-white aria-[current=page]:shadow-[inset_0_-3px_0_var(--color-sinal)]',
                )}
              >
                {i.rotulo}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <p className="min-w-0 truncate text-sm text-white/80">
              <span className="font-semibold text-white">{nome}</span> ({PERFIL_ROTULO[perfil]})
            </p>
            <Button variante="secundario" className="min-h-10 shrink-0 px-3 text-sm" onClick={sair} disabled={saindo}>
              {saindo ? 'Saindo…' : 'Sair'}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
    </div>
  );
}
