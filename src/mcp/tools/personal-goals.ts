/**
 * M12 (#223): get_personal_goals MCP tool — 사용자의 평상 개인 목표 + 현재 진행도.
 *
 * 목표 미설정 시 각 필드는 결과에 포함되지 않음. AI 가 조회 후 리포트/조언에 참고.
 */

import { computePersonalGoals } from "@/lib/personal-goals";

export async function getPersonalGoals() {
  const goals = await computePersonalGoals();

  if (
    !goals.targetAvgPace &&
    !goals.targetWeeklyKm &&
    !goals.targetVO2max &&
    !goals.targetWeight &&
    !goals.personalGoalNote
  ) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            configured: false,
            note: "개인 목표 (평상 ongoing) 가 설정되지 않았습니다. Settings 페이지에서 targetAvgPace / targetWeeklyKm / targetVO2max / targetWeight / personalGoalNote 를 설정할 수 있습니다.",
          }),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          configured: true,
          goals,
        }),
      },
    ],
  };
}
