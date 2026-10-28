import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '@/lib/db/client';
import { assertTestDb, testUrls } from '../helpers/db';

describe('guarda do banco de testes', () => {
  it('aceita só lavaos_test em host local, sem query', () => {
    expect(() => assertTestDb(testUrls.owner)).not.toThrow();
    expect(() => assertTestDb('postgres://a:b@postgres:5432/lavaos_test')).not.toThrow();
  });

  it.each([
    'postgres://a:b@127.0.0.1:55432/lavaos_test?host=remoto.exemplo.com',
    'postgres://a:b@127.0.0.1:55432/lavaos_test?sslmode=disable',
    'postgres://a:b@db.exemplo.com/lavaos_test',
    'postgres://a:b@127.0.0.1:55432/lavaos_dev',
  ])('recusa %s', (url) => {
    expect(() => assertTestDb(url)).toThrow(/Recusado/);
  });
});

describe('pool', () => {
  it('erro em conexão ociosa não derruba o processo', async () => {
    const { db, close } = createDatabase(testUrls.app);
    try {
      const pool = (db as unknown as { $client: Pool }).$client;
      expect(() => pool.emit('error', new Error('conexão perdida'))).not.toThrow();
    } finally {
      await close();
    }
  });
});
