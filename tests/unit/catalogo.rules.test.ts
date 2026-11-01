import { describe, expect, it } from 'vitest';
import { centesimosParaTexto, decimalParaCentesimos, precoParaPorte, validarComissao } from '@/modules/catalogo/catalogo.rules';

describe('catalogo.rules', () => {
  it('precoParaPorte retorna null sem preço', () => {
    const precos = [{ servicoId: 's1', porteId: 'p1', valorCentavos: 5000 }];
    expect(precoParaPorte(precos, 's1', 'p1')).toBe(5000);
    expect(precoParaPorte(precos, 's1', 'p2')).toBeNull();
    expect(precoParaPorte([], 's1', 'p1')).toBeNull();
  });

  it('validarComissao(percentual, 3000) é true e (percentual, 10001) é false', () => {
    expect(validarComissao('percentual', 3000)).toBe(true);
    expect(validarComissao('percentual', 10000)).toBe(true);
    expect(validarComissao('percentual', 10001)).toBe(false);
    expect(validarComissao('percentual', -1)).toBe(false);
    expect(validarComissao('percentual', 1.5)).toBe(false);
    expect(validarComissao('fixo', 0)).toBe(true);
    expect(validarComissao('fixo', 2500)).toBe(true);
    expect(validarComissao('fixo', -1)).toBe(false);
  });

  it('converte R$/% digitados em inteiros sem ponto flutuante e rejeita o inválido', () => {
    expect(decimalParaCentesimos('12,50')).toBe(1250);
    expect(decimalParaCentesimos(' 12.5 ')).toBe(1250);
    expect(decimalParaCentesimos('30')).toBe(3000);
    expect(decimalParaCentesimos('0,07')).toBe(7);
    expect(decimalParaCentesimos('19,99')).toBe(1999);
    for (const ruim of ['', 'abc', '-1', '1,234', '1.000,00', '12,', ',5', '1e3', '99999999']) expect(decimalParaCentesimos(ruim)).toBeNull();
    expect(centesimosParaTexto(1250)).toBe('12,50');
    expect(centesimosParaTexto(7)).toBe('0,07');
  });
});
