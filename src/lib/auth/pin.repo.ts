import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { getDatabase } from '@/lib/db/client';
import { credenciaisLavador, lavaJatos, membros, tentativasPinOrigem } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { hashSecret } from './credentials';
import { isPinBlocked, isValidPin, isValidUsername, nextPinFailure, PIN_BLOQUEIO_MS } from './pin.rules';
import type { TenantScope } from './types';

/** Server-only: contém o hash. Nunca serializar em DTO, log ou resposta. */
export type PinCredential = {
  id: string;
  memberId: string;
  userId: string;
  ativo: boolean;
  pinHash: string;
  versao: number;
  errosConsecutivos: number;
  bloqueadoAte: Date | null;
};
export type PinHasher = { hash(secret: string): Promise<string>; verify(secret: string, hash: string): Promise<boolean> };
export type PinAttempt =
  | { ok: true; userId: string; memberId: string; credentialVersion: number }
  | { ok: false; code: 'INVALID_CREDENTIALS' | 'PIN_BLOCKED'; retryAfterSeconds?: number };

/** Tentativas por IP do cliente na janela, somando todos os usuários do tenant. */
export const PIN_LIMITE_ORIGEM = 20;

const INVALIDO = { ok: false, code: 'INVALID_CREDENTIALS' } as const;

// Hash descartável no mesmo algoritmo: usuário inexistente/inativo custa o mesmo verify que PIN errado.
let dummyHash: Promise<string> | undefined;

export async function resolvePilotScope(slug: string): Promise<TenantScope> {
  const [t] = await getDatabase().select({ tenantId: lavaJatos.id }).from(lavaJatos).where(eq(lavaJatos.slug, slug));
  if (!t) throw new Error('tenant do piloto não encontrado (LAVAOS_PILOT_SLUG)');
  return { tenantId: t.tenantId };
}

const selectCredential = (db: Database, scope: TenantScope, usuario: string) =>
  db
    .select({
      id: credenciaisLavador.id,
      memberId: membros.id,
      userId: membros.userId,
      ativo: membros.ativo,
      perfil: membros.perfil,
      pinHash: credenciaisLavador.pinHash,
      versao: credenciaisLavador.versao,
      errosConsecutivos: credenciaisLavador.errosConsecutivos,
      bloqueadoAte: credenciaisLavador.bloqueadoAte,
    })
    .from(credenciaisLavador)
    .innerJoin(membros, and(eq(membros.tenantId, credenciaisLavador.tenantId), eq(membros.id, credenciaisLavador.membroId)))
    .where(and(eq(credenciaisLavador.tenantId, scope.tenantId), eq(credenciaisLavador.usuarioNormalizado, usuario)));

/**
 * Verifica o PIN com a linha da credencial travada (FOR UPDATE): tentativas concorrentes são serializadas e
 * cada erro é gravado antes da próxima ler o contador. A falha é um retorno, não um throw, então o contador faz COMMIT.
 */
export async function verifyAttempt(scope: TenantScope, usuario: string, pin: string, now: Date, hasher: PinHasher): Promise<PinAttempt> {
  const dummy = async () => (await hasher.verify(pin, await (dummyHash ??= hashSecret(crypto.randomUUID()))), INVALIDO);
  if (!isValidUsername(usuario) || !isValidPin(pin)) return dummy();
  return getDatabase().transaction(async (tx) => {
    // lock limitado: o titular segura a linha só durante um verify de hash
    await tx.execute(sql`set local lock_timeout = '5s'`);
    const [c] = await selectCredential(tx, scope, usuario).for('update', { of: credenciaisLavador });
    if (!c || !c.ativo || c.perfil !== 'lavador') return dummy();
    if (isPinBlocked(c.bloqueadoAte, now)) {
      await hasher.verify(pin, c.pinHash); // resultado descartado: mesmo custo das outras falhas, o tempo não revela o usuário
      return { ok: false, code: 'PIN_BLOCKED', retryAfterSeconds: Math.ceil((c.bloqueadoAte!.getTime() - now.getTime()) / 1000) };
    }
    if (await hasher.verify(pin, c.pinHash)) {
      await tx.update(credenciaisLavador).set({ errosConsecutivos: 0, bloqueadoAte: null }).where(eq(credenciaisLavador.id, c.id));
      return { ok: true, userId: c.userId, memberId: c.memberId, credentialVersion: c.versao };
    }
    // bloqueio já vencido: esta é a primeira tentativa de uma série nova
    const falha = nextPinFailure(c.bloqueadoAte ? 0 : c.errosConsecutivos, now);
    await tx.update(credenciaisLavador).set({ errosConsecutivos: falha.failed, bloqueadoAte: falha.blockedUntil }).where(eq(credenciaisLavador.id, c.id));
    return falha.blockedUntil ? { ok: false, code: 'PIN_BLOCKED', retryAfterSeconds: PIN_BLOQUEIO_MS / 1000 } : INVALIDO;
  });
}

/**
 * Conta uma tentativa para o IP numa janela fixa de 15 minutos, num único upsert atômico.
 * shortcut: linhas de IPs antigos não são apagadas (janela vencida é reaproveitada); limpar por job se a tabela crescer.
 */
export async function consumeOriginAttempt(scope: TenantScope, ip: string, now: Date): Promise<boolean> {
  const inicioValido = new Date(now.getTime() - PIN_BLOQUEIO_MS);
  const vencida = sql`${tentativasPinOrigem.janelaInicio} <= ${inicioValido}`;
  const [r] = await getDatabase()
    .insert(tentativasPinOrigem)
    .values({ tenantId: scope.tenantId, ip, janelaInicio: now, tentativas: 1 })
    .onConflictDoUpdate({
      target: [tentativasPinOrigem.tenantId, tentativasPinOrigem.ip],
      set: {
        tentativas: sql`case when ${vencida} then 1 else ${tentativasPinOrigem.tentativas} + 1 end`,
        janelaInicio: sql`case when ${vencida} then ${now} else ${tentativasPinOrigem.janelaInicio} end`,
      },
    })
    .returning({ tentativas: tentativasPinOrigem.tentativas });
  return r.tentativas <= PIN_LIMITE_ORIGEM;
}
