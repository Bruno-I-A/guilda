-- Nome do contato dado pela equipe (2026-11-24, pedido do Bruno). Escrita a mao, como a 0103 a 0110.
-- display_name e o do perfil do WhatsApp, que a Meta reescreve a cada mensagem;
-- custom_name e o da equipe e vence na tela. O guilda_app ja atualiza support_contacts.
ALTER TABLE "support_contacts" ADD COLUMN "custom_name" varchar(80);--> statement-breakpoint
ALTER TYPE "public"."support_conversation_event_type" ADD VALUE IF NOT EXISTS 'contact_renamed';
