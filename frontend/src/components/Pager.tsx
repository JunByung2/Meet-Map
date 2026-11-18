"use client";

/** 목록 아래에 두는 이전 / 다음 페이지 버튼 (한 페이지뿐이면 아무것도 그리지 않는다) */
export const PAGE_SIZE = 6;

export function pageCount(total: number, size = PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / size));
}

export default function Pager({
  page,
  pages,
  onChange,
}: {
  page: number;
  pages: number;
  onChange: (p: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav
      aria-label="페이지 이동"
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 12,
        marginTop: 16,
      }}
    >
      <button
        type="button"
        className="btn secondary sm"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        ‹ 이전
      </button>
      <span className="muted" aria-live="polite">
        {page} / {pages}
      </span>
      <button
        type="button"
        className="btn secondary sm"
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
      >
        다음 ›
      </button>
    </nav>
  );
}
