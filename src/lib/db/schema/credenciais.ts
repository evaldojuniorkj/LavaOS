import { check, foreignKey, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { lavaJatos, membros } from './equipe';

/** PIN do lavador. Server-only: nunca exposto como campo do user/member. */
export const credenciaisLavador = pgTable(
  'credenciais_lavador',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    membroId: uuid('membro_id').notNull(),
    usuarioNormalizado: text('usuario_normalizado').notNull(),
    pinHash: text('pin_hash').notNull(),
    versao: integer('versao').default(1).notNull(),
    errosConsecutivos: integer('erros_consecutivos').default(0).notNull(),
    bloqueadoAte: timestamp('bloqueado_ate', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique('credenciais_tenant_usuario_uq').on(t.tenantId, t.usuarioNormalizado),
    unique('credenciais_tenant_membro_uq').on(t.tenantId, t.membroId),
    foreignKey({ name: 'credenciais_membro_fk', columns: [t.tenantId, t.membroId], foreignColumns: [membros.tenantId, membros.id] }).onDelete('cascade'),
    check('credenciais_versao_ck', sql`${t.versao} > 0`),
  ],
);
