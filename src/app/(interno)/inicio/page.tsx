import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { contextoOuNull } from '@/lib/auth/context';

export const metadata = { title: 'Início | LavaOS' };

export default async function InicioPage() {
  if (!(await contextoOuNull(await headers()))) redirect('/login?motivo=sessao');
  return (
    <section className="max-w-prose">
      <h1 className="text-2xl font-bold text-tinta">Início</h1>
      <p className="mt-4 border-l-4 border-agua pl-4 text-lg text-tinta">Fundação pronta; operação em preparação</p>
      <p className="mt-2 pl-5 text-suave">Fila, ordens de serviço e caixa chegam nas próximas etapas.</p>
    </section>
  );
}
