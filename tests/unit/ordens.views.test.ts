import { describe, expect, it } from 'vitest';
import { toOsView, type OsCompleta } from '@/modules/ordens/ordens.views';

const os: OsCompleta = {
  id: 'os-1',
  numero: 7,
  status: 'aguardando',
  observacoes: 'risco na porta',
  subtotalCentavos: 6500,
  descontoCentavos: 0,
  acrescimoCentavos: 0,
  totalCentavos: 6500,
  tokenPublico: 'tok',
  veiculo: { placa: 'ABC1D23', modelo: 'Gol', cor: 'Prata' },
  cliente: { nome: 'Ana', telefone: '+5511988887777' },
  itens: [
    { id: 'i1', nome: 'Lavagem', valorCentavos: 5000 },
    { id: 'i2', nome: 'Cera', valorCentavos: 1500 },
  ],
  responsavel: { id: 'm1', nomeExibicao: 'Zé' },
  entradaEm: new Date(),
  atribuidoEm: new Date(),
  inicioLavagemEm: null,
  prontoEm: null,
  entregueEm: null,
  canceladaEm: null,
};

const chaves = (v: unknown): string[] =>
  v && typeof v === 'object' && !(v instanceof Date) ? Object.entries(v).flatMap(([k, x]) => [k, ...chaves(x)]) : [];

describe('toOsView', () => {
  it('lavador: nenhuma chave com Centavos/comissão, nem token ou telefone (varredura recursiva)', () => {
    const v = toOsView('lavador', os);
    const ks = chaves(v);
    expect(ks.filter((k) => /centavos|comissao|valor|total|token|telefone/i.test(k))).toEqual([]);
    expect(v).toMatchObject({ numero: 7, cliente: { nome: 'Ana' }, itens: [{ nome: 'Lavagem' }, { nome: 'Cera' }], responsavel: { id: 'm1', nomeExibicao: 'Zé' } });
  });

  it.each(['dono', 'gerente', 'recepcao'] as const)('%s recebe a visão de gestão com valores, telefone e token', (perfil) => {
    expect(toOsView(perfil, os)).toMatchObject({
      subtotalCentavos: 6500,
      totalCentavos: 6500,
      tokenPublico: 'tok',
      cliente: { nome: 'Ana', telefone: '+5511988887777' },
      itens: [{ nome: 'Lavagem', valorCentavos: 5000 }, { nome: 'Cera', valorCentavos: 1500 }],
    });
  });
});
