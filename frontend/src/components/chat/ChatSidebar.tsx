"use client";

import type { GroupMember } from "@/hooks/useGroupContext";
import styles from "./chat.module.css";

const AVATAR_TONES = ["", "peach", "lavender"];

export default function ChatSidebar({
  members,
  onTool,
}: {
  members: GroupMember[];
  onTool: (tool: string) => void;
}) {
  return (
    <aside className={styles.side}>
      <section className="card">
        <h2 className={styles.sideTitle}>함께 대화 중</h2>
        <div className={styles.avatars}>
          {members.map((m, i) => (
            <span
              key={m.user_id}
              className={`avatar sm ${AVATAR_TONES[i % AVATAR_TONES.length]}`}
              title={m.nickname}
            >
              {m.nickname.slice(0, 1)}
            </span>
          ))}
        </div>
        <div className={styles.names}>
          {members.length}명 · {members.map((m) => m.nickname).join(" · ")}
        </div>
      </section>

      <section className="card">
        <span className={styles.tag}>대화에 연결된 추억</span>
        <div className={styles.placeholder}>🌳</div>
        <h3 className={styles.sideTitle} style={{ marginBottom: 6 }}>
          함께한 순간
        </h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          사진과 장소를 연결하면 이곳에서 추억을 모아볼 수 있어요.
        </p>
        <button
          type="button"
          className="btn secondary sm"
          onClick={() => onTool("추억 보기")}
        >
          추억 보기
        </button>
      </section>

      <section className="card">
        <h2 className={styles.sideTitle}>대화 속 모아보기</h2>
        <button
          type="button"
          className={styles.linkBtn}
          onClick={() => onTool("사진 모아보기")}
        >
          사진 모아보기 →
        </button>
        <button
          type="button"
          className={styles.linkBtn}
          onClick={() => onTool("약속 모아보기")}
        >
          공유한 약속 →
        </button>
      </section>
    </aside>
  );
}
