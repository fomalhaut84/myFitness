// #532: 브라우저에서 업로드 파일 → 서버로 보낼 JPEG 쪽들. PDF 는 pdf.js 로 쪽마다 렌더 (서버에 poppler 를 두지 않는다 ·
// Claude CLI 에 PDF 를 직접 넘기려면 Read 도구가 필요해 막았다). 이미지는 긴 변 축소 + 재인코딩 (EXIF 위치정보도 빠진다).
// 렌더는 업로드 직전에 쪽마다 (render()) — 30쪽을 미리 다 만들어 메모리에 들고 있지 않는다. 브라우저 전용.

export const MAX_IMAGE_FILES = 30;
export const MAX_PDF_PAGES = 30;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_LONG_EDGE = 2400;
/** PDF 쪽 렌더 폭 — 결과 표 글자가 읽히는 선 */
const PDF_TARGET_WIDTH = 1600;
const JPEG_QUALITIES = [0.85, 0.7, 0.5] as const;

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC_RE = /\.(heic|heif)$/i;

export interface PendingPage {
  id: string;
  label: string;
  render: () => Promise<Blob>;
}

export type PreparedFiles =
  | { ok: true; source: "pdf" | "image"; pages: PendingPage[]; dispose: () => void }
  | { ok: false; error: string };

export async function prepareFiles(files: readonly File[]): Promise<PreparedFiles> {
  if (files.length === 0) return { ok: false, error: "파일을 고르세요" };
  if (files.some((f) => HEIC_RE.test(f.name) || f.type === "image/heic" || f.type === "image/heif")) {
    return { ok: false, error: "HEIC 사진은 읽을 수 없습니다 — iPhone 에서 공유할 때 \"가장 호환성 높은 형식\" 을 고르면 JPEG 로 보내집니다" };
  }
  const pdfs = files.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
  if (pdfs.length > 0) {
    if (files.length > 1) return { ok: false, error: "PDF 는 한 번에 1개만, 이미지와 섞지 않고 올리세요" };
    return preparePdf(pdfs[0]);
  }
  if (files.length > MAX_IMAGE_FILES) return { ok: false, error: `이미지는 한 번에 ${MAX_IMAGE_FILES}장까지입니다` };
  const unsupported = files.find((f) => !IMAGE_MIME.has(f.type));
  if (unsupported) return { ok: false, error: `읽을 수 없는 형식입니다: ${unsupported.name} (JPEG · PNG · WebP · PDF)` };
  return {
    ok: true,
    source: "image",
    pages: files.map((file, i) => ({ id: `img-${i}`, label: file.name || `${i + 1}번째 이미지`, render: () => renderImage(file) })),
    dispose: () => {},
  };
}

async function preparePdf(file: File): Promise<PreparedFiles> {
  if (file.size > MAX_PDF_BYTES) return { ok: false, error: `PDF 는 ${MAX_PDF_BYTES / (1024 * 1024)}MB 까지입니다` };
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch {
    void task.destroy();
    return { ok: false, error: "PDF 를 열지 못했습니다 (암호가 걸렸거나 손상된 파일)" };
  }
  if (doc.numPages > MAX_PDF_PAGES) {
    void task.destroy();
    return { ok: false, error: `PDF 는 ${MAX_PDF_PAGES}쪽까지입니다 (이 파일은 ${doc.numPages}쪽)` };
  }
  const pages = Array.from({ length: doc.numPages }, (_, i) => ({
    id: `pdf-${i + 1}`,
    label: `${i + 1}쪽`,
    render: async () => {
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, Math.max(1, PDF_TARGET_WIDTH / base.width)) });
      const canvas = makeCanvas(viewport.width, viewport.height);
      await page.render({ canvas, viewport }).promise;
      page.cleanup();
      return toJpeg(canvas);
    },
  }));
  return { ok: true, source: "pdf", pages, dispose: () => void task.destroy() };
}

async function renderImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = makeCanvas(bitmap.width * scale, bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return toJpeg(canvas);
  } finally {
    bitmap.close();
  }
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  if (ctx) {
    // 투명 PNG · PDF 배경을 흰색으로 (JPEG 는 알파가 없어 검게 나온다)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return canvas;
}

async function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const quality of JPEG_QUALITIES) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
  }
  throw new Error("이미지가 너무 큽니다");
}
