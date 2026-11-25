"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Photo } from "@/lib/photos";
import Avatar from "@/components/Avatar";
import Panel from "@/components/Panel";
import GroupsMeetingCalendar from "@/features/calendar/GroupsMeetingCalendar";
import GroupChatPreview from "./GroupChatPreview";
import css from "./homeBoard.module.css";
import Ico from "@/components/Ico";

// 빠른 실행·친구 목록에 쓰는 선 아이콘 (색은 글자색을 따라간다)
const P = {
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  pin: "M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.3a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6z",
  camera: "M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
  chat: "M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z",
  users:
    "M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM21 20v-1.5a4 4 0 0 0-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6",
};

function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ verticalAlign: "-0.15em", flexShrink: 0 }}
    >
      <path d={d} />
    </svg>
  );
}

type Meeting = {
  id: number;
  group_id: number;
  title: string;
  location: string;
  meeting_time: string;
  status: string;
  participant_ids?: number[];
};

type Member = {
  user_id: number;
  nickname: string;
  profile_image: string | null;
};

type Me = {
  id: number;
  nickname: string;
};

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

const WEEK = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const TONES = ["", "peach", "lavender"];

function dayDiff(iso: string) {
  const d = new Date(iso);
  const n = new Date();
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.round((a - b) / 86400000);
}

function timeText(iso: string) {
  return new Date(iso).toLocaleTimeString("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * 그룹 홈 대시보드
 * - 약속 달력
 * - NEXT MEETING
 * - 빠른 실행
 * - 최근 추억
 * - 그룹 채팅 미리보기
 */
export default function HomeBoard({
  group,
  members,
  meetings,
  nextMeeting,
}: {
  group: { id: number; name: string; icon: string | null };
  members: Member[];
  meetings: Meeting[] | null;
  nextMeeting: Meeting | undefined;
}) {
  const base = `/groups/${group.id}`;

  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  // 최근 사진 불러오기
  useEffect(() => {
    let active = true;

    api<Photo[]>(`${base}/photos`)
      .then((list) => {
        if (active) setPhotos(list);
      })
      .catch(() => {
        if (active) setPhotos([]);
      });

    return () => {
      active = false;
    };
  }, [base]);

  // 현재 로그인한 사용자 확인
  useEffect(() => {
    let active = true;

    api<Me>("/auth/me")
      .then((user) => {
        if (active) setCurrentUserId(user.id);
      })
      .catch(() => {
        if (active) setCurrentUserId(null);
      });

    return () => {
      active = false;
    };
  }, []);

  // 최근 사진 4장
  const recent = [...(photos ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
    .slice(0, 4);

  // 다가오는 약속 개수
  const upcomingCount = (meetings ?? []).filter(
    (m) => m.status !== "cancelled" && dayDiff(m.meeting_time) >= 0,
  ).length;

  const when = nextMeeting ? new Date(nextMeeting.meeting_time) : null;

  const diff = nextMeeting ? dayDiff(nextMeeting.meeting_time) : 0;

  // ==========================================
  // NEXT MEETING 참석자 계산
  // ==========================================

  // 해당 약속에 지정된 참여자 ID
  const participantIds = new Set(nextMeeting?.participant_ids ?? []);

  // 그룹 멤버 중 해당 약속에 참여하는 사람
  const attendingMembers = members.filter((member) =>
    participantIds.has(member.user_id),
  );

  // 참석 인원
  const attendingCount = attendingMembers.length;

  // 참석자로 지정되지 않은 인원
  const undecidedCount = Math.max(0, members.length - attendingCount);

  // 현재 로그인한 사용자의 참여 여부
  const isAttending =
    currentUserId !== null && participantIds.has(currentUserId);

  // 개인별 참석 상태 문구
  const attendanceLabel =
    currentUserId === null || participantIds.size === 0
      ? "미정이에요"
      : isAttending
        ? "참석할게!"
        : "불참할게!";

  return (
    <div className={css.board}>
      {/* ======================================
          1. 약속 달력
      ====================================== */}
      <Panel
        title="약속 달력"
        kicker="SCHEDULE"
        className={css.calendar}
        action={
          <Link className="panel-action" href={`${base}/meetings`}>
            + 약속 만들기
          </Link>
        }
      >
        <GroupsMeetingCalendar
          groups={[
            {
              id: group.id,
              name: group.name,
              icon: group.icon,
            },
          ]}
          meetings={meetings ?? []}
          selectionOnly
          dashboard
          compactMobile
        />
      </Panel>

      {/* ======================================
          2. 중앙 영역
      ====================================== */}
      <div className={css.middle}>
        {/* NEXT MEETING */}
        <article className={css.ticket}>
          <div className={css.ticketTop}>
            <span>NEXT MEETING</span>
            <small>
              {nextMeeting ? (diff <= 0 ? "TODAY" : `D-${diff}`) : "—"}
            </small>
          </div>

          {meetings === null ? (
            <p className={css.ticketEmpty}>불러오는 중…</p>
          ) : nextMeeting && when ? (
            <>
              {/* 약속 날짜와 기본 정보 */}
              <div className={css.ticketContent}>
                <div className={css.ticketDate}>
                  <b>{when.getDate()}</b>
                  <span>
                    {MONTHS[when.getMonth()]}
                    <br />
                    {WEEK[when.getDay()]}
                  </span>
                </div>

                <div className={css.ticketCopy}>
                  <h3>{nextMeeting.title}</h3>

                  <p>
                    <Ico n="clock" /> {timeText(nextMeeting.meeting_time)}
                  </p>

                  {nextMeeting.location && (
                    <p>
                      <Ico n="pin" /> {nextMeeting.location}
                    </p>
                  )}
                </div>
              </div>

              {/* 참석자 프로필 및 인원 */}
              <div className={css.ticketPeople}>
                <div className={css.stack}>
                  {attendingMembers.slice(0, 5).map((m, i) => (
                    <Avatar
                      key={m.user_id}
                      userId={m.user_id}
                      name={m.nickname}
                      image={m.profile_image}
                      size="sm"
                      tone={TONES[i % TONES.length]}
                    />
                  ))}
                </div>

                <span>
                  <b>{attendingCount}명 참석</b>
                  {" · "}
                  <b>{undecidedCount}명 미정</b>
                </span>
              </div>

              {/* 약속 관련 버튼 */}
              <div className={css.ticketActions}>
                <Link className="btn secondary sm" href={`${base}/meetings`}>
                  약속 보기
                </Link>

                <Link
                  className="btn secondary sm"
                  href={`${base}/map?view=transit`}
                >
                  경로 보기
                </Link>

                {/* 내 참석 상태 */}
                <Link className={css.burst} href={`${base}/meetings`}>
                  {attendanceLabel}
                </Link>
              </div>
            </>
          ) : (
            <div className={css.ticketEmpty}>
              <p>아직 예정된 약속이 없어요.</p>

              <Link className="btn sm" href={`${base}/meetings`}>
                + 약속 만들기
              </Link>
            </div>
          )}
        </article>

        {/* ======================================
            3. 빠른 실행
        ====================================== */}
        <Panel title="빠른 실행" kicker="QUICK ACTION" className={css.quick}>
          <div className={css.quickGrid}>
            <Link href={`${base}/meetings`}>
              <Icon d={P.calendar} size={18} />
              <span> 약속 만들기</span>
            </Link>
            <Link href={`${base}/map?view=transit`}>
              <Icon d={P.pin} size={18} />
              <span> 장소 찾기</span>
            </Link>
            <Link href={`${base}/photos/upload`}>
              <Icon d={P.camera} size={18} />
              <span> 사진 올리기</span>
            </Link>
            <Link href={`${base}/chat`}>
              <Icon d={P.chat} size={18} />
              <span> 대화하기</span>
            </Link>
          </div>
          <div className={css.friends}>
            <div className={css.friendsHead}>
              <span>
                <Icon d={P.users} size={14} /> 함께하는 친구{" "}
                <b>{members.length}명</b>
              </span>
              <a href="#group-manage">초대 · 관리 ↓</a>
            </div>
            <div className={css.avatars}>
              {members.slice(0, 8).map((m, i) => (
                <Avatar
                  key={m.user_id}
                  userId={m.user_id}
                  name={m.nickname}
                  image={m.profile_image}
                  size="sm"
                  tone={["", "peach", "lavender"][i % 3]}
                />
              ))}
              {members.length > 8 && (
                <span className={css.more8}>+{members.length - 8}</span>
              )}
            </div>
          </div>
        </Panel>
      </div>

      {/* ======================================
          4. 오른쪽 영역
      ====================================== */}
      <div className={css.right}>
        {/* 최근 추억 */}
        <Panel
          title="최근 추억"
          kicker="OUR MEMORIES"
          className={css.memories}
          action={
            <Link className="panel-action" href={`${base}/memories`}>
              더 보기 →
            </Link>
          }
        >
          {recent.length > 0 ? (
            <div className={css.photoGrid}>
              {recent.map((p) => (
                <Link key={p.id} href={`${base}/photos/${p.id}`}>
                  <figure>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.signed_url || p.url || ""}
                      alt={p.title || p.caption || "그룹 사진"}
                      loading="lazy"
                      decoding="async"
                    />

                    <figcaption>
                      {p.title || p.caption || "함께한 순간"}
                    </figcaption>
                  </figure>
                </Link>
              ))}
            </div>
          ) : (
            <p className={css.empty}>
              {photos === null
                ? "불러오는 중…"
                : "아직 사진이 없어요. 첫 사진을 남겨 보세요."}
            </p>
          )}
        </Panel>

        {/* 그룹 채팅 미리보기 */}
        <Panel
          title="그룹 채팅"
          kicker="LOBBY TALK"
          className={css.chat}
          action={
            <Link className="panel-action" href={`${base}/chat`}>
              전체 보기 →
            </Link>
          }
        >
          <GroupChatPreview groupId={group.id} />
        </Panel>
      </div>
    </div>
  );
}
