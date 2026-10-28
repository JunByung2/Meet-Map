"use client";

import { useState, type CSSProperties } from 'react'
import BaseKakaoMap, { type MapPlace } from '@/features/map/BaseKakaoMap'
import {
  SHARE_MINUTES,
  useLocationShare,
  type ShareMode,
} from '@/hooks/useLocationShare'
import { pickName, useNameMode } from '@/lib/nameMode'

type Meet = ReturnType<typeof useLocationShare>;

const ACCENT = '#3f7d6e'

// 옆으로 넘기는 카드 줄
const rail: CSSProperties = {
  display: 'flex',
  gap: 12,
  overflowX: 'auto',
  scrollSnapType: 'x mandatory',
  padding: '4px 2px 10px',
  margin: '0 -2px',
  WebkitOverflowScrolling: 'touch',
}

// 카드 한 장의 공통 모양 (다음 카드가 살짝 보이도록 폭을 80%로)
const slide: CSSProperties = {
  flex: '0 0 80%',
  maxWidth: 320,
  minHeight: 200,
  scrollSnapAlign: 'start',
  borderRadius: 24,
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  gap: 16,
  boxSizing: 'border-box',
}

const avatar: CSSProperties = {
  width: 48,
  height: 48,
  borderRadius: '50%',
  background: ACCENT,
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 20,
  fontWeight: 700,
  flexShrink: 0,
}

const track: CSSProperties = {
  height: 8,
  borderRadius: 999,
  background: 'rgba(0,0,0,0.08)',
  overflow: 'hidden',
  margin: '10px 0 14px',
}

// 공유 방식 뱃지: 1회 공유(주황) / 10분 공유(초록)
function ModeBadge({ mode }: { mode: ShareMode }) {
  const once = mode === 'once'
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 700,
        color: once ? '#92610f' : ACCENT,
        background: once ? 'rgba(183,121,31,0.14)' : 'rgba(63,125,110,0.14)',
      }}
    >
      {once ? '📍 1회 공유' : `⏱ ${SHARE_MINUTES}분 공유`}
    </span>
  )
}

function ProblemGuide({ meet }: { meet: Meet }) {
  const { problem } = meet;
  if (!problem) return null;

  const retry = (
    <button
      type="button"
      className="btn sm"
      disabled={meet.busy}
      onClick={() => void meet.start()}
    >
      {problem === "denied" ? "허용했어요. 다시 시도" : "다시 시도"}
    </button>
  );

  return (
    <section className="card" role="alert">
      {problem === "denied" && (
        <>
          <h2 className="card-title">위치 권한이 꺼져 있어요</h2>
          <p className="muted">
            설정에서 위치 권한을 허용해 주세요. 웹사이트에서는 권한 팝업을 다시
            띄울 수 없어요.
          </p>
          <ul
            className="muted"
            style={{ margin: "8px 0 12px", paddingLeft: 18 }}
          >
            <li>PC 크롬·엣지: 주소창 왼쪽 자물쇠 → 위치 → 허용</li>
            <li>안드로이드 크롬: 주소창 자물쇠 → 권한 → 위치 허용</li>
            <li>
              아이폰 사파리: 설정 → 개인정보 보호 및 보안 → 위치 서비스 → Safari
              웹사이트 → 허용
            </li>
          </ul>
          <p className="muted">기기마다 메뉴 이름이 조금 다를 수 있어요.</p>
        </>
      )}
      {problem === "unavailable" && (
        <>
          <h2 className="card-title">위치를 확인할 수 없어요</h2>
          <p className="muted">
            GPS와 네트워크 연결을 확인한 뒤 다시 시도해 주세요.
          </p>
        </>
      )}
      {problem === "timeout" && (
        <>
          <h2 className="card-title">위치 확인이 오래 걸려요</h2>
          <p className="muted">
            잠시 뒤 다시 시도해 주세요. 실내에서는 창가로 가면 더 잘 잡혀요.
          </p>
        </>
      )}
      {problem === "unsupported" && (
        <>
          <h2 className="card-title">
            이 브라우저는 위치 기능을 지원하지 않아요
          </h2>
          <p className="muted">다른 브라우저로 열어 주세요.</p>
        </>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {problem !== "unsupported" && retry}
        <button
          type="button"
          className="btn secondary sm"
          onClick={meet.clearProblem}
        >
          닫기
        </button>
      </div>
    </section>
  );
}

export default function MeetModePanel({ meet }: { meet: Meet }) {
  const { mine, others, shares, asking, busy, message, now, mode, setMode } =
    meet
  const [showMap, setShowMap] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const nameMode = useNameMode()

  const left = mine
    ? Math.max(
        0,
        Math.ceil((new Date(mine.expires_at).getTime() - now) / 60000),
      )
    : 0
  const percent = Math.min(100, Math.round((left / SHARE_MINUTES) * 100))

  // 지도에 찍는 점: 서버가 돌려준 대략적인 위치(500m 격자 중심)만 사용한다
  const mapPlaces: MapPlace[] = shares.map((s) => ({
    id: `loc-${s.user_id}`,
    name: `${pickName(s, nameMode) || '알 수 없음'}${s.mine ? ' (나)' : ''} · ${
      s.mode === 'once' ? '1회 공유' : `${SHARE_MINUTES}분 공유`
    }`,
    latitude: s.lat,
    longitude: s.lng,
  }));

  const openMap = (userId?: number) => {
    setSelectedId(userId !== undefined ? `loc-${userId}` : "");
    setShowMap(true);
  };

  return (
    <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}

      <ProblemGuide meet={meet} />

      {asking && !mine && !meet.problem && (
        <section className="card" role="dialog" aria-label="MeetMode 위치 공유">
          <span className="chip">MeetMode · 위치 공유</span>
          <h2 className="card-title" style={{ margin: '8px 0 6px' }}>
            내 위치를 친구들에게 공유할까요?
          </h2>

          <div
            role="radiogroup"
            aria-label="공유 방식"
            style={{ display: 'grid', gap: 8, margin: '12px 0' }}
          >
            {(
              [
                {
                  value: 'once',
                  title: '1회만 공유',
                  desc: `지금 위치를 한 번만 보내요. 갱신 없이 ${SHARE_MINUTES}분 동안 보여요.`,
                },
                {
                  value: 'ten_min',
                  title: `${SHARE_MINUTES}분 동안 공유`,
                  desc: '이동하는 동안 20초마다 위치를 갱신해요.',
                },
              ] as const
            ).map((opt) => {
              const active = mode === opt.value
              return (
                <label
                  key={opt.value}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    padding: '12px 14px',
                    borderRadius: 16,
                    cursor: 'pointer',
                    border: `1.5px solid ${active ? ACCENT : 'rgba(0,0,0,0.12)'}`,
                    background: active
                      ? 'rgba(63,125,110,0.08)'
                      : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="share-mode"
                    value={opt.value}
                    checked={active}
                    onChange={() => setMode(opt.value)}
                    style={{ marginTop: 4 }}
                  />
                  <span>
                    <strong>{opt.title}</strong>
                    <span className="muted" style={{ display: 'block' }}>
                      {opt.desc}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>

          <ul
            className="muted"
            style={{ margin: "8px 0 12px", paddingLeft: 18 }}
          >
            <li>내가 직접 누를 때만 공유돼요. 자동으로 공유되지 않아요.</li>
            <li>이 그룹 친구들에게만, 대략적인 위치(약 500m 범위)로 보여요.</li>
            <li>정확한 위치는 저장하지 않아요.</li>
            <li>공유했다는 알림만 채팅에 남고, 위치 정보는 남지 않아요.</li>
            <li>
              {SHARE_MINUTES}분 뒤에 자동으로 멈추고, 중단하면 바로 사라져요.
            </li>
            <li>동의하면 브라우저가 위치 권한을 한 번 물어봐요.</li>
          </ul>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button
              type="button"
              className="btn sm"
              disabled={busy}
              onClick={() => void meet.start()}
            >
              {busy
                ? '위치 확인 중…'
                : mode === 'once'
                  ? '1회 공유하기'
                  : `${SHARE_MINUTES}분 동안 공유하기`}
            </button>
            <button
              type="button"
              className="btn secondary sm"
              disabled={busy}
              onClick={meet.cancelAsk}
            >
              취소
            </button>
          </div>
        </section>
      )}

      {(mine || others.length > 0) && (
        <div style={rail} aria-label="위치 공유 현황">
          {mine && (
            <section className="card mint" style={slide}>
              <div>
                <ModeBadge mode={mine.mode} />
                <h2
                  className="card-title"
                  style={{ margin: '12px 0 4px', fontSize: 20 }}
                >
                  대략적인 내 위치를
                  <br />
                  공유하고 있어요
                </h2>
                <p className="muted" style={{ margin: 0 }}>
                  {mine.area ? mine.area + ' · ' : ''}
                  {mine.mode === 'once'
                    ? '1회 공유 · 위치를 갱신하지 않아요'
                    : '20초마다 갱신해요'}
                </p>
              </div>
              <div>
                <div
                  style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}
                >
                  <strong style={{ fontSize: 40, lineHeight: 1 }}>
                    {left}
                  </strong>
                  <span className="muted">분 뒤 자동으로 멈춰요</span>
                </div>
                <div style={track}>
                  <div
                    style={{
                      height: '100%',
                      width: `${percent}%`,
                      background: ACCENT,
                      borderRadius: 999,
                      transition: 'width 0.6s',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn secondary sm"
                    onClick={() => openMap(mine.user_id)}
                  >
                    지도 보기
                  </button>
                  <button
                    type="button"
                    className="btn secondary sm"
                    disabled={busy}
                    onClick={() => void meet.stop()}
                  >
                    공유 중단
                  </button>
                </div>
              </div>
            </section>
          )}

          {others.map((s) => {
            const name = pickName(s, nameMode) || '알 수 없음'
            const once = s.mode === 'once'
            const ago = Math.max(
              0,
              Math.floor((now - new Date(s.updated_at).getTime()) / 60000),
            )
            const remain = Math.max(
              0,
              Math.ceil((new Date(s.expires_at).getTime() - now) / 60000),
            )
            return (
              <section key={s.user_id} className="card" style={slide}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={avatar}>{name.slice(0, 1)}</div>
                  <div>
                    <strong style={{ fontSize: 18 }}>{name}</strong>
                    <p className="muted" style={{ margin: '2px 0 0' }}>
                      {ago === 0 ? '방금 전' : `${ago}분 전`}{' '}
                      {once ? '공유함' : '업데이트'}
                    </p>
                  </div>
                </div>
                <div>
                  <ModeBadge mode={s.mode} />
                  <p className="muted" style={{ margin: '10px 0 4px' }}>
                    {s.area ?? '대략 500m 범위로 보여요'}
                  </p>
                  <p
                    className="muted"
                    style={{ margin: '0 0 12px', fontSize: 13 }}
                  >
                    {once
                      ? '공유한 시점의 위치예요 · '
                      : '20초마다 갱신돼요 · '}
                    {remain}분 뒤 사라져요
                  </p>
                  <button
                    type="button"
                    className="btn secondary sm"
                    onClick={() => openMap(s.user_id)}
                  >
                    지도에서 보기 →
                  </button>
                </div>
              </section>
            )
          })}
        </div>
      )}

      {showMap && shares.length > 0 && (
        <section className="card">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <h2 className="card-title" style={{ margin: 0 }}>
              공유 중인 대략적인 위치
            </h2>
            <button
              type="button"
              className="btn secondary sm"
              onClick={() => setShowMap(false)}
            >
              지도 닫기
            </button>
          </div>
          <BaseKakaoMap
            places={mapPlaces}
            selectedPlaceId={selectedId}
            onPlaceClick={(place) => setSelectedId(place.id)}
            height="320px"
          />
          <p className="muted" style={{ marginTop: 8 }}>
            실제 위치가 아니라 약 500m 범위의 중심이에요. 공유가 끝나면 지도에서
            사라져요.
          </p>
        </section>
      )}
    </div>
  );
}
