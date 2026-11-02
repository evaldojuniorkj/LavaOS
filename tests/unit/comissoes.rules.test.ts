import { describe, expect, it } from 'vitest';
import { basesDosItens, calcularAcerto, comissaoDoItem } from '@/modules/comissoes/comissoes.rules';

const somar = (v: number[]) => v.reduce((a, b) => a + b, 0);

// gerador determinístico (mulberry32) para a propriedade não depender de sorte
function mulberry32(semente: number) {
  let a = semente;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('basesDosItens', () => {
  it('33,33 % sobre R$ 50, R$ 30 e R$ 20 com desconto de R$ 7: bases somam R$ 93 e comissões arredondam', () => {
    const bases = basesDosItens([5000, 3000, 2000], 700, 0);
    expect(bases).toEqual([4650, 2790, 1860]);
    expect(somar(bases)).toBe(9300);
    expect(bases.map((b) => comissaoDoItem(b, 'percentual', 3333))).toEqual([1550, 930, 620]);
  });

  it('desconto maior que o subtotal zera todas as bases', () => {
    expect(basesDosItens([5000, 3000], 9000, 0)).toEqual([0, 0]);
    expect(basesDosItens([5000, 3000], 9000, 500)).toEqual([0, 0]);
  });

  it('acréscimo é rateado e a sobra vai para o maior', () => {
    expect(basesDosItens([5000, 3000, 2000], 0, 1001)).toEqual([5501, 3300, 2200]);
  });

  it('um item só recebe o total', () => {
    expect(basesDosItens([4000], 333, 100)).toEqual([3767]);
  });

  it('item de valor zero não recebe rateio; todos zero dá tudo zero', () => {
    expect(basesDosItens([0, 5000, 0], 0, 999)).toEqual([0, 5999, 0]);
    expect(basesDosItens([0, 0], 0, 999)).toEqual([0, 0]);
    expect(basesDosItens([], 0, 0)).toEqual([]);
  });

  it('empate do maior: a sobra vai para o primeiro', () => {
    expect(basesDosItens([3000, 3000], 1, 0)).toEqual([3000, 2999]);
    expect(basesDosItens([1000, 3000, 3000], 0, 1)).toEqual([1000, 3001, 3000]);
  });

  it('valor inválido é erro de programação', () => {
    expect(() => basesDosItens([-1], 0, 0)).toThrow(RangeError);
    expect(() => basesDosItens([100], 0.5, 0)).toThrow(RangeError);
  });

  it('propriedade: em 200 casos aleatórios, Σ bases = total e nenhuma base é negativa', () => {
    const rnd = mulberry32(20261031);
    const int = (max: number) => Math.floor(rnd() * (max + 1));
    for (let caso = 0; caso < 200; caso++) {
      const itens = Array.from({ length: 1 + int(5) }, () => (rnd() < 0.15 ? 0 : int(30000)));
      const subtotal = somar(itens);
      const desconto = rnd() < 0.1 ? subtotal + int(1000) : int(Math.floor(subtotal / 2));
      const acrescimo = rnd() < 0.5 ? 0 : int(5000);
      const bases = basesDosItens(itens, desconto, acrescimo);
      const total = subtotal === 0 ? 0 : Math.max(0, subtotal - desconto + acrescimo);
      expect(somar(bases), JSON.stringify({ itens, desconto, acrescimo })).toBe(total);
      expect(bases.every((b, i) => b >= 0 && (itens[i] > 0 || b === 0))).toBe(true);
    }
  });
});

describe('comissaoDoItem', () => {
  it('percentual arredonda meio centavo para cima', () => {
    expect(comissaoDoItem(150, 'percentual', 3333)).toBe(50); // 49,995
    expect(comissaoDoItem(1, 'percentual', 5000)).toBe(1); // 0,5
    expect(comissaoDoItem(1, 'percentual', 4999)).toBe(0);
    expect(comissaoDoItem(5000, 'percentual', 10000)).toBe(5000);
    expect(comissaoDoItem(0, 'percentual', 3000)).toBe(0);
  });

  it('fixo é o valor contratado, mesmo com base zero', () => {
    expect(comissaoDoItem(0, 'fixo', 1500)).toBe(1500);
    expect(comissaoDoItem(9000, 'fixo', 1500)).toBe(1500);
  });
});

describe('calcularAcerto', () => {
  it('vale menor que a comissão: paga a diferença', () => {
    expect(calcularAcerto({ comissoes: [15000, 5000], vales: [5000], saldoAnterior: 0 })).toEqual({
      comissoesCentavos: 20000,
      valesCentavos: 5000,
      saldoAnteriorCentavos: 0,
      pagoCentavos: 15000,
      saldoDevedorCentavos: 0,
    });
  });

  it('vale igual: nada a pagar e nada devendo', () => {
    expect(calcularAcerto({ comissoes: [20000], vales: [20000], saldoAnterior: 0 })).toMatchObject({ pagoCentavos: 0, saldoDevedorCentavos: 0 });
  });

  it('vale maior: R$ 300 de vale com R$ 200 de comissão fica devendo R$ 100', () => {
    expect(calcularAcerto({ comissoes: [20000], vales: [30000], saldoAnterior: 0 })).toMatchObject({ pagoCentavos: 0, saldoDevedorCentavos: 10000 });
  });

  it('saldo anterior desconta no acerto seguinte', () => {
    expect(calcularAcerto({ comissoes: [25000], vales: [], saldoAnterior: 10000 })).toEqual({
      comissoesCentavos: 25000,
      valesCentavos: 0,
      saldoAnteriorCentavos: 10000,
      pagoCentavos: 15000,
      saldoDevedorCentavos: 0,
    });
    expect(calcularAcerto({ comissoes: [5000], vales: [2000], saldoAnterior: 10000 })).toMatchObject({ pagoCentavos: 0, saldoDevedorCentavos: 7000 });
  });
});
