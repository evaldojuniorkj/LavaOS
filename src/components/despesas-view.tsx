'use client';

import { useState } from 'react';
import { Alerta, useEnvio } from '@/components/catalogo-form';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal, Motivo } from '@/components/ui/modal';
import { dataDoCaixa } from '@/modules/caixa/caixa.rules';
import type { ActionResult } from '@/modules/catalogo/catalogo.actions';
import { decimalParaCentesimos, formatarReais } from '@/modules/catalogo/catalogo.rules';
import { cancelarDespesaAction, lancarDespesaAction, marcarComoPagaAction, salvarCategoriaAction } from '@/modules/despesas/despesas.actions';
import type { Categoria, Despesa } from '@/modules/despesas/despesas.repo';
import { cn, SEM_CONEXAO } from '@/lib/utils';

type ComCategoria = Despesa & { categoria: string };
const ddmm = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;
const campoSelect = 'block min-h-12 w-full rounded-xl border-[1.5px] border-linha bg-white px-3.5 text-base text-tinta';
const seguro = (acao: () => Promise<ActionResult<unknown>>) => (): Promise<ActionResult<unknown>> => acao().catch(() => SEM_CONEXAO);

/** Despesas do mês, contas a pagar e categorias; cada ação recarrega a página no servidor (router.refresh). */
export function DespesasView({ hoje, despesas, contas, categorias, caixaAberto }: { hoje: string; despesas: ComCategoria[]; contas: (ComCategoria & { vencida: boolean })[]; categorias: Categoria[]; caixaAberto: boolean }) {
  const [cancelar, setCancelar] = useState<string | null>(null);
  const { erro, pendente, enviar } = useEnvio(() => {});
  const onCancelar = (id: string) => setCancelar(id);

  return (
    <div className="space-y-8">
      <h1 className="text-4xl font-extrabold tracking-tight text-tinta">Despesas</h1>
      <Alerta texto={erro} />
      <LancarDespesa hoje={hoje} categorias={categorias.filter((c) => c.ativo)} caixaAberto={caixaAberto} />

      <section aria-labelledby="despesas-contas" className="rounded-3xl bg-white p-5 shadow-cartao">
        <h2 id="despesas-contas" className="text-lg font-bold text-tinta">
          Contas a pagar
        </h2>
        {contas.length === 0 && <p className="mt-2 text-suave">Nenhuma conta a pagar.</p>}
        <ul className="mt-2 divide-y divide-linha">
          {contas.map((d) => (
            <li key={d.id} className={cn('flex flex-wrap items-center justify-between gap-2 py-3', d.vencida && '-mx-2 rounded-xl bg-perigo/5 px-2')}>
              <Linha d={d}>
                <span className={cn(d.vencida && 'font-bold text-perigo')}>
                  {d.vencida ? 'Vencida' : 'Vence'} em {ddmm(d.vencimento!)}
                </span>
              </Linha>
              <div className="flex flex-wrap gap-2">
                <Button variante="secundario" disabled={pendente} onClick={() => onCancelar(d.id)} aria-label={`Cancelar ${d.descricao}`}>
                  Cancelar
                </Button>
                <Button disabled={pendente} onClick={() => enviar(seguro(() => marcarComoPagaAction({ despesaId: d.id })))} aria-label={`Marcar ${d.descricao} como paga`}>
                  Marcar como paga
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="despesas-mes" className="rounded-3xl bg-white p-5 shadow-cartao">
        <h2 id="despesas-mes" className="text-lg font-bold text-tinta">
          Despesas do mês
        </h2>
        {despesas.length === 0 && <p className="mt-2 text-suave">Nenhuma despesa neste mês.</p>}
        <ul className="mt-2 divide-y divide-linha">
          {despesas.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <Linha d={d}>
                {d.canceladaEm ? `Cancelada: ${d.motivoCancelamento}` : d.pagoEm ? `Paga em ${ddmm(dataDoCaixa(new Date(d.pagoEm)))}${d.caixaId ? ' com dinheiro do caixa' : ''}` : `A pagar até ${ddmm(d.vencimento!)}`}
              </Linha>
              {!d.canceladaEm && (
                <Button variante="secundario" disabled={pendente} onClick={() => onCancelar(d.id)} aria-label={`Cancelar ${d.descricao}`}>
                  Cancelar
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="despesas-categorias" className="space-y-3">
        <h2 id="despesas-categorias" className="text-lg font-bold text-tinta">
          Categorias
        </h2>
        <ul className="divide-y divide-linha rounded-3xl bg-white shadow-cartao">
          {categorias.map((c) => (
            <li key={`${c.id}-${c.nome}-${c.ativo}`} className="p-4">
              <CategoriaForm categoria={c} />
            </li>
          ))}
          <li className="p-4">
            <CategoriaForm />
          </li>
        </ul>
      </section>

      {cancelar && (
        <Modal titulo="Cancelar despesa" onFechar={() => setCancelar(null)}>
          <Motivo
            confirmar="Confirmar cancelamento"
            enviando="Cancelando…"
            perigo
            pendente={pendente}
            onVoltar={() => setCancelar(null)}
            onConfirmar={(motivo, onErro) =>
              enviar(async () => {
                const r = await seguro(() => cancelarDespesaAction({ despesaId: cancelar, motivo }))();
                if (!r.ok && r.fieldErrors?.motivo) onErro(r.fieldErrors);
                else setCancelar(null); // demais erros aparecem no topo, fora do diálogo
                return r;
              })
            }
          />
        </Modal>
      )}
    </div>
  );
}

function Linha({ d, children }: { d: ComCategoria; children: React.ReactNode }) {
  return (
    <div className={cn('min-w-0 text-base', d.canceladaEm && 'text-suave')}>
      <p className="wrap-anywhere">
        <strong>{d.descricao}</strong> · <span className={cn(d.canceladaEm && 'line-through')}>{formatarReais(d.valorCentavos)}</span>
      </p>
      <p className="text-sm text-suave">
        {d.categoria} · {children}
      </p>
    </div>
  );
}

function LancarDespesa({ hoje, categorias, caixaAberto }: { hoje: string; categorias: Categoria[]; caixaAberto: boolean }) {
  const { erros, erro, pendente, enviar, setErro, setErros } = useEnvio(() => {});
  const [paga, setPaga] = useState(true);
  const [doCaixa, setDoCaixa] = useState(false);
  const comCaixa = paga && doCaixa && caixaAberto;
  return (
    <form
      noValidate
      aria-labelledby="despesas-lancar"
      className="space-y-4 rounded-3xl bg-white p-5 shadow-cartao"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
        const valorCentavos = decimalParaCentesimos(f.valor ?? '');
        if (valorCentavos === null) {
          setErros({ valorCentavos: ['Informe o valor em R$, por exemplo 20,00.'] });
          return setErro('Revise os campos destacados.');
        }
        const data = (k: string) => f[k] || undefined;
        enviar(
          seguro(async () => {
            const r = await lancarDespesaAction({
              categoriaId: f.categoriaId,
              descricao: f.descricao,
              valorCentavos,
              ...(comCaixa ? { doCaixa: true } : paga ? { pagoEm: data('pagoEm') } : { vencimento: data('vencimento') }),
            });
            if (r.ok) {
              form.reset();
              setDoCaixa(false);
            }
            return r;
          }),
        );
      }}
    >
      <h2 id="despesas-lancar" className="text-lg font-bold text-tinta">
        Lançar despesa
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="despesa-categoria">Categoria</Label>
          <select id="despesa-categoria" name="categoriaId" className={campoSelect} aria-invalid={erros.categoriaId ? true : undefined} aria-describedby={erros.categoriaId ? 'despesa-categoria-erro' : undefined}>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          {erros.categoriaId && (
            <p id="despesa-categoria-erro" className="text-sm font-medium text-perigo">
              {erros.categoriaId[0]}
            </p>
          )}
        </div>
        <Campo id="despesa-descricao" name="descricao" rotulo="Descrição" maxLength={200} autoComplete="off" erro={erros.descricao?.[0]} />
        <Campo id="despesa-valor" name="valor" rotulo="Valor (R$)" inputMode="decimal" autoComplete="off" erro={erros.valorCentavos?.[0]} />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-tinta">Situação</legend>
        <div className="flex flex-wrap gap-x-6">
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="radio" name="situacao" checked={paga} onChange={() => setPaga(true)} className="size-5" /> Já paga
          </label>
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="radio" name="situacao" checked={!paga} onChange={() => setPaga(false)} className="size-5" /> A pagar
          </label>
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        {paga && !comCaixa && <Campo key="pagoEm" id="despesa-pago-em" name="pagoEm" type="date" rotulo="Data do pagamento" defaultValue={hoje} max={hoje} erro={erros.pagoEm?.[0]} />}
        {!paga && <Campo key="vencimento" id="despesa-vencimento" name="vencimento" type="date" rotulo="Vencimento" erro={erros.vencimento?.[0]} />}
      </div>
      {paga && caixaAberto && (
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" checked={doCaixa} onChange={(e) => setDoCaixa(e.target.checked)} className="size-5" /> Paga com dinheiro do caixa (hoje)
        </label>
      )}
      {comCaixa && erros.pagoEm && <p className="text-sm font-medium text-perigo">{erros.pagoEm[0]}</p>}
      <Alerta texto={erro} />
      <Button type="submit" disabled={pendente || categorias.length === 0}>
        {pendente ? 'Lançando…' : 'Lançar despesa'}
      </Button>
    </form>
  );
}

function CategoriaForm({ categoria }: { categoria?: Categoria }) {
  const { erros, erro, pendente, enviar } = useEnvio(() => {});
  const sufixo = categoria?.id ?? 'nova';
  const travada = categoria?.sistema ?? false; // "Comissões" é usada pela Fase 5: o servidor recusa renomear e desativar
  return (
    <form
      noValidate
      aria-label={categoria ? `Categoria ${categoria.nome}` : 'Nova categoria'}
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        enviar(
          seguro(async () => {
            const r = await salvarCategoriaAction({ id: categoria?.id, nome: String(f.get('nome') ?? ''), ativo: categoria ? f.get('ativo') === 'on' : undefined });
            if (r.ok && !categoria) form.reset();
            return r;
          }),
        );
      }}
    >
      <div className="min-w-48 flex-1">
        <Campo id={`categoria-nome-${sufixo}`} name="nome" rotulo={categoria ? `Nome da categoria${travada ? ' (do sistema)' : ''}` : 'Nova categoria'} defaultValue={categoria?.nome} readOnly={travada} maxLength={60} autoComplete="off" erro={erros.nome?.[0]} />
      </div>
      {categoria && !travada && (
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" name="ativo" defaultChecked={categoria.ativo} className="size-5" /> Ativa
        </label>
      )}
      {!travada && (
        <Button type="submit" variante="secundario" disabled={pendente}>
          {pendente ? 'Salvando…' : categoria ? 'Salvar' : 'Adicionar categoria'}
        </Button>
      )}
      <div className="w-full empty:hidden">
        <Alerta texto={erro} />
      </div>
    </form>
  );
}
