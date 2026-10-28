import { describe, expect, it } from 'vitest';
import { assertPermission, can } from '@/lib/auth/permissions';
import { PERMISSOES } from '@/lib/auth/types';
import type { Perfil, Permissao, TenantContext } from '@/lib/auth/types';

// Tabela independente da implementação: spec §3, colunas dono, gerente, recepcao, lavador.
const MATRIZ: [Permissao, boolean, boolean, boolean, boolean][] = [
  ['fila:ver', true, true, true, true],
  ['os:abrir', true, true, true, true],
  ['os:assumir', true, true, false, true],
  ['os:atribuir', true, true, true, false],
  ['os:avancar', true, true, true, true],
  ['os:corrigir', true, true, true, false],
  ['os:entregar', true, true, true, false],
  ['os:cancelar', true, true, true, false],
  ['os:reabrir', true, true, false, false],
  ['os:ajustar_valor', true, true, false, false],
  ['clientes:gerenciar', true, true, true, false],
  ['agenda:gerenciar', true, true, true, false],
  ['caixa:operar', true, true, true, false],
  ['caixa:reabrir', true, true, false, false],
  ['caixa:estornar', true, true, false, false],
  ['despesas:gerenciar', true, true, false, false],
  ['relatorios:ver', true, true, false, false],
  ['comissoes:gerenciar', true, true, false, false],
  ['fidelidade:consultar', true, true, true, false],
  ['fidelidade:resgatar', true, true, true, false],
  ['fidelidade:configurar', true, true, false, false],
  ['catalogo:gerenciar', true, true, false, false],
  ['equipe:gerenciar', true, true, false, false],
  ['equipe:gerenciar_lideranca', true, false, false, false],
];
const PERFIS_ORDEM: Perfil[] = ['dono', 'gerente', 'recepcao', 'lavador'];
const celulas = MATRIZ.flatMap(([p, ...vals]) => PERFIS_ORDEM.map((perfil, i) => [perfil, p, vals[i]] as const));

const ctx = (perfil: Perfil) => ({ perfil }) as TenantContext;

describe('matriz de permissões', () => {
  it('a tabela cobre exatamente as permissões da implementação (24)', () => {
    expect(new Set(MATRIZ.map(([p]) => p))).toEqual(new Set(PERMISSOES));
    expect(MATRIZ).toHaveLength(PERMISSOES.length);
    expect(PERMISSOES).toHaveLength(24);
  });

  it.each(celulas)('%s x %s = %s', (perfil, permissao, esperado) => {
    expect(can(perfil, permissao)).toBe(esperado);
  });

  it('nega por padrão entrada desconhecida', () => {
    expect(can('dono', 'painel:ver' as Permissao)).toBe(false);
    expect(can('admin' as Perfil, 'fila:ver')).toBe(false);
    expect(can('dono', 'toString' as Permissao)).toBe(false);
  });
});

describe('assertPermission', () => {
  it('aceita equipe implantada para o perfil certo', () => {
    expect(() => assertPermission(ctx('gerente'), 'equipe:gerenciar')).not.toThrow();
    expect(() => assertPermission(ctx('dono'), 'equipe:gerenciar_lideranca')).not.toThrow();
  });

  it('recusa perfil sem a permissão com "acesso negado"', () => {
    expect(() => assertPermission(ctx('gerente'), 'equipe:gerenciar_lideranca')).toThrow('acesso negado');
    expect(() => assertPermission(ctx('lavador'), 'equipe:gerenciar')).toThrow('acesso negado');
  });

  it('recusa operação não implantada mesmo para o dono', () => {
    expect(() => assertPermission(ctx('dono'), 'caixa:operar')).toThrow('acesso negado');
  });
});
