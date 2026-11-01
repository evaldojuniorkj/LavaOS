import { describe, expect, it } from 'vitest';
import { estaAtrasada, inicioDoDia, minutosEntre, tempoMedioLavagem } from '@/modules/painel/painel.rules';

const d = (s: string) => new Date(s);
const agora = d('2026-10-30T15:00:00Z');
const antes = (min: number) => new Date(agora.getTime() - min * 60_000);

describe('inicioDoDia (America/Sao_Paulo)', () => {
  it.each([
    ['2026-10-30T02:30:00Z', '2026-10-29T03:00:00Z'],
    ['2026-10-30T03:00:00Z', '2026-10-30T03:00:00Z'],
    ['2026-10-30T14:00:00Z', '2026-10-30T03:00:00Z'],
  ])('%s -> %s', (entrada, esperado) => {
    expect(inicioDoDia(d(entrada)).toISOString()).toBe(new Date(esperado).toISOString());
  });
});

describe('minutosEntre', () => {
  it('arredonda para baixo e nunca é negativo', () => {
    expect(minutosEntre(antes(5.9), agora)).toBe(5);
    expect(minutosEntre(agora, antes(5))).toBe(0);
  });
});

describe('estaAtrasada', () => {
  const aguardando = (min: number) => ({ status: 'aguardando' as const, entradaEm: antes(min), inicioLavagemEm: null });
  it.each([[59, false], [60, false], [61, true]])('aguardando há %s min -> %s', (min, esperado) => {
    expect(estaAtrasada(aguardando(min), agora)).toBe(esperado);
  });
  it('em_lavagem usa inicioLavagemEm', () => {
    expect(estaAtrasada({ status: 'em_lavagem', entradaEm: antes(300), inicioLavagemEm: antes(10) }, agora)).toBe(false);
    expect(estaAtrasada({ status: 'em_lavagem', entradaEm: antes(300), inicioLavagemEm: antes(61) }, agora)).toBe(true);
  });
  it('em_lavagem sem início cai em entradaEm', () => {
    expect(estaAtrasada({ status: 'em_lavagem', entradaEm: antes(61), inicioLavagemEm: null }, agora)).toBe(true);
  });
  it.each(['pronto', 'entregue', 'cancelada'] as const)('%s nunca atrasa', (status) => {
    expect(estaAtrasada({ status, entradaEm: antes(999), inicioLavagemEm: antes(999) }, agora)).toBe(false);
  });
});

describe('tempoMedioLavagem', () => {
  const am = (min: number) => ({ inicioLavagemEm: antes(min), prontoEm: agora });
  it('vazio é null', () => expect(tempoMedioLavagem([])).toBeNull());
  it('média arredondada para baixo', () => expect(tempoMedioLavagem([am(20), am(31)])).toBe(25));
  it('amostra invertida conta 0', () => {
    expect(tempoMedioLavagem([{ inicioLavagemEm: agora, prontoEm: antes(10) }])).toBe(0);
  });
});
