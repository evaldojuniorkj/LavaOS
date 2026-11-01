import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { DespesasView } from '@/components/despesas-view';
import { contextoOuNull } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { caixaDoDia } from '@/modules/caixa/caixa.repo';
import { dataDoCaixa } from '@/modules/caixa/caixa.rules';
import { contasAPagar, listarCategorias, listarDespesas } from '@/modules/despesas/despesas.repo';

export const metadata = { title: 'Despesas | LavaOS' };

export default async function DespesasPage() {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  if (ctx.perfil === 'lavador') redirect('/lavador'); // na página também: o layout renderiza em paralelo e não segura a saída da página
  if (!can(ctx.perfil, 'despesas:gerenciar')) {
    return (
      <section>
        <h1 className="text-2xl font-bold text-tinta">Acesso negado</h1>
        <p className="mt-2 text-suave">Seu perfil não gerencia despesas. Fale com o dono ou o gerente do lava jato.</p>
      </section>
    );
  }
  const agora = new Date();
  const hoje = dataDoCaixa(agora);
  const [ano, mes] = hoje.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10); // dia 0 do mês seguinte = último deste
  const [despesas, contas, categorias, caixa] = await Promise.all([
    listarDespesas(ctx, { de: `${hoje.slice(0, 7)}-01`, ate: ultimoDia }),
    contasAPagar(ctx, agora),
    listarCategorias(ctx),
    caixaDoDia(ctx, agora),
  ]);
  return <DespesasView hoje={hoje} despesas={despesas} contas={contas} categorias={categorias} caixaAberto={caixa?.status === 'aberto'} />;
}
