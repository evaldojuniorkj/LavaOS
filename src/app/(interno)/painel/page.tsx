import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PainelView } from '@/components/painel-view';
import { contextoOuNull } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { carregarPainel } from '@/modules/painel/painel.repo';

export const metadata = { title: 'Painel | LavaOS' };

export default async function PainelPage() {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  if (ctx.perfil === 'lavador') redirect('/lavador'); // na página também: o layout renderiza em paralelo e não segura a saída da página
  if (!can(ctx.perfil, 'painel:ver')) {
    return (
      <section>
        <h1 className="text-2xl font-bold text-tinta">Acesso negado</h1>
        <p className="mt-2 text-suave">Seu perfil não vê o painel. Fale com o dono ou o gerente do lava jato.</p>
      </section>
    );
  }
  return <PainelView inicial={await carregarPainel(ctx)} />;
}
