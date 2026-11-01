import { headers } from 'next/headers';
import { EquipeForm } from '@/components/equipe-form';
import { requirePermission } from '@/lib/auth/context';
import { AcessoNegadoError, can } from '@/lib/auth/permissions';
import { listMembers } from '@/modules/equipe/equipe.repo';

export const metadata = { title: 'Equipe | LavaOS' };

export default async function EquipePage() {
  let ctx;
  try {
    ctx = await requirePermission(await headers(), 'equipe:gerenciar');
  } catch (err) {
    if (!(err instanceof AcessoNegadoError)) throw err;
    // nada da equipe é lido nem serializado para quem não tem a permissão
    return (
      <section>
        <h1 className="text-2xl font-bold text-tinta">Acesso negado</h1>
        <p className="mt-2 text-suave">Seu perfil não gerencia a equipe. Fale com o dono ou o gerente do lava jato.</p>
      </section>
    );
  }
  const membros = await listMembers(ctx);
  return <EquipeForm membros={membros} ator={ctx.perfil} meuId={ctx.memberId} podeLideranca={can(ctx.perfil, 'equipe:gerenciar_lideranca')} />;
}
