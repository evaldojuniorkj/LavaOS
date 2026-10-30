import 'server-only';

export const TIPOS_EVENTO = ['os_criada', 'status', 'responsavel', 'itens', 'valor'] as const;
/** Só ids e tipo: cada cliente recarrega a própria visão (filtrada por perfil) ao receber. */
export type Evento = { tenantId: string; osId: string; tipo: (typeof TIPOS_EVENTO)[number] };
/** `resync`: eventos podem ter sido perdidos (LISTEN reconectou); todos recarregam. */
export type Mensagem = Evento | { tipo: 'resync' };
type Assinante = { filtro: { tenantId: string; osId?: string }; enviar: (m: Mensagem) => void };

// globalThis: listener e rotas compartilham o mesmo conjunto mesmo após HMR do dev
const g = globalThis as { __lavaosHub?: Set<Assinante> };
const assinantes = (g.__lavaosHub ??= new Set());

export const hub = {
  assinar(filtro: Assinante['filtro'], enviar: Assinante['enviar']): () => void {
    const a = { filtro, enviar };
    assinantes.add(a);
    return () => void assinantes.delete(a);
  },
  emitir(m: Mensagem): void {
    for (const { filtro, enviar } of assinantes) {
      if (m.tipo !== 'resync' && (m.tenantId !== filtro.tenantId || (filtro.osId !== undefined && filtro.osId !== m.osId))) continue;
      try {
        enviar(m);
      } catch (err) {
        console.error('[realtime] falha ao entregar evento:', err instanceof Error ? err.message : err);
      }
    }
  },
};
