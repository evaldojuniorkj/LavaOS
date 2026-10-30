import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { contextoOuNull } from '@/lib/auth/context';

// O início da operação é a fila; sem sessão continua indo ao login (não vaza para /fila).
export default async function InicioPage() {
  if (!(await contextoOuNull(await headers()))) redirect('/login?motivo=sessao');
  redirect('/fila');
}
