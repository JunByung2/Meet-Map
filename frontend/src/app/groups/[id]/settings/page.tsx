"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { ddayLabel } from "@/lib/dday";
import AppShell from "@/components/AppShell";
import { pickName, readNameMode } from "@/lib/nameMode";

type Member = {
  user_id: number;
  nickname: string;
  group_nickname: string | null;
  account_nickname?: string | null;
  profile_image: string | null;
  role: string;
  is_me: boolean;
};

type GroupDetail = {
  id: number;
  name: string;
  icon: string | null;
  description: string | null;
  started_on: string | null;
  my_role: string;
  members: Member[];
};

export default function GroupSettingsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const groupId = params.id;

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [description, setDescription] = useState("");
  const [startedOn, setStartedOn] = useState("");
  const [saving, setSaving] = useState(false);

  const [alias, setAlias] = useState("");
  const [savingAlias, setSavingAlias] = useState(false);

  const [targetId, setTargetId] = useState("");
  const [transferring, setTransferring] = useState(false);

  function handleError(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      router.push("/login");
      return;
    }
    if (err instanceof ApiError && err.status === 403) {
      setError("이 작업을 할 권한이 없습니다.");
      return;
    }
    setError(err instanceof ApiError ? err.message : "오류가 발생했습니다.");
  }

  const load = useCallback(async () => {
    try {
      const g = await api<GroupDetail>(`/groups/${groupId}`);
      const mode = readNameMode();
      setGroup({
        ...g,
        members: g.members.map((m) => ({ ...m, nickname: pickName(m, mode) })),
      });
      setName(g.name);
      setIcon(g.icon ?? "");
      setDescription(g.description ?? "");
      setStartedOn(g.started_on ?? "");
      setAlias(g.members.find((m) => m.is_me)?.group_nickname ?? "");
    } catch (err) {
      handleError(err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError("그룹 이름을 입력하세요.");
      return;
    }
    setSaving(true);
    try {
      await api(`/groups/${groupId}`, {
        method: "PATCH",
        body: {
          name: trimmed,
          icon: icon.trim(),
          description: description.trim(),
          started_on: startedOn || null,
        },
      });
      await load();
      setNotice("저장했어요.");
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  }

  async function onSaveAlias(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setSavingAlias(true);
    try {
      await api(`/groups/${groupId}/members/me`, {
        method: "PATCH",
        body: { nickname: alias.trim() },
      });
      await load();
      setNotice(alias.trim() ? "별명을 저장했어요." : "별명을 지웠어요.");
    } catch (err) {
      handleError(err);
    } finally {
      setSavingAlias(false);
    }
  }

  async function onTransfer(e: React.FormEvent) {
    e.preventDefault();
    if (!group || !targetId) return;
    const target = group.members.find((m) => String(m.user_id) === targetId);
    if (!target) return;
    if (
      !window.confirm(
        `${target.nickname}님에게 방장을 넘길까요? 나는 일반 멤버가 돼요.`,
      )
    )
      return;
    setError("");
    setNotice("");
    setTransferring(true);
    try {
      await api(`/groups/${groupId}/owner`, {
        method: "POST",
        body: { user_id: Number(targetId) },
      });
      setTargetId("");
      await load();
      setNotice("방장을 넘겼어요.");
    } catch (err) {
      handleError(err);
    } finally {
      setTransferring(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <div className="card muted">불러오는 중...</div>
      </AppShell>
    );
  }

  if (!group) {
    return (
      <AppShell>
        <div className="error">{error || "그룹을 불러오지 못했습니다."}</div>
        <Link href="/groups" className="link-arrow">
          ← 내 그룹으로
        </Link>
      </AppShell>
    );
  }

  const isOwner = group.my_role === "owner";
  const others = group.members.filter((m) => m.role !== "owner");
  const dday = ddayLabel(group.started_on);

  return (
    <AppShell
      group={{
        id: group.id,
        name: group.name,
        icon: group.icon,
        memberNicknames: group.members.map((m) => m.nickname),
      }}
      active="settings"
    >
      <p style={{ marginBottom: 16 }}>
        <Link href={`/groups/${group.id}`} className="link-arrow">
          ← 그룹 홈
        </Link>
      </p>

      <div className="page-head">
        <div>
          <p className="eyebrow">
            {isOwner ? "방장만 바꿀 수 있어요" : "그룹 정보"}
          </p>
          <h1 className="page-title">그룹 설정</h1>
        </div>
        <span className="chip">{isOwner ? "방장" : "멤버"}</span>
      </div>

      {error && <div className="error">{error}</div>}
      {notice && (
        <p className="meta" style={{ marginBottom: 12 }}>
          {notice}
        </p>
      )}

      <div style={{ display: "grid", gap: 20, maxWidth: 560 }}>
        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 12 }}>
            그룹 정보
          </h2>
          {isOwner ? (
            <form onSubmit={onSave}>
              <div className="field">
                <label htmlFor="name">그룹 이름</label>
                <input
                  id="name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={50}
                  required
                />
                <span className="hint">{name.length} / 50자</span>
              </div>
              <div className="field">
                <label htmlFor="icon">아이콘</label>
                <input
                  id="icon"
                  className="input"
                  placeholder="예: 🍀"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  maxLength={20}
                />
              </div>
              <div className="field">
                <label htmlFor="description">설명</label>
                <input
                  id="description"
                  className="input"
                  placeholder="그룹을 소개해 주세요"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                />
                <span className="hint">{description.length} / 500자</span>
              </div>
              <div className="field">
                <label htmlFor="startedOn">첫 만남일</label>
                <input
                  id="startedOn"
                  className="input"
                  type="date"
                  value={startedOn}
                  onChange={(e) => setStartedOn(e.target.value)}
                />
                <span className="hint">
                  {startedOn
                    ? "날짜를 지우면 D-day가 사라져요."
                    : '정하면 그룹 홈에 "함께한 지 N일째"가 보여요.'}
                </span>
              </div>
              <button className="btn" type="submit" disabled={saving}>
                {saving ? "저장 중…" : "저장하기"}
              </button>
            </form>
          ) : (
            <div>
              <p style={{ marginBottom: 6 }}>
                <strong>
                  {group.icon ? `${group.icon} ` : ""}
                  {group.name}
                </strong>
              </p>
              <p className="muted">{group.description || "설명이 없어요."}</p>
              {dday && (
                <p className="meta" style={{ marginTop: 10 }}>
                  🗓 {dday}
                </p>
              )}
              <p className="meta" style={{ marginTop: 10 }}>
                그룹 정보는 방장만 바꿀 수 있어요.
              </p>
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="card-title" style={{ marginBottom: 4 }}>
            이 그룹에서 쓸 별명
          </h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            이 그룹 친구들에게만 이 별명으로 보여요. 비워 두면 원래 닉네임이
            보여요.
          </p>
          <form onSubmit={onSaveAlias}>
            <div className="field">
              <label htmlFor="alias">별명</label>
              <input
                id="alias"
                className="input"
                placeholder="예: 막내, 총무"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                maxLength={30}
              />
              <span className="hint">{alias.length} / 30자</span>
            </div>
            <button className="btn" type="submit" disabled={savingAlias}>
              {savingAlias ? "저장 중…" : "별명 저장"}
            </button>
          </form>
        </section>

        {isOwner && (
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 4 }}>
              방장 넘기기
            </h2>
            <p className="muted" style={{ marginBottom: 12 }}>
              다른 멤버에게 방장을 넘기면 나는 일반 멤버가 돼요.
            </p>
            {others.length === 0 ? (
              <p className="meta">넘길 수 있는 멤버가 아직 없어요.</p>
            ) : (
              <form onSubmit={onTransfer}>
                <div className="field">
                  <label htmlFor="target">새 방장</label>
                  <select
                    id="target"
                    className="input"
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                  >
                    <option value="">멤버를 선택하세요</option>
                    {others.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.nickname}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className="btn secondary"
                  type="submit"
                  disabled={!targetId || transferring}
                >
                  {transferring ? "넘기는 중…" : "방장 넘기기"}
                </button>
              </form>
            )}
          </section>
        )}

        <p className="meta">
          멤버 내보내기와 그룹 나가기는{" "}
          <Link href={`/groups/${group.id}`}>그룹 홈</Link>에서 할 수 있어요.
        </p>
      </div>
    </AppShell>
  );
}
