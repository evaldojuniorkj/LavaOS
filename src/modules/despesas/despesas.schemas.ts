import { z } from 'zod';
import { PRECO_MAXIMO_CENTAVOS } from '@/modules/catalogo/catalogo.rules';

// strict: tenant, caixa, quem lançou ou qualquer campo extra são recusados; o servidor decide o resto.
const data = z.iso.date('Data inválida.');
const motivo = z.string().trim().min(1, 'Informe o motivo.').max(500);
export const lancarDespesaSchema = z.strictObject({
  categoriaId: z.guid(),
  descricao: z.string().trim().min(1, 'Informe a descrição.').max(200),
  valorCentavos: z.number().int().min(1, 'Informe o valor.').max(PRECO_MAXIMO_CENTAVOS, 'Valor acima do máximo de R$ 100.000,00.'),
  pagoEm: data.optional(),
  vencimento: data.optional(),
  doCaixa: z.boolean().optional(),
});
export const marcarComoPagaSchema = z.strictObject({ despesaId: z.guid(), doCaixa: z.boolean().optional() });
export const cancelarDespesaSchema = z.strictObject({ despesaId: z.guid(), motivo });
export const salvarCategoriaSchema = z.strictObject({ id: z.guid().optional(), nome: z.string().trim().min(1, 'Informe o nome.').max(60), ativo: z.boolean().optional() });
