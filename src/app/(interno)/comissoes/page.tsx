import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ComissoesView } from '@/components/comissoes-view';
import { contextoOuNull } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { caixaDoDia } from '@/modules/caixa/caixa.repo';
import { dataDoCaixa } from '@/modules/caixa/caixa.rules';
import { acertosDoMembro, listarValesPendentes, pendentesPorMembro } from '@/modules/comissoes/comissoes.repo';
import { listMembers } from '@/modules/equipe/equipe.repo';

export const metadata = { title: 'Comissões | LavaOS' };

export default async function ComissoesPage() {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  if (ctx.perfil === 'lavador') redirect('/lavador'); // na página também: o layout renderiza em paralelo e não segura a saída da página
  if (!can(ctx.perfil, 'comissoes:gerenciar')) {
    return (
      <section>
        <h1 className="text-2xl font-bold text-tinta">Acesso negado</h1>
        <p className="mt-2 text-suave">Seu perfil não gerencia comissões. Fale com o dono ou o gerente do lava jato.</p>
      </section>
    );
  }
  const agora = new Date();
  const hoje = dataDoCaixa(agora);
  const [pendentes, valesPendentes, equipe, caixa] = await Promise.all([pendentesPorMembro(ctx, hoje), listarValesPendentes(ctx, hoje), listMembers(ctx), caixaDoDia(ctx, agora)]);
  const historicos = await Promise.all(equipe.map((m) => acertosDoMembro(ctx, m.id)));
  const membros = equipe
    .map((m, k) => ({
      id: m.id,
      nome: m.nomeExibicao,
      conta: pendentes.find((p) => p.membroId === m.id) ?? null,
      vales: valesPendentes.filter((v) => v.membroId === m.id),
      acertos: historicos[k],
    }))
    .filter((m) => m.conta || m.acertos.length); // desativado com pendência continua aparecendo
  return <ComissoesView hoje={hoje} caixaAberto={caixa?.status === 'aberto'} membros={membros} ativos={equipe.filter((m) => m.ativo).map((m) => ({ id: m.id, nome: m.nomeExibicao }))} />;
}
