import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/acompanhar/[token]/eventos/route';
import { getDatabase } from '@/lib/db/client';
import { clientes, ordensServico, osItens, servicos, veiculos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { hub } from '@/lib/realtime/hub';
import { pararListener } from '@/lib/realtime/listener';
import { buscarOsPublica, localizarOsPublica } from '@/modules/ordens/publico.repo';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { criarMembro, criarOs, semearVeiculo } from '../helpers/ordens';

const DIA = 24 * 60 * 60 * 1000;
const AGORA = new Date('2026-10-20T15:00:00Z');
const MEMBRO = 'Zé Lavador Secreto';
const TELEFONE = '+5511977776666';

/** OS de A com cliente, responsável, observação e item: tudo que NÃO pode vazar está preenchido. */
async function semear(db: Database, f: AuthFixtures, tenantId = f.a.tenantId, abertaPor = f.a.membros.recepcao.memberId) {
  const v = await semearVeiculo(db, tenantId);
  const [cli] = await db.insert(clientes).values({ tenantId, nome: 'Cliente Sigiloso', telefone: TELEFONE }).returning();
  await db.update(veiculos).set({ modelo: 'Gol', clienteId: cli.id }).where(eq(veiculos.id, v.id));
  const lavador = await criarMembro(db, tenantId, MEMBRO);
  const os = await criarOs(db, { tenantId, veiculoId: v.id, abertaPor, status: 'em_lavagem', responsavelId: lavador.id });
  await db
    .update(ordensServico)
    .set({ clienteId: cli.id, observacoes: 'risco no capô', descontoCentavos: 1000, subtotalCentavos: 7000, totalCentavos: 6000, entradaEm: new Date(AGORA.getTime() - 3600_000), inicioLavagemEm: AGORA })
    .where(eq(ordensServico.id, os.id));
  const [s] = await db.select().from(servicos).where(eq(servicos.tenantId, tenantId));
  const item = { tenantId, osId: os.id, servicoId: s.id, porteId: v.porteId, comissaoTipo: 'percentual' as const, comissaoValor: 3000 };
  await db.insert(osItens).values({ ...item, nomeServico: 'Lavagem', valorCentavos: 5000 });
  await db.insert(osItens).values({ ...item, nomeServico: 'Cera', valorCentavos: 2000 }); // outro statement: created_at posterior
  return os;
}

const run = (fn: (c: { db: Database; f: AuthFixtures; os: Awaited<ReturnType<typeof semear>> }) => Promise<void>) =>
  withTestDatabase(async (db) => {
    const f = await createAuthFixtures(db);
    await fn({ db, f, os: await semear(db, f) });
  });

/** Caminhos de todas as chaves, recursivo (itens de array viram `[]`). */
const caminhos = (v: unknown, p = ''): string[] =>
  Array.isArray(v)
    ? v.flatMap((x) => caminhos(x, `${p}[]`))
    : v && typeof v === 'object' && !(v instanceof Date)
      ? Object.entries(v).flatMap(([k, x]) => [`${p}${p ? '.' : ''}${k}`, ...caminhos(x, `${p}${p ? '.' : ''}${k}`)])
      : [];

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('buscarOsPublica', () => {
  it('token válido mostra veículo, status e total — exatamente os campos permitidos', () =>
    run(async ({ os }) => {
      const p = await buscarOsPublica(os.tokenPublico, AGORA);
      expect(p).toEqual({
        lavaJato: { nome: 'Lava Jato tenant-a' },
        veiculo: { modelo: 'Gol', placa: 'ABC1D23' },
        status: 'em_lavagem',
        linhaDoTempo: { entradaEm: new Date(AGORA.getTime() - 3600_000), inicioLavagemEm: AGORA, prontoEm: null, entregueEm: null, canceladaEm: null },
        itens: [
          { nome: 'Lavagem', valorCentavos: 5000 },
          { nome: 'Cera', valorCentavos: 2000 },
        ],
        totalCentavos: 6000,
      });
      expect(new Set(caminhos(p))).toEqual(
        new Set([
          'lavaJato', 'lavaJato.nome', 'veiculo', 'veiculo.modelo', 'veiculo.placa', 'status', 'linhaDoTempo',
          'linhaDoTempo.entradaEm', 'linhaDoTempo.inicioLavagemEm', 'linhaDoTempo.prontoEm', 'linhaDoTempo.entregueEm', 'linhaDoTempo.canceladaEm',
          'itens', 'itens[].nome', 'itens[].valorCentavos', 'totalCentavos',
        ]),
      );
    }));

  it('não contém nome de membro nem telefone (nem cliente, observação, ids ou token)', () =>
    run(async ({ os }) => {
      const json = JSON.stringify(await buscarOsPublica(os.tokenPublico, AGORA));
      for (const proibido of [MEMBRO, TELEFONE, '977776666', 'Cliente Sigiloso', 'risco no capô', os.id, os.tenantId, os.veiculoId, os.tokenPublico, 'comissao', 'desconto', '1000'])
        expect(json).not.toContain(proibido);
    }));

  it('token aleatório, truncado, malformado e inexistente produzem exatamente a mesma resposta (null)', () =>
    run(async ({ os }) => {
      const casos = [
        randomBytes(32).toString('base64url'),
        os.tokenPublico.slice(0, -1),
        `${os.tokenPublico}A`,
        os.tokenPublico.replace(/^./, '+'),
        `${os.tokenPublico.slice(0, -1)}=`,
        '',
        "' or 1=1 --",
        'x'.repeat(10_000),
      ];
      for (const t of casos) {
        expect(await buscarOsPublica(t, AGORA)).toBeNull();
        expect(await localizarOsPublica(t, AGORA)).toBeNull();
      }
    }));

  it('entregue há 6 dias ainda visível, há 8 dias não; exatamente 7 dias ainda visível', () =>
    run(async ({ db, os }) => {
      const entregue = async (ms: number) => {
        await db.update(ordensServico).set({ status: 'entregue', prontoEm: AGORA, entregueEm: new Date(AGORA.getTime() - ms) }).where(eq(ordensServico.id, os.id));
        return buscarOsPublica(os.tokenPublico, AGORA);
      };
      expect((await entregue(6 * DIA))?.status).toBe('entregue');
      expect((await entregue(7 * DIA))?.linhaDoTempo.entregueEm).toEqual(new Date(AGORA.getTime() - 7 * DIA));
      expect(await entregue(7 * DIA + 1)).toBeNull();
      expect(await entregue(8 * DIA)).toBeNull();
      expect(await localizarOsPublica(os.tokenPublico, AGORA)).toBeNull();
    }));

  it('cancelada há 8 dias some; há 6 dias mostra Cancelada sem o motivo', () =>
    run(async ({ db, os }) => {
      const cancelada = async (ms: number) => {
        await db.update(ordensServico).set({ status: 'cancelada', motivoCancelamento: 'cliente desistiu', canceladaEm: new Date(AGORA.getTime() - ms) }).where(eq(ordensServico.id, os.id));
        return buscarOsPublica(os.tokenPublico, AGORA);
      };
      const p = await cancelada(6 * DIA);
      expect(p?.status).toBe('cancelada');
      expect(JSON.stringify(p)).not.toContain('desistiu');
      expect(await cancelada(8 * DIA)).toBeNull();
    }));

  it('token da OS A nunca devolve dados do tenant B; o SSE resolve só a própria OS', () =>
    run(async ({ db, f, os }) => {
      const osB = await semear(db, f, f.b.tenantId, f.b.membros.recepcao.memberId);
      expect((await buscarOsPublica(os.tokenPublico, AGORA))?.lavaJato.nome).toBe('Lava Jato tenant-a');
      expect((await buscarOsPublica(osB.tokenPublico, AGORA))?.lavaJato.nome).toBe('Lava Jato tenant-b');
      expect(await localizarOsPublica(os.tokenPublico, AGORA)).toEqual({ tenantId: f.a.tenantId, osId: os.id });
      expect(await localizarOsPublica(osB.tokenPublico, AGORA)).toEqual({ tenantId: f.b.tenantId, osId: osB.id });
    }));
});

describe('SSE público', () => {
  afterAll(() => pararListener());
  let n = 0;
  /** IP próprio por chamada: cada teste tem a sua cota. */
  const abrir = (token: string, ip = `10.9.0.${++n}`, signal?: AbortSignal) =>
    GET(new Request('http://localhost/api/acompanhar/x/eventos', { headers: { 'x-real-ip': ip }, signal }), { params: Promise.resolve({ token }) });
  const leitor = (r: Response) => {
    const rd = r.body!.getReader();
    return async () => {
      const { value, done } = await rd.read();
      return done ? null : new TextDecoder().decode(value);
    };
  };

  it('token aleatório, truncado, malformado e de OS expirada: a mesma resposta genérica, sem stream', () =>
    run(async ({ db, os }) => {
      await db.update(ordensServico).set({ status: 'entregue', entregueEm: new Date(Date.now() - 8 * DIA) }).where(eq(ordensServico.id, os.id));
      const respostas = await Promise.all([os.tokenPublico, os.tokenPublico.slice(0, -1), randomBytes(32).toString('base64url'), 'abc'].map((t) => abrir(t)));
      const corpos = await Promise.all(respostas.map(async (r) => `${r.status} ${r.headers.get('content-type')} ${await r.text()}`));
      expect(new Set(corpos).size).toBe(1);
      expect(corpos[0]).toBe('404 application/json {"ok":false,"message":"Link indisponível ou expirado"}');
    }));

  it('SSE público só recebe eventos da própria OS, sem ids; abortar libera a assinatura', () =>
    run(async ({ db, f, os }) => {
      const outra = await criarOs(db, { tenantId: f.a.tenantId, veiculoId: os.veiculoId, abertaPor: f.a.membros.recepcao.memberId });
      const antes = hub.contar();
      const ac = new AbortController();
      const r = await abrir(os.tokenPublico, undefined, ac.signal);
      expect(r.headers.get('content-type')).toBe('text/event-stream');
      const ler = leitor(r);
      expect(await ler()).toBe('event: ready\ndata: {}\n\n');
      hub.emitir({ tenantId: f.a.tenantId, osId: outra.id, tipo: 'itens' });
      hub.emitir({ tenantId: f.b.tenantId, osId: os.id, tipo: 'itens' }); // mesmo id em outro tenant: não entrega
      hub.emitir({ tenantId: f.a.tenantId, osId: os.id, tipo: 'status' });
      expect(await ler()).toBe('data: {"tipo":"status"}\n\n');
      ac.abort();
      expect(await ler()).toBeNull();
      expect(hub.contar()).toBe(antes);
    }));

  it('heartbeat fecha o stream quando a OS passa dos 7 dias', () =>
    run(async ({ db, os }) => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const antes = hub.contar();
        const ler = leitor(await abrir(os.tokenPublico));
        await ler(); // ready
        await vi.advanceTimersByTimeAsync(25_000);
        expect(await ler()).toBe(': hb\n\n');
        await db.update(ordensServico).set({ status: 'entregue', entregueEm: new Date(Date.now() - 8 * DIA) }).where(eq(ordensServico.id, os.id));
        await vi.advanceTimersByTimeAsync(25_000);
        expect(await ler()).toBeNull();
        expect(hub.contar()).toBe(antes);
      } finally {
        vi.useRealTimers();
      }
    }));

  it('limite de conexões novas por IP: a 11ª no minuto recebe 429 genérico com Retry-After', () =>
    run(async () => {
      const token = randomBytes(32).toString('base64url'); // inválido também conta: não dá para varrer tokens
      for (let i = 0; i < 10; i++) expect((await abrir(token, '10.8.0.1')).status).toBe(404);
      const r = await abrir(token, '10.8.0.1');
      expect(r.status).toBe(429);
      expect(r.headers.get('retry-after')).toBe('60');
      expect(await r.text()).toBe('Muitas requisições. Aguarde um minuto e tente de novo.');
    }));
});
