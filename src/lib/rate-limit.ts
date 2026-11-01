/**
 * Limite de requisições por chave em janela fixa. Sem `server-only`: também roda no proxy.
 * shortcut: memória de um único processo; trocar por tabela se escalar para várias instâncias
 */
export function criarLimitador(maxChaves = 10_000) {
  const janelas = new Map<string, { fim: number; n: number }>();
  /** true = pode seguir. `agora` injetável para testes. */
  return function limitar(chave: string, max: number, janelaMs: number, agora = Date.now()): boolean {
    const j = janelas.get(chave);
    if (j && j.fim > agora) return ++j.n <= max;
    janelas.delete(chave);
    if (janelas.size >= maxChaves) {
      for (const [k, v] of janelas) if (v.fim <= agora) janelas.delete(k);
      // ainda cheio: descarta a mais antiga (Map guarda a ordem de inserção) para a memória não crescer sem fim
      if (janelas.size >= maxChaves) janelas.delete(janelas.keys().next().value!);
    }
    janelas.set(chave, { fim: agora + janelaMs, n: 1 });
    return max >= 1;
  };
}

export const limitar = criarLimitador();

// shortcut: memória de um único processo; trocar por tabela se escalar para várias instâncias
const abertos = new Map<string, number>();
/** Reserva uma das `max` conexões abertas da chave; devolve a liberação (idempotente) ou null se já estiver no teto. */
export function reservarVaga(chave: string, max: number): (() => void) | null {
  const n = abertos.get(chave) ?? 0;
  if (n >= max) return null;
  abertos.set(chave, n + 1);
  let livre = false;
  return () => {
    if (livre) return;
    livre = true;
    const resto = (abertos.get(chave) ?? 1) - 1;
    if (resto > 0) abertos.set(chave, resto);
    else abertos.delete(chave); // sem conexão aberta, a chave sai: a memória acompanha as conexões vivas
  };
}

export const MUITAS_REQUISICOES = 'Muitas requisições. Aguarde um minuto e tente de novo.';

/** 429 genérico, igual para qualquer token (válido ou não). */
export const respostaLimitada = (janelaMs: number) =>
  new Response(MUITAS_REQUISICOES, {
    status: 429,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': String(Math.ceil(janelaMs / 1000)), 'Cache-Control': 'no-store' },
  });
