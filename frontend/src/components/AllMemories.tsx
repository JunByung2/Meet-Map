"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { colorMap, type Memories } from "@/lib/memories";
import { formatMeetDate } from "@/lib/records";
import Panel from "@/components/Panel";
import "./memories.css";

const PAGE = 60;

const dayKey = (iso: string) => iso.slice(0, 7); // 월별로 묶기
const monthLabel = (k: string) =>
  `${k.slice(0, 4)}년 ${Number(k.slice(5, 7))}월`;

/** 그룹을 열지 않은 상태에서 내 모든 그룹의 사진을 모아 보여 준다 (읽기 전용) */
export default function AllMemories() {
  const router = useRouter();
  const [data, setData] = useState<Memories | null>(null);
  const [error, setError] = useState("");
  const [groupId, setGroupId] = useState<number | null>(null); // null = 전체
  const [shown, setShown] = useState(PAGE);

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
  const countOf = (id: number) =>
    (data?.photos ?? []).filter((p) => p.group_id === id).length;

  // 월별로 묶기 (최근 날짜 먼저)
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

  const pick = (id: number | null) => {
    setGroupId(id);
    setShown(PAGE);
  };

  return (
    <Panel
      title="모아 보는 추억"
      kicker="ALL MEMORIES"
      className="am-panel"
      action={<span className="am-count">사진 {photos.length}장</span>}
    >
      <div className="am-layout">
        <div className="am-groups am-side" aria-label="그룹 고르기">
          <button
            type="button"
            className={groupId === null ? "on" : ""}
            onClick={() => pick(null)}
          >
            <span>전체</span>
            <b>{data.photos.length}</b>
          </button>
          {data.groups.map((g) => (
            <button
              key={g.id}
              type="button"
              className={groupId === g.id ? "on tint" : ""}
              style={{ ["--c" as string]: colors.get(g.id) }}
              onClick={() => pick(g.id)}
            >
              <i
                className="gdot"
                style={{ ["--c" as string]: colors.get(g.id) }}
              />
              <span>{g.name}</span>
              <b>{countOf(g.id)}</b>
            </button>
          ))}
        </div>

        <div className="am-scroll">
          {photos.length === 0 ? (
            <div className="card muted">아직 올린 사진이 없어요.</div>
          ) : (
            <>
              <div className="am-grid">
                {days.map(([day, list]) => (
                  <Fragment key={day}>
                    <h2 className="am-day">{monthLabel(day)}</h2>
                    {list.map((p) => (
                      <Link
                        key={p.id}
                        href={`/groups/${p.group_id}/photos/${p.id}?from=memories`}
                        className={`am-tile tinted${p.signed_url ? "" : " noimg"}`}
                        style={{ ["--c" as string]: colors.get(p.group_id) }}
                        title={`${nameOf(p.group_id)} · ${formatMeetDate(p.created_at.slice(0, 10))}`}
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
                  </Fragment>
                ))}
              </div>
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
          )}
        </div>
      </div>
    </Panel>
  );
}
