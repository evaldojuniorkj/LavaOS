'use client';

import { useState } from 'react';
import { Alerta, useEnvio } from '@/components/catalogo-form';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Porte } from '@/modules/catalogo/catalogo.repo';
import { salvarClienteAction, salvarVeiculoAction } from '@/modules/clientes/clientes.actions';
import type { Cliente, Veiculo } from '@/modules/clientes/clientes.repo';
import { rotuloVeiculo } from '@/modules/clientes/clientes.rules';

const campoSelect = 'block min-h-11 w-full rounded-md border border-linha bg-white px-3 text-base';

/** Clientes e veículos: lista e edição para quem tem clientes:gerenciar. A validação final é do servidor. */
export function ClientesForm({ clientes, veiculos, portes }: { clientes: Cliente[]; veiculos: Veiculo[]; portes: Porte[] }) {
  const [aviso, setAviso] = useState('');
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-tinta">Clientes e veículos</h1>
      <p role="status" className="empty:hidden rounded-md bg-agua/10 p-3 text-sm font-medium text-tinta">
        {aviso}
      </p>
      <section aria-labelledby="clientes-titulo" className="space-y-3">
        <h2 id="clientes-titulo" className="text-lg font-bold">
          Clientes
        </h2>
        <ul className="divide-y divide-linha rounded-lg border border-linha bg-white">
          {clientes.map((c) => (
            <li key={`${c.id}-${c.nome}-${c.telefone}-${c.observacoes}`} className="p-4">
              <ClienteForm cliente={c} onAviso={setAviso} />
            </li>
          ))}
          <li className="p-4">
            <ClienteForm onAviso={setAviso} />
          </li>
        </ul>
      </section>
      <section aria-labelledby="veiculos-titulo" className="space-y-3">
        <h2 id="veiculos-titulo" className="text-lg font-bold">
          Veículos
        </h2>
        {portes.length === 0 && <p className="text-suave">Cadastre ao menos um porte no catálogo para cadastrar veículos.</p>}
        <ul className="divide-y divide-linha rounded-lg border border-linha bg-white">
          {veiculos.map((v) => (
            <li key={`${v.id}-${v.placa}-${v.porteId}-${v.clienteId}-${v.modelo}-${v.cor}`} className="p-4">
              <VeiculoForm veiculo={v} clientes={clientes} portes={portes} onAviso={setAviso} />
            </li>
          ))}
          {portes.length > 0 && (
            <li className="p-4">
              <VeiculoForm clientes={clientes} portes={portes} onAviso={setAviso} />
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}

function ClienteForm({ cliente, onAviso }: { cliente?: Cliente; onAviso: (t: string) => void }) {
  const { erros, erro, pendente, enviar } = useEnvio(() => onAviso(cliente ? 'Cliente salvo.' : 'Cliente cadastrado.'));
  const sufixo = cliente?.id ?? 'novo';
  return (
    <form
      noValidate
      aria-label={cliente ? `Cliente ${cliente.nome}` : 'Novo cliente'}
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
        enviar(async () => {
          const r = await salvarClienteAction({ id: cliente?.id, nome: f.nome, telefone: f.telefone ?? '', observacoes: f.observacoes?.trim() || null });
          if (r.ok && !cliente) form.reset();
          return r;
        });
      }}
    >
      <div className="min-w-48 flex-1">
        <Campo id={`cliente-nome-${sufixo}`} name="nome" rotulo={cliente ? 'Nome' : 'Novo cliente'} defaultValue={cliente?.nome} erro={erros.nome?.[0]} autoComplete="off" />
      </div>
      <div className="min-w-44">
        <Campo id={`cliente-telefone-${sufixo}`} name="telefone" rotulo="Telefone" inputMode="tel" defaultValue={cliente?.telefone ?? ''} erro={erros.telefone?.[0]} autoComplete="off" />
      </div>
      <div className="min-w-48 flex-1">
        <Campo id={`cliente-obs-${sufixo}`} name="observacoes" rotulo="Observações" defaultValue={cliente?.observacoes ?? ''} erro={erros.observacoes?.[0]} autoComplete="off" />
      </div>
      <Button type="submit" variante="secundario" disabled={pendente}>
        {pendente ? 'Salvando…' : cliente ? 'Salvar' : 'Adicionar cliente'}
      </Button>
      <div className="w-full empty:hidden">
        <Alerta texto={erro} />
      </div>
    </form>
  );
}

function VeiculoForm({ veiculo, clientes, portes, onAviso }: { veiculo?: Veiculo; clientes: Cliente[]; portes: Porte[]; onAviso: (t: string) => void }) {
  const { erros, erro, pendente, enviar } = useEnvio(() => onAviso(veiculo ? 'Veículo salvo.' : 'Veículo cadastrado.'));
  const sufixo = veiculo?.id ?? 'novo';
  return (
    <form
      noValidate
      aria-label={veiculo ? `Veículo ${rotuloVeiculo(veiculo)}` : 'Novo veículo'}
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
        enviar(async () => {
          const r = await salvarVeiculoAction({ id: veiculo?.id, placa: f.placa, porteId: f.porteId, modelo: f.modelo?.trim() || null, cor: f.cor?.trim() || null, clienteId: f.clienteId || null });
          if (r.ok && !veiculo) form.reset();
          return r;
        });
      }}
    >
      <div className="w-36">
        <Campo id={`veiculo-placa-${sufixo}`} name="placa" rotulo={veiculo ? 'Placa' : 'Nova placa'} defaultValue={veiculo?.placa ?? ''} erro={erros.placa?.[0]} autoComplete="off" />
      </div>
      <div className="w-40 space-y-1.5">
        <Label htmlFor={`veiculo-porte-${sufixo}`}>Porte</Label>
        <select id={`veiculo-porte-${sufixo}`} name="porteId" defaultValue={veiculo?.porteId ?? ''} className={campoSelect}>
          <option value="" disabled>
            Escolha
          </option>
          {portes.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
              {p.ativo ? '' : ' (inativo)'}
            </option>
          ))}
        </select>
        {erros.porteId?.[0] && <p className="text-sm font-medium text-perigo">Escolha o porte.</p>}
      </div>
      <div className="w-40">
        <Campo id={`veiculo-modelo-${sufixo}`} name="modelo" rotulo="Modelo" defaultValue={veiculo?.modelo ?? ''} erro={erros.modelo?.[0]} autoComplete="off" />
      </div>
      <div className="w-32">
        <Campo id={`veiculo-cor-${sufixo}`} name="cor" rotulo="Cor" defaultValue={veiculo?.cor ?? ''} erro={erros.cor?.[0]} autoComplete="off" />
      </div>
      <div className="w-48 space-y-1.5">
        <Label htmlFor={`veiculo-cliente-${sufixo}`}>Cliente</Label>
        <select id={`veiculo-cliente-${sufixo}`} name="clienteId" defaultValue={veiculo?.clienteId ?? ''} className={campoSelect}>
          <option value="">Sem cliente</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variante="secundario" disabled={pendente}>
        {pendente ? 'Salvando…' : veiculo ? 'Salvar' : 'Adicionar veículo'}
      </Button>
      <div className="w-full empty:hidden">
        <Alerta texto={erro} />
      </div>
    </form>
  );
}
