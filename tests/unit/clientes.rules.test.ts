import { describe, expect, it } from 'vitest';
import { normalizarPlaca, normalizarTelefone, rotuloVeiculo } from '@/modules/clientes/clientes.rules';

describe('clientes.rules', () => {
  it('normalizarPlaca', () => {
    expect(normalizarPlaca('abc-1d23')).toBe('ABC1D23');
    expect(normalizarPlaca(' ABC1234 ')).toBe('ABC1234');
    expect(normalizarPlaca('abc 1234')).toBe('ABC1234');
    expect(normalizarPlaca('ab12')).toBeNull();
    expect(normalizarPlaca('ABCD123')).toBeNull();
    expect(normalizarPlaca('ﬃ1234')).toBeNull(); // 'ﬃ'.toUpperCase() === 'FFI'
    expect(normalizarPlaca('ß1A2345')).toBeNull();
    expect(normalizarPlaca('ABC１２３４')).toBeNull(); // dígitos de largura total
  });
  it('rotuloVeiculo', () => {
    expect(rotuloVeiculo({ placa: 'ABC1D23', modelo: 'Gol', cor: 'Prata' })).toBe('ABC1D23');
    expect(rotuloVeiculo({ placa: null, modelo: 'CG 160', cor: 'Preta' })).toBe('Sem placa — CG 160 Preta');
    expect(rotuloVeiculo({ placa: null, modelo: 'CG 160', cor: null })).toBe('Sem placa — CG 160');
    expect(rotuloVeiculo({ placa: null, modelo: null, cor: 'Preta' })).toBe('Sem placa');
    expect(rotuloVeiculo({ placa: null, modelo: null, cor: null })).toBe('Sem placa');
  });
  it('normalizarTelefone', () => {
    expect(normalizarTelefone('(11) 98888-7777')).toBe('+5511988887777');
    expect(normalizarTelefone('+55 11 3888-7777')).toBe('+551138887777');
    expect(normalizarTelefone('5511988887777')).toBe('+5511988887777');
    expect(normalizarTelefone('123')).toBeNull();
    expect(normalizarTelefone('+1 415 555 1234')).toBeNull(); // outro país
    expect(normalizarTelefone('+44 20 7946 0958')).toBeNull();
    expect(normalizarTelefone('+55 (11) 98888-7777')).toBe('+5511988887777');
    expect(normalizarTelefone('(11) 88888-7777')).toBeNull(); // 11 dígitos exigem 9 após o DDD
    expect(normalizarTelefone('(11) 9888-7777')).toBeNull(); // 10 dígitos com 9: não é fixo
    expect(normalizarTelefone('(01) 98888-7777')).toBeNull(); // DDD não começa com 0
    expect(normalizarTelefone('(11) 3888-7777')).toBe('+551138887777');
    expect(normalizarTelefone('(11) 1888-7777')).toBeNull(); // fixo começa com 2–5
    expect(normalizarTelefone('(11) 8888-77778-1')).toBeNull();
  });
});
