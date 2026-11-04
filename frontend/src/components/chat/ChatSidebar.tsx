'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import type { GroupMember } from '@/hooks/useGroupContext';
import type { SharedLocation } from '@/hooks/useLocationShare';

import BaseKakaoMap, { type MapPlace } from '@/components/BaseKakaoMap';

import Avatar from '@/components/Avatar';
import styles from './chat.module.css';

const AVATAR_TONES = ['', 'peach', 'lavender'];

interface ChatSidebarProps {
  members: GroupMember[];
  groupId: number;
  shares?: SharedLocation[];
}

export default function ChatSidebar({
  members,
  groupId,
  shares,
}: ChatSidebarProps) {
  // 위치 공유 데이터가 없으면 빈 배열 사용
  const safeShares = Array.isArray(shares) ? shares : [];

  // 지도에 표시할 수 있는 좌표만 추리기
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

  return (
    <aside className={styles.side}>
      {/* 그룹 멤버 */}
      <section className="card">
        <h2 className={styles.sideTitle}>함께 대화 중</h2>

        <div className={styles.avatars}>
          {members.map((m, i) => (
            <span
              key={m.user_id}
              title={m.nickname}
              style={{ display: 'inline-flex' }}
            >
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

        <div className={styles.names}>
          {members.length}명 · {members.map((m) => m.nickname).join(' · ')}
        </div>
      </section>

      {/* 실시간 위치 공유 */}
      <section className="card">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <h2 className={styles.sideTitle}>실시간 위치</h2>

          <span
            style={{
              fontSize: 11,
              color: 'var(--teal)',
              whiteSpace: 'nowrap',
            }}
          >
            {safeShares.length}명 공유 중
          </span>
        </div>

        {mapPlaces.length > 0 ? (
          <>
            <div style={{ overflow: 'hidden', borderRadius: 10 }}>
              <BaseKakaoMap places={mapPlaces} height="220px" />
            </div>

            {/* 위치 공유 중인 멤버 목록 */}
            <div style={{ marginTop: 12 }}>
              {safeShares.map((share) => (
                <div
                  key={share.user_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '9px 0',
                    borderBottom: '1px solid var(--line)',
                    fontSize: 12,
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: 8,
                      height: 8,
                      flexShrink: 0,
                      borderRadius: '50%',
                      background: 'var(--teal)',
                    }}
                  />

                  <span style={{ flex: 1 }}>
                    <strong>
                      {share.nickname || `멤버 ${share.user_id}`}
                      {share.mine ? ' (나)' : ''}
                    </strong>

                    <small
                      style={{
                        display: 'block',
                        marginTop: 3,
                        color: 'var(--muted)',
                      }}
                    >
                      {share.area || '주변 위치 확인 중'}
                    </small>
                  </span>
                </div>
              ))}
            </div>

            <p
              className="muted"
              style={{
                marginTop: 10,
                fontSize: 10,
                lineHeight: 1.6,
              }}
            >
              약 500m 범위의 대략적인 위치예요. 공유가 종료되면 지도에서
              사라져요.
            </p>
          </>
        ) : (
          <div
            style={{
              padding: '25px 10px',
              borderRadius: 10,
              background: 'var(--mist)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 26, marginBottom: 8 }}>📍</div>

            <p style={{ fontSize: 12, margin: 0 }}>
              현재 공유 중인 위치가 없어요.
            </p>

            <small
              className="muted"
              style={{
                display: 'block',
                marginTop: 6,
                fontSize: 11,
              }}
            >
              채팅에서 MeetMode를 눌러 위치를 공유할 수 있어요.
            </small>
          </div>
        )}
      </section>

      {/* 함께한 추억 */}
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

      {/* 사진 및 약속 모아보기 */}
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
