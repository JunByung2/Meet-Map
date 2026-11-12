'use client'

import Link from 'next/link'
import type { GroupMember } from '@/hooks/useGroupContext'
import Avatar from '@/components/Avatar'
import styles from './meetmode.module.css'

const AVATAR_TONES = ['', 'peach', 'lavender']

/** 채팅 제목 줄 오른쪽: 함께 대화 중인 친구 + 바로가기 링크 */
export default function ChatSidebar({
  members,
  groupId,
}: {
  members: GroupMember[]
  groupId: number
}) {
  return (
    <div className={styles.bar}>
      <div
        className={styles.stack}
        aria-label={`함께 대화 중 ${members.length}명`}
      >
        {members.map((m, i) => (
          <span key={m.user_id} title={m.nickname}>
            <Avatar
              userId={m.user_id}
              name={m.nickname}
              image={m.profile_image}
              size="sm"
              tone={AVATAR_TONES[i % AVATAR_TONES.length]}
            />
          </span>
        ))}
      </div>
      <Link href={`/groups/${groupId}/photos`} className={styles.barLink}>
        사진 모아보기
      </Link>
      <Link href={`/groups/${groupId}/records`} className={styles.barLink}>
        추억 보기
      </Link>
    </div>
  )
}
