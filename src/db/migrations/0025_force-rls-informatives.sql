-- `informatives` nasceu como `telegram_ai_drafts` (migration 0019), que
-- habilitou RLS mas nunca aplicou FORCE. As tabelas irmas criadas na 0023
-- (guild_notices, guild_notice_reads, task_assignee_suggestions) forcam.
-- Sem FORCE, o OWNER da tabela ignora a politica; a aplicacao conecta como
-- guilda_app (nao-owner) e ja era isolada, entao isto e defesa em
-- profundidade, alinhando a tabela ao padrao das demais desta feature.
ALTER TABLE "informatives" FORCE ROW LEVEL SECURITY;
