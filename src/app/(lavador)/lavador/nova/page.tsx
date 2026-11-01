import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NovaOsForm } from '@/components/nova-os-form';
import { contextoOuNull } from '@/lib/auth/context';
import { listarPortes, listarServicosDisponiveis } from '@/modules/catalogo/catalogo.repo';

export const metadata = { title: 'Nova lavagem | LavaOS' };

/** Nova lavagem do próprio lavador: o servidor atribui a OS a ele; sem responsável no formulário e sem valores. */
export default async function NovaLavagemPage() {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  if (ctx.perfil !== 'lavador') redirect('/inicio');
  const portes = await listarPortes(ctx);
  // só id, nome e adicional: o valor nunca sai do servidor para o lavador
  const servicos = Object.fromEntries(
    await Promise.all(portes.map(async (p) => [p.id, (await listarServicosDisponiveis(ctx, p.id)).map((s) => ({ id: s.id, nome: s.nome, adicional: s.adicional }))] as const)),
  );
  return (
    <div className="[&_button]:min-h-12 [&_input:not([type=checkbox])]:min-h-12 [&_select]:min-h-12 [&_button]:touch-manipulation">
      <NovaOsForm portes={portes} servicos={servicos} lavadores={null} titulo="Nova lavagem" destino="/lavador" />
    </div>
  );
}
