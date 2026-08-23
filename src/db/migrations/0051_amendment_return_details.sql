ALTER TABLE "company_flows"
  ADD COLUMN "approved_tax_regime" "tax_regime",
  ADD COLUMN "approved_address" text,
  ADD COLUMN "approved_qsa" jsonb NOT NULL DEFAULT '[]'::jsonb;
