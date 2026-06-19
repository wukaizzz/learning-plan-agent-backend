CREATE TABLE IF NOT EXISTS public.study_spaces (
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  goal JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(goal) = 'object'),
  subjects JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(subjects) = 'array'),
  schedule JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(schedule) = 'object'),
  status TEXT NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning', 'active', 'paused', 'completed')),
  current_phase TEXT NOT NULL DEFAULT '准备阶段',
  stats JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(stats) = 'object'),
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  last_active_at_ms BIGINT NOT NULL,
  is_placeholder BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at_ms BIGINT,
  deletion_scheduled_at_ms BIGINT,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_study_spaces_user_id
ON public.study_spaces(user_id);
CREATE INDEX IF NOT EXISTS idx_study_spaces_user_deleted_active
ON public.study_spaces(user_id, is_deleted, last_active_at_ms DESC);
CREATE INDEX IF NOT EXISTS idx_study_spaces_user_updated
ON public.study_spaces(user_id, updated_at_ms DESC);

INSERT INTO public.study_spaces (
  id, user_id, name, description, color, goal, subjects, schedule,
  status, current_phase, stats, created_at_ms, updated_at_ms, last_active_at_ms,
  is_placeholder
)
SELECT
  existing.space_id,
  existing.user_id,
  'Imported space ' || existing.space_id,
  '',
  '#3b82f6',
  '{}'::jsonb,
  '[]'::jsonb,
  '{}'::jsonb,
  'active',
  '准备阶段',
  '{}'::jsonb,
  existing.timestamp_ms,
  existing.timestamp_ms,
  existing.timestamp_ms,
  true
FROM (
  SELECT user_id, space_id, min(timestamp_ms) AS timestamp_ms
  FROM (
    SELECT user_id, space_id, created_at_ms AS timestamp_ms
    FROM public.plans
    UNION ALL
    SELECT user_id, space_id, updated_at_ms AS timestamp_ms
    FROM public.agent_executions
  ) AS sources
  GROUP BY user_id, space_id
) AS existing
ON CONFLICT (user_id, id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'plans_user_space_fkey'
      AND conrelid = 'public.plans'::regclass
  ) THEN
    ALTER TABLE public.plans
      ADD CONSTRAINT plans_user_space_fkey
      FOREIGN KEY (user_id, space_id)
      REFERENCES public.study_spaces(user_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_executions_user_space_fkey'
      AND conrelid = 'public.agent_executions'::regclass
  ) THEN
    ALTER TABLE public.agent_executions
      ADD CONSTRAINT agent_executions_user_space_fkey
      FOREIGN KEY (user_id, space_id)
      REFERENCES public.study_spaces(user_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  space_id TEXT,
  title TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, space_id)
    REFERENCES public.study_spaces(user_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id
ON public.chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_space_updated
ON public.chat_sessions(user_id, space_id, updated_at_ms DESC);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL DEFAULT '',
  timestamp_ms BIGINT NOT NULL,
  tool_calls JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(tool_calls) = 'array'),
  ui_blocks JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(ui_blocks) = 'array'),
  submitted_form_summary JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(submitted_form_summary) = 'array'),
  form_submission_state TEXT
    CHECK (form_submission_state IN ('idle', 'submitting', 'submitted')),
  workflow_process_steps JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(workflow_process_steps) = 'array'),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, session_id)
    REFERENCES public.chat_sessions(user_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id
ON public.chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_timestamp
ON public.chat_messages(user_id, session_id, timestamp_ms, id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'study_agent_dev') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.study_spaces,
      public.chat_sessions,
      public.chat_messages
    TO study_agent_dev;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'study_agent_user') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.study_spaces,
      public.chat_sessions,
      public.chat_messages
    TO study_agent_user;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'study_agent_readonly') THEN
    GRANT SELECT ON TABLE
      public.study_spaces,
      public.chat_sessions,
      public.chat_messages
    TO study_agent_readonly;
  END IF;
END $$;
