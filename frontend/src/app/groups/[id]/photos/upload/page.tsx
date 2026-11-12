"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PlacePicker from "@/components/PlacePicker";
import PhotoShell from "@/components/PhotoShell";
import { ApiError } from "@/lib/api";
import { shrinkImage } from "@/lib/imageShrink";
import { hasAllowedExtension, MAX_BYTES, MAX_FILES, type PlaceValue } from "@/lib/photos";

type Status = "wait" | "up" | "done" | "fail";
type Item = { id: string; file: File; caption: string; preview: string; status: Status };

// 사진을 이 장수씩 끊어서 올려요. 한 번에 너무 크게 보내다 끊기는 걸 막고, 진행률을 보여주기 위해서예요.
const CHUNK = 3;

// 진행률을 알 수 있도록 fetch 대신 XMLHttpRequest 로 보낸다 (같은 주소·같은 로그인 쿠키)
function sendChunk(url: string, form: FormData, onProgress: (loaded: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded, e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, "네트워크 연결이 끊겼어요. 다시 시도해 주세요."));
    xhr.ontimeout = () => reject(new ApiError(0, "응답이 너무 오래 걸려요. 다시 시도해 주세요."));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = "요청에 실패했습니다.";
      try {
        const detail = JSON.parse(xhr.responseText)?.detail;
        if (typeof detail === "string") message = detail;
      } catch {}
      reject(new ApiError(xhr.status, message));
    };
    xhr.send(form);
  });
}

export default function UploadPage() {
  return (
    <PhotoShell>
      {({ groupId, onApiError }) => <Upload groupId={groupId} onApiError={onApiError} />}
    </PhotoShell>
  );
}

function Upload({ groupId, onApiError }: { groupId: string; onApiError: (e: unknown) => string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [place, setPlace] = useState<PlaceValue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0); // 0~100
  const batchRef = useRef<string | null>(null); // 같은 저장 안에서는 같은 묶음 번호를 써야 이어 올릴 수 있어요
  const started = items.some((i) => i.status !== "wait"); // 한 장이라도 올라가기 시작하면 목록을 바꿀 수 없어요
  const doneCount = items.filter((i) => i.status === "done").length;
  const failCount = items.filter((i) => i.status === "fail").length;

  function onFiles(list: FileList | null) {
    if (!list || busy || started) return;
    setError("");
    const incoming = Array.from(list);
    if (items.length + incoming.length > MAX_FILES) {
      setError(`한 번에 최대 ${MAX_FILES}장까지 선택할 수 있어요.`);
      return;
    }
    if (incoming.some((f) => !hasAllowedExtension(f))) {
      setError("JPG, PNG, WEBP, HEIC 사진만 올릴 수 있어요. (GIF·PDF 등은 안 돼요)");
      return;
    }
    if (incoming.some((f) => f.size > MAX_BYTES)) {
      setError("사진 한 장은 20MB 이하여야 해요. 용량을 줄인 뒤 다시 선택해 주세요.");
      return;
    }
    setItems((cur) => [
      ...cur,
      ...incoming.map((file) => ({ id: crypto.randomUUID(), file, caption: "", preview: URL.createObjectURL(file), status: "wait" as Status })),
    ]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function removeItem(id: string) {
    setItems((cur) => {
      const gone = cur.find((i) => i.id === id);
      if (gone) URL.revokeObjectURL(gone.preview);
      return cur.filter((i) => i.id !== id);
    });
  }

  function setStatus(from: number, to: number, status: Status) {
    setItems((cur) => cur.map((x, idx) => (idx >= from && idx < to ? { ...x, status } : x)));
  }

  async function save() {
    setError("");
    if (!items.length) {
      setError("업로드할 사진을 선택해 주세요.");
      return;
    }
    if (!batchRef.current) batchRef.current = crypto.randomUUID();
    const batch = batchRef.current;
    const snapshot = items; // 이 시점의 목록 (올리는 동안은 바뀌지 않아요)
    const totalBytes = snapshot.reduce((n, i) => n + i.file.size, 0) || 1;
    let doneBytes = snapshot.filter((i) => i.status === "done").reduce((n, i) => n + i.file.size, 0);
    setProgress(Math.round((doneBytes / totalBytes) * 100));
    setBusy(true);
    let firstError = "";
    for (let from = 0; from < snapshot.length; from += CHUNK) {
      const to = Math.min(from + CHUNK, snapshot.length);
      const part = snapshot.slice(from, to);
      if (part.every((i) => i.status === "done")) continue; // 이미 올라간 조각은 건너뛰어요
      const partBytes = part.reduce((n, i) => n + i.file.size, 0);
      setStatus(from, to, "up");
      try {
        const form = new FormData();
        // 폰 사진(5~10MB)을 올리기 전에 줄여서 올려요 → 업로드도, 나중에 사진 목록 불러오기도 훨씬 빨라져요
        const files = await Promise.all(part.map((i) => shrinkImage(i.file)));
        part.forEach((i, k) => {
          form.append("files", files[k]);
          form.append("captions", i.caption.trim());
        });
        form.append("title", title.trim());
        form.append("memo", memo.trim());
        form.append("batch_id", batch);
        form.append("start_index", String(from));
        if (place) {
          // 장소를 골랐다면 사진과 함께 저장 → 추억지도에 마커로 표시돼요
          if (place.id) form.append("place_id", place.id);
          form.append("place_name", place.name);
          if (place.address) form.append("place_address", place.address);
          form.append("place_lat", String(place.lat));
          form.append("place_lng", String(place.lng));
        }
        await sendChunk(`/api/groups/${groupId}/photos`, form, (loaded, total) => {
          setProgress(Math.min(99, Math.round(((doneBytes + partBytes * (loaded / total)) / totalBytes) * 100)));
        });
        doneBytes += partBytes;
        setStatus(from, to, "done");
        setProgress(Math.round((doneBytes / totalBytes) * 100));
      } catch (e) {
        setStatus(from, to, "fail");
        if (!firstError) firstError = onApiError(e);
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) break; // 로그인/권한 문제는 계속해도 소용없어요
      }
    }
    setBusy(false);
    if (firstError) {
      setError(firstError);
      return;
    }
    snapshot.forEach((i) => URL.revokeObjectURL(i.preview));
    router.push(`/groups/${groupId}/photos`);
  }

  const back = `/groups/${groupId}/photos`;

  return (
    <>
      <p style={{ marginBottom: 16 }}>
        <Link href={back} className="link-arrow">
          ← 사진 모음으로
        </Link>
      </p>
      <div className="page-head">
        <div>
          <p className="eyebrow">그룹 사진</p>
          <h1 className="page-title">사진 올리기</h1>
          <p className="page-sub">올린 사진은 이 그룹의 친구들만 볼 수 있어요.</p>
        </div>
      </div>

      <div className="ph-two">
        <div className="stack">
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 14 }}>
              사진 선택
            </h2>
            <button
              type="button"
              className="ph-drop"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                onFiles(e.dataTransfer.files);
              }}
            >
              <strong>사진을 끌어 놓거나 눌러서 선택해 주세요</strong>
              <span>JPG · PNG · WEBP · HEIC / 한 번에 최대 {MAX_FILES}장 · 장당 20MB 이하</span>
            </button>
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple
              accept="image/*"
              onChange={(e) => onFiles(e.target.files)}
            />
            <p className="ph-hint">여러 장을 함께 올리면 갤러리에서 한 묶음으로 보여요. 실제 파일은 [사진 저장하기]를 눌러야 올라가요.</p>

            {items.length > 0 && (
              <div className="ph-tiles">
                {items.map((item, i) => (
                  <div className="ph-tile" key={item.id}>
                    <div className="ph-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.preview} alt={`선택한 사진 ${i + 1}`} />
                      <span className="ph-badge">{i === 0 ? "대표 사진" : `${i + 1}번째`}</span>
                      {item.status !== "wait" && (
                        <span className={`ph-state ${item.status}`}>
                          {item.status === "up" ? "올리는 중…" : item.status === "done" ? "✓ 완료" : "실패"}
                        </span>
                      )}
                      {!busy && !started && (
                        <button className="ph-remove" type="button" onClick={() => removeItem(item.id)} aria-label={`${item.file.name} 선택 취소`}>
                          ×
                        </button>
                      )}
                    </div>
                    <label htmlFor={`cap-${item.id}`}>사진 설명 (선택)</label>
                    <input
                      id={`cap-${item.id}`}
                      className="input"
                      style={{ height: 40 }}
                      value={item.caption}
                      maxLength={200}
                      disabled={busy || item.status === "done"}
                      placeholder="한마디"
                      onChange={(e) => setItems((cur) => cur.map((x) => (x.id === item.id ? { ...x, caption: e.target.value } : x)))}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 14 }}>
              간단한 기록
            </h2>
            <div className="field">
              <label htmlFor="ph-date">함께한 날짜 *</label>
              <input id="ph-date" className="input" value="저장하는 날짜로 기록돼요" disabled readOnly />
            </div>
            <div className="field">
              <label htmlFor="ph-title">
                사진 제목 <span className="meta">(선택)</span>
              </label>
              <input id="ph-title" className="input" value={title} maxLength={60} placeholder="예. 서울숲에서 보낸 오후" onChange={(e) => setTitle(e.target.value)} />
              <span className="hint">{title.length} / 60자</span>
            </div>
            <div className="field">
              <label htmlFor="ph-memo">
                한마디 메모 <span className="meta">(선택)</span>
              </label>
              <textarea id="ph-memo" className="ph-textarea" value={memo} maxLength={500} placeholder="별다른 계획 없이 걷기만 해도 좋았던 날." onChange={(e) => setMemo(e.target.value)} />
              <span className="hint">{memo.length} / 500자 · 제목과 메모는 이번에 올리는 사진 전체에 저장돼요</span>
            </div>
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 14 }}>
              어디에서 찍었나요?
            </h2>
            <PlacePicker value={place} onChange={setPlace} disabled={busy || started} />
          </section>
          <section className="card mint">
            <h2 className="card-title" style={{ marginBottom: 6 }}>
              우리 그룹에게만
            </h2>
            <p className="muted">저장한 사진은 이 그룹의 멤버만 볼 수 있어요. 파일은 비공개 저장소에 보관돼요.</p>
          </section>
        </aside>
      </div>

      {error && (
        <div className="error" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      {started && (
        <div className="ph-progress" role="status" aria-live="polite">
          <div className="ph-progress-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
          <p>
            {busy
              ? `${doneCount}/${items.length}장 올렸어요 · ${progress}%`
              : failCount > 0
                ? `${doneCount}/${items.length}장 올렸고, ${failCount}장이 실패했어요. 다시 시도하면 실패한 사진만 이어서 올려요.`
                : `${items.length}장을 모두 올렸어요`}
          </p>
        </div>
      )}

      <div className="ph-actions">
        <span className="meta" style={{ alignSelf: "center" }}>
          {items.length}/{MAX_FILES}장 선택
        </span>
        {failCount > 0 && !busy ? (
          <Link className="btn secondary" href={back}>
            올라간 사진만 두고 나가기
          </Link>
        ) : (
          <Link className="btn secondary" href={back} aria-disabled={busy} onClick={(e) => busy && e.preventDefault()}>
            취소
          </Link>
        )}
        <button className="btn" onClick={save} disabled={busy || items.length === 0}>
          {busy ? "올리는 중…" : failCount > 0 ? `실패한 ${failCount}장 다시 올리기` : "사진 저장하기"}
        </button>
      </div>
    </>
  );
}
