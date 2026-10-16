// #527: 입력 → 저장 행 · 판정 · 직전 회차 비교 · 입력 스키마. 값은 가상.
import { describe, expect, it } from "vitest";
import { buildResultRows } from "../build";
import { countFlags, previousResults } from "../compare";
import { resolveFlag } from "../flag";
import { CHECKUP_INPUT } from "../schema";

describe("resolveFlag", () => {
  it("기관 판정이 있으면 그대로 (범위 안이어도)", () => {
    expect(resolveFlag({ flag: "caution", valueNum: 15, refLow: 10, refHigh: 20 })).toEqual({
      flag: "caution",
      flagSource: "institution",
    });
  });

  it("판정이 없으면 범위로 계산 — 경계값은 정상", () => {
    expect(resolveFlag({ valueNum: 20, refLow: 10, refHigh: 20 })).toEqual({ flag: "normal", flagSource: "computed" });
    expect(resolveFlag({ valueNum: 20.1, refLow: 10, refHigh: 20 })).toEqual({ flag: "abnormal", flagSource: "computed" });
    expect(resolveFlag({ valueNum: 9, refLow: 10, refHigh: null })).toEqual({ flag: "abnormal", flagSource: "computed" });
  });

  // 회귀: #527 사전 리뷰 major 2 — `<5.7` 에 5.7 은 범위 밖
  it("미포함 경계값은 범위 밖", () => {
    expect(resolveFlag({ valueNum: 5.7, refLow: null, refHigh: 5.7, highExclusive: true }).flag).toBe("abnormal");
    expect(resolveFlag({ valueNum: 5.6, refLow: null, refHigh: 5.7, highExclusive: true }).flag).toBe("normal");
    expect(resolveFlag({ valueNum: 60, refLow: 60, refHigh: null, lowExclusive: true }).flag).toBe("abnormal");
    const res = buildResultRows([{ label: "당화혈색소", value: "5.7", ref: "<5.7" }]);
    expect(res.ok && res.rows[0].flag).toBe("abnormal");
  });

  it("수치 · 범위가 없으면 판정 없음 (caution 은 계산하지 않는다)", () => {
    expect(resolveFlag({ valueNum: null, refLow: 10, refHigh: 20 })).toEqual({ flag: null, flagSource: null });
    expect(resolveFlag({ valueNum: 5, refLow: null, refHigh: null })).toEqual({ flag: null, flagSource: null });
  });
});

describe("buildResultRows", () => {
  it("카탈로그 매칭 · 단위 · 기준범위 · 계산 판정", () => {
    const res = buildResultRows([{ label: "중성지방", value: "180", ref: "0-149" }]);
    expect(res).toEqual({
      ok: true,
      rows: [
        expect.objectContaining({
          itemCode: "tg",
          label: "중성지방",
          category: "지질",
          valueNum: 180,
          valueText: "180",
          unit: "mg/dL",
          refLow: 0,
          refHigh: 149,
          flag: "abnormal",
          flagSource: "computed",
        }),
      ],
    });
  });

  it("결과지 단위가 있으면 카탈로그 단위보다 우선 (옛 결과지 · 스펙 §5)", () => {
    const res = buildResultRows([{ itemCode: "egfr", label: "eGFR", value: "90", unit: "mL/min" }]);
    expect(res.ok && res.rows[0].unit).toBe("mL/min");
  });

  // 회귀: PR #528 Codex P2 — 빈 단위 칸이 카탈로그 단위를 지우지 않는다
  it("빈 · 공백 단위는 카탈로그 단위로", () => {
    for (const unit of ["", "   "]) {
      const parsed = CHECKUP_INPUT.parse({ date: "2025-06-11", kind: "other", results: [{ label: "LDL", value: "100", unit, ref: " " }] });
      expect(parsed.results[0].unit).toBeNull();
      expect(parsed.results[0].ref).toBeNull();
      const res = buildResultRows(parsed.results);
      expect(res.ok && res.rows[0].unit).toBe("mg/dL");
    }
  });

  it("정성 항목 · 판독문 · 추적검사 (KST 자정)", () => {
    const res = buildResultRows([
      { label: "상복부 초음파", value: "유소견", ref: "정상", flag: "abnormal", note: "가상 판독문", followUp: "12개월 후 추적", followUpDue: "2027-01-15" },
    ]);
    expect(res.ok && res.rows[0]).toMatchObject({
      itemCode: "abdominal_us",
      valueNum: null,
      valueText: "유소견",
      flag: "abnormal",
      flagSource: "institution",
      note: "가상 판독문",
    });
    expect(res.ok && res.rows[0].followUpDue?.toISOString()).toBe("2027-01-14T15:00:00.000Z");
  });

  it("카탈로그 밖 항목 → custom code · 분류 · 수치 해석", () => {
    const res = buildResultRows([{ label: "가상 표지자 X", value: "1.5", unit: "ng/mL", category: "종양표지자" }]);
    expect(res.ok && res.rows[0]).toMatchObject({ itemCode: "custom:가상표지자x", category: "종양표지자", valueNum: 1.5, unit: "ng/mL" });
    const noCat = buildResultRows([{ label: "가상 항목", value: "양성" }]);
    expect(noCat.ok && noCat.rows[0].category).toBe("기타");
  });

  it("명시 code 는 카탈로그 · custom 형식만", () => {
    expect(buildResultRows([{ itemCode: "nope", label: "x", value: "1" }])).toEqual({
      ok: false,
      error: "알 수 없는 항목 코드입니다: nope",
    });
    expect(buildResultRows([{ itemCode: "custom:BAD CODE", label: "x", value: "1" }]).ok).toBe(false);
    expect(buildResultRows([{ itemCode: "custom:가상", label: "x", value: "1" }]).ok).toBe(true);
  });

  it("카탈로그와 같은 이름의 custom code 는 카탈로그 code 로", () => {
    const res = buildResultRows([{ itemCode: "custom:ldl", label: "LDL", value: "100" }]);
    expect(res.ok && res.rows[0].itemCode).toBe("ldl");
  });

  // 회귀: #527 사전 리뷰 major 1 — 혈액 WBC 와 소변 WBC 가 한 회차에 함께 있어도 거부되지 않는다
  it("혈액 · 소변 같은 이름 항목이 함께 있어도 각자 저장", () => {
    const res = buildResultRows([
      { label: "WBC", value: "6.0" },
      { label: "WBC(요)", value: "-" },
      { label: "크레아티닌", value: "0.9" },
      { label: "크레아티닌(요)", value: "100" },
    ]);
    expect(res.ok && res.rows.map((r) => r.itemCode)).toEqual(["wbc", "urine_wbc", "creatinine", "custom:크레아티닌요"]);
  });

  it("같은 항목 두 번 (표기가 달라도) 은 거부", () => {
    const res = buildResultRows([
      { label: "γ-GTP", value: "30" },
      { label: "감마지티피", value: "31" },
    ]);
    expect(res).toEqual({ ok: false, error: "같은 항목이 두 번 입력됐습니다: γ-GTP · 감마지티피" });
  });

  it("알아볼 수 없는 항목명은 거부", () => {
    expect(buildResultRows([{ label: "---", value: "1" }]).ok).toBe(false);
  });
});

describe("previousResults", () => {
  const history = [
    { date: "2019-05-01", itemCode: "ldl", v: 1 },
    { date: "2021-05-01", itemCode: "ldl", v: 2 },
    { date: "2021-05-01", itemCode: "tsh", v: 3 },
    { date: "2023-05-01", itemCode: "ldl", v: 4 },
    { date: "2025-05-01", itemCode: "ldl", v: 5 },
  ];

  it("직전 시행 회차 — 바로 전 회차에 없으면 더 앞 회차", () => {
    const prev = previousResults("2025-05-01", ["ldl", "tsh", "hdl"], history);
    expect(prev.get("ldl")?.v).toBe(4);
    expect(prev.get("tsh")?.v).toBe(3);
    expect(prev.has("hdl")).toBe(false);
  });

  it("같은 날짜 · 이후 회차는 제외 · 입력 순서 무관", () => {
    const prev = previousResults("2021-05-01", ["ldl"], [...history].reverse());
    expect(prev.get("ldl")?.v).toBe(1);
  });
});

describe("countFlags", () => {
  it("주의 · 이상만 센다", () => {
    expect(countFlags([{ flag: "caution" }, { flag: "abnormal" }, { flag: "caution" }, { flag: "normal" }, { flag: null }])).toEqual({
      caution: 2,
      abnormal: 1,
    });
  });
});

describe("CHECKUP_INPUT", () => {
  const base = { date: "2025-06-11", kind: "comprehensive", results: [{ label: "AST", value: "20" }] };

  it("정상 입력 · source 기본값 manual", () => {
    const parsed = CHECKUP_INPUT.safeParse(base);
    expect(parsed.success && parsed.data.source).toBe("manual");
  });

  it("날짜 · 종류 · 빈 결과 · 빈 값 거부", () => {
    expect(CHECKUP_INPUT.safeParse({ ...base, date: "2025-02-30" }).success).toBe(false);
    expect(CHECKUP_INPUT.safeParse({ ...base, kind: "bogus" }).success).toBe(false);
    expect(CHECKUP_INPUT.safeParse({ ...base, results: [] }).success).toBe(false);
    expect(CHECKUP_INPUT.safeParse({ ...base, results: [{ label: "AST", value: "  " }] }).success).toBe(false);
    expect(
      CHECKUP_INPUT.safeParse({ ...base, results: [{ label: "AST", value: "1", followUpDue: "2025-13-01" }] }).success,
    ).toBe(false);
  });
});
