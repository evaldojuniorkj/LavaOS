import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NovaOsForm } from '@/components/nova-os-form';
import { contextoOuNull } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { listarPortes, listarServicosDisponiveis } from '@/modules/catalogo/catalogo.repo';
import { listarLavadoresParaDirecionar } from '@/modules/ordens/ordens.repo';
import { veValores } from '@/modules/ordens/ordens.views';

export const metadata = { title: 'Nova OS | LavaOS' };

export default async function NovaOsPage() {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  if (ctx.perfil === 'lavador') redirect('/lavador'); // na página também: o layout renderiza em paralelo e não segura a saída da página
  if (!can(ctx.perfil, 'os:abrir')) {
    return (
      <section>
        <h1 className="text-2xl font-bold text-tinta">Acesso negado</h1>
        <p className="mt-2 text-suave">Seu perfil não abre OS. Fale com o dono ou o gerente do lava jato.</p>
      </section>
    );
  }
  const balcao = can(ctx.perfil, 'os:atribuir');
  const precos = veValores(ctx.perfil);
  const [portes, lavadores] = await Promise.all([listarPortes(ctx), balcao ? listarLavadoresParaDirecionar(ctx) : null]);
  // serviços por porte (inclui portes inativos: veículo antigo ainda pode ter um); valor só sai para quem vê R$
  const servicos = Object.fromEntries(
    await Promise.all(
      portes.map(async (p) => [p.id, (await listarServicosDisponiveis(ctx, p.id)).map((s) => (precos ? s : { id: s.id, nome: s.nome, adicional: s.adicional }))] as const),
    ),
  );
  return <NovaOsForm portes={portes} servicos={servicos} lavadores={lavadores} />;
}
