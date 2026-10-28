"use client";

import Link from "next/link";
import type { GroupMember } from "@/hooks/useGroupContext";
import styles from "./chat.module.css";

const AVATAR_TONES = ["", "peach", "lavender"];

export default function ChatSidebar({
  members,
  groupId,
}: {
  members: GroupMember[];
  groupId: number;
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
          약속한 날 올린 사진과 정한 장소가 ‘지난 기록’에 날짜별로 모여요.
        </p>
        <Link href={`/groups/${groupId}/records`} className="btn secondary sm">
          추억 보기
        </Link>
      </section>

      <section className="card">
        <h2 className={styles.sideTitle}>대화 속 모아보기</h2>
        <Link href={`/groups/${groupId}/photos`} className={styles.linkBtn}>
          사진 모아보기 →
        </Link>
        <Link href={`/groups/${groupId}/meetings`} className={styles.linkBtn}>
          공유한 약속 →
        </Link>
      </section>
    </aside>
  );
}
