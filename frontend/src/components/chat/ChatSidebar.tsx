'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import type { GroupMember } from '@/hooks/useGroupContext';
import type { SharedLocation } from '@/hooks/useLocationShare';
import type { ChatMessage } from '@/hooks/useGroupMessages';

import VoteMessage, { pollRefOf } from './VoteMessage';
import PlanMessage from '@/features/recommendation/PlanMessage';
import BaseKakaoMap, { type MapPlace } from '@/components/BaseKakaoMap';
import Avatar from '@/components/Avatar';
import styles from './chat.module.css';

const AVATAR_TONES = ['', 'peach', 'lavender'];

const PLACE_PLAN_LINE =
  /^\/recommend\?groupId=([1-9]\d*)&planId=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

interface ChatSidebarProps {
  members: GroupMember[];
  groupId: number;
  shares?: SharedLocation[];
  messages: ChatMessage[];
  myUserId: number;
  onPost: (text: string) => Promise<unknown> | void;
}

export default function ChatSidebar({
  members,
  groupId,
  shares,
  messages,
  myUserId,
  onPost,
}: ChatSidebarProps) {
  const safeShares = Array.isArray(shares) ? shares : [];

  // ==========================================
  // 최근 7일 이내 투표 및 장소 추천 메시지
  // ==========================================

  const latestActions = useMemo(() => {
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - sevenDays;

    return messages
      .filter((message) => {
        const text = message.text ?? '';
        const lastLine = text.split('\n').pop() ?? '';

        const createdAt = new Date(message.created_at).getTime();

        // 날짜가 잘못된 메시지 제외
        if (!Number.isFinite(createdAt)) {
          return false;
        }

        // 최근 7일 이내의 메시지만 표시
        if (createdAt < sevenDaysAgo || createdAt > now) {
          return false;
        }

        const isVote = Boolean(pollRefOf(text));
        const isPlacePlan = PLACE_PLAN_LINE.test(lastLine);

        return isVote || isPlacePlan;
      })
      .sort((a, b) => {
        const timeA = new Date(a.created_at).getTime();
        const timeB = new Date(b.created_at).getTime();

        return timeB - timeA || b.id - a.id;
      });
  }, [messages]);

  // ==========================================
  // 투표 목록
  // 최근 7일 이내 항목 전체 표시
  // ==========================================

  const voteMessages = useMemo(
    () =>
      latestActions.filter((message) => Boolean(pollRefOf(message.text ?? ''))),
    [latestActions],
  );

  // ==========================================
  // 장소 추천 목록
  // 최근 7일 이내 항목 전체 표시
  // ==========================================

  const placeMessages = useMemo(
    () =>
      latestActions.filter((message) => {
        const lastLine = (message.text ?? '').split('\n').pop() ?? '';

        return PLACE_PLAN_LINE.test(lastLine);
      }),
    [latestActions],
  );

  // ==========================================
  // 실시간 위치 지도 데이터
  // ==========================================

  const mapPlaces = useMemo<MapPlace[]>(() => {
    return safeShares
      .filter(
        (share) => Number.isFinite(share.lat) && Number.isFinite(share.lng),
      )
      .map((share) => ({
        id: `location-${share.user_id}`,
        name: `${share.nickname || `멤버 ${share.user_id}`}${
          share.mine ? ' (나)' : ''
        }`,
        latitude: share.lat,
        longitude: share.lng,
      }));
  }, [safeShares]);

  // ==========================================
  // 화면
  // ==========================================

  return (
    <aside className={styles.side}>
      {/* ======================================
          1. 그룹 멤버
      ====================================== */}

      <section className={`card ${styles.memberCard}`}>
        <h2 className={styles.sideTitle}>함께 대화 중</h2>

        <div className={styles.avatars}>
          {members.map((member, index) => (
            <span
              key={member.user_id}
              title={member.nickname}
              style={{ display: 'inline-flex' }}
            >
              <Avatar
                userId={member.user_id}
                name={member.nickname}
                image={member.profile_image}
                size="sm"
                tone={AVATAR_TONES[index % AVATAR_TONES.length]}
              />
            </span>
          ))}
        </div>

        <div className={styles.names}>
          {members.length}명 ·{' '}
          {members.map((member) => member.nickname).join(' · ')}
        </div>
      </section>

      {/* ======================================
          2. 실시간 위치 + 대화 속 모아보기
      ====================================== */}

      <div className={styles.topWidgets}>
        {/* 실시간 위치 */}

        <section className={`card ${styles.compactCard}`}>
          <div className={styles.cardHeading}>
            <h2 className={styles.sideTitle}>실시간 위치</h2>

            <span className={styles.locationCount}>
              {safeShares.length}명 공유 중
            </span>
          </div>

          {mapPlaces.length > 0 ? (
            <>
              <div className={styles.smallMap}>
                <BaseKakaoMap places={mapPlaces} height="170px" />
              </div>

              <div className={styles.compactLocationList}>
                {safeShares.map((share) => (
                  <div
                    key={share.user_id}
                    className={styles.compactLocationPerson}
                  >
                    <span className={styles.locationDot} />

                    <span>
                      <strong>
                        {share.nickname || `멤버 ${share.user_id}`}
                        {share.mine ? ' (나)' : ''}
                      </strong>

                      <small>{share.area || '주변 위치 확인 중'}</small>
                    </span>
                  </div>
                ))}
              </div>

              <p className={styles.locationNotice}>
                약 500m 범위의 대략적인 위치예요.
              </p>
            </>
          ) : (
            <div className={styles.compactEmpty}>
              <span>📍</span>

              <p>현재 공유 중인 위치가 없어요.</p>

              <small>채팅에서 MeetMode를 눌러 위치를 공유할 수 있어요.</small>
            </div>
          )}
        </section>

        {/* 대화 속 모아보기 */}

        <section className={`card ${styles.compactCard}`}>
          <h2 className={styles.sideTitle}>대화 속 모아보기</h2>

          <div className={styles.collectionLinks}>
            <Link
              href={`/groups/${groupId}/photos`}
              className={styles.collectionLink}
            >
              <span>📷</span>
              <span>사진 모아보기</span>
              <span className={styles.linkArrow}>→</span>
            </Link>

            <Link
              href={`/groups/${groupId}/meetings`}
              className={styles.collectionLink}
            >
              <span>📅</span>
              <span>공유한 약속</span>
              <span className={styles.linkArrow}>→</span>
            </Link>
          </div>
        </section>
      </div>

      {/* ======================================
          3. 투표 + 장소 선택
      ====================================== */}

      <section className={`card ${styles.actionSection}`}>
        <div className={styles.actionHeader}>
          <h2 className={styles.sideTitle}>투표 · 장소 선택</h2>

          <span className={styles.actionDescription}>최근 7일 이내 항목</span>
        </div>

        <div className={styles.actionGrid}>
          {/* ==================================
              투표 목록
          ================================== */}

          <section className={styles.actionColumn}>
            <h3 className={styles.actionTitle}>
              <span>🗳 투표</span>

              <span className={styles.itemCount}>{voteMessages.length}</span>
            </h3>

            {voteMessages.length > 0 ? (
              <div className={styles.actionList}>
                {voteMessages.map((message) => (
                  <article key={message.id} className={styles.actionItem}>
                    <VoteMessage
                      text={message.text ?? ''}
                      groupId={groupId}
                      myUserId={myUserId}
                      onPost={onPost}
                    />
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.actionEmpty}>
                최근 일주일 동안 생성된 투표가 없어요.
              </div>
            )}
          </section>

          {/* ==================================
              장소 추천 목록
          ================================== */}

          <section className={styles.actionColumn}>
            <h3 className={styles.actionTitle}>
              <span>📍 장소 선택</span>

              <span className={styles.itemCount}>{placeMessages.length}</span>
            </h3>

            {placeMessages.length > 0 ? (
              <div className={styles.actionList}>
                {placeMessages.map((message) => (
                  <article key={message.id} className={styles.placeActionItem}>
                    <PlanMessage text={message.text ?? ''} groupId={groupId} />
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.actionEmpty}>
                최근 일주일 동안 추천된 장소가 없어요.
              </div>
            )}
          </section>
        </div>
      </section>
    </aside>
  );
}
