"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/hooks/useGroupMessages";
import styles from "./chat.module.css";
import PlanMessage from "@/features/recommendation/PlanMessage";
import Avatar from "@/components/Avatar";

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
  imageOf,
}: {
  messages: ChatMessage[];
  loading: boolean;
  myUserId: number;
  nameOf: (userId: number) => string;
  imageOf?: (userId: number) => string | null;
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
        const senderId = Number(m.user_id);
        const isMine = senderId === myUserId;
        const sender = nameOf(senderId);

        return (
          <div
            key={m.id}
            className={`${styles.row} ${isMine ? styles.mine : styles.other}`}
          >
            {!isMine && (
              <Avatar
                userId={senderId}
                name={sender}
                image={imageOf?.(senderId) ?? null}
                size="sm"
              />
            )}
            <div className={styles.body}>
              {!isMine && <div className={styles.sender}>{sender}</div>}
              <div className={styles.bubble}>
                <PlanMessage text={m.text ?? ""} groupId={m.group_id} />
              </div>
              <div className={styles.time}>{formatTime(m.created_at)}</div>
            </div>
            {isMine && (
              <Avatar
                userId={senderId}
                name={sender}
                image={imageOf?.(senderId) ?? null}
                size="sm"
              />
            )}
          </div>
        );
      })}
    </section>
  );
}
