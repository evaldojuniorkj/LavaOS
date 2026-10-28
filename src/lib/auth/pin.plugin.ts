import 'server-only';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, formCsrfMiddleware, getIP, isAPIError } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import { getServerEnv } from '@/lib/env';
import { hashSecret, verifySecret } from './credentials';
import { consumeOriginAttempt, resolvePilotScope, verifyAttempt, type PinHasher } from './pin.repo';
import { normalizeUsername } from './pin.rules';

const TRINTA_DIAS = 60 * 60 * 24 * 30;
// Uma resposta para toda falha (PIN errado, desconhecido, inativo, bloqueado): bloqueio não revela que o usuário existe.
const INVALIDO = { code: 'INVALID_CREDENTIALS', message: 'Usuário ou PIN inválidos. Após 5 erros seguidos o acesso fica bloqueado por 15 minutos.' };

// strict: tenant/organização no corpo é recusado; o tenant vem de LAVAOS_PILOT_SLUG.
const corpo = z.strictObject({ usuario: z.string().max(200), pin: z.string().max(200) });

export type PinPluginDeps = {
  now?: () => Date;
  hasher?: PinHasher;
  /** Só para testes: roda entre a verificação do hash (já commitada) e a emissão da sessão. */
  aposVerificar?: () => Promise<void>;
};

/** POST /api/auth/lavador-pin/sign-in { usuario, pin }: sessão Better Auth de 30 dias absolutos para o lavador. */
export function lavadorPinPlugin(deps: PinPluginDeps = {}) {
  const now = deps.now ?? (() => new Date());
  const hasher = deps.hasher ?? { hash: hashSecret, verify: verifySecret };
  return {
    id: 'lavador-pin',
    schema: {
      session: {
        fields: {
          // server-only: o guard compara com a credencial atual; returned:false tira das respostas de sessão
          pinMemberId: { type: 'string', required: false, input: false, returned: false },
          pinCredentialVersion: { type: 'number', required: false, input: false, returned: false },
        },
      },
    },
    endpoints: {
      lavadorPinSignIn: createAuthEndpoint('/lavador-pin/sign-in', { method: 'POST', use: [formCsrfMiddleware] }, async (ctx) => {
        const body = corpo.safeParse(ctx.body);
        if (!body.success) throw new APIError('BAD_REQUEST', { code: 'REQUISICAO_INVALIDA', message: 'Requisição inválida.' });
        const agora = now();
        const scope = await resolvePilotScope(getServerEnv().LAVAOS_PILOT_SLUG);
        // IP vem de advanced.ipAddress (x-real-ip gravado pelo proxy); sem IP confiável, todos dividem uma cota
        const ip = getIP(ctx.request ?? ctx.headers ?? new Headers(), ctx.context.options) ?? 'desconhecido';
        if (!(await consumeOriginAttempt(scope, ip, agora))) {
          throw new APIError('TOO_MANY_REQUESTS', { code: 'TOO_MANY_ATTEMPTS', message: 'Muitas tentativas. Aguarde alguns minutos.' });
        }
        const r = await verifyAttempt(scope, normalizeUsername(body.data.usuario), body.data.pin, agora, hasher);
        if (!r.ok) throw new APIError('UNAUTHORIZED', INVALIDO);
        await deps.aposVerificar?.();
        // A sessão guarda a versão verificada acima; um reset depois disso a torna inválida no guard.
        let s;
        try {
          s = await ctx.context.internalAdapter.createSession(
            r.userId,
            false,
            {
              activeOrganizationId: scope.tenantId,
              pinMemberId: r.memberId,
              pinCredentialVersion: r.credentialVersion,
              createdAt: agora,
              expiresAt: new Date(agora.getTime() + TRINTA_DIAS * 1000),
            },
            true,
          );
        } catch (err) {
          // hook de sessão recusou (vínculo desativado entre a verificação e a emissão)
          if (isAPIError(err)) throw new APIError('UNAUTHORIZED', INVALIDO);
          throw err;
        }
        const user = await ctx.context.internalAdapter.findUserById(r.userId);
        if (!user) throw new APIError('UNAUTHORIZED', INVALIDO);
        await setSessionCookie(ctx, { session: s, user }, false, { maxAge: TRINTA_DIAS });
        return ctx.json({ ok: true });
      }),
    },
  } satisfies BetterAuthPlugin;
}
