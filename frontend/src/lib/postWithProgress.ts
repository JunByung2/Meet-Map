import { ApiError } from "@/lib/api";

// 진행률(%)을 알 수 있게 XMLHttpRequest 로 보내요. 주소·로그인 쿠키는 api() 와 같아요.
export function postWithProgress<T>(path: string, form: FormData, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onerror = () => reject(new ApiError(0, "네트워크가 끊겼어요."));
    xhr.ontimeout = () => reject(new ApiError(0, "응답이 너무 늦어요."));
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        return resolve(data as T);
      }
      const detail = (data as { detail?: unknown } | null)?.detail;
      reject(new ApiError(xhr.status, typeof detail === "string" ? detail : "요청에 실패했습니다."));
    };
    xhr.send(form);
  });
}
