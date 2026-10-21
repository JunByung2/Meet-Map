"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/hooks/useGroupMessages";
import styles from "./chat.module.css";

function formatTime(dateString: string | null | undefined) {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export default function MessageList({
  messages,
  loading,
  myUserId,
  nameOf,
}: {
  messages: ChatMessage[];
  loading: boolean;
  myUserId: number;
  nameOf: (userId: number) => string;
}) {
  const boxRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages]);

  if (loading || messages.length === 0) {
    return (
      <section className={styles.messages} ref={boxRef} aria-live="polite">
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>☘</div>
          <strong>
            {loading
              ? "메시지를 불러오는 중이에요."
              : "아직 메시지가 없어요. 첫 이야기를 남겨 보세요."}
          </strong>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.messages} ref={boxRef} aria-live="polite">
      {messages.map((m) => {
        const isMine = Number(m.user_id) === myUserId;
        const sender = nameOf(Number(m.user_id));

        return (
          <div
            key={m.id}
            className={`${styles.row} ${isMine ? styles.mine : styles.other}`}
          >
            {!isMine && <span className="avatar sm">{sender.slice(0, 1)}</span>}
            <div className={styles.body}>
              {!isMine && <div className={styles.sender}>{sender}</div>}
              <div className={styles.bubble}>{m.text ?? ""}</div>
              <div className={styles.time}>{formatTime(m.created_at)}</div>
            </div>
            {isMine && <span className="avatar sm">{sender.slice(0, 1)}</span>}
          </div>
        );
      })}
    </section>
  );
}
