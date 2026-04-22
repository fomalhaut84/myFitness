import prisma from "../prisma";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

const BP_CATEGORY_LABELS: Record<string, string> = {
  NORMAL: "정상",
  HIGH_NORMAL: "고정상",
  STAGE_1_HIGH: "1단계 고혈압",
  STAGE_2_HIGH: "2단계 고혈압",
};

export async function getBloodPressure(args: { days?: number }) {
  const since = daysAgo(args.days ?? 30);

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

  // 통계
  const systolics = records.map((r) => r.highSystolic);
  const diastolics = records.map((r) => r.highDiastolic);
  const avgSystolic = Math.round(
    systolics.reduce((s, v) => s + v, 0) / systolics.length
  );
  const avgDiastolic = Math.round(
    diastolics.reduce((s, v) => s + v, 0) / diastolics.length
  );

  // 7일 평균
  const recent7 = records.slice(0, 7);
  const avg7Systolic =
    recent7.length > 0
      ? Math.round(
          recent7.reduce((s, r) => s + r.highSystolic, 0) / recent7.length
        )
      : null;
  const avg7Diastolic =
    recent7.length > 0
      ? Math.round(
          recent7.reduce((s, r) => s + r.highDiastolic, 0) / recent7.length
        )
      : null;

  // 경고
  const warnings: string[] = [];
  if (avg7Systolic !== null && avg7Systolic >= 135) {
    warnings.push(`7일 평균 수축기 ${avg7Systolic}mmHg — 상승 추세`);
  }
  if (avg7Diastolic !== null && avg7Diastolic >= 85) {
    warnings.push(`7일 평균 이완기 ${avg7Diastolic}mmHg — 상승 추세`);
  }
  // 3일 연속 STAGE_2_HIGH 체크
  let consecutive2 = 0;
  for (const r of records.slice(0, 7)) {
    if (r.category === "STAGE_2_HIGH") {
      consecutive2++;
    } else {
      break;
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
    period: `최근 ${args.days ?? 30}일`,
    summary: {
      avgSystolic,
      avgDiastolic,
      avg7Systolic,
      avg7Diastolic,
      totalRecords: records.length,
    },
    warnings,
    records: records.map((r) => ({
      date: r.date.toISOString().slice(0, 10),
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
