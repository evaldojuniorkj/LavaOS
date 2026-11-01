import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { FilaBoard } from '@/components/fila-board';
import { contextoOuNull } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { listarServicosComPrecos } from '@/modules/catalogo/catalogo.repo';
import { listarEntreguesHoje, listarFila } from '@/modules/ordens/ordens.repo';
import { veValores } from '@/modules/ordens/ordens.views';

export const metadata = { title: 'Fila | LavaOS' };

export default async function FilaPage() {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  if (ctx.perfil === 'lavador') redirect('/lavador'); // na página também: o layout renderiza em paralelo e não segura a saída da página
  if (!can(ctx.perfil, 'fila:ver')) {
    return (
      <section>
        <h1 className="text-2xl font-bold text-tinta">Acesso negado</h1>
        <p className="mt-2 text-suave">Seu perfil não vê a fila. Fale com o dono ou o gerente do lava jato.</p>
      </section>
    );
  }
  // botões são só conveniência: cada action confere a permissão de novo no servidor
  const pode = {
    assumir: can(ctx.perfil, 'os:assumir'),
    atribuir: can(ctx.perfil, 'os:atribuir'),
    corrigir: can(ctx.perfil, 'os:corrigir'),
    entregar: can(ctx.perfil, 'os:entregar'),
    cancelar: can(ctx.perfil, 'os:cancelar'),
    ajustarValor: can(ctx.perfil, 'os:ajustar_valor'),
    verValores: veValores(ctx.perfil),
    receber: can(ctx.perfil, 'caixa:operar'),
    reabrir: can(ctx.perfil, 'os:reabrir'),
  };
  const [fila, entregues, catalogo] = await Promise.all([listarFila(ctx), listarEntreguesHoje(ctx), pode.corrigir ? listarServicosComPrecos(ctx) : []]);
  // só nome e id para o editor de itens: o servidor recusa o que não tem preço no porte da OS
  const servicos = catalogo.filter((s) => s.ativo).map((s) => ({ id: s.id, nome: s.nome }));
  return <FilaBoard inicial={fila} entreguesInicial={entregues} pode={pode} meuId={ctx.memberId} servicos={servicos} />;
}
