'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import AppShell from '@/components/AppShell';

type GroupInfo = {
  id: number;
  name: string;
  role: string;
};

type Meeting = {
  id: number;
  group_id: number;
  title: string;
  location: string;
  meeting_time: string;
  status: string;
  created_by?: number | null;
};

export default function GroupMeetingsPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = String(params.id);

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');


  // 로그인 여부 확인
  const loadGroupInfo = useCallback(async () => {
    try {
      await api<GroupInfo[]>('/groups'); // 로그인 확인용
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }

    }
  }, [groupId, router]);

  // 확정된 약속 목록 조회
  const loadMeetings = useCallback(async () => {
    try {
      const data = await api<Meeting[]>(`/groups/${groupId}/meetings`);

      setMeetings(
        data
          .filter((meeting) => meeting.status?.toLowerCase() === 'confirmed')
          .sort(
            (a, b) =>
              new Date(a.meeting_time).getTime() -
              new Date(b.meeting_time).getTime(),
          ),
      );

      setError('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push('/login');
        return;
      }

      setError(
        err instanceof ApiError ? err.message : '약속을 불러오지 못했습니다.',
      );
    }
  }, [groupId, router]);

  // 전체 새로고침
  const refreshAll = useCallback(async () => {
    setLoading(true);

    try {
      await Promise.all([loadGroupInfo(), loadMeetings()]);
    } finally {
      setLoading(false);
    }
  }, [loadGroupInfo, loadMeetings]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // 날짜 표시
  function formatDate(value: string) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  // 확정된 약속 삭제: 방장만 가능
  async function deleteMeeting(meetingId: number) {
    const confirmed = window.confirm('확정된 약속을 삭제할까요?\n지난 기록은 그대로 남아요. (기록은 지난 기록 페이지에서 따로 지울 수 있어요)');

    if (!confirmed) return;

    setError('');

    try {
      await api(`/groups/${groupId}/meetings/${meetingId}`, {
        method: 'DELETE',
      });

      await loadMeetings();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : '확정된 약속 삭제에 실패했습니다.',
      );
    }
  }

  return (
    <AppShell active="meetings">
      <div className="page-head">
        <div>
          <p className="eyebrow">우리의 일정</p>
          <h1 className="page-title">확정된 약속</h1>
          <p className="page-sub">
            투표로 확정된 약속을 모아 봐요. 확정된 약속은 지난 기록에 자동으로 남아요.
          </p>
        </div>
      </div>

      <div
        className="notice"
        style={{
          marginBottom: 28,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <strong>투표는 채팅방에서 만들고 확정해요.</strong>

        <button
          type="button"
          className="btn secondary sm"
          onClick={() => router.push(`/groups/${groupId}/chat`)}
        >
          채팅방으로 →
        </button>
      </div>

      {/* 확정된 약속 */}
      <section>
        <div className="row-between" style={{ marginBottom: 16 }}>
          <h2 className="section-title">확정된 약속 목록</h2>
          {!loading && <span className="chip">{meetings.length}개</span>}
        </div>

        {error ? (
          <div className="card">
            <p className="error">{error}</p>

            <button
              type="button"
              className="btn"
              onClick={() => void loadMeetings()}
              style={{ marginTop: 16 }}
            >
              다시 시도
            </button>
          </div>
        ) : meetings.length === 0 ? (
          <div className="card">
            <p className="card-title">아직 확정된 약속이 없어요.</p>
          </div>
        ) : (
          <div className="stack">
            {meetings.map((meeting) => (
              <article className="card" key={meeting.id}>
                <div className="row-between" style={{ gap: 16 }}>
                  <div className="row" style={{ alignItems: 'flex-start' }}>
                    <span className="avatar lg">📅</span>

                    <div>
                      <h3 className="card-title">{meeting.title}</h3>

                      <p className="muted" style={{ marginTop: 6 }}>
                        {formatDate(meeting.meeting_time)}
                      </p>

                      <p className="muted" style={{ marginTop: 8 }}>
                        📍 {meeting.location || '장소 미정'}
                      </p>
                    </div>
                  </div>

                  <div
                    className="stack"
                    style={{
                      alignItems: 'flex-end',
                      minWidth: 90,
                    }}
                  >
                    <span className="chip">확정</span>

                    <button
                      type="button"
                      className="btn secondary sm"
                      onClick={() => void deleteMeeting(meeting.id)}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
