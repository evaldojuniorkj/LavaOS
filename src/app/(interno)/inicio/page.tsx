import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { contextoOuNull } from '@/lib/auth/context';

// Início por perfil: gestão no painel, recepção na fila, lavador no app próprio; sem sessão vai ao login (não vaza para as telas).
export default async function InicioPage() {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  redirect(ctx.perfil === 'lavador' ? '/lavador' : ctx.perfil === 'recepcao' ? '/fila' : '/painel');
}
