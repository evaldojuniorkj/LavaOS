CREATE TABLE "portes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"ordem" integer DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portes_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "precos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"servico_id" uuid NOT NULL,
	"porte_id" uuid NOT NULL,
	"valor_centavos" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "precos_servico_porte_uq" UNIQUE("servico_id","porte_id"),
	CONSTRAINT "precos_valor_ck" CHECK ("precos"."valor_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "servicos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"descricao" text,
	"duracao_estimada_min" integer,
	"ativo" boolean DEFAULT true NOT NULL,
	"adicional" boolean DEFAULT false NOT NULL,
	"comissao_tipo" text NOT NULL,
	"comissao_valor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "servicos_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "servicos_duracao_ck" CHECK ("servicos"."duracao_estimada_min" is null or "servicos"."duracao_estimada_min" > 0),
	CONSTRAINT "servicos_comissao_ck" CHECK ((("servicos"."comissao_tipo" = 'percentual' and "servicos"."comissao_valor" between 0 and 10000) or ("servicos"."comissao_tipo" = 'fixo' and "servicos"."comissao_valor" >= 0)))
);
--> statement-breakpoint
CREATE TABLE "clientes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"telefone" text,
	"observacoes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clientes_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "veiculos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"placa" text NOT NULL,
	"modelo" text,
	"cor" text,
	"porte_id" uuid NOT NULL,
	"cliente_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "veiculos_tenant_placa_uq" UNIQUE("tenant_id","placa"),
	CONSTRAINT "veiculos_tenant_id_uq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "ordens_servico" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"numero" integer NOT NULL,
	"veiculo_id" uuid NOT NULL,
	"cliente_id" uuid,
	"responsavel_id" uuid,
	"atribuido_em" timestamp with time zone,
	"status" text DEFAULT 'aguardando' NOT NULL,
	"subtotal_centavos" integer DEFAULT 0 NOT NULL,
	"desconto_centavos" integer DEFAULT 0 NOT NULL,
	"acrescimo_centavos" integer DEFAULT 0 NOT NULL,
	"total_centavos" integer DEFAULT 0 NOT NULL,
	"token_publico" text NOT NULL,
	"aberta_por" uuid NOT NULL,
	"observacoes" text,
	"motivo_cancelamento" text,
	"entrada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"inicio_lavagem_em" timestamp with time zone,
	"pronto_em" timestamp with time zone,
	"entregue_em" timestamp with time zone,
	"cancelada_em" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ordens_servico_token_publico_unique" UNIQUE("token_publico"),
	CONSTRAINT "os_tenant_numero_uq" UNIQUE("tenant_id","numero"),
	CONSTRAINT "os_tenant_id_uq" UNIQUE("tenant_id","id"),
	CONSTRAINT "os_status_ck" CHECK ("ordens_servico"."status" in ('aguardando','em_lavagem','pronto','entregue','cancelada')),
	CONSTRAINT "os_valores_ck" CHECK ("ordens_servico"."subtotal_centavos" >= 0 and "ordens_servico"."desconto_centavos" >= 0 and "ordens_servico"."acrescimo_centavos" >= 0 and "ordens_servico"."total_centavos" >= 0)
);
--> statement-breakpoint
CREATE TABLE "os_contadores" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"ultimo" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "os_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"os_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"de" text,
	"para" text,
	"membro_id" uuid NOT NULL,
	"motivo" text,
	"em" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "os_eventos_tipo_ck" CHECK ("os_eventos"."tipo" in ('status','responsavel','itens','valor'))
);
--> statement-breakpoint
CREATE TABLE "os_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"os_id" uuid NOT NULL,
	"servico_id" uuid NOT NULL,
	"porte_id" uuid NOT NULL,
	"nome_servico" text NOT NULL,
	"valor_centavos" integer NOT NULL,
	"comissao_tipo" text NOT NULL,
	"comissao_valor" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "os_itens_valor_ck" CHECK ("os_itens"."valor_centavos" >= 0),
	CONSTRAINT "os_itens_comissao_ck" CHECK ((("os_itens"."comissao_tipo" = 'percentual' and "os_itens"."comissao_valor" between 0 and 10000) or ("os_itens"."comissao_tipo" = 'fixo' and "os_itens"."comissao_valor" >= 0)))
);
--> statement-breakpoint
ALTER TABLE "portes" ADD CONSTRAINT "portes_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos" ADD CONSTRAINT "precos_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos" ADD CONSTRAINT "precos_servico_fk" FOREIGN KEY ("tenant_id","servico_id") REFERENCES "public"."servicos"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precos" ADD CONSTRAINT "precos_porte_fk" FOREIGN KEY ("tenant_id","porte_id") REFERENCES "public"."portes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servicos" ADD CONSTRAINT "servicos_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_porte_fk" FOREIGN KEY ("tenant_id","porte_id") REFERENCES "public"."portes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "veiculos" ADD CONSTRAINT "veiculos_cliente_fk" FOREIGN KEY ("tenant_id","cliente_id") REFERENCES "public"."clientes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "ordens_servico_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "os_veiculo_fk" FOREIGN KEY ("tenant_id","veiculo_id") REFERENCES "public"."veiculos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "os_cliente_fk" FOREIGN KEY ("tenant_id","cliente_id") REFERENCES "public"."clientes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "os_responsavel_fk" FOREIGN KEY ("tenant_id","responsavel_id") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ordens_servico" ADD CONSTRAINT "os_aberta_por_fk" FOREIGN KEY ("tenant_id","aberta_por") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_contadores" ADD CONSTRAINT "os_contadores_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_eventos" ADD CONSTRAINT "os_eventos_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_eventos" ADD CONSTRAINT "os_eventos_os_fk" FOREIGN KEY ("tenant_id","os_id") REFERENCES "public"."ordens_servico"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_eventos" ADD CONSTRAINT "os_eventos_membro_fk" FOREIGN KEY ("tenant_id","membro_id") REFERENCES "public"."membros"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_os_fk" FOREIGN KEY ("tenant_id","os_id") REFERENCES "public"."ordens_servico"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_servico_fk" FOREIGN KEY ("tenant_id","servico_id") REFERENCES "public"."servicos"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "os_itens" ADD CONSTRAINT "os_itens_porte_fk" FOREIGN KEY ("tenant_id","porte_id") REFERENCES "public"."portes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "precos_tenant_porte_idx" ON "precos" USING btree ("tenant_id","porte_id");--> statement-breakpoint
CREATE INDEX "veiculos_tenant_porte_idx" ON "veiculos" USING btree ("tenant_id","porte_id");--> statement-breakpoint
CREATE INDEX "veiculos_tenant_cliente_idx" ON "veiculos" USING btree ("tenant_id","cliente_id");--> statement-breakpoint
CREATE INDEX "os_tenant_status_idx" ON "ordens_servico" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "os_tenant_veiculo_idx" ON "ordens_servico" USING btree ("tenant_id","veiculo_id");--> statement-breakpoint
CREATE INDEX "os_tenant_cliente_idx" ON "ordens_servico" USING btree ("tenant_id","cliente_id");--> statement-breakpoint
CREATE INDEX "os_tenant_responsavel_idx" ON "ordens_servico" USING btree ("tenant_id","responsavel_id");--> statement-breakpoint
CREATE INDEX "os_tenant_aberta_por_idx" ON "ordens_servico" USING btree ("tenant_id","aberta_por");--> statement-breakpoint
CREATE INDEX "os_eventos_tenant_os_idx" ON "os_eventos" USING btree ("tenant_id","os_id");--> statement-breakpoint
CREATE INDEX "os_eventos_tenant_membro_idx" ON "os_eventos" USING btree ("tenant_id","membro_id");--> statement-breakpoint
CREATE INDEX "os_itens_tenant_os_idx" ON "os_itens" USING btree ("tenant_id","os_id");--> statement-breakpoint
CREATE INDEX "os_itens_tenant_servico_idx" ON "os_itens" USING btree ("tenant_id","servico_id");--> statement-breakpoint
CREATE INDEX "os_itens_tenant_porte_idx" ON "os_itens" USING btree ("tenant_id","porte_id");