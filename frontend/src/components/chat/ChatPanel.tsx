'use client'

import Link from 'next/link'
import type { GroupDetail, Me } from '@/hooks/useGroupContext'
import { useGroupMessages } from '@/hooks/useGroupMessages'

import { useState } from 'react'
import { api, ApiError } from '@/lib/api'
import { useStartPlacePlan } from '@/features/recommendation/useStartPlacePlan'
import MessageList from './MessageList'
import { formatDateBand } from '@/lib/records'
import MessageComposer from './MessageComposer'

import ChatSidebar from './ChatSidebar'
import styles from './chat.module.css'
import { useLocationShare } from '@/hooks/useLocationShare'
import MeetModePanel from './MeetModePanel'
import VoteCreateModal from './VoteCreateModal'

export default function ChatPanel({
  group,
  me,
  focusDate,
}: {
  group: GroupDetail
  me: Me
  /** 지난 기록에서 넘어왔을 때: 이 날짜(YYYY-MM-DD)의 대화로 이동 */
  focusDate?: string
}) {
  const { messages, loading, sending, status, setStatus, send, deleteMessage, loadOlder, hasMore, loadingOlder } =
    useGroupMessages(group.id, me.id, focusDate)

  const { start, starting } = useStartPlacePlan(group.id, setStatus)
  const meet = useLocationShare(group.id)
  const [voteOpen, setVoteOpen] = useState(false)

  const names = new Map(group.members.map((m) => [m.user_id, m.nickname]))
  const nameOf = (userId: number) => names.get(userId) ?? '알 수 없음'

  const MAX_BYTES = { image: 20 * 1024 * 1024, file: 10 * 1024 * 1024 }
  const isOwner = group.my_role === 'owner'

  // 사진/문서를 올린 뒤, 채팅에 첨부 메시지(마지막 줄 = attach:번호)를 보낸다
  async function uploadAndSend(kind: 'image' | 'file', file: File) {
    if (file.size > MAX_BYTES[kind]) {
      setStatus(`${MAX_BYTES[kind] / 1024 / 1024}MB 이하 ${kind === 'image' ? '사진' : '파일'}만 보낼 수 있어요.`)
      return
    }
    setStatus(kind === 'image' ? '사진을 올리는 중이에요…' : '파일을 올리는 중이에요…')
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', kind)
      const att = await api<{ id: number; filename: string }>(`/groups/${group.id}/chat-files`, {
        method: 'POST',
        body: form,
      })
      await send(kind === 'image' ? `📷 사진\nattach:${att.id}` : `📎 ${att.filename}\nattach:${att.id}`)
      setStatus('')
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : '파일을 보내지 못했어요.')
    }
  }

  const onTool = (tool: string) => {
    if (tool === '장소 선택') {
      void start()
      return
    }

    if (tool === '투표') {
      setVoteOpen(true)
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

          {focusDate && (
            <div className={styles.banner}>
              <span>📅 {formatDateBand(focusDate)} 대화로 이동했어요.</span>
              <Link href={`/groups/${group.id}/chat`} className="link-arrow">
                최신 대화 보기 →
              </Link>
            </div>
          )}

          <MeetModePanel meet={meet} />

          <MessageList
            messages={messages}
            loading={loading}
            myUserId={me.id}
            nameOf={nameOf}
            onPost={send}
            focusDate={focusDate}
            onDelete={deleteMessage}
            canDeleteAll={isOwner}
            onLoadOlder={loadOlder}
            hasMore={hasMore}
            loadingOlder={loadingOlder}
          />

          <MessageComposer
            sending={sending}
            planning={starting}
            status={status}
            onSend={send}
            onTool={onTool}
            onFile={uploadAndSend}
          />
        </div>

        <ChatSidebar members={group.members} groupId={group.id} />
      </div>

      {voteOpen && (
        <VoteCreateModal
          groupId={group.id}
          onClose={() => setVoteOpen(false)}
          // 후보가 저장되면 채팅에 투표 카드를 올린다 (마지막 줄 = 투표 번호). 멤버는 카드에서 바로 투표한다.
          onCreated={async (title, pollId) => {
            await send(`🗳 ${title}\nvote:${pollId}`)
          }}
        />
      )}
    </>
  )
}
