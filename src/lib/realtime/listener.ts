import 'server-only';
import { Client } from 'pg';
import { z } from 'zod';
import { getServerEnv } from '@/lib/env';
import { hub, TIPOS_EVENTO } from './hub';

const eventoSchema = z.object({ tenantId: z.string(), osId: z.string(), tipo: z.enum(TIPOS_EVENTO) });

type Estado = { parado: boolean; client?: Client; timer?: NodeJS.Timeout };
const g = globalThis as { __lavaosListener?: Estado };

/** Uma conexão LISTEN dedicada por processo (fora do pool); idempotente. Reconecta com backoff e emite `resync`. */
export function iniciarListener(): void {
  if (g.__lavaosListener) return;
  const estado: Estado = (g.__lavaosListener = { parado: false });
  const url = getServerEnv().DATABASE_URL;
  let tentativas = 0;
  let jaConectou = false;

  const conectar = async () => {
    const client = new Client({ connectionString: url });
    estado.client = client;
    let caiu = false;
    const cair = () => {
      if (caiu) return;
      caiu = true;
      client.end().catch(() => {});
      if (estado.parado) return;
      estado.timer = setTimeout(conectar, Math.min(10_000, 250 * 2 ** tentativas++));
      estado.timer.unref();
    };
    client.on('error', (err) => {
      console.error('[realtime] conexão LISTEN caiu:', err.message);
      cair();
    });
    client.on('end', cair);
    client.on('notification', (n) => {
      let dado: unknown;
      try {
        dado = JSON.parse(n.payload ?? '');
      } catch {
        return; // payload malformado: ignora
      }
      const e = eventoSchema.safeParse(dado);
      if (e.success) hub.emitir(e.data);
    });
    try {
      await client.connect();
      await client.query('LISTEN lavaos_eventos');
    } catch (err) {
      console.error('[realtime] falha ao escutar:', err instanceof Error ? err.message : err);
      return cair();
    }
    if (estado.parado) return void client.end().catch(() => {});
    tentativas = 0;
    if (jaConectou) hub.emitir({ tipo: 'resync' }); // eventos podem ter sido perdidos enquanto caído
    jaConectou = true;
  };
  void conectar();
}

/** Para o listener (testes, shutdown); um novo `iniciarListener` volta a conectar. */
export async function pararListener(): Promise<void> {
  const estado = g.__lavaosListener;
  if (!estado) return;
  g.__lavaosListener = undefined;
  estado.parado = true;
  clearTimeout(estado.timer);
  await estado.client?.end().catch(() => {});
}
