"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PlacePicker from "@/components/PlacePicker";
import PhotoShell from "@/components/PhotoShell";
import { api } from "@/lib/api";
import { hasAllowedExtension, MAX_BYTES, MAX_FILES, type PlaceValue } from "@/lib/photos";

type Item = { id: string; file: File; caption: string; preview: string };

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

  function onFiles(list: FileList | null) {
    if (!list) return;
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
      ...incoming.map((file) => ({ id: crypto.randomUUID(), file, caption: "", preview: URL.createObjectURL(file) })),
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

  async function save() {
    setError("");
    if (!items.length) {
      setError("업로드할 사진을 선택해 주세요.");
      return;
    }
    setBusy(true);
    try {
      // 서버가 한 번에 검사하고 올려요. 중간에 실패하면 서버가 이번에 올린 사진을 모두 취소해요.
      const form = new FormData();
      items.forEach((i) => {
        form.append("files", i.file);
        form.append("captions", i.caption.trim());
      });
      form.append("title", title.trim());
      form.append("memo", memo.trim());
      if (place) {
        // 장소를 골랐다면 사진과 함께 저장 → 추억지도에 마커로 표시돼요
        if (place.id) form.append("place_id", place.id);
        form.append("place_name", place.name);
        if (place.address) form.append("place_address", place.address);
        form.append("place_lat", String(place.lat));
        form.append("place_lng", String(place.lng));
      }
      await api(`/groups/${groupId}/photos`, { method: "POST", body: form });
      items.forEach((i) => URL.revokeObjectURL(i.preview));
      router.push(`/groups/${groupId}/photos`);
    } catch (e) {
      setError(onApiError(e));
      setBusy(false);
    }
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
              accept=".jpg,.jpeg,.png,.webp,.heic,image/jpeg,image/png,image/webp,image/heic"
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
                      <button className="ph-remove" type="button" onClick={() => removeItem(item.id)} aria-label={`${item.file.name} 선택 취소`}>
                        ×
                      </button>
                    </div>
                    <label htmlFor={`cap-${item.id}`}>사진 설명 (선택)</label>
                    <input
                      id={`cap-${item.id}`}
                      className="input"
                      style={{ height: 40 }}
                      value={item.caption}
                      maxLength={200}
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
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="ph-appt">
                약속 연결 <span className="meta">(선택)</span>
              </label>
              <input id="ph-appt" className="input" value="약속 기능이 연결되면 사용할 수 있어요 (준비 중)" disabled readOnly />
              <span className="hint">이 사진이 어떤 약속에서 찍혔는지 연결할 수 있어요.</span>
            </div>
          </section>
        </div>

        <aside className="stack">
          <section className="card">
            <h2 className="card-title" style={{ marginBottom: 14 }}>
              어디에서 찍었나요?
            </h2>
            <PlacePicker value={place} onChange={setPlace} disabled={busy} />
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

      <div className="ph-actions">
        <span className="meta" style={{ alignSelf: "center" }}>
          {items.length}/{MAX_FILES}장 선택
        </span>
        <Link className="btn secondary" href={back}>
          취소
        </Link>
        <button className="btn" onClick={save} disabled={busy || items.length === 0}>
          {busy ? "저장 중…" : "사진 저장하기"}
        </button>
      </div>
    </>
  );
}
