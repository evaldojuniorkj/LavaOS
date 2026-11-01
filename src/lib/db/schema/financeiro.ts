import { boolean, check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { lavaJatos, membros } from './equipe';
import { ordensServico } from './ordens';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const CAIXA_STATUS = ['aberto', 'fechado'] as const;
export const FORMAS_PAGAMENTO = ['dinheiro', 'pix', 'debito', 'credito'] as const;

// Sem cascade a partir da OS ou do caixa e sem DELETE para lavaos_app (migração 0005): corrige-se por estorno ou cancelamento.
export const caixas = pgTable(
  'caixas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    data: date('data').notNull(),
    trocoInicialCentavos: integer('troco_inicial_centavos').notNull(),
    abertoPor: uuid('aberto_por').notNull(),
    abertoEm: ts('aberto_em').defaultNow().notNull(),
    fechadoPor: uuid('fechado_por'),
    fechadoEm: ts('fechado_em'),
    dinheiroContadoCentavos: integer('dinheiro_contado_centavos'),
    diferencaCentavos: integer('diferenca_centavos'),
    status: text('status', { enum: CAIXA_STATUS }).default('aberto').notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique('caixas_tenant_id_uq').on(t.tenantId, t.id),
    unique('caixas_tenant_data_uq').on(t.tenantId, t.data),
    uniqueIndex('caixas_um_aberto_uq').on(t.tenantId).where(sql`${t.status} = 'aberto'`),
    foreignKey({ name: 'caixas_aberto_por_fk', columns: [t.tenantId, t.abertoPor], foreignColumns: [membros.tenantId, membros.id] }),
    foreignKey({ name: 'caixas_fechado_por_fk', columns: [t.tenantId, t.fechadoPor], foreignColumns: [membros.tenantId, membros.id] }),
    check('caixas_status_ck', sql`${t.status} in ('aberto','fechado')`),
    check('caixas_valores_ck', sql`${t.trocoInicialCentavos} >= 0 and (${t.dinheiroContadoCentavos} is null or ${t.dinheiroContadoCentavos} >= 0)`),
  ],
);

export const pagamentos = pgTable(
  'pagamentos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    osId: uuid('os_id').notNull(),
    caixaId: uuid('caixa_id').notNull(),
    forma: text('forma', { enum: FORMAS_PAGAMENTO }).notNull(),
    valorCentavos: integer('valor_centavos').notNull(),
    recebidoPor: uuid('recebido_por').notNull(),
    recebidoEm: ts('recebido_em').defaultNow().notNull(),
    estornadoEm: ts('estornado_em'),
    estornadoPor: uuid('estornado_por'),
    motivoEstorno: text('motivo_estorno'),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique('pagamentos_tenant_id_uq').on(t.tenantId, t.id),
    index('pagamentos_tenant_os_idx').on(t.tenantId, t.osId),
    index('pagamentos_tenant_caixa_idx').on(t.tenantId, t.caixaId),
    foreignKey({ name: 'pagamentos_os_fk', columns: [t.tenantId, t.osId], foreignColumns: [ordensServico.tenantId, ordensServico.id] }),
    foreignKey({ name: 'pagamentos_caixa_fk', columns: [t.tenantId, t.caixaId], foreignColumns: [caixas.tenantId, caixas.id] }),
    foreignKey({ name: 'pagamentos_recebido_por_fk', columns: [t.tenantId, t.recebidoPor], foreignColumns: [membros.tenantId, membros.id] }),
    foreignKey({ name: 'pagamentos_estornado_por_fk', columns: [t.tenantId, t.estornadoPor], foreignColumns: [membros.tenantId, membros.id] }),
    check('pagamentos_forma_ck', sql`${t.forma} in ('dinheiro','pix','debito','credito')`),
    check('pagamentos_valor_ck', sql`${t.valorCentavos} > 0`),
    check(
      'pagamentos_estorno_ck',
      sql`(${t.estornadoEm} is null and ${t.estornadoPor} is null and ${t.motivoEstorno} is null) or (${t.estornadoEm} is not null and ${t.estornadoPor} is not null and ${t.motivoEstorno} is not null)`,
    ),
  ],
);

export const categoriasDespesa = pgTable(
  'categorias_despesa',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    nome: text('nome').notNull(),
    ativo: boolean('ativo').default(true).notNull(),
    sistema: boolean('sistema').default(false).notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [unique('categorias_despesa_tenant_id_uq').on(t.tenantId, t.id), unique('categorias_despesa_tenant_nome_uq').on(t.tenantId, t.nome)],
);

export const despesas = pgTable(
  'despesas',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    categoriaId: uuid('categoria_id').notNull(),
    descricao: text('descricao').notNull(),
    valorCentavos: integer('valor_centavos').notNull(),
    vencimento: date('vencimento'),
    pagoEm: ts('pago_em'),
    caixaId: uuid('caixa_id'),
    lancadaPor: uuid('lancada_por').notNull(),
    canceladaEm: ts('cancelada_em'),
    canceladaPor: uuid('cancelada_por'),
    motivoCancelamento: text('motivo_cancelamento'),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique('despesas_tenant_id_uq').on(t.tenantId, t.id),
    index('despesas_tenant_categoria_idx').on(t.tenantId, t.categoriaId),
    index('despesas_tenant_caixa_idx').on(t.tenantId, t.caixaId),
    foreignKey({ name: 'despesas_categoria_fk', columns: [t.tenantId, t.categoriaId], foreignColumns: [categoriasDespesa.tenantId, categoriasDespesa.id] }),
    foreignKey({ name: 'despesas_caixa_fk', columns: [t.tenantId, t.caixaId], foreignColumns: [caixas.tenantId, caixas.id] }),
    foreignKey({ name: 'despesas_lancada_por_fk', columns: [t.tenantId, t.lancadaPor], foreignColumns: [membros.tenantId, membros.id] }),
    foreignKey({ name: 'despesas_cancelada_por_fk', columns: [t.tenantId, t.canceladaPor], foreignColumns: [membros.tenantId, membros.id] }),
    check('despesas_valor_ck', sql`${t.valorCentavos} > 0`),
    check('despesas_data_ck', sql`${t.pagoEm} is not null or ${t.vencimento} is not null`),
    check('despesas_caixa_pago_ck', sql`${t.caixaId} is null or ${t.pagoEm} is not null`),
    check(
      'despesas_cancelamento_ck',
      sql`(${t.canceladaEm} is null and ${t.canceladaPor} is null and ${t.motivoCancelamento} is null) or (${t.canceladaEm} is not null and ${t.canceladaPor} is not null and ${t.motivoCancelamento} is not null)`,
    ),
  ],
);
