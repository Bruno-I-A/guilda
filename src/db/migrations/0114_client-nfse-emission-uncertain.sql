-- E0014 troca a serie sozinho quando a nota nunca teve envio incerto (2026-11-25). Escrita a mao.
-- Uma tentativa que caiu no meio (rede, tempo esgotado) pode ter emitido a nota; so nela a Guilda
-- ainda pede a conferencia antes de usar outro numero de DPS.
ALTER TABLE "client_nfse_invoices" ADD COLUMN "emission_uncertain" boolean DEFAULT false NOT NULL;--> statement-breakpoint
GRANT UPDATE ("emission_uncertain") ON "client_nfse_invoices" TO guilda_app;
