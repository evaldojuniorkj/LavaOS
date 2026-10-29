/** Maiúsculas, sem hífen/espaço; aceita AAA9999 e Mercosul AAA9A99. Qualquer outra forma é null. */
export function normalizarPlaca(raw: string): string | null {
  const p = raw.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z]{3}\d[A-Z\d]\d{2}$/.test(p) ? p : null;
}

/** E.164 do Brasil: aceita máscara e +55 opcional; 10–11 dígitos nacionais (DDD + número). Senão null. */
export function normalizarTelefone(raw: string): string | null {
  if (!/^\+?[\d\s().-]+$/.test(raw.trim())) return null;
  let d = raw.replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2); // DDD 55 existe, mas só com 10–11 dígitos totais
  return /^[1-9]\d{9,10}$/.test(d) ? `+55${d}` : null;
}
