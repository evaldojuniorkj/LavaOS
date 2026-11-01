import { z } from 'zod';
import { PRECO_MAXIMO_CENTAVOS } from '@/modules/catalogo/catalogo.rules';
import { FORMAS } from './caixa.rules';

// strict: tenant, status, diferença ou qualquer campo extra são recusados; o servidor calcula o resto.
const centavos = z.number().int().min(0).max(PRECO_MAXIMO_CENTAVOS, 'Valor acima do máximo de R$ 100.000,00.');
export const abrirCaixaSchema = z.strictObject({ trocoInicialCentavos: centavos });
export const receberSchema = z.strictObject({ osId: z.guid(), forma: z.enum(FORMAS), valorCentavos: centavos.min(1, 'Informe o valor.') });
export const estornarPagamentoSchema = z.strictObject({ pagamentoId: z.guid(), motivo: z.string().trim().min(1, 'Informe o motivo.').max(500) });
export const fecharCaixaSchema = z.strictObject({ caixaId: z.guid(), dinheiroContadoCentavos: centavos });
export const reabrirCaixaSchema = z.strictObject({ caixaId: z.guid() });
