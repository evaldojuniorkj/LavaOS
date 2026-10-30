'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/input';
import { primeiroAcessoAction } from '@/modules/lava-jato/primeiro-acesso.actions';

type Erros = Record<string, string[] | undefined>;

/** Assistente do primeiro acesso: o servidor valida tudo de novo (código, sistema vazio, campos). */
export function PrimeiroAcessoForm() {
  const [erros, setErros] = useState<Erros>({});
  const [erro, setErro] = useState('');
  const [pendente, iniciar] = useTransition();
  const router = useRouter();

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const input = {
      nomeLavaJato: f.nomeLavaJato,
      telefone: f.telefone,
      donoNome: f.donoNome,
      donoEmail: f.donoEmail.trim(),
      donoSenha: f.donoSenha,
      confirmacaoSenha: f.confirmacaoSenha,
      codigo: f.codigo,
    };
    iniciar(async () => {
      const r = await primeiroAcessoAction(input).catch(() => null);
      if (r?.ok) return router.push('/login?motivo=cadastro');
      setErros(r?.fieldErrors ?? {});
      setErro(!r ? 'Não foi possível concluir. Tente novamente.' : r.code === 'VALIDACAO' || r.code === 'CODIGO_INVALIDO' ? 'Revise os campos destacados.' : r.message);
    });
  }

  const campo = (id: string, rotulo: string, props: React.ComponentProps<'input'> = {}) => <Campo id={id} rotulo={rotulo} erro={erros[id]?.[0]} {...props} />;

  return (
    <form onSubmit={enviar} noValidate className="space-y-5">
      <fieldset className="space-y-4">
        <legend className="mb-1 text-base font-bold text-tinta">Lava jato</legend>
        {campo('nomeLavaJato', 'Nome do lava jato', { autoComplete: 'organization' })}
        {campo('telefone', 'Telefone (opcional)', { type: 'tel', inputMode: 'tel', autoComplete: 'tel' })}
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-1 text-base font-bold text-tinta">Você (dono)</legend>
        {campo('donoNome', 'Seu nome', { autoComplete: 'name' })}
        {campo('donoEmail', 'E-mail', { type: 'email', autoComplete: 'username', autoCapitalize: 'none', spellCheck: false })}
        {campo('donoSenha', 'Senha', { type: 'password', autoComplete: 'new-password' })}
        {campo('confirmacaoSenha', 'Confirme a senha', { type: 'password', autoComplete: 'new-password' })}
      </fieldset>
      {campo('codigo', 'Código de instalação', { type: 'password', autoComplete: 'off', autoCapitalize: 'none', spellCheck: false })}
      {erro && (
        <p role="alert" className="rounded-md border border-perigo/30 bg-perigo/5 p-3 text-sm font-medium text-perigo">
          {erro}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pendente}>
        {pendente ? 'Cadastrando…' : 'Cadastrar lava jato'}
      </Button>
    </form>
  );
}
