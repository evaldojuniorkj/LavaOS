import { boolean, check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { lavaJatos } from './equipe';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const COMISSAO_TIPOS = ['percentual', 'fixo'] as const;
export type ComissaoTipo = (typeof COMISSAO_TIPOS)[number];

/** Percentual em pontos-base (0–10000); fixo em centavos (>= 0). Usado em servicos e os_itens. */
export const comissaoValida = (tipo: unknown, valor: unknown) =>
  sql`((${tipo} = 'percentual' and ${valor} between 0 and 10000) or (${tipo} = 'fixo' and ${valor} >= 0))`;

export const portes = pgTable(
  'portes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    ordem: integer('ordem').default(0).notNull(),
    ativo: boolean('ativo').default(true).notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [unique('portes_tenant_id_uq').on(t.tenantId, t.id)],
);

export const servicos = pgTable(
  'servicos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    descricao: text('descricao'),
    duracaoEstimadaMin: integer('duracao_estimada_min'),
    ativo: boolean('ativo').default(true).notNull(),
    adicional: boolean('adicional').default(false).notNull(),
    comissaoTipo: text('comissao_tipo', { enum: COMISSAO_TIPOS }).notNull(),
    comissaoValor: integer('comissao_valor').notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique('servicos_tenant_id_uq').on(t.tenantId, t.id),
    check('servicos_duracao_ck', sql`${t.duracaoEstimadaMin} is null or ${t.duracaoEstimadaMin} > 0`),
    check('servicos_comissao_ck', comissaoValida(t.comissaoTipo, t.comissaoValor)),
  ],
);

export const precos = pgTable(
  'precos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    servicoId: uuid('servico_id').notNull(),
    porteId: uuid('porte_id').notNull(),
    valorCentavos: integer('valor_centavos').notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique('precos_servico_porte_uq').on(t.servicoId, t.porteId),
    index('precos_tenant_porte_idx').on(t.tenantId, t.porteId),
    foreignKey({ name: 'precos_servico_fk', columns: [t.tenantId, t.servicoId], foreignColumns: [servicos.tenantId, servicos.id] }).onDelete('cascade'),
    foreignKey({ name: 'precos_porte_fk', columns: [t.tenantId, t.porteId], foreignColumns: [portes.tenantId, portes.id] }).onDelete('cascade'),
    check('precos_valor_ck', sql`${t.valorCentavos} >= 0`),
  ],
);
