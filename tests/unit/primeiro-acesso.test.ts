import { describe, expect, it } from 'vitest';
import { codigoConfere } from '@/modules/lava-jato/primeiro-acesso.rules';
import { formPrimeiroAcessoSchema } from '@/modules/lava-jato/primeiro-acesso.schemas';

const TOKEN = 'codigo-de-instalacao-0001';
const valido = {
  nomeLavaJato: ' Lava Rápido ',
  telefone: '(11) 98888-7777',
  donoNome: 'Ana',
  donoEmail: 'Ana@Exemplo.com',
  donoSenha: 'senha-forte-1',
  confirmacaoSenha: 'senha-forte-1',
  codigo: TOKEN,
};

describe('codigoConfere', () => {
  it('só o código exato confere, inclusive com tamanhos diferentes', () => {
    expect(codigoConfere(TOKEN, TOKEN)).toBe(true);
    for (const errado of ['', 'codigo', `${TOKEN} `, TOKEN.toUpperCase(), `${TOKEN}x`, TOKEN.slice(0, -1)]) {
      expect(codigoConfere(errado, TOKEN), errado).toBe(false);
    }
  });
});

describe('formPrimeiroAcessoSchema', () => {
  it('normaliza nome, e-mail e telefone', () => {
    expect(formPrimeiroAcessoSchema.parse(valido)).toMatchObject({ nomeLavaJato: 'Lava Rápido', donoEmail: 'ana@exemplo.com', telefone: '+5511988887777' });
    expect(formPrimeiroAcessoSchema.parse({ ...valido, telefone: '' }).telefone).toBeNull();
  });

  it('recusa senha curta, confirmação diferente, telefone e e-mail inválidos', () => {
    const erros = (d: object) => Object.keys(formPrimeiroAcessoSchema.safeParse({ ...valido, ...d }).error?.flatten().fieldErrors ?? {});
    expect(erros({ donoSenha: '1234567', confirmacaoSenha: '1234567' })).toEqual(['donoSenha']);
    expect(erros({ confirmacaoSenha: 'outra-senha-1' })).toEqual(['confirmacaoSenha']);
    expect(erros({ telefone: '123' })).toEqual(['telefone']);
    expect(erros({ donoEmail: 'nao-e-email' })).toEqual(['donoEmail']);
  });

  it('strict: tenantId, slug ou perfil no payload são recusados', () => {
    for (const extra of [{ tenantId: crypto.randomUUID() }, { slug: 'outro' }, { perfil: 'dono' }]) {
      expect(formPrimeiroAcessoSchema.safeParse({ ...valido, ...extra }).success, Object.keys(extra)[0]).toBe(false);
    }
  });
});
