"use client";

import type { OutGroup } from "@/hooks/useOutgoingPhotos";
import css from "./outgoing.module.css";
import { bubbleWidth, rowsOf, splitRows } from "@/lib/bundleLayout";

const SHOW_MAX = 16; // 보내는 말풍선에는 16장까지 보여 준다 (4x4)

export default function OutgoingPhotos({
  groups,
  onRetry,
  onDiscard,
  onSendDone,
}: {
  groups: OutGroup[];
  onRetry: (key: string) => void;
  onDiscard: (key: string) => void;
  onSendDone: (key: string) => void;
}) {
  if (groups.length === 0) return null;
  return (
    <div className={css.wrap} aria-live="polite">
      {groups.map((g) => {
        const total = g.items.length;
        const done = g.items.filter((i) => i.status === "done").length;
        const failed = g.items.filter((i) => i.status === "fail").length;
        const sending = failed === 0 || g.working; // 아직 올리는 중이면 사진 위에 하나의 로딩 표시
        const shownItems = g.items.slice(0, SHOW_MAX);
        const rows = total === 1 ? [1] : rowsOf(shownItems.length);
        const cellEls = shownItems.map((i) => (
                  <button
                    type="button"
                    key={i.id}
                    className={`${css.cell} ${i.status === "fail" && !g.working ? css.fail : ""}`}
                    disabled={i.status !== "fail" || g.working}
                    onClick={() => onRetry(g.key)}
                    title={i.status === "fail" ? `${i.error ?? "올리지 못했어요."} (눌러서 다시 시도)` : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={i.preview} alt="" />
                    {i.status === "fail" && !g.working && (
                      <span className={css.over}>
                        <b>!</b>
                      </span>
                    )}
                  </button>
                ));
        return (
          <div className={css.bubble} key={g.key}>
            <div className={css.stage}>
              <div className={css.mosaic} style={{ width: total === 1 ? 244 : bubbleWidth(rows) }}>
                {splitRows(cellEls, rows).map((row, r) => (
                  <div className={css.mrow} key={r}>
                    {row}
                  </div>
                ))}
              </div>
              {sending && (
                <div className={css.loading}>
                  <span className={css.spin} />
                  <strong>
                    {done}/{total}
                  </strong>
                </div>
              )}
            </div>
            {total > SHOW_MAX && <p className={css.more}>외 {total - SHOW_MAX}장</p>}
            {failed > 0 && !g.working && (
              <div className={css.foot}>
                <span className={css.warn}>{failed}장을 올리지 못했어요</span>
                <div className={css.btns}>
                  <button type="button" className="btn sm" onClick={() => onRetry(g.key)}>
                    다시 시도
                  </button>
                  {done > 0 && (
                    <button type="button" className="btn secondary sm" onClick={() => onSendDone(g.key)}>
                      올라간 {done}장만 보내기
                    </button>
                  )}
                  <button type="button" className="btn secondary sm" onClick={() => onDiscard(g.key)}>
                    취소
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
