"use client";

import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { attachRefsOf } from "@/components/chat/AttachMessage";
import styles from "./groupChatPreview.module.css";

/** 미리보기용 문장: 사진/파일 메시지는 `attach:번호` 대신 "사진 N장을 보냈습니다."로 보여 준다 */
function previewText(raw: string | null): string {
  const text = raw?.trim() ?? "";
  if (!text) return "첨부 메시지";
  const ids = attachRefsOf(text);
  if (ids.length === 0) return text;
  if (text.startsWith("📎")) return "파일을 보냈습니다.";
  return `사진 ${ids.length}장을 보냈습니다.`;
}

type PreviewMessage = {
  id: number;
  user_id: number | null;
  nickname: string | null;
  text: string | null;
  created_at: string;
};

export default function GroupChatPreview({ groupId }: { groupId: number }) {
  const [messages, setMessages] = useState<PreviewMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let busy = false;

    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const data = await api<PreviewMessage[]>(`/groups/${groupId}/messages`);
        if (active) {
          setMessages(data.slice(-3));
          setError("");
        }
      } catch {
        if (active) setError("채팅을 불러오지 못했어요.");
      } finally {
        busy = false;
        if (active) setLoading(false);
      }
    };

    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 10000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [groupId]);

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      await api(`/groups/${groupId}/messages`, {
        method: "POST",
        body: { text },
      });
      setDraft("");
      const latest = await api<PreviewMessage[]>(`/groups/${groupId}/messages`);
      setMessages(latest.slice(-3));
      setError("");
    } catch {
      setError("메시지를 보내지 못했어요. 다시 시도해 주세요.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={styles.preview}>
      <div className={styles.messages} aria-live="polite">
        {loading ? (
          <p className={styles.empty}>채팅을 불러오는 중…</p>
        ) : messages.length === 0 ? (
          <p className={styles.empty}>아직 대화가 없어요. 첫 메시지를 보내 보세요.</p>
        ) : (
          messages.map((message) => {
            const name = message.nickname?.trim() || "알 수 없음";
            return (
              <div className={styles.message} key={message.id}>
                <span className={styles.avatar} aria-hidden="true">
                  {name.slice(0, 1)}
                </span>
                <div className={styles.messageContent}>
                  <div className={styles.messageMeta}>
                    <strong>{name}</strong>
                    <time dateTime={message.created_at}>
                      {new Date(message.created_at).toLocaleTimeString("ko-KR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p>{previewText(message.text)}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <form className={styles.composer} onSubmit={sendMessage}>
        <input
          aria-label="그룹 채팅 메시지"
          type="text"
          placeholder="메시지를 입력하세요"
          value={draft}
          maxLength={1000}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          aria-label="메시지 전송"
          disabled={!draft.trim() || sending}
        >
          {sending ? "…" : "➤"}
        </button>
      </form>
    </div>
  );
}
