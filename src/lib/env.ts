import 'server-only';
import { z } from 'zod';

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]']; // o CI publica o Postgres em localhost

const dbUrl = z.string().refine((v) => URL.canParse(v) && /^postgres(ql)?:$/.test(new URL(v).protocol), 'URL de banco inválida');

const schema = z
  .object({
    DATABASE_URL: dbUrl,
    MIGRATION_DATABASE_URL: dbUrl,
    TEST_DATABASE_URL: dbUrl,
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    LAVAOS_PILOT_SLUG: z.string().min(1),
    LAVAOS_MODE: z.enum(['development', 'test', 'production']),
    // código de uso único do assistente /primeiro-acesso; ausente ou vazio = assistente desligado
    LAVAOS_SETUP_TOKEN: z.preprocess((v) => v || undefined, z.string().min(16).optional()),
  })
  .superRefine((env, ctx) => {
    const test = new URL(env.TEST_DATABASE_URL);
    if (test.pathname !== '/lavaos_test' || !LOCAL_HOSTS.includes(test.hostname)) {
      ctx.addIssue({ code: 'custom', path: ['TEST_DATABASE_URL'], message: 'deve ser o banco lavaos_test em host local' });
    }
    const main = new URL(env.DATABASE_URL);
    const same = main.hostname === test.hostname && main.port === test.port && main.pathname === test.pathname;
    if (same && env.LAVAOS_MODE !== 'test') {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'banco principal não pode ser o destino de testes' });
    }
  });

export type ServerEnv = z.infer<typeof schema>;

export function parseServerEnv(input: Record<string, string | undefined>): ServerEnv {
  return schema.parse(input);
}

let cached: ServerEnv | undefined;
/** Validação lazy: só roda no primeiro uso, então o build não exige banco ativo. */
export function getServerEnv(): ServerEnv {
  return (cached ??= parseServerEnv(process.env));
}
