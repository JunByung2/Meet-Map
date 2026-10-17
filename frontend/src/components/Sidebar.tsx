"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";

export type ShellGroup = {
  id: number;
  name: string;
  icon?: string | null;
  memberNicknames?: string[];
};

export type ActiveMenu = "home" | "chat" | "photos" | "map";

type GroupDetail = {
  id: number;
  name: string;
  icon?: string | null;
  members?: { nickname: string }[];
};

type LastGroup = { id: number; name: string; icon: string | null };

// 마지막으로 연 그룹을 브라우저에 기억해 둔다. (로그아웃하면 AppShell 이 지운다)
export const LAST_GROUP_KEY = "meetmap:lastGroup";

const AVATAR_TONES = ["", "peach", "lavender"];

function Icon({ d }: { d: string }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

const ICONS = {
  home: "M3 11l9-8 9 8M5 10v10h14V10",
  chat: "M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  map: "M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14",
  photo:
    "M4 5h16v14H4zM8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4 17l5-5 4 4 3-3 4 4",
  archive: "M3 5h18v4H3zM5 9v10h14V9M10 13h4",
};

type NavItem = {
  label: string;
  icon: string;
  key?: ActiveMenu; // 없으면 아직 준비 중인 메뉴 (비활성)
  path?: string;
};

const NAV: NavItem[] = [
  { label: "그룹 홈", icon: ICONS.home, key: "home" },
  { label: "채팅", icon: ICONS.chat, key: "chat", path: "chat" },
  { label: "약속", icon: ICONS.calendar },
  { label: "지도", icon: ICONS.map, key: "map", path: "map" },
  { label: "사진", icon: ICONS.photo, key: "photos", path: "photos" },
  { label: "지난 기록", icon: ICONS.archive },
];

function hrefFor(
  item: NavItem,
  homeId: number | null,
  navId: number | null,
): string | null {
  if (!item.key) return null;
  if (item.key === "home") return homeId ? `/groups/${homeId}` : "/groups";
  return navId ? `/groups/${navId}/${item.path}` : null;
}

export default function Sidebar({
  group,
  active,
}: {
  group?: ShellGroup;
  active?: ActiveMenu;
}) {
  const pathname = usePathname();
  const [fetched, setFetched] = useState<ShellGroup | null>(null);
  const [lastGroup, setLastGroup] = useState<LastGroup | null>(null);

  // 주소에서 그룹 번호를 읽는다: /groups/4, /groups/4/chat ...
  const pathMatch = /^\/groups\/(\d+)(?:\/|$)/.exec(pathname);
  const pathId = pathMatch ? Number(pathMatch[1]) : null;

  // 페이지가 group 을 안 넘겨줬으면 직접 불러온다
  useEffect(() => {
    if (group || !pathId) return;
    let cancelled = false;
    api<GroupDetail>(`/groups/${pathId}`)
      .then((g) => {
        if (cancelled) return;
        setFetched({
          id: g.id,
          name: g.name,
          icon: g.icon ?? null,
          memberNicknames: g.members?.map((m) => m.nickname),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [group, pathId]);

  // 마지막으로 연 그룹 읽기
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_GROUP_KEY);
      if (raw) {
        const v = JSON.parse(raw) as LastGroup;
        if (v && typeof v.id === "number") {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setLastGroup(v);
        }
      }
    } catch {
      /* 저장소를 못 쓰는 환경이면 무시 */
    }
  }, []);

  const info = group ?? (fetched && fetched.id === pathId ? fetched : null);
  const infoId = info?.id;
  const infoName = info?.name;
  const infoIcon = info?.icon ?? null;

  // 그룹 정보를 알게 되면 마지막 그룹으로 기억
  useEffect(() => {
    if (infoId === undefined || !infoName) return;
    try {
      localStorage.setItem(
        LAST_GROUP_KEY,
        JSON.stringify({ id: infoId, name: infoName, icon: infoIcon }),
      );
    } catch {
      /* 무시 */
    }
  }, [infoId, infoName, infoIcon]);

  const homeId = info?.id ?? pathId;
  const navId = homeId ?? lastGroup?.id ?? null;

  const isMapPage =
    pathname === "/map" || /^\/groups\/[^/]+\/map(?:\/|$)/.test(pathname);
  const isPhotosPage = /^\/groups\/[^/]+\/photos(?:\/|$)/.test(pathname);
  const isChatPage = /^\/groups\/[^/]+\/chat(?:\/|$)/.test(pathname);
  const derived: ActiveMenu = isMapPage
    ? "map"
    : isPhotosPage
      ? "photos"
      : isChatPage
        ? "chat"
        : "home";
  const current: ActiveMenu = active ?? derived;

  const nicknames = info?.memberNicknames;

  return (
    <aside className="sidebar">
      {info ? (
        <div className="current-group">
          <div className="label">현재 그룹</div>
          <div className="name">
            {info.icon ? `${info.icon} ` : ""}
            {info.name}
          </div>
          {nicknames && <div className="sub">친구 {nicknames.length}명</div>}
        </div>
      ) : (
        <div className="current-group">
          <div className="label">내 공간</div>
          <div className="name">내 그룹</div>
          <div className="sub">그룹을 고르거나 새로 만들어요</div>
        </div>
      )}

      <nav className="nav">
        {NAV.map((item) => {
          const href = hrefFor(item, homeId, navId);
          if (!href) {
            return (
              <span className="nav-item disabled" key={item.label}>
                <Icon d={item.icon} />
                {item.label}
              </span>
            );
          }
          return (
            <Link
              key={item.label}
              href={href}
              className={`nav-item${current === item.key ? " active" : ""}`}
            >
              <Icon d={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {nicknames && nicknames.length > 0 && (
        <>
          <hr className="divider" style={{ margin: 0 }} />
          <div className="side-label">함께 기록하는 친구들</div>
          <div>
            {nicknames.map((n, i) => (
              <div className="friend-row" key={`${n}-${i}`}>
                <span
                  className={`avatar sm ${AVATAR_TONES[i % AVATAR_TONES.length]}`}
                >
                  {n.slice(0, 1)}
                </span>
                <span>{n}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="lock-note">
        이 그룹의 사진과 대화는 그룹 친구에게만 보여요.
      </div>
    </aside>
  );
}
