import type { GarminConnect } from "@flow-js/garmin-connect";
import { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { dateRange, isNoDataError, todayKSTString, withRateLimit } from "../utils";
import { isTrimmedResponse } from "../preserve";
import { fetchDailySleep } from "../daily-endpoints";
import { buildSleepRecordData, buildSleepScoreDetails, buildSleepUpdatePayload } from "./sleep-payload";

export async function syncSleep(
  client: GarminConnect,
  startDate: Date,
  endDate: Date
): Promise<number> {
  let synced = 0;
  const dates = dateRange(startDate, endDate);

  for (const date of dates) {
    try {
      // #365: 라이브러리 getSleepData 는 서버 로컬 TZ 로 날짜를 만든다 — KST 문자열로 직접 호출
      const sleepData = await withRateLimit(() => fetchDailySleep(client, date));

      if (!sleepData?.dailySleepDTO) continue;

      const dto = sleepData.dailySleepDTO;

      if (!dto.sleepStartTimestampGMT || !dto.sleepEndTimestampGMT) continue;

      const calendarDate = dto.calendarDate;
      if (!calendarDate) continue;

      // Garmin calendarDate가 오늘(KST) 이후면 건너뛰기 (미래 날짜 방지)
      if (calendarDate > todayKSTString()) continue;

      // KST midnight UTC instant (서버 타임존 무관, 다른 fetcher와 정합)
      const dayDate = new Date(`${calendarDate}T00:00:00+09:00`);

      // payload 조립은 순수 함수 (#437 · sleep-payload.ts) — 컬럼 매핑 · 수면 점수 세부 · trimmed 규칙
      const scoreDetails = buildSleepScoreDetails(dto);
      const data = buildSleepRecordData(sleepData);

      // #431 · #435: 보존 창 (~150일) 밖 재싱크는 야간 HRV · SpO2 epochs · 수면 심박 타임라인이 빠진 채 온다 — 기존 값을 지우지 않는다.
      // 기존 행의 rawData 와 비교해 (하루 1회 조회) 값 있던 키가 사라진 응답이면 rawData · sleepScoreDetails 를 유지한다 (#437).
      const existing = await prisma.sleepRecord.findUnique({ where: { date: dayDate }, select: { rawData: true } });
      const trimmed = isTrimmedResponse(sleepData, existing?.rawData);
      await prisma.sleepRecord.upsert({
        where: { date: dayDate },
        update: buildSleepUpdatePayload(data, scoreDetails, { trimmed }),
        // create 에서만 DbNull — update 는 null 을 받지 않는다 (#431)
        create: { date: dayDate, ...data, sleepScoreDetails: scoreDetails ? (scoreDetails as unknown as Prisma.InputJsonValue) : Prisma.DbNull },
      });

      synced++;
    } catch (error) {
      if (isNoDataError(error)) continue;
      throw error;
    }
  }

  return synced;
}
