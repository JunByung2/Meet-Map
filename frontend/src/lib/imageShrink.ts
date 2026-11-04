// 사진을 올리기 전에 브라우저에서 줄여요. 폰 사진(5~10MB)이 300~600KB 정도가 되어서 업로드가 훨씬 빨라져요.
// - 긴 변이 MAX_SIDE(1600px) 보다 크면 그 크기로 줄이고, JPEG 로 저장해요.
// - HEIC 처럼 브라우저가 못 읽는 사진, 이미 작은 사진, 줄여도 더 커지는 사진은 원본 그대로 보내요.
const MAX_SIDE = 1600;
const QUALITY = 0.8;
const SKIP_UNDER = 300 * 1024; // 이보다 작으면 줄이지 않아요
const PNG_SKIP_UNDER = 1.5 * 1024 * 1024; // 캡처 화면 같은 작은 PNG 는 그대로 (글씨가 번지지 않게)

export async function shrinkImage(file: File): Promise<File> {
  try {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
    if (file.size < SKIP_UNDER) return file;
    if (file.type === "image/png" && file.size < PNG_SKIP_UNDER) return file;
    if (typeof createImageBitmap !== "function") return file;

    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bmp.close?.();
      return file;
    }
    ctx.fillStyle = "#fff"; // 투명한 PNG 가 까맣게 되지 않게
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}
