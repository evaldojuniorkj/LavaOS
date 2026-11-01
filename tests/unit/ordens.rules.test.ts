import { describe, expect, it } from 'vitest';
import type { Perfil } from '@/lib/auth/types';
import { calcularTotais, decidirTransicao, sugerirLavadorLivre, validarSelecaoServicos, type StatusOs } from '@/modules/ordens/ordens.rules';

const base = { temResponsavel: true, ehResponsavel: false, responsavelExplicito: false };
const t = (de: StatusOs, para: StatusOs, perfil: Perfil, extra: Partial<Parameters<typeof decidirTransicao>[0]> = {}) =>
  decidirTransicao({ de, para, perfil, ...base, ...extra });

describe('calcularTotais', () => {
  it('soma itens, subtrai desconto e soma acréscimo', () => {
    expect(calcularTotais({ valoresItens: [5000, 2500], descontoCentavos: 500, acrescimoCentavos: 100 })).toEqual({ subtotalCentavos: 7500, totalCentavos: 7100 });
  });
  it.each([NaN, -1, 10.5, Infinity])('rejeita valor inválido %s', (v) => {
    expect(() => calcularTotais({ valoresItens: [v], descontoCentavos: 0, acrescimoCentavos: 0 })).toThrow(RangeError);
    expect(() => calcularTotais({ valoresItens: [100], descontoCentavos: v, acrescimoCentavos: 0 })).toThrow(RangeError);
    expect(() => calcularTotais({ valoresItens: [100], descontoCentavos: 0, acrescimoCentavos: v })).toThrow(RangeError);
  });
  it('aceita lista vazia e zeros', () => {
    expect(calcularTotais({ valoresItens: [], descontoCentavos: 0, acrescimoCentavos: 0 })).toEqual({ subtotalCentavos: 0, totalCentavos: 0 });
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
  it('Pegar: dono e gerente usam os:assumir para si', () => {
    for (const perfil of ['dono', 'gerente'] as const)
      expect(t('aguardando', 'em_lavagem', perfil, { temResponsavel: false })).toEqual({ ok: true, permissao: 'os:assumir', limpaResponsavel: false });
  });
  it('Pegar: recepção não tem os:assumir', () => {
    expect(t('aguardando', 'em_lavagem', 'recepcao', { temResponsavel: false })).toEqual({ ok: false, erro: 'sem_permissao' });
  });
  it('Pegar OS de outro responsável falha mesmo para gestão', () => {
    expect(t('aguardando', 'em_lavagem', 'dono')).toEqual({ ok: false, erro: 'nao_e_responsavel' });
  });
  it('balcão com responsável: dono, gerente e recepção usam os:atribuir', () => {
    for (const perfil of ['dono', 'gerente', 'recepcao'] as const)
      expect(t('aguardando', 'em_lavagem', perfil, { responsavelExplicito: true })).toEqual({ ok: true, permissao: 'os:atribuir', limpaResponsavel: false });
  });
  it('balcão sem responsável falha', () => {
    expect(t('aguardando', 'em_lavagem', 'recepcao', { responsavelExplicito: true, temResponsavel: false })).toEqual({ ok: false, erro: 'sem_responsavel' });
  });
  it('lavador não inicia pelo balcão', () => {
    expect(t('aguardando', 'em_lavagem', 'lavador', { responsavelExplicito: true })).toEqual({ ok: false, erro: 'sem_permissao' });
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
  it('varre todos os pares de status: só os da tabela passam', () => {
    const todos: StatusOs[] = ['aguardando', 'em_lavagem', 'pronto', 'entregue', 'cancelada'];
    const permitidos = new Set(['aguardando>em_lavagem', 'em_lavagem>pronto', 'pronto>em_lavagem', 'em_lavagem>aguardando', 'pronto>entregue', 'aguardando>cancelada', 'em_lavagem>cancelada', 'pronto>cancelada', 'entregue>pronto']);
    for (const de of todos)
      for (const para of todos) {
        const r = t(de, para, 'dono', { ehResponsavel: true, motivo: 'm' });
        expect(r.ok, `${de}>${para}`).toBe(permitidos.has(`${de}>${para}`));
        if (!r.ok) expect(r.erro).toBe('transicao_invalida');
      }
  });
  it('status herdado do protótipo é transicao_invalida', () => {
    expect(t('constructor' as StatusOs, 'pronto', 'dono')).toEqual({ ok: false, erro: 'transicao_invalida' });
    expect(t('aguardando', 'toString' as StatusOs, 'dono')).toEqual({ ok: false, erro: 'transicao_invalida' });
  });
  it('Reabrir entregue→pronto: dono e gerente com motivo (os:reabrir); recepção e lavador não', () => {
    for (const perfil of ['dono', 'gerente'] as const)
      expect(t('entregue', 'pronto', perfil, { motivo: 'cobrou errado' })).toEqual({ ok: true, permissao: 'os:reabrir', limpaResponsavel: false });
    expect(t('entregue', 'pronto', 'dono')).toEqual({ ok: false, erro: 'motivo_obrigatorio' });
    for (const perfil of ['recepcao', 'lavador'] as const) expect(t('entregue', 'pronto', perfil, { motivo: 'x' })).toEqual({ ok: false, erro: 'sem_permissao' });
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
    expect(sugerirLavadorLivre([{ membroId: 'x', emLavagem: 0, livreDesde: new Date(NaN) }, l('y', 0, 9)])).toBe('y');
    expect(sugerirLavadorLivre([{ membroId: 'x', emLavagem: 0, livreDesde: new Date(NaN) }])).toBeNull();
    expect(sugerirLavadorLivre([])).toBeNull();
  });
});
