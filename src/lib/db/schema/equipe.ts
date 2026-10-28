import { boolean, check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { user } from './auth';

export const PERFIS = ['dono', 'gerente', 'recepcao', 'lavador'] as const;
export type Perfil = (typeof PERFIS)[number];

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Organização do Better Auth = tenant. */
export const lavaJatos = pgTable('lava_jatos', {
  id: uuid('id').defaultRandom().primaryKey(),
  nome: text('nome').notNull(),
  slug: text('slug').notNull().unique(),
  telefone: text('telefone'),
  endereco: text('endereco'),
  createdAt: ts('created_at').defaultNow().notNull(),
  updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

/** Member do Better Auth; `perfil` é o role. Um perfil por vínculo. */
export const membros = pgTable(
  'membros',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    perfil: text('perfil', { enum: PERFIS }).notNull(),
    nomeExibicao: text('nome_exibicao').notNull(),
    ativo: boolean('ativo').default(true).notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique('membros_tenant_user_uq').on(t.tenantId, t.userId),
    unique('membros_tenant_id_uq').on(t.tenantId, t.id),
    index('membros_user_id_idx').on(t.userId),
    check('membros_perfil_ck', sql`${t.perfil} in ('dono','gerente','recepcao','lavador')`),
  ],
);

/** Convite exigido pelo contrato do plugin; o fluxo HTTP fica bloqueado. */
export const convites = pgTable(
  'convites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    perfil: text('perfil'),
    status: text('status').default('pending').notNull(),
    expiresAt: ts('expires_at').notNull(),
    inviterId: uuid('inviter_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [index('convites_tenant_id_idx').on(t.tenantId), index('convites_email_idx').on(t.email), index('convites_inviter_id_idx').on(t.inviterId)],
);
