import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { PrimeiroAcessoForm } from '@/components/primeiro-acesso-form';
import { getServerEnv } from '@/lib/env';
import { sistemaConfigurado } from '@/modules/lava-jato/primeiro-acesso.service';

export const metadata = { title: 'Primeiro acesso | LavaOS' };

/** Rota pública (fora do proxy): sem LAVAOS_SETUP_TOKEN não existe; com lava jato cadastrado vai ao login. */
export default async function PrimeiroAcessoPage() {
  await connection(); // decide a cada requisição, nunca no build
  if (!getServerEnv().LAVAOS_SETUP_TOKEN) notFound();
  if (await sistemaConfigurado()) redirect('/login');
  return (
    <main className="flex min-h-screen items-start justify-center bg-enxague px-4 py-12 sm:items-center">
      <div className="w-full max-w-md">
        <p className="text-3xl font-extrabold tracking-tight text-tinta">
          Lava<span className="text-agua">OS</span>
        </p>
        <div className="mt-6 rounded-lg border-t-4 border-agua bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold text-tinta">Primeiro acesso</h1>
          <p className="mb-5 mt-1 text-sm text-suave">Cadastre o lava jato e a sua conta de dono. Use o código de instalação definido no servidor.</p>
          <PrimeiroAcessoForm />
        </div>
      </div>
    </main>
  );
}
