"use client";

import { useState } from "react";

type Props = {
  userId: number;
  name: string;
  /** users.profile_image 값. 비어 있으면 첫 글자를 보여 준다 */
  image?: string | null;
  size?: "sm" | "md" | "lg";
  /** 기존 색상 클래스 (peach, lavender 등) */
  tone?: string;
};

/**
 * 프로필 동그라미. 사진이 있으면 사진을, 없거나 불러오지 못하면 이름 첫 글자를 보여 준다.
 * 사진은 서버(/api/profiles/{id}/image)를 거쳐 가져온다. (본인이거나 같은 그룹 멤버만 볼 수 있다)
 */
export default function Avatar({
  userId,
  name,
  image,
  size = "md",
  tone = "",
}: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  // 사진을 바꾸면 image 값이 달라지므로, 끝부분을 주소에 붙여 브라우저 캐시를 피한다
  const src = image
    ? `/api/profiles/${userId}/image?v=${encodeURIComponent(image.slice(-12))}`
    : null;
  const showImage = src !== null && failedSrc !== src;

  const className = ["avatar", size === "md" ? "" : size, tone]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={className} style={{ overflow: "hidden" }}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: "inherit",
            display: "block",
          }}
        />
      ) : (
        name.slice(0, 1)
      )}
    </span>
  );
}
