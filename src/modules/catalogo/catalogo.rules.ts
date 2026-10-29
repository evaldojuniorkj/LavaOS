export function precoParaPorte(precos: { servicoId: string; porteId: string; valorCentavos: number }[], servicoId: string, porteId: string): number | null {
  return precos.find((p) => p.servicoId === servicoId && p.porteId === porteId)?.valorCentavos ?? null;
}

/** Percentual: inteiro 0–10000 pontos-base. Fixo: inteiro >= 0 centavos. */
export function validarComissao(tipo: 'percentual' | 'fixo', valor: number): boolean {
  return Number.isInteger(valor) && (tipo === 'percentual' ? valor >= 0 && valor <= 10000 : valor >= 0);
}

/** "12,50" -> 1250 e "30" -> 3000, em aritmética inteira (sem float). Qualquer outra forma é null. Usado para R$ e %. */
export function decimalParaCentesimos(texto: string): number | null {
  const m = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(texto.trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : null;
}

/** 1250 -> "12,50" (R$ e % só existem na UI). */
export function centesimosParaTexto(valor: number): string {
  return `${Math.floor(valor / 100)},${String(valor % 100).padStart(2, '0')}`;
}
