'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { PERFIL_ROTULO } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Perfil } from '@/lib/auth/types';
import { createMemberAction, deactivateMemberAction, resetPinAction, type ActionResult } from '@/modules/equipe/equipe.actions';
import type { MemberSummary } from '@/modules/equipe/equipe.repo';
import { canManageTarget } from '@/modules/equipe/equipe.rules';

type Erros = Record<string, string[] | undefined>;
const erroDe = (r: ActionResult<unknown>) => (r.ok ? '' : r.code === 'VALIDACAO' ? 'Revise os campos destacados.' : r.message);

function Alerta({ texto }: { texto: string }) {
  return texto ? (
    <p role="alert" className="rounded-md border border-perigo/30 bg-perigo/5 p-3 text-sm font-medium text-perigo">
      {texto}
    </p>
  ) : null;
}

/** Equipe mínima: listar, cadastrar, redefinir PIN e desativar. Toda decisão é revalidada pela action no servidor. */
export function EquipeForm({ membros, ator, meuId, podeLideranca }: { membros: MemberSummary[]; ator: Perfil; meuId: string; podeLideranca: boolean }) {
  const [aviso, setAviso] = useState('');
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-tinta">Equipe</h1>
      <p role="status" className="empty:hidden rounded-md bg-agua/10 p-3 text-sm font-medium text-tinta">
        {aviso}
      </p>
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
        <section aria-labelledby="membros-titulo" className="min-w-0">
          <h2 id="membros-titulo" className="mb-3 text-lg font-bold">
            Membros
          </h2>
          <ul className="divide-y divide-linha rounded-lg border border-linha bg-white">
            {membros.map((m) => (
              <Linha key={m.id} m={m} voce={m.id === meuId} gerenciavel={m.ativo && canManageTarget(ator, m.perfil)} onAviso={setAviso} />
            ))}
          </ul>
        </section>
        <NovoMembro podeLideranca={podeLideranca} onAviso={setAviso} />
      </div>
    </div>
  );
}

function NovoMembro({ podeLideranca, onAviso }: { podeLideranca: boolean; onAviso: (t: string) => void }) {
  const router = useRouter();
  const perfis: Perfil[] = podeLideranca ? ['dono', 'gerente', 'recepcao', 'lavador'] : ['recepcao', 'lavador'];
  const [perfil, setPerfil] = useState<Perfil>('recepcao');
  const [erros, setErros] = useState<Erros>({});
  const [erro, setErro] = useState('');
  const [pendente, iniciar] = useTransition();

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const input =
      perfil === 'lavador'
        ? { perfil, nomeExibicao: f.nomeExibicao, usuario: f.usuario, pin: f.pin }
        : { perfil, nomeExibicao: f.nomeExibicao, email: f.email, senha: f.senha };
    iniciar(async () => {
      const r = await createMemberAction(input);
      setErros(r.ok ? {} : (r.fieldErrors ?? {}));
      setErro(erroDe(r));
      if (!r.ok) return;
      form.reset();
      setPerfil('recepcao');
      onAviso(`${r.data?.nomeExibicao} cadastrado.`);
      router.refresh();
    });
  }

  const campo = (id: string, rotulo: string, props: React.ComponentProps<'input'> = {}) => (
    <Campo id={id} rotulo={rotulo} erro={erros[id]?.[0]} autoComplete="off" {...props} />
  );

  return (
    <form aria-labelledby="novo-titulo" onSubmit={enviar} noValidate className="space-y-4 rounded-lg border border-linha bg-white p-5">
      <h2 id="novo-titulo" className="text-lg font-bold">
        Novo membro
      </h2>
      <div className="space-y-1.5">
        <Label htmlFor="perfil">Perfil</Label>
        <select
          id="perfil"
          name="perfil"
          defaultValue="recepcao"
          onChange={(e) => {
            setPerfil(e.target.value as Perfil);
            setErros({});
          }}
          className="block min-h-11 w-full rounded-md border border-linha bg-white px-3 text-base"
        >
          {perfis.map((p) => (
            <option key={p} value={p}>
              {PERFIL_ROTULO[p]}
            </option>
          ))}
        </select>
      </div>
      {campo('nomeExibicao', 'Nome de exibição')}
      {perfil === 'lavador' ? (
        <>
          {campo('usuario', 'Usuário', { autoCapitalize: 'none', spellCheck: false })}
          {campo('pin', 'PIN', { inputMode: 'numeric', maxLength: 6, type: 'password', autoComplete: 'new-password' })}
        </>
      ) : (
        <>
          {campo('email', 'E-mail', { type: 'email' })}
          {campo('senha', 'Senha', { type: 'password', autoComplete: 'new-password' })}
        </>
      )}
      <Alerta texto={erro} />
      <Button type="submit" className="w-full" disabled={pendente}>
        {pendente ? 'Cadastrando…' : 'Cadastrar membro'}
      </Button>
    </form>
  );
}

function Linha({ m, voce, gerenciavel, onAviso }: { m: MemberSummary; voce: boolean; gerenciavel: boolean; onAviso: (t: string) => void }) {
  const router = useRouter();
  const [modo, setModo] = useState<'pin' | 'desativar' | null>(null);
  const [erro, setErro] = useState('');
  const [erroPin, setErroPin] = useState<string>();
  const [pendente, iniciar] = useTransition();
  const voltarPara = useRef<HTMLButtonElement | null>(null);
  const botoes = useRef<Record<string, HTMLButtonElement | null>>({});

  // ao cancelar, o foco volta ao botão que abriu a confirmação
  useEffect(() => {
    if (modo === null) voltarPara.current?.focus();
    voltarPara.current = null;
  }, [modo]);

  function abrir(novo: 'pin' | 'desativar') {
    setErro('');
    setErroPin(undefined);
    setModo(novo);
  }
  function cancelar() {
    voltarPara.current = botoes.current[modo!] ?? null;
    setModo(null);
  }

  function desativar() {
    iniciar(async () => {
      const r = await deactivateMemberAction({ memberId: m.id });
      setErro(erroDe(r));
      if (!r.ok) return;
      setModo(null);
      onAviso(`${m.nomeExibicao} desativado. A sessão foi encerrada.`);
      router.refresh();
    });
  }

  function salvarPin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pin = String(new FormData(e.currentTarget).get('pin') ?? ''); // string: preserva zero inicial
    iniciar(async () => {
      const r = await resetPinAction({ memberId: m.id, pin });
      setErroPin(r.ok ? undefined : r.fieldErrors?.pin?.[0]);
      setErro(r.ok || r.fieldErrors?.pin ? '' : erroDe(r));
      if (!r.ok) return;
      setModo(null);
      onAviso(`PIN redefinido. ${m.nomeExibicao} precisa entrar de novo com o PIN novo.`);
    });
  }

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {m.nomeExibicao}
            {voce && <span className="font-normal text-suave"> (você)</span>}
          </p>
          <p className="text-sm text-suave">
            {PERFIL_ROTULO[m.perfil]}
            {!m.ativo && <span className="ml-2 rounded bg-tinta/10 px-1.5 py-0.5 font-semibold text-tinta">Inativo</span>}
          </p>
        </div>
        {gerenciavel && modo === null && (
          <div className="flex flex-wrap gap-2">
            {m.perfil === 'lavador' && (
              <Button variante="secundario" ref={(el) => void (botoes.current.pin = el)} onClick={() => abrir('pin')}>
                Redefinir PIN
              </Button>
            )}
            <Button variante="secundario" ref={(el) => void (botoes.current.desativar = el)} onClick={() => abrir('desativar')}>
              Desativar
            </Button>
          </div>
        )}
      </div>

      {modo === 'desativar' && (
        <div className="space-y-3 rounded-md border border-perigo/40 bg-perigo/5 p-3">
          <p className="text-sm font-medium">
            Desativar {m.nomeExibicao}? A pessoa perde o acesso imediatamente, inclusive em aparelhos já conectados.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variante="perigo" autoFocus disabled={pendente} onClick={desativar}>
              {pendente ? 'Desativando…' : 'Confirmar desativação'}
            </Button>
            <Button variante="secundario" disabled={pendente} onClick={cancelar}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {modo === 'pin' && (
        <form onSubmit={salvarPin} noValidate className="space-y-3 rounded-md border border-linha bg-enxague p-3">
          <Campo id={`pin-${m.id}`} name="pin" rotulo="Novo PIN" inputMode="numeric" maxLength={6} type="password" autoComplete="new-password" autoFocus erro={erroPin} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pendente}>
              {pendente ? 'Salvando…' : 'Salvar PIN'}
            </Button>
            <Button type="button" variante="secundario" disabled={pendente} onClick={cancelar}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
      <Alerta texto={erro} />
    </li>
  );
}
