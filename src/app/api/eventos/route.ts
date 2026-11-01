import { requirePermission } from '@/lib/auth/context';
import { AcessoNegadoError } from '@/lib/auth/permissions';
import type { TenantContext } from '@/lib/auth/types';
import { hub } from '@/lib/realtime/hub';
import { iniciarListener } from '@/lib/realtime/listener';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** SSE da fila: só eventos do tenant da sessão (ids e tipo); o cliente recarrega a própria visão a cada evento. */
export async function GET(request: Request): Promise<Response> {
  let ctx: TenantContext;
  try {
    ctx = await requirePermission(request.headers, 'fila:ver');
  } catch (err) {
    if (err instanceof AcessoNegadoError) return Response.json({ ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' }, { status: 403 });
    throw err;
  }
  iniciarListener();
  const enc = new TextEncoder();
  let limpar = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let aberto = true;
      const enviar = (s: string) => {
        if (aberto) controller.enqueue(enc.encode(s));
      };
      // o cliente recarrega a fila ao receber `ready` e `resync` (o LISTEN pode ainda estar subindo neste momento)
      enviar('event: ready\ndata: {}\n\n');
      const cancelar = hub.assinar({ tenantId: ctx.tenantId }, (m) => enviar(`data: ${JSON.stringify(m)}\n\n`));
      // heartbeat mantém proxies sem cortar a conexão ociosa e revalida a sessão: membro desativado/sessão revogada perde o stream
      const heartbeat = setInterval(async () => {
        try {
          await requirePermission(request.headers, 'fila:ver');
          enviar(': hb\n\n');
        } catch (err) {
          if (err instanceof AcessoNegadoError) enviar('event: encerrado\ndata: {}\n\n');
          fechar(); // outra falha (ex.: banco): fecha e o EventSource reconecta
        }
      }, 25_000);
      limpar = () => {
        aberto = false;
        cancelar();
        clearInterval(heartbeat);
      };
      const fechar = () => {
        if (!aberto) return;
        limpar();
        try {
          controller.close();
        } catch {} // stream já cancelado/com erro
      };
      if (request.signal.aborted) fechar();
      else request.signal.addEventListener('abort', fechar, { once: true });
    },
    cancel: () => limpar(),
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' },
  });
}
