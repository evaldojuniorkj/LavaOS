import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { lavaJatos, membros } from './equipe';
import { COMISSAO_TIPOS, comissaoValida, portes, servicos } from './catalogo';
import { clientes, veiculos } from './clientes';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const OS_STATUS = ['aguardando', 'em_lavagem', 'pronto', 'entregue', 'cancelada'] as const;
export type OsStatus = (typeof OS_STATUS)[number];
export const OS_EVENTO_TIPOS = ['status', 'responsavel', 'itens', 'valor'] as const;

export const ordensServico = pgTable(
  'ordens_servico',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    numero: integer('numero').notNull(),
    veiculoId: uuid('veiculo_id').notNull(),
    clienteId: uuid('cliente_id'),
    responsavelId: uuid('responsavel_id'),
    atribuidoEm: ts('atribuido_em'),
    status: text('status', { enum: OS_STATUS }).default('aguardando').notNull(),
    subtotalCentavos: integer('subtotal_centavos').default(0).notNull(),
    descontoCentavos: integer('desconto_centavos').default(0).notNull(),
    acrescimoCentavos: integer('acrescimo_centavos').default(0).notNull(),
    totalCentavos: integer('total_centavos').default(0).notNull(),
    tokenPublico: text('token_publico').notNull().unique(),
    abertaPor: uuid('aberta_por').notNull(),
    observacoes: text('observacoes'),
    motivoCancelamento: text('motivo_cancelamento'),
    entradaEm: ts('entrada_em').defaultNow().notNull(),
    inicioLavagemEm: ts('inicio_lavagem_em'),
    prontoEm: ts('pronto_em'),
    entregueEm: ts('entregue_em'),
    canceladaEm: ts('cancelada_em'),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    unique('os_tenant_numero_uq').on(t.tenantId, t.numero),
    unique('os_tenant_id_uq').on(t.tenantId, t.id),
    index('os_tenant_status_idx').on(t.tenantId, t.status),
    index('os_tenant_veiculo_idx').on(t.tenantId, t.veiculoId),
    index('os_tenant_cliente_idx').on(t.tenantId, t.clienteId),
    index('os_tenant_responsavel_idx').on(t.tenantId, t.responsavelId),
    index('os_tenant_aberta_por_idx').on(t.tenantId, t.abertaPor),
    foreignKey({ name: 'os_veiculo_fk', columns: [t.tenantId, t.veiculoId], foreignColumns: [veiculos.tenantId, veiculos.id] }),
    foreignKey({ name: 'os_cliente_fk', columns: [t.tenantId, t.clienteId], foreignColumns: [clientes.tenantId, clientes.id] }),
    foreignKey({ name: 'os_responsavel_fk', columns: [t.tenantId, t.responsavelId], foreignColumns: [membros.tenantId, membros.id] }),
    foreignKey({ name: 'os_aberta_por_fk', columns: [t.tenantId, t.abertaPor], foreignColumns: [membros.tenantId, membros.id] }),
    check('os_status_ck', sql`${t.status} in ('aguardando','em_lavagem','pronto','entregue','cancelada')`),
    check('os_valores_ck', sql`${t.subtotalCentavos} >= 0 and ${t.descontoCentavos} >= 0 and ${t.acrescimoCentavos} >= 0 and ${t.totalCentavos} >= 0`),
  ],
);

export const osItens = pgTable(
  'os_itens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    osId: uuid('os_id').notNull(),
    servicoId: uuid('servico_id').notNull(),
    porteId: uuid('porte_id').notNull(),
    nomeServico: text('nome_servico').notNull(),
    valorCentavos: integer('valor_centavos').notNull(),
    comissaoTipo: text('comissao_tipo', { enum: COMISSAO_TIPOS }).notNull(),
    comissaoValor: integer('comissao_valor').notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    index('os_itens_tenant_os_idx').on(t.tenantId, t.osId),
    index('os_itens_tenant_servico_idx').on(t.tenantId, t.servicoId),
    index('os_itens_tenant_porte_idx').on(t.tenantId, t.porteId),
    foreignKey({ name: 'os_itens_os_fk', columns: [t.tenantId, t.osId], foreignColumns: [ordensServico.tenantId, ordensServico.id] }).onDelete('cascade'),
    foreignKey({ name: 'os_itens_servico_fk', columns: [t.tenantId, t.servicoId], foreignColumns: [servicos.tenantId, servicos.id] }),
    foreignKey({ name: 'os_itens_porte_fk', columns: [t.tenantId, t.porteId], foreignColumns: [portes.tenantId, portes.id] }),
    check('os_itens_valor_ck', sql`${t.valorCentavos} >= 0`),
    check('os_itens_comissao_ck', comissaoValida(t.comissaoTipo, t.comissaoValor)),
  ],
);

export const osEventos = pgTable(
  'os_eventos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => lavaJatos.id, { onDelete: 'cascade' }),
    osId: uuid('os_id').notNull(),
    tipo: text('tipo', { enum: OS_EVENTO_TIPOS }).notNull(),
    de: text('de'),
    para: text('para'),
    membroId: uuid('membro_id').notNull(),
    motivo: text('motivo'),
    em: ts('em').defaultNow().notNull(),
    createdAt: ts('created_at').defaultNow().notNull(),
    updatedAt: ts('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (t) => [
    index('os_eventos_tenant_os_idx').on(t.tenantId, t.osId),
    index('os_eventos_tenant_membro_idx').on(t.tenantId, t.membroId),
    foreignKey({ name: 'os_eventos_os_fk', columns: [t.tenantId, t.osId], foreignColumns: [ordensServico.tenantId, ordensServico.id] }).onDelete('cascade'),
    foreignKey({ name: 'os_eventos_membro_fk', columns: [t.tenantId, t.membroId], foreignColumns: [membros.tenantId, membros.id] }),
    check('os_eventos_tipo_ck', sql`${t.tipo} in ('status','responsavel','itens','valor')`),
  ],
);

/** Contador sequencial de `numero` por tenant (incrementado com lock de linha). */
export const osContadores = pgTable('os_contadores', {
  tenantId: uuid('tenant_id').primaryKey().references(() => lavaJatos.id, { onDelete: 'cascade' }),
  ultimo: integer('ultimo').default(0).notNull(),
});
