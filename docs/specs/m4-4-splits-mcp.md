# [M4-4] Split/Lap 데이터 MCP 도구화

## 목적

AI 어드바이저가 러닝 활동의 km 구간별 데이터를 조회할 수 있도록 MCP 도구 추가.
현재 `/api/activities/[id]/splits`는 UI 전용, MCP에는 노출 안 됨.

## 요구사항

- [ ] MCP 서버에 `get_activity_splits` 도구 추가
- [ ] 입력: `activityId: string`
- [ ] 출력: Lap별 거리/시간/페이스/심박/케이던스/강도타입
- [ ] 시스템 프롬프트에 도구 사용 가이드 추가 (한계치 런 분석, 인터벌 분해 등)

## 기술 설계

### MCP 도구 정의

```typescript
// src/mcp/tools/get-activity-splits.ts
export const getActivitySplitsTool = {
  name: "get_activity_splits",
  description:
    "러닝 활동의 km별 스플릿 데이터 조회. 구간별 페이스/심박 분석, 인터벌/한계치 런 평가에 사용.",
  inputSchema: {
    type: "object",
    properties: {
      activityId: { type: "string", description: "Activity garminId 또는 id" },
    },
    required: ["activityId"],
  },
};

export async function handleGetActivitySplits(args: { activityId: string }) {
  const activity = await prisma.activity.findFirst({
    where: {
      OR: [{ garminId: args.activityId }, { id: args.activityId }],
    },
  });
  if (!activity) return { error: "활동을 찾을 수 없음" };

  // 기존 splits 조회 로직 재사용
  const splits = await fetchSplits(activity.garminId);
  return {
    _context: "km별 구간 데이터. 한계치 런은 목표 페이스 유지 여부, 인터벌은 고/저 구간 대비 평가.",
    activityId: activity.garminId,
    activityType: activity.type,
    totalDistance: activity.distance,
    laps: splits.map((lap) => ({
      lapIndex: lap.lapIndex,
      distance: lap.distance, // km
      duration: lap.duration, // sec
      pace: lap.pace, // min/km
      avgHR: lap.avgHR,
      maxHR: lap.maxHR,
      avgCadence: lap.avgCadence,
      intensityType: lap.intensityType, // WARMUP/INTERVAL/COOLDOWN/ACTIVE
    })),
  };
}
```

### 시스템 프롬프트 추가

```
### get_activity_splits
특정 활동의 km 구간 분석용. 사용 시점:
- 사용자가 "인터벌 잘 했어?", "한계치 페이스 유지됐나?" 질문
- 활동 상세 AI 평가에서 구간별 페이스 편차 분석
- Zone 타겟 달성도 확인
```

## 테스트 계획

- [ ] MCP 도구 목록에 추가 확인
- [ ] Claude CLI에서 실제 호출 및 응답 확인
- [ ] 존재하지 않는 activityId → error 반환
- [ ] `npm run lint && npx tsc --noEmit && npm run build` 통과
