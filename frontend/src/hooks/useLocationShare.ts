"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LocationErrorKind } from "@/features/location/types";

export type SharedLocation = {
  user_id: number;
  nickname: string | null;
  lat: number; // 서버가 500m 격자 중심으로 바꾼 대략적인 위치
  lng: number;
  updated_at: string;
  expires_at: string;
  mine: boolean;
};

export const SHARE_MINUTES = 10;
const REFRESH_MS = 15_000; // 친구 위치 확인 주기
const UPDATE_MS = 20_000; // 내 위치 갱신 주기 (공유 중일 때만, 규칙: 15~30초)
const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0,
};

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// 같은 사이트의 /api 로 요청한다. (로그인 쿠키가 자동으로 붙는다)
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") detail = data.detail;
    } catch {
      /* 본문이 없거나 JSON 이 아니면 무시 */
    }
    throw new HttpError(res.status, detail || "요청에 실패했어요.");
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

class LocationFailure extends Error {
  kind: LocationErrorKind;
  constructor(kind: LocationErrorKind) {
    super(kind);
    this.kind = kind;
  }
}

type Position = { lat: number; lng: number };

function kindOf(err: GeolocationPositionError): LocationErrorKind {
  return err.code === err.PERMISSION_DENIED
    ? "denied"
    : err.code === err.TIMEOUT
      ? "timeout"
      : "unavailable";
}

// 브라우저에서 현재 위치를 한 번 가져온다. (권한 팝업이 뜰 수 있음)
function getPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new LocationFailure("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(new LocationFailure(kindOf(err))),
      GEO_OPTIONS,
    );
  });
}

// 권한 상태 (prompt / granted / denied). 지원하지 않는 브라우저(일부 iOS)는 unknown
async function permissionState(): Promise<PermissionState | "unknown"> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions)
      return "unknown";
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state;
  } catch {
    return "unknown";
  }
}

/** MeetMode: 그룹 친구들에게 내 대략적인 위치 공유 (동의 → 시작 → 갱신 → 중단) */
export function useLocationShare(groupId: number) {
  const [shares, setShares] = useState<SharedLocation[]>([]);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState<LocationErrorKind | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const activeGroup = useRef(groupId);

  const refresh = useCallback(async () => {
    const requested = groupId;
    try {
      const data = await request<SharedLocation[]>(
        `/groups/${requested}/location`,
      );
      if (activeGroup.current !== requested) return;
      setShares(data);
      setNow(Date.now());
    } catch (err) {
      if (activeGroup.current !== requested) return;
      const code = err instanceof HttpError ? err.status : 0;
      if (code === 401) setMessage("로그인이 필요해요. 다시 로그인해 주세요.");
      else if (code === 403)
        setMessage("이 그룹의 위치 정보를 볼 권한이 없어요.");
      // 그 밖의 일시적인 오류는 다음 확인 때 다시 시도한다
    }
  }, [groupId]);

  useEffect(() => {
    activeGroup.current = groupId;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShares([]);
    void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [groupId, refresh]);

  const mine = shares.find((s) => s.mine) ?? null;
  const sharing = mine !== null;

  // 공유를 끝낸다. reason 이 있으면 안내 화면을 같이 띄운다.
  const stop = useCallback(
    async (reason?: LocationErrorKind) => {
      setBusy(true);
      setMessage("");
      try {
        await request(`/groups/${groupId}/location`, { method: "DELETE" });
        await refresh();
        if (reason) setProblem(reason);
      } catch {
        setMessage("공유를 중단하지 못했어요. 다시 시도해 주세요.");
      } finally {
        setBusy(false);
      }
    },
    [groupId, refresh],
  );

  // 공유 중일 때만 위치를 지켜보다가 20초마다 서버로 보낸다
  useEffect(() => {
    if (
      !sharing ||
      typeof navigator === "undefined" ||
      !("geolocation" in navigator)
    )
      return;

    let latest: Position | null = null;
    let failures = 0;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        failures = 0;
        latest = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      },
      (err) => {
        // 공유 중에 권한을 철회하면 즉시 중단하고 안내한다
        if (err.code === err.PERMISSION_DENIED) {
          void stop("denied");
          return;
        }
        failures += 1;
        if (failures >= 3) setProblem(kindOf(err));
      },
      GEO_OPTIONS,
    );

    const timer = window.setInterval(async () => {
      if (!latest) return;
      const pos = latest;
      latest = null;
      try {
        await request(`/groups/${groupId}/location`, {
          method: "PUT",
          body: JSON.stringify(pos),
        });
      } catch (err) {
        if (err instanceof HttpError && err.status === 409) void refresh();
      }
    }, UPDATE_MS);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
    };
  }, [sharing, groupId, refresh, stop]);

  const openAsk = useCallback(() => {
    setMessage("");
    setProblem(null);
    if (sharing) {
      setMessage("이미 내 위치를 공유하고 있어요.");
      return;
    }
    setAsking(true);
  }, [sharing]);

  const cancelAsk = useCallback(() => setAsking(false), []);
  const clearProblem = useCallback(() => setProblem(null), []);

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setProblem(null);
    try {
      // 동의 화면을 거친 뒤에만 여기로 온다. 이미 거부된 상태면 팝업을 다시 띄울 수 없다.
      if ((await permissionState()) === "denied")
        throw new LocationFailure("denied");
      const pos = await getPosition();
      await request(`/groups/${groupId}/location/share`, {
        method: "POST",
        body: JSON.stringify({ ...pos, mode: "ten_min" }),
      });
      setAsking(false);
      await refresh();
    } catch (err) {
      if (err instanceof LocationFailure) setProblem(err.kind);
      else if (err instanceof HttpError)
        setMessage(
          err.status === 403
            ? "이 그룹 멤버만 위치를 공유할 수 있어요."
            : err.message,
        );
      else setMessage("위치를 공유하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }, [busy, groupId, refresh]);

  return {
    shares,
    mine,
    others: shares.filter((s) => !s.mine),
    sharing,
    asking,
    busy,
    message,
    problem,
    now,
    openAsk,
    cancelAsk,
    clearProblem,
    start,
    stop,
  };
}
