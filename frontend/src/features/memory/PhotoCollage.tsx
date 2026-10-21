import type { PhotoGroup } from "./photos";

/** 여러 장을 함께 올린 묶음은 썸네일에 최대 4장을 보여준다. 한 장이면 그냥 한 장. */
export default function PhotoCollage({
  group,
  wide = false,
  alt,
}: {
  group: PhotoGroup;
  wide?: boolean;
  alt: string;
}) {
  const total = group.photos.length;
  const shown = group.photos.slice(0, 4);
  return (
    <div className={`ph-collage c${shown.length}${wide ? " wide" : ""}`}>
      {shown.map((p, i) => (
        <div className="ph-cell" key={p.id}>
          {p.signed_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.signed_url} alt={i === 0 ? alt : ""} />
          )}
          {i === 3 && total > 4 && <span className="ph-more">+{total - 4}</span>}
        </div>
      ))}
      {total > 1 && <span className="ph-count">사진 {total}장</span>}
    </div>
  );
}
