-- Aviso do Atendimento (2026-11-19): a fila de avisos por WhatsApp aceita uma
-- conversa do Atendimento no lugar do Fluxo, para avisar o cla quando o agente
-- encaminha. Escrita a mao, como a 0103 a 0105.
ALTER TABLE "member_whatsapp_outbox" ALTER COLUMN "company_flow_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "member_whatsapp_outbox" ADD COLUMN "support_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "member_whatsapp_outbox" ADD CONSTRAINT "member_whatsapp_outbox_org_support_conversation_fk" FOREIGN KEY ("org_id","support_conversation_id") REFERENCES "public"."support_conversations"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_whatsapp_outbox" ADD CONSTRAINT "member_whatsapp_outbox_origin_check" CHECK (num_nonnulls("company_flow_id", "support_conversation_id") = 1);
