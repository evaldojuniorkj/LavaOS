/**
 * Link público de acompanhamento (/acompanhar/{token}): ÚNICA leitura sem TenantContext.
 * O token é a credencial: 32 bytes aleatórios em base64url (256 bits de entropia), então não dá para adivinhar
 * nem enumerar; a busca é por igualdade no índice único de `token_publico` (sem comparação caractere a caractere em JS).
 * O tenant sai da própria OS encontrada, nunca do cliente. A resposta só tem o que o cliente final pode ver:
 * nada de equipe, cliente, observações, motivo, ids internos, comissão, desconto/acréscimo ou o próprio token.
 */
import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/client';
import { lavaJatos, ordensServico, osItens, veiculos, type OsStatus } from '@/lib/db/schema';

export type OsPublica = {
  lavaJato: { nome: string };
  veiculo: { modelo: string | null; placa: string };
  status: OsStatus;
  linhaDoTempo: { entradaEm: Date; inicioLavagemEm: Date | null; prontoEm: Date | null; entregueEm: Date | null; canceladaEm: Date | null };
  itens: { nome: string; valorCentavos: number }[];
  totalCentavos: number;
};

const FORMATO = /^[A-Za-z0-9_-]{43}$/; // randomBytes(32).toString('base64url')
const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

async function porToken(token: string, agora: Date) {
  if (!FORMATO.test(token)) return null; // malformado não chega ao banco
  const [os] = await getDatabase()
    .select({
      tenantId: ordensServico.tenantId,
      osId: ordensServico.id,
      lavaJato: lavaJatos.nome,
      modelo: veiculos.modelo,
      placa: veiculos.placa,
      status: ordensServico.status,
      entradaEm: ordensServico.entradaEm,
      inicioLavagemEm: ordensServico.inicioLavagemEm,
      prontoEm: ordensServico.prontoEm,
      entregueEm: ordensServico.entregueEm,
      canceladaEm: ordensServico.canceladaEm,
      totalCentavos: ordensServico.totalCentavos,
    })
    .from(ordensServico)
    .innerJoin(lavaJatos, eq(lavaJatos.id, ordensServico.tenantId))
    .innerJoin(veiculos, and(eq(veiculos.tenantId, ordensServico.tenantId), eq(veiculos.id, ordensServico.veiculoId)))
    .where(eq(ordensServico.tokenPublico, token));
  if (!os) return null;
  const fim = os.entregueEm ?? os.canceladaEm;
  if (fim && agora.getTime() - fim.getTime() > SETE_DIAS_MS) return null; // exatamente 7 dias ainda vale
  return os;
}

/** Só para o SSE público: onde assinar. null em qualquer falha (mesma resposta para todas). */
export async function localizarOsPublica(token: string, agora = new Date()): Promise<{ tenantId: string; osId: string } | null> {
  const os = await porToken(token, agora);
  return os && { tenantId: os.tenantId, osId: os.osId };
}

/** null para token malformado, inexistente ou OS entregue/cancelada há mais de 7 dias. */
export async function buscarOsPublica(token: string, agora = new Date()): Promise<OsPublica | null> {
  const os = await porToken(token, agora);
  if (!os) return null;
  const itens = await getDatabase()
    .select({ nome: osItens.nomeServico, valorCentavos: osItens.valorCentavos })
    .from(osItens)
    .where(and(eq(osItens.tenantId, os.tenantId), eq(osItens.osId, os.osId)))
    .orderBy(asc(osItens.createdAt), asc(osItens.id));
  return {
    lavaJato: { nome: os.lavaJato },
    veiculo: { modelo: os.modelo, placa: os.placa },
    status: os.status,
    linhaDoTempo: { entradaEm: os.entradaEm, inicioLavagemEm: os.inicioLavagemEm, prontoEm: os.prontoEm, entregueEm: os.entregueEm, canceladaEm: os.canceladaEm },
    itens,
    totalCentavos: os.totalCentavos,
  };
}
