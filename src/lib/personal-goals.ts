/**
 * M12 (#223): 개인 목표 (평상 목표) 진행도 계산.
 *
 * UserProfile 의 target* 필드 값과 실제 최근 데이터를 비교해 각 목표별 현재
 * 상태 + 진행도 % 반환. AI 어드바이저 시스템 프롬프트 컨텍스트 + 리포트 프롬프트
 * 삽입, MCP `get_personal_goals` tool 응답에 공통 사용.
 *
 * 원칙: 목표 필드가 null 이면 해당 항목 undefined. 진행도 산출 데이터 부재 시도
 * undefined (조용히 skip — 시스템 프롬프트에서 항목 자체 생략).
 */

import prisma from "@/lib/prisma";
import { daysAgoKST, todayKST } from "@/lib/garmin/utils";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PaceGoal {
  target: number; // sec/km
  current: number | null; // 최근 30일 활동의 거리 가중 평균
  gapSec: number | null; // current - target (양수 = 더 느림, 개선 여지)
  formattedTarget: string; // "5:45"
  formattedCurrent: string | null; // "5:58" 또는 null
}

export interface WeeklyKmGoal {
  target: number; // km/week
  current: number | null; // 최근 4주 평균 (km/week)
  progressPct: number | null; // (current / target) * 100
}

export interface VO2MaxGoal {
  target: number;
  current: number | null; // 최신 UserProfile.vo2maxRunning
  gap: number | null;
}

export interface WeightGoal {
  target: number; // kg
  current: number | null; // 최신 BodyComposition
  startWeight: number | null; // 목표 설정 이후 첫 record (proxy: 최오래된 record)
  progressPct: number | null; // 0~100
}

export interface PersonalGoalsProgress {
  targetAvgPace?: PaceGoal;
  targetWeeklyKm?: WeeklyKmGoal;
  targetVO2max?: VO2MaxGoal;
  targetWeight?: WeightGoal;
  personalGoalNote?: string; // 커스텀 텍스트 (자유 입력)
}

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * 최근 30일 러닝 활동의 거리 가중 평균 페이스 (sec/km).
 * 러닝 아닌 활동은 제외. 거리 없는 활동도 제외.
 */
async function recentAvgPace(days = 30): Promise<number | null> {
  const since = daysAgoKST(days);
  // 러닝 종류 필터 — 코드베이스 규약 (pace-progression/race-prediction/calendar 등) 과
  // 통일. Garmin 은 track_running/street_running/virtual_run/indoor_running 등 다양한
  // typeKey 반환 → contains 로 sub-type 포함 (whitelist 는 누락 위험).
  const activities = await prisma.activity.findMany({
    where: {
      startTime: { gte: since },
      activityType: { contains: "running" },
      avgPace: { not: null },
      distance: { not: null, gt: 0 },
    },
    select: { avgPace: true, distance: true },
  });
  if (activities.length === 0) return null;
  // 거리 가중 평균 = Σ(pace × distance) / Σ(distance)
  let totalWeight = 0;
  let weightedSum = 0;
  for (const a of activities) {
    if (a.avgPace === null || a.distance === null) continue;
    weightedSum += a.avgPace * a.distance;
    totalWeight += a.distance;
  }
  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

/**
 * 최근 4주 러닝 주간 평균 (km/week).
 * 활동을 KST 주 단위 (월~일) 로 그룹핑하지 않고 간단히 total_km / 4 로 근사.
 */
async function recentWeeklyKm(weeks = 4): Promise<number | null> {
  const since = new Date(todayKST().getTime() - weeks * 7 * DAY_MS);
  const activities = await prisma.activity.findMany({
    where: {
      startTime: { gte: since },
      // 러닝 종류 필터 — pace-progression 등과 동일 규약 (contains).
      activityType: { contains: "running" },
      distance: { not: null, gt: 0 },
    },
    select: { distance: true },
  });
  if (activities.length === 0) return null;
  const totalMeters = activities.reduce((sum, a) => sum + (a.distance ?? 0), 0);
  return totalMeters / 1000 / weeks;
}

async function latestVO2max(): Promise<number | null> {
  const profile = await prisma.userProfile.findFirst({
    select: { vo2maxRunning: true },
  });
  return profile?.vo2maxRunning ?? null;
}

async function latestAndStartWeight(): Promise<{
  current: number | null;
  start: number | null;
}> {
  const [latest, earliest] = await Promise.all([
    prisma.bodyComposition.findFirst({
      orderBy: { date: "desc" },
      select: { weight: true },
    }),
    prisma.bodyComposition.findFirst({
      orderBy: { date: "asc" },
      select: { weight: true },
    }),
  ]);
  return {
    current: latest?.weight ?? null,
    start: earliest?.weight ?? null,
  };
}

/**
 * 사용자 개인 목표 + 현재 진행도 계산.
 * 미설정 필드는 결과에 포함 안 함 → AI 컨텍스트/UI 에서 조건부 렌더링.
 */
export async function computePersonalGoals(): Promise<PersonalGoalsProgress> {
  const profile = await prisma.userProfile.findFirst({
    select: {
      targetAvgPace: true,
      targetWeeklyKm: true,
      targetVO2max: true,
      targetWeight: true,
      personalGoalNote: true,
    },
  });
  if (!profile) return {};

  const result: PersonalGoalsProgress = {};

  if (profile.targetAvgPace !== null) {
    const current = await recentAvgPace();
    result.targetAvgPace = {
      target: profile.targetAvgPace,
      current,
      gapSec: current !== null ? current - profile.targetAvgPace : null,
      formattedTarget: formatPace(profile.targetAvgPace),
      formattedCurrent: current !== null ? formatPace(current) : null,
    };
  }

  if (profile.targetWeeklyKm !== null) {
    const current = await recentWeeklyKm();
    result.targetWeeklyKm = {
      target: profile.targetWeeklyKm,
      current,
      progressPct:
        current !== null
          ? Math.round((current / profile.targetWeeklyKm) * 100)
          : null,
    };
  }

  if (profile.targetVO2max !== null) {
    const current = await latestVO2max();
    result.targetVO2max = {
      target: profile.targetVO2max,
      current,
      gap: current !== null ? profile.targetVO2max - current : null,
    };
  }

  if (profile.targetWeight !== null) {
    const { current, start } = await latestAndStartWeight();
    let progressPct: number | null = null;
    if (current !== null && start !== null && start !== profile.targetWeight) {
      // 부호 있는 진행률: 목표 방향과 같으면 양수, 반대 방향이면 clamp 0.
      // Math.abs 로 부호를 없애면 목표 반대 방향 (감량 목표인데 오히려 증가)
      // 도 양의 진행률로 보고되어 AI 가 잘못된 격려를 함.
      const direction = profile.targetWeight - start; // signed goal delta
      const moved = current - start; // signed progress
      const rawPct = (moved / direction) * 100;
      progressPct = Math.max(0, Math.min(100, Math.round(rawPct)));
    }
    result.targetWeight = {
      target: profile.targetWeight,
      current,
      startWeight: start,
      progressPct,
    };
  }

  if (profile.personalGoalNote) {
    result.personalGoalNote = profile.personalGoalNote;
  }

  return result;
}

/**
 * AI 시스템 프롬프트에 삽입할 마크다운 섹션.
 * 목표 미설정 시 빈 문자열 반환 → 프롬프트에서 조건부 skip.
 */
export function formatGoalsForPrompt(goals: PersonalGoalsProgress): string {
  const lines: string[] = [];
  if (goals.targetAvgPace) {
    const g = goals.targetAvgPace;
    const currentStr = g.formattedCurrent ?? "데이터 없음";
    const gapStr =
      g.gapSec !== null
        ? ` (gap ${g.gapSec >= 0 ? "+" : ""}${Math.round(g.gapSec)}sec)`
        : "";
    lines.push(
      `- 평균 페이스 목표: ${g.formattedTarget}/km (최근 30일 avg ${currentStr}/km${gapStr})`,
    );
  }
  if (goals.targetWeeklyKm) {
    const g = goals.targetWeeklyKm;
    const currentStr =
      g.current !== null ? `${g.current.toFixed(1)}km` : "데이터 없음";
    const pctStr = g.progressPct !== null ? ` (${g.progressPct}%)` : "";
    lines.push(
      `- 주간 러닝 거리 목표: ${g.target}km/week (최근 4주 avg ${currentStr}${pctStr})`,
    );
  }
  if (goals.targetVO2max) {
    const g = goals.targetVO2max;
    const currentStr = g.current !== null ? g.current.toFixed(1) : "데이터 없음";
    const gapStr =
      g.gap !== null ? ` (남은 ${g.gap >= 0 ? "+" : ""}${g.gap.toFixed(1)})` : "";
    lines.push(
      `- VO2max 목표: ${g.target.toFixed(1)} (현재 ${currentStr}${gapStr})`,
    );
  }
  if (goals.targetWeight) {
    const g = goals.targetWeight;
    const currentStr =
      g.current !== null ? `${g.current.toFixed(1)}kg` : "데이터 없음";
    const pctStr = g.progressPct !== null ? ` (${g.progressPct}% 진행)` : "";
    lines.push(
      `- 체중 목표: ${g.target.toFixed(1)}kg (현재 ${currentStr}${pctStr})`,
    );
  }
  if (goals.personalGoalNote) {
    lines.push(`- 커스텀 목표: ${goals.personalGoalNote}`);
  }
  if (lines.length === 0) return "";
  return `## 개인 목표 (평상 ongoing)\n\n${lines.join("\n")}\n`;
}
