import { PERFIS, categoriasDespesa, lavaJatos, membros, user, type Perfil } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { CATEGORIAS_PADRAO } from '@/modules/despesas/categorias-padrao';

export type MemberFixture = { userId: string; memberId: string };
export type TenantFixture = { tenantId: string; slug: string; membros: Record<Perfil, MemberFixture> };
export type FoundationFixtures = {
  a: TenantFixture;
  b: TenantFixture;
  /** Um usuário com vínculo ativo nos dois tenants (recepcao em A, gerente em B). */
  multi: { userId: string; memberIdA: string; memberIdB: string };
};

async function createUser(db: Database, name: string): Promise<string> {
  const [u] = await db.insert(user).values({ name, email: `${crypto.randomUUID()}@teste.invalid` }).returning({ id: user.id });
  return u.id;
}

async function createMember(db: Database, tenantId: string, userId: string, perfil: Perfil): Promise<string> {
  const [m] = await db.insert(membros).values({ tenantId, userId, perfil, nomeExibicao: perfil }).returning({ id: membros.id });
  return m.id;
}

async function createTenant(db: Database, slug: string): Promise<TenantFixture> {
  const [t] = await db.insert(lavaJatos).values({ nome: `Lava Jato ${slug}`, slug }).returning({ id: lavaJatos.id });
  await db.insert(categoriasDespesa).values(CATEGORIAS_PADRAO.map((c) => ({ tenantId: t.id, ...c })));
  const entries = await Promise.all(
    PERFIS.map(async (perfil) => {
      const userId = await createUser(db, `${perfil} ${slug}`);
      return [perfil, { userId, memberId: await createMember(db, t.id, userId, perfil) }] as const;
    }),
  );
  return { tenantId: t.id, slug, membros: Object.fromEntries(entries) as Record<Perfil, MemberFixture> };
}

export async function createFoundationFixtures(db: Database): Promise<FoundationFixtures> {
  const a = await createTenant(db, 'tenant-a');
  const b = await createTenant(db, 'tenant-b');
  const userId = await createUser(db, 'multi');
  return {
    a,
    b,
    multi: { userId, memberIdA: await createMember(db, a.tenantId, userId, 'recepcao'), memberIdB: await createMember(db, b.tenantId, userId, 'gerente') },
  };
}
