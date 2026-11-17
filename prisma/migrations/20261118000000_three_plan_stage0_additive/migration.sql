-- Migration: 20261118000000_three_plan_stage0_additive
-- Description: Stage 0 (T0.1) purely additive nullable/default columns for three-plan readiness.
-- Safe: Contains ONLY ADD COLUMN statements with defaults or NULLs (no drops, renames, or type changes).
-- NOTE: CollegeUsage.metric is a free String column; emailsSent, scheduledReports, and omrSheets require no schema change.

-- 1. College: Custom quote & grandfathering metadata
ALTER TABLE "College"
  ADD COLUMN IF NOT EXISTS "isCustomQuote" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "customQuoteNotes" TEXT,
  ADD COLUMN IF NOT EXISTS "grandfatheredUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "grandfatherReason" TEXT;

-- 2. CollegeAddon: Lifecycle status (ACTIVE, SUSPENDED_BY_DOWNGRADE, EXPIRED)
ALTER TABLE "CollegeAddon"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- 3. PendingAgentAction: Requesting user RBAC metadata, affected record count & approval diff preview
ALTER TABLE "PendingAgentAction"
  ADD COLUMN IF NOT EXISTS "requestedById" TEXT,
  ADD COLUMN IF NOT EXISTS "requestedByRole" TEXT,
  ADD COLUMN IF NOT EXISTS "affectedRecordsCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "diffPreviewJson" JSONB;
