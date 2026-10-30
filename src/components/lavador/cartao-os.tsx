'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Alerta } from '@/components/catalogo-form';
import { useEventos } from '@/components/use-eventos';
import { listarFilaAction, transitarOsAction } from '@/modules/ordens/ordens.actions';
import { ERROS_RECARREGAR_FILA, type StatusOs } from '@/modules/ordens/ordens.rules';
import type { OsView } from '@/modules/ordens/ordens.views';
import { cn, tempoDesde } from '@/lib/utils';
import { useVibrar } from './use-vibrar';
import { useWakeLock } from './use-wake-lock';

const STATUS: Record<StatusOs, string> = { aguardando: 'Aguardando', em_lavagem: 'Em lavagem', pronto: 'Pronto', entregue: 'Entregue', cancelada: 'Cancelada' };
const erroDe = (r: { code: string; message: string }) => (r.code === 'ACESSO_NEGADO' ? 'Seu perfil não pode fazer isso.' : r.message);
const COR: Partial<Record<StatusOs, string>> = { aguardando: 'bg-sinal text-tinta', em_lavagem: 'bg-agua text-white', pronto: 'bg-tinta text-white' };

/** Único botão do cartão, pelo estado; OS de outro lavador não oferece nada (o servidor recusa de qualquer jeito). */
function acaoDe(os: OsView, meuId: string): { rotulo: string; para: StatusOs } | null {
  const meu = os.responsavel?.id === meuId;
  if (os.status === 'aguardando' && !os.responsavel) return { rotulo: 'Pegar', para: 'em_lavagem' };
  if (os.status === 'aguardando' && meu) return { rotulo: 'Iniciar lavagem', para: 'em_lavagem' };
  if (os.status === 'em_lavagem' && meu) return { rotulo: 'Pronto', para: 'pronto' };
  return null;
}

/** Fila do lavador em tempo real: meus carros primeiro, um botão grande por cartão, sem valores (a visão do servidor já vem sem R$). */
export function FilaLavador({ inicial, meuId }: { inicial: OsView[]; meuId: string }) {
  const [fila, setFila] = useState(inicial);
  const [erro, setErro] = useState('');
  const [pendente, iniciar] = useTransition();
  const [agora, setAgora] = useState(() => Date.now());
  const vibrar = useVibrar();
  useWakeLock(true);
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const seq = useRef(0);
  const recarregar = useCallback(async () => {
    const n = ++seq.current; // recargas podem se sobrepor (SSE e ação): só a mais recente vale
    const r = await listarFilaAction();
    if (r.ok && n === seq.current) setFila(r.data);
  }, []);
  const { reconectando } = useEventos(recarregar);

  const transitar = (os: OsView, para: StatusOs) =>
    iniciar(async () => {
      const r = await transitarOsAction({ osId: os.id, esperado: os.status, para });
      vibrar(r.ok ? 30 : 120);
      setErro(r.ok ? '' : erroDe(r));
      if (r.ok || (ERROS_RECARREGAR_FILA as readonly string[]).includes(r.code)) await recarregar();
    });

  // ordenação estável: os meus primeiro, o resto na ordem da fila
  const ordenada = [...fila].sort((a, b) => Number(b.responsavel?.id === meuId) - Number(a.responsavel?.id === meuId));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-tinta">Fila</h1>
        <p role="status" className="rounded-md bg-sinal px-3 py-1 text-base font-semibold text-tinta empty:hidden">
          {reconectando ? 'Reconectando…' : ''}
        </p>
      </div>
      <div className="sticky top-2 z-10 empty:hidden">
        <Alerta texto={erro} />
      </div>
      {ordenada.length === 0 && <p className="text-lg text-suave">Nenhum carro na fila.</p>}
      {ordenada.map((os) => (
        <CartaoOs key={os.id} os={os} meuId={meuId} agora={agora} pendente={pendente} onTransitar={transitar} />
      ))}
    </div>
  );
}

function CartaoOs({ os, meuId, agora, pendente, onTransitar }: { os: OsView; meuId: string; agora: number; pendente: boolean; onTransitar: (os: OsView, para: StatusOs) => void }) {
  const meu = os.responsavel?.id === meuId;
  const acao = acaoDe(os, meuId);
  const detalhes = [os.veiculo.modelo, os.veiculo.cor].filter(Boolean).join(', ');
  const quem = !os.responsavel ? 'Sem responsável' : meu ? `Com você (${os.responsavel.nomeExibicao})` : `${STATUS[os.status]} com ${os.responsavel.nomeExibicao}`;
  return (
    <article aria-label={`OS ${os.numero} ${os.veiculo.placa}`} className={cn('space-y-3 rounded-lg border-2 bg-white p-4 shadow-sm', meu ? 'border-agua' : 'border-linha')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="rounded border-2 border-tinta border-t-[6px] border-t-agua px-2 font-mono text-3xl font-extrabold tracking-widest text-tinta">{os.veiculo.placa}</h2>
        {(meu || !os.responsavel) && <span className={cn('rounded-md px-2.5 py-1 text-base font-bold', COR[os.status])}>{STATUS[os.status]}</span>}
      </div>
      {detalhes && <p className="text-lg text-tinta">{detalhes}</p>}
      <p className="text-base font-semibold text-tinta">{os.itens.map((i) => i.nome).join(' + ')}</p>
      <p className="flex flex-wrap justify-between gap-x-3 text-base text-suave">
        <span className={cn(os.responsavel ? 'font-semibold text-tinta' : 'italic')}>{quem}</span>
        <span suppressHydrationWarning>{tempoDesde(os.entradaEm, agora)}</span>
      </p>
      {acao && (
        <button
          type="button"
          disabled={pendente}
          onClick={() => onTransitar(os, acao.para)}
          className="flex min-h-14 w-full touch-manipulation items-center justify-center rounded-md bg-agua px-4 text-xl font-bold text-white active:bg-agua-escura disabled:opacity-60"
        >
          {acao.rotulo}
        </button>
      )}
    </article>
  );
}
