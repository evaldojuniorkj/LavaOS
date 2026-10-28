import { eq, inArray } from 'drizzle-orm';
import { hashSecret } from '@/lib/auth/credentials';
import { account, credenciaisLavador, user } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { testUrls } from './db';
import { createFoundationFixtures, type FoundationFixtures } from './fixtures';

// O runtime (getDatabase/getAuth) aponta para lavaos_test; forçado mesmo com .env.local de dev carregado.
Object.assign(process.env, {
  DATABASE_URL: testUrls.app,
  MIGRATION_DATABASE_URL: testUrls.owner,
  TEST_DATABASE_URL: testUrls.app,
  BETTER_AUTH_SECRET: 'segredo-de-teste-com-mais-de-32-caracteres',
  BETTER_AUTH_URL: 'http://localhost:3000',
  LAVAOS_PILOT_SLUG: 'tenant-a',
  LAVAOS_MODE: 'test',
});

export type AuthFixtures = FoundationFixtures & {
  /** Senha temporária comum a todas as contas de staff criadas aqui. */
  senha: string;
  emailDe(userId: string): string;
  /** Login PIN do lavador de A; o lavador de B tem o mesmo usuário com outro PIN. */
  lavador: { usuario: string; pin: string; pinB: string };
};

/** Fixtures da Fundação + conta de e-mail/senha para todo staff; lavador só tem PIN e e-mail técnico. */
export async function createAuthFixtures(db: Database): Promise<AuthFixtures> {
  const f = await createFoundationFixtures(db);
  const senha = `senha-${crypto.randomUUID()}`;
  const staff = [f.a, f.b].flatMap((t) => [t.membros.dono, t.membros.gerente, t.membros.recepcao].map((m) => m.userId));
  staff.push(f.multi.userId);
  const hash = await hashSecret(senha);
  await db.insert(account).values(staff.map((userId) => ({ userId, accountId: userId, providerId: 'credential', password: hash })));
  const lavador = { usuario: 'lavador.a', pin: '0123', pinB: '9999' };
  for (const [t, pin] of [[f.a, lavador.pin], [f.b, lavador.pinB]] as const) {
    const { userId, memberId } = t.membros.lavador;
    await db.update(user).set({ email: `${userId}@lavador.invalid` }).where(eq(user.id, userId));
    await db.insert(credenciaisLavador).values({ tenantId: t.tenantId, membroId: memberId, usuarioNormalizado: lavador.usuario, pinHash: await hashSecret(pin) });
  }
  const rows = await db.select({ id: user.id, email: user.email }).from(user).where(inArray(user.id, staff));
  const emails = new Map(rows.map((r) => [r.id, r.email]));
  return { ...f, senha, emailDe: (userId) => emails.get(userId)!, lavador };
}
