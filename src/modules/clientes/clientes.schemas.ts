import { z } from 'zod';
import { normalizarPlaca, normalizarTelefone } from './clientes.rules';

const id = z.guid();
const texto = (max: number) => z.string().trim().max(max).nullish();
const nome = z.string().trim().min(1, 'Informe o nome.').max(120);

// Entrada inválida vira erro de campo; a saída já é o valor normalizado.
const placa = z.string().transform((v, ctx) => {
  const p = normalizarPlaca(v);
  if (!p) ctx.issues.push({ code: 'custom', message: 'Placa inválida. Use AAA-1234 ou AAA1B23.', input: v });
  return p ?? z.NEVER;
});
export const telefone = z
  .string()
  .trim()
  .nullish()
  .transform((v, ctx) => {
    if (!v) return null;
    const t = normalizarTelefone(v);
    if (!t) ctx.issues.push({ code: 'custom', message: 'Telefone inválido. Use DDD + número.', input: v });
    return t ?? z.NEVER;
  });

// strict: tenant_id ou qualquer campo extra é recusado, nunca ignorado.
export const salvarClienteSchema = z.strictObject({ id: id.optional(), nome, telefone: telefone.optional(), observacoes: texto(500) });

export const salvarTelefoneClienteSchema = z.strictObject({ clienteId: id, telefone: telefone.refine((v): v is string => !!v, 'Informe o telefone.') });

export const salvarVeiculoSchema = z.strictObject({ id: id.optional(), placa, porteId: id, modelo: texto(80), cor: texto(40), clienteId: id.nullish() });

// União { placa } | { semPlaca: true, modelo } em um objeto só, para o erro cair no campo certo.
export const cadastroRapidoSchema = z
  .strictObject({ placa: placa.optional(), semPlaca: z.literal(true).optional(), porteId: id, modelo: texto(80), clienteNome: texto(120), telefone: telefone.optional() })
  .superRefine((d, ctx) => {
    if (!d.semPlaca) {
      if (!d.placa) ctx.addIssue({ code: 'custom', path: ['placa'], message: 'Informe a placa.' });
      return;
    }
    if (d.placa) ctx.addIssue({ code: 'custom', path: ['placa'], message: 'Informe a placa ou marque veículo sem placa, não os dois.' });
    if (!d.modelo || d.modelo.length < 2 || d.modelo.length > 40) ctx.addIssue({ code: 'custom', path: ['modelo'], message: 'Informe o modelo (2 a 40 letras).' });
  })
  .refine((d) => !d.telefone || d.clienteNome, { path: ['clienteNome'], message: 'Informe o nome do cliente.' });
