import { describe, expect, it } from 'vitest';
import { parseServerEnv } from '@/lib/env';

const valid = {
  DATABASE_URL: 'postgres://app:pw@localhost:5432/lavaos',
  MIGRATION_DATABASE_URL: 'postgres://owner:pw@localhost:5432/lavaos',
  TEST_DATABASE_URL: 'postgres://app:pw@localhost:5432/lavaos_test',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:3000',
  LAVAOS_PILOT_SLUG: 'piloto',
  LAVAOS_MODE: 'development',
};

describe('parseServerEnv', () => {
  it('recusa ambiente sem banco ou secret', () => {
    expect(() => parseServerEnv({})).toThrow();
  });

  it('aceita ambiente válido e devolve só as variáveis validadas', () => {
    expect(parseServerEnv({ ...valid, OUTRA: 'ignorada' })).toEqual(valid);
  });

  it('recusa secret curto', () => {
    expect(() => parseServerEnv({ ...valid, BETTER_AUTH_SECRET: 'curto' })).toThrow();
  });

  it('recusa banco de testes sem nome lavaos_test ou com host remoto', () => {
    expect(() => parseServerEnv({ ...valid, TEST_DATABASE_URL: 'postgres://a:b@localhost/lavaos' })).toThrow();
    expect(() => parseServerEnv({ ...valid, TEST_DATABASE_URL: 'postgres://a:b@db.exemplo.com/lavaos_test' })).toThrow();
  });

  it('recusa banco principal como destino de testes em development ou production', () => {
    const mesmo = { ...valid, DATABASE_URL: valid.TEST_DATABASE_URL };
    expect(() => parseServerEnv(mesmo)).toThrow();
    expect(() => parseServerEnv({ ...mesmo, LAVAOS_MODE: 'production' })).toThrow();
  });

  it('em modo test o runtime pode usar o banco de testes', () => {
    const env = parseServerEnv({ ...valid, DATABASE_URL: valid.TEST_DATABASE_URL, LAVAOS_MODE: 'test' });
    expect(env.DATABASE_URL).toBe(valid.TEST_DATABASE_URL);
  });

  it('código de instalação é opcional, mas quando definido tem ao menos 16 caracteres', () => {
    expect(parseServerEnv(valid).LAVAOS_SETUP_TOKEN).toBeUndefined();
    expect(parseServerEnv({ ...valid, LAVAOS_SETUP_TOKEN: '' }).LAVAOS_SETUP_TOKEN).toBeUndefined();
    expect(parseServerEnv({ ...valid, LAVAOS_SETUP_TOKEN: 'x'.repeat(16) }).LAVAOS_SETUP_TOKEN).toBe('x'.repeat(16));
    expect(() => parseServerEnv({ ...valid, LAVAOS_SETUP_TOKEN: 'curto' })).toThrow();
  });
});
