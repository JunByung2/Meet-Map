"use client";

import PhotoShell from "@/components/PhotoShell";
import MemoryHome from "@/components/MemoryHome";

export default function MemoriesPage() {
  return (
    <PhotoShell active="memories">
      {({ groupId, onApiError }) => (
        <>
          <div className="mt-head">
            <div>
              <p className="eyebrow">함께 남긴 순간</p>
              <h1 className="page-title">추억</h1>
              <p className="page-sub">지난 기록 · 추억지도 · 사진을 한곳에서 봐요.</p>
            </div>
          </div>
          <MemoryHome groupId={groupId} onApiError={onApiError} />
        </>
      )}
    </PhotoShell>
  );
}
