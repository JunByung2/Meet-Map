-- Supabase SQL Editor에서 한 번 실행. 기존 테이블/데이터는 수정하지 않는다.
BEGIN;
CREATE TABLE IF NOT EXISTS public.meeting_place_plans (
  id VARCHAR(36) PRIMARY KEY,
  group_id BIGINT NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  created_by BIGINT NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  result_snapshot VARCHAR(64),
  result JSON
);
CREATE INDEX IF NOT EXISTS ix_meeting_place_plans_group ON public.meeting_place_plans(group_id);
CREATE TABLE IF NOT EXISTS public.meeting_place_departures (
  plan_id VARCHAR(36) NOT NULL REFERENCES public.meeting_place_plans(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  place_id VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  address VARCHAR(500) NOT NULL DEFAULT '',
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, user_id)
);
-- 기존 FastAPI의 DATABASE_URL로만 접근. 브라우저의 직접 DB 접근은 차단.
ALTER TABLE public.meeting_place_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_place_departures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meeting_place_plans FROM anon, authenticated;
REVOKE ALL ON public.meeting_place_departures FROM anon, authenticated;
COMMIT;
