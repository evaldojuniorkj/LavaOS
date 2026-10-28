import 'server-only';
import { and, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { hashSecret } from '@/lib/auth/credentials';
import { AcessoNegadoError, can } from '@/lib/auth/permissions';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { account, credenciaisLavador, lavaJatos, membros, session, user } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { campos, type MemberSummary } from './equipe.repo';
import { canDeactivateMember, canManageTarget } from './equipe.rules';
import type { createMemberSchema } from './equipe.schemas';

export type CreateMemberInput = z.output<typeof createMemberSchema>;

/** Recusa de regra com mensagem segura para a tela. */
export class EquipeError extends Error {
  constructor(
    readonly code: 'IDENTIDADE_EM_USO' | 'NAO_ENCONTRADO' | 'SEM_PIN' | 'ULTIMO_DONO' | 'CONFLITO',
    message: string,
  ) {
    super(message);
    this.name = 'EquipeError';
  }
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
const naoEncontrado = () => new EquipeError('NAO_ENCONTRADO', 'Membro não encontrado.');

async function emTransacao<T>(db: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(fn);
  } catch (err) {
    // o Drizzle embrulha o erro do pg em `cause`
    const pg = ((err as { cause?: unknown }).cause ?? err) as { code?: string; constraint?: string };
    if (pg.code === '55P03') throw new EquipeError('CONFLITO', 'Outra alteração da equipe está em andamento. Tente novamente.');
    if (pg.code === '23505') {
      throw new EquipeError('IDENTIDADE_EM_USO', pg.constraint === 'user_email_unique' ? 'Este e-mail já está em uso.' : 'Este usuário já está em uso.');
    }
    throw err;
  }
}

const linhaMembro = (tx: Tx, ctx: TenantContext, id: string) =>
  tx
    .select({ id: membros.id, userId: membros.userId, perfil: membros.perfil, ativo: membros.ativo })
    .from(membros)
    .where(and(eq(membros.tenantId, ctx.tenantId), eq(membros.id, id)))
    .for('update');

/**
 * Toda mutação de equipe trava na mesma ordem — tenant → ator → alvo — com espera limitada.
 * A trava do tenant serializa as mutações do lava jato (ex.: contagem de donos ativos).
 * O ator é relido travado: regras usam o perfil/ativo do banco, não o da sessão.
 */
async function travarAtor(tx: Tx, ctx: TenantContext) {
  await tx.execute(sql`set local lock_timeout = '5s'`);
  await tx.select({ id: lavaJatos.id }).from(lavaJatos).where(eq(lavaJatos.id, ctx.tenantId)).for('update');
  const [ator] = await linhaMembro(tx, ctx, ctx.memberId);
  if (!ator?.ativo) throw new AcessoNegadoError();
  return ator;
}

async function travarAlvo(tx: Tx, ctx: TenantContext, memberId: string) {
  const ator = await travarAtor(tx, ctx);
  const [alvo] = await linhaMembro(tx, ctx, memberId);
  if (!alvo) throw naoEncontrado(); // inclui membro de outro tenant: nada é revelado
  if (!canManageTarget(ator.perfil, alvo.perfil)) throw new AcessoNegadoError();
  return { ator, alvo };
}

/** Staff: user + conta credential (hash da biblioteca). Lavador: user técnico sem conta de senha + credencial PIN. */
export async function createMember(ctx: TenantContext, input: CreateMemberInput, db: Database = getDatabase()): Promise<MemberSummary> {
  const lavador = input.perfil === 'lavador';
  const segredo = await hashSecret(lavador ? input.pin : input.senha); // fora da transação: não segura travas durante o scrypt
  const userId = crypto.randomUUID();
  return emTransacao(db, async (tx) => {
    const ator = await travarAtor(tx, ctx);
    const lideranca = input.perfil === 'dono' || input.perfil === 'gerente';
    if (!can(ator.perfil, lideranca ? 'equipe:gerenciar_lideranca' : 'equipe:gerenciar')) throw new AcessoNegadoError();
    // sempre um user novo: e-mail existente (de qualquer tenant) é conflito, nunca reassociação
    await tx.insert(user).values({ id: userId, name: input.nomeExibicao, email: lavador ? `${userId}@lavador.invalid` : input.email });
    if (!lavador) await tx.insert(account).values({ userId, accountId: userId, providerId: 'credential', password: segredo });
    const [m] = await tx
      .insert(membros)
      .values({ tenantId: ctx.tenantId, userId, perfil: input.perfil, nomeExibicao: input.nomeExibicao })
      .returning(campos);
    if (lavador) {
      await tx.insert(credenciaisLavador).values({ tenantId: ctx.tenantId, membroId: m.id, usuarioNormalizado: input.usuario, pinHash: segredo });
    }
    return m;
  });
}

export async function deactivateMember(ctx: TenantContext, memberId: string, db: Database = getDatabase()): Promise<void> {
  if (!z.guid().safeParse(memberId).success) throw naoEncontrado();
  await emTransacao(db, async (tx) => {
    const { ator, alvo } = await travarAlvo(tx, ctx, memberId);
    if (alvo.ativo) {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(membros)
        .where(and(eq(membros.tenantId, ctx.tenantId), eq(membros.perfil, 'dono'), eq(membros.ativo, true)));
      if (!canDeactivateMember(ator.perfil, alvo.perfil, n)) throw new EquipeError('ULTIMO_DONO', 'O lava jato precisa de pelo menos um dono ativo.');
      await tx.update(membros).set({ ativo: false }).where(eq(membros.id, alvo.id));
    }
    // Revogação global: apaga TODAS as sessões do user, inclusive as de outro tenant em que ele tenha vínculo
    // (escolha conservadora do piloto; o vínculo de lá segue ativo e ele pode entrar de novo).
    await tx.delete(session).where(eq(session.userId, alvo.userId));
  });
}

/** Novo hash + versão incrementada + bloqueio zerado + sessões PIN do membro apagadas, numa transação. */
export async function resetPin(ctx: TenantContext, memberId: string, pin: string, db: Database = getDatabase()): Promise<void> {
  if (!z.guid().safeParse(memberId).success) throw naoEncontrado();
  const pinHash = await hashSecret(pin);
  await emTransacao(db, async (tx) => {
    const { alvo } = await travarAlvo(tx, ctx, memberId);
    // mesma trava do login PIN: um login em verificação termina antes, e a sessão dele carrega a versão antiga
    const [c] = await tx
      .select({ id: credenciaisLavador.id })
      .from(credenciaisLavador)
      .where(and(eq(credenciaisLavador.tenantId, ctx.tenantId), eq(credenciaisLavador.membroId, alvo.id)))
      .for('update');
    if (alvo.perfil !== 'lavador' || !c) throw new EquipeError('SEM_PIN', 'Só lavador tem PIN.');
    await tx
      .update(credenciaisLavador)
      .set({ pinHash, versao: sql`${credenciaisLavador.versao} + 1`, errosConsecutivos: 0, bloqueadoAte: null })
      .where(eq(credenciaisLavador.id, c.id));
    await tx.delete(session).where(and(eq(session.userId, alvo.userId), eq(session.pinMemberId, alvo.id)));
  });
}
