CREATE TABLE "caixas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"data" date NOT NULL,
	"troco_inicial_centavos" integer NOT NULL,
	"aberto_por" uuid NOT NULL,
	"aberto_em" timestamp with time zone DEFAULT now() NOT NULL,
	"fechado_por" uuid,
	"fechado_em" timestamp with time zone,
	"dinheiro_contado_centavos" integer,
	"diferenca_centavos" integer,
	"status" text DEFAULT 'aberto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "caixas_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "caixas_tenant_data_uq" UNIQUE("tenant_id","data"),
	CONSTRAINT "caixas_status_ck" CHECK ("caixas"."status" in ('aberto','fechado')),
	CONSTRAINT "caixas_valores_ck" CHECK ("caixas"."troco_inicial_centavos" >= 0 and ("caixas"."dinheiro_contado_centavos" is null or "caixas"."dinheiro_contado_centavos" >= 0))
);
--> statement-breakpoint
CREATE TABLE "categorias_despesa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"sistema" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categorias_despesa_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "categorias_despesa_tenant_nome_uq" UNIQUE("tenant_id","nome")
);
--> statement-breakpoint
CREATE TABLE "despesas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"categoria_id" uuid NOT NULL,
	"descricao" text NOT NULL,
	"valor_centavos" integer NOT NULL,
	"vencimento" date,
	"pago_em" timestamp with time zone,
	"caixa_id" uuid,
	"lancada_por" uuid NOT NULL,
	"cancelada_em" timestamp with time zone,
	"cancelada_por" uuid,
	"motivo_cancelamento" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "despesas_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "despesas_valor_ck" CHECK ("despesas"."valor_centavos" > 0),
	CONSTRAINT "despesas_data_ck" CHECK ("despesas"."pago_em" is not null or "despesas"."vencimento" is not null),
	CONSTRAINT "despesas_caixa_pago_ck" CHECK ("despesas"."caixa_id" is null or "despesas"."pago_em" is not null),
	CONSTRAINT "despesas_cancelamento_ck" CHECK (("despesas"."cancelada_em" is null and "despesas"."cancelada_por" is null and "despesas"."motivo_cancelamento" is null) or ("despesas"."cancelada_em" is not null and "despesas"."cancelada_por" is not null and "despesas"."motivo_cancelamento" is not null))
);
--> statement-breakpoint
CREATE TABLE "pagamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"os_id" uuid NOT NULL,
	"caixa_id" uuid NOT NULL,
	"forma" text NOT NULL,
	"valor_centavos" integer NOT NULL,
	"recebido_por" uuid NOT NULL,
	"recebido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"estornado_em" timestamp with time zone,
	"estornado_por" uuid,
	"motivo_estorno" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pagamentos_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "pagamentos_forma_ck" CHECK ("pagamentos"."forma" in ('dinheiro','pix','debito','credito')),
	CONSTRAINT "pagamentos_valor_ck" CHECK ("pagamentos"."valor_centavos" > 0),
	CONSTRAINT "pagamentos_estorno_ck" CHECK (("pagamentos"."estornado_em" is null and "pagamentos"."estornado_por" is null and "pagamentos"."motivo_estorno" is null) or ("pagamentos"."estornado_em" is not null and "pagamentos"."estornado_por" is not null and "pagamentos"."motivo_estorno" is not null))
);
--> statement-breakpoint
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_aberto_por_fk" FOREIGN KEY ("tenant_id","aberto_por") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caixas" ADD CONSTRAINT "caixas_fechado_por_fk" FOREIGN KEY ("tenant_id","fechado_por") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorias_despesa" ADD CONSTRAINT "categorias_despesa_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_categoria_fk" FOREIGN KEY ("tenant_id","categoria_id") REFERENCES "public"."categorias_despesa"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_caixa_fk" FOREIGN KEY ("tenant_id","caixa_id") REFERENCES "public"."caixas"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_lancada_por_fk" FOREIGN KEY ("tenant_id","lancada_por") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despesas" ADD CONSTRAINT "despesas_cancelada_por_fk" FOREIGN KEY ("tenant_id","cancelada_por") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_os_fk" FOREIGN KEY ("tenant_id","os_id") REFERENCES "public"."ordens_servico"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_caixa_fk" FOREIGN KEY ("tenant_id","caixa_id") REFERENCES "public"."caixas"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_recebido_por_fk" FOREIGN KEY ("tenant_id","recebido_por") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_estornado_por_fk" FOREIGN KEY ("tenant_id","estornado_por") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "caixas_um_aberto_uq" ON "caixas" USING btree ("tenant_id") WHERE "caixas"."status" = 'aberto';--> statement-breakpoint
CREATE INDEX "despesas_tenant_categoria_idx" ON "despesas" USING btree ("tenant_id","categoria_id");--> statement-breakpoint
CREATE INDEX "despesas_tenant_caixa_idx" ON "despesas" USING btree ("tenant_id","caixa_id");--> statement-breakpoint
CREATE INDEX "pagamentos_tenant_os_idx" ON "pagamentos" USING btree ("tenant_id","os_id");--> statement-breakpoint
CREATE INDEX "pagamentos_tenant_caixa_idx" ON "pagamentos" USING btree ("tenant_id","caixa_id");--> statement-breakpoint
-- categorias padrão para tenants existentes (lista em src/modules/despesas/categorias-padrao.ts)
INSERT INTO "categorias_despesa" ("tenant_id", "nome", "sistema")
SELECT t."id", c."nome", c."sistema" FROM "lava_jatos" t
CROSS JOIN (VALUES ('Produtos', false), ('Água e luz', false), ('Aluguel', false), ('Vales', false), ('Outros', false), ('Comissões', true)) AS c("nome", "sistema");--> statement-breakpoint
-- dinheiro não se apaga: corrige-se por estorno ou cancelamento (a role não existe em todo ambiente)
DO $$ BEGIN
  IF EXISTS (select 1 from pg_roles where rolname = 'lavaos_app') THEN
    REVOKE DELETE ON "caixas", "pagamentos", "despesas", "categorias_despesa" FROM lavaos_app;
  END IF;
END $$;
