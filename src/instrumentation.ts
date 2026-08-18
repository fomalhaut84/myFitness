// Next.js 15+ instrumentation hook — 서버 프로세스 시작 시 1회 실행.
// #309 (Codex P2 PR #311): 이전 프로세스 crash / 배포 도중 종료로 남은 mfp-photo-* temp
// 파일 정리. "이미지 보관 안 함" 약속 유지. Node.js runtime 에서만 실행 (Edge 는 fs 접근 X).

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { sweepStalePhotoTempFiles } = await import(
    "@/lib/nutrition/photo-temp-cleanup"
  );
  await sweepStalePhotoTempFiles().catch((err) => {
    console.error("[photo-cleanup] startup sweep failed:", err);
  });
}
