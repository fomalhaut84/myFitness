// #394 (M15-2): 일간 종합 — 카드 8장이 아니라 한 컨테이너의 8행 ("하루의 장부").
// 기록 없는 섹션은 숨기지 않고 한 줄로 접는다 (워치 미착용일을 구분해야 한다). 섹션 순서는 고정.
// SpO2 는 값만 — 절대 임계 색·경고 금지 (사용자 야간 최저 83~88 이 정상 범위).
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDuration, formatPace, formatTimeKST } from "@/lib/format";
import type { HistoryDay, HistoryDayActivity } from "@/lib/history/day";
import ReportBody from "./ReportBody";

interface DayLedgerProps {
  day: HistoryDay;
}

const REPORT_TITLES: Record<string, string> = { morning_report: "모닝 리포트", evening_report: "이브닝 리포트" };
const MEAL_LABELS: Record<string, string> = { breakfast: "아침", lunch: "점심", dinner: "저녁", snack: "간식" };
const SOURCE_LABELS: Record<string, string> = { garmin: "Garmin", manual: "직접 입력" };
const SLEEP_STAGES = [
  { key: "deepMin", label: "깊은", color: "#6d28d9" },
  { key: "lightMin", label: "얕은", color: "#a78bfa" },
  { key: "remMin", label: "렘", color: "#38bdf8" },
  { key: "awakeMin", label: "깸", color: "#525252" },
] as const;

const int = (n: number) => Math.round(n).toLocaleString("ko-KR");

function Row({ title, link, children }: { title: string; link?: { href: string; label: string }; children: ReactNode | null }) {
  if (children === null) {
    return (
      <section className="grid grid-cols-[96px_1fr] gap-4 border-t border-border bg-bg-raised px-3.5 py-2.5 first:border-t-0 sm:grid-cols-[132px_1fr] sm:px-[18px]">
        <h2 className="text-[13px] font-normal text-dim">{title}</h2>
        <p className="text-[13px] text-dim">기록 없음</p>
      </section>
    );
  }
  return (
    <section className="grid gap-2.5 border-t border-border p-3.5 first:border-t-0 sm:grid-cols-[132px_1fr] sm:gap-4 sm:px-[18px] sm:py-4">
      <h2 className="flex items-baseline justify-between text-[13px] font-medium text-bright sm:block">
        {title}
        {link && (
          <Link href={link.href} className="text-[12px] font-normal text-sub hover:text-bright sm:mt-0.5 sm:block">
            {link.label}
          </Link>
        )}
      </h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Stat({ label, value, unit }: { label: string; value: string | null; unit?: string }) {
  if (value === null) return null;
  return (
    <div className="min-w-[72px]">
      <dt className="text-[11px] text-sub">{label}</dt>
      <dd className="font-[family-name:var(--font-geist-mono)] text-[16px] font-medium text-bright">
        {value}
        {unit && <span className="ml-0.5 text-[11px] font-normal text-sub">{unit}</span>}
      </dd>
    </div>
  );
}

function Stats({ children }: { children: ReactNode }) {
  return <dl className="flex flex-wrap gap-x-7 gap-y-1.5">{children}</dl>;
}

function activitySummary(a: HistoryDayActivity): string {
  const parts = [
    a.distanceM !== null && a.distanceM > 0 ? `${(a.distanceM / 1000).toFixed(2)} km` : null,
    a.isRunning && a.avgPaceSecPerKm !== null ? `${formatPace(a.avgPaceSecPerKm)}/km` : null,
    formatDuration(a.durationSec),
    a.avgHR !== null ? `${a.avgHR} bpm` : null,
  ];
  return parts.filter((p): p is string => p !== null).join("  ");
}

function hoursMinutes(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
}

export default function DayLedger({ day }: DayLedgerProps) {
  const { sleep, vitals, body, bloodPressure: bp, movement } = day;
  const stages = sleep ? SLEEP_STAGES.flatMap((s) => (sleep[s.key] !== null ? [{ ...s, min: sleep[s.key] as number }] : [])) : [];
  const stageTotal = stages.reduce((sum, s) => sum + s.min, 0);
  const foodTotal = day.foods.every((f) => f.estimatedKcal !== null)
    ? day.foods.reduce((sum, f) => sum + (f.estimatedKcal ?? 0), 0)
    : null;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Row title="활동">
        {day.activities.length === 0 ? null : (
          <div className="grid gap-2">
            {day.activities.map((a) => (
              <Link
                key={a.id}
                href={`/activities/${a.id}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg bg-surface px-3 py-2.5 hover:bg-surface-hover"
              >
                <span className="text-bright">
                  {a.name}
                  <span className="ml-2 font-[family-name:var(--font-geist-mono)] text-[12px] text-sub">{formatTimeKST(a.startTime)}</span>
                </span>
                <span className="whitespace-pre font-[family-name:var(--font-geist-mono)] text-[13px] text-muted">{activitySummary(a)}</span>
              </Link>
            ))}
          </div>
        )}
      </Row>

      <Row title="수면" link={sleep ? { href: `/sleep/${day.ymd}`, label: "수면 상세" } : undefined}>
        {sleep === null ? null : (
          <>
            <Stats>
              <Stat label="점수" value={sleep.score === null ? null : String(sleep.score)} unit="점" />
              <Stat label="수면 시간" value={hoursMinutes(sleep.totalMin)} />
              <Stat label="취침 – 기상" value={`${formatTimeKST(sleep.sleepStart)} – ${formatTimeKST(sleep.sleepEnd)}`} />
              <Stat label="야간 HRV" value={sleep.hrvOvernight === null ? null : int(sleep.hrvOvernight)} unit="ms" />
              <Stat label="최저 SpO2" value={sleep.lowestSpO2 === null ? null : int(sleep.lowestSpO2)} unit="%" />
            </Stats>
            {stageTotal > 0 && (
              <>
                <div role="img" aria-label="수면 단계 비율" className="mt-3 flex h-2 max-w-[420px] overflow-hidden rounded">
                  {stages.map((s) => (
                    <span key={s.key} style={{ width: `${(s.min / stageTotal) * 100}%`, background: s.color }} />
                  ))}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[11px] text-sub">
                  {stages.map((s) => (
                    <span key={s.key}>
                      <span className="mr-[5px] inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
                      {s.label} {s.min}분
                    </span>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Row>

      <Row title="심박 · 스트레스">
        {vitals === null ? null : (
          <Stats>
            <Stat label="안정시 심박" value={vitals.restingHR === null ? null : String(vitals.restingHR)} unit="bpm" />
            <Stat
              label="최저 / 최고"
              value={vitals.minHR === null || vitals.maxHR === null ? null : `${vitals.minHR} / ${vitals.maxHR}`}
              unit="bpm"
            />
            <Stat label="평균 스트레스" value={vitals.avgStress === null ? null : String(vitals.avgStress)} />
            <Stat
              label="바디배터리"
              value={
                vitals.bodyBatteryLow === null || vitals.bodyBatteryHigh === null
                  ? null
                  : `${vitals.bodyBatteryLow} – ${vitals.bodyBatteryHigh}`
              }
            />
          </Stats>
        )}
      </Row>

      <Row title="체성분">
        {body === null ? null : (
          <Stats>
            <Stat label="체중" value={body.weight.toFixed(1)} unit="kg" />
            <Stat label="체지방" value={body.bodyFat === null ? null : body.bodyFat.toFixed(1)} unit="%" />
            <Stat label="근육량" value={body.muscleMass === null ? null : body.muscleMass.toFixed(1)} unit="kg" />
            <Stat label="출처" value={SOURCE_LABELS[body.source] ?? body.source} />
          </Stats>
        )}
      </Row>

      <Row title="혈압">
        {bp === null ? null : (
          <Stats>
            <Stat label="수축기" value={bp.lowSystolic === bp.highSystolic ? String(bp.highSystolic) : `${bp.lowSystolic} – ${bp.highSystolic}`} unit="mmHg" />
            <Stat label="이완기" value={bp.lowDiastolic === bp.highDiastolic ? String(bp.highDiastolic) : `${bp.lowDiastolic} – ${bp.highDiastolic}`} unit="mmHg" />
            <Stat label="맥박" value={bp.avgPulse === null ? null : String(bp.avgPulse)} unit="bpm" />
            <Stat label="측정" value={String(bp.measureCount)} unit="회" />
          </Stats>
        )}
      </Row>

      <Row title="걸음 · 칼로리">
        {movement === null ? null : (
          <Stats>
            <Stat label="걸음" value={movement.steps === null ? null : int(movement.steps)} unit="보" />
            <Stat label="활성 칼로리" value={movement.activeCalories === null ? null : int(movement.activeCalories)} unit="kcal" />
            <Stat label="총 소모" value={movement.totalCalories === null ? null : int(movement.totalCalories)} unit="kcal" />
            <Stat label="섭취" value={movement.intakeCalories === null ? null : int(movement.intakeCalories)} unit="kcal" />
            <Stat
              label="밸런스"
              value={movement.calorieBalance === null ? null : `${movement.calorieBalance > 0 ? "+" : ""}${int(movement.calorieBalance)}`}
              unit="kcal"
            />
          </Stats>
        )}
      </Row>

      <Row title="식단" link={day.foods.length > 0 ? { href: `/nutrition?date=${day.ymd}`, label: "영양 페이지" } : undefined}>
        {day.foods.length === 0 ? null : (
          <>
            <Stats>
              <Stat label="합계" value={foodTotal === null ? "추정 중" : int(foodTotal)} unit={foodTotal === null ? undefined : "kcal"} />
              <Stat label="기록" value={String(day.foods.length)} unit="건" />
            </Stats>
            <ul className="mt-2.5 max-w-[460px]">
              {day.foods.map((f) => (
                <li key={f.id} className="flex justify-between gap-3 py-1 text-[13px]">
                  <span className="min-w-0 text-muted">
                    {f.mealType && <span className="mr-2 text-[12px] text-sub">{MEAL_LABELS[f.mealType] ?? f.mealType}</span>}
                    {f.description}
                  </span>
                  <span className="whitespace-nowrap font-[family-name:var(--font-geist-mono)] text-sub">
                    {f.estimatedKcal === null ? "추정 중" : `${int(f.estimatedKcal)} kcal`}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Row>

      <Row title="AI 리포트">
        {day.reports.length === 0 ? null : (
          <div className="grid gap-3">
            {day.reports.map((r) => (
              <ReportBody key={r.id} title={REPORT_TITLES[r.category] ?? r.category} markdown={r.response} />
            ))}
          </div>
        )}
      </Row>
    </div>
  );
}
