"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PlacePicker from "@/components/PlacePicker";
import PhotoShell from "@/components/PhotoShell";
import { ApiError } from "@/lib/api";
import { shrinkImage } from "@/lib/imageShrink";
import { coordToPlace, loadKakao } from "@/lib/kakao";
import { distanceMeters, estimatePlace, readPhotoGps, type Gps } from "@/lib/photoGps";
import { hasAllowedExtension, MAX_BYTES, MAX_FILES, type PlaceValue } from "@/lib/photos";

type Status = "wait" | "up" | "done" | "fail";
// gps: undefined = 위치를 읽는 중, null = 이 사진에는 위치 정보가 없어요
type Item = { id: string; file: File; caption: string; preview: string; status: Status; gps?: Gps | null; est?: boolean };

// 위치가 이만큼(미터) 넘게 떨어진 사진이 섞여 있으면 나눠서 올리라고 안내해요
const FAR_METERS = 300;

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
  const placeTouchedRef = useRef(false); // 사용자가 장소를 직접 고르거나 해제했다면 자동 입력으로 덮어쓰지 않아요
  const autoPlacedRef = useRef(false);
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [place, setPlace] = useState<PlaceValue | null>(null);
  const [autoEst, setAutoEst] = useState(false); // 자동 입력된 장소가 정확한 위치가 아니라 추정인지
  const [autoPlaced, setAutoPlaced] = useState(false); // 장소가 사진의 위치에서 자동으로 채워진 것인지
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0); // 0~100
  const batchRef = useRef<string | null>(null); // 같은 저장 안에서는 같은 묶음 번호를 써야 이어 올릴 수 있어요
  const started = items.some((i) => i.status !== "wait"); // 한 장이라도 올라가기 시작하면 목록을 바꿀 수 없어요
  const doneCount = items.filter((i) => i.status === "done").length;
  const failCount = items.filter((i) => i.status === "fail").length;

  // 새로 고른 사진들의 위치를 읽고, 장소가 비어 있으면 첫 번째로 위치가 있는 사진의 위치로 채워요
  async function readLocations(added: { id: string; file: File }[], fallback: Promise<Gps | null> | null) {
    const found: { id: string; gps: Gps | null; est?: boolean }[] = [];
    for (const a of added) {
      let gps = await readPhotoGps(a.file); // 줄이기 전의 원본 파일에서 읽어야 해요
      if (!gps && fallback) gps = await fallback; // 앱 카메라로 찍은 사진인데 파일에 위치가 없으면 찍을 때의 폰 위치를 써요
      let est = false;
      if (!gps) {
        // 폰이 위치를 지워서 넘긴 사진: 방금 찍은 사진이면 지금 위치로 채우고, 옛날 사진은 비워 둬요
        const e = await estimatePlace(a.file, groupId);
        if (e) {
          gps = e.gps;
          est = true;
        }
      }
      found.push({ id: a.id, gps, est });
    }
    setItems((cur) => cur.map((x) => (found.some((f) => f.id === x.id) ? { ...x, gps: found.find((f) => f.id === x.id)!.gps, est: found.find((f) => f.id === x.id)!.est } : x)));
    const firstItem = found.find((f) => f.gps);
    const first = firstItem?.gps;
    if (first && !placeTouchedRef.current && !autoPlacedRef.current) {
      autoPlacedRef.current = true;
      try {
        const kakao = await loadKakao();
        const p = await coordToPlace(kakao, first.lat, first.lng);
        if (!placeTouchedRef.current) {
          setPlace({ id: null, name: p?.name ?? "사진에 담긴 위치", address: p?.address ?? null, lat: first.lat, lng: first.lng });
          setAutoPlaced(true);
          setAutoEst(!!firstItem?.est);
        }
      } catch {
        // 카카오 지도를 못 불러와도 좌표는 쓸 수 있어요 (이름만 기본값)
        if (!placeTouchedRef.current) {
          setPlace({ id: null, name: "사진에 담긴 위치", address: null, lat: first.lat, lng: first.lng });
          setAutoPlaced(true);
          setAutoEst(!!firstItem?.est);
        }
      }
    }
  }

  function onFiles(list: FileList | null, fallback: Promise<Gps | null> | null = null) {
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
    const added = incoming.map((file) => ({ id: crypto.randomUUID(), file }));
    setItems((cur) => [
      ...cur,
      ...added.map((a) => ({ id: a.id, file: a.file, caption: "", preview: URL.createObjectURL(a.file), status: "wait" as Status })),
    ]);
    if (inputRef.current) inputRef.current.value = "";
    void readLocations(added, fallback);
  }

  // 사진 위치 요약: 몇 장에서 위치를 찾았는지, 서로 많이 떨어진 사진이 섞였는지
  const loc = useMemo(() => {
    const reading = items.some((i) => i.gps === undefined);
    const withGps = items.filter((i) => i.gps).map((i) => i.gps as Gps);
    const far = withGps.length > 1 && withGps.some((g) => distanceMeters(withGps[0], g) > FAR_METERS);
    return { reading, found: withGps.length, far };
  }, [items]);

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
            {items.length > 0 && (
              <div className="ph-loc" role="status" aria-live="polite">
                {loc.reading ? (
                  <p className="info">사진의 위치 정보를 확인하는 중이에요…</p>
                ) : loc.found > 0 ? (
                  <p>
                    📍 {items.length}장 중 {loc.found}장에서 찍은 위치를 찾았어요.
                  </p>
                ) : (
                  <p className="info">
                    선택한 사진에는 위치 정보가 없어요. 오른쪽에서 장소를 직접 골라 주세요. (일부 폰은 사진 선택창이 사진 속 위치를 지워서 넘겨요. 스크린샷·메신저로 받은 사진도 위치가 없어요. 아이폰은 사진 선택 창의 [옵션]에서 [위치]를 켜면 위치가 함께 올라와요.)
                  </p>
                )}
                {loc.far && (
                  <p className="warn">
                    찍은 곳이 서로 많이 다른 사진이 섞여 있어요. 한 번에 올리면 장소가 한 곳으로만 저장되니, 장소별로 나눠서 올리면 추억지도에 정확히 찍혀요.
                  </p>
                )}
              </div>
            )}
            <p className="ph-hint">여러 장을 함께 올리면 갤러리에서 한 묶음으로 보여요. 실제 파일은 [사진 저장하기]를 눌러야 올라가요.</p>

            {items.length > 0 && (
              <div className="ph-tiles">
                {items.map((item, i) => (
                  <div className="ph-tile" key={item.id}>
                    <div className="ph-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.preview} alt={`선택한 사진 ${i + 1}`} />
                      <span className="ph-badge">{i === 0 ? "대표 사진" : `${i + 1}번째`}</span>
                      {item.gps !== undefined && <span className={`ph-gpsmark${item.gps ? "" : " none"}`}>{item.gps ? (item.est ? "📍 위치 추정" : "📍 위치 있음") : "위치 없음"}</span>}
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
            <PlacePicker
              value={place}
              onChange={(p) => {
                placeTouchedRef.current = true; // 직접 고르거나 해제한 뒤에는 자동 입력으로 바꾸지 않아요
                setAutoPlaced(false);
                setPlace(p);
              }}
              disabled={busy || started}
              note={autoPlaced ? (autoEst ? "📍 방금 찍은 사진이라 지금 위치로 채웠어요. 다르면 [장소 해제] 후 직접 검색해 주세요." : "📍 사진에 담긴 위치로 자동 입력했어요. 다르면 [장소 해제] 후 직접 검색해 주세요.") : undefined}
            />
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
