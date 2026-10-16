// #544: 복약 — 입력 검증 · 기간 · 검진 연결 · 타임라인. 약 이름 · 날짜는 전부 가상.
import { describe, expect, it } from "vitest";
import { MEDICATION_INPUT, prepareMedicationWrite } from "../schema";
import { courseDays, daysLeft, endFromDays, medicationStatus, sinceText } from "../period";
import { medsForCheckup, medsForItem } from "../link";
import { buildTimeline } from "../timeline";
import type { MedicationDto } from "../dto";

const TODAY = "2032-10-16";
const base = { name: "가상약 A", kind: "prescription", regimen: "long_term", startDate: "2030-01-02" };

describe("MEDICATION_INPUT · prepareMedicationWrite", () => {
  it("장기는 종료일 없이 · 빈 칸은 null · 관련 항목 중복 제거", () => {
    const p = MEDICATION_INPUT.parse({ ...base, dose: " ", relatedItems: ["ldl", "ldl", "custom:가상항목"] });
    expect([p.endDate ?? null, p.dose, p.relatedItems]).toEqual([null, null, ["ldl", "custom:가상항목"]]);
  });

  it("단기는 종료일 필수 · 종료 < 시작 거부", () => {
    expect(MEDICATION_INPUT.safeParse({ ...base, regimen: "short_term" }).success).toBe(false);
    expect(MEDICATION_INPUT.safeParse({ ...base, endDate: "2030-01-01" }).success).toBe(false);
    expect(MEDICATION_INPUT.safeParse({ ...base, regimen: "short_term", endDate: "2030-01-02" }).success).toBe(true);
  });

  it("알 수 없는 항목 code · 항목 수 상한 · 이름 길이 · 잘못된 날짜 거부", () => {
    expect(MEDICATION_INPUT.safeParse({ ...base, relatedItems: ["없는항목"] }).success).toBe(false);
    expect(MEDICATION_INPUT.safeParse({ ...base, relatedItems: ["custom:Bad Code"] }).success).toBe(false);
    expect(MEDICATION_INPUT.safeParse({ ...base, relatedItems: Array.from({ length: 21 }, (_, i) => `custom:x${i}`) }).success).toBe(false);
    expect(MEDICATION_INPUT.safeParse({ ...base, name: "x".repeat(101) }).success).toBe(false);
    expect(MEDICATION_INPUT.safeParse({ ...base, startDate: "2030-02-30" }).success).toBe(false);
  });

  it("미래 시작일 거부 · 첫 오류 문구를 응답에", () => {
    expect(prepareMedicationWrite({ ...base, startDate: "2032-10-17" }, TODAY)).toMatchObject({ ok: false, body: { error: "시작일이 오늘 뒤입니다" } });
    expect(prepareMedicationWrite({ ...base, regimen: "short_term" }, TODAY)).toMatchObject({ ok: false, body: { error: "단기 복용은 종료일이 필요합니다" } });
    expect(prepareMedicationWrite(base, TODAY).ok).toBe(true);
  });
});

describe("기간", () => {
  it("N일분 → 종료일 (시작일 포함) · 월말 · 범위 밖", () => {
    expect(endFromDays("2030-01-30", 1)).toBe("2030-01-30");
    expect(endFromDays("2030-01-30", 5)).toBe("2030-02-03");
    expect(endFromDays("2030-01-30", 0)).toBeNull();
    expect(endFromDays("2030-01-30", 366)).toBeNull();
    expect(endFromDays("2030-01-30", 2.5)).toBeNull();
    expect(courseDays("2030-01-30", "2030-02-03")).toBe(5);
  });

  it("상태 — 종료일 = 오늘은 복용 중 · 시작 전은 scheduled", () => {
    expect(medicationStatus({ startDate: "2032-10-01", endDate: TODAY }, TODAY)).toBe("active");
    expect(medicationStatus({ startDate: "2032-10-01", endDate: "2032-10-15" }, TODAY)).toBe("ended");
    expect(medicationStatus({ startDate: "2032-10-17", endDate: null }, TODAY)).toBe("scheduled");
    expect(daysLeft("2032-10-18", TODAY)).toBe(2);
  });

  it("며칠째 · 몇 개월째 · 몇 년째", () => {
    expect(sinceText(TODAY, TODAY)).toBe("1일째");
    expect(sinceText("2032-09-20", TODAY)).toBe("27일째");
    expect(sinceText("2032-07-17", TODAY)).toBe("2개월째");
    expect(sinceText("2029-04-02", TODAY)).toBe("3년 6개월째");
    expect(sinceText("2030-10-16", TODAY)).toBe("2년째");
  });
});

const med = (over: Partial<MedicationDto>): MedicationDto => ({
  id: "m",
  name: "가상약",
  kind: "prescription",
  regimen: "long_term",
  ingredient: null,
  dose: null,
  frequency: null,
  startDate: "2030-01-01",
  endDate: null,
  purpose: null,
  prescriber: null,
  note: null,
  relatedItems: [],
  ...over,
});

describe("medsForCheckup · medsForItem", () => {
  const meds = [
    med({ id: "l1", name: "장기 나", relatedItems: ["sbp"] }),
    med({ id: "l2", name: "장기 가", relatedItems: ["ldl"] }),
    med({ id: "l3", name: "끝난 장기", relatedItems: ["sbp"], endDate: "2031-01-01" }),
    med({ id: "s1", name: "단기 당일", regimen: "short_term", startDate: "2032-06-08", endDate: "2032-06-12" }),
    med({ id: "s2", name: "단기 14일", regimen: "short_term", startDate: "2032-05-25", endDate: "2032-05-28" }),
    med({ id: "s3", name: "단기 15일", regimen: "short_term", startDate: "2032-05-20", endDate: "2032-05-27" }),
    med({ id: "s4", name: "단기 검진 뒤", regimen: "short_term", startDate: "2032-06-12", endDate: "2032-06-14" }),
  ];

  it("장기는 관련 항목 + 기간 · 단기는 검진일 앞 14일 경계 (항목 무관) · 단기는 가까운 순", () => {
    const got = medsForCheckup(meds, "sbp", "2032-06-11");
    expect(got.map((g) => [g.id, g.endedDaysBefore])).toEqual([
      ["l1", null],
      ["s1", 0],
      ["s2", 14],
    ]);
  });

  it("관련 항목으로 지정한 약만 · 시작일 순", () => {
    expect(medsForItem(meds, "sbp").map((m) => m.id)).toEqual(["l1", "l3"]);
  });
});

describe("buildTimeline", () => {
  it("축은 첫 해 ~ 올해 + 1 · 복용 중 막대는 오늘까지 · 같은 이름 장기는 한 줄 · 단기는 점", () => {
    const t = buildTimeline(
      [
        med({ id: "a", name: "장기", startDate: "2030-01-01", endDate: "2030-12-31" }),
        med({ id: "b", name: "장기", startDate: "2031-07-02" }),
        med({ id: "c", name: "단기", regimen: "short_term", startDate: "2031-03-01", endDate: "2031-03-03" }),
      ],
      ["2029-06-01"],
      TODAY,
    );
    expect(t?.years.map((y) => y.year)).toEqual([2029, 2030, 2031, 2032, 2033]);
    expect(t?.lanes).toHaveLength(1);
    const [, open] = t!.lanes[0].bars;
    expect(open.x1).toBeLessThan(1);
    expect(open.x1).toBeGreaterThan(0.75);
    expect(t?.shortDots.map((d) => d.id)).toEqual(["c"]);
    expect(t?.checkups[0].x).toBeGreaterThan(0);
    expect(buildTimeline([], [], TODAY)).toBeNull();
  });
});

describe("itemMedications", () => {
  it("관련 복약 + 회차별 배지", async () => {
    const { itemMedications } = await import("../link");
    const r = itemMedications([med({ id: "l", relatedItems: ["ldl"] })], "ldl", [
      { checkupId: "c1", date: "2029-06-01" },
      { checkupId: "c2", date: "2031-06-01" },
    ]);
    expect(r.related.map((m) => m.id)).toEqual(["l"]);
    expect([r.byCheckup.c1.length, r.byCheckup.c2.length]).toEqual([0, 1]);
  });
});

describe("form-model", () => {
  it("단기 N일분 → 종료일 · 장기 빈칸 → 복용 중 · 다시 시작은 같은 일수", async () => {
    const { emptyMedForm, medFormToInput, restartFrom, defaultRegimen } = await import("../form-model");
    const f = { ...emptyMedForm("2032-10-14"), name: "가상 감기약", days: "5" };
    expect(medFormToInput(f).endDate).toBe("2032-10-18");
    expect(medFormToInput({ ...f, regimen: "long_term", endMode: "date", endDate: "" }).endDate).toBeNull();
    expect(defaultRegimen("supplement")).toBe("long_term");
    const again = restartFrom(med({ regimen: "short_term", startDate: "2031-01-01", endDate: "2031-01-07" }), TODAY);
    expect([again.startDate, again.endMode, again.days]).toEqual([TODAY, "days", "7"]);
    expect(restartFrom(med({ endDate: "2031-01-07" }), TODAY).endDate).toBe("");
  });
});

// 회귀: PR 전 리뷰 major — 종료일이 오늘인 장기 복용은 "복용 중" 카드에 종료 버튼이 보이는데 409 였다
describe("endTodayDecision", () => {
  it("종료일 = 오늘은 종료 (같은 값) · 어제 끝남은 already · 시작 전은 not_started", async () => {
    const { endTodayDecision, medicationStatus } = await import("../period");
    const endsToday = { startDate: "2032-01-01", endDate: TODAY };
    expect(medicationStatus(endsToday, TODAY)).toBe("active");
    expect(endTodayDecision(endsToday, TODAY)).toBe("end");
    expect(endTodayDecision({ startDate: "2032-01-01", endDate: null }, TODAY)).toBe("end");
    expect(endTodayDecision({ startDate: "2032-01-01", endDate: "2032-12-31" }, TODAY)).toBe("end");
    expect(endTodayDecision({ startDate: "2032-01-01", endDate: "2032-10-15" }, TODAY)).toBe("already_ended");
    expect(endTodayDecision({ startDate: "2032-10-17", endDate: null }, TODAY)).toBe("not_started");
  });

  it("365일 넘는 단기 복용 다시 시작은 종료일 직접 입력으로", async () => {
    const { restartFrom } = await import("../form-model");
    const r = restartFrom(med({ regimen: "short_term", startDate: "2030-01-01", endDate: "2031-06-01" }), TODAY);
    expect([r.endMode, r.endDate]).toEqual(["date", ""]);
  });
});
