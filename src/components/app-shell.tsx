'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { IconeCatalogo, IconeClientes, IconeEquipe, IconeFila, IconeNova, IconePainel } from '@/components/ui/icones';
import { authClient } from '@/lib/auth/client';
import type { Perfil } from '@/lib/auth/types';
import { cn } from '@/lib/utils';

export const PERFIL_ROTULO: Record<Perfil, string> = { dono: 'Dono', gerente: 'Gerente', recepcao: 'Recepção', lavador: 'Lavador' };

/**
 * Celular: barra de abas embaixo (polegar) e barra de título em cima. A partir de `lg`: menu lateral (§6 da spec).
 * Uma só `<nav>` muda de lugar por CSS, então os links não se duplicam. Só mostra telas existentes e por permissão; é conveniência, a regra é do servidor.
 */
export function AppShell({ nome, perfil, podePainel, podeFila, podeAbrirOs, podeEquipe, podeCatalogo, podeClientes, children }: { nome: string; perfil: Perfil; podePainel: boolean; podeFila: boolean; podeAbrirOs: boolean; podeEquipe: boolean; podeCatalogo: boolean; podeClientes: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);
  const itens = [
    ...(podePainel ? [{ href: '/painel', rotulo: 'Painel', icone: <IconePainel /> }] : []),
    ...(podeFila ? [{ href: '/fila', rotulo: 'Fila', icone: <IconeFila /> }] : []),
    ...(podeAbrirOs ? [{ href: '/nova-os', rotulo: 'Nova OS', icone: <IconeNova /> }] : []),
    ...(podeClientes ? [{ href: '/clientes', rotulo: 'Clientes', icone: <IconeClientes /> }] : []),
    ...(podeEquipe ? [{ href: '/configuracoes/equipe', rotulo: 'Equipe', icone: <IconeEquipe /> }] : []),
    ...(podeCatalogo ? [{ href: '/configuracoes/catalogo', rotulo: 'Catálogo', icone: <IconeCatalogo /> }] : []),
  ];

  async function sair() {
    setSaindo(true);
    await authClient.signOut().catch(() => {}); // sem sessão no servidor o resultado é o mesmo: voltar ao login
    router.replace('/login');
  }

  const marca = (
    <span className="text-xl font-extrabold tracking-tight">
      Lava<span className="text-sinal">OS</span>
    </span>
  );
  const botaoSair = (
    <button
      type="button"
      onClick={sair}
      disabled={saindo}
      className="min-h-10 shrink-0 rounded-full bg-white/12 px-4 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-60 lg:w-full lg:rounded-xl lg:min-h-11"
    >
      {saindo ? 'Saindo…' : 'Sair'}
    </button>
  );

  return (
    <div className="min-h-dvh bg-enxague lg:pl-64">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-3 focus:font-semibold focus:text-tinta focus:shadow-lg">
        Pular para o conteúdo
      </a>
      <header className="sticky top-0 z-20 bg-tinta pt-[env(safe-area-inset-top)] text-white lg:hidden">
        <div className="flex min-h-14 items-center gap-3 px-4">
          {marca}
          <p className="ml-auto min-w-0 truncate text-sm text-white/80">
            <span className="font-semibold text-white">{nome}</span> ({PERFIL_ROTULO[perfil]})
          </p>
          {botaoSair}
        </div>
      </header>

      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-tinta p-4 text-white lg:flex">
        <div className="px-3 py-3">{marca}</div>
        <div className="mt-auto space-y-3">
          <p className="truncate px-3 text-sm text-white/80">
            <span className="block font-semibold text-white">{nome}</span>({PERFIL_ROTULO[perfil]})
          </p>
          {botaoSair}
        </div>
      </aside>

      <nav
        aria-label="Principal"
        className={cn(
          'fixed inset-x-0 bottom-0 z-20 border-t border-linha/70 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur',
          'lg:inset-x-auto lg:top-20 lg:bottom-auto lg:left-0 lg:w-64 lg:border-0 lg:bg-transparent lg:px-4 lg:pb-0 lg:backdrop-blur-none',
        )}
      >
        <ul className="flex lg:flex-col lg:gap-1">
          {itens.map((i) => (
            <li key={i.href} className="min-w-0 flex-1">
              <Link
                href={i.href}
                aria-current={pathname === i.href ? 'page' : undefined}
                className={cn(
                  'group flex min-h-16 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-semibold sm:text-xs text-suave transition active:scale-95',
                  'aria-[current=page]:text-agua',
                  'lg:min-h-12 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-xl lg:px-3 lg:text-base lg:font-semibold lg:text-white/75 lg:hover:bg-white/10 lg:active:scale-100',
                  'lg:aria-[current=page]:bg-white/15 lg:aria-[current=page]:text-white',
                )}
              >
                <span className="rounded-full px-4 py-1 transition-colors group-aria-[current=page]:bg-agua/15 lg:p-0 lg:group-aria-[current=page]:bg-transparent">{i.icone}</span>
                {i.rotulo}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <main id="conteudo" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:px-8 lg:py-8 lg:pb-8">{children}</main>
    </div>
  );
}
