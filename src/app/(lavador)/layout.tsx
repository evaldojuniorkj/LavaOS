import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { BarraInferior } from '@/components/lavador/barra-inferior';
import { InstalarApp } from '@/components/lavador/instalar-app';
import { Sair } from '@/components/lavador/sair';
import { contextoOuNull } from '@/lib/auth/context';
import { nomeLavaJato } from '@/modules/equipe/equipe.repo';

/** App do lavador (PWA, uma mão, ao sol): sem menu de topo, só a barra inferior. Cada página também se protege. */
export default async function LavadorLayout({ children }: { children: React.ReactNode }) {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  if (ctx.perfil !== 'lavador') redirect('/fila'); // só UX: as telas internas são as do balcão
  return (
    <div className="min-h-dvh bg-enxague text-base">
      <header className="sticky top-0 z-20 bg-tinta pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto flex max-w-xl items-center gap-2 px-4 py-1.5">
          <p className="min-w-0 flex-1 truncate text-lg font-bold">{await nomeLavaJato(ctx)}</p>
          <InstalarApp />
          <Sair />
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">{children}</main>
      <BarraInferior />
    </div>
  );
}
