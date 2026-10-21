export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
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
