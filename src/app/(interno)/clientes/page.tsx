import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ClientesForm } from '@/components/clientes-form';
import { contextoOuNull } from '@/lib/auth/context';
import { can } from '@/lib/auth/permissions';
import { listarPortes } from '@/modules/catalogo/catalogo.repo';
import { listarClientes, listarVeiculos } from '@/modules/clientes/clientes.repo';

export const metadata = { title: 'Clientes | LavaOS' };

export default async function ClientesPage() {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  if (!can(ctx.perfil, 'clientes:gerenciar')) {
    // nada de clientes é lido nem serializado para quem não tem a permissão (o lavador só usa o cadastro rápido da Nova OS)
    return (
      <section>
        <h1 className="text-2xl font-bold text-tinta">Acesso negado</h1>
        <p className="mt-2 text-suave">Seu perfil não gerencia clientes. Fale com o dono ou o gerente do lava jato.</p>
      </section>
    );
  }
  const [clientes, veiculos, portes] = await Promise.all([listarClientes(ctx), listarVeiculos(ctx), listarPortes(ctx)]);
  return <ClientesForm clientes={clientes} veiculos={veiculos} portes={portes} />;
}
