import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { CatalogoForm } from '@/components/catalogo-form';
import { contextoOuNull } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { listarPortes, listarServicosComPrecos } from '@/modules/catalogo/catalogo.repo';

export const metadata = { title: 'Catálogo | LavaOS' };

export default async function CatalogoPage() {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  if (!can(ctx.perfil, 'catalogo:gerenciar')) {
    // nada do catálogo (valores, comissões) é lido nem serializado para quem não tem a permissão
    return (
      <section>
        <h1 className="text-2xl font-bold text-tinta">Acesso negado</h1>
        <p className="mt-2 text-suave">Seu perfil não gerencia o catálogo. Fale com o dono ou o gerente do lava jato.</p>
      </section>
    );
  }
  const [portes, servicos] = await Promise.all([listarPortes(ctx), listarServicosComPrecos(ctx)]);
  return <CatalogoForm portes={portes} servicos={servicos} />;
}
