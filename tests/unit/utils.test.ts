import { describe, expect, it } from 'vitest';
import { duracao, tempoDesde } from '@/lib/utils';

describe('duracao / tempoDesde', () => {
  it('formata minutos e horas', () => {
    expect(duracao(5)).toBe('há 5 min');
    expect(duracao(65)).toBe('há 1 h 05 min');
    expect(tempoDesde(new Date(0), 65 * 60_000)).toBe('há 1 h 05 min');
  });
});
