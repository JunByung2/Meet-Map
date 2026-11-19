"use client";

import AppShell from "@/components/AppShell";
import AllMemories from "@/components/AllMemories";

export default function AllMemoriesPage() {
  return (
    <AppShell>
      <div className="page-head">
        <div>
          <p className="eyebrow">내 모든 그룹</p>
          <h1 className="page-title">추억</h1>
          <p className="page-sub">
            내가 속한 모든 그룹의 사진과 지난 기록을 모아 봐요. 그룹 색으로 어느
            그룹의 추억인지 구분돼요.
          </p>
        </div>
      </div>
      <AllMemories />
    </AppShell>
  );
}
