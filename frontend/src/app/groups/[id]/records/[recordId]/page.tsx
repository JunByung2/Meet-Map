"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import PhotoShell from "@/components/PhotoShell";
import { api } from "@/lib/api";
import { formatMeetDate, type RecordDetail } from "@/lib/records";
import "@/components/records.css";

export default function RecordDetailPage() {
  return (
    <PhotoShell active="records">
      {({ groupId, onApiError }) => <Detail groupId={groupId} onApiError={onApiError} />}
    </PhotoShell>
  );
}

function Detail({ groupId, onApiError }: { groupId: string; onApiError: (e: unknown) => string }) {
  const router = useRouter();
  const { recordId } = useParams<{ recordId: string }>();
  const [data, setData] = useState<RecordDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");

  const load = useCallback(() => {
    api<RecordDetail>(`/groups/${groupId}/records/${recordId}`)
      .then((d) => {
        setData(d);
        setTitle(d.record.title);
      })
      .catch((e) => setError(onApiError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, recordId]);

  useEffect(load, [load]);

  async function saveEdit() {
    setError("");
    if (!title.trim()) return setError("약속 이름은 비울 수 없어요.");
    setBusy(true);
    try {
      await api(`/groups/${groupId}/records/${recordId}`, {
        method: "PATCH",
        body: { title: title.trim() },
      });
      setEditing(false);
      load();
    } catch (e) {
      setError(onApiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("이 기록을 삭제할까요?\n확정된 약속과 사진은 그대로 남고, 이 기록만 지워져요.")) return;
    setBusy(true);
    try {
      await api(`/groups/${groupId}/records/${recordId}`, { method: "DELETE" });
      router.push(`/groups/${groupId}/records`);
    } catch (e) {
      setError(onApiError(e));
      setBusy(false);
    }
  }

  const back = `/groups/${groupId}/records`;
  if (!data) {
    return (
      <>
        <p style={{ marginBottom: 16 }}>
          <Link href={back} className="link-arrow">← 지난 기록으로</Link>
        </p>
        {error ? <div className="error">{error}</div> : <div className="card muted">불러오는 중...</div>}
      </>
    );
  }
  const { record: r, photos } = data;

  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href={back} className="link-arrow">← 지난 기록으로</Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">{formatMeetDate(r.meet_date)}</p>
          <h1 className="page-title">{r.title}</h1>
          <p className="page-sub">
            📍 {r.place_name ?? "장소를 정하지 않았어요"}
            {r.place_address ? ` · ${r.place_address}` : ""}
          </p>
        </div>
        {r.can_edit && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn secondary" onClick={() => setEditing((v) => !v)} disabled={busy}>
              {editing ? "수정 취소" : "수정"}
            </button>
            <button className="btn secondary" onClick={remove} disabled={busy}>삭제</button>
          </div>
        )}
      </div>

      {error && <div className="error" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="stack">
        {editing && (
          <section className="card">
            <div className="field">
              <label htmlFor="e-title">약속 이름</label>
              <input id="e-title" className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <button className="btn" onClick={saveEdit} disabled={busy}>수정 저장</button>
          </section>
        )}

        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h2 className="card-title">사진 {photos.length > 0 ? `${photos.length}장` : ""} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· 그날 채팅으로 보낸 사진이 모여요</span></h2>
          </div>
          {photos.length === 0 ? (
            <div className="rc-empty-photo">
              <strong>아직 사진이 없어요</strong>
              이날 채팅방에서 사진을 보내면 여기에 자동으로 모여요.
            </div>
          ) : (
            <div className="rc-photos">
              {photos.map((p) => (
                <Link key={p.id} href={`/groups/${groupId}/photos/${p.id}`}>
                  {p.signed_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.signed_url} alt={p.title ?? "기록 사진"} />
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 className="card-title">그날의 대화</h2>
            <Link className="btn secondary sm" href={`/groups/${groupId}/chat?date=${r.meet_date}`}>
              채팅 기록 열기 →
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
