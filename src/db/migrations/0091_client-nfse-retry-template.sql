-- "Tentar de novo" relê os dados fiscais da empresa na nota com erro: o modelo
-- congelado no pedido passa a poder ser regravado. Valor e descrição, não.
GRANT UPDATE ("template") ON "client_nfse_invoices" TO guilda_app;
