// #532: 결과지 이미지 1장 → 추출 결과 (저장하지 않는다 — 확인 화면이 고친 뒤 /api/checkups/import).
// 이미지는 temp 파일 (0600 · mfp-photo- 접두사 → 기존 sweep 이 남은 파일도 정리) → 처리 후 즉시 삭제.
// 로그에 결과지 내용을 남기지 않는다.
import { NextResponse } from "next/server";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomBytes } from "crypto";
import { extractCheckupPage, type ExtractFailure } from "@/lib/checkup/import/extract";
import { IMAGE_EXT, sniffImageType } from "@/lib/checkup/import/image-type";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** multipart 경계 · 헤더 여유 — 이미지 자체 상한은 MAX_IMAGE_BYTES */
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

const FAILURE_MESSAGE: Record<ExtractFailure, string> = {
  spawn: "결과지를 읽는 도구를 실행하지 못했습니다",
  timeout: "결과지를 읽는 데 시간이 너무 걸렸습니다 — 다시 시도하세요",
  cli: "결과지를 읽지 못했습니다 — 다시 시도하세요",
  parse: "결과지 내용을 해석하지 못했습니다 — 다시 시도하거나 더 선명한 이미지로 올리세요",
};

export async function POST(request: Request) {
  // formData() 는 본문 전체를 메모리에 올린 뒤에야 크기를 알 수 있다 — Content-Length 로 먼저 거른다 (/api/food 와 같은 방식)
  const lengthRaw = request.headers.get("content-length");
  if (!lengthRaw) return NextResponse.json({ error: "Content-Length 헤더가 필요합니다" }, { status: 411 });
  const length = Number(lengthRaw);
  if (!Number.isFinite(length) || length < 0) return NextResponse.json({ error: "유효하지 않은 Content-Length" }, { status: 400 });
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: `이미지는 ${MAX_IMAGE_BYTES / (1024 * 1024)}MB 까지입니다` }, { status: 413 });
  }

  let tempPath: string | null = null;
  try {
    const form = await request.formData().catch(() => null);
    const image = form?.get("image");
    if (!(image instanceof File)) return NextResponse.json({ error: "image 필드가 필요합니다" }, { status: 400 });
    if (image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: `이미지는 ${MAX_IMAGE_BYTES / (1024 * 1024)}MB 까지입니다` }, { status: 413 });
    }
    const bytes = new Uint8Array(await image.arrayBuffer());
    const type = sniffImageType(bytes);
    if (!type) return NextResponse.json({ error: "JPEG · PNG · WebP 이미지만 읽을 수 있습니다" }, { status: 415 });

    tempPath = path.join(os.tmpdir(), `mfp-photo-${Date.now()}-${randomBytes(6).toString("hex")}${IMAGE_EXT[type]}`);
    await fs.writeFile(tempPath, bytes, { mode: 0o600, flag: "wx" });

    const started = Date.now();
    const result = await extractCheckupPage(tempPath);
    if (!result.ok) {
      return NextResponse.json({ error: FAILURE_MESSAGE[result.reason] }, { status: result.reason === "timeout" ? 504 : 502 });
    }
    console.log(`[api/checkups/extract] ${Date.now() - started}ms · items=${result.page.items.length}`);
    return NextResponse.json({ page: result.page });
  } catch (error) {
    console.error("[api/checkups/extract] error:", error instanceof Error ? error.name : typeof error);
    return NextResponse.json({ error: "결과지를 읽지 못했습니다" }, { status: 500 });
  } finally {
    if (tempPath) await fs.unlink(tempPath).catch(() => {});
  }
}
