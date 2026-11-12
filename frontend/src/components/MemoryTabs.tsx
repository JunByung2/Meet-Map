"use client";

import Link from "next/link";
import "./memories.css";

type Tab = "photos" | "map" | "records";

const TITLES: Record<Tab, string> = {
  photos: "사진",
  map: "추억지도",
  records: "지난 기록",
};

/**
 * 추억 안의 자세히 보기 화면(사진 / 추억지도 / 지난 기록)의 맨 위.
 * 탭으로 갈아타는 대신, 한 화면에 모아 둔 "추억" 으로 돌아가는 링크와 제목만 보여 준다.
 */
export default function MemoryTabs({
  groupId,
  current,
  sub,
  action,
}: {
  groupId: string | number;
  current: Tab;
  sub?: string;
  action?: React.ReactNode;
}) {
  return (
    <>
      <Link className="mt-back" href={`/groups/${groupId}/memories`}>
        ← 추억
      </Link>
      <div className="mt-head">
        <div>
          <p className="eyebrow">함께 남긴 순간</p>
          <h1 className="page-title">{TITLES[current]}</h1>
          {sub && <p className="page-sub">{sub}</p>}
        </div>
        {action}
      </div>
    </>
  );
}
