"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Identities = { providers: string[]; has_password: boolean };

const PROVIDERS = [
  { key: "kakao", label: "카카오" },
  { key: "google", label: "구글" },
];

// 연동이 끝나고 돌아올 때 주소에 붙는 ?link= 값의 안내 문구
const LINK_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  ok: { ok: true, text: "계정을 연결했어요." },
  already: { ok: true, text: "이미 이 계정에 연결돼 있어요." },
  taken: {
    ok: false,
    text: "그 소셜 계정은 이미 다른 회원에 연결돼 있어요.",
  },
  dup: { ok: false, text: "같은 종류의 계정이 이미 연결돼 있어요." },
  login: {
    ok: false,
    text: "로그인이 풀려서 연결하지 못했어요. 다시 시도해 주세요.",
  },
  error: { ok: false, text: "연결하지 못했어요. 잠시 뒤 다시 시도해 주세요." },
};

export default function LinkedAccountsCard() {
  const [data, setData] = useState<Identities | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api<Identities>("/auth/me/identities"));
    } catch {
      setNotice({ ok: false, text: "연결된 계정을 불러오지 못했어요." });
    }
  }, []);

  useEffect(() => {
    load();
    // 연동을 마치고 돌아왔다면 결과를 보여 주고 주소의 ?link= 를 지운다
    try {
      const result = new URLSearchParams(window.location.search).get("link");
      if (result && LINK_MESSAGES[result]) {
        setNotice(LINK_MESSAGES[result]);
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch {
      /* 무시 */
    }
  }, [load]);

  async function onUnlink(provider: string, label: string) {
    if (!window.confirm(`${label} 연결을 해제할까요?`)) return;
    setBusy(provider);
    setNotice(null);
    try {
      await api(`/auth/me/identities/${provider}`, { method: "DELETE" });
      setNotice({ ok: true, text: `${label} 연결을 해제했어요.` });
      await load();
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof ApiError ? err.message : "해제하지 못했어요.",
      });
    } finally {
      setBusy("");
    }
  }

  const loginCount = data
    ? data.providers.length + (data.has_password ? 1 : 0)
    : 0;

  return (
    <section className="card">
      <h2 className="card-title" style={{ marginBottom: 4 }}>
        연결된 계정
      </h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        여러 로그인 방법을 한 계정에 연결하면, 어떤 방법으로 로그인해도 같은 내
        계정으로 들어와요.
      </p>

      {notice && (
        <div
          className={notice.ok ? "hint" : "error"}
          style={notice.ok ? { color: "#2F7D4F", marginBottom: 12 } : undefined}
        >
          {notice.text}
        </div>
      )}

      {!data ? (
        <p className="muted">불러오는 중...</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {data.has_password && (
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>아이디·비밀번호</span>
              <span className="hint">사용 중</span>
            </div>
          )}

          {PROVIDERS.map(({ key, label }) => {
            const linked = data.providers.includes(key);
            return (
              <div
                key={key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span>
                  {label}{" "}
                  <span className="hint">
                    {linked ? "연결됨" : "연결 안 됨"}
                  </span>
                </span>
                {linked ? (
                  <button
                    type="button"
                    className="btn"
                    style={{ background: "#B54A3F" }}
                    disabled={busy === key || loginCount <= 1}
                    title={
                      loginCount <= 1
                        ? "마지막 로그인 방법은 해제할 수 없어요"
                        : undefined
                    }
                    onClick={() => onUnlink(key, label)}
                  >
                    {busy === key ? "처리 중…" : "해제"}
                  </button>
                ) : (
                  // 소셜 로그인 화면으로 이동해야 하므로 링크로 보낸다
                  <a className="btn" href={`/api/auth/${key}/link`}>
                    연결하기
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
