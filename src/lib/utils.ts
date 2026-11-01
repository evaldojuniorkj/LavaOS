/** Action que nem chegou ao servidor (rede caiu): vira erro comum, para a tela mostrar a mensagem em vez de quebrar. */
export const SEM_CONEXAO = { ok: false, code: 'SEM_CONEXAO', message: 'Sem conexão. Confira a internet e tente de novo.' } as const;

export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

/** "há 5 min" / "há 1 h 05 min". */
export const duracao = (min: number) => (min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`);

/** Tempo desde a entrada na fila, para os cartões. */
export const tempoDesde = (d: Date, agora: number) => duracao(Math.max(0, Math.floor((agora - new Date(d).getTime()) / 60_000)));
