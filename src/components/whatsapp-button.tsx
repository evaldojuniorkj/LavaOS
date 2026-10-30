'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/input';
import { salvarTelefoneClienteAction } from '@/modules/clientes/clientes.actions';
import { normalizarTelefone } from '@/modules/clientes/clientes.rules';
import { linkWhatsapp, mensagemEntrada, mensagemPronto } from '@/modules/clientes/whatsapp.rules';
import type { OsViewGestao } from '@/modules/ordens/ordens.views';
import { cn } from '@/lib/utils';

const CLASSE = 'inline-flex min-h-11 items-center justify-center rounded-md border px-3 text-base font-semibold transition-colors';
const abrir = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

/** Botões wa.me manuais (sem API); o telefone salvo vale para os dois botões do cartão. Só a visão de gestão chega aqui. */
export function AvisosWhatsapp({ os }: { os: OsViewGestao }) {
  const [telefone, setTelefone] = useState(os.cliente?.telefone ?? '');
  const base = { lavaJato: os.lavaJato, modelo: os.veiculo.modelo, placa: os.veiculo.placa };
  return (
    <div className="flex flex-wrap gap-2">
      <BotaoWhatsapp os={os} rotulo="Enviar acompanhamento" mensagem={mensagemEntrada({ ...base, urlAcompanhar: os.urlAcompanhar })} telefone={telefone} onSalvo={setTelefone} />
      {os.status === 'pronto' && (
        <BotaoWhatsapp os={os} rotulo="Avisar pronto" destaque mensagem={mensagemPronto({ ...base, totalCentavos: os.totalCentavos })} telefone={telefone} onSalvo={setTelefone} />
      )}
    </div>
  );
}

function BotaoWhatsapp({ os, rotulo, mensagem, telefone, destaque, onSalvo }: { os: OsViewGestao; rotulo: string; mensagem: string; telefone: string; destaque?: boolean; onSalvo: (t: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [digitado, setDigitado] = useState('');
  const [erro, setErro] = useState('');
  const [pendente, iniciar] = useTransition();
  const id = `wa-${os.id}-${destaque ? 'pronto' : 'entrada'}`;
  const link = linkWhatsapp(telefone, mensagem);
  const classe = cn(CLASSE, destaque ? 'border-agua bg-agua text-white hover:bg-agua-escura' : 'border-linha bg-white text-tinta hover:bg-enxague');

  if (link) {
    return (
      <a href={link} target="_blank" rel="noopener noreferrer" className={classe}>
        {rotulo}
      </a>
    );
  }
  const novo = linkWhatsapp(digitado, mensagem);
  const validar = () => !novo && setErro(digitado.trim() ? 'Telefone inválido. Use DDD + número.' : 'Informe o telefone.');
  return (
    <div className="w-full space-y-2">
      <button type="button" aria-expanded={aberto} aria-controls={id} className={classe} onClick={() => setAberto(!aberto)}>
        {rotulo}
      </button>
      {aberto && (
        <div id={id} role="group" aria-label={`Telefone para ${rotulo}`} className="space-y-2 rounded-md border border-linha bg-enxague/40 p-3">
          <p className="text-sm text-suave">Este cliente não tem telefone válido cadastrado. Informe o número com DDD.</p>
          <Campo id={`${id}-tel`} rotulo="Telefone do cliente" inputMode="tel" autoComplete="off" value={digitado} onChange={(e) => (setDigitado(e.target.value), setErro(''))} erro={erro} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variante="secundario" onClick={() => (novo ? abrir(novo) : validar())}>
              Usar só desta vez
            </Button>
            {os.clienteId && (
              <Button
                type="button"
                disabled={pendente}
                onClick={() =>
                  !novo
                    ? validar()
                    : iniciar(async () => {
                        const r = await salvarTelefoneClienteAction({ clienteId: os.clienteId, telefone: digitado });
                        if (r.ok) return onSalvo(r.data.telefone ?? normalizarTelefone(digitado)!);
                        setErro(r.code === 'VALIDACAO' ? (r.fieldErrors?.telefone?.[0] ?? 'Dados inválidos.') : r.code === 'ACESSO_NEGADO' ? 'Seu perfil não pode salvar o telefone do cliente.' : r.message);
                      })
                }
              >
                {pendente ? 'Salvando…' : 'Salvar no cliente'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
