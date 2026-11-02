import { check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { lavaJatos, membros } from './equipe';
import { ordensServico, osItens } from './ordens';
import { despesas } from './financeiro';

const ts = (name: string) => timestamp(name, { withTimezone: true });

// Vales e acertos são dinheiro: sem cascade e sem DELETE para lavaos_app (migração 0006). Comissões são derivadas da OS e podem ser apagadas na reabertura.
export const acertosComissao = pgTable(
  'acertos_comissao',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    membroId: uuid('membro_id').notNull(),
    periodoInicio: date('periodo_inicio').notNull(),
    periodoFim: date('periodo_fim').notNull(),
    comissoesCentavos: integer('comissoes_centavos').notNull(),
    valesCentavos: integer('vales_centavos').notNull(),
    saldoAnteriorCentavos: integer('saldo_anterior_centavos').notNull(),
    pagoCentavos: integer('pago_centavos').notNull(),
    saldoDevedorCentavos: integer('saldo_devedor_centavos').notNull(),
    despesaId: uuid('despesa_id'),
    pagoEm: ts('pago_em').defaultNow().notNull(),
    pagoPor: uuid('pago_por').notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique('acertos_comissao_tenant_id_uq').on(t.tenantId, t.id),
    index('acertos_comissao_tenant_membro_idx').on(t.tenantId, t.membroId),
    foreignKey({ name: 'acertos_comissao_membro_fk', columns: [t.tenantId, t.membroId], foreignColumns: [membros.tenantId, membros.id] }),
    foreignKey({ name: 'acertos_comissao_pago_por_fk', columns: [t.tenantId, t.pagoPor], foreignColumns: [membros.tenantId, membros.id] }),
    foreignKey({ name: 'acertos_comissao_despesa_fk', columns: [t.tenantId, t.despesaId], foreignColumns: [despesas.tenantId, despesas.id] }),
    check(
      'acertos_comissao_valores_ck',
      sql`${t.comissoesCentavos} >= 0 and ${t.valesCentavos} >= 0 and ${t.saldoAnteriorCentavos} >= 0 and ${t.pagoCentavos} >= 0 and ${t.saldoDevedorCentavos} >= 0`,
    ),
    check(
      'acertos_comissao_conta_ck',
      sql`${t.pagoCentavos} = greatest(0, ${t.comissoesCentavos} - ${t.valesCentavos} - ${t.saldoAnteriorCentavos}) and ${t.saldoDevedorCentavos} = greatest(0, ${t.valesCentavos} + ${t.saldoAnteriorCentavos} - ${t.comissoesCentavos})`,
    ),
    check('acertos_comissao_despesa_ck', sql`(${t.pagoCentavos} = 0) = (${t.despesaId} is null)`),
  ],
);

export const comissoes = pgTable(
  'comissoes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    osId: uuid('os_id').notNull(),
    osItemId: uuid('os_item_id').notNull(),
    membroId: uuid('membro_id').notNull(),
    baseCentavos: integer('base_centavos').notNull(),
    valorCentavos: integer('valor_centavos').notNull(),
    acertoId: uuid('acerto_id'),
    geradaEm: ts('gerada_em').defaultNow().notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique('comissoes_tenant_id_uq').on(t.tenantId, t.id),
    unique('comissoes_tenant_item_uq').on(t.tenantId, t.osItemId),
    index('comissoes_tenant_membro_acerto_idx').on(t.tenantId, t.membroId, t.acertoId),
    index('comissoes_tenant_os_idx').on(t.tenantId, t.osId),
    foreignKey({ name: 'comissoes_os_fk', columns: [t.tenantId, t.osId], foreignColumns: [ordensServico.tenantId, ordensServico.id] }),
    foreignKey({ name: 'comissoes_os_item_fk', columns: [t.tenantId, t.osItemId], foreignColumns: [osItens.tenantId, osItens.id] }),
    foreignKey({ name: 'comissoes_membro_fk', columns: [t.tenantId, t.membroId], foreignColumns: [membros.tenantId, membros.id] }),
    foreignKey({ name: 'comissoes_acerto_fk', columns: [t.tenantId, t.acertoId], foreignColumns: [acertosComissao.tenantId, acertosComissao.id] }),
    check('comissoes_valores_ck', sql`${t.baseCentavos} >= 0 and ${t.valorCentavos} >= 0`),
  ],
);

export const vales = pgTable(
  'vales',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    membroId: uuid('membro_id').notNull(),
    valorCentavos: integer('valor_centavos').notNull(),
    dadoEm: ts('dado_em').defaultNow().notNull(),
    dadoPor: uuid('dado_por').notNull(),
    despesaId: uuid('despesa_id').notNull(),
    acertoId: uuid('acerto_id'),
    canceladoEm: ts('cancelado_em'),
    canceladoPor: uuid('cancelado_por'),
    motivoCancelamento: text('motivo_cancelamento'),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique('vales_tenant_id_uq').on(t.tenantId, t.id),
    index('vales_tenant_membro_acerto_idx').on(t.tenantId, t.membroId, t.acertoId),
    foreignKey({ name: 'vales_membro_fk', columns: [t.tenantId, t.membroId], foreignColumns: [membros.tenantId, membros.id] }),
    foreignKey({ name: 'vales_dado_por_fk', columns: [t.tenantId, t.dadoPor], foreignColumns: [membros.tenantId, membros.id] }),
    foreignKey({ name: 'vales_cancelado_por_fk', columns: [t.tenantId, t.canceladoPor], foreignColumns: [membros.tenantId, membros.id] }),
    foreignKey({ name: 'vales_despesa_fk', columns: [t.tenantId, t.despesaId], foreignColumns: [despesas.tenantId, despesas.id] }),
    foreignKey({ name: 'vales_acerto_fk', columns: [t.tenantId, t.acertoId], foreignColumns: [acertosComissao.tenantId, acertosComissao.id] }),
    check('vales_valor_ck', sql`${t.valorCentavos} > 0`),
    check(
      'vales_cancelamento_ck',
      sql`(${t.canceladoEm} is null and ${t.canceladoPor} is null and ${t.motivoCancelamento} is null) or (${t.canceladoEm} is not null and ${t.canceladoPor} is not null and ${t.motivoCancelamento} is not null)`,
    ),
  ],
);
