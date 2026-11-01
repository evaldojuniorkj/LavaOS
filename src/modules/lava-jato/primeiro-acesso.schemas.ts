import { z } from 'zod';
import { telefone } from '@/modules/clientes/clientes.schemas';
import { email, nomeExibicao, senha } from '@/modules/equipe/equipe.schemas';

// strict: tenantId, slug, perfil ou qualquer campo extra é recusado, nunca ignorado. O slug vem do env do servidor.
export const primeiroAcessoSchema = z.strictObject({
  nomeLavaJato: z.string().trim().min(1, 'Informe o nome do lava jato.').max(80),
  telefone: telefone.optional(),
  donoNome: nomeExibicao,
  donoEmail: email,
  donoSenha: senha,
});

export const formPrimeiroAcessoSchema = primeiroAcessoSchema
  .extend({ confirmacaoSenha: z.string(), codigo: z.string().max(256) })
  .refine((d) => d.donoSenha === d.confirmacaoSenha, { path: ['confirmacaoSenha'], message: 'As senhas não conferem.' });

export type PrimeiroAcessoInput = z.output<typeof primeiroAcessoSchema>;
