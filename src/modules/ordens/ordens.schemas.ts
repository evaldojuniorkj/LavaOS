import { z } from 'zod';
import { PRECO_MAXIMO_CENTAVOS } from '@/modules/catalogo/catalogo.rules';
import type { StatusOs } from './ordens.rules';

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

const status = z.enum(['aguardando', 'em_lavagem', 'pronto', 'entregue', 'cancelada'] satisfies StatusOs[]);
export const transitarOsSchema = z.strictObject({
  osId: z.guid(),
  esperado: status,
  para: status,
  responsavelId: z.guid().optional(),
  motivo: z.string().trim().max(500).optional(),
});
export const atribuirResponsavelSchema = z.strictObject({ osId: z.guid(), membroId: z.guid().nullable() });

const unicos = (ids: string[]) => new Set(ids).size === ids.length;
export const editarItensSchema = z
  .strictObject({
    osId: z.guid(),
    adicionar: z.array(z.guid()).max(30).refine(unicos, 'Serviço repetido.'),
    remover: z.array(z.guid()).max(30).refine(unicos, 'Item repetido.'),
  })
  .refine((v) => v.adicionar.length + v.remover.length > 0, 'Nada a alterar.');
const centavos = z.number().int().min(0).max(PRECO_MAXIMO_CENTAVOS, 'Valor acima do máximo de R$ 100.000,00.');
export const ajustarValorSchema = z.strictObject({ osId: z.guid(), descontoCentavos: centavos, acrescimoCentavos: centavos });
