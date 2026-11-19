export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function performRequest<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    // FormData(사진 업로드)는 브라우저가 Content-Type 을 알아서 붙이므로 JSON 처리를 하지 않는다
    headers:
      options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : undefined,
    body: !options.body
      ? undefined
      : options.body instanceof FormData
        ? options.body
        : JSON.stringify(options.body),
    credentials: "same-origin",
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const detail = data?.detail;
    // 입력 검사에 걸리면 서버가 항목별 목록으로 알려 준다. 첫 번째 안내 문구를 그대로 보여 준다.
    const first = Array.isArray(detail) ? detail[0]?.msg : undefined;
    const message =
      typeof detail === "string"
        ? detail
        : typeof first === "string"
          ? first.replace(/^Value error, /, "")
          : "요청에 실패했습니다.";
    throw new ApiError(res.status, message);
  }

  return data as T;
}

// Only navigation metadata is reused briefly. Live chat, votes and locations stay uncached.
const pendingReads = new Map<string, Promise<unknown>>();
const metadata = new Map<string, { value: unknown; expires: number; staleUntil: number }>();
let generation = 0;
let writes = 0;
type Watcher = { refresh: () => void; reset: (error: ApiError) => void };
const watchers = new Set<Watcher>();
function refreshWatchers() { if (!writes) watchers.forEach((w) => w.refresh()); }
function resetWatchers(error: ApiError) { watchers.forEach((w) => w.reset(error)); }
const INVALIDATE_KEY = "meetmap:invalidate-metadata";
function clearReads() {
  generation += 1;
  pendingReads.clear();
  metadata.clear();
}
function broadcastClear() {
  clearReads();
  try { localStorage.setItem(INVALIDATE_KEY, `${Date.now()}:${Math.random()}`); } catch { /* optional */ }
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === INVALIDATE_KEY || event.key === null) {
      clearReads();
      resetWatchers(new ApiError(0, "계정 또는 그룹 정보가 변경되어 확인 중입니다."));
      refreshWatchers();
    }
  });
  window.addEventListener("focus", refreshWatchers);
}
function metadataTtl(path: string) {
  return path === "/auth/me" || /^\/groups\/\d+$/.test(path) ? 15_000 : 0;
}
export function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  if (typeof window === "undefined") return performRequest<T>(path, options);
  if (method !== "GET" || options.body !== undefined) {
    writes += 1;
    broadcastClear();
    if (path.startsWith("/auth/")) resetWatchers(new ApiError(0, "계정 정보를 확인 중입니다."));
    return performRequest<T>(path, options).finally(() => {
      writes -= 1;
      broadcastClear();
      refreshWatchers();
    });
  }
  const hit = metadata.get(path);
  if (!writes && hit && hit.expires > Date.now()) return Promise.resolve(hit.value as T);
  if (hit && hit.staleUntil <= Date.now()) metadata.delete(path);
  const existing = pendingReads.get(path);
  if (existing) return existing as Promise<T>;
  const started = generation;
  const request = performRequest<T>(path, options).then((value) => {
    const ttl = metadataTtl(path);
    if (ttl && !writes && started === generation) {
      if (metadata.size >= 30) metadata.delete(metadata.keys().next().value!);
      metadata.set(path, { value, expires: Date.now() + ttl, staleUntil: Date.now() + 300_000 });
    }
    return value;
  }).catch((error) => {
    if (started === generation && error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      clearReads();
      resetWatchers(error);
    }
    throw error;
  }).finally(() => {
    if (pendingReads.get(path) === request) pendingReads.delete(path);
  });
  pendingReads.set(path, request);
  return request;
}

/** Opt-in stale-while-revalidate for read-only navigation metadata, never edit forms. */
export function watchApi<T>(path: string, onValue: (value: T) => void, onError: (error: unknown) => void) {
  let active = true;
  let sequence = 0;
  const hit = metadata.get(path);
  if (!writes && hit && hit.staleUntil > Date.now()) onValue(hit.value as T);
  const watcher: Watcher = {
    refresh() {
      if (!active || writes) return;
      const current = ++sequence;
      const epoch = generation;
      void api<T>(path).then((value) => {
        if (active && current === sequence && epoch === generation) onValue(value);
      }).catch((error) => {
        if (active && current === sequence && epoch === generation) onError(error);
      });
    },
    reset(error) {
      sequence += 1;
      if (active) onError(error);
    },
  };
  watchers.add(watcher);
  watcher.refresh();
  return () => { active = false; sequence += 1; watchers.delete(watcher); };
}
