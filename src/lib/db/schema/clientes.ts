import { foreignKey, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { lavaJatos } from './equipe';
import { portes } from './catalogo';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const clientes = pgTable(
  'clientes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    telefone: text('telefone'), // E.164
    observacoes: text('observacoes'),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [unique('clientes_tenant_id_uq').on(t.tenantId, t.id)],
);

export const veiculos = pgTable(
  'veiculos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    placa: text('placa'), // normalizada pela aplicação; null = sem placa (NULLs não colidem na unique)
    modelo: text('modelo'),
    cor: text('cor'),
    porteId: uuid('porte_id').notNull(),
    clienteId: uuid('cliente_id'),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique('veiculos_tenant_placa_uq').on(t.tenantId, t.placa),
    unique('veiculos_tenant_id_uq').on(t.tenantId, t.id),
    index('veiculos_tenant_porte_idx').on(t.tenantId, t.porteId),
    index('veiculos_tenant_cliente_idx').on(t.tenantId, t.clienteId),
    foreignKey({ name: 'veiculos_porte_fk', columns: [t.tenantId, t.porteId], foreignColumns: [portes.tenantId, portes.id] }),
    foreignKey({ name: 'veiculos_cliente_fk', columns: [t.tenantId, t.clienteId], foreignColumns: [clientes.tenantId, clientes.id] }),
  ],
);
