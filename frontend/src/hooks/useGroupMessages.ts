"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ChatMessage = {
  id: number;
  group_id: number;
  user_id: number;
  text: string | null;
  created_at: string;
  nickname?: string | null;
  mine?: boolean;
};

const POLL_MS = 3000;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// 같은 사이트의 /api 로 요청한다. (로그인 쿠키가 자동으로 붙는다)
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") detail = data.detail;
    } catch {
      /* 본문이 없거나 JSON 이 아니면 무시 */
    }
    throw new HttpError(res.status, detail || "요청에 실패했어요.");
  }
  return (await res.json()) as T;
}

/** 그룹 채팅 메시지 조회 / 전송 (서버에서 그룹 멤버만 허용, 3초마다 새 메시지 확인) */
export function useGroupMessages(groupId: number, userId: number | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const activeGroup = useRef(groupId);
  const lastId = useRef(0);

  const fetchMessages = useCallback(
    async (initial: boolean) => {
      const requested = groupId;
      const query = initial ? "" : `?after_id=${lastId.current}`;
      try {
        const data = await request<ChatMessage[]>(
          `/groups/${requested}/messages${query}`,
        );
        if (activeGroup.current !== requested) return;

        if (initial) {
          setMessages(data);
        } else if (data.length > 0) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            return [...prev, ...data.filter((m) => !seen.has(m.id))];
          });
        }
        if (data.length > 0) {
          lastId.current = Math.max(lastId.current, ...data.map((m) => m.id));
        }
        setStatus((prev) => (prev.startsWith("메시지를 불러오") ? "" : prev));
      } catch (err) {
        if (activeGroup.current !== requested) return;
        const code = err instanceof HttpError ? err.status : 0;
        setStatus(
          code === 401
            ? "로그인이 필요해요. 다시 로그인해 주세요."
            : code === 403
              ? "이 그룹의 채팅을 볼 권한이 없어요."
              : "메시지를 불러오지 못했어요.",
        );
      } finally {
        if (initial && activeGroup.current === requested) setLoading(false);
      }
    },
    [groupId],
  );

  useEffect(() => {
    activeGroup.current = groupId;
    lastId.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setMessages([]);
    void fetchMessages(true);

    const timer = window.setInterval(() => {
      if (!document.hidden) void fetchMessages(false);
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [groupId, fetchMessages]);

  const send = useCallback(
    async (rawText: string): Promise<boolean> => {
      const text = rawText.trim();
      if (sending || !text || userId === null) return false;

      setSending(true);
      try {
        // 작성자는 서버가 로그인 세션으로 정한다. (user_id 를 보내지 않는다)
        await request<ChatMessage>(`/groups/${groupId}/messages`, {
          method: "POST",
          body: JSON.stringify({ text }),
        });
        setStatus("");
        await fetchMessages(false);
        return true;
      } catch (err) {
        const code = err instanceof HttpError ? err.status : 0;
        setStatus(
          code === 401
            ? "로그인이 필요해요. 다시 로그인해 주세요."
            : code === 403
              ? "이 그룹에는 메시지를 보낼 수 없어요."
              : code === 422
                ? "메시지는 1~1000자까지 보낼 수 있어요."
                : "메시지를 보내지 못했어요.",
        );
        return false;
      } finally {
        setSending(false);
      }
    },
    [groupId, userId, sending, fetchMessages],
  );

  return { messages, loading, sending, status, setStatus, send };
}
