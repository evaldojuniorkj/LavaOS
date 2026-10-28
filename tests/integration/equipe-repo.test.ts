import { describe, expect, it } from 'vitest';
import { createTenantGuards } from '@/lib/auth/context';
import { session } from '@/lib/db/schema';
import { findMember, listMembers } from '@/modules/equipe/equipe.repo';
import { withTestDatabase } from '../helpers/db';
import { createFoundationFixtures } from '../helpers/fixtures';

describe('equipe.repo', () => {
  it('isola tenants e expõe só campos allowlist', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const ctxOf = async (userId: string, tenantId: string) => {
        const [s] = await db
          .insert(session)
          .values({ userId, activeOrganizationId: tenantId, expiresAt: new Date(Date.now() + 3_600_000), token: crypto.randomUUID() })
          .returning();
        return createTenantGuards({
          readSession: async () => ({ session: { id: s.id, userId, expiresAt: s.expiresAt, activeOrganizationId: tenantId } }),
          database: db,
        }).requireTenantContext(new Headers());
      };
      const ctxA = await ctxOf(f.a.membros.dono.userId, f.a.tenantId);

      const lista = await listMembers(ctxA, db);
      const idsA = [...Object.values(f.a.membros).map((m) => m.memberId), f.multi.memberIdA].sort();
      expect(lista.map((m) => m.id).sort()).toEqual(idsA);
      expect(Object.keys(lista[0]).sort()).toEqual(['ativo', 'id', 'nomeExibicao', 'perfil']);

      expect(await findMember(ctxA, f.a.membros.lavador.memberId, db)).toMatchObject({ perfil: 'lavador', ativo: true });
      expect(await findMember(ctxA, f.b.membros.lavador.memberId, db)).toBeNull();
      expect(await findMember(ctxA, crypto.randomUUID(), db)).toBeNull();
      expect(await findMember(ctxA, 'nao-e-uuid', db)).toBeNull();
    }));

  it('exige contexto (checado pelo typecheck)', () => {
    // @ts-expect-error repositório não pode ser chamado sem TenantContext
    const semContexto = () => listMembers();
    // @ts-expect-error contexto forjado sem a marca do guard é recusado
    const forjado = () => listMembers({ tenantId: 'x' });
    expect([semContexto, forjado]).toHaveLength(2);
  });
});
