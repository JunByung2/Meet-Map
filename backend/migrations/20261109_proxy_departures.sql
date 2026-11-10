-- Supabase SQL Editor에서 코드 적용 전에 한 번 실행하세요.
ALTER TABLE public.meeting_place_departures
ADD COLUMN IF NOT EXISTS updated_by BIGINT;
-- 기존 입력은 작성자 기록이 없어 NULL로 유지합니다.
