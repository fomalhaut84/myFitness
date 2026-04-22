import prisma from "../prisma";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 서버 로컬 기준 YYYY-MM-DD (toISOString은 UTC 변환으로 날짜 어긋남 방지) */
function fmtDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const BP_CATEGORY_LABELS: Record<string, string> = {
  NORMAL: "정상",
  HIGH_NORMAL: "고정상",
  STAGE_1_HIGH: "1단계 고혈압",
  STAGE_2_HIGH: "2단계 고혈압",
};

export async function getBloodPressure(args: { days?: number }) {
  const displayDays = args.days ?? 30;
  // daysAgo(N-1) + >= → 오늘 포함 정확히 N일. 경고용 최소 7일 보장.
  const queryDays = Math.max(displayDays, 7);
  const since = daysAgo(queryDays - 1);

  const records = await prisma.bloodPressure.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "desc" },
    select: {
      date: true,
      highSystolic: true,
      lowSystolic: true,
      highDiastolic: true,
      lowDiastolic: true,
      avgPulse: true,
      measureCount: true,
      category: true,
    },
  });

  if (records.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            _context: "혈압 데이터 없음. Garmin Connect에서 혈압을 입력 중인지 확인하세요.",
            records: [],
          }),
        },
      ],
    };
  }

  // 표시용 윈도우: 오늘 포함 정확히 displayDays일
  const displaySince = daysAgo(displayDays - 1);
  const displayRecords = records.filter(
    (r) => r.date.getTime() >= displaySince.getTime()
  );

  // 통계: 표시 윈도우 기준, 일별 대표값 = (high + low) / 2
  const avgSystolic =
    displayRecords.length > 0
      ? Math.round(
          displayRecords.reduce(
            (s, r) => s + (r.highSystolic + r.lowSystolic) / 2,
            0
          ) / displayRecords.length
        )
      : null;
  const avgDiastolic =
    displayRecords.length > 0
      ? Math.round(
          displayRecords.reduce(
            (s, r) => s + (r.highDiastolic + r.lowDiastolic) / 2,
            0
          ) / displayRecords.length
        )
      : null;

  // 7일 평균: 달력 기준 최근 7일 (측정 개수가 아닌 날짜 범위)
  // 오늘 포함 정확히 7일 = daysAgo(6)
  const sevenDaysCutoff = daysAgo(6);
  const recent7 = records.filter(
    (r) => new Date(r.date).getTime() >= sevenDaysCutoff.getTime()
  );
  const avg7Systolic =
    recent7.length > 0
      ? Math.round(
          recent7.reduce(
            (s, r) => s + (r.highSystolic + r.lowSystolic) / 2,
            0
          ) / recent7.length
        )
      : null;
  const avg7Diastolic =
    recent7.length > 0
      ? Math.round(
          recent7.reduce(
            (s, r) => s + (r.highDiastolic + r.lowDiastolic) / 2,
            0
          ) / recent7.length
        )
      : null;

  // 경고
  const warnings: string[] = [];
  if (avg7Systolic !== null && avg7Systolic >= 135) {
    warnings.push(
      `7일 평균 수축기 ${avg7Systolic}mmHg (midpoint 기준) — 상승 추세`
    );
  }
  if (avg7Diastolic !== null && avg7Diastolic >= 85) {
    warnings.push(
      `7일 평균 이완기 ${avg7Diastolic}mmHg (midpoint 기준) — 상승 추세`
    );
  }
  // 3일 연속 STAGE_2_HIGH 체크 (달력일 기준, DST 안전)
  let consecutive2 = 0;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.category !== "STAGE_2_HIGH") break;
    if (i === 0) {
      consecutive2 = 1;
    } else {
      // 달력일 차이로 비교 (밀리초 대신, DST에 안전)
      const prev = new Date(records[i - 1].date);
      const curr = new Date(r.date);
      const prevDay = Math.floor(prev.getTime() / 86400000);
      const currDay = Math.floor(curr.getTime() / 86400000);
      if (prevDay - currDay === 1) {
        consecutive2++;
      } else {
        break;
      }
    }
  }
  if (consecutive2 >= 3) {
    warnings.push(`${consecutive2}일 연속 2단계 고혈압 — 의료 상담 권장`);
  }

  const response = {
    _context:
      "혈압 추세 데이터. 수축기 120 미만 + 이완기 80 미만이 정상. " +
      "수면 부족, 높은 스트레스, 운동 부족이 혈압 상승 원인일 수 있음. " +
      "warnings가 있으면 리포트에 반드시 포함하세요.",
    period: `최근 ${displayDays}일`,
    summary: {
      avgSystolic,
      avgDiastolic,
      avg7Systolic,
      avg7Diastolic,
      totalRecords: displayRecords.length,
    },
    warnings,
    records: displayRecords.map((r) => ({
      date: fmtDate(r.date),
      systolic: `${r.lowSystolic}-${r.highSystolic}`,
      diastolic: `${r.lowDiastolic}-${r.highDiastolic}`,
      pulse: r.avgPulse,
      measurements: r.measureCount,
      category: r.category,
      categoryLabel: r.category ? (BP_CATEGORY_LABELS[r.category] ?? r.category) : null,
    })),
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(response, null, 2),
      },
    ],
  };
}
