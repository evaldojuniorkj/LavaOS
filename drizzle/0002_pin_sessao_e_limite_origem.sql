CREATE TABLE "tentativas_pin_origem" (
	"tenant_id" uuid NOT NULL,
	"ip" text NOT NULL,
	"janela_inicio" timestamp with time zone NOT NULL,
	"tentativas" integer NOT NULL,
	CONSTRAINT "tentativas_pin_origem_pk" PRIMARY KEY("tenant_id","ip")
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "pin_member_id" uuid;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "pin_credential_version" integer;--> statement-breakpoint
ALTER TABLE "tentativas_pin_origem" ADD CONSTRAINT "tentativas_pin_origem_tenant_id_lava_jatos_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."lava_jatos"("id") ON DELETE cascade ON UPDATE no action;