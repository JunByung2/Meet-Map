# 사진 · 추억지도 기능 (다현) — 그룹별 사진 + 장소 + 추억지도

팀장 코드의 로그인(세션 쿠키)·그룹 멤버 확인을 그대로 쓰고, 사진만 그룹 안에 붙였어요.

## 한눈에 보기
- 사진 올리기 → **어디에서 찍었나요?**에서 카카오 장소 검색으로 장소 선택(선택 사항) → 사진과 함께 DB에 저장
- 사이드바 **지도** → 추억지도: 장소 마커를 누르면 그 장소의 사진 + 기록 카드가 나와요
- 지도 담당(종은)의 `BaseKakaoMap` / `KakaoMap` 을 같이 합쳤어요. 멤버 출발지는 임시 멤버 1~5 대신 **로그인한 그룹의 실제 멤버**로 바꿨어요. (`/groups/{id}/map/departures`)
- 약속 연결은 화면 모양만 있고 기능은 아직 없어요.

## 구조
```
브라우저 ──(로그인 쿠키)──> Next.js /api ──> FastAPI ──> Postgres(group_photos 표)
                                              └──> Supabase Storage (비공개 버킷 memory-photos)
```
- 브라우저는 Supabase에 직접 접속하지 않아요. (anon key 필요 없음)
- 서버가 `service_role` 키로만 Storage에 접근하고, 모든 사진 API는 `require_group_member`(그룹 멤버만)를 거쳐요.
- 올린 사람 또는 방장만 수정/삭제할 수 있어요.
- 사진은 볼 때만 30분짜리 임시 주소(signed URL)로 불러와요.
- Storage 경로: `groups/{group_id}/photos/{uuid}/original.{확장자}`

## 새로 추가된 파일 / 바뀐 파일
```
backend/app/storage.py              Supabase Storage 호출 (업로드·삭제·임시주소)
backend/app/routers/photos.py       사진 API (/groups/{id}/photos ...)
backend/app/models.py               + Photo 모델 (표 이름 group_photos)
backend/app/config.py               + SUPABASE_URL / SUPABASE_SERVICE_KEY 등
backend/app/main.py                 photos 라우터 등록, 없는 표 자동 생성
backend/requirements.txt, .env.example
frontend/src/app/groups/[id]/photos/page.tsx            그룹 사진 갤러리
frontend/src/app/groups/[id]/photos/upload/page.tsx     사진 올리기
frontend/src/app/groups/[id]/photos/[photoId]/page.tsx  사진 상세
frontend/src/components/{PhotoShell,PhotoCollage}.tsx, photos.css
frontend/src/lib/photos.ts
frontend/src/components/AppShell.tsx   사이드바 "사진" 메뉴 활성화 (사진 → 해당 그룹 사진)
frontend/src/lib/api.ts                FormData(사진 업로드) 지원
frontend/src/app/page.tsx              / 접속 시 /groups 로 이동
```

## 새로 추가된 것 (지도 / 장소)
```
backend/app/models.py             group_photos 에 place_id, place_name, place_address, place_lat, place_lng 추가
backend/app/routers/photos.py     업로드/수정에 장소 포함
backend/app/main.py               서버 시작 시 group_photos 에 장소 컬럼이 없으면 자동으로 추가(ALTER ... IF NOT EXISTS)
frontend/src/lib/kakao.ts         카카오 SDK 한 번만 불러오기 + 장소 검색
frontend/src/lib/usePlaceSearch.ts  장소 검색창 공통 로직
frontend/src/components/BaseKakaoMap.tsx   공통 지도 (종은 코드 + 이름표/확대 옵션)
frontend/src/components/KakaoMap.tsx       장소 검색 + 지도 (종은 코드)
frontend/src/components/PlacePicker.tsx    사진 올리기/상세의 "어디에서 찍었나요?"
frontend/src/components/maps.css
frontend/src/app/groups/[id]/map/page.tsx              추억지도
frontend/src/app/groups/[id]/map/departures/page.tsx   멤버 출발지 (실제 그룹 멤버)
frontend/.env.example             NEXT_PUBLIC_KAKAO_JS_KEY 안내
```
장소 컬럼을 직접 추가하고 싶다면 (서버가 자동으로 해주지만 참고용):
```sql
alter table group_photos add column if not exists place_id varchar(40);
alter table group_photos add column if not exists place_name varchar(100);
alter table group_photos add column if not exists place_address varchar(200);
alter table group_photos add column if not exists place_lat double precision;
alter table group_photos add column if not exists place_lng double precision;
```

## 카카오 지도 키 (프론트)
`frontend/.env.local` 파일을 만들고 한 줄만 넣어요. (파일 이름 앞의 점 주의, 넣은 뒤 `npm run dev` 다시 실행)
```
NEXT_PUBLIC_KAKAO_JS_KEY=지도담당이_준_JavaScript_키
```
카카오 개발자 콘솔의 Web 플랫폼에 `http://localhost:3000` 이 등록되어 있어야 지도가 떠요.
키가 없으면 지도/장소 검색 자리에 안내 문구가 나오고, 사진 올리기는 장소 없이도 그대로 돼요.

## 실행 방법
1. **Supabase Storage** (이미 만들었으면 확인만)
   - 버킷 이름 `memory-photos`, **Public 끄기(비공개)**, 파일 크기 제한 20MB, 허용 형식 jpeg/png/webp/heic
2. **backend/.env** 만들기 (`.env.example` 복사)
   - `DATABASE_URL`, `ALLOW_DEV_AUTH=true`(개발용)
   - `SUPABASE_URL` = 프로젝트 URL, `SUPABASE_SERVICE_KEY` = service_role 키 (서버 전용 비밀키! 깃·보고서·카톡에 올리지 마세요)
3. **백엔드**
   ```
   cd backend
   pip install -r requirements.txt
   set "SEED_PASSWORD=원하는비밀번호"   (8자 이상)
   python scripts_seed_dev.py          (더미 팀원 6명 + 그룹 "중부대 친구들")
   python -m uvicorn app.main:app --reload --port 8000
   ```
   서버를 켜면 `group_photos` 표가 자동으로 만들어져요. (기존 표는 건드리지 않아요)
4. **프론트**
   ```
   cd frontend
   npm install
   npm run dev
   ```
5. http://localhost:3000 → 로그인 (예: `dahyun@example.com` / SEED_PASSWORD) → 그룹 선택 → 왼쪽 **사진**

## 예전 개발용 설정은 지워도 돼요 (보안)
이제 브라우저가 Supabase에 직접 안 붙으니, 예전에 만든 anon 허용 정책은 삭제하세요. (Supabase SQL Editor)
```sql
-- DEV_NO_AUTH_POLICIES.sql 로 만들었던 정책 삭제 (이름은 Storage/Table 정책 목록에서 확인)
-- 예) drop policy "이름" on storage.objects;
--     drop policy "이름" on public.photos;
```
그리고 `.env.local`의 NEXT_PUBLIC_SUPABASE_* / NEXT_PUBLIC_MEETMAP_* 값은 더 이상 필요 없어요.
(채팅·보고서 등에 붙여넣었던 키는 Supabase에서 재발급을 추천해요.)

## 사진 제한 (서버가 다시 검사)
- 한 번에 최대 20장, 장당 20MB, jpg/jpeg/png/webp/heic만 (파일 내용도 확인해서 확장자만 바꾼 가짜 파일은 거부)
- 여러 장 업로드 중 하나라도 실패하면 이번에 올린 것 전부 취소(반쪽짜리 묶음 방지)
- 한 번에 올린 사진은 `batch_id`로 묶여 갤러리에서 콜라주 한 장으로 보여요
