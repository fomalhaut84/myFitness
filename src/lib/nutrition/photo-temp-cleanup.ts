// #309: 프로세스 crash / kill -9 / 배포 도중 종료 등으로 request-level finally 가 실행되지
// 못한 경우 mfp-photo-* temp 파일 잔존 → "이미지는 저장 안 함" 약속 위반.
// 시작 시 os.tmpdir() 스캔해 STALE_THRESHOLD_MS 이상 지난 mfp-photo-* 삭제.
//
// Codex P2 (PR #310 8라운드, 릴리즈 PR #311).

import fs from "fs/promises";
import os from "os";
import path from "path";

/** 이 시간보다 오래된 파일만 삭제. 현재 처리 중일 수 있는 파일 (Vision 45s) 은 남김. */
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5분
const PREFIX = "mfp-photo-";

export interface SweepResult {
  scanned: number;
  removed: number;
  skipped: number;
  errors: number;
}

export async function sweepStalePhotoTempFiles(
  now: number = Date.now(),
): Promise<SweepResult> {
  const dir = os.tmpdir();
  const result: SweepResult = { scanned: 0, removed: 0, skipped: 0, errors: 0 };
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    console.warn(
      `[photo-cleanup] tmpdir readdir 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }
  for (const name of entries) {
    if (!name.startsWith(PREFIX)) continue;
    result.scanned++;
    const full = path.join(dir, name);
    try {
      const stat = await fs.stat(full);
      if (now - stat.mtimeMs < STALE_THRESHOLD_MS) {
        result.skipped++;
        continue;
      }
      await fs.unlink(full);
      result.removed++;
    } catch (err) {
      result.errors++;
      // ENOENT: 다른 프로세스가 이미 삭제 — normal race, count 없이 유지.
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        console.warn(
          `[photo-cleanup] unlink 실패 (${name}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  if (result.scanned > 0) {
    console.log(
      `[photo-cleanup] scanned=${result.scanned} removed=${result.removed} skipped=${result.skipped} errors=${result.errors}`,
    );
  }
  return result;
}
