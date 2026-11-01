'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alerta, useEnvio } from '@/components/catalogo-form';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal, Motivo } from '@/components/ui/modal';
import { dataDoCaixa } from '@/modules/caixa/caixa.rules';
import type { ActionResult } from '@/modules/catalogo/catalogo.actions';
import { decimalParaCentesimos, formatarReais } from '@/modules/catalogo/catalogo.rules';
import { cancelarValeAction, lancarValeAction, pagarAcertoAction, previaAcertoAction } from '@/modules/comissoes/comissoes.actions';
import type { acertosDoMembro, listarValesPendentes, pendentesPorMembro } from '@/modules/comissoes/comissoes.repo';
import { cn, SEM_CONEXAO } from '@/lib/utils';

type Conta = Pick<Awaited<ReturnType<typeof pendentesPorMembro>>[number], 'comissoesCentavos' | 'valesCentavos' | 'saldoAnteriorCentavos' | 'pagoCentavos' | 'saldoDevedorCentavos'>;
type Membro = { id: string; nome: string; conta: Conta | null; vales: Awaited<ReturnType<typeof listarValesPendentes>>; acertos: Awaited<ReturnType<typeof acertosDoMembro>> };
const ddmm = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;
const ddmmaaaa = (data: string) => `${ddmm(data)}/${data.slice(0, 4)}`;
const campoSelect = 'block min-h-12 w-full rounded-xl border-[1.5px] border-linha bg-white px-3.5 text-base text-tinta';
const seguro = (acao: () => Promise<ActionResult<unknown>>) => (): Promise<ActionResult<unknown>> => acao().catch(() => SEM_CONEXAO);
const LINK_BOTAO = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-linha bg-white px-4 text-base font-semibold text-tinta hover:bg-enxague';

/** Comissões e vales pendentes por membro, acerto com prévia e histórico; cada ação recarrega a página no servidor. */
export function ComissoesView({ hoje, caixaAberto, membros, ativos }: { hoje: string; caixaAberto: boolean; membros: Membro[]; ativos: { id: string; nome: string }[] }) {
  const [cancelar, setCancelar] = useState<string | null>(null);
  const [acerto, setAcerto] = useState<Membro | null>(null);
  const { erro, pendente, enviar } = useEnvio(() => {});
  return (
    <div className="space-y-8">
      <h1 className="text-4xl font-extrabold tracking-tight text-tinta">Comissões</h1>
      <Alerta texto={erro} />
      <LancarVale ativos={ativos} caixaAberto={caixaAberto} />
      {membros.length === 0 && <p className="text-suave">Nenhuma comissão ou vale pendente.</p>}
      {membros.map((m) => (
        <section key={m.id} aria-labelledby={`membro-${m.id}`} className="space-y-4 rounded-3xl bg-white p-5 shadow-cartao">
          <h2 id={`membro-${m.id}`} className="text-lg font-bold wrap-anywhere text-tinta">
            {m.nome}
          </h2>
          {m.conta ? <ResumoConta conta={m.conta} /> : <p className="text-suave">Nada pendente.</p>}
          {m.vales.length > 0 && (
            <ul aria-label={`Vales pendentes de ${m.nome}`} className="divide-y divide-linha">
              {m.vales.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-base">
                  <span>
                    Vale de {ddmm(dataDoCaixa(new Date(v.dadoEm)))} · <strong>{formatarReais(v.valorCentavos)}</strong>
                  </span>
                  <Button variante="secundario" disabled={pendente} onClick={() => setCancelar(v.id)} aria-label={`Cancelar vale de ${formatarReais(v.valorCentavos)} de ${m.nome}`}>
                    Cancelar vale
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {m.conta && (
            <Button onClick={() => setAcerto(m)} aria-label={`Fazer acerto de ${m.nome}`}>
              Fazer acerto
            </Button>
          )}
          {m.acertos.length > 0 && (
            <div>
              <h3 className="text-base font-bold text-tinta">Histórico de acertos</h3>
              <ul className="divide-y divide-linha">
                {m.acertos.map((a) => {
                  const dia = dataDoCaixa(new Date(a.pagoEm));
                  return (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0 text-base">
                        <p>
                          <strong>{ddmmaaaa(dia)}</strong> · pago {formatarReais(a.pagoCentavos)}
                          {a.saldoDevedorCentavos > 0 && ` · ficou devendo ${formatarReais(a.saldoDevedorCentavos)}`}
                        </p>
                        <p className="text-sm text-suave">
                          {ddmm(a.periodoInicio)} a {ddmm(a.periodoFim)} · comissões {formatarReais(a.comissoesCentavos)} · vales {formatarReais(a.valesCentavos)}
                        </p>
                      </div>
                      <Link href={`/comissoes/acerto/${a.id}`} className={LINK_BOTAO} aria-label={`Imprimir acerto de ${ddmmaaaa(dia)} de ${m.nome}`}>
                        Imprimir
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      ))}

      {cancelar && (
        <Modal titulo="Cancelar vale" onFechar={() => setCancelar(null)}>
          <Motivo
            confirmar="Confirmar cancelamento"
            enviando="Cancelando…"
            perigo
            pendente={pendente}
            onVoltar={() => setCancelar(null)}
            onConfirmar={(motivo, onErro) =>
              enviar(async () => {
                const r = await seguro(() => cancelarValeAction({ valeId: cancelar, motivo }))();
                if (!r.ok && r.fieldErrors?.motivo) onErro(r.fieldErrors);
                else setCancelar(null); // demais erros aparecem no topo, fora do diálogo
                return r;
              })
            }
          />
        </Modal>
      )}
      {acerto && (
        <Modal titulo={`Acerto de ${acerto.nome}`} onFechar={() => setAcerto(null)}>
          <FazerAcerto membroId={acerto.id} hoje={hoje} caixaAberto={caixaAberto} onFeito={() => setAcerto(null)} />
        </Modal>
      )}
    </div>
  );
}

function ResumoConta({ conta }: { conta: Conta }) {
  return (
    <dl className="space-y-1 text-base">
      <Valor rotulo="Comissões pendentes" valor={conta.comissoesCentavos} />
      <Valor rotulo="Vales pendentes" valor={conta.valesCentavos} />
      <Valor rotulo="Saldo devedor anterior" valor={conta.saldoAnteriorCentavos} />
      <div className={cn('flex justify-between gap-2 border-t border-linha pt-2 text-lg font-bold', conta.saldoDevedorCentavos > 0 ? 'text-perigo' : 'text-tinta')}>
        <dt>{conta.saldoDevedorCentavos > 0 ? 'Fica devendo' : 'A pagar'}</dt>
        <dd>{formatarReais(conta.saldoDevedorCentavos || conta.pagoCentavos)}</dd>
      </div>
    </dl>
  );
}

function Valor({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-suave">{rotulo}</dt>
      <dd className="font-semibold">{formatarReais(valor)}</dd>
    </div>
  );
}

/** Prévia primeiro: o valor aparece antes de gravar; o servidor recalcula ao pagar. */
function FazerAcerto({ membroId, hoje, caixaAberto, onFeito }: { membroId: string; hoje: string; caixaAberto: boolean; onFeito: () => void }) {
  const { erros, erro, pendente, enviar } = useEnvio(() => {});
  const [ate, setAte] = useState(hoje);
  const [previa, setPrevia] = useState<Conta | null>(null);
  const [doCaixa, setDoCaixa] = useState(false);
  // "data no futuro" vem sem campo: aponta para a data
  const comCampo = (r: ActionResult<unknown>): ActionResult<unknown> => (!r.ok && r.code === 'VALIDACAO' && !r.fieldErrors ? { ...r, fieldErrors: { ate: [r.message] } } : r);
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        enviar(
          seguro(async () => {
            if (!previa) {
              const r = comCampo(await previaAcertoAction({ membroId, ate }));
              if (r.ok) setPrevia(r.data as Conta);
              return r;
            }
            const r = comCampo(await pagarAcertoAction({ membroId, ate, ...(doCaixa && previa.pagoCentavos > 0 && { doCaixa: true }) }));
            if (r.ok) onFeito();
            return r;
          }),
        );
      }}
    >
      <Campo
        id="acerto-ate"
        type="date"
        rotulo="Fazer acerto até"
        value={ate}
        max={hoje}
        onChange={(e) => {
          setAte(e.target.value);
          setPrevia(null); // outra data, outra conta
        }}
        erro={erros.ate?.[0]}
      />
      {previa && (
        <div role="status">
          <ResumoConta conta={previa} />
        </div>
      )}
      {previa && previa.pagoCentavos > 0 && caixaAberto && (
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" checked={doCaixa} onChange={(e) => setDoCaixa(e.target.checked)} className="size-5" /> Pago com dinheiro do caixa (hoje)
        </label>
      )}
      <Alerta texto={erros.ate ? '' : erro} />
      <div className="flex flex-wrap justify-end gap-2">
        {previa && (
          <Button type="button" variante="secundario" onClick={() => setPrevia(null)}>
            Corrigir
          </Button>
        )}
        <Button type="submit" disabled={pendente}>
          {!previa ? (pendente ? 'Calculando…' : 'Ver prévia') : pendente ? 'Pagando…' : 'Confirmar acerto'}
        </Button>
      </div>
    </form>
  );
}

function LancarVale({ ativos, caixaAberto }: { ativos: { id: string; nome: string }[]; caixaAberto: boolean }) {
  const { erros, erro, pendente, enviar, setErro, setErros } = useEnvio(() => {});
  const [doCaixa, setDoCaixa] = useState(false);
  return (
    <form
      noValidate
      aria-labelledby="comissoes-vale"
      className="space-y-4 rounded-3xl bg-white p-5 shadow-cartao"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
        const valorCentavos = decimalParaCentesimos(f.valor ?? '');
        if (valorCentavos === null) {
          setErros({ valorCentavos: ['Informe o valor em R$, por exemplo 50,00.'] });
          return setErro('Revise os campos destacados.');
        }
        enviar(
          seguro(async () => {
            const r = await lancarValeAction({ membroId: f.membroId, valorCentavos, ...(doCaixa && caixaAberto && { doCaixa: true }) });
            if (r.ok) {
              form.reset();
              setDoCaixa(false);
            }
            return r;
          }),
        );
      }}
    >
      <h2 id="comissoes-vale" className="text-lg font-bold text-tinta">
        Lançar vale
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="vale-membro">Membro</Label>
          <select id="vale-membro" name="membroId" className={campoSelect} aria-invalid={erros.membroId ? true : undefined} aria-describedby={erros.membroId ? 'vale-membro-erro' : undefined}>
            {ativos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
          </select>
          {erros.membroId && (
            <p id="vale-membro-erro" className="text-sm font-medium text-perigo">
              {erros.membroId[0]}
            </p>
          )}
        </div>
        <Campo id="vale-valor" name="valor" rotulo="Valor do vale (R$)" inputMode="decimal" autoComplete="off" erro={erros.valorCentavos?.[0]} />
      </div>
      {caixaAberto && (
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" checked={doCaixa} onChange={(e) => setDoCaixa(e.target.checked)} className="size-5" /> Pago com dinheiro do caixa (hoje)
        </label>
      )}
      <Alerta texto={erro} />
      <Button type="submit" disabled={pendente || ativos.length === 0}>
        {pendente ? 'Lançando…' : 'Lançar vale'}
      </Button>
    </form>
  );
}

export function BotaoImprimir() {
  return (
    <Button onClick={() => window.print()} className="print:hidden">
      Imprimir
    </Button>
  );
}
