"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * 모바일에서 다른 메뉴(탭)로 옮겨 갈 때 화면이 이전 스크롤 위치 그대로 열리는 일이 있어서,
 * 주소(경로)가 바뀌면 한 번만 맨 위로 올린다.
 * 스크롤 이벤트를 계속 붙잡고 있지 않고, 이동한 그 순간 딱 한 번만 움직이므로 렉이 생기지 않는다.
 * (같은 화면 안에서 ?date= 같은 값만 바뀔 때는 건드리지 않는다.)
 */
export default function ScrollTopOnRoute() {
  const pathname = usePathname();
  const prev = useRef<string | null>(null);

  useEffect(() => {
    if (prev.current !== null && prev.current !== pathname && window.matchMedia("(max-width: 900px)").matches) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
    }
    prev.current = pathname;
  }, [pathname]);

  return null;
}
