import { useEffect, useState } from "react";

// 친구 이름을 어떻게 보여 줄지: 그룹 별명 우선("alias") / 원래 닉네임("nickname")
export type NameMode = "alias" | "nickname";

export const NAME_MODE_KEY = "meetmap:nameMode";

export function readNameMode(): NameMode {
  try {
    return localStorage.getItem(NAME_MODE_KEY) === "nickname"
      ? "nickname"
      : "alias";
  } catch {
    return "alias";
  }
}

export function saveNameMode(mode: NameMode): void {
  try {
    localStorage.setItem(NAME_MODE_KEY, mode);
  } catch {
    /* 저장소를 못 쓰는 환경이면 무시 */
  }
}

// 서버가 내려 주는 두 이름 중 고른 방식에 맞는 이름을 돌려준다
export function pickName(
  p: { nickname: string | null; account_nickname?: string | null },
  mode: NameMode,
): string {
  if (mode === "nickname") return p.account_nickname ?? p.nickname ?? "";
  return p.nickname ?? p.account_nickname ?? "";
}

export function useNameMode(): NameMode {
  const [mode, setMode] = useState<NameMode>("alias");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(readNameMode());
  }, []);
  return mode;
}
