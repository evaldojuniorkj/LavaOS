import type { COMISSAO_TIPOS } from '@/lib/db/schema';

const somar = (v: number[]) => v.reduce((a, b) => a + b, 0);

/**
 * Base de comissão de cada item (spec §5.5): o total da OS rateado proporcionalmente aos valores dos itens.
 * Arredonda para baixo e a sobra vai para o item de maior valor (empate: o primeiro), então Σ bases = total.
 */
export function basesDosItens(itens: number[], desconto: number, acrescimo: number): number[] {
  // Guarda de erro de programação: quem chama já validou na borda.
  if (![...itens, desconto, acrescimo].every((v) => Number.isSafeInteger(v) && v >= 0)) throw new RangeError('valor inválido');
  const subtotal = somar(itens);
  if (subtotal === 0) return itens.map(() => 0);
  const total = Math.max(0, subtotal - desconto + acrescimo);
  const bases = itens.map((v) => Math.floor((total * v) / subtotal));
  const maior = itens.indexOf(Math.max(...itens));
  bases[maior] += total - somar(bases);
  return bases;
}

/** Percentual em pontos-base com arredondamento meio-para-cima em inteiros; fixo vale mesmo com base zero. */
export function comissaoDoItem(base: number, tipo: (typeof COMISSAO_TIPOS)[number], valor: number): number {
  return tipo === 'fixo' ? valor : Math.floor((base * valor + 5000) / 10000);
}

/** Acerto do membro: o saldo devedor anterior desconta como vale; o que sobrar de vale fica devendo para o próximo. */
export function calcularAcerto(i: { comissoes: number[]; vales: number[]; saldoAnterior: number }) {
  const comissoesCentavos = somar(i.comissoes);
  const valesCentavos = somar(i.vales);
  const saldo = comissoesCentavos - valesCentavos - i.saldoAnterior;
  return {
    comissoesCentavos,
    valesCentavos,
    saldoAnteriorCentavos: i.saldoAnterior,
    pagoCentavos: Math.max(0, saldo),
    saldoDevedorCentavos: Math.max(0, -saldo),
  };
}
