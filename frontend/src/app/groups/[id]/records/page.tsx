"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PhotoShell from "@/components/PhotoShell";
import { api, ApiError } from "@/lib/api";
import { formatMeetDate, type MeetingRecord } from "@/lib/records";
import "@/components/records.css";

export default function RecordsPage() {
  return (
    <PhotoShell active="records">
      {({ groupId, onApiError }) => <RecordList groupId={groupId} onApiError={onApiError} />}
    </PhotoShell>
  );
}

function RecordList({ groupId, onApiError }: { groupId: string; onApiError: (e: unknown) => string }) {
  const [records, setRecords] = useState<MeetingRecord[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<MeetingRecord[]>(`/groups/${groupId}/records`)
      .then(setRecords)
      .catch((e) => {
        setError(onApiError(e));
        setRecords([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  async function removeRecord(r: MeetingRecord) {
    if (!window.confirm(`'${r.title}' 기록을 삭제할까요?\n약속과 사진은 그대로 남고, 이 기록만 지워져요.`)) return;
    setError("");
    try {
      await api(`/groups/${groupId}/records/${r.id}`, { method: "DELETE" });
      setRecords((cur) => (cur ? cur.filter((x) => x.id !== r.id) : cur));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : onApiError(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">지난 기록</p>
          <h1 className="page-title">우리의 약속 기록</h1>
          <p className="page-sub">확정된 약속이 자동으로 모여요. 날짜 · 장소 · 사진을 한눈에 봐요.</p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {records === null && <div className="card muted">불러오는 중...</div>}

      {records && records.length === 0 && !error && (
        <div className="card ph-empty">
          <h3>아직 확정된 약속이 없어요</h3>
          <p>채팅방에서 투표를 만들고 약속이 확정되면, 이곳에 지난 기록이 자동으로 생겨요.</p>
          <Link className="btn" href={`/groups/${groupId}`}>
            채팅방으로 가기
          </Link>
        </div>
      )}

      {records && records.length > 0 && (
        <div className="rc-list">
          {records.map((r) => (
            <div className="rc-wrap" key={r.id}>
            <Link className="rc-card" href={`/groups/${groupId}/records/${r.id}`}>
              <div className="rc-cover">
                {r.cover_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.cover_url} alt={`${r.title} 대표 사진`} />
                ) : (
                  <span>사진 없는 기록</span>
                )}
              </div>
              <div className="rc-body">
                <span className="rc-date">{formatMeetDate(r.meet_date)}</span>
                <span className="rc-title">{r.title}</span>
                <span className="rc-line">📍 {r.place_name ?? "장소를 정하지 않았어요"}</span>
                {r.photo_count > 0 && (
                  <div className="rc-chips">
                    <span className="rc-chip">사진 {r.photo_count}장</span>
                  </div>
                )}
              </div>
            </Link>
            {r.can_edit && (
              <button type="button" className="rc-del" onClick={() => void removeRecord(r)}>
                삭제
              </button>
            )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
