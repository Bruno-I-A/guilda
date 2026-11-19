-- A migração 0103 gravou duas barras no padrão POSIX, o que validava uma
-- barra literal em vez do sinal + de um número E.164.
ALTER TABLE "member_whatsapp_connections"
  DROP CONSTRAINT "member_whatsapp_connections_phone_check";--> statement-breakpoint
ALTER TABLE "member_whatsapp_connections"
  ADD CONSTRAINT "member_whatsapp_connections_phone_check"
  CHECK ("phone_e164" ~ '^[+][1-9][0-9]{7,14}$');
