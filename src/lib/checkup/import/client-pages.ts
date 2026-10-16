// #532: 브라우저에서 업로드 파일 → 서버로 보낼 JPEG 쪽들. PDF 는 pdf.js 로 쪽마다 렌더 (서버에 poppler 를 두지 않는다 ·
// Claude CLI 에 PDF 를 직접 넘기려면 Read 도구가 필요해 막았다). 이미지는 긴 변 축소 + 재인코딩 (EXIF 위치정보도 빠진다).
// 렌더는 업로드 직전에 쪽마다 (render()) — 30쪽을 미리 다 만들어 메모리에 들고 있지 않는다. 브라우저 전용.

export const MAX_IMAGE_FILES = 30;
export const MAX_PDF_PAGES = 30;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
/**
 * 쪽 이미지 상한 — Nginx 기본 `client_max_body_size` 1MB 아래 (multipart 여유 포함). 서버 설정과 무관하게 업로드가
 * 413 으로 막히지 않게 브라우저가 맞춘다 (#537 · 릴리즈 PR #536 Codex P1).
 */
export const MAX_UPLOAD_BYTES = 950 * 1024;
const MAX_LONG_EDGE = 2400;
/** PDF 쪽 렌더 폭 — 결과 표 글자가 읽히는 선 */
const PDF_TARGET_WIDTH = 1600;
const JPEG_QUALITIES = [0.85, 0.72, 0.6] as const;
/** 해상도를 줄여도 이 긴 변 아래로는 내리지 않는다 — 결과 표 글자가 읽히는 선 */
const MIN_LONG_EDGE = 1400;
const SCALE_STEP = 0.8;

export interface EncodeStep {
  width: number;
  height: number;
  quality: number;
}

/**
 * 인코딩 시도 순서 — 원래 크기에서 품질을 낮춰 보고, 그래도 크면 해상도를 0.8 배씩 줄인다. 다음 단계가 하한을 넘어가면
 * 긴 변 MIN_LONG_EDGE 정확히 한 단계를 마지막으로 (1600px PDF 쪽도 1400px 를 시도한다 · PR #538 Codex P2). 순수.
 */
export function encodeSteps(width: number, height: number): EncodeStep[] {
  const long = Math.max(width, height);
  const scales: number[] = [1];
  while (long * scales[scales.length - 1] > MIN_LONG_EDGE) {
    const next = scales[scales.length - 1] * SCALE_STEP;
    scales.push(long * next >= MIN_LONG_EDGE ? next : MIN_LONG_EDGE / long);
  }
  return scales.flatMap((scale) => {
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    return JPEG_QUALITIES.map((quality) => ({ width: w, height: h, quality }));
  });
}

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

/** 캔버스 메모리를 바로 돌려준다 — iOS Safari 는 캔버스 backing store 를 늦게 풀어 여러 쪽을 처리하면 한도에 걸린다 */
function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

async function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  let target = canvas;
  try {
    for (const step of encodeSteps(canvas.width, canvas.height)) {
      // 해상도 단계마다 한 번만 줄인다 (품질 단계 3개가 같은 캔버스를 쓴다)
      if (target.width !== step.width) {
        if (target !== canvas) release(target);
        target = resized(canvas, step.width, step.height);
      }
      const blob = await new Promise<Blob | null>((resolve) => target.toBlob(resolve, "image/jpeg", step.quality));
      if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
    }
    throw new Error("이미지를 1MB 아래로 줄이지 못했습니다 — 더 작게 잘라서 올리세요");
  } finally {
    if (target !== canvas) release(target);
    release(canvas);
  }
}

function resized(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const canvas = makeCanvas(width, height);
  canvas.getContext("2d")?.drawImage(source, 0, 0, width, height);
  return canvas;
}
