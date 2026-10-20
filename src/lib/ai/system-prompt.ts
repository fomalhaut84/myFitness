import prisma from "@/lib/prisma";
import { getZoneRanges, resolveLTHR, resolveMaxHR } from "@/lib/fitness/zones";
import { SYSTEM_PROMPT_DEFAULT } from "@/lib/prompts/defaults/system";
import { buildPowerSection } from "./power-section";

function formatKSTDateTime(): string {
  const now = new Date();
  const kst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  const h = String(kst.getHours()).padStart(2, "0");
  const min = String(kst.getMinutes()).padStart(2, "0");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const dayName = days[kst.getDay()];
  return `${y}년 ${m}월 ${d}일 ${dayName}요일 ${h}:${min} KST`;
}

async function buildUserProfileSection(): Promise<string> {
  // 프로필 row가 없어도 fallback Zone(190 bpm 기본)을 출력해야 함.
  // 신규 DB에서 /api/profile 호출 전이라도 AI가 Zone 인지 응답을 하도록.
  const profile = await prisma.userProfile.findFirst();

  const lines: string[] = ["## 사용자 프로필"];

  if (profile?.maxHR) lines.push(`- 최대 심박: ${profile.maxHR} bpm (실측)`);
  if (profile?.lthr) lines.push(`- LTHR: ${profile.lthr} bpm (실측)`);
  if (profile?.lthrPace) {
    const totalSec = Math.round(profile.lthrPace);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    lines.push(`- LTHR 페이스: ${min}:${String(sec).padStart(2, "0")}/km`);
  }
  if (profile?.targetCalories)
    lines.push(`- 일일 칼로리 목표: ${profile.targetCalories} kcal`);
  // M12 (#223): targetWeight 는 dynamic goals 섹션 (buildPersonalGoalsSection) 에서
  // 관리 → resume 세션에서도 최신 반영. 여기서 중복 노출하면 static prompt 에 stale
  // 값이 남아 dynamic 최신 값과 충돌 (Codex bot P2).

  // 프로필 정보가 하나도 없으면 안내 추가
  if (lines.length === 1) {
    lines.push(
      "- (프로필 미설정 — /settings/profile 에서 maxHR, LTHR 등을 입력하면 정확도가 향상됩니다)"
    );
  }

  // 개인 Zone: 실측 LTHR 우선, 없으면 나이/maxHR 기반 fallback (190 bpm 기본)
  const maxHR = resolveMaxHR(profile ?? {});
  const lthr = resolveLTHR(profile ?? {});
  const isMeasuredLthr = Boolean(profile?.lthr && profile.lthr > 0);
  const zones = getZoneRanges(lthr, maxHR);
  lines.push("");
  lines.push(
    `## 개인 HR Zone (${
      isMeasuredLthr ? "LTHR 실측 기반" : "추정값, 참고용"
    }, 러닝 분석 시 아래 값 우선)`
  );
  for (const z of zones) {
    const range =
      z.min === null
        ? `<${(z.max ?? 0) + 1} bpm`
        : z.max === null
          ? `${z.min}+ bpm`
          : `${z.min}-${z.max} bpm`;
    lines.push(`- Zone ${z.zone} (${z.label}): ${range}`);
  }
  // #570: 강도 평가 기준 + 러닝 파워 존
  lines.push(...buildPowerSection(profile));

  return lines.join("\n") + "\n";
}

/**
 * 정적(반정적) 시스템 프롬프트 — Claude CLI `--system-prompt` 로 전달해 API system param 분리 + 자동 캐싱 적격.
 * base(정적 · #552 부터 DB 활성 버전 — 호출자가 `resolvePrompt("system")` 로 넘긴다) + UserProfile section(반정적, 프로필 변경 시 무효화).
 *
 * NOTE: 개인 목표 (M12 #223) 는 dynamic context 로 이동. 이유: static prompt 는
 * 세션 resume (--resume) 시 재빌드되지 않아 Settings 에서 목표 변경/저장해도 다음
 * 세션까지 반영 안 됨 (Codex bot P2). 매 호출 새로 계산되는 dynamic context 로 이동.
 */
export async function buildStaticSystemPrompt(base: string = SYSTEM_PROMPT_DEFAULT): Promise<string> {
  const profileSection = await buildUserProfileSection();
  return `${base}\n${profileSection}`;
}

/**
 * 호출마다 변하는 동적 컨텍스트 — user message 앞에 prepend. 캐시 무효화 원인.
 * M12 (#223): 개인 목표 컨텍스트를 여기 포함해 세션 resume 이후에도 최신 반영.
 */
export async function buildDynamicContext(): Promise<string> {
  const goalsSection = await buildPersonalGoalsSection();
  return `## 현재 시간\n${formatKSTDateTime()}\n${goalsSection ? `\n${goalsSection}` : ""}`;
}

/** M12 (#223): 개인 목표 컨텍스트. 미설정 시 빈 문자열. */
async function buildPersonalGoalsSection(): Promise<string> {
  const { computePersonalGoals, formatGoalsForPrompt } = await import(
    "@/lib/personal-goals"
  );
  const goals = await computePersonalGoals();
  return formatGoalsForPrompt(goals);
}

/** 호환용: 정적+동적 합쳐 단일 문자열 반환. 신규 코드는 buildStaticSystemPrompt/buildDynamicContext 직접 사용. */
export async function buildSystemPrompt(): Promise<string> {
  const [staticPart, dynamicPart] = await Promise.all([
    buildStaticSystemPrompt(),
    buildDynamicContext(),
  ]);
  return `${staticPart}${dynamicPart}`;
}
