// #514: 합성 fixture — 실측 응답 구조만 따르고 값은 임의 (실측 원본은 커밋하지 않는다).

/** bodyIndexList 항목: [value, unitCode, exponent, flag] (문자열) */
export function idx(value: number, exponent = 0, unit = 0): string[] {
  return [String(value), String(unit), String(exponent), "0"];
}

export function measure(measureDateTo: number, bodyIndexList: Record<string, string[]>) {
  return {
    transferDate: measureDateTo + 20_000,
    measureDateFrom: measureDateTo,
    measureDateTo,
    measureDeviceDateTo: "20261001070000000",
    timeZone: "Asia/Seoul",
    bodyIndexList,
    clientAppId: 1,
    measurementMode: 0,
  };
}

export function measureResponse(category: string, measures: unknown[]) {
  return {
    returnedValue: {
      deviceCategory: category,
      deviceModelList: [
        {
          deviceModel: "TEST-MODEL",
          deviceSerialIDList: [{ deviceSerialID: "serial-a", userNumberInDevice: 1, measureList: measures }],
        },
      ],
    },
  };
}

/** KST 벽시계 → UTC epoch ms */
export function kst(ymdHm: string): number {
  return new Date(`${ymdHm}:00+09:00`).getTime();
}

export function bp(at: string, sys: number, dia: number, pulse: number) {
  return measure(kst(at), { "1": idx(sys), "2": idx(dia), "3": idx(pulse), "11": idx(0), "12": idx(0) });
}

export function scale(at: string, weightHundredths: number) {
  return measure(kst(at), {
    "257": idx(weightHundredths, -2, 8195),
    "262": idx(308, -1),
    "259": idx(271, -1),
    "261": idx(316, -1),
    "294": idx(281, -1, 8195),
    "264": idx(18),
    "260": idx(1894),
    "263": idx(56),
  });
}
