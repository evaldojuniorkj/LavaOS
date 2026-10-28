import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { organization } from 'better-auth/plugins/organization';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { getServerEnv } from '@/lib/env';
import { lavadorPinPlugin, type PinPluginDeps } from './pin.plugin';
import { isAuthHttpPathAllowed } from './route-policy';

const BASE_PATH = '/api/auth';
const SETE_DIAS = 60 * 60 * 24 * 7;
const LOGIN_INVALIDO = 'E-mail ou senha inválidos.';
const negado = () => new APIError('FORBIDDEN', { code: 'ACESSO_NEGADO', message: 'acesso negado' });

/** Tenants em que o usuário tem vínculo ativo (opcionalmente só um). Fonte de verdade é `membros`, nunca a sessão. */
async function tenantsAtivos(userId: string, tenantId?: string): Promise<string[]> {
  const rows = await getDatabase()
    .select({ tenantId: schema.membros.tenantId })
    .from(schema.membros)
    .where(and(eq(schema.membros.userId, userId), eq(schema.membros.ativo, true), tenantId ? eq(schema.membros.tenantId, tenantId) : undefined));
  return rows.map((r) => r.tenantId);
}

/** Exportado para testes (relógio/hasher injetados, instância recriada); o app usa `getAuth()`. */
export function createAuth(pin: PinPluginDeps = {}) {
  const env = getServerEnv();
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    basePath: BASE_PATH,
    // modelName/fields do plugin abaixo usam as chaves JS do schema Drizzle (lavaJatos.nome, membros.tenantId...)
    database: drizzleAdapter(getDatabase(), { provider: 'pg', schema }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8, maxPasswordLength: 128 },
    // Staff: 7 dias absolutos (lavador: 30, definido no plugin PIN). Sem refresh deslizante e sem cookieCache: toda leitura confere a linha no Postgres.
    session: { expiresIn: SETE_DIAS, disableSessionRefresh: true, cookieCache: { enabled: false } },
    // shortcut: rate limit em memória do processo (zera no restart, não compartilha entre instâncias); trocar para storage 'database' + migration da tabela rate_limit se houver mais de uma instância.
    rateLimit: { enabled: env.LAVAOS_MODE === 'production', storage: 'memory' },
    advanced: {
      database: { generateId: 'uuid' },
      // IP do cliente (limite PIN por origem e rate limit) só de X-Real-IP. Exige do proxy reverso: sobrescrever X-Real-IP
      // com o endereço do socket (nginx: proxy_set_header X-Real-IP $remote_addr) e o app ouvir só nele (loopback).
      // X-Forwarded-For não é lido: o cliente pode forjá-lo. Sem o header, produção fica sem IP (cota compartilhada).
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
      // explícito: o padrão do Better Auth desliga a checagem de origem quando NODE_ENV=test
      disableOriginCheck: false,
      useSecureCookies: env.LAVAOS_MODE === 'production' || env.BETTER_AUTH_URL.startsWith('https:'),
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
    },
    databaseHooks: {
      session: {
        create: {
          // Login sem vínculo ativo não cria sessão; com um único vínculo, o servidor já o seleciona.
          // Login PIN chega com o tenant do piloto já fixado: precisa ser um vínculo ativo.
          before: async (s) => {
            const ativos = await tenantsAtivos(s.userId);
            const pinTenant = s.pinMemberId ? (s.activeOrganizationId as string) : undefined;
            if (ativos.length === 0 || (pinTenant && !ativos.includes(pinTenant))) {
              throw new APIError('UNAUTHORIZED', { code: 'INVALID_EMAIL_OR_PASSWORD', message: LOGIN_INVALIDO });
            }
            return { data: { ...s, activeOrganizationId: pinTenant ?? (ativos.length === 1 ? ativos[0] : null) } };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/get-session' && ctx.path !== '/organization/list' && ctx.path !== '/organization/set-active') return;
        const atual = await getSessionFromCtx(ctx);
        if (!atual) return; // o próprio endpoint responde sem sessão
        if (ctx.path === '/organization/set-active') {
          const alvo = z.object({ organizationId: z.guid() }).safeParse(ctx.body);
          if (!alvo.success || (await tenantsAtivos(atual.user.id, alvo.data.organizationId)).length === 0) throw negado();
          return;
        }
        // Sessão vale se o tenant ativo tem vínculo ativo, ou se ainda não há tenant e existe algum vínculo ativo.
        const ativa = atual.session.activeOrganizationId as string | null | undefined;
        if ((await tenantsAtivos(atual.user.id, ativa ?? undefined)).length > 0) return;
        if (ctx.path === '/get-session') return ctx.json(null);
        throw negado();
      }),
      after: createAuthMiddleware(async (ctx) => {
        const r = ctx.context.returned;
        if (ctx.path === '/sign-in/email' && isAPIError(r) && (r.statusCode === 400 || r.statusCode === 401)) {
          // mesma mensagem para senha errada, e-mail inexistente ou malformado (o status original é mantido)
          throw new APIError(r.status, { code: 'INVALID_EMAIL_OR_PASSWORD', message: LOGIN_INVALIDO });
        }
        if (ctx.path === '/organization/list' && Array.isArray(r)) {
          const atual = await getSessionFromCtx(ctx);
          const ativos = new Set(atual ? await tenantsAtivos(atual.user.id) : []);
          return ctx.json(r.filter((o: { id: string }) => ativos.has(o.id)));
        }
      }),
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        creatorRole: 'dono',
        schema: {
          organization: { modelName: 'lavaJatos', fields: { name: 'nome' } },
          member: {
            modelName: 'membros',
            fields: { organizationId: 'tenantId', role: 'perfil' },
            // gravado só pela equipe (tarefa 6); declarado para o adapter conhecer a coluna obrigatória
            additionalFields: { nomeExibicao: { type: 'string', required: true, input: false } },
          },
          invitation: { modelName: 'convites', fields: { organizationId: 'tenantId', role: 'perfil' } },
        },
      }),
      lavadorPinPlugin(pin),
      {
        id: 'lavaos-route-policy',
        // Deny-by-default antes do roteamento: vale para o route handler e para chamadas diretas a auth.handler.
        onRequest: async (request) => {
          const path = new URL(request.url).pathname;
          const rel = path.startsWith(`${BASE_PATH}/`) ? path.slice(BASE_PATH.length) : '';
          if (isAuthHttpPathAllowed(request.method, rel)) return;
          return { response: Response.json({ code: 'NOT_FOUND', message: 'não encontrado' }, { status: 404 }) };
        },
      },
    ],
  });
}

const g = globalThis as { __lavaosAuth?: ReturnType<typeof createAuth> };
/** Instância única, criada no primeiro uso (o build não exige env). */
export function getAuth() {
  return (g.__lavaosAuth ??= createAuth());
}
