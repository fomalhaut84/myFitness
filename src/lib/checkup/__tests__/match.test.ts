// #527: 항목명 매칭 — 정규화 · 괄호 부기 · `_` 결합 표기. 카탈로그 무결성 (code 중복 · 별칭 충돌).
import { describe, expect, it } from "vitest";
import { CHECKUP_CATEGORIES, CHECKUP_ITEMS, getCheckupItem } from "../items";
import { customCode, labelCandidates, matchItem, normalizeLabel } from "../match";

describe("카탈로그 무결성", () => {
  it("code 중복 없음", () => {
    const codes = CHECKUP_ITEMS.map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("정규화한 이름 · 별칭이 서로 다른 두 항목에 겹치지 않는다", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const item of CHECKUP_ITEMS) {
      for (const name of [item.code, item.label, ...item.aliases]) {
        const key = normalizeLabel(name);
        const prev = owner.get(key);
        if (prev && prev !== item.code) clashes.push(`${key}: ${prev} / ${item.code}`);
        owner.set(key, item.code);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("모든 항목의 분류가 섹션 목록에 있다", () => {
    for (const item of CHECKUP_ITEMS) expect(CHECKUP_CATEGORIES).toContain(item.category);
  });

  it("numeric 항목은 소수 자릿수가 0 이상 정수", () => {
    for (const item of CHECKUP_ITEMS.filter((i) => i.valueType === "numeric")) {
      expect(Number.isInteger(item.decimals) && item.decimals >= 0).toBe(true);
    }
  });
});

describe("normalizeLabel", () => {
  it("대소문자 · 공백 · 구두점 · 그리스 문자", () => {
    expect(normalizeLabel(" γ-GTP ")).toBe("ggtp");
    expect(normalizeLabel("HDL 콜레스테롤")).toBe("hdl콜레스테롤");
    expect(normalizeLabel("ＡＳＴ")).toBe("ast"); // 전각 → NFKC
  });
});

describe("matchItem", () => {
  it("이름 · 별칭 · code", () => {
    expect(matchItem("공복혈당")).toBe("fbs");
    expect(matchItem("감마지티피")).toBe("ggt");
    expect(matchItem("γ-GTP")).toBe("ggt");
    expect(matchItem("ldl")).toBe("ldl");
  });

  it("괄호 · 대괄호 부기는 떼고 맞춘다", () => {
    expect(matchItem("크레아티닌[혈청]")).toBe("creatinine");
    expect(matchItem("AST (SGOT)")).toBe("ast");
    expect(matchItem("요단백(정성)")).toBe("urine_protein");
  });

  it("괄호 안 내용이 항목명인 표기", () => {
    expect(matchItem("NGSP 검사(당화혈색소)")).toBe("hba1c");
  });

  it("`_` 로 결합된 표기는 부분별로 맞춘다", () => {
    expect(matchItem("췌장효소_Lipase")).toBe("lipase");
    expect(matchItem("간암표지자_AFP(EIA)")).toBe("afp");
  });

  // 회귀: #527 사전 리뷰 major 1 — 검체 · 조건 한정자를 떼면 다른 검체의 항목 (혈액 · 공복혈당) 으로 오매칭
  it("검체 · 조건 한정자가 붙은 이름은 다른 검체 항목으로 가지 않는다", () => {
    for (const label of ["RBC(요침사)", "Hb(요)", "알부민(요)", "크레아티닌(요)", "혈당(식후)", "혈당(PP2)", "소변_크레아티닌", "적혈구(요)"]) {
      const code = matchItem(label);
      expect(["rbc", "hb", "albumin", "creatinine", "fbs"]).not.toContain(code);
    }
    expect(matchItem("혈당(식후)")).toBeNull();
  });

  // 회귀: PR #528 Codex P1 — 한정자에 설명이 덧붙어도 (쉼표 · 영문 복합어 · 접두) 혈액 항목으로 가지 않는다
  it("설명이 덧붙은 검체 한정자도 가드", () => {
    for (const label of ["WBC(요, 정성)", "WBC(Urine sediment)", "RBC(urine/현미경)", "혈당(식후 2시간)", "WBC_소변 정성", "크레아티닌(Urine, random)",
      // 회귀: PR #528 Codex P1 2회차 — 필드명 접두 (`검체:` · `검체-`)
      "WBC(검체:요)", "WBC(검체:Urine)", "RBC(검체-소변)", "WBC(specimen=urine)", "WBC(검체 요)"]) {
      expect(["wbc", "rbc", "fbs", "creatinine"]).not.toContain(matchItem(label));
    }
  });

  it("흔한 소변 표기는 소변 항목으로", () => {
    expect(matchItem("WBC(요)")).toBe("urine_wbc");
    expect(matchItem("백혈구(요)")).toBe("urine_wbc");
    expect(matchItem("백혈구(요침사)")).toBe("urine_sed_wbc");
    expect(matchItem("RBC(요침사)")).toBe("urine_sed_rbc");
    expect(matchItem("Glucose(요)")).toBe("urine_glucose");
    expect(matchItem("단백(요)")).toBe("urine_protein");
  });

  it("한정자가 아닌 부기는 그대로 떼고 맞춘다", () => {
    expect(matchItem("요단백(정성)")).toBe("urine_protein");
    expect(matchItem("요산(혈청)")).toBe("uric_acid"); // 한 글자 '요' 는 부분 문자열로 찾지 않는다
    expect(matchItem("AST(SGOT)")).toBe("ast");
    expect(matchItem("혈당(공복)")).toBe("fbs");
  });

  it("미매칭은 null", () => {
    expect(matchItem("임의 검사 항목")).toBeNull();
    expect(matchItem("()")).toBeNull();
  });

  it("후보는 중복 없이 우선순위 순", () => {
    expect(labelCandidates("크레아티닌[혈청]")).toEqual(["크레아티닌혈청", "크레아티닌", "혈청"]);
  });
});

describe("customCode", () => {
  it("같은 이름은 표기 차이가 있어도 같은 code", () => {
    expect(customCode("임의 검사 A")).toBe("custom:임의검사a");
    expect(customCode("임의검사-A")).toBe("custom:임의검사a");
  });

  it("정규화 결과가 비면 null", () => {
    expect(customCode("---")).toBeNull();
  });

  // 회귀: PR #528 Codex P2 — 자르면 앞부분이 같은 두 이름이 한 code 로 합쳐진다
  it("상한까지는 그대로 · 넘으면 자르지 않고 null", () => {
    const a = customCode("가".repeat(70) + "A");
    const b = customCode("가".repeat(70) + "B");
    expect(a).not.toBe(b);
    expect(customCode("가".repeat(100))?.length).toBe("custom:".length + 100);
    expect(customCode("가".repeat(101))).toBeNull();
  });

  it("카탈로그 조회", () => {
    expect(getCheckupItem("hba1c")?.unit).toBe("%");
    expect(getCheckupItem("custom:x")).toBeUndefined();
  });
});
