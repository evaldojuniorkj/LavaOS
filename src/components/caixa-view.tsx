'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { Alerta } from '@/components/catalogo-form';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/input';
import { Modal, Motivo } from '@/components/ui/modal';
import { useEventos } from '@/components/use-eventos';
import { abrirCaixaAction, carregarCaixaAction, estornarPagamentoAction, fecharCaixaAction, reabrirCaixaAction } from '@/modules/caixa/caixa.actions';
import type { CaixaAtual, ResumoDoCaixa } from '@/modules/caixa/caixa.repo';
import { diferenca, FORMAS, ROTULO_FORMA } from '@/modules/caixa/caixa.rules';
import type { ActionResult } from '@/modules/catalogo/catalogo.actions';
import { decimalParaCentesimos, formatarReais } from '@/modules/catalogo/catalogo.rules';
import { cn, SEM_CONEXAO } from '@/lib/utils';

type Pode = { estornar: boolean; reabrir: boolean };
const EXEMPLO = 'Informe em R$, por exemplo 100,00.';
const ddmm = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;
const hhmm = (d: Date) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const erroDe = (r: Extract<ActionResult<unknown>, { ok: false }>) =>
  r.code === 'ACESSO_NEGADO' ? 'Seu perfil não pode fazer isso.' : r.code === 'VALIDACAO' ? (Object.values(r.fieldErrors ?? {})[0]?.[0] ?? 'Dados inválidos.') : r.message;
// formatarReais só conhece valores positivos
const comSinal = (d: number) => (d === 0 ? formatarReais(0) : `${d > 0 ? '+' : '−'}${formatarReais(Math.abs(d))} (${d > 0 ? 'sobra' : 'falta'})`);

/** Caixa do dia em tempo real: cada evento SSE só dispara uma recarga; o servidor calcula esperado e diferença. */
export function CaixaView({ inicial, pode }: { inicial: CaixaAtual; pode: Pode }) {
  const [estado, setEstado] = useState(inicial);
  const [erro, setErro] = useState('');
  const [falhou, setFalhou] = useState(false);
  const [estornar, setEstornar] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const seq = useRef(0);
  const recarregar = useCallback(async () => {
    const n = ++seq.current; // recargas podem se sobrepor: só a mais recente vale
    const r = await carregarCaixaAction().catch(() => null);
    if (n !== seq.current) return;
    if (r?.ok) setEstado(r.data);
    setFalhou(!r?.ok);
  }, []);
  const { reconectando } = useEventos(recarregar);

  /** Erros de campo voltam ao formulário; o resto vira a mensagem do topo. Sempre recarrega (outra pessoa pode ter mudado o caixa). */
  const executar: Executar = (acao, onErroCampo) =>
    iniciar(async () => {
      const r = await acao().catch(() => SEM_CONEXAO);
      if (!r.ok && r.code === 'VALIDACAO' && r.fieldErrors && onErroCampo) return onErroCampo(r.fieldErrors);
      setErro(r.ok ? '' : erroDe(r));
      setEstornar(null);
      await recarregar();
    });

  const { hoje, resumo } = estado;
  const c = resumo?.caixa;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-4xl font-extrabold tracking-tight text-tinta">Caixa</h1>
        {c && (
          <p className={cn('rounded-full px-3 py-1 text-base font-semibold', c.status === 'aberto' ? 'bg-agua/15 text-agua-escura' : 'bg-tinta text-white')}>
            {c.status === 'aberto' ? 'Aberto' : 'Fechado'} · {ddmm(c.data)}
          </p>
        )}
        <p role="status" className="empty:hidden rounded-md bg-sinal/25 px-3 py-1 text-base font-semibold text-tinta">
          {falhou || reconectando ? 'Sem conexão — os dados podem estar desatualizados' : ''}
        </p>
      </div>
      <Alerta texto={erro} />

      {!resumo && <AbrirCaixa pendente={pendente} executar={executar} />}
      {c && c.status === 'aberto' && c.data !== hoje && (
        <p className="rounded-xl bg-sinal/25 p-4 text-base font-semibold text-tinta">O caixa de {ddmm(c.data)} ficou aberto. Feche-o para abrir o de hoje.</p>
      )}
      {resumo && <Resumo resumo={resumo} pode={pode} pendente={pendente} aberto={c!.status === 'aberto'} onEstornar={setEstornar} />}
      {c?.status === 'aberto' && <FecharCaixa key={c.id} resumo={resumo!} pendente={pendente} executar={executar} />}
      {c?.status === 'fechado' && (
        <section aria-labelledby="caixa-fechamento" className="space-y-3 rounded-3xl bg-white p-5 shadow-cartao">
          <h2 id="caixa-fechamento" className="text-lg font-bold text-tinta">
            Fechamento{c.fechadoEm ? ` às ${hhmm(c.fechadoEm)}` : ''}
          </h2>
          <p className="text-base">Dinheiro contado: <strong>{formatarReais(c.dinheiroContadoCentavos ?? 0)}</strong></p>
          <p className="text-lg font-bold">Diferença: {comSinal(c.diferencaCentavos ?? 0)}</p>
          {pode.reabrir && c.data === hoje && (
            <Button variante="secundario" disabled={pendente} onClick={() => executar(() => reabrirCaixaAction({ caixaId: c.id }))}>
              {pendente ? 'Reabrindo…' : 'Reabrir caixa'}
            </Button>
          )}
        </section>
      )}

      {estornar && (
        <Modal titulo="Estornar pagamento" onFechar={() => setEstornar(null)}>
          <Motivo confirmar="Confirmar estorno" enviando="Estornando…" perigo pendente={pendente} onVoltar={() => setEstornar(null)} onConfirmar={(motivo, onErro) => executar(() => estornarPagamentoAction({ pagamentoId: estornar, motivo }), onErro)} />
        </Modal>
      )}
    </div>
  );
}

type Executar = (acao: () => Promise<ActionResult<unknown>>, onErroCampo?: (e: Record<string, string[]>) => void) => void;

function AbrirCaixa({ pendente, executar }: { pendente: boolean; executar: Executar }) {
  const [erroTroco, setErroTroco] = useState('');
  return (
    <form
      noValidate
      className="max-w-md space-y-4 rounded-3xl bg-white p-5 shadow-cartao"
      onSubmit={(e) => {
        e.preventDefault();
        const troco = decimalParaCentesimos(String(new FormData(e.currentTarget).get('caixa-troco') ?? '') || '0');
        if (troco === null) return setErroTroco(EXEMPLO);
        setErroTroco('');
        executar(() => abrirCaixaAction({ trocoInicialCentavos: troco }), (erros) => setErroTroco(erros.trocoInicialCentavos?.[0] ?? EXEMPLO));
      }}
    >
      <h2 className="text-lg font-bold text-tinta">Nenhum caixa aberto hoje</h2>
      <Campo id="caixa-troco" rotulo="Troco inicial (R$)" inputMode="decimal" autoComplete="off" erro={erroTroco} />
      <Button type="submit" disabled={pendente}>
        {pendente ? 'Abrindo…' : 'Abrir caixa'}
      </Button>
    </form>
  );
}

function Resumo({ resumo, pode, pendente, aberto, onEstornar }: { resumo: ResumoDoCaixa; pode: Pode; pendente: boolean; aberto: boolean; onEstornar: (id: string) => void }) {
  return (
    <>
      <section aria-labelledby="caixa-formas" className="space-y-3">
        <h2 id="caixa-formas" className="text-lg font-bold text-tinta">
          Recebido por forma
        </h2>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {FORMAS.map((f) => (
            <li key={f} className="rounded-3xl bg-white p-4 shadow-cartao">
              <p className="text-base font-semibold text-suave">{ROTULO_FORMA[f]}</p>
              <p className="text-2xl font-extrabold tracking-tight text-tinta">{formatarReais(resumo.porForma[f])}</p>
            </li>
          ))}
        </ul>
        <p className="text-base text-tinta">
          Troco inicial {formatarReais(resumo.caixa.trocoInicialCentavos)} · <strong>Esperado em dinheiro na gaveta: {formatarReais(resumo.esperadoDinheiro)}</strong>
        </p>
      </section>

      <section aria-labelledby="caixa-pagamentos" className="rounded-3xl bg-white p-5 shadow-cartao">
        <h2 id="caixa-pagamentos" className="text-lg font-bold text-tinta">
          Pagamentos
        </h2>
        {resumo.pagamentos.length === 0 && <p className="mt-2 text-suave">Nenhum pagamento.</p>}
        <ul className="mt-2 divide-y divide-linha">
          {resumo.pagamentos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className={cn('min-w-0 text-base', p.estornadoEm && 'text-suave')}>
                <p>
                  <strong>OS {p.osNumero}</strong> · {ROTULO_FORMA[p.forma]} · <span className={cn(p.estornadoEm && 'line-through')}>{formatarReais(p.valorCentavos)}</span>
                </p>
                <p className="text-sm text-suave">
                  {p.recebidoPor} às {hhmm(p.recebidoEm)}
                  {p.estornadoEm && ` · estornado: ${p.motivoEstorno}`}
                </p>
              </div>
              {pode.estornar && aberto && !p.estornadoEm && (
                <Button variante="secundario" disabled={pendente} onClick={() => onEstornar(p.id)} aria-label={`Estornar ${formatarReais(p.valorCentavos)} da OS ${p.osNumero}`}>
                  Estornar
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {resumo.saidas.length > 0 && (
        <section aria-labelledby="caixa-saidas" className="rounded-3xl bg-white p-5 shadow-cartao">
          <h2 id="caixa-saidas" className="text-lg font-bold text-tinta">
            Saídas do caixa
          </h2>
          <ul className="mt-2 divide-y divide-linha">
            {resumo.saidas.map((s) => (
              <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2 text-base">
                <span>{s.descricao}</span>
                <span className="font-semibold">{formatarReais(s.valorCentavos)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Conferir primeiro: a diferença aparece antes de gravar; o servidor recalcula o esperado ao fechar. */
function FecharCaixa({ resumo, pendente, executar }: { resumo: ResumoDoCaixa; pendente: boolean; executar: Executar }) {
  const [contado, setContado] = useState<number | null>(null);
  const [erroContado, setErroContado] = useState('');
  return (
    <form
      noValidate
      className="max-w-md space-y-4 rounded-3xl bg-white p-5 shadow-cartao"
      onSubmit={(e) => {
        e.preventDefault();
        if (contado !== null) return executar(() => fecharCaixaAction({ caixaId: resumo.caixa.id, dinheiroContadoCentavos: contado }), (erros) => setErroContado(erros.dinheiroContadoCentavos?.[0] ?? EXEMPLO));
        const v = decimalParaCentesimos(String(new FormData(e.currentTarget).get('caixa-contado') ?? ''));
        if (v === null) return setErroContado(EXEMPLO);
        setErroContado('');
        setContado(v);
      }}
    >
      <h2 className="text-lg font-bold text-tinta">Fechar caixa</h2>
      <Campo id="caixa-contado" rotulo="Dinheiro contado na gaveta (R$)" inputMode="decimal" autoComplete="off" readOnly={contado !== null} erro={erroContado} />
      {contado !== null && (
        <p role="status" className="text-lg font-bold text-tinta">
          Esperado {formatarReais(resumo.esperadoDinheiro)} · Diferença: {comSinal(diferenca(contado, resumo.esperadoDinheiro))}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {contado !== null && (
          <Button type="button" variante="secundario" onClick={() => setContado(null)}>
            Corrigir
          </Button>
        )}
        <Button type="submit" disabled={pendente}>
          {contado === null ? 'Conferir' : pendente ? 'Fechando…' : 'Confirmar fechamento'}
        </Button>
      </div>
    </form>
  );
}
