import { z } from 'zod';
import { validarComissao } from './catalogo.rules';

const id = z.guid();
const nome = z.string().trim().min(1, 'Informe o nome.').max(80);
const INT4 = 2_147_483_647;

// strict: tenant_id ou qualquer campo extra é recusado, nunca ignorado.
export const salvarPorteSchema = z.strictObject({ id: id.optional(), nome, ordem: z.number().int().min(0).max(9999).optional(), ativo: z.boolean().optional() });

export const salvarServicoSchema = z
  .strictObject({
    id: id.optional(),
    nome,
    descricao: z.string().trim().max(300).nullish(),
    duracaoEstimadaMin: z.number().int().min(1).max(1440).nullish(),
    adicional: z.boolean(),
    comissaoTipo: z.enum(['percentual', 'fixo']),
    comissaoValor: z.number().max(INT4),
    ativo: z.boolean().optional(),
  })
  .refine((s) => validarComissao(s.comissaoTipo, s.comissaoValor), { path: ['comissaoValor'], message: 'Comissão inválida.' });

export const definirPrecoSchema = z.strictObject({ servicoId: id, porteId: id, valorCentavos: z.number().int('Informe um valor inteiro em centavos.').min(0, 'O valor não pode ser negativo.').max(INT4) });
