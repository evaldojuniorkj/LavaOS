'use client';

import { useEffect, useState } from 'react';

type PedidoInstalacao = Event & { prompt: () => Promise<void> };

/**
 * "Instalar no celular" só quando o Chrome oferece (`beforeinstallprompt`): instalado (standalone) ou no iPhone/Safari o
 * evento nunca chega e o botão não aparece.
 */
export function InstalarApp() {
  const [pedido, setPedido] = useState<PedidoInstalacao | null>(null);
  useEffect(() => {
    const capturar = (e: Event) => {
      e.preventDefault(); // guarda para o toque no botão, em vez da barra automática do Chrome
      setPedido(e as PedidoInstalacao);
    };
    const instalado = () => setPedido(null);
    window.addEventListener('beforeinstallprompt', capturar);
    window.addEventListener('appinstalled', instalado);
    return () => {
      window.removeEventListener('beforeinstallprompt', capturar);
      window.removeEventListener('appinstalled', instalado);
    };
  }, []);
  if (!pedido) return null;
  return (
    <button
      type="button"
      onClick={() => {
        setPedido(null); // o pedido só pode ser usado uma vez
        pedido.prompt().catch(() => {});
      }}
      className="min-h-12 shrink-0 rounded-md border border-white/40 px-3 text-base font-semibold text-white"
    >
      Instalar no celular
    </button>
  );
}
