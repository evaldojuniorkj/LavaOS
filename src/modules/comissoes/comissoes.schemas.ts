import { z } from 'zod';
import { PRECO_MAXIMO_CENTAVOS } from '@/modules/catalogo/catalogo.rules';

// strict: tenant, quem deu/pagou ou valores do acerto são recusados; o servidor calcula o resto.
export const lancarValeSchema = z.strictObject({
  membroId: z.guid(),
  valorCentavos: z.number().int().min(1, 'Informe o valor.').max(PRECO_MAXIMO_CENTAVOS, 'Valor acima do máximo de R$ 100.000,00.'),
  doCaixa: z.boolean().optional(),
});
export const cancelarValeSchema = z.strictObject({ valeId: z.guid(), motivo: z.string().trim().min(1, 'Informe o motivo.').max(500) });
export const previaAcertoSchema = z.strictObject({ membroId: z.guid(), ate: z.iso.date('Data inválida.') });
export const pagarAcertoSchema = previaAcertoSchema.extend({ doCaixa: z.boolean().optional() });
