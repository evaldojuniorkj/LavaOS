import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { expect } from 'vitest';
import { membros, ordensServico, portes, precos, servicos, user, veiculos, type OsStatus } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import type { AuthFixtures } from './auth';
import { createHttp } from './http';

/** Cookie de sessão de staff (e-mail/senha) ou do lavador de A (PIN), para o mock de next/headers. */
export async function sessaoStaff(f: AuthFixtures, userId: string): Promise<Headers> {
  const http = createHttp();
  expect((await http.post('/sign-in/email', { email: f.emailDe(userId), password: f.senha })).status).toBe(200);
  return http.headers();
}
export async function sessaoLavador(f: AuthFixtures): Promise<Headers> {
  const http = createHttp();
  expect((await http.post('/lavador-pin/sign-in', { usuario: f.lavador.usuario, pin: f.lavador.pin })).status).toBe(200);
  return http.headers();
}

/** Veículo com um serviço principal com preço (o mínimo para existir uma OS). */
export async function semearVeiculo(db: Database, tenantId: string) {
  const [porte] = await db.insert(portes).values({ tenantId, nome: 'Médio' }).returning();
  const [servico] = await db.insert(servicos).values({ tenantId, nome: 'Lavagem', comissaoTipo: 'percentual', comissaoValor: 3000 }).returning();
  await db.insert(precos).values({ tenantId, servicoId: servico.id, porteId: porte.id, valorCentavos: 5000 });
  const [veiculo] = await db.insert(veiculos).values({ tenantId, placa: 'ABC1D23', porteId: porte.id }).returning();
  return veiculo;
}

/** OS inserida direto no estado desejado (o fluxo de abertura é testado em ordens-abrir). */
export async function criarOs(db: Database, i: { tenantId: string; veiculoId: string; abertaPor: string; status?: OsStatus; responsavelId?: string | null; prontoEm?: Date }) {
  const [{ n }] = (await db.execute(sql`select count(*)::int + 1 as n from ordens_servico where tenant_id = ${i.tenantId}`)).rows as { n: number }[];
  const [os] = await db
    .insert(ordensServico)
    .values({
      tenantId: i.tenantId,
      numero: n,
      veiculoId: i.veiculoId,
      abertaPor: i.abertaPor,
      status: i.status ?? 'aguardando',
      responsavelId: i.responsavelId ?? null,
      atribuidoEm: i.responsavelId ? new Date() : null,
      prontoEm: i.prontoEm ?? null,
      totalCentavos: 5000,
      subtotalCentavos: 5000,
      tokenPublico: randomBytes(32).toString('base64url'),
    })
    .returning();
  return os;
}

export async function criarMembro(db: Database, tenantId: string, nome: string, extra: { perfil?: 'lavador' | 'recepcao'; ativo?: boolean; createdAt?: Date } = {}) {
  const [u] = await db.insert(user).values({ name: nome, email: `${crypto.randomUUID()}@teste.invalid` }).returning();
  const [m] = await db
    .insert(membros)
    .values({ tenantId, userId: u.id, perfil: extra.perfil ?? 'lavador', nomeExibicao: nome, ativo: extra.ativo ?? true, ...(extra.createdAt && { createdAt: extra.createdAt }) })
    .returning();
  return m;
}

/** Espera até `n` conexões estarem bloqueadas em lock (barreira determinística). */
export async function esperarNoLock(db: Database, n: number) {
  for (let i = 0; ; i++) {
    const { rows } = await db.execute(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`);
    if ((rows[0].n as number) >= n) return;
    if (i > 200) throw new Error('chamadas não chegaram ao lock');
    await new Promise((r) => setTimeout(r, 25));
  }
}
