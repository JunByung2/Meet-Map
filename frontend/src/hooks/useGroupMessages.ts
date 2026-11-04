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
const SYNC_EVERY = 5; // 3초 × 5 = 15초마다, 다른 곳(사진 페이지 등)에서 지운 메시지를 치운다
const PAGE_SIZE = 100; // 서버가 한 번에 주는 개수

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
export function useGroupMessages(
  groupId: number,
  userId: number | null,
  fromDate?: string | null, // 지난 기록에서 넘어왔을 때: 이 날짜(YYYY-MM-DD)부터의 대화를 불러온다
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const activeGroup = useRef(groupId);
  const lastId = useRef(0);
  const oldestId = useRef(0);
  const [hasMore, setHasMore] = useState(true); // 더 이전 대화가 있을 수 있는지
  const [loadingOlder, setLoadingOlder] = useState(false);

  const fetchMessages = useCallback(
    async (initial: boolean) => {
      const requested = groupId;
      const query = initial
        ? fromDate
          ? `?from_date=${encodeURIComponent(fromDate)}`
          : ""
        : `?after_id=${lastId.current}`;
      try {
        const data = await request<ChatMessage[]>(
          `/groups/${requested}/messages${query}`,
        );
        if (activeGroup.current !== requested) return;

        if (initial) {
          setMessages(data);
          oldestId.current = data.length > 0 ? Math.min(...data.map((m) => m.id)) : 0;
          // 최근 대화로 열었는데 100개가 안 되면 더 이전 대화는 없다. (날짜 이동은 더 있을 수 있다)
          setHasMore(fromDate ? data.length > 0 : data.length >= PAGE_SIZE);
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
    [groupId, fromDate],
  );

  // 다른 사람이 지웠거나 사진 페이지에서 사진을 지워서 사라진 메시지를 열려 있는 채팅에서도 치운다.
  // 서버가 알려 준 '남은 번호' 의 가장 큰 값 이하이면서 목록에 없는 것만 지운다. (방금 새로 온 메시지는 건드리지 않는다)
  const syncDeleted = useCallback(async () => {
    const requested = groupId;
    const min = oldestId.current;
    if (min <= 0) return;
    try {
      const ids = await request<number[]>(`/groups/${requested}/messages/ids?min_id=${min}`);
      if (activeGroup.current !== requested || ids.length === 0) return;
      const keep = new Set(ids);
      const top = ids[ids.length - 1];
      setMessages((prev) => {
        const next = prev.filter((m) => m.id > top || keep.has(m.id));
        return next.length === prev.length ? prev : next;
      });
    } catch {
      /* 일시적인 오류는 다음 확인 때 다시 시도한다 */
    }
  }, [groupId]);

  useEffect(() => {
    activeGroup.current = groupId;
    lastId.current = 0;
    oldestId.current = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setMessages([]);
    void fetchMessages(true);

    let tick = 0;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void fetchMessages(false);
      tick += 1;
      if (tick % SYNC_EVERY === 0) void syncDeleted();
    }, POLL_MS);

    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, fetchMessages]);

  // 위로 스크롤해서 "이전 대화 더 보기"
  const loadOlder = useCallback(async () => {
    if (loadingOlder || oldestId.current <= 0) return;
    setLoadingOlder(true);
    try {
      const data = await request<ChatMessage[]>(
        `/groups/${groupId}/messages?before_id=${oldestId.current}`,
      );
      if (data.length > 0) {
        oldestId.current = Math.min(...data.map((m) => m.id));
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id));
          return [...data.filter((m) => !seen.has(m.id)), ...prev];
        });
      }
      if (data.length < PAGE_SIZE) setHasMore(false);
    } catch {
      setStatus("이전 대화를 불러오지 못했어요.");
    } finally {
      setLoadingOlder(false);
    }
  }, [groupId, loadingOlder]);

  // 내가 지운 메시지를 목록에서 바로 뺀다 (서버 삭제 성공 뒤에 호출)
  const removeLocal = useCallback((messageId: number) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
  }, []);

  const deleteMessage = useCallback(
    async (messageId: number): Promise<boolean> => {
      try {
        const res = await fetch(`/api/groups/${groupId}/messages/${messageId}`, {
          method: "DELETE",
          credentials: "same-origin",
        });
        if (!res.ok && res.status !== 404) {
          setStatus(res.status === 403 ? "내가 보낸 메시지만 삭제할 수 있어요." : "메시지를 삭제하지 못했어요.");
          return false;
        }
        removeLocal(messageId);
        setStatus("");
        return true;
      } catch {
        setStatus("메시지를 삭제하지 못했어요.");
        return false;
      }
    },
    [groupId, removeLocal],
  );

  // 여러 메시지를 한 번에 삭제한다. 사진 메시지는 사진 페이지의 사진도 함께 지워진다.
  const deleteMessages = useCallback(
    async (ids: number[]): Promise<{ deleted: number; skipped: number } | null> => {
      if (ids.length === 0) return { deleted: 0, skipped: 0 };
      try {
        const res = await fetch(`/api/groups/${groupId}/messages/bulk-delete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) {
          setStatus(res.status === 502 || res.status === 503 ? "사진 저장소에 문제가 있어 삭제하지 못했어요." : "메시지를 삭제하지 못했어요.");
          return null;
        }
        const data = (await res.json()) as { deleted: number[]; skipped: number[] };
        const gone = new Set(data.deleted);
        setMessages((prev) => prev.filter((m) => !gone.has(m.id)));
        setStatus(data.skipped.length ? `${data.skipped.length}개는 내가 보낸 메시지가 아니라 삭제하지 못했어요.` : "");
        return { deleted: data.deleted.length, skipped: data.skipped.length };
      } catch {
        setStatus("메시지를 삭제하지 못했어요.");
        return null;
      }
    },
    [groupId],
  );

  // 묶어서 보낸 사진 말풍선에서 고른 사진만 지운다 (사진 페이지의 사진도 함께 지워진다)
  const removePhotos = useCallback(
    async (messageId: number, attachmentIds: number[]): Promise<boolean> => {
      try {
        const res = await fetch(`/api/groups/${groupId}/messages/${messageId}/remove-photos`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ attachment_ids: attachmentIds }),
        });
        if (!res.ok) {
          setStatus(
            res.status === 403
              ? "내가 보낸 사진만 지울 수 있어요."
              : res.status === 502 || res.status === 503
                ? "사진 저장소에 문제가 있어 삭제하지 못했어요."
                : "사진을 삭제하지 못했어요.",
          );
          return false;
        }
        const data = (await res.json()) as { message_deleted: boolean; text: string | null };
        setMessages((prev) =>
          data.message_deleted
            ? prev.filter((m) => m.id !== messageId)
            : prev.map((m) => (m.id === messageId && data.text ? { ...m, text: data.text } : m)),
        );
        return true;
      } catch {
        setStatus("사진을 삭제하지 못했어요.");
        return false;
      }
    },
    [groupId],
  );

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

  return { messages, loading, sending, status, setStatus, send, deleteMessage, deleteMessages, removePhotos, loadOlder, hasMore, loadingOlder };
}
