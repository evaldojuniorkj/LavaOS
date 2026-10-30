'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Alerta } from '@/components/catalogo-form';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useEventos } from '@/components/use-eventos';
import type { ActionResult } from '@/modules/catalogo/catalogo.actions';
import { centesimosParaTexto, decimalParaCentesimos } from '@/modules/catalogo/catalogo.rules';
import { ajustarValorAction, atribuirResponsavelAction, editarItensAction, listarFilaAction, listarLavadoresAction, transitarOsAction } from '@/modules/ordens/ordens.actions';
import { ERROS_RECARREGAR_FILA, type StatusOs } from '@/modules/ordens/ordens.rules';
import type { OsView, OsViewGestao } from '@/modules/ordens/ordens.views';
import { cn } from '@/lib/utils';

export type Pode = { assumir: boolean; atribuir: boolean; corrigir: boolean; entregar: boolean; cancelar: boolean; ajustarValor: boolean; verValores: boolean };
type Lavador = { membroId: string; nome: string; livre: boolean; sugerido: boolean };
type Dialogo = { tipo: 'direcionar' | 'iniciar' | 'cancelar' | 'editar'; osId: string };

const COLUNAS: { status: StatusOs; titulo: string }[] = [
  { status: 'aguardando', titulo: 'Aguardando' },
  { status: 'em_lavagem', titulo: 'Em lavagem' },
  { status: 'pronto', titulo: 'Pronto' },
];
const comValores = (os: OsView): os is OsViewGestao => 'totalCentavos' in os; // a visão do lavador não tem nenhum valor
const reais = (c: number) => `R$ ${centesimosParaTexto(c)}`;
const erroDe = (r: Extract<ActionResult<unknown>, { ok: false }>) =>
  r.code === 'ACESSO_NEGADO' ? 'Seu perfil não pode fazer isso.' : r.code === 'VALIDACAO' ? (Object.values(r.fieldErrors ?? {})[0]?.[0] ?? 'Dados inválidos.') : r.message;

function tempoDesde(d: Date, agora: number) {
  const min = Math.max(0, Math.floor((agora - new Date(d).getTime()) / 60_000));
  return min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** Fila em tempo real: o servidor manda a visão do perfil; cada evento SSE só dispara uma recarga. */
export function FilaBoard({ inicial, pode, meuId, servicos }: { inicial: OsView[]; pode: Pode; meuId: string; servicos: { id: string; nome: string }[] }) {
  const [fila, setFila] = useState(inicial);
  const [erro, setErro] = useState('');
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [pendente, iniciar] = useTransition();
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const seq = useRef(0);
  const focar = useRef<{ el: Element | null; osId: string; aposRecarga: boolean } | null>(null);
  const recarregar = useCallback(async () => {
    const n = ++seq.current; // recargas podem se sobrepor (SSE e ação): só a mais recente vale
    const r = await listarFilaAction();
    if (!r.ok || n !== seq.current) return;
    if (focar.current) focar.current.aposRecarga = false;
    setFila(r.data);
  }, []);

  // diálogo fechado por uma ação: o foco volta a quem o abriu ou, se o botão sumiu na recarga, ao cartão (Esc/✕ o navegador já devolve)
  const abridor = useRef<{ el: Element | null; osId: string } | null>(null);
  const abrirDialogo = (tipo: Dialogo['tipo'], osId: string) => {
    abridor.current = { el: document.activeElement, osId };
    setDialogo({ tipo, osId });
  };
  useEffect(() => {
    const alvo = focar.current;
    if (dialogo || !alvo || alvo.aposRecarga) return; // espera a fila nova para achar o botão/cartão certo
    focar.current = null;
    ((alvo.el?.isConnected ? alvo.el : document.getElementById(`os-${alvo.osId}`)) as HTMLElement | null)?.focus();
  }, [dialogo, fila]);
  const { reconectando } = useEventos(recarregar);

  /** Executa a action; conflito e afins mostram a mensagem e recarregam. Erros de campo voltam para o diálogo. */
  const executar = (acao: () => Promise<ActionResult<unknown>>, onErroCampo?: (e: Record<string, string[]>) => void, manterAberto = false) =>
    iniciar(async () => {
      const r = await acao();
      if (!r.ok && r.code === 'VALIDACAO' && r.fieldErrors && onErroCampo) return onErroCampo(r.fieldErrors);
      const recarga = r.ok || (ERROS_RECARREGAR_FILA as readonly string[]).includes(r.code);
      setErro(r.ok ? '' : erroDe(r));
      if (!r.ok || !manterAberto) {
        focar.current = abridor.current && { ...abridor.current, aposRecarga: recarga };
        setDialogo(null);
      }
      if (recarga) await recarregar();
    });

  const transitar = (os: OsView, para: StatusOs, extra: { responsavelId?: string; motivo?: string } = {}, onErroCampo?: (e: Record<string, string[]>) => void) =>
    executar(() => transitarOsAction({ osId: os.id, esperado: os.status, para, ...extra }), onErroCampo);

  const aberta = dialogo && fila.find((o) => o.id === dialogo.osId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-tinta">Fila</h1>
        <p role="status" className="empty:hidden rounded-md bg-sinal/25 px-3 py-1 text-sm font-semibold text-tinta">
          {reconectando ? 'Reconectando…' : ''}
        </p>
      </div>
      <Alerta texto={erro} />
      <div className="grid gap-4 md:grid-cols-3">
        {COLUNAS.map((c) => {
          const lista = fila.filter((o) => o.status === c.status);
          return (
            <section key={c.status} aria-labelledby={`coluna-${c.status}`} className="min-w-0 space-y-3 rounded-lg bg-white/60 p-3">
              <h2 id={`coluna-${c.status}`} className="flex items-center justify-between text-lg font-bold text-tinta">
                {c.titulo}
                <span className="rounded-full bg-tinta px-2.5 text-sm text-white">{lista.length}</span>
              </h2>
              {lista.length === 0 && <p className="text-sm text-suave">Nenhuma OS.</p>}
              {lista.map((os) => (
                <Cartao key={os.id} os={os} agora={agora} pode={pode} meuId={meuId} pendente={pendente} onTransitar={transitar} onDialogo={(tipo) => abrirDialogo(tipo, os.id)} />
              ))}
            </section>
          );
        })}
      </div>
      {aberta && (
        <Modal key={`${dialogo.tipo}-${aberta.id}`} onFechar={() => setDialogo(null)} titulo={tituloDialogo(dialogo.tipo, aberta)}>
          {(dialogo.tipo === 'direcionar' || dialogo.tipo === 'iniciar') && (
            <EscolherLavador
              semResponsavel={dialogo.tipo === 'direcionar'}
              pendente={pendente}
              onEscolher={(membroId) =>
                dialogo.tipo === 'iniciar' ? transitar(aberta, 'em_lavagem', { responsavelId: membroId! }) : executar(() => atribuirResponsavelAction({ osId: aberta.id, membroId }))
              }
            />
          )}
          {dialogo.tipo === 'cancelar' && <Cancelar pendente={pendente} onConfirmar={(motivo, onErro) => transitar(aberta, 'cancelada', { motivo }, onErro)} onVoltar={() => setDialogo(null)} />}
          {dialogo.tipo === 'editar' && <EditarOs os={aberta} servicos={servicos} pode={pode} pendente={pendente} executar={(acao, onErro) => executar(acao, onErro, true)} />}
        </Modal>
      )}
    </div>
  );
}

function tituloDialogo(tipo: Dialogo['tipo'], os: OsView) {
  if (tipo === 'iniciar') return `Iniciar lavagem da OS ${os.numero}: quem lava?`;
  if (tipo === 'cancelar') return `Cancelar OS ${os.numero}`;
  if (tipo === 'editar') return `Editar OS ${os.numero}`;
  return os.responsavel ? `Trocar responsável da OS ${os.numero}` : `Direcionar OS ${os.numero}`;
}

function Cartao({ os, agora, pode, meuId, pendente, onTransitar, onDialogo }: {
  os: OsView;
  agora: number;
  pode: Pode;
  meuId: string;
  pendente: boolean;
  onTransitar: (os: OsView, para: StatusOs, extra?: { responsavelId: string }) => void;
  onDialogo: (tipo: Dialogo['tipo']) => void;
}) {
  const meu = os.responsavel?.id === meuId;
  const acoes: { rotulo: string; fazer: () => void; variante?: 'primario' | 'secundario' | 'perigo' }[] = [];
  if (os.status === 'aguardando') {
    if (pode.assumir && !os.responsavel) acoes.push({ rotulo: 'Pegar', fazer: () => onTransitar(os, 'em_lavagem') });
    if (pode.atribuir) {
      acoes.push({
        rotulo: 'Iniciar lavagem',
        variante: pode.assumir && !os.responsavel ? 'secundario' : 'primario',
        // com responsável já direcionado, inicia com ele; sem, o balcão escolhe quem lava
        fazer: () => (os.responsavel ? onTransitar(os, 'em_lavagem', { responsavelId: os.responsavel.id }) : onDialogo('iniciar')),
      });
    } else if (meu) acoes.push({ rotulo: 'Iniciar lavagem', fazer: () => onTransitar(os, 'em_lavagem') });
  }
  if (os.status === 'em_lavagem' && (pode.atribuir || meu)) acoes.push({ rotulo: 'Marcar pronto', fazer: () => onTransitar(os, 'pronto') });
  if (os.status === 'pronto' && pode.entregar) acoes.push({ rotulo: 'Entregar', fazer: () => onTransitar(os, 'entregue') });
  if (pode.corrigir && os.status !== 'aguardando') acoes.push({ rotulo: 'Voltar status', variante: 'secundario', fazer: () => onTransitar(os, os.status === 'pronto' ? 'em_lavagem' : 'aguardando') });
  if (pode.atribuir) acoes.push({ rotulo: os.responsavel ? 'Trocar responsável' : 'Direcionar', variante: 'secundario', fazer: () => onDialogo('direcionar') });
  if (pode.corrigir) acoes.push({ rotulo: 'Editar', variante: 'secundario', fazer: () => onDialogo('editar') });
  if (pode.cancelar) acoes.push({ rotulo: 'Cancelar', variante: 'secundario', fazer: () => onDialogo('cancelar') });

  const detalhes = [os.veiculo.modelo, os.veiculo.cor].filter(Boolean).join(', ');
  return (
    <article id={`os-${os.id}`} tabIndex={-1} aria-label={`OS ${os.numero} ${os.veiculo.placa}`} className="space-y-3 rounded-lg border border-linha bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-suave">OS {os.numero}</p>
          <h3 className="mt-1 inline-block rounded border-2 border-tinta border-t-[6px] border-t-agua bg-white px-2 font-mono text-2xl font-bold tracking-widest text-tinta">{os.veiculo.placa}</h3>
          {detalhes && <p className="text-base text-tinta">{detalhes}</p>}
          {os.cliente && <p className="text-sm text-suave">{os.cliente.nome}</p>}
        </div>
        <p className="shrink-0 text-sm font-semibold text-suave" suppressHydrationWarning>
          {tempoDesde(os.entradaEm, agora)}
        </p>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {os.itens.map((i) => (
          <li key={i.id} className="rounded bg-enxague px-2 py-0.5 text-sm font-medium text-tinta">
            {i.nome}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={cn('text-base', os.responsavel ? 'font-semibold text-tinta' : 'text-suave italic')}>{os.responsavel?.nomeExibicao ?? 'Sem responsável'}</p>
        {comValores(os) && <p className="text-lg font-bold text-tinta">{reais(os.totalCentavos)}</p>}
      </div>
      {acoes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {acoes.map((a) => (
            <Button key={a.rotulo} variante={a.variante} disabled={pendente} onClick={a.fazer} className="px-3">
              {a.rotulo}
            </Button>
          ))}
        </div>
      )}
    </article>
  );
}

/** <dialog> nativo: foco preso, Esc fecha e o resto da página fica inerte. */
function Modal({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialogo-titulo"
      onClose={onFechar}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg border border-linha bg-white p-5 text-tinta backdrop:bg-tinta/50"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 id="dialogo-titulo" className="text-lg font-bold">
          {titulo}
        </h2>
        <Button variante="secundario" className="px-3" onClick={() => ref.current?.close()} aria-label="Fechar">
          ✕
        </Button>
      </div>
      {children}
    </dialog>
  );
}

/** Direcionar é opcional e a sugestão é só orientação: qualquer lavador ativo pode ser escolhido, ocupado ou não. */
function EscolherLavador({ semResponsavel, pendente, onEscolher }: { semResponsavel: boolean; pendente: boolean; onEscolher: (membroId: string | null) => void }) {
  const [lavadores, setLavadores] = useState<Lavador[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    listarLavadoresAction().then((r) => (r.ok ? setLavadores(r.data) : setErro(erroDe(r))));
  }, []);
  if (erro) return <Alerta texto={erro} />;
  if (!lavadores) return <p className="text-suave">Carregando lavadores…</p>;
  return (
    <ul className="space-y-2">
      {lavadores.map((l) => (
        <li key={l.membroId}>
          <Button
            variante="secundario"
            disabled={pendente}
            onClick={() => onEscolher(l.membroId)}
            className={cn('w-full justify-between gap-3 text-left', l.sugerido && 'border-2 border-agua bg-agua/5')}
          >
            <span>{l.nome}</span>
            <span className="flex gap-2 text-sm">
              <span className={cn('rounded px-2 py-0.5 font-semibold', l.livre ? 'bg-agua/10 text-agua-escura' : 'bg-sinal/30 text-tinta')}>{l.livre ? 'Livre' : 'Ocupado'}</span>
              {l.sugerido && <span className="rounded bg-agua px-2 py-0.5 font-semibold text-white">Sugerido</span>}
            </span>
          </Button>
        </li>
      ))}
      {lavadores.length === 0 && <li className="text-suave">Nenhum lavador ativo.</li>}
      {semResponsavel && (
        <li>
          <Button variante="secundario" disabled={pendente} onClick={() => onEscolher(null)} className="w-full">
            Sem responsável
          </Button>
        </li>
      )}
    </ul>
  );
}

function Cancelar({ pendente, onConfirmar, onVoltar }: { pendente: boolean; onConfirmar: (motivo: string, onErro: (e: Record<string, string[]>) => void) => void; onVoltar: () => void }) {
  const [erroMotivo, setErroMotivo] = useState('');
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const motivo = String(new FormData(e.currentTarget).get('motivo') ?? '').trim();
        if (!motivo) return setErroMotivo('Informe o motivo.');
        onConfirmar(motivo, (erros) => setErroMotivo(erros.motivo?.[0] ?? 'Revise o motivo.'));
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="cancelar-motivo">Motivo</Label>
        <textarea
          id="cancelar-motivo"
          name="motivo"
          rows={3}
          maxLength={500}
          aria-invalid={erroMotivo ? true : undefined}
          aria-describedby={erroMotivo ? 'cancelar-motivo-erro' : undefined}
          className="block w-full rounded-md border border-linha bg-white p-3 text-base aria-invalid:border-perigo"
        />
        {erroMotivo && (
          <p id="cancelar-motivo-erro" className="text-sm font-medium text-perigo">
            {erroMotivo}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variante="secundario" onClick={onVoltar}>
          Voltar
        </Button>
        <Button type="submit" variante="perigo" disabled={pendente}>
          {pendente ? 'Cancelando…' : 'Confirmar cancelamento'}
        </Button>
      </div>
    </form>
  );
}

/** Itens (os:corrigir) e desconto/acréscimo (os:ajustar_valor); preço e total sempre vêm do servidor. */
function EditarOs({ os, servicos, pode, pendente, executar }: {
  os: OsView;
  servicos: { id: string; nome: string }[];
  pode: Pode;
  pendente: boolean;
  executar: (acao: () => Promise<ActionResult<unknown>>, onErroCampo?: (e: Record<string, string[]>) => void) => void;
}) {
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const [adicionar, setAdicionar] = useState('');
  const naOs = new Set(os.itens.map((i) => i.nome));
  const editarItens = (mudanca: { adicionar?: string[]; remover?: string[] }) => {
    setErros({});
    executar(() => editarItensAction({ osId: os.id, adicionar: mudanca.adicionar ?? [], remover: mudanca.remover ?? [] }), setErros);
  };
  // shortcut: oferece o catálogo todo (sem o porte da OS na visão); o servidor recusa o que não tem preço no porte, com mensagem no campo
  return (
    <div className="space-y-5">
      <ul className="divide-y divide-linha rounded-md border border-linha">
        {os.itens.map((i) => (
          <li key={i.id} className="flex items-center justify-between gap-3 p-2 pl-3">
            <span>
              {i.nome}
              {'valorCentavos' in i && <span className="ml-2 text-suave">{reais(i.valorCentavos)}</span>}
            </span>
            <Button variante="secundario" className="px-3" disabled={pendente} onClick={() => editarItens({ remover: [i.id] })} aria-label={`Remover ${i.nome}`}>
              Remover
            </Button>
          </li>
        ))}
      </ul>
      {erros.remover?.[0] && <p className="text-sm font-medium text-perigo">{erros.remover[0]}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="editar-adicionar">Adicionar serviço</Label>
          <select
            id="editar-adicionar"
            value={adicionar}
            onChange={(e) => setAdicionar(e.target.value)}
            aria-invalid={erros.adicionar ? true : undefined}
            aria-describedby={erros.adicionar ? 'editar-adicionar-erro' : undefined}
            className="block min-h-11 w-full rounded-md border border-linha bg-white px-3 text-base aria-invalid:border-perigo"
          >
            <option value="">Escolha</option>
            {servicos.filter((s) => !naOs.has(s.nome)).map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome}
              </option>
            ))}
          </select>
        </div>
        <Button variante="secundario" disabled={pendente || !adicionar} onClick={() => editarItens({ adicionar: [adicionar] })}>
          Adicionar
        </Button>
        {erros.adicionar?.[0] && (
          <p id="editar-adicionar-erro" className="w-full text-sm font-medium text-perigo">
            {erros.adicionar[0]}
          </p>
        )}
      </div>
      {pode.ajustarValor && comValores(os) && (
        <form
          key={`${os.descontoCentavos}-${os.acrescimoCentavos}`}
          noValidate
          className="space-y-3 border-t border-linha pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const desconto = decimalParaCentesimos(String(f.get('desconto') ?? '') || '0');
            const acrescimo = decimalParaCentesimos(String(f.get('acrescimo') ?? '') || '0');
            const local = { ...(desconto === null && { descontoCentavos: ['Informe em R$, por exemplo 5,00.'] }), ...(acrescimo === null && { acrescimoCentavos: ['Informe em R$, por exemplo 5,00.'] }) };
            if (desconto === null || acrescimo === null) return setErros(local);
            executar(() => ajustarValorAction({ osId: os.id, descontoCentavos: desconto, acrescimoCentavos: acrescimo }), setErros);
          }}
        >
          <p className="font-semibold">Total: {reais(os.totalCentavos)}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="editar-desconto" name="desconto" rotulo="Desconto (R$)" inputMode="decimal" defaultValue={centesimosParaTexto(os.descontoCentavos)} erro={erros.descontoCentavos?.[0]} autoComplete="off" />
            <Campo id="editar-acrescimo" name="acrescimo" rotulo="Acréscimo (R$)" inputMode="decimal" defaultValue={centesimosParaTexto(os.acrescimoCentavos)} erro={erros.acrescimoCentavos?.[0]} autoComplete="off" />
          </div>
          <Button type="submit" variante="secundario" disabled={pendente}>
            {pendente ? 'Salvando…' : 'Salvar valores'}
          </Button>
        </form>
      )}
    </div>
  );
}
