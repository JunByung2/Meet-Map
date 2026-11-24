"use client";

import AppShell from "@/components/AppShell";
import AllMemories from "@/components/AllMemories";

export default function AllMemoriesPage() {
  return (
    <AppShell>
      <div className="page-head am-head">
        <div>
          <p className="eyebrow">내 모든 그룹</p>
          <p className="page-sub">
            내가 속한 모든 그룹의 사진을 모아 봐요. 그룹 색으로 어느 그룹의
            추억인지 구분돼요.
          </p>
        </div>
      </div>
      <AllMemories />
    </AppShell>
  );
}
