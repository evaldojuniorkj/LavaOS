import 'server-only';
import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/types';
import type { Evento } from './hub';

/** NOTIFY dentro da transação da escrita: rollback não publica. Payload só com ids e tipo (nada de R$, nomes ou token). */
export async function publicar(tx: Pick<Database, 'execute'>, { tenantId, osId, tipo }: Evento): Promise<void> {
  await tx.execute(sql`select pg_notify('lavaos_eventos', ${JSON.stringify({ tenantId, osId, tipo })})`);
}
