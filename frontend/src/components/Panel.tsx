import type { ReactNode } from "react";

/** 새 디자인의 패널: 갈색 머리띠(작은 영문 제목 + 큰 제목) 아래에 내용이 들어간다. */
export default function Panel({
  title,
  kicker,
  action,
  className = "",
  children,
}: {
  title: string;
  kicker?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-head">
        <div>
          {kicker && <span className="panel-kicker">{kicker}</span>}
          <h2>{title}</h2>
        </div>
        {action}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
