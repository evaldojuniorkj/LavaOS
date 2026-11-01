import { describe, expect, it } from 'vitest';
import { dataDoCaixa, diferenca, FORMAS, podeReceber, resumoCaixa, ROTULO_FORMA, saldoOs, troco } from '@/modules/caixa/caixa.rules';

describe('troco', () => {
  it('R$ 100 para R$ 65 devolve R$ 35', () => expect(troco(10000, 6500)).toBe(3500));
  it('valor exato devolve 0', () => expect(troco(6500, 6500)).toBe(0));
  it('recebido menor que o valor é null', () => expect(troco(5000, 6500)).toBeNull());
});

describe('saldoOs e podeReceber', () => {
  it('saldo é o total menos os ativos, nunca negativo', () => {
    expect(saldoOs(8000, [3000])).toBe(5000);
    expect(saldoOs(8000, [])).toBe(8000);
    expect(saldoOs(8000, [8000, 100])).toBe(0);
  });
  it('soma no limite exato passa; 1 centavo acima não', () => {
    expect(podeReceber(8000, [3000], 5000)).toBe(true);
    expect(podeReceber(8000, [3000], 5001)).toBe(false);
  });
});

describe('resumoCaixa', () => {
  it('ignora estornados, separa por forma e subtrai saídas do dinheiro', () => {
    const r = resumoCaixa({
      trocoInicial: 10000,
      pagamentos: [
        { forma: 'dinheiro', valorCentavos: 5000, estornado: false },
        { forma: 'pix', valorCentavos: 3000, estornado: false },
        { forma: 'pix', valorCentavos: 9999, estornado: true },
        { forma: 'dinheiro', valorCentavos: 7777, estornado: true },
        { forma: 'credito', valorCentavos: 1500, estornado: false },
      ],
      saidasDinheiro: [2000, 500],
    });
    expect(r).toEqual({ porForma: { dinheiro: 5000, pix: 3000, debito: 0, credito: 1500 }, esperadoDinheiro: 10000 + 5000 - 2500 });
  });
});

describe('diferenca', () => {
  it('negativa quando falta, positiva quando sobra', () => {
    expect(diferenca(9500, 10000)).toBe(-500);
    expect(diferenca(10200, 10000)).toBe(200);
  });
});

describe('dataDoCaixa (America/Sao_Paulo)', () => {
  it.each([
    ['2026-10-31T02:30:00Z', '2026-10-30'],
    ['2026-10-31T03:00:00Z', '2026-10-31'],
    ['2026-01-05T12:00:00Z', '2026-01-05'],
  ])('%s -> %s', (agora, esperado) => expect(dataDoCaixa(new Date(agora))).toBe(esperado));
});

it('rótulos para todas as formas', () => {
  expect(FORMAS).toEqual(['dinheiro', 'pix', 'debito', 'credito']);
  expect(ROTULO_FORMA).toEqual({ dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito' });
});
