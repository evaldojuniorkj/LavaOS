import { z } from 'zod';

const nomeExibicao = z.string().trim().min(1).max(80);

// strict: tenant_id, perfil de alvo ou qualquer campo extra é recusado, nunca ignorado.
export const createMemberSchema = z.discriminatedUnion('perfil', [
  z.strictObject({
    perfil: z.enum(['dono', 'gerente', 'recepcao']),
    nomeExibicao,
    email: z.email().max(254),
    senha: z.string().min(8).max(128),
  }),
  z.strictObject({
    perfil: z.literal('lavador'),
    nomeExibicao,
    usuario: z.string().trim().toLowerCase().regex(/^[a-z0-9_.]{3,30}$/),
    pin: z.string().regex(/^\d{4,6}$/),
  }),
]);

export const memberIdSchema = z.strictObject({ memberId: z.uuid() });
