ALTER TABLE "company_flows"
  ADD COLUMN "removed_activities" jsonb NOT NULL DEFAULT '[]'::jsonb;
