export const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(' ');

/** Tempo desde a entrada na fila, para os cartões. */
export function tempoDesde(d: Date, agora: number) {
  const min = Math.max(0, Math.floor((agora - new Date(d).getTime()) / 60_000));
  return min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}
