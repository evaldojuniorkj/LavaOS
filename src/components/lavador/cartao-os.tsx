'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Alerta } from '@/components/catalogo-form';
import { useEventos } from '@/components/use-eventos';
import { Placa } from '@/components/ui/placa';
import { rotuloVeiculo } from '@/modules/clientes/clientes.rules';
import { tintaDoStatus } from '@/components/ui/status-visual';
import { listarFilaAction, transitarOsAction } from '@/modules/ordens/ordens.actions';
import { ERROS_RECARREGAR_FILA, type StatusOs } from '@/modules/ordens/ordens.rules';
import type { OsView } from '@/modules/ordens/ordens.views';
import { cn, SEM_CONEXAO, tempoDesde } from '@/lib/utils';
import { useVibrar } from './use-vibrar';
import { useWakeLock } from './use-wake-lock';

const STATUS: Record<StatusOs, string> = { aguardando: 'Aguardando', em_lavagem: 'Em lavagem', pronto: 'Pronto', entregue: 'Entregue', cancelada: 'Cancelada' };
const erroDe = (r: { code: string; message: string }) => (r.code === 'ACESSO_NEGADO' ? 'Seu perfil não pode fazer isso.' : r.message);
const COR: Partial<Record<StatusOs, string>> = { aguardando: 'bg-sinal/25 text-tinta', em_lavagem: 'bg-agua/15 text-agua-escura', pronto: 'bg-pronto/15 text-pronto' };
const PONTO: Partial<Record<StatusOs, string>> = { aguardando: 'bg-sinal', em_lavagem: 'bg-agua', pronto: 'bg-pronto' };

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
    const r = await listarFilaAction().catch(() => null); // sem rede: fica a última fila; o SSE recarrega ao reconectar
    if (r?.ok && n === seq.current) setFila(r.data);
  }, []);
  const { reconectando } = useEventos(recarregar);

  const transitar = (os: OsView, para: StatusOs) =>
    iniciar(async () => {
      const r = await transitarOsAction({ osId: os.id, esperado: os.status, para }).catch(() => SEM_CONEXAO);
      vibrar(r.ok ? 30 : 120);
      setErro(r.ok ? '' : erroDe(r));
      if (r.ok || (ERROS_RECARREGAR_FILA as readonly string[]).includes(r.code)) await recarregar();
    });

  // ordenação estável: os meus primeiro, o resto na ordem da fila
  const ordenada = [...fila].sort((a, b) => Number(b.responsavel?.id === meuId) - Number(a.responsavel?.id === meuId));
  const meus = fila.filter((o) => o.responsavel?.id === meuId).length;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-4xl font-extrabold tracking-tight text-tinta">Fila</h1>
        {ordenada.length > 0 && (
          <p className="mt-1 text-base text-suave">
            {ordenada.length === 1 ? '1 carro na fila' : `${ordenada.length} carros na fila`}
            {meus > 0 ? `, ${meus === 1 ? '1 com você' : `${meus} com você`}` : ''}.
          </p>
        )}
        <p role="status" className="mt-2 w-fit rounded-full bg-sinal px-3 py-1 text-base font-semibold text-tinta empty:hidden">
          {reconectando ? 'Reconectando…' : ''}
        </p>
      </div>
      <div className="sticky top-2 z-10 empty:hidden">
        <Alerta texto={erro} />
      </div>
      {ordenada.length === 0 && (
        <div className="rounded-3xl bg-white p-8 text-center shadow-cartao">
          <p className="text-xl font-bold text-tinta">Nenhum carro na fila.</p>
          <p className="mt-1 text-base text-suave">Quando um carro chegar, ele aparece aqui sozinho.</p>
        </div>
      )}
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
    <article aria-label={`OS ${os.numero} ${rotuloVeiculo(os.veiculo)}`} className={cn('space-y-3 rounded-3xl p-4 transition-shadow', tintaDoStatus(os.status), meu && 'ring-2 ring-agua')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2>
          <Placa valor={os.veiculo.placa} />
        </h2>
        {(meu || !os.responsavel) && (
          <span className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-base font-bold', COR[os.status])}>
            <span aria-hidden className={cn('size-2.5 rounded-full', PONTO[os.status])} />
            {STATUS[os.status]}
          </span>
        )}
      </div>
      {detalhes && <p className="text-lg font-medium text-tinta">{detalhes}</p>}
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
          className="flex min-h-14 w-full touch-manipulation items-center justify-center rounded-2xl bg-agua px-4 text-xl font-bold text-white transition duration-100 active:scale-[0.98] active:bg-agua-escura disabled:opacity-60"
        >
          {acao.rotulo}
        </button>
      )}
    </article>
  );
}
