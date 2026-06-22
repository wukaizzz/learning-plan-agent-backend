CREATE TABLE IF NOT EXISTS public.plan_change_sets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL,
  source_plan_id TEXT NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  source_plan_version INTEGER NOT NULL CHECK (source_plan_version > 0),
  type TEXT NOT NULL CHECK (type IN ('reschedule')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected', 'expired', 'invalidated')),
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  impact JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation JSONB NOT NULL DEFAULT '{}'::jsonb,
  proposed_tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at_ms BIGINT NOT NULL,
  result_plan_id TEXT REFERENCES public.plans(id) ON DELETE SET NULL,
  apply_idempotency_key TEXT,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  applied_at_ms BIGINT
);

CREATE INDEX IF NOT EXISTS idx_plan_change_sets_user_space
ON public.plan_change_sets(user_id, space_id, created_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_plan_change_sets_pending
ON public.plan_change_sets(user_id, space_id, expires_at_ms DESC)
WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_change_sets_user_idempotency
ON public.plan_change_sets(user_id, apply_idempotency_key)
WHERE apply_idempotency_key IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'study_agent_dev') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plan_change_sets TO study_agent_dev;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'study_agent_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.plan_change_sets TO study_agent_user;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'study_agent_readonly') THEN
    GRANT SELECT ON TABLE public.plan_change_sets TO study_agent_readonly;
  END IF;
END $$;
