import { z } from 'zod';

// strict: valores, totais, tenant ou qualquer campo extra são recusados, nunca ignorados. Preço vem só do banco.
export const abrirOsSchema = z.strictObject({
  veiculoId: z.guid(),
  servicoIds: z
    .array(z.guid())
    .min(1, 'Escolha ao menos um serviço.')
    .max(30)
    .refine((ids) => new Set(ids).size === ids.length, 'Serviço repetido.'),
  responsavelId: z.guid().optional(),
  observacoes: z.string().trim().max(500).nullish(),
});
