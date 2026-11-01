'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Campo } from '@/components/ui/input';
import { FORMAS, ROTULO_FORMA, troco, type Forma } from '@/modules/caixa/caixa.rules';
import { centesimosParaTexto, decimalParaCentesimos, formatarReais } from '@/modules/catalogo/catalogo.rules';
import type { OsViewGestao } from '@/modules/ordens/ordens.views';
import { cn } from '@/lib/utils';

const EXEMPLO = 'Informe em R$, por exemplo 5,00.';

/** Forma e valor (sugere o saldo); em dinheiro, o recebido do cliente só calcula o troco na tela, não vai ao servidor. */
export function ReceberDialogo({ os, entregar, pendente, onConfirmar }: {
  os: OsViewGestao;
  entregar: boolean;
  pendente: boolean;
  onConfirmar: (dados: { forma: Forma; valorCentavos: number }, onErro: (e: Record<string, string[]>) => void) => void;
}) {
  const saldo = Math.max(0, os.totalCentavos - os.pagoCentavos);
  const [forma, setForma] = useState<Forma>('dinheiro');
  const [valor, setValor] = useState(centesimosParaTexto(saldo));
  const [recebido, setRecebido] = useState('');
  const [erros, setErros] = useState<Record<string, string[]>>({});
  const valorCentavos = decimalParaCentesimos(valor);
  const recebidoCentavos = recebido.trim() ? decimalParaCentesimos(recebido) : null;
  const t = valorCentavos !== null && recebidoCentavos !== null ? troco(recebidoCentavos, valorCentavos) : null;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valorCentavos === null || valorCentavos === 0) return setErros({ valorCentavos: [valorCentavos === 0 ? 'Informe o valor.' : EXEMPLO] });
        setErros({});
        onConfirmar({ forma, valorCentavos }, setErros);
      }}
    >
      <p className="text-base">
        Total {formatarReais(os.totalCentavos)} · pago {formatarReais(os.pagoCentavos)} · <strong>falta {formatarReais(saldo)}</strong>
      </p>
      <fieldset>
        <legend className="mb-1.5 text-base font-semibold">Forma de pagamento</legend>
        <div className="grid grid-cols-2 gap-2">
          {FORMAS.map((f) => (
            <label key={f} className={cn('flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-linha px-3 text-base font-semibold', forma === f && 'border-2 border-agua bg-agua/5')}>
              <input type="radio" name="forma" value={f} checked={forma === f} onChange={() => setForma(f)} className="size-5" />
              {ROTULO_FORMA[f]}
            </label>
          ))}
        </div>
        {erros.forma?.[0] && <p className="mt-1 text-sm font-medium text-perigo">{erros.forma[0]}</p>}
      </fieldset>
      <Campo id="receber-valor" rotulo="Valor (R$)" inputMode="decimal" autoComplete="off" value={valor} onChange={(e) => setValor(e.target.value)} erro={erros.valorCentavos?.[0]} />
      {forma === 'dinheiro' && (
        <div className="space-y-2">
          <Campo id="receber-recebido" rotulo="Recebido do cliente (R$)" inputMode="decimal" autoComplete="off" value={recebido} onChange={(e) => setRecebido(e.target.value)} />
          <p role="status" className="text-lg font-bold">
            {recebidoCentavos === null ? '' : t === null ? 'O recebido é menor que o valor.' : `Troco: ${formatarReais(t)}`}
          </p>
        </div>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={pendente}>
          {pendente ? 'Registrando…' : entregar ? 'Receber e entregar' : 'Receber'}
        </Button>
      </div>
    </form>
  );
}
