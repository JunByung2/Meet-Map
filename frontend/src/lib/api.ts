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
    const message =
      typeof detail === "string" ? detail : "요청에 실패했습니다.";
    throw new ApiError(res.status, message);
  }

  return data as T;
}

// 진행 중인 GET만 공유한다. 응답 완료 후 보관하지 않으며 서버에서는 공유하지 않는다.
const pendingReads = new Map<string, Promise<unknown>>();
export function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  if (typeof window === "undefined") return performRequest<T>(path, options);
  if (method !== "GET" || options.body !== undefined) {
    // 로그인·로그아웃과 수정 이후의 조회는 이전 요청에 합치지 않는다.
    pendingReads.clear();
    return performRequest<T>(path, options).finally(() => pendingReads.clear());
  }
  const existing = pendingReads.get(path);
  if (existing) return existing as Promise<T>;
  const request = performRequest<T>(path, options).finally(() => {
    if (pendingReads.get(path) === request) pendingReads.delete(path);
  });
  pendingReads.set(path, request);
  return request;
}
