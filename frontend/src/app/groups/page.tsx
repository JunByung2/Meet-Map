"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import AppShell from "@/components/AppShell";

type Group = {
  id: number;
  name: string;
  icon: string | null;
  description: string | null;
  role: string;
};

export default function GroupsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const loadGroups = useCallback(async () => {
    try {
      const data = await api<Group[]>("/groups");
      setGroups(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    // 초대 링크를 열었다가 로그인하러 온 경우, 로그인 후 그 초대 페이지로 돌아간다
    try {
      const pending = sessionStorage.getItem("pending_invite");
      if (pending) {
        sessionStorage.removeItem("pending_invite");
        if (pending.startsWith("/invite/")) {
          router.replace(pending);
          return;
        }
      }
    } catch {
      // sessionStorage 를 못 쓰는 환경이면 그냥 넘어간다
    }
    loadGroups();
  }, [loadGroups, router]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCreating(true);
    try {
      await api("/groups", {
        method: "POST",
        body: { name, description: description || null },
      });
      setName("");
      setDescription("");
      await loadGroups();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push("/login");
        return;
      }
      setError(err instanceof ApiError ? err.message : "오류가 발생했습니다.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <AppShell>
      <div className="page-head">
        <div>
          <p className="eyebrow">우리만의 공간</p>
          <h1 className="page-title">내 그룹</h1>
          <p className="page-sub">
            함께할 친구들과 대화, 약속, 사진을 나눌 작은 공간이에요.
          </p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="grid-main">
        <section>
          <h2 className="section-title" style={{ marginBottom: 16 }}>
            함께하는 그룹
          </h2>

          {loading ? (
            <div className="card muted">불러오는 중...</div>
          ) : groups.length === 0 ? (
            <div className="card">
              <p className="card-title">아직 그룹이 없어요</p>
              <p className="muted" style={{ marginTop: 6 }}>
                오른쪽에서 첫 그룹을 만들거나, 친구가 보낸 초대 링크로 들어와
                보세요.
              </p>
            </div>
          ) : (
            <div className="stack">
              {groups.map((g) => (
                <Link
                  key={g.id}
                  href={`/groups/${g.id}`}
                  className="card"
                  style={{ color: "inherit", textDecoration: "none" }}
                >
                  <div className="row-between">
                    <div className="row">
                      <span className="avatar lg">
                        {g.icon ? g.icon : g.name.slice(0, 1)}
                      </span>
                      <div>
                        <p className="card-title">{g.name}</p>
                        {g.description && (
                          <p className="muted" style={{ marginTop: 2 }}>
                            {g.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="row">
                      <span className="chip">
                        {g.role === "owner" ? "방장" : "멤버"}
                      </span>
                      <span className="link-arrow">열기 →</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 4 }}>
            새 그룹 만들기
          </h2>
          <p className="muted" style={{ marginBottom: 20 }}>
            만든 뒤에 초대 링크로 친구를 불러올 수 있어요.
          </p>
          <form onSubmit={onCreate}>
            <div className="field">
              <label htmlFor="group-name">그룹 이름 *</label>
              <input
                id="group-name"
                className="input"
                type="text"
                placeholder="예. 느린 주말"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                required
              />
              <span className="hint">
                친구들이 알아볼 수 있는 이름 · {name.length} / 50자
              </span>
            </div>
            <div className="field">
              <label htmlFor="group-desc">그룹 소개 (선택)</label>
              <input
                id="group-desc"
                className="input"
                type="text"
                placeholder="함께하고 싶은 이야기를 적어 주세요"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <button className="btn block" type="submit" disabled={creating}>
              {creating ? "만드는 중…" : "그룹 만들기 →"}
            </button>
          </form>
          <p className="meta" style={{ marginTop: 14 }}>
            초대한 친구만 참여할 수 있어요. 그룹은 검색에 노출되지 않아요.
          </p>
        </section>
      </div>

      <div className="notice" style={{ marginTop: 28 }}>
        <strong>친구가 모이면, 첫 약속부터 시작해 보세요.</strong>
        <span className="muted">
          그룹 만들기 → 초대 링크 보내기 → 약속 만들기 → 사진 모으기
        </span>
      </div>
    </AppShell>
  );
}
