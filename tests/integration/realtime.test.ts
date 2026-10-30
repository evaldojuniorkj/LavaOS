import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/eventos/route';
import { getDatabase } from '@/lib/db/client';
import type { Database } from '@/lib/db/types';
import { hub, type Mensagem } from '@/lib/realtime/hub';
import { iniciarListener, pararListener } from '@/lib/realtime/listener';
import { publicar } from '@/lib/realtime/publicar';
import { ajustarValorAction, transitarOsAction } from '@/modules/ordens/ordens.actions';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import { testUrls, withTestDatabase } from '../helpers/db';
import { criarOs, semearVeiculo, sessaoStaff } from '../helpers/ordens';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));

const run = (fn: (c: { db: Database; f: AuthFixtures; osId: string }) => Promise<void>) =>
  withTestDatabase(async (db) => {
    const f = await createAuthFixtures(db);
    const v = await semearVeiculo(db, f.a.tenantId);
    const os = await criarOs(db, { tenantId: f.a.tenantId, veiculoId: v.id, abertaPor: f.a.membros.recepcao.memberId });
    await fn({ db, f, osId: os.id });
  });

/** Espera limitada: falha com mensagem clara em vez de pendurar o teste. */
async function ate<T>(p: Promise<T>, msg: string, ms = 3000): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(msg)), ms)))]);
  } finally {
    clearTimeout(t);
  }
}

/** pid da conexão LISTEN do listener, quando já executou o LISTEN (barreira via pg_stat_activity). */
async function pidListener(db: Database, exceto?: number): Promise<number> {
  for (let i = 0; ; i++) {
    const { rows } = await db.execute(sql`select pid from pg_stat_activity where datname = current_database() and state = 'idle' and query = 'LISTEN lavaos_eventos'`);
    const pid = rows.map((r) => r.pid as number).find((p) => p !== exceto);
    if (pid) return pid;
    if (i > 200) throw new Error('listener não chegou ao LISTEN');
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Próxima mensagem do hub que satisfaz `ok` (o primeiro evento recebido do tenant/OS). */
function proxima(filtro: { tenantId: string }, ok: (m: Mensagem) => boolean = () => true): Promise<Mensagem> {
  return new Promise((resolve) => {
    const cancelar = hub.assinar(filtro, (m) => {
      if (!ok(m)) return;
      cancelar();
      resolve(m);
    });
  });
}

/** Lê os frames SSE de uma resposta. */
function leitorSse(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  return async function frame(): Promise<string> {
    for (;;) {
      const fim = buf.indexOf('\n\n');
      if (fim >= 0) {
        const f = buf.slice(0, fim);
        buf = buf.slice(fim + 2);
        return f;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error('stream SSE terminou');
      buf += dec.decode(value, { stream: true });
    }
  };
}

const abrirSse = (headers: Headers, signal?: AbortSignal) => GET(new Request('http://localhost:3000/api/eventos', { headers, signal }));

afterAll(async () => {
  await pararListener();
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('tempo real', () => {
  it('transitarOs publica evento recebido pelo listener', () =>
    run(async ({ db, f, osId }) => {
      iniciarListener();
      await pidListener(db);
      req.headers = await sessaoStaff(f, f.a.membros.gerente.userId);
      const recebido = proxima({ tenantId: f.a.tenantId }, (m) => m.tipo === 'status');
      const r = await transitarOsAction({ osId, esperado: 'aguardando', para: 'em_lavagem', responsavelId: f.a.membros.lavador.memberId });
      expect(r.ok).toBe(true);
      expect(await ate(recebido, 'evento de status não chegou ao hub')).toEqual({ tenantId: f.a.tenantId, osId, tipo: 'status' });
    }));

  it('evento não contém chaves com Centavos', () =>
    run(async ({ f, osId }) => {
      // conexão própria: confere o payload cru do NOTIFY, antes de qualquer parse do listener
      const raw = new Client({ connectionString: testUrls.app });
      await raw.connect();
      try {
        const payloads: string[] = [];
        const chegou = new Promise<void>((resolve) =>
          raw.on('notification', (n) => {
            payloads.push(n.payload!);
            if (payloads.length === 3) resolve();
          }),
        );
        await raw.query('listen lavaos_eventos'); // minúsculo: não se confunde com o listener em pidListener
        req.headers = await sessaoStaff(f, f.a.membros.gerente.userId);
        expect((await ajustarValorAction({ osId, descontoCentavos: 1000, acrescimoCentavos: 0 })).ok).toBe(true);
        expect((await transitarOsAction({ osId, esperado: 'aguardando', para: 'em_lavagem', responsavelId: f.a.membros.lavador.memberId })).ok).toBe(true);
        await ate(chegou, 'NOTIFY não chegou');
        for (const p of payloads) {
          expect(Object.keys(JSON.parse(p)).sort()).toEqual(['osId', 'tenantId', 'tipo']);
          expect(p).not.toMatch(/centavos|4000|5000|token|telefone|nome/i);
        }
        expect(payloads.map((p) => JSON.parse(p).tipo).sort()).toEqual(['responsavel', 'status', 'valor']);
      } finally {
        await raw.end();
      }
    }));

  it('rollback da transação não publica', () =>
    run(async ({ db, f, osId }) => {
      iniciarListener();
      await pidListener(db);
      const primeiro = proxima({ tenantId: f.a.tenantId });
      await expect(
        db.transaction(async (tx) => {
          await publicar(tx, { tenantId: f.a.tenantId, osId, tipo: 'valor' });
          throw new Error('desfaz');
        }),
      ).rejects.toThrow('desfaz');
      // NOTIFY chega em ordem de commit: se o desfeito vazasse, chegaria antes deste
      await db.transaction((tx) => publicar(tx, { tenantId: f.a.tenantId, osId, tipo: 'itens' }));
      expect(await ate(primeiro, 'evento confirmado não chegou')).toEqual({ tenantId: f.a.tenantId, osId, tipo: 'itens' });
    }));

  it('SSE de tenant A não recebe evento do tenant B', () =>
    run(async ({ db, f, osId }) => {
      const ac = new AbortController();
      const res = await abrirSse(await sessaoStaff(f, f.a.membros.gerente.userId), ac.signal);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');
      expect(res.headers.get('cache-control')).toBe('no-store, no-transform');
      expect(res.headers.get('x-accel-buffering')).toBe('no');
      const frame = leitorSse(res);
      expect(await ate(frame(), 'sem ready')).toBe('event: ready\ndata: {}');
      await pidListener(db);
      await db.transaction((tx) => publicar(tx, { tenantId: f.b.tenantId, osId: crypto.randomUUID(), tipo: 'status' }));
      await db.transaction((tx) => publicar(tx, { tenantId: f.a.tenantId, osId, tipo: 'valor' }));
      expect(await ate(frame(), 'evento do tenant A não chegou ao SSE')).toBe(`data: ${JSON.stringify({ tenantId: f.a.tenantId, osId, tipo: 'valor' })}`);
      ac.abort();
      await expect(frame()).rejects.toThrow('stream SSE terminou');
    }));

  it('sem sessão a rota responde acesso negado', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await abrirSse(new Headers());
    warn.mockRestore();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' });
  });

  it('após derrubar a conexão LISTEN o hub emite resync', () =>
    run(async ({ db, f }) => {
      iniciarListener();
      const pid = await pidListener(db);
      const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const resync = proxima({ tenantId: f.a.tenantId }, (m) => m.tipo === 'resync');
        await db.execute(sql`select pg_terminate_backend(${pid})`);
        expect(await ate(resync, 'listener não reconectou/emitiu resync')).toEqual({ tipo: 'resync' });
        await pidListener(db, pid); // nova conexão escutando
      } finally {
        erro.mockRestore();
      }
    }));
});
