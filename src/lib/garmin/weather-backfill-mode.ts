// #390: syncAll 끝의 weather backfill 실행 모드. 기본은 #269 의 fire-and-forget (background) — 리포트 파이프라인을 막지 않는다.
// backfill:history 는 청크마다 syncAll 을 부르고 끝에 prisma.$disconnect() 하므로, 백그라운드 weather backfill 의 lock 해제가
// 닫힌 엔진에 닿아 "Response from the Engine was empty" 로 실패했다 (v2.29.0 배포 검증). 스크립트는 skip 으로 부른다. 순수 모듈.

export type WeatherBackfillMode = "background" | "await" | "skip";

export const DEFAULT_WEATHER_BACKFILL_MODE: WeatherBackfillMode = "background";

export function resolveWeatherBackfillMode(mode: WeatherBackfillMode | undefined): WeatherBackfillMode {
  return mode ?? DEFAULT_WEATHER_BACKFILL_MODE;
}

/** 실행 계획 — `run` 이 false 면 호출 자체를 하지 않고, `awaitResult` 면 syncAll 이 끝을 기다린다 */
export function weatherBackfillPlan(mode: WeatherBackfillMode): { run: boolean; awaitResult: boolean } {
  switch (mode) {
    case "skip":
      return { run: false, awaitResult: false };
    case "await":
      return { run: true, awaitResult: true };
    case "background":
      return { run: true, awaitResult: false };
  }
}
