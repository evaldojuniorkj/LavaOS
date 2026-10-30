import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { contextoOuNull } from '@/lib/auth/context';

// O início da operação é a fila (o lavador tem o app próprio); sem sessão continua indo ao login (não vaza para /fila).
export default async function InicioPage() {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  redirect(ctx.perfil === 'lavador' ? '/lavador' : '/fila');
}
