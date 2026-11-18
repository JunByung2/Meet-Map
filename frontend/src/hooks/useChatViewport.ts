"use client";

import { useEffect, useRef } from "react";

// Only the shared shell owns the mobile chat viewport; child panels use flex sizing.
export function useChatViewport(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const mq = window.matchMedia("(max-width: 650px)");
    const viewport = window.visualViewport;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!mq.matches) {
          delete el.dataset.keyboard;
          return;
        }
        const height = viewport?.height ?? window.innerHeight;
        const focused = document.activeElement;
        const editing = focused instanceof HTMLElement &&
          (focused.matches("input, textarea") || focused.isContentEditable);
        const keyboard = editing && window.innerHeight - height > 120;
        el.dataset.keyboard = keyboard ? "open" : "closed";
        el.style.setProperty("--chat-viewport-height", `${height}px`);
        el.style.setProperty("--chat-viewport-top", `${viewport?.offsetTop ?? 0}px`);
      });
    };
    fit();
    window.addEventListener("resize", fit);
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    document.addEventListener("focusin", fit);
    document.addEventListener("focusout", fit);
    mq.addEventListener("change", fit);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", fit);
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      document.removeEventListener("focusin", fit);
      document.removeEventListener("focusout", fit);
      mq.removeEventListener("change", fit);
      delete el.dataset.keyboard;
      el.style.removeProperty("--chat-viewport-height");
      el.style.removeProperty("--chat-viewport-top");
    };
  }, [enabled]);
  return ref;
}
