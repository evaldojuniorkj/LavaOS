'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Placa } from '@/components/ui/placa';
import { tintaDoStatus } from '@/components/ui/status-visual';
import { useEventos } from '@/components/use-eventos';
import { cn, duracao } from '@/lib/utils';
import { carregarPainelAction } from '@/modules/painel/painel.actions';
import type { Painel } from '@/modules/painel/painel.repo';

const hhmm = (d: Date) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Painel de leitura da gestão: o servidor calcula tudo (sem valores); eventos SSE e um relógio de 60 s só disparam recargas. */
export function PainelView({ inicial }: { inicial: Painel }) {
  const [painel, setPainel] = useState(inicial);
  const [falhou, setFalhou] = useState(false);
  const seq = useRef(0);
  const recarregar = useCallback(async () => {
    const n = ++seq.current; // recargas podem se sobrepor: só a mais recente vale
    const r = await carregarPainelAction().catch(() => null);
    if (n !== seq.current) return;
    if (r?.ok) setPainel(r.data);
    setFalhou(!r?.ok); // mantém o último painel; o aviso mostra de quando ele é
  }, []);
  const { reconectando } = useEventos(recarregar);

  useEffect(() => {
    const visivel = () => document.visibilityState === 'visible';
    const t = setInterval(() => visivel() && recarregar(), 60_000);
    const aoVoltar = () => visivel() && recarregar();
    document.addEventListener('visibilitychange', aoVoltar);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', aoVoltar);
    };
  }, [recarregar]);

  const c = painel.contagem;
  const cartoes = [
    { titulo: 'Aguardando', n: c.aguardando, tinta: tintaDoStatus('aguardando') },
    { titulo: 'Em lavagem', n: c.emLavagem, tinta: tintaDoStatus('em_lavagem') },
    { titulo: 'Pronto', n: c.pronto, tinta: tintaDoStatus('pronto') },
    { titulo: 'Entregues hoje', n: c.entreguesHoje, tinta: tintaDoStatus('entregue') },
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-4xl font-extrabold tracking-tight text-tinta">Painel</h1>
        <p role="status" className="empty:hidden rounded-md bg-sinal/25 px-3 py-1 text-base font-semibold text-tinta">
          {falhou || reconectando ? `Sem conexão — mostrando dados de ${hhmm(painel.atualizadoEm)}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cartoes.map((k) => (
          <section key={k.titulo} className={cn('rounded-3xl p-5', k.tinta)}>
            <h2 className="text-lg font-bold text-tinta">{k.titulo}</h2>
            <p className="mt-1 text-6xl font-extrabold tracking-tight text-tinta">{k.n}</p>
          </section>
        ))}
      </div>

      <section className="rounded-3xl bg-white p-5 shadow-cartao">
        <h2 className="text-lg font-bold text-tinta">Tempo médio de lavagem</h2>
        <p className="mt-1 text-4xl font-extrabold tracking-tight text-tinta">{painel.tempoMedioLavagemMin === null ? '—' : `${painel.tempoMedioLavagemMin} min`}</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="painel-atrasadas" className="rounded-3xl bg-white p-5 shadow-cartao">
          <h2 id="painel-atrasadas" className="text-lg font-bold text-tinta">
            OSs atrasadas
          </h2>
          {/* só o resumo é região viva: os minutos mudam a cada recarga e não devem ser anunciados */}
          <p role="status" className={cn(painel.atrasadas.length === 0 ? 'mt-3 text-suave' : 'sr-only')}>
            {painel.atrasadas.length === 0 ? 'Nenhuma OS atrasada' : `${painel.atrasadas.length} ${painel.atrasadas.length === 1 ? 'OS atrasada' : 'OSs atrasadas'}`}
          </p>
          {painel.atrasadas.length > 0 && (
            <ul className="mt-3 space-y-2">
              {painel.atrasadas.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl bg-enxague px-4 py-3">
                  <span className="flex items-center gap-3">
                    <span className="font-bold text-tinta">OS {o.numero}</span>
                    <Placa valor={o.placa} />
                  </span>
                  <span className="text-base text-suave">
                    {o.status === 'aguardando' ? 'Aguardando' : 'Em lavagem'} · <span className="font-semibold text-tinta">{duracao(o.minutos)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="painel-lavadores" className="rounded-3xl bg-white p-5 shadow-cartao">
          <h2 id="painel-lavadores" className="text-lg font-bold text-tinta">
            Lavadores
          </h2>
          {painel.lavadores.length === 0 ? (
            <p className="mt-3 text-suave">Nenhum lavador ativo.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {painel.lavadores.map((l) => (
                <li key={l.membroId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl bg-enxague px-4 py-3">
                  <span className="font-semibold text-tinta">{l.nome}</span>
                  <span className="flex items-center gap-2 text-base">
                    {l.osEmLavagem.length > 0 && <span className="text-suave">{l.osEmLavagem.map((n) => `OS ${n}`).join(', ')}</span>}
                    <span className={cn('rounded-full px-3 py-1 font-semibold', l.livre ? 'bg-pronto/15 text-tinta' : 'bg-sinal/30 text-tinta')}>{l.livre ? 'Livre' : 'Ocupado'}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
