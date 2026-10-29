import { describe, expect, it } from 'vitest';
import { normalizarPlaca, normalizarTelefone } from '@/modules/clientes/clientes.rules';

describe('clientes.rules', () => {
  it('normalizarPlaca', () => {
    expect(normalizarPlaca('abc-1d23')).toBe('ABC1D23');
    expect(normalizarPlaca(' ABC1234 ')).toBe('ABC1234');
    expect(normalizarPlaca('abc 1234')).toBe('ABC1234');
    expect(normalizarPlaca('ab12')).toBeNull();
    expect(normalizarPlaca('ABCD123')).toBeNull();
  });
  it('normalizarTelefone', () => {
    expect(normalizarTelefone('(11) 98888-7777')).toBe('+5511988887777');
    expect(normalizarTelefone('+55 11 3888-7777')).toBe('+551138887777');
    expect(normalizarTelefone('5511988887777')).toBe('+5511988887777');
    expect(normalizarTelefone('123')).toBeNull();
    expect(normalizarTelefone('(11) 8888-77778-1')).toBeNull();
  });
});
