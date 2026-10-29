'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { definirPrecoAction, salvarPorteAction, salvarServicoAction, type ActionResult } from '@/modules/catalogo/catalogo.actions';
import type { Porte, ServicoComPrecos } from '@/modules/catalogo/catalogo.repo';
import { centesimosParaTexto, decimalParaCentesimos } from '@/modules/catalogo/catalogo.rules';

type Erros = Record<string, string[] | undefined>;
const erroDe = (r: ActionResult<unknown>) => (r.ok ? '' : r.code === 'VALIDACAO' ? 'Revise os campos destacados.' : r.message);
const reais = (c: number) => `R$ ${centesimosParaTexto(c)}`;
const campoSelect = 'block min-h-11 w-full rounded-md border border-linha bg-white px-3 text-base';

function Alerta({ texto }: { texto: string }) {
  return texto ? (
    <p role="alert" className="rounded-md border border-perigo/30 bg-perigo/5 p-3 text-sm font-medium text-perigo">
      {texto}
    </p>
  ) : null;
}

/** Envia uma action, mostra erros e atualiza a página. A validação final é sempre do servidor. */
function useEnvio(onOk: (r: ActionResult<never>) => void) {
  const router = useRouter();
  const [erros, setErros] = useState<Erros>({});
  const [erro, setErro] = useState('');
  const [pendente, iniciar] = useTransition();
  const enviar = (acao: () => Promise<ActionResult<unknown>>) =>
    iniciar(async () => {
      const r = await acao();
      setErros(r.ok ? {} : (r.fieldErrors ?? {}));
      setErro(erroDe(r));
      if (!r.ok) return;
      onOk(r as ActionResult<never>);
      router.refresh();
    });
  return { erros, erro, pendente, enviar, setErro, setErros };
}

/** Catálogo mínimo: portes, serviços (com comissão obrigatória) e preço por porte. Centavos só viram R$ aqui. */
export function CatalogoForm({ portes, servicos }: { portes: Porte[]; servicos: ServicoComPrecos[] }) {
  const [aviso, setAviso] = useState('');
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-tinta">Catálogo</h1>
      <p role="status" className="empty:hidden rounded-md bg-agua/10 p-3 text-sm font-medium text-tinta">
        {aviso}
      </p>
      <section aria-labelledby="portes-titulo" className="space-y-3">
        <h2 id="portes-titulo" className="text-lg font-bold">
          Portes
        </h2>
        <ul className="divide-y divide-linha rounded-lg border border-linha bg-white">
          {portes.map((p) => (
            <li key={p.id} className="p-4">
              <PorteForm porte={p} onAviso={setAviso} />
            </li>
          ))}
          <li className="p-4">
            <PorteForm onAviso={setAviso} />
          </li>
        </ul>
      </section>
      <section aria-labelledby="servicos-titulo" className="space-y-3">
        <h2 id="servicos-titulo" className="text-lg font-bold">
          Serviços
        </h2>
        {portes.length === 0 && <p className="text-suave">Cadastre ao menos um porte para definir preços.</p>}
        <ul className="space-y-4">
          {servicos.map((s) => (
            <li key={s.id} className="space-y-4 rounded-lg border border-linha bg-white p-4">
              <ServicoForm servico={s} onAviso={setAviso} />
              {portes.length > 0 && (
                <div className="space-y-3 border-t border-linha pt-4">
                  <h3 className="font-semibold">Preços</h3>
                  {portes.map((p) => (
                    <PrecoForm key={`${p.id}-${s.precos.find((x) => x.porteId === p.id)?.valorCentavos}`} servico={s} porte={p} onAviso={setAviso} />
                  ))}
                </div>
              )}
            </li>
          ))}
          <li className="rounded-lg border border-linha bg-white p-4">
            <ServicoForm onAviso={setAviso} />
          </li>
        </ul>
      </section>
    </div>
  );
}

function PorteForm({ porte, onAviso }: { porte?: Porte; onAviso: (t: string) => void }) {
  const { erros, erro, pendente, enviar } = useEnvio(() => onAviso(porte ? 'Porte salvo.' : 'Porte cadastrado.'));
  const sufixo = porte?.id ?? 'novo';
  return (
    <form
      noValidate
      aria-label={porte ? `Porte ${porte.nome}` : 'Novo porte'}
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        enviar(async () => {
          const r = await salvarPorteAction({ id: porte?.id, nome: String(f.get('nome') ?? ''), ativo: porte ? f.get('ativo') === 'on' : undefined });
          if (r.ok && !porte) form.reset();
          return r;
        });
      }}
    >
      <div className="min-w-48 flex-1">
        <Campo id={`porte-nome-${sufixo}`} name="nome" rotulo={porte ? 'Nome do porte' : 'Novo porte'} defaultValue={porte?.nome} erro={erros.nome?.[0]} autoComplete="off" />
      </div>
      {porte && (
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" name="ativo" defaultChecked={porte.ativo} className="size-5" /> Ativo
        </label>
      )}
      <Button type="submit" variante="secundario" disabled={pendente}>
        {pendente ? 'Salvando…' : porte ? 'Salvar' : 'Adicionar porte'}
      </Button>
      <div className="w-full empty:hidden">
        <Alerta texto={erro} />
      </div>
    </form>
  );
}

function ServicoForm({ servico, onAviso }: { servico?: ServicoComPrecos; onAviso: (t: string) => void }) {
  const { erros, erro, pendente, enviar, setErro, setErros } = useEnvio(() => onAviso(servico ? 'Serviço salvo.' : 'Serviço cadastrado.'));
  const [tipo, setTipo] = useState<'percentual' | 'fixo'>(servico?.comissaoTipo ?? 'percentual');
  const sufixo = servico?.id ?? 'novo';
  const comissaoInicial = servico ? centesimosParaTexto(servico.comissaoValor) : '';

  function submeter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const comissaoValor = decimalParaCentesimos(f.comissaoValor ?? '');
    const duracao = (f.duracaoEstimadaMin ?? '').trim();
    if (comissaoValor === null) {
      setErros({ comissaoValor: [tipo === 'percentual' ? 'Informe a comissão em %, por exemplo 30 ou 12,5.' : 'Informe a comissão em R$, por exemplo 8,00.'] });
      setErro('Revise os campos destacados.');
      return;
    }
    enviar(async () => {
      const r = await salvarServicoAction({
        id: servico?.id,
        nome: f.nome,
        descricao: f.descricao?.trim() || null,
        duracaoEstimadaMin: /^\d+$/.test(duracao) ? Number(duracao) : duracao ? Number.NaN : null,
        adicional: 'adicional' in f,
        comissaoTipo: tipo,
        comissaoValor, // % ou R$ com 2 casas: ×100 = pontos-base ou centavos
        ativo: servico ? 'ativo' in f : undefined,
      });
      if (r.ok && !servico) form.reset();
      return r;
    });
  }

  return (
    <form noValidate aria-label={servico ? `Serviço ${servico.nome}` : 'Novo serviço'} onSubmit={submeter} className="space-y-4">
      {!servico && <h3 className="font-semibold">Novo serviço</h3>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo id={`servico-nome-${sufixo}`} name="nome" rotulo="Nome" defaultValue={servico?.nome} erro={erros.nome?.[0]} autoComplete="off" />
        <Campo id={`servico-duracao-${sufixo}`} name="duracaoEstimadaMin" rotulo="Duração estimada (min)" inputMode="numeric" defaultValue={servico?.duracaoEstimadaMin ?? ''} erro={erros.duracaoEstimadaMin?.[0]} />
        <Campo id={`servico-descricao-${sufixo}`} name="descricao" rotulo="Descrição" defaultValue={servico?.descricao ?? ''} erro={erros.descricao?.[0]} autoComplete="off" />
        <div className="space-y-1.5">
          <Label htmlFor={`servico-tipo-${sufixo}`}>Tipo de comissão</Label>
          <select id={`servico-tipo-${sufixo}`} value={tipo} onChange={(e) => setTipo(e.target.value as 'percentual' | 'fixo')} className={campoSelect}>
            <option value="percentual">Percentual (%)</option>
            <option value="fixo">Valor fixo (R$)</option>
          </select>
        </div>
        <Campo
          id={`servico-comissao-${sufixo}`}
          name="comissaoValor"
          rotulo={tipo === 'percentual' ? 'Comissão (%)' : 'Comissão (R$)'}
          inputMode="decimal"
          defaultValue={comissaoInicial}
          erro={erros.comissaoValor?.[0]}
          autoComplete="off"
        />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <label className="flex min-h-11 items-center gap-2 text-base">
          <input type="checkbox" name="adicional" defaultChecked={servico?.adicional} className="size-5" /> Adicional (só após um serviço principal)
        </label>
        {servico && (
          <label className="flex min-h-11 items-center gap-2 text-base">
            <input type="checkbox" name="ativo" defaultChecked={servico.ativo} className="size-5" /> Ativo
          </label>
        )}
      </div>
      <Alerta texto={erro} />
      <Button type="submit" disabled={pendente}>
        {pendente ? 'Salvando…' : servico ? 'Salvar serviço' : 'Cadastrar serviço'}
      </Button>
    </form>
  );
}

function PrecoForm({ servico, porte, onAviso }: { servico: ServicoComPrecos; porte: Porte; onAviso: (t: string) => void }) {
  const atual = servico.precos.find((p) => p.porteId === porte.id)?.valorCentavos;
  const { erros, erro, pendente, enviar, setErro, setErros } = useEnvio(() => onAviso(`Preço de ${servico.nome} (${porte.nome}) salvo.`));
  const id = `preco-${servico.id}-${porte.id}`;
  return (
    <form
      noValidate
      aria-label={`Preço de ${servico.nome} para ${porte.nome}`}
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const valorCentavos = decimalParaCentesimos(String(new FormData(e.currentTarget).get(id) ?? ''));
        if (valorCentavos === null) {
          setErros({ [id]: ['Informe o valor em R$, por exemplo 50,00.'] });
          setErro('Revise os campos destacados.');
          return;
        }
        enviar(() => definirPrecoAction({ servicoId: servico.id, porteId: porte.id, valorCentavos }));
      }}
    >
      <Campo id={id} rotulo={`${porte.nome}${porte.ativo ? '' : ' (inativo)'} — R$`} inputMode="decimal" defaultValue={atual === undefined ? '' : centesimosParaTexto(atual)} placeholder={atual === undefined ? 'Sem preço' : undefined} erro={erros[id]?.[0] ?? erros.valorCentavos?.[0]} autoComplete="off" />
      <Button type="submit" variante="secundario" disabled={pendente}>
        {pendente ? 'Salvando…' : 'Salvar preço'}
      </Button>
      {atual !== undefined && <span className="sr-only">Preço atual {reais(atual)}</span>}
      <div className="w-full empty:hidden">
        <Alerta texto={erro} />
      </div>
    </form>
  );
}
