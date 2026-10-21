"use client";

import { useState } from "react";
import BaseKakaoMap, { type MapPlace } from "@/features/map/BaseKakaoMap";
import { SHARE_MINUTES, type useLocationShare } from "@/hooks/useLocationShare";

type Meet = ReturnType<typeof useLocationShare>;

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
  const { mine, others, shares, asking, busy, message, now } = meet;
  const [showMap, setShowMap] = useState(false);
  const [selectedId, setSelectedId] = useState("");

  const left = mine
    ? Math.max(
        0,
        Math.ceil((new Date(mine.expires_at).getTime() - now) / 60000),
      )
    : 0;

  // 지도에 찍는 점: 서버가 돌려준 대략적인 위치(500m 격자 중심)만 사용한다
  const mapPlaces: MapPlace[] = shares.map((s) => ({
    id: `loc-${s.user_id}`,
    name: `${s.nickname ?? "알 수 없음"}${s.mine ? " (나)" : ""}`,
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
          <span className="chip">MeetMode · {SHARE_MINUTES}분 공유</span>
          <h2 className="card-title" style={{ margin: "8px 0 6px" }}>
            내 위치를 친구들에게 공유할까요?
          </h2>
          <ul
            className="muted"
            style={{ margin: "8px 0 12px", paddingLeft: 18 }}
          >
            <li>내가 직접 누를 때만 공유돼요. 자동으로 공유되지 않아요.</li>
            <li>이 그룹 친구들에게만, 대략적인 위치(약 500m 범위)로 보여요.</li>
            <li>정확한 위치는 저장하지 않아요.</li>
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
              {busy ? "위치 확인 중…" : `${SHARE_MINUTES}분 동안 공유하기`}
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

      {mine && (
        <section
          className="card mint"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <strong>📍 대략적인 내 위치를 공유하고 있어요</strong>
            <p className="muted" style={{ margin: "4px 0 0" }}>
              약 {left}분 뒤에 자동으로 멈춰요 · 20초마다 갱신해요
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
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
        </section>
      )}

      {others.length > 0 && (
        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 8 }}>
            지금 위치를 공유 중인 친구
          </h2>
          {others.map((s) => {
            const name = s.nickname ?? "알 수 없음";
            const ago = Math.max(
              0,
              Math.floor((now - new Date(s.updated_at).getTime()) / 60000),
            );
            return (
              <div
                key={s.user_id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "6px 0",
                }}
              >
                <span>
                  {name}{" "}
                  <span className="muted">
                    · {ago === 0 ? "방금" : `${ago}분 전`}
                  </span>
                </span>
                <button
                  type="button"
                  className="link-arrow"
                  style={{
                    border: 0,
                    background: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                  onClick={() => openMap(s.user_id)}
                >
                  지도에서 보기 →
                </button>
              </div>
            );
          })}
        </section>
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
