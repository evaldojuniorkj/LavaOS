import { getServerEnv } from '@/lib/env';
import { hub } from '@/lib/realtime/hub';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Só em LAVAOS_MODE=test: o E2E confere que fechar o navegador libera a assinatura SSE. Fora disso, 404. */
export function GET(): Response {
  if (getServerEnv().LAVAOS_MODE !== 'test') return new Response(null, { status: 404 });
  return Response.json({ assinantes: hub.contar() });
}
