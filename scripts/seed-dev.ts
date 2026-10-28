/**
 * Provisiona um tenant + dono para desenvolvimento local: `pnpm db:seed:dev` (depois de `pnpm db:migrate`).
 * Só em LAVAOS_MODE development/test e nos bancos locais lavaos_dev/lavaos_test.
 * Entradas: LAVAOS_PILOT_SLUG, SEED_TENANT_NOME, SEED_OWNER_EMAIL, SEED_OWNER_NOME e a senha em
 * SEED_OWNER_PASSWORD ou digitada no terminal (sem eco). Idempotente: se o tenant já tem dono, nada muda.
 * Roda com o type stripping do Node, sem bundler: por isso SQL direto e só imports relativos com extensão.
 */
import { hashPassword } from 'better-auth/crypto';
import pg from 'pg';
import { z } from 'zod';
import { createMemberSchema } from '../src/modules/equipe/equipe.schemas.ts';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', 'postgres'];
const BANCOS = ['/lavaos_dev', '/lavaos_test'];

function recusar(motivo: string): never {
  console.error(`seed-dev recusado: ${motivo}`);
  process.exit(1);
}

/** Lê a senha do terminal em modo raw, sem ecoar os caracteres. */
async function lerSemEco(rotulo: string): Promise<string> {
  process.stdout.write(rotulo);
  process.stdin.setRawMode(true);
  let s = '';
  for await (const chunk of process.stdin) {
    for (const ch of String(chunk)) {
      if (ch === '\u0003') process.exit(130); // Ctrl+C
      if (ch === '\r' || ch === '\n') {
        process.stdin.setRawMode(false);
        process.stdout.write('\n');
        return s;
      }
      s = ch === '\u007f' ? s.slice(0, -1) : s + ch;
    }
  }
  return s;
}

const env = process.env;
if (env.LAVAOS_MODE !== 'development' && env.LAVAOS_MODE !== 'test') recusar('LAVAOS_MODE precisa ser development ou test.');
const url = URL.canParse(env.DATABASE_URL ?? '') ? new URL(env.DATABASE_URL!) : null;
// query/hash poderiam trocar o host depois da checagem
if (!url || url.search || url.hash || !LOCAL_HOSTS.includes(url.hostname) || !BANCOS.includes(url.pathname)) {
  recusar('DATABASE_URL precisa ser lavaos_dev ou lavaos_test em host local.');
}
const senha = env.SEED_OWNER_PASSWORD ?? (process.stdin.isTTY ? await lerSemEco('Senha do dono: ') : '');
if (!senha) recusar('senha do dono ausente (SEED_OWNER_PASSWORD ou digitação no terminal).');

const tenant = z
  .strictObject({ slug: z.string().regex(/^[a-z0-9-]{1,60}$/), nome: z.string().trim().min(1).max(80) })
  .safeParse({ slug: env.LAVAOS_PILOT_SLUG, nome: env.SEED_TENANT_NOME ?? 'Lava Jato (dev)' });
const dono = createMemberSchema.safeParse({ perfil: 'dono', nomeExibicao: env.SEED_OWNER_NOME ?? 'Dono', email: env.SEED_OWNER_EMAIL ?? 'dono@lavaos.test', senha });
// só os nomes dos campos: a mensagem nunca carrega o valor digitado
if (!tenant.success) recusar(`tenant inválido (${Object.keys(z.flattenError(tenant.error).fieldErrors).join(', ')}).`);
if (!dono.success || dono.data.perfil === 'lavador') recusar(`dono inválido (${dono.success ? 'perfil' : Object.keys(z.flattenError(dono.error).fieldErrors).join(', ')}).`);

const client = new pg.Client({ connectionString: url!.toString() });
await client.connect();
try {
  await client.query('begin');
  await client.query('insert into lava_jatos (nome, slug) values ($1, $2) on conflict (slug) do nothing', [tenant.data.nome, tenant.data.slug]);
  const { rows: [t] } = await client.query('select id from lava_jatos where slug = $1 for update', [tenant.data.slug]);
  const { rowCount: temDono } = await client.query(`select 1 from membros where tenant_id = $1 and perfil = 'dono'`, [t.id]);
  if (temDono) {
    await client.query('rollback');
    console.log(`seed-dev: tenant "${tenant.data.slug}" já tem dono; nada alterado.`);
  } else {
    const { rowCount: emUso } = await client.query('select 1 from "user" where email = $1', [dono.data.email]);
    if (emUso) {
      await client.query('rollback');
      recusar('o e-mail do dono já existe; nenhuma conta foi reassociada ou alterada.');
    }
    const { rows: [u] } = await client.query('insert into "user" (name, email) values ($1, $2) returning id', [dono.data.nomeExibicao, dono.data.email]);
    await client.query(`insert into account (user_id, account_id, provider_id, password) values ($1, $2, 'credential', $3)`, [u.id, u.id, await hashPassword(dono.data.senha)]);
    await client.query(`insert into membros (tenant_id, user_id, perfil, nome_exibicao) values ($1, $2, 'dono', $3)`, [t.id, u.id, dono.data.nomeExibicao]);
    await client.query('commit');
    console.log(`seed-dev: tenant "${tenant.data.slug}" e dono ${dono.data.email} criados.`);
  }
} catch (err) {
  await client.query('rollback').catch(() => {});
  console.error('seed-dev falhou:', (err as { code?: string }).code ?? 'erro'); // sem mensagem do driver (parâmetros)
  process.exitCode = 1;
} finally {
  await client.end();
}
