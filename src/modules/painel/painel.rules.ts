import type { StatusOs } from '@/modules/ordens/ordens.rules';

export const ATRASO_MINUTOS = 60;

/** Instante UTC da meia-noite local de `agora`. */
export function inicioDoDia(agora: Date, fuso = 'America/Sao_Paulo'): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(agora)
      .map((x) => [x.type, Number(x.value)]),
  );
  // shortcut: subtrai o relógio local do instante, errado só em dia com troca de horário de verão (São Paulo não tem hoje).
  return new Date(agora.getTime() - ((p.hour * 60 + p.minute) * 60 + p.second) * 1000 - agora.getMilliseconds());
}

export function minutosEntre(de: Date, ate: Date): number {
  return Math.max(0, Math.floor((ate.getTime() - de.getTime()) / 60_000));
}

export function estaAtrasada(o: { status: StatusOs; entradaEm: Date; inicioLavagemEm: Date | null }, agora: Date): boolean {
  if (o.status !== 'aguardando' && o.status !== 'em_lavagem') return false;
  const desde = o.status === 'em_lavagem' ? (o.inicioLavagemEm ?? o.entradaEm) : o.entradaEm;
  return minutosEntre(desde, agora) > ATRASO_MINUTOS;
}

export function tempoMedioLavagem(amostras: { inicioLavagemEm: Date; prontoEm: Date }[]): number | null {
  if (!amostras.length) return null;
  const total = amostras.reduce((a, s) => a + minutosEntre(s.inicioLavagemEm, s.prontoEm), 0);
  return Math.floor(total / amostras.length);
}
