import { describe, expect, it } from 'vitest';
import type { Perfil } from '@/lib/auth/types';
import { canDeactivateMember, canManageTarget } from '@/modules/equipe/equipe.rules';
import { createMemberSchema, memberIdSchema } from '@/modules/equipe/equipe.schemas';

describe('quem gerencia quem', () => {
  it.each<[Perfil, Perfil, boolean]>([
    ['dono', 'dono', true],
    ['dono', 'gerente', true],
    ['dono', 'recepcao', true],
    ['dono', 'lavador', true],
    ['gerente', 'dono', false],
    ['gerente', 'gerente', false],
    ['gerente', 'recepcao', true],
    ['gerente', 'lavador', true],
    ['recepcao', 'dono', false],
    ['recepcao', 'gerente', false],
    ['recepcao', 'recepcao', false],
    ['recepcao', 'lavador', false],
    ['lavador', 'dono', false],
    ['lavador', 'gerente', false],
    ['lavador', 'recepcao', false],
    ['lavador', 'lavador', false],
  ])('%s -> %s = %s', (ator, alvo, esperado) => expect(canManageTarget(ator, alvo)).toBe(esperado));

  it('não desativa o último dono ativo', () => {
    expect(canDeactivateMember('dono', 'dono', 1)).toBe(false);
    expect(canDeactivateMember('dono', 'dono', 2)).toBe(true);
    expect(canDeactivateMember('dono', 'gerente', 1)).toBe(true);
  });

  it('gerente não desativa liderança', () => {
    expect(canDeactivateMember('gerente', 'dono', 3)).toBe(false);
    expect(canDeactivateMember('gerente', 'lavador', 1)).toBe(true);
  });
});

describe('schemas strict', () => {
  const staff = { perfil: 'recepcao', nomeExibicao: 'Ana', email: 'ana@x.com', senha: 'senha-forte' };
  const lavador = { perfil: 'lavador', nomeExibicao: 'Zé', usuario: 'ze.lavador', pin: '1234' };

  it('aceita staff e lavador válidos', () => {
    expect(createMemberSchema.safeParse(staff).success).toBe(true);
    expect(createMemberSchema.safeParse(lavador).success).toBe(true);
  });

  it.each([
    ['tenant_id extra', { ...staff, tenant_id: crypto.randomUUID() }],
    ['tenantId extra', { ...lavador, tenantId: crypto.randomUUID() }],
    ['campo de lavador em staff', { ...staff, pin: '1234' }],
    ['perfil desconhecido', { ...staff, perfil: 'admin' }],
    ['PIN inválido', { ...lavador, pin: '12' }],
    ['senha curta', { ...staff, senha: '123' }],
  ])('recusa %s', (_n, input) => expect(createMemberSchema.safeParse(input).success).toBe(false));

  it('memberId exige uuid e recusa extras', () => {
    expect(memberIdSchema.safeParse({ memberId: crypto.randomUUID() }).success).toBe(true);
    expect(memberIdSchema.safeParse({ memberId: 'x' }).success).toBe(false);
    expect(memberIdSchema.safeParse({ memberId: crypto.randomUUID(), perfil: 'dono' }).success).toBe(false);
  });
});
