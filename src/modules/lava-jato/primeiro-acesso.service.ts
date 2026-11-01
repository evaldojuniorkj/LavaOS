import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashSecret } from '@/lib/auth/credentials';
import { AcessoNegadoError } from '@/lib/auth/permissions';
import { getDatabase } from '@/lib/db/client';
import { lavaJatos, portes, servicos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { getServerEnv } from '@/lib/env';
import { limitar } from '@/lib/rate-limit';
import type { ActionResult } from '@/modules/equipe/equipe.actions';
import { EquipeError, emTransacao, inserirMembro } from '@/modules/equipe/equipe.service';
import { codigoConfere } from './primeiro-acesso.rules';
import { formPrimeiroAcessoSchema, type PrimeiroAcessoInput } from './primeiro-acesso.schemas';

/** Chave fixa do pg_advisory_xact_lock que serializa o primeiro acesso. */
export const TRAVA_PRIMEIRO_ACESSO = 7_314_001;
const TENTATIVAS = 5;
const JANELA_MS = 15 * 60 * 1000;

const PORTES = ['Moto', 'Carro pequeno', 'SUV/Sedan grande', 'Caminhonete'];
// inativos e sem preço: nada é vendável (nem a R$ 0) até o dono definir os preços e ativar
const EXEMPLOS = [
  { nome: 'Lavagem simples', adicional: false },
  { nome: 'Lavagem completa', adicional: false },
  { nome: 'Lavagem completa sem motor', adicional: false },
  { nome: 'Cera', adicional: true },
];

export async function sistemaConfigurado(db: Database = getDatabase()): Promise<boolean> {
  return (await db.select({ id: lavaJatos.id }).from(lavaJatos).limit(1)).length > 0;
}

/** Cria tenant, dono, portes e serviços de exemplo numa transação. Recusa (AcessoNegadoError) se já existe qualquer lava jato. */
export async function criarPrimeiroLavaJato(i: PrimeiroAcessoInput, db: Database = getDatabase()): Promise<{ tenantId: string }> {
  const segredo = await hashSecret(i.donoSenha); // fora da transação: não segura a trava durante o scrypt
  return emTransacao(db, async (tx) => {
    // checagem e criação sob a mesma trava: duas chamadas simultâneas criam exatamente um tenant
    await tx.execute(sql`select pg_advisory_xact_lock(${TRAVA_PRIMEIRO_ACESSO})`);
    if ((await tx.select({ id: lavaJatos.id }).from(lavaJatos).limit(1)).length) throw new AcessoNegadoError();
    const [{ tenantId }] = await tx
      .insert(lavaJatos)
      .values({ nome: i.nomeLavaJato, slug: getServerEnv().LAVAOS_PILOT_SLUG, telefone: i.telefone ?? null })
      .returning({ tenantId: lavaJatos.id });
    await inserirMembro(tx, tenantId, { perfil: 'dono', nomeExibicao: i.donoNome, email: i.donoEmail, senha: i.donoSenha }, segredo);
    await tx.insert(portes).values(PORTES.map((nome, n) => ({ tenantId, nome, ordem: n + 1 })));
    await tx.insert(servicos).values(EXEMPLOS.map((s) => ({ tenantId, ...s, ativo: false, comissaoTipo: 'fixo' as const, comissaoValor: 0 })));
    return { tenantId };
  });
}

const falha = (code: string, message: string, fieldErrors?: Record<string, string[]>): ActionResult<null> => ({ ok: false, code, message, ...(fieldErrors && { fieldErrors }) });

/**
 * Autoriza pelo código de instalação (LAVAOS_SETUP_TOKEN) + sistema vazio, não por requirePermission: ainda não há sessão.
 * Sem token configurado o assistente está desligado. Toda tentativa válida conta no limite por IP, antes da comparação.
 */
export async function primeiroAcesso(
  input: unknown,
  { token, ip, agora = Date.now() }: { token?: string; ip: string; agora?: number },
  db: Database = getDatabase(),
): Promise<ActionResult<null>> {
  if (!token) return falha('ACESSO_NEGADO', 'acesso negado');
  const parsed = formPrimeiroAcessoSchema.safeParse(input, { error: z.locales.pt().localeError });
  if (!parsed.success) return falha('VALIDACAO', 'Dados inválidos.', z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  if (!limitar(`primeiro-acesso:${ip}`, TENTATIVAS, JANELA_MS, agora)) return falha('LIMITE', 'Muitas tentativas. Aguarde 15 minutos e tente de novo.');
  const { codigo, nomeLavaJato, telefone, donoNome, donoEmail, donoSenha } = parsed.data;
  if (!codigoConfere(codigo, token)) return falha('CODIGO_INVALIDO', 'Código de instalação inválido.', { codigo: ['Código de instalação inválido.'] });
  try {
    await criarPrimeiroLavaJato({ nomeLavaJato, telefone, donoNome, donoEmail, donoSenha }, db);
    return { ok: true, data: null };
  } catch (err) {
    if (err instanceof AcessoNegadoError) return falha('JA_CONFIGURADO', 'Este LavaOS já foi configurado. Entre pelo login.');
    if (err instanceof EquipeError) return falha(err.code, err.message);
    // só o nome: a mensagem do driver traz os parâmetros da query (hash)
    console.error('[primeiro-acesso] falha inesperada', { erro: err instanceof Error ? err.name : typeof err });
    return falha('ERRO_INTERNO', 'Não foi possível concluir. Tente novamente.');
  }
}
