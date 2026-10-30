import { normalizarTelefone } from './clientes.rules';

/** wa.me/<só dígitos>?text=<mensagem codificada>; telefone inválido nunca vira link. */
export function linkWhatsapp(telefone: string, mensagem: string): string | null {
  const t = normalizarTelefone(telefone);
  return t && `https://wa.me/${t.slice(1)}?text=${encodeURIComponent(mensagem)}`;
}

const veiculo = (modelo: string | null, placa: string | null) => (modelo && placa ? `${modelo} (${placa})` : (placa ?? modelo ?? 'veículo'));

export function mensagemEntrada(i: { lavaJato: string; modelo: string | null; placa: string | null; urlAcompanhar: string }): string {
  return `Olá! Aqui é do ${i.lavaJato}. Recebemos o seu ${veiculo(i.modelo, i.placa)}.\nAcompanhe a lavagem em tempo real: ${i.urlAcompanhar}`;
}

/** R$ 1.234,56 só com inteiros (centavos). */
export function formatarReais(centavos: number): string {
  const reais = String(Math.floor(centavos / 100)).replace(/\B(?=(\d{3})+$)/g, '.');
  return `R$ ${reais},${String(centavos % 100).padStart(2, '0')}`;
}

export function mensagemPronto(i: { lavaJato: string; modelo: string | null; placa: string | null; totalCentavos: number }): string {
  return `Olá! Aqui é do ${i.lavaJato}. O seu ${veiculo(i.modelo, i.placa)} está pronto para retirada. Total: ${formatarReais(i.totalCentavos)}.`;
}
