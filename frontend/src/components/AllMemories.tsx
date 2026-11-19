"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import Pager, { PAGE_SIZE as REC_PAGE, pageCount } from "@/components/Pager";
import { colorMap, type Memories } from "@/lib/memories";
import { formatMeetDate } from "@/lib/records";
import "./memories.css";

type Tab = "photos" | "records";
const PAGE = 60;

const dayKey = (iso: string) => iso.slice(0, 10);

/** 그룹을 열지 않은 상태에서 내 모든 그룹의 사진 · 지난 기록을 모아 보여 준다 (읽기 전용) */
export default function AllMemories() {
  const router = useRouter();
  const [data, setData] = useState<Memories | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("photos");
  const [groupId, setGroupId] = useState<number | null>(null); // null = 전체
  const [shown, setShown] = useState(PAGE);
  const [recPage, setRecPage] = useState(1);

  useEffect(() => {
    api<Memories>("/me/memories?places=0")
      .then(setData)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          router.push("/login");
          return;
        }
        setError(
          err instanceof ApiError ? err.message : "추억을 불러오지 못했어요.",
        );
      });
  }, [router]);

  const colors = useMemo(() => colorMap(data?.groups ?? []), [data]);
  const nameOf = (id: number) =>
    data?.groups.find((g) => g.id === id)?.name ?? "";

  const photos = useMemo(
    () =>
      (data?.photos ?? []).filter(
        (p) => groupId === null || p.group_id === groupId,
      ),
    [data, groupId],
  );
  const records = useMemo(
    () =>
      (data?.records ?? []).filter(
        (r) => groupId === null || r.group_id === groupId,
      ),
    [data, groupId],
  );

  // 날짜별로 묶기 (최근 날짜 먼저)
  const days = useMemo(() => {
    const map = new Map<string, typeof photos>();
    for (const p of photos.slice(0, shown)) {
      const k = dayKey(p.created_at);
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return [...map.entries()];
  }, [photos, shown]);

  if (error) return <div className="error">{error}</div>;
  if (!data) return <div className="card muted">불러오는 중...</div>;
  if (data.groups.length === 0)
    return (
      <div className="card">
        <p className="card-title">아직 그룹이 없어요</p>
        <p className="muted" style={{ marginTop: 6 }}>
          그룹에서 사진을 올리거나 약속이 확정되면 추억이 여기에 모여요.
        </p>
      </div>
    );

  return (
    <>
      <div className="mt-tabs" role="tablist">
        <button
          type="button"
          className={tab === "photos" ? "on" : ""}
          role="tab"
          aria-selected={tab === "photos"}
          onClick={() => setTab("photos")}
        >
          사진
        </button>
        <button
          type="button"
          className={tab === "records" ? "on" : ""}
          role="tab"
          aria-selected={tab === "records"}
          onClick={() => setTab("records")}
        >
          지난 기록
        </button>
      </div>

      <div className="am-groups">
        <button
          type="button"
          className={groupId === null ? "on" : ""}
          onClick={() => {
            setGroupId(null);
            setShown(PAGE);
            setRecPage(1);
          }}
        >
          전체
        </button>
        {data.groups.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`${groupId === g.id ? "on tint" : ""}`}
            style={{ ["--c" as string]: colors.get(g.id) }}
            onClick={() => {
              setGroupId(g.id);
              setShown(PAGE);
              setRecPage(1);
            }}
          >
            <i
              className="gdot"
              style={{ ["--c" as string]: colors.get(g.id) }}
            />
            {g.name}
          </button>
        ))}
      </div>

      {tab === "photos" ? (
        photos.length === 0 ? (
          <div className="card muted">아직 올린 사진이 없어요.</div>
        ) : (
          <>
            {days.map(([day, list]) => (
              <section key={day}>
                <h2 className="am-day">{formatMeetDate(day)}</h2>
                <div className="am-grid">
                  {list.map((p) => (
                    <Link
                      key={p.id}
                      href={`/groups/${p.group_id}/photos/${p.id}?from=memories`}
                      className={`am-tile tinted${p.signed_url ? "" : " noimg"}`}
                      style={{ ["--c" as string]: colors.get(p.group_id) }}
                      title={nameOf(p.group_id)}
                    >
                      {p.signed_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.signed_url}
                          alt={p.title ?? `${nameOf(p.group_id)} 사진`}
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                    </Link>
                  ))}
                </div>
              </section>
            ))}
            {photos.length > shown && (
              <button
                type="button"
                className="btn secondary am-more"
                onClick={() => setShown((n) => n + PAGE)}
              >
                더 보기
              </button>
            )}
          </>
        )
      ) : records.length === 0 ? (
        <div className="card muted">
          약속이 확정되면 지난 기록이 여기에 자동으로 생겨요.
        </div>
      ) : (
        <>
          <div className="am-rec">
            {records
              .slice(
                (Math.min(recPage, pageCount(records.length, REC_PAGE)) - 1) *
                  REC_PAGE,
                Math.min(recPage, pageCount(records.length, REC_PAGE)) *
                  REC_PAGE,
              )
              .map((r) => (
                <Link
                  key={`${r.group_id}-${r.id}`}
                  href={`/groups/${r.group_id}/records/${r.id}?from=memories`}
                  style={{ ["--c" as string]: colors.get(r.group_id) }}
                >
                  <span className="am-rec-cover">
                    {r.cover_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.cover_url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      "사진 없음"
                    )}
                  </span>
                  <span className="am-rec-body">
                    <strong>{r.title}</strong>
                    <span className="meta">
                      {formatMeetDate(r.meet_date)} · {nameOf(r.group_id)}
                    </span>
                    <span className="meta">
                      {r.place_name ?? "장소 미정"} · 사진 {r.photo_count}장
                    </span>
                  </span>
                </Link>
              ))}
          </div>
          <Pager
            page={Math.min(recPage, pageCount(records.length, REC_PAGE))}
            pages={pageCount(records.length, REC_PAGE)}
            onChange={setRecPage}
          />
        </>
      )}
    </>
  );
}
