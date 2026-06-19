CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  email TEXT UNIQUE,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL
);

INSERT INTO public.users (id, display_name, email, created_at_ms, updated_at_ms)
VALUES (
  'default-user',
  'Default User',
  'default-user@example.local',
  floor(extract(epoch from clock_timestamp()) * 1000)::BIGINT,
  floor(extract(epoch from clock_timestamp()) * 1000)::BIGINT
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  version INTEGER NOT NULL CHECK (version > 0),
  source_session_id TEXT,
  source_message_id TEXT,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plans_user_id ON public.plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plans_user_space ON public.plans(user_id, space_id);
CREATE INDEX IF NOT EXISTS idx_plans_user_space_updated ON public.plans(user_id, space_id, updated_at_ms DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_one_current_per_user_space
ON public.plans(user_id, space_id)
WHERE status <> 'archived';

CREATE TABLE IF NOT EXISTS public.tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  title TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('study', 'practice', 'review')),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'failed')),
  estimated_minutes INTEGER NOT NULL,
  scheduled_date TEXT NOT NULL,
  group_label TEXT,
  estimated_time TEXT,
  dependencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at_ms BIGINT,
  updated_at_ms BIGINT
);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON public.tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_plan_id ON public.tasks(plan_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_space ON public.tasks(user_id, space_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_space_status ON public.tasks(user_id, space_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_plan_scheduled_order ON public.tasks(plan_id, scheduled_date, sort_order);

CREATE TABLE IF NOT EXISTS public.plan_blocks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES public.plans(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  task_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at_ms BIGINT,
  updated_at_ms BIGINT
);

CREATE INDEX IF NOT EXISTS idx_plan_blocks_user_id ON public.plan_blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_blocks_plan_id ON public.plan_blocks(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_blocks_user_space ON public.plan_blocks(user_id, space_id);
CREATE INDEX IF NOT EXISTS idx_plan_blocks_plan_order ON public.plan_blocks(plan_id, sort_order);

CREATE TABLE IF NOT EXISTS public.agent_executions (
  execution_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL,
  session_id TEXT,
  message_id TEXT,
  title TEXT,
  status TEXT CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary TEXT,
  raw_execution JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at_ms BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_executions_user_id ON public.agent_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_user_space ON public.agent_executions(user_id, space_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_session_id ON public.agent_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_message_id ON public.agent_executions(message_id);
CREATE INDEX IF NOT EXISTS idx_agent_executions_user_space_updated
ON public.agent_executions(user_id, space_id, updated_at_ms DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'study_agent_user') THEN
    GRANT USAGE ON SCHEMA public TO study_agent_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.users,
      public.plans,
      public.tasks,
      public.plan_blocks,
      public.agent_executions
    TO study_agent_user;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'study_agent_readonly') THEN
    GRANT USAGE ON SCHEMA public TO study_agent_readonly;
    GRANT SELECT ON TABLE
      public.users,
      public.plans,
      public.tasks,
      public.plan_blocks,
      public.agent_executions
    TO study_agent_readonly;
  END IF;
END $$;
