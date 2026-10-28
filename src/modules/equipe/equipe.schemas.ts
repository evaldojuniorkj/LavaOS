import { z } from 'zod';

const nomeExibicao = z.string().trim().min(1).max(80);
const pin = z.string().regex(/^\d{4,6}$/, 'O PIN deve ter de 4 a 6 dígitos.');

// strict: tenant_id, perfil de alvo ou qualquer campo extra é recusado, nunca ignorado.
export const createMemberSchema = z.discriminatedUnion('perfil', [
  z.strictObject({
    perfil: z.enum(['dono', 'gerente', 'recepcao']),
    nomeExibicao,
    // minúsculo: o login do Better Auth procura o e-mail assim
    email: z.email('E-mail inválido.').max(254).toLowerCase(),
    senha: z.string().min(8, 'A senha deve ter de 8 a 128 caracteres.').max(128, 'A senha deve ter de 8 a 128 caracteres.'),
  }),
  z.strictObject({
    perfil: z.literal('lavador'),
    nomeExibicao,
    usuario: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9_.]{3,30}$/, 'Use de 3 a 30 caracteres: letras, números, ponto ou sublinhado.'),
    pin,
  }),
]);

export const memberIdSchema = z.strictObject({ memberId: z.uuid() });

export const resetPinSchema = z.strictObject({ memberId: z.uuid(), pin });
