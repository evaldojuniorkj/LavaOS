/** Maiúsculas, sem hífen/espaço; aceita AAA9999 e Mercosul AAA9A99. Qualquer outra forma é null. */
export function normalizarPlaca(raw: string): string | null {
  const p = raw.replace(/[\s-]/g, '');
  // ASCII antes de maiusculizar: toUpperCase() de 'ﬃ' vira 'FFI' e fabricaria uma placa válida
  return /^[A-Za-z]{3}\d[A-Za-z\d]\d{2}$/.test(p) ? p.toUpperCase() : null;
}

/** Texto do veículo onde não cabe a placa em destaque (aria-label, mensagens): nunca "null". */
export function rotuloVeiculo(v: { placa: string | null; modelo: string | null; cor: string | null }): string {
  if (v.placa) return v.placa;
  return v.modelo ? `Sem placa — ${v.modelo}${v.cor ? ` ${v.cor}` : ''}` : 'Sem placa';
}

/** E.164 do Brasil: aceita máscara e +55/55 opcional (outro país é recusado). Celular: DDD + 9 + 8 dígitos; fixo: DDD + 2–5 + 7. */
export function normalizarTelefone(raw: string): string | null {
  const t = raw.trim();
  if (!/^\+?[\d\s().-]+$/.test(t)) return null;
  let d = t.replace(/\D/g, '');
  if (t.startsWith('+')) {
    if (!d.startsWith('55')) return null;
    d = d.slice(2);
  } else if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); // DDD 55 existe, mas só com 10–11 dígitos totais
  return /^[1-9]\d(9\d{8}|[2-5]\d{7})$/.test(d) ? `+55${d}` : null;
}
