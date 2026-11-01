import { FORMAS_PAGAMENTO } from '@/lib/db/schema';

export const FORMAS = FORMAS_PAGAMENTO;
export type Forma = (typeof FORMAS)[number];
export const ROTULO_FORMA: Record<Forma, string> = { dinheiro: 'Dinheiro', pix: 'Pix', debito: 'Débito', credito: 'Crédito' };

const somar = (v: number[]) => v.reduce((a, b) => a + b, 0);

/** Troco do dinheiro entregue pelo cliente; null se ele deu menos que o valor. */
export function troco(recebidoCentavos: number, valorCentavos: number): number | null {
  return recebidoCentavos < valorCentavos ? null : recebidoCentavos - valorCentavos;
}

/** Quanto falta receber da OS (`pagosAtivos` já sem estornados). */
export function saldoOs(totalCentavos: number, pagosAtivos: number[]): number {
  return Math.max(0, totalCentavos - somar(pagosAtivos));
}

export function podeReceber(totalCentavos: number, pagosAtivos: number[], novoCentavos: number): boolean {
  return somar(pagosAtivos) + novoCentavos <= totalCentavos;
}

/** Esperado por forma e o dinheiro que deve estar na gaveta: troco + dinheiro recebido − saídas pagas com ele. */
export function resumoCaixa(i: { trocoInicial: number; pagamentos: { forma: Forma; valorCentavos: number; estornado: boolean }[]; saidasDinheiro: number[] }) {
  const porForma = Object.fromEntries(FORMAS.map((f) => [f, 0])) as Record<Forma, number>;
  for (const p of i.pagamentos) if (!p.estornado) porForma[p.forma] += p.valorCentavos;
  return { porForma, esperadoDinheiro: i.trocoInicial + porForma.dinheiro - somar(i.saidasDinheiro) };
}

/** Negativa: faltou dinheiro; positiva: sobrou. */
export function diferenca(contado: number, esperadoDinheiro: number): number {
  return contado - esperadoDinheiro;
}

/** Data civil do caixa (`YYYY-MM-DD`) em São Paulo; en-CA já formata nesse padrão. */
export function dataDoCaixa(agora: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}
