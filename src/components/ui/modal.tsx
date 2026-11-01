'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/** <dialog> nativo: foco preso, Esc fecha e o resto da página fica inerte. */
export function Modal({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialogo-titulo"
      onClose={onFechar}
      className="folha m-auto mb-0 max-h-[92dvh] w-full max-w-lg rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-tinta backdrop:bg-tinta/50 sm:mb-auto sm:rounded-3xl"
    >
      <div aria-hidden className="mx-auto -mt-2 mb-3 h-1.5 w-10 rounded-full bg-linha sm:hidden" />
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

/** Motivo obrigatório (cancelar, reabrir, estornar); o servidor valida de novo. */
export function Motivo({ confirmar, enviando, perigo = false, pendente, onConfirmar, onVoltar }: {
  confirmar: string;
  enviando: string;
  perigo?: boolean;
  pendente: boolean;
  onConfirmar: (motivo: string, onErro: (e: Record<string, string[]>) => void) => void;
  onVoltar: () => void;
}) {
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
        <Label htmlFor="dialogo-motivo">Motivo</Label>
        <textarea
          id="dialogo-motivo"
          name="motivo"
          rows={3}
          maxLength={500}
          aria-invalid={erroMotivo ? true : undefined}
          aria-describedby={erroMotivo ? 'dialogo-motivo-erro' : undefined}
          className="block w-full rounded-md border border-linha bg-white p-3 text-base aria-invalid:border-perigo"
        />
        {erroMotivo && (
          <p id="dialogo-motivo-erro" className="text-sm font-medium text-perigo">
            {erroMotivo}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variante="secundario" onClick={onVoltar}>
          Voltar
        </Button>
        <Button type="submit" variante={perigo ? 'perigo' : 'primario'} disabled={pendente}>
          {pendente ? enviando : confirmar}
        </Button>
      </div>
    </form>
  );
}
