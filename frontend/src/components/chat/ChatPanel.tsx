'use client'

import Link from 'next/link'
import type { GroupDetail, Me } from '@/hooks/useGroupContext'
import { useGroupMessages } from '@/hooks/useGroupMessages'

import { useStartPlacePlan } from '@/features/recommendation/useStartPlacePlan'
import MessageList from './MessageList'
import MessageComposer from './MessageComposer'

import ChatSidebar from './ChatSidebar'
import styles from './chat.module.css'
import { useLocationShare } from '@/hooks/useLocationShare'
import MeetModePanel from './MeetModePanel'

export default function ChatPanel({
  group,
  me,
}: {
  group: GroupDetail
  me: Me
}) {
  const { messages, loading, sending, status, setStatus, send } =
    useGroupMessages(group.id, me.id)

  const { start, starting } = useStartPlacePlan(group.id, setStatus)
  const meet = useLocationShare(group.id)

  const names = new Map(group.members.map((m) => [m.user_id, m.nickname]))
  const nameOf = (userId: number) => names.get(userId) ?? '알 수 없음'

  const onTool = (tool: string) => {
    if (tool === '장소 선택') {
      void start()
      return
    }

    if (tool === 'MeetMode') {
      meet.openAsk()
      return
    }

    setStatus(`${tool} 기능은 다음 단계에서 연결할 예정이에요.`)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">그룹 채팅</p>
          <h1 className="page-title">우리의 대화</h1>
          <p className="page-sub">
            약속을 잡고, 사진을 나누고, 다음 이야기를 이어가요.
          </p>
        </div>
      </div>

      <div className={styles.layout}>
        <div>
          <div className={styles.banner}>
            <span>함께 정한 약속을 이곳에서 확인해 보세요.</span>
            <Link href={`/groups/${group.id}/meetings`} className="link-arrow">
              약속 보기 →
            </Link>
          </div>

          <MeetModePanel meet={meet} />

          <MessageList
            messages={messages}
            loading={loading}
            myUserId={me.id}
            nameOf={nameOf}
          />

          <MessageComposer
            sending={sending}
            planning={starting}
            status={status}
            onSend={send}
            onTool={onTool}
          />
        </div>

        <ChatSidebar members={group.members} onTool={onTool} />
      </div>
    </>
  )
}
