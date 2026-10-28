import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/login-form';
import { contextoOuNull } from '@/lib/auth/context';
import { destinoPosLogin } from '@/lib/auth/route-policy';

export const metadata = { title: 'Entrar | LavaOS' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { next, motivo } = await searchParams;
  const destino = destinoPosLogin(next);
  if (await contextoOuNull(await headers())) redirect(destino);
  return (
    <main className="flex min-h-screen items-start justify-center bg-enxague px-4 py-12 sm:items-center">
      <div className="w-full max-w-sm">
        <p className="text-3xl font-extrabold tracking-tight text-tinta">
          Lava<span className="text-agua">OS</span>
        </p>
        <div className="mt-6 rounded-lg border-t-4 border-agua bg-white p-6 shadow-sm">
          <h1 className="mb-5 text-xl font-bold text-tinta">Entrar</h1>
          {motivo === 'sessao' && (
            <p className="mb-5 rounded-md bg-sinal/20 p-3 text-sm font-medium text-tinta">Sua sessão terminou ou o acesso foi removido. Entre novamente.</p>
          )}
          <LoginForm destino={destino} />
        </div>
      </div>
    </main>
  );
}
