'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Alerta } from '@/components/catalogo-form';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionResult } from '@/modules/catalogo/catalogo.actions';
import type { Porte } from '@/modules/catalogo/catalogo.repo';
import { centesimosParaTexto } from '@/modules/catalogo/catalogo.rules';
import { buscarPorPlacaAction, cadastroRapidoAction } from '@/modules/clientes/clientes.actions';
import { normalizarPlaca } from '@/modules/clientes/clientes.rules';
import { abrirOsAction } from '@/modules/ordens/ordens.actions';

type Servico = { id: string; nome: string; adicional: boolean; valorCentavos?: number };
type Lavador = { membroId: string; nome: string; livre: boolean; sugerido: boolean };
type Erros = Record<string, string[] | undefined>;
type Busca = { placa: string } & ({ achado: true; veiculoId: string; modelo: string | null; porteId: string; cliente: string | null } | { achado: false });

const campoSelect = 'block min-h-11 w-full rounded-md border border-linha bg-white px-3 text-base aria-invalid:border-perigo';
const PLACA_INVALIDA = 'Placa inválida. Use AAA-1234 ou AAA1B23.';
const mensagem = (r: Extract<ActionResult<unknown>, { ok: false }>) => (r.code === 'VALIDACAO' ? 'Revise os campos destacados.' : r.code === 'ACESSO_NEGADO' ? 'Seu perfil não pode fazer isso.' : r.message);

/**
 * Nova OS pela placa: achou ⇒ usa o veículo; não achou ⇒ cadastro rápido. Serviços do porte do veículo
 * (valores só chegam para quem vê R$). Responsável é opcional e só para o balcão (`lavadores` != null).
 */
export function NovaOsForm({ portes, servicos, lavadores }: { portes: Porte[]; servicos: Record<string, Servico[]>; lavadores: Lavador[] | null }) {
  const router = useRouter();
  const [placa, setPlaca] = useState('');
  const [busca, setBusca] = useState<Busca | null>(null);
  const [porteId, setPorteId] = useState('');
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [veiculoCriado, setVeiculoCriado] = useState<string | null>(null);
  const [erros, setErros] = useState<Erros>({});
  const [erro, setErro] = useState('');
  const [buscando, iniciarBusca] = useTransition();
  const [abrindo, iniciarAbertura] = useTransition();

  const porteDoVeiculo = busca?.achado ? busca.porteId : porteId;
  const lista = servicos[porteDoVeiculo] ?? [];
  const principais = lista.filter((s) => !s.adicional);
  const temPrincipal = principais.some((s) => selecionados.includes(s.id));
  const visiveis = temPrincipal ? lista : principais; // adicional só aparece depois de um principal
  const enviados = selecionados.filter((id) => visiveis.some((s) => s.id === id));

  function buscar() {
    const p = normalizarPlaca(placa);
    setErro('');
    if (!p) return setErros({ placa: [PLACA_INVALIDA] });
    setErros({});
    iniciarBusca(async () => {
      const r = await buscarPorPlacaAction({ placa: p });
      if (!r.ok) return setErro(mensagem(r));
      setSelecionados([]);
      setVeiculoCriado(null);
      setBusca(r.data ? { placa: p, achado: true, veiculoId: r.data.veiculo.id, modelo: r.data.veiculo.modelo, porteId: r.data.veiculo.porteId, cliente: r.data.cliente?.nome ?? null } : { placa: p, achado: false });
    });
  }

  function abrir(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const locais: Erros = {
      ...(!busca && { placa: ['Busque a placa antes de abrir a OS.'] }),
      ...(busca && !busca.achado && !porteId && { porteId: ['Escolha o porte.'] }),
      ...(busca && porteDoVeiculo && enviados.length === 0 && { servicoIds: ['Escolha ao menos um serviço.'] }),
    };
    setErros(locais);
    setErro('');
    if (Object.keys(locais).length || !busca) return;
    iniciarAbertura(async () => {
      let veiculoId = busca.achado ? busca.veiculoId : veiculoCriado;
      if (!veiculoId) {
        const c = await cadastroRapidoAction({ placa: busca.placa, porteId, modelo: f.modelo?.trim() || null, clienteNome: f.clienteNome?.trim() || null, telefone: f.telefone?.trim() || null });
        if (!c.ok) {
          setErros(c.fieldErrors ?? {});
          return setErro(mensagem(c));
        }
        veiculoId = c.data.veiculoId;
        setVeiculoCriado(veiculoId); // nova tentativa não cadastra de novo
      }
      const r = await abrirOsAction({ veiculoId, servicoIds: enviados, ...(f.responsavelId && { responsavelId: f.responsavelId }) });
      if (!r.ok) {
        setErros(r.fieldErrors ?? {});
        return setErro(mensagem(r));
      }
      router.push('/fila');
    });
  }

  const nomePorte = (id: string) => portes.find((p) => p.id === id)?.nome ?? '';
  return (
    <form noValidate onSubmit={abrir} className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-tinta">Nova OS</h1>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <Campo
            id="placa"
            rotulo="Placa"
            value={placa}
            onChange={(e) => {
              setPlaca(e.target.value);
              setBusca(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault(); // Enter na placa busca; não abre a OS
              buscar();
            }}
            erro={erros.placa?.[0]}
            autoComplete="off"
            autoCapitalize="characters"
            className="font-mono text-lg uppercase tracking-wider"
          />
        </div>
        <Button type="button" variante="secundario" onClick={buscar} disabled={buscando}>
          {buscando ? 'Buscando…' : 'Buscar placa'}
        </Button>
      </div>

      {busca?.achado && (
        <section aria-label="Veículo encontrado" className="rounded-lg border border-linha bg-white p-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="font-semibold">Modelo</dt>
            <dd>{busca.modelo ?? '—'}</dd>
            <dt className="font-semibold">Porte</dt>
            <dd>{nomePorte(busca.porteId)}</dd>
            <dt className="font-semibold">Cliente</dt>
            <dd>{busca.cliente ?? 'Sem cliente'}</dd>
          </dl>
        </section>
      )}

      {busca && !busca.achado && (
        <section aria-labelledby="cadastro-titulo" className="space-y-4 rounded-lg border border-linha bg-white p-4">
          <h2 id="cadastro-titulo" className="font-bold">
            Placa nova: cadastre o veículo
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="porteId">Porte</Label>
              <select
                id="porteId"
                value={porteId}
                disabled={!!veiculoCriado} // veículo já cadastrado com este porte: preços mostrados seguem o dele
                onChange={(e) => {
                  setPorteId(e.target.value);
                  setSelecionados([]);
                }}
                aria-invalid={erros.porteId ? true : undefined}
                aria-describedby={erros.porteId ? 'porteId-erro' : undefined}
                className={campoSelect}
              >
                <option value="" disabled>
                  Escolha
                </option>
                {portes
                  .filter((p) => p.ativo)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
              </select>
              {erros.porteId?.[0] && (
                <p id="porteId-erro" className="text-sm font-medium text-perigo">
                  {erros.porteId[0]}
                </p>
              )}
            </div>
            <Campo id="modelo" rotulo="Modelo" erro={erros.modelo?.[0]} autoComplete="off" />
            <Campo id="clienteNome" rotulo="Nome do cliente" erro={erros.clienteNome?.[0]} autoComplete="off" />
            <Campo id="telefone" rotulo="WhatsApp" inputMode="tel" erro={erros.telefone?.[0]} autoComplete="off" />
          </div>
        </section>
      )}

      {busca && porteDoVeiculo && (
        <fieldset aria-describedby={erros.servicoIds ? 'servicos-erro' : undefined} className="space-y-2">
          <legend className="mb-2 font-bold">Serviços</legend>
          {lista.length === 0 && <p className="text-suave">Nenhum serviço com preço para este porte.</p>}
          {visiveis.map((s) => (
            <label key={s.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-linha bg-white px-3 has-[:checked]:border-agua has-[:checked]:bg-agua/5">
              <input
                type="checkbox"
                className="size-5 shrink-0"
                checked={selecionados.includes(s.id)}
                onChange={(e) => setSelecionados((atual) => (e.target.checked ? [...atual, s.id] : atual.filter((id) => id !== s.id)))}
              />
              <span className="flex-1">
                {s.nome}
                {s.adicional && <span className="ml-2 text-sm text-suave">adicional</span>}
              </span>
              {s.valorCentavos !== undefined && <span className="font-semibold">R$ {centesimosParaTexto(s.valorCentavos)}</span>}
            </label>
          ))}
          {erros.servicoIds?.[0] && (
            <p id="servicos-erro" className="text-sm font-medium text-perigo">
              {erros.servicoIds[0]}
            </p>
          )}
        </fieldset>
      )}

      {lavadores && busca && (
        <div className="space-y-1.5">
          <Label htmlFor="responsavelId">Responsável (opcional)</Label>
          <select id="responsavelId" name="responsavelId" defaultValue="" aria-invalid={erros.responsavelId ? true : undefined} className={campoSelect}>
            <option value="">Sem responsável</option>
            {lavadores.map((l) => (
              <option key={l.membroId} value={l.membroId}>
                {l.nome} ({l.livre ? 'livre' : 'ocupado'}
                {l.sugerido ? ', sugerido' : ''})
              </option>
            ))}
          </select>
          {erros.responsavelId?.[0] && <p className="text-sm font-medium text-perigo">{erros.responsavelId[0]}</p>}
        </div>
      )}

      <Alerta texto={erro} />
      <Button type="submit" disabled={abrindo} className="w-full sm:w-auto">
        {abrindo ? 'Abrindo…' : 'Abrir OS'}
      </Button>
    </form>
  );
}
