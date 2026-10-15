/**
 * 신규 dataType 의 365일 초기 로드 여부 (순수).
 * Garmin: 호출자가 bootstrapNewTypes (cron) 를 넘긴 경우만 — 명시 범위 싱크는 그 범위를 존중한다.
 * OMRON (#514 사전 리뷰 major 1): 첫 성공 전이면 호출 경로와 무관하게 — 배포 직후 "지금 싱크" · 봇 · 모닝 리포트가 cron 보다 먼저
 * 짧은 창으로 첫 성공을 기록하면 초기 로드가 영영 돌지 않는다. 전체 이력이 한 번의 호출로 와서 (스펙 §2-2) 비용이 낮다.
 */
export function shouldLoadInitialHistory(args: {
  omron: boolean;
  hasSuccessfulSync: boolean;
  bootstrapNewTypes?: boolean;
}): boolean {
  if (args.hasSuccessfulSync) return false;
  return args.omron || Boolean(args.bootstrapNewTypes);
}
