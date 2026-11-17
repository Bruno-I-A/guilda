-- Revisão de segurança de 2026-11-16: a limpeza da virada para a base real
-- (0063/0064) já foi usada e nenhum código a chama mais. Ela apagava tudo de
-- uma organização, inclusive o ledger de XP, que é imutável para o guilda_app
-- (UPDATE/DELETE revogados): rodando como dono, a função furava essa trava.
-- Executável pelo guilda_app, era um botão de apagar a base a uma injeção de
-- distância. Não mexe em dado nenhum; só remove a função.
DROP FUNCTION IF EXISTS public.reset_org_operational_data_for_launch(text);
