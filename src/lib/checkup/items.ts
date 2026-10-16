// #527 (M18-1): 건강검진 항목 카탈로그 — 단위 · 결과 형태의 정본 (온라인 결과 화면엔 단위가 없다 · 스펙 §2-2).
// 별칭은 결과지마다 다른 표기를 같은 항목으로 묶는다 (matchItem · M18-2 결과지 추출 공용). 순수 상수.

export type CheckupValueType = "numeric" | "qualitative" | "text";

export interface CheckupItem {
  code: string;
  label: string;
  aliases: readonly string[];
  category: string;
  unit: string | null;
  valueType: CheckupValueType;
  /** 표시 소수 자릿수 (numeric) */
  decimals: number;
}

/** 화면 섹션 순서. 카탈로그 밖 항목의 기본 분류는 마지막 "기타". */
export const CHECKUP_CATEGORIES = [
  "신체계측",
  "혈압",
  "심전도",
  "소변",
  "혈액",
  "간기능",
  "당뇨",
  "신장기능",
  "통풍",
  "지질",
  "췌장",
  "갑상선",
  "간염",
  "염증",
  "종양표지자",
  "위장",
  "대장",
  "흉부",
  "초음파",
  "체성분",
  "기타",
] as const;

export const OTHER_CATEGORY = "기타";

type ItemDef = [code: string, label: string, unit: string | null, valueType: CheckupValueType, decimals: number, aliases?: string[]];

const DEFS: Record<string, ItemDef[]> = {
  신체계측: [
    ["height", "신장", "cm", "numeric", 1, ["키"]],
    ["weight", "체중", "kg", "numeric", 1, ["몸무게"]],
    ["waist", "허리둘레", "cm", "numeric", 1],
    ["bmi", "체질량지수", "kg/m²", "numeric", 1, ["BMI"]],
    ["vision_left", "시력(좌)", null, "numeric", 1, ["좌안시력", "시력 좌"]],
    ["vision_right", "시력(우)", null, "numeric", 1, ["우안시력", "시력 우"]],
    ["hearing_left", "청력(좌)", null, "qualitative", 0, ["청력1000Hz(좌)", "청력 좌"]],
    ["hearing_right", "청력(우)", null, "qualitative", 0, ["청력1000Hz(우)", "청력 우"]],
  ],
  혈압: [
    ["sbp", "수축기 혈압", "mmHg", "numeric", 0, ["혈압-수축기", "최고혈압", "수축기"]],
    ["dbp", "이완기 혈압", "mmHg", "numeric", 0, ["혈압-이완기", "최저혈압", "이완기"]],
    ["pulse", "맥박", "bpm", "numeric", 0, ["맥박수"]],
  ],
  심전도: [["ecg", "심전도", null, "qualitative", 0, ["심전도검사", "ECG", "EKG"]]],
  소변: [
    ["urine_wbc", "요백혈구", null, "qualitative", 0, ["백혈구(요)", "요 백혈구", "WBC(요)", "소변 백혈구"]],
    ["urine_nitrite", "아질산염", null, "qualitative", 0, ["요아질산염"]],
    ["urine_ph", "요 pH", null, "numeric", 1, ["pH", "요산도"]],
    ["urine_protein", "요단백", null, "qualitative", 0, ["단백뇨", "요 단백", "단백(요)", "소변 단백"]],
    ["urine_glucose", "요당", null, "qualitative", 0, ["요 당", "Glucose(요)", "당(요)", "소변 당"]],
    ["urine_ketone", "케톤체", null, "qualitative", 0, ["요케톤"]],
    ["urine_urobilinogen", "유로빌리노겐", null, "qualitative", 0, ["요유로빌리노겐"]],
    ["urine_bilirubin", "요빌리루빈", null, "qualitative", 0, ["빌리루빈(요)"]],
    ["urine_blood", "요잠혈", null, "qualitative", 0, ["잠혈(요)", "소변 잠혈"]],
    ["urine_sg", "요비중", null, "numeric", 3, ["비중"]],
    ["urine_sed_rbc", "요침사(적혈구)", "/HPF", "text", 0, ["적혈구(요침사)", "RBC(요침사)"]],
    ["urine_sed_wbc", "요침사(백혈구)", "/HPF", "text", 0, ["백혈구(요침사)", "WBC(요침사)"]],
    ["urine_sed_cast", "요침사(원주)", "/LPF", "text", 0, ["Cast", "요원주"]],
  ],
  혈액: [
    ["hct", "헤마토크리트", "%", "numeric", 1, ["Hct", "적혈구용적률"]],
    ["hb", "혈색소", "g/dL", "numeric", 1, ["헤모글로빈", "Hb", "Hgb"]],
    ["wbc", "백혈구수", "×10³/μL", "numeric", 1, ["WBC", "백혈구"]],
    ["rbc", "적혈구수", "×10⁶/μL", "numeric", 2, ["RBC", "적혈구"]],
    ["plt", "혈소판수", "×10³/μL", "numeric", 0, ["PLT", "혈소판"]],
    ["mcv", "평균적혈구용적", "fL", "numeric", 1, ["MCV"]],
    ["mch", "평균적혈구혈색소", "pg", "numeric", 1, ["MCH"]],
    ["mchc", "평균적혈구혈색소농도", "g/dL", "numeric", 1, ["MCHC"]],
    ["rdw", "적혈구분포계수", "%", "numeric", 1, ["RDW"]],
    ["pdw", "혈소판분포계수", "%", "numeric", 1, ["PDW"]],
    ["mpv", "평균혈소판용적", "fL", "numeric", 1, ["MPV"]],
    ["pct", "혈소판용적율", "%", "numeric", 2, ["PCT", "혈소판용적률"]],
    ["neutrophil", "호중구", "%", "numeric", 1, ["NEUTROPHIL", "Neutrophil", "Seg"]],
    ["eosinophil", "호산구", "%", "numeric", 1, ["EOSINOPHIL", "Eosinophil"]],
    ["basophil", "호염기구", "%", "numeric", 1, ["BASOPHIL", "Basophil"]],
    ["monocyte", "단핵구", "%", "numeric", 1, ["MONOCYTE", "Monocyte"]],
    ["lymphocyte", "림프구", "%", "numeric", 1, ["LYMPHOCYTE", "Lymphocyte"]],
  ],
  간기능: [
    ["ast", "AST", "U/L", "numeric", 0, ["AST(SGOT)", "SGOT", "GOT"]],
    ["alt", "ALT", "U/L", "numeric", 0, ["ALT(SGPT)", "SGPT", "GPT"]],
    ["alp", "알칼리포스파타제", "U/L", "numeric", 0, ["ALP"]],
    ["tbil", "총빌리루빈", "mg/dL", "numeric", 2, ["T-Bil", "Total Bilirubin"]],
    ["dbil", "직접빌리루빈", "mg/dL", "numeric", 2, ["D-Bil", "Direct Bilirubin"]],
    ["ibil", "간접빌리루빈", "mg/dL", "numeric", 2, ["I-Bil", "Indirect Bilirubin"]],
    ["ggt", "γ-GTP", "U/L", "numeric", 0, ["감마지티피", "GGT", "r-GTP", "감마GTP", "Gamma-GTP"]],
    ["total_protein", "총단백", "g/dL", "numeric", 1, ["Total Protein", "총단백질"]],
    ["albumin", "알부민", "g/dL", "numeric", 1, ["Albumin"]],
    ["globulin", "글로불린", "g/dL", "numeric", 1, ["Globulin"]],
    ["ag_ratio", "알부민/글로불린 비율", null, "numeric", 1, ["A/G ratio", "A/G비"]],
  ],
  당뇨: [
    ["fbs", "공복혈당", "mg/dL", "numeric", 0, ["식전혈당", "혈당", "혈당검사", "FBS", "Glucose"]],
    ["hba1c", "당화혈색소", "%", "numeric", 1, ["HbA1c", "HbA1c-NGSP"]],
  ],
  신장기능: [
    ["bun", "요소질소", "mg/dL", "numeric", 1, ["BUN"]],
    ["creatinine", "크레아티닌", "mg/dL", "numeric", 2, ["혈청크레아티닌", "Creatinine", "Cr"]],
    ["bun_cr_ratio", "요소질소/크레아티닌 비율", null, "numeric", 1, ["BUN/Cr", "BUN/Creatinine ratio"]],
    ["egfr", "신사구체여과율", "mL/min/1.73m²", "numeric", 0, ["eGFR", "e-GFR"]],
  ],
  통풍: [["uric_acid", "요산", "mg/dL", "numeric", 1, ["Uric acid", "혈청요산"]]],
  지질: [
    ["tc", "총콜레스테롤", "mg/dL", "numeric", 0, ["Total Cholesterol", "T-Chol"]],
    ["tg", "중성지방", "mg/dL", "numeric", 0, ["트리글리세라이드", "Triglyceride", "TG"]],
    ["hdl", "HDL 콜레스테롤", "mg/dL", "numeric", 0, ["HDL", "고밀도콜레스테롤", "HDL-C"]],
    ["ldl", "LDL 콜레스테롤", "mg/dL", "numeric", 0, ["LDL", "저밀도콜레스테롤", "LDL-C"]],
  ],
  췌장: [
    ["lipase", "리파아제", "U/L", "numeric", 0, ["Lipase"]],
    ["amylase", "아밀라아제", "U/L", "numeric", 0, ["Amylase"]],
  ],
  갑상선: [
    ["tsh", "갑상선자극호르몬", "μIU/mL", "numeric", 3, ["TSH"]],
    ["free_t4", "유리티록신", "ng/dL", "numeric", 2, ["Free T4", "FT4", "유리싸이록신"]],
    ["t3", "T3", "ng/dL", "numeric", 0, ["트리요오드티로닌", "Total T3"]],
  ],
  간염: [
    ["hbsag", "B형간염 표면항원", null, "numeric", 2, ["HBsAg", "B형간염표면항원"]],
    ["hbsab", "B형간염 표면항체", "mIU/mL", "numeric", 1, ["HBsAb", "Anti-HBs", "B형간염표면항체"]],
    ["hcv_ab", "C형간염 항체", null, "numeric", 2, ["Anti-HCV", "HCV Ab", "C형간염항체"]],
  ],
  염증: [
    ["ra_factor", "류마티스 인자", "IU/mL", "numeric", 1, ["RA factor", "RF"]],
    ["crp", "C-반응성 단백", "mg/dL", "numeric", 2, ["CRP", "hs-CRP"]],
  ],
  종양표지자: [
    ["afp", "알파태아단백", "ng/mL", "numeric", 2, ["AFP", "알파피토프로틴"]],
    ["cea", "암태아성항원", "ng/mL", "numeric", 2, ["CEA"]],
    ["psa", "전립선특이항원", "ng/mL", "numeric", 2, ["PSA"]],
    ["ca19_9", "CA19-9", "U/mL", "numeric", 1, ["CA 19-9"]],
    ["ca125", "CA125", "U/mL", "numeric", 1, ["CA 125", "CA-125"]],
  ],
  위장: [
    ["gastroscopy", "위내시경", null, "qualitative", 0, ["수면위내시경", "위내시경검사", "EGD"]],
    ["upper_gi", "위장조영", null, "qualitative", 0, ["위장조영검사", "UGIS"]],
  ],
  대장: [
    ["colonoscopy", "대장내시경", null, "qualitative", 0, ["무통대장내시경", "수면대장내시경", "대장내시경검사"]],
    ["colon_biopsy", "대장 조직검사", null, "qualitative", 0, ["대장조직검사"]],
    ["fobt", "분변잠혈", null, "qualitative", 0, ["분변잠혈검사", "FOBT"]],
  ],
  흉부: [["chest_xray", "흉부 X선", null, "qualitative", 0, ["흉부촬영(PA)", "흉부엑스선", "흉부방사선", "Chest PA"]]],
  초음파: [
    ["abdominal_us", "상복부 초음파", null, "qualitative", 0, ["상복부초음파", "복부초음파"]],
    ["thyroid_us", "갑상선 초음파", null, "qualitative", 0, ["갑상선초음파"]],
  ],
  체성분: [
    ["body_fat_pct", "체지방률", "%", "numeric", 1, ["Percent Body Fat"]],
    ["body_fat_mass", "체지방량", "kg", "numeric", 1],
    ["muscle_mass", "근육량", "kg", "numeric", 1],
    ["inbody", "체성분검사", null, "text", 0, ["인바디"]],
  ],
};

export const CHECKUP_ITEMS: readonly CheckupItem[] = Object.entries(DEFS).flatMap(([category, defs]) =>
  defs.map(([code, label, unit, valueType, decimals, aliases = []]) => ({
    code,
    label,
    aliases,
    category,
    unit,
    valueType,
    decimals,
  })),
);

const BY_CODE: ReadonlyMap<string, CheckupItem> = new Map(CHECKUP_ITEMS.map((i) => [i.code, i]));

export function getCheckupItem(code: string): CheckupItem | undefined {
  return BY_CODE.get(code);
}

export const CUSTOM_PREFIX = "custom:";

export function isCustomCode(code: string): boolean {
  return code.startsWith(CUSTOM_PREFIX);
}

/** 섹션 정렬 키 (카탈로그 밖 분류는 "기타" 앞 · 이름순은 호출자) */
export function categoryOrder(category: string): number {
  const i = (CHECKUP_CATEGORIES as readonly string[]).indexOf(category);
  return i === -1 ? CHECKUP_CATEGORIES.length - 1.5 : i;
}
