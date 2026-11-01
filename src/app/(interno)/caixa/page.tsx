import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { CaixaView } from '@/components/caixa-view';
import { contextoOuNull } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { caixaAtual } from '@/modules/caixa/caixa.repo';

export const metadata = { title: 'Caixa | LavaOS' };

export default async function CaixaPage() {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  if (ctx.perfil === 'lavador') redirect('/lavador'); // na página também: o layout renderiza em paralelo e não segura a saída da página
  if (!can(ctx.perfil, 'caixa:operar')) {
    return (
      <section>
        <h1 className="text-2xl font-bold text-tinta">Acesso negado</h1>
        <p className="mt-2 text-suave">Seu perfil não opera o caixa. Fale com o dono ou o gerente do lava jato.</p>
      </section>
    );
  }
  // botões são só conveniência: cada action confere a permissão de novo no servidor
  const pode = { estornar: can(ctx.perfil, 'caixa:estornar'), reabrir: can(ctx.perfil, 'caixa:reabrir') };
  return <CaixaView inicial={await caixaAtual(ctx)} pode={pode} />;
}
