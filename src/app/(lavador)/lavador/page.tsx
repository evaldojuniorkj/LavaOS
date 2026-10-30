import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { FilaLavador } from '@/components/lavador/cartao-os';
import { contextoOuNull } from '@/lib/auth/context';
import { listarFila } from '@/modules/ordens/ordens.repo';

export const metadata = { title: 'Fila | LavaOS' };

export default async function LavadorPage() {
  const ctx = await contextoOuNull(await headers());
  if (!ctx) redirect('/login?motivo=sessao');
  if (ctx.perfil !== 'lavador') redirect('/fila');
  // listarFila devolve a visão do perfil: para o lavador, sem nenhum valor, telefone ou token
  return <FilaLavador inicial={await listarFila(ctx)} meuId={ctx.memberId} />;
}
