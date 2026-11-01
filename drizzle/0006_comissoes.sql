-- antes das FKs compostas que apontam para o item da OS
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_tenant_id_uq" UNIQUE("tenant_id","id");--> statement-breakpoint
CREATE TABLE "acertos_comissao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membro_id" uuid NOT NULL,
	"periodo_inicio" date NOT NULL,
	"periodo_fim" date NOT NULL,
	"comissoes_centavos" integer NOT NULL,
	"vales_centavos" integer NOT NULL,
	"saldo_anterior_centavos" integer NOT NULL,
	"pago_centavos" integer NOT NULL,
	"saldo_devedor_centavos" integer NOT NULL,
	"despesa_id" uuid,
	"pago_em" timestamp with time zone DEFAULT now() NOT NULL,
	"pago_por" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acertos_comissao_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "acertos_comissao_valores_ck" CHECK ("acertos_comissao"."comissoes_centavos" >= 0 and "acertos_comissao"."vales_centavos" >= 0 and "acertos_comissao"."saldo_anterior_centavos" >= 0 and "acertos_comissao"."pago_centavos" >= 0 and "acertos_comissao"."saldo_devedor_centavos" >= 0),
	CONSTRAINT "acertos_comissao_conta_ck" CHECK ("acertos_comissao"."pago_centavos" = greatest(0, "acertos_comissao"."comissoes_centavos" - "acertos_comissao"."vales_centavos" - "acertos_comissao"."saldo_anterior_centavos") and "acertos_comissao"."saldo_devedor_centavos" = greatest(0, "acertos_comissao"."vales_centavos" + "acertos_comissao"."saldo_anterior_centavos" - "acertos_comissao"."comissoes_centavos")),
	CONSTRAINT "acertos_comissao_despesa_ck" CHECK (("acertos_comissao"."pago_centavos" = 0) = ("acertos_comissao"."despesa_id" is null))
);
--> statement-breakpoint
CREATE TABLE "comissoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"os_id" uuid NOT NULL,
	"os_item_id" uuid NOT NULL,
	"membro_id" uuid NOT NULL,
	"base_centavos" integer NOT NULL,
	"valor_centavos" integer NOT NULL,
	"acerto_id" uuid,
	"gerada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comissoes_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "comissoes_tenant_item_uq" UNIQUE("tenant_id","os_item_id"),
	CONSTRAINT "comissoes_valores_ck" CHECK ("comissoes"."base_centavos" >= 0 and "comissoes"."valor_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "vales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membro_id" uuid NOT NULL,
	"valor_centavos" integer NOT NULL,
	"dado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"dado_por" uuid NOT NULL,
	"despesa_id" uuid NOT NULL,
	"acerto_id" uuid,
	"cancelado_em" timestamp with time zone,
	"cancelado_por" uuid,
	"motivo_cancelamento" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vales_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "vales_valor_ck" CHECK ("vales"."valor_centavos" > 0),
	CONSTRAINT "vales_cancelamento_ck" CHECK (("vales"."cancelado_em" is null and "vales"."cancelado_por" is null and "vales"."motivo_cancelamento" is null) or ("vales"."cancelado_em" is not null and "vales"."cancelado_por" is not null and "vales"."motivo_cancelamento" is not null))
);
--> statement-breakpoint
ALTER TABLE "acertos_comissao" ADD CONSTRAINT "acertos_comissao_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acertos_comissao" ADD CONSTRAINT "acertos_comissao_membro_fk" FOREIGN KEY ("tenant_id","membro_id") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acertos_comissao" ADD CONSTRAINT "acertos_comissao_pago_por_fk" FOREIGN KEY ("tenant_id","pago_por") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "acertos_comissao" ADD CONSTRAINT "acertos_comissao_despesa_fk" FOREIGN KEY ("tenant_id","despesa_id") REFERENCES "public"."despesas"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_os_fk" FOREIGN KEY ("tenant_id","os_id") REFERENCES "public"."ordens_servico"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_os_item_fk" FOREIGN KEY ("tenant_id","os_item_id") REFERENCES "public"."os_itens"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_membro_fk" FOREIGN KEY ("tenant_id","membro_id") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_acerto_fk" FOREIGN KEY ("tenant_id","acerto_id") REFERENCES "public"."acertos_comissao"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vales" ADD CONSTRAINT "vales_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vales" ADD CONSTRAINT "vales_membro_fk" FOREIGN KEY ("tenant_id","membro_id") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vales" ADD CONSTRAINT "vales_dado_por_fk" FOREIGN KEY ("tenant_id","dado_por") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vales" ADD CONSTRAINT "vales_cancelado_por_fk" FOREIGN KEY ("tenant_id","cancelado_por") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vales" ADD CONSTRAINT "vales_despesa_fk" FOREIGN KEY ("tenant_id","despesa_id") REFERENCES "public"."despesas"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vales" ADD CONSTRAINT "vales_acerto_fk" FOREIGN KEY ("tenant_id","acerto_id") REFERENCES "public"."acertos_comissao"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "acertos_comissao_tenant_membro_idx" ON "acertos_comissao" USING btree ("tenant_id","membro_id");--> statement-breakpoint
CREATE INDEX "comissoes_tenant_membro_acerto_idx" ON "comissoes" USING btree ("tenant_id","membro_id","acerto_id");--> statement-breakpoint
CREATE INDEX "comissoes_tenant_os_idx" ON "comissoes" USING btree ("tenant_id","os_id");--> statement-breakpoint
CREATE INDEX "vales_tenant_membro_acerto_idx" ON "vales" USING btree ("tenant_id","membro_id","acerto_id");--> statement-breakpoint
-- vale e acerto são dinheiro: corrige-se por cancelamento; comissões são derivadas e saem na reabertura (a role não existe em todo ambiente)
DO $$ BEGIN
  IF EXISTS (select 1 from pg_roles where rolname = 'lavaos_app') THEN
    REVOKE DELETE ON "vales", "acertos_comissao" FROM lavaos_app;
  END IF;
END $$;
