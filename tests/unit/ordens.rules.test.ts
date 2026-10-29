import { describe, expect, it } from 'vitest';
import type { Perfil } from '@/lib/auth/types';
import { calcularTotais, decidirTransicao, sugerirLavadorLivre, validarSelecaoServicos, type StatusOs } from '@/modules/ordens/ordens.rules';

const base = { temResponsavel: true, ehResponsavel: false };
const t = (de: StatusOs, para: StatusOs, perfil: Perfil, extra: Partial<Parameters<typeof decidirTransicao>[0]> = {}) =>
  decidirTransicao({ de, para, perfil, ...base, ...extra });

describe('calcularTotais', () => {
  it('soma itens, subtrai desconto e soma acréscimo', () => {
    expect(calcularTotais({ valoresItens: [5000, 2500], descontoCentavos: 500, acrescimoCentavos: 100 })).toEqual({ subtotalCentavos: 7500, totalCentavos: 7100 });
  });
  it('total nunca fica negativo', () => {
    expect(calcularTotais({ valoresItens: [1000], descontoCentavos: 5000, acrescimoCentavos: 0 }).totalCentavos).toBe(0);
  });
});

describe('decidirTransicao', () => {
  it('aguardando→em_lavagem: lavador assume (os:assumir) sem responsável', () => {
    expect(t('aguardando', 'em_lavagem', 'lavador', { temResponsavel: false })).toEqual({ ok: true, permissao: 'os:assumir', limpaResponsavel: false });
  });
  it('aguardando→em_lavagem: lavador sendo o responsável inicia', () => {
    expect(t('aguardando', 'em_lavagem', 'lavador', { ehResponsavel: true }).ok).toBe(true);
  });
  it('aguardando→em_lavagem: lavador não inicia OS de outro', () => {
    expect(t('aguardando', 'em_lavagem', 'lavador')).toEqual({ ok: false, erro: 'nao_e_responsavel' });
  });
  it('aguardando→em_lavagem: recepção usa os:atribuir (balcão)', () => {
    expect(t('aguardando', 'em_lavagem', 'recepcao')).toEqual({ ok: true, permissao: 'os:atribuir', limpaResponsavel: false });
  });
  it('em_lavagem→pronto: responsável avança (os:avancar)', () => {
    expect(t('em_lavagem', 'pronto', 'lavador', { ehResponsavel: true })).toEqual({ ok: true, permissao: 'os:avancar', limpaResponsavel: false });
  });
  it('em_lavagem→pronto: lavador que não é o responsável falha', () => {
    expect(t('em_lavagem', 'pronto', 'lavador')).toEqual({ ok: false, erro: 'nao_e_responsavel' });
  });
  it('pronto sem responsável falha', () => {
    expect(t('em_lavagem', 'pronto', 'gerente', { temResponsavel: false })).toEqual({ ok: false, erro: 'sem_responsavel' });
  });
  it('pronto→em_lavagem: recepção corrige (os:corrigir)', () => {
    expect(t('pronto', 'em_lavagem', 'recepcao')).toEqual({ ok: true, permissao: 'os:corrigir', limpaResponsavel: false });
  });
  it('em_lavagem→aguardando: os:corrigir e limpa o responsável', () => {
    expect(t('em_lavagem', 'aguardando', 'gerente')).toEqual({ ok: true, permissao: 'os:corrigir', limpaResponsavel: true });
  });
  it('corrigir não é do lavador', () => {
    expect(t('pronto', 'em_lavagem', 'lavador', { ehResponsavel: true })).toEqual({ ok: false, erro: 'sem_permissao' });
  });
  it('pronto→entregue: recepção entrega (os:entregar)', () => {
    expect(t('pronto', 'entregue', 'recepcao')).toEqual({ ok: true, permissao: 'os:entregar', limpaResponsavel: false });
  });
  it('lavador não entrega', () => {
    expect(t('pronto', 'entregue', 'lavador', { ehResponsavel: true })).toEqual({ ok: false, erro: 'sem_permissao' });
  });
  it('entregar sem responsável falha', () => {
    expect(t('pronto', 'entregue', 'dono', { temResponsavel: false })).toEqual({ ok: false, erro: 'sem_responsavel' });
  });
  it.each(['aguardando', 'em_lavagem', 'pronto'] as const)('%s→cancelada com motivo (os:cancelar)', (de) => {
    expect(t(de, 'cancelada', 'recepcao', { motivo: 'cliente desistiu' })).toEqual({ ok: true, permissao: 'os:cancelar', limpaResponsavel: false });
  });
  it('cancelar sem motivo falha', () => {
    expect(t('aguardando', 'cancelada', 'dono')).toEqual({ ok: false, erro: 'motivo_obrigatorio' });
    expect(t('aguardando', 'cancelada', 'dono', { motivo: '   ' })).toEqual({ ok: false, erro: 'motivo_obrigatorio' });
  });
  it('lavador não cancela', () => {
    expect(t('aguardando', 'cancelada', 'lavador', { motivo: 'x' })).toEqual({ ok: false, erro: 'sem_permissao' });
  });
  it('entregue→pronto é transicao_invalida na Fase 1', () => {
    expect(t('entregue', 'pronto', 'dono')).toEqual({ ok: false, erro: 'transicao_invalida' });
  });
  it('nada sai de cancelada', () => {
    expect(t('cancelada', 'aguardando', 'dono')).toEqual({ ok: false, erro: 'transicao_invalida' });
  });
});

describe('validarSelecaoServicos', () => {
  it('aceita ao menos um principal', () => {
    expect(validarSelecaoServicos([{ id: 'a', adicional: true }, { id: 'b', adicional: false }])).toEqual({ ok: true });
  });
  it('recusa lista só de adicionais e lista vazia', () => {
    expect(validarSelecaoServicos([{ id: 'a', adicional: true }])).toEqual({ ok: false, erro: 'sem_servico_principal' });
    expect(validarSelecaoServicos([])).toEqual({ ok: false, erro: 'sem_servico_principal' });
  });
});

describe('sugerirLavadorLivre', () => {
  it('escolhe o livre há mais tempo, ignora quem tem OS em lavagem e retorna null sem livres', () => {
    const l = (membroId: string, emLavagem: number, dia: number) => ({ membroId, emLavagem, livreDesde: new Date(2026, 0, dia) });
    expect(sugerirLavadorLivre([l('a', 0, 5), l('b', 0, 2), l('c', 1, 1)])).toBe('b');
    expect(sugerirLavadorLivre([l('z', 0, 2), l('m', 0, 2)])).toBe('m');
    expect(sugerirLavadorLivre([l('a', 2, 1)])).toBeNull();
    expect(sugerirLavadorLivre([])).toBeNull();
  });
});
