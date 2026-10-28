"use client";

import { useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import Avatar from "@/components/Avatar";

type Props = {
  userId: number;
  nickname: string;
  image: string | null;
  onChange: (image: string | null) => void;
};

const MAX_BYTES = 2 * 1024 * 1024; // 서버와 같은 2MB
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export default function ProfilePhotoCard({
  userId,
  nickname,
  image,
  onChange,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 다시 골라도 동작하게
    if (!file) return;
    setError("");

    if (!ALLOWED.includes(file.type)) {
      setError("JPG, PNG, WEBP 사진만 올릴 수 있어요.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("프로필 사진은 2MB 이하만 올릴 수 있어요.");
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const updated = await api<{ profile_image: string | null }>(
        "/auth/me/avatar",
        { method: "POST", body: form },
      );
      onChange(updated.profile_image);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "사진을 올리지 못했어요.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    if (!window.confirm("프로필 사진을 지울까요?")) return;
    setError("");
    setBusy(true);
    try {
      await api("/auth/me/avatar", { method: "DELETE" });
      onChange(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "사진을 지우지 못했어요.",
      );
    } finally {
      setBusy(false);
    }
  }

  const fromSocial = image?.startsWith("https://") ?? false;

  return (
    <section className="card">
      <h2 className="card-title" style={{ marginBottom: 12 }}>
        프로필 사진
      </h2>
      {error && <div className="error">{error}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ width: 72, height: 72, flexShrink: 0 }}>
          <span style={{ display: "inline-block", width: 72, height: 72 }}>
            <Avatar userId={userId} name={nickname} image={image} size="lg" />
          </span>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? "처리 중…" : image ? "사진 바꾸기" : "사진 올리기"}
            </button>
            {image && (
              <button
                type="button"
                className="btn"
                style={{ background: "#B54A3F" }}
                disabled={busy}
                onClick={onRemove}
              >
                사진 지우기
              </button>
            )}
          </div>
          <span className="hint">
            JPG · PNG · WEBP, 2MB 이하
            {fromSocial && " · 지금은 소셜 로그인 사진을 쓰고 있어요"}
          </span>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={onPick}
        style={{ display: "none" }}
      />
    </section>
  );
}
