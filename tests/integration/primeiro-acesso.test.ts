import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { verifySecret } from '@/lib/auth/credentials';
import { requireTenantContext } from '@/lib/auth/context';
import { getDatabase } from '@/lib/db/client';
import { account, categoriasDespesa, lavaJatos, membros, portes, precos, servicos, user } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { createMemberAction } from '@/modules/equipe/equipe.actions';
import { primeiroAcessoAction } from '@/modules/lava-jato/primeiro-acesso.actions';
import { criarPrimeiroLavaJato, primeiroAcesso, sistemaConfigurado, TRAVA_PRIMEIRO_ACESSO } from '@/modules/lava-jato/primeiro-acesso.service';
import '../helpers/auth'; // env de teste (slug do piloto = tenant-a, sem LAVAOS_SETUP_TOKEN)
import { withTestDatabase } from '../helpers/db';
import { createHttp } from '../helpers/http';
import { esperarNoLock } from '../helpers/ordens';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));

const TOKEN = 'codigo-de-instalacao-0001';
const NEGADO = { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' };
const JA_CONFIGURADO = { ok: false, code: 'JA_CONFIGURADO', message: 'Este LavaOS já foi configurado. Entre pelo login.' };
const CODIGO_INVALIDO = { ok: false, code: 'CODIGO_INVALIDO', message: 'Código de instalação inválido.', fieldErrors: { codigo: ['Código de instalação inválido.'] } };
const LIMITE = { ok: false, code: 'LIMITE', message: 'Muitas tentativas. Aguarde 15 minutos e tente de novo.' };
const QUINZE_MIN = 15 * 60 * 1000;

const dados = (email = `${crypto.randomUUID()}@teste.invalid`) => ({
  nomeLavaJato: 'Lava Rápido',
  telefone: '(11) 98888-7777',
  donoNome: 'Ana Dona',
  donoEmail: email,
  donoSenha: 'senha-forte-123',
});
const form = (extra: object = {}) => ({ ...dados(), confirmacaoSenha: 'senha-forte-123', codigo: TOKEN, ...extra });
/** IP próprio por chamada: a cota do rate limit é global ao processo. */
const opts = (o: { token?: string; ip?: string; agora?: number } = {}) => ({ token: TOKEN, ip: crypto.randomUUID(), ...o });

const contagem = async (db: Database) =>
  JSON.stringify(await Promise.all([lavaJatos, user, account, membros, portes, servicos, precos].map(async (t) => (await db.execute(sql`select count(*) from ${t}`)).rows)));

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('primeiro acesso', () => {
  it('cria tenant (slug do piloto), dono que entra por e-mail, os 4 portes e serviços de exemplo inativos sem preço', () =>
    withTestDatabase(async (db) => {
      expect(await sistemaConfigurado(db)).toBe(false);
      const entrada = form({ donoEmail: 'Ana@Teste.Invalid' });
      const r = await primeiroAcesso(entrada, opts(), db);
      expect(r).toEqual({ ok: true, data: null });
      expect(JSON.stringify(r)).not.toContain(TOKEN);
      expect(await sistemaConfigurado(db)).toBe(true);

      const tenants = await db.select().from(lavaJatos);
      expect(tenants).toEqual([expect.objectContaining({ nome: 'Lava Rápido', slug: 'tenant-a', telefone: '+5511988887777' })]);
      const tenantId = tenants[0].id;

      const [m] = await db.select().from(membros);
      expect(m).toMatchObject({ tenantId, perfil: 'dono', ativo: true, nomeExibicao: 'Ana Dona' });
      const [u] = await db.select().from(user).where(eq(user.id, m.userId));
      expect(u.email).toBe('ana@teste.invalid');
      const [c] = await db.select().from(account).where(eq(account.userId, m.userId));
      expect(c.providerId).toBe('credential');
      expect(await verifySecret('senha-forte-123', c.password!)).toBe(true);

      const http = createHttp();
      expect((await http.post('/sign-in/email', { email: 'ana@teste.invalid', password: 'senha-forte-123' })).status).toBe(200);
      await expect(requireTenantContext(http.headers())).resolves.toMatchObject({ tenantId, perfil: 'dono' });

      expect(await db.select({ nome: portes.nome, ordem: portes.ordem, ativo: portes.ativo }).from(portes).orderBy(portes.ordem)).toEqual(
        ['Moto', 'Carro pequeno', 'SUV/Sedan grande', 'Caminhonete'].map((nome, i) => ({ nome, ordem: i + 1, ativo: true })),
      );
      const exemplos = await db.select().from(servicos).orderBy(servicos.nome);
      expect(exemplos.map((s) => [s.nome, s.adicional])).toEqual([
        ['Cera', true],
        ['Lavagem completa', false],
        ['Lavagem completa sem motor', false],
        ['Lavagem simples', false],
      ]);
      for (const s of exemplos) expect(s).toMatchObject({ tenantId, ativo: false, comissaoTipo: 'fixo', comissaoValor: 0 });
      expect(await db.select().from(precos)).toEqual([]);
      expect(await db.select({ nome: categoriasDespesa.nome, sistema: categoriasDespesa.sistema, tenantId: categoriasDespesa.tenantId }).from(categoriasDespesa)).toEqual(
        expect.arrayContaining(['Produtos', 'Água e luz', 'Aluguel', 'Vales', 'Outros'].map((nome) => ({ nome, sistema: false, tenantId })).concat({ nome: 'Comissões', sistema: true, tenantId })),
      );
      expect(await db.select().from(categoriasDespesa)).toHaveLength(6);

      // lavador criado depois pelo dono entra por PIN: o slug do tenant é o do piloto
      req.headers = http.headers();
      expect((await createMemberAction({ perfil: 'lavador', nomeExibicao: 'Beto', usuario: 'beto', pin: '0456' })).ok).toBe(true);
      expect((await createHttp().post('/lavador-pin/sign-in', { usuario: 'beto', pin: '0456' })).status).toBe(200);
    }));

  it('segunda chamada com tenant existente é recusada, mesmo com o código certo', () =>
    withTestDatabase(async (db) => {
      expect((await primeiroAcesso(form(), opts(), db)).ok).toBe(true);
      const antes = await contagem(db);
      expect(await primeiroAcesso(form(), opts(), db)).toEqual(JA_CONFIGURADO);
      await expect(criarPrimeiroLavaJato(dados(), db)).rejects.toThrow('acesso negado');
      expect(await contagem(db)).toBe(antes);
    }));

  it('duas chamadas simultâneas: uma cria, a outra é recusada', () =>
    withTestDatabase(async (db) => {
      // barreira: segura a trava, dispara as duas e só solta quando ambas esperam por ela
      const travado = Promise.withResolvers<void>();
      const trava = db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${TRAVA_PRIMEIRO_ACESSO})`);
        travado.resolve();
        await esperarNoLock(db, 2);
      });
      await travado.promise;
      const disparadas = Promise.allSettled([criarPrimeiroLavaJato(dados(), db), criarPrimeiroLavaJato(dados(), db)]);
      await trava;
      const rs = await disparadas;
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rs.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.message)).toEqual(['acesso negado']);
      expect(await db.select().from(lavaJatos)).toHaveLength(1);
      expect(await db.select().from(membros)).toHaveLength(1);
      expect(await db.select().from(portes)).toHaveLength(4);
    }));

  it('senha fraca, confirmação diferente e campos extras (tenantId, slug, perfil) são recusados sem gravar nada', () =>
    withTestDatabase(async (db) => {
      const antes = await contagem(db);
      const r = await primeiroAcesso(form({ donoSenha: '1234567', confirmacaoSenha: '1234567' }), opts(), db);
      expect(r).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { donoSenha: [expect.any(String)] } });
      expect(await primeiroAcesso(form({ confirmacaoSenha: 'outra' }), opts(), db)).toMatchObject({ code: 'VALIDACAO', fieldErrors: { confirmacaoSenha: ['As senhas não conferem.'] } });
      for (const extra of [{ tenantId: crypto.randomUUID() }, { slug: 'outro' }, { perfil: 'gerente' }]) {
        expect(await primeiroAcesso(form(extra), opts(), db)).toMatchObject({ ok: false, code: 'VALIDACAO' });
      }
      expect(await contagem(db)).toBe(antes);
    }));

  it('código errado ou ausente é recusado sem gravar nada; sem LAVAOS_SETUP_TOKEN o assistente fica desligado', () =>
    withTestDatabase(async (db) => {
      const antes = await contagem(db);
      expect(await primeiroAcesso(form({ codigo: 'codigo-errado-000000' }), opts(), db)).toEqual(CODIGO_INVALIDO);
      expect(await primeiroAcesso(form({ codigo: '' }), opts(), db)).toEqual(CODIGO_INVALIDO);
      expect(await primeiroAcesso(form({ codigo: undefined }), opts(), db)).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { codigo: [expect.any(String)] } });
      for (const token of [undefined, '']) expect(await primeiroAcesso(form(), opts({ token }), db)).toEqual(NEGADO);
      // action real: o env de teste não define LAVAOS_SETUP_TOKEN
      req.headers = new Headers({ 'x-real-ip': '10.9.9.9' });
      expect(await primeiroAcessoAction(form())).toEqual(NEGADO);
      expect(await contagem(db)).toBe(antes);
    }));

  it('rate limit por IP: na 6ª tentativa em 15 minutos recusa até o código certo; depois da janela, libera', () =>
    withTestDatabase(async (db) => {
      const ip = crypto.randomUUID();
      const t0 = 1_000_000;
      for (let i = 0; i < 5; i++) expect(await primeiroAcesso(form({ codigo: `errado-${i}-0000000000` }), opts({ ip, agora: t0 + i }), db)).toEqual(CODIGO_INVALIDO);
      expect(await primeiroAcesso(form(), opts({ ip, agora: t0 + 10 }), db)).toEqual(LIMITE);
      expect(await primeiroAcesso(form(), opts({ agora: t0 + 10 }), db)).toMatchObject({ ok: true }); // outro IP tem a própria cota
      await db.delete(lavaJatos);
      expect(await primeiroAcesso(form(), opts({ ip, agora: t0 + QUINZE_MIN }), db)).toMatchObject({ ok: true });
    }));
});
