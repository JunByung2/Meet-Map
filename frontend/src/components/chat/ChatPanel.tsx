'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { GroupDetail, Me } from '@/hooks/useGroupContext';
import { useGroupMessages } from '@/hooks/useGroupMessages';
import { pickName, useNameMode } from '@/lib/nameMode';
import { api, ApiError } from '@/lib/api';
import { useStartPlacePlan } from '@/features/recommendation/useStartPlacePlan';
import { formatDateBand } from '@/lib/records';
import { useLocationShare } from '@/hooks/useLocationShare';

import MessageList from './MessageList';
import MessageComposer from './MessageComposer';
import ChatSidebar from './ChatSidebar';
import MeetModePanel from './MeetModePanel';
import VoteCreateModal from './VoteCreateModal';

import styles from './chat.module.css';

export default function ChatPanel({
  group,
  me,
  focusDate,
}: {
  group: GroupDetail;
  me: Me;
  focusDate?: string;
}) {
  const {
    messages,
    loading,
    sending,
    status,
    setStatus,
    send,
    deleteMessage,
    loadOlder,
    hasMore,
    loadingOlder,
  } = useGroupMessages(group.id, me.id, focusDate);

  const { start, starting } = useStartPlacePlan(group.id, setStatus);
  const meet = useLocationShare(group.id);

  const [voteOpen, setVoteOpen] = useState(false);
  const nameMode = useNameMode();

  const names = new Map(
    group.members.map((m) => [m.user_id, pickName(m, nameMode)]),
  );

  const nameOf = (userId: number) => names.get(userId) ?? '알 수 없음';

  const imageOf = (userId: number) =>
    group.members.find((m) => m.user_id === userId)?.profile_image ?? null;

  const MAX_BYTES = {
    image: 20 * 1024 * 1024,
    file: 10 * 1024 * 1024,
  };

  const isOwner = group.my_role === 'owner';

  // 사진 또는 파일 업로드 후 채팅 메시지 전송
  async function uploadAndSend(kind: 'image' | 'file', file: File) {
    if (file.size > MAX_BYTES[kind]) {
      setStatus(
        `${MAX_BYTES[kind] / 1024 / 1024}MB 이하 ${
          kind === 'image' ? '사진' : '파일'
        }만 보낼 수 있어요.`,
      );
      return;
    }

    setStatus(
      kind === 'image' ? '사진을 올리는 중이에요…' : '파일을 올리는 중이에요…',
    );

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);

      const att = await api<{
        id: number;
        filename: string;
      }>(`/groups/${group.id}/chat-files`, {
        method: 'POST',
        body: form,
      });

      await send(
        kind === 'image'
          ? `📷 사진\nattach:${att.id}`
          : `📎 ${att.filename}\nattach:${att.id}`,
      );

      setStatus('');
    } catch (err) {
      setStatus(
        err instanceof ApiError ? err.message : '파일을 보내지 못했어요.',
      );
    }
  }

  // 채팅 도구 버튼 처리
  const onTool = (tool: string) => {
    if (tool === '장소 선택') {
      void start();
      return;
    }

    if (tool === '투표') {
      setVoteOpen(true);
      return;
    }

    if (tool === 'MeetMode') {
      meet.openAsk();
      return;
    }

    setStatus(`${tool} 기능은 다음 단계에서 연결할 예정이에요.`);
  };

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
        {/* 왼쪽 채팅 영역 */}
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

          {selectMode && (
            <p className={sel.hint}>
              지울 메시지를 눌러서 고르세요. 묶어 보낸 사진은 사진을 하나씩 눌러서 그 사진만 고를 수도 있어요. 그만하려면 아래의 “취소하고 채팅으로 돌아가기”(또는 Esc)를 누르세요. 내가 보낸 메시지만 고를 수 있어요{isOwner ? ' (방장은 모두)' : ''}. 최대 {MAX_SELECT}개까지 선택할 수 있어요.
            </p>
          )}
          <MessageList
            messages={messages}
            loading={loading}
            myUserId={me.id}
            nameOf={nameOf}
            imageOf={imageOf}
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

=======

          {selectMode ? (
            <section className={sel.dock} aria-label="선택한 메시지 삭제">
              <div className={sel.dockRow}>
                <span className={sel.count}>
                  {selected.size > 0 || photoCount === 0 ? `메시지 ${selected.size}개` : ''}
                  {selected.size > 0 && photoCount > 0 ? ' · ' : ''}
                  {photoCount > 0 ? `사진 ${photoCount}장` : ''} 선택됨
                </span>
                <button
                  type="button"
                  className="btn secondary sm"
                  onClick={() =>
                    setSelected(
                      selected.size >= Math.min(deletable.length, MAX_SELECT)
                        ? new Set()
                        : new Set(deletable.slice(-MAX_SELECT).map((m) => m.id)),
                    )
                  }
                >
                  {deletable.length > 0 && selected.size >= Math.min(deletable.length, MAX_SELECT) ? '선택 해제' : '전체 선택'}
                </button>
                <button type="button" className="btn secondary sm" onClick={leaveSelect}>
                  취소하고 채팅으로 돌아가기
                </button>
                <button
                  type="button"
                  className="btn sm"
                  disabled={pickedTotal === 0 || deleting}
                  onClick={() => void deleteSelected()}
                >
                  {deleting ? '삭제하는 중…' : `삭제 (${pickedTotal})`}
                </button>
              </div>
              <div className={styles.status} role="status">
                {status}
              </div>
            </section>
          ) : (
            <MessageComposer
              sending={sending}
              planning={starting}
              status={status}
              onSend={send}
              onTool={onTool}
              onFile={uploadAndSend}
              onFiles={uploadMany}
              onSelectMode={() => setSelectMode(true)}
              canSelect={messages.length > 0}
            />
          )}
        </div>

        <ChatSidebar members={group.members} groupId={group.id} shares={meet.shares} />

      </div>

      {/* 투표 생성 */}
      {voteOpen && (
        <VoteCreateModal
          groupId={group.id}
          onClose={() => setVoteOpen(false)}
          onCreated={async (title, pollId) => {
            await send(`🗳 ${title}\nvote:${pollId}`);
          }}
        />
      )}
    </>
  );
}
