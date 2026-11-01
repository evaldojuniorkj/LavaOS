'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/input';
import { authClient } from '@/lib/auth/client';
import { cn } from '@/lib/utils';

type Modo = 'email' | 'pin';
type Erros = Partial<Record<'email' | 'senha' | 'usuario' | 'pin', string>>;
type Org = { id: string; name: string };

const FALHA = 'Não foi possível entrar. Tente novamente.';

/** Login de staff (e-mail/senha) e do lavador (usuário/PIN). O servidor decide o acesso; aqui só se envia e se navega. */
export function LoginForm({ destino, preenchido }: { destino: string; preenchido?: { email: string; senha: string } }) {
  const [modo, setModo] = useState<Modo>('email');
  const [erros, setErros] = useState<Erros>({});
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [orgs, setOrgs] = useState<Org[] | null>(null);

  const entrar = () => window.location.assign(destino);

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? '');
    const novos: Erros = {};
    if (modo === 'email') {
      if (!v('email').trim()) novos.email = 'Informe o e-mail.';
      if (!v('senha')) novos.senha = 'Informe a senha.';
    } else {
      if (!v('usuario').trim()) novos.usuario = 'Informe o usuário.';
      // string sempre: o zero inicial faz parte do PIN
      if (!/^\d{4,6}$/.test(v('pin'))) novos.pin = 'O PIN deve ter de 4 a 6 dígitos.';
    }
    setErros(novos);
    setErro('');
    if (Object.keys(novos).length) return;
    setEnviando(true);
    try {
      if (modo === 'pin') {
        const r = await fetch('/api/auth/lavador-pin/sign-in', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ usuario: v('usuario'), pin: v('pin') }),
        });
        if (r.ok) return entrar();
        // 401/429 já vêm com a mensagem única de recuperação; não distinguimos usuário bloqueado
        const corpo = (await r.json().catch(() => null)) as { message?: string } | null;
        return setErro(r.status === 401 || r.status === 429 ? (corpo?.message ?? FALHA) : FALHA);
      }
      const { error } = await authClient.signIn.email({ email: v('email').trim(), password: v('senha') });
      if (error) {
        return setErro(error.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : error.status === 400 || error.status === 401 ? 'E-mail ou senha inválidos.' : FALHA);
      }
      // Com vários vínculos ativos o servidor não escolhe o lava jato: a pessoa escolhe abaixo.
      const sessao = await authClient.getSession();
      if (sessao.data?.session.activeOrganizationId) return entrar();
      const lista = await authClient.organization.list();
      if (!lista.data?.length) return setErro('Sua conta não tem acesso ativo a nenhum lava jato.');
      setOrgs(lista.data.map((o) => ({ id: o.id, name: o.name })));
    } catch {
      setErro(FALHA);
    } finally {
      setEnviando(false);
    }
  }

  async function escolher(organizationId: string) {
    setEnviando(true);
    setErro('');
    const { error } = await authClient.organization.setActive({ organizationId });
    if (!error) return entrar();
    setErro('Não foi possível entrar neste lava jato.');
    setEnviando(false);
  }

  if (orgs) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold">Escolha o lava jato</h2>
        <ul className="space-y-2">
          {orgs.map((o) => (
            <li key={o.id}>
              <Button variante="secundario" className="w-full justify-start" disabled={enviando} onClick={() => escolher(o.id)}>
                {o.name}
              </Button>
            </li>
          ))}
        </ul>
        {erro && (
          <p role="alert" className="text-sm font-medium text-perigo">
            {erro}
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={enviar} noValidate className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Como você entra?</legend>
        <div className="grid grid-cols-2 rounded-md border border-linha bg-enxague p-1">
          {(
            [
              ['email', 'E-mail e senha'],
              ['pin', 'Usuário e PIN'],
            ] as const
          ).map(([valor, rotulo]) => (
            <label
              key={valor}
              className={cn(
                'flex min-h-11 cursor-pointer items-center justify-center rounded px-2 text-center text-sm font-semibold has-focus-visible:outline-3 has-focus-visible:outline-sinal',
                modo === valor ? 'bg-white text-tinta shadow-sm' : 'text-suave',
              )}
            >
              <input
                type="radio"
                name="modo"
                value={valor}
                checked={modo === valor}
                onChange={() => {
                  setModo(valor);
                  setErros({});
                  setErro('');
                }}
                className="sr-only"
              />
              {rotulo}
            </label>
          ))}
        </div>
      </fieldset>

      {modo === 'email' ? (
        <>
          <Campo id="email" rotulo="E-mail" type="email" autoComplete="username" defaultValue={preenchido?.email} erro={erros.email} />
          <Campo id="senha" rotulo="Senha" type="password" autoComplete="current-password" defaultValue={preenchido?.senha} erro={erros.senha} />
        </>
      ) : (
        <>
          <Campo id="usuario" rotulo="Usuário" autoComplete="username" autoCapitalize="none" spellCheck={false} erro={erros.usuario} />
          <Campo id="pin" rotulo="PIN" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} erro={erros.pin} />
        </>
      )}

      {erro && (
        <p role="alert" className="rounded-md border border-perigo/30 bg-perigo/5 p-3 text-sm font-medium text-perigo">
          {erro}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={enviando}>
        {enviando ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  );
}
