import { ipDoCliente } from '@/lib/auth/ip';
import { limitar, reservarVaga, respostaLimitada } from '@/lib/rate-limit';
import { hub } from '@/lib/realtime/hub';
import { iniciarListener } from '@/lib/realtime/listener';
import { localizarOsPublica } from '@/modules/ordens/publico.repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JANELA_MS = 60_000;
const CONEXOES_POR_JANELA = 10; // por IP; a página tem 30 (no proxy)
const ABERTOS_POR_IP = 5; // simultâneos: cada um revalida o token no banco a cada 25 s
const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
// mesma resposta para token malformado, inexistente ou expirado: não revela se a OS existe
const indisponivel = () => Response.json({ ok: false, message: 'Link indisponível ou expirado' }, { status: 404, headers: HEADERS });

/** SSE do link público: só a OS do token (tenant e OS resolvidos no servidor). Payload só `{tipo}`, sem ids. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const ip = ipDoCliente(request.headers);
  if (!limitar(`sse:${ip}`, CONEXOES_POR_JANELA, JANELA_MS)) return respostaLimitada(JANELA_MS);
  const { token } = await params;
  const alvo = await localizarOsPublica(token);
  if (!alvo) return indisponivel();
  const liberar = reservarVaga(`sse:${ip}`, ABERTOS_POR_IP);
  if (!liberar) return respostaLimitada(JANELA_MS);
  // qualquer falha na montagem (listener, assinatura, primeiro envio) devolve a vaga: senão ela vazaria para sempre
  try {
    iniciarListener();
    const enc = new TextEncoder();
    let limpar = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let aberto = true;
        const enviar = (s: string) => {
          if (aberto) controller.enqueue(enc.encode(s));
        };
        enviar('event: ready\ndata: {}\n\n');
        const cancelar = hub.assinar(alvo, (m) => enviar(`data: ${JSON.stringify({ tipo: m.tipo })}\n\n`));
        // heartbeat mantém proxies sem cortar a conexão e revalida o token: passou dos 7 dias, o stream fecha
        const heartbeat = setInterval(async () => {
          try {
            const ainda = await localizarOsPublica(token);
            if (ainda?.osId !== alvo.osId) return fechar();
            enviar(': hb\n\n');
          } catch {
            fechar(); // falha passageira (ex.: banco): o EventSource reconecta
          }
        }, 25_000);
        limpar = () => {
          aberto = false;
          liberar();
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
      headers: { ...HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' },
    });
  } catch (err) {
    liberar();
    throw err;
  }
}
