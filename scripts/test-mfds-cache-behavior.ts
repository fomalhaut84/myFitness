// #315 회귀: fetchMfdsFood 캐시 정책 검증.
// 사전 리뷰 P1 (feat/315-1): transient error 를 24h negative cache 로 poisoning 하면
// API 복구 후에도 그 검색어는 24h 재시도 불가 → MFDS 정확도 이점 무력화.
// 정상 응답 (hit or no-match) 만 캐시, 5xx/timeout/parse-fail 은 캐시 안 함.
//
// 실행: npx tsx scripts/test-mfds-cache-behavior.ts

import { fetchMfdsFood, clearMfdsCache } from "@/lib/nutrition/food-db-mfds";

async function main() {
  // 함수가 API_KEY 없으면 조기 return null. 테스트용 dummy key.
  process.env.MFDS_API_KEY = "test-key";

  let allPass = true;

  // Case 0: Encoding key (% 포함) 인 경우 double-encoding 방지 — decodeURIComponent 로 원본
  // 복구 후 URLSearchParams 가 정상 재-encode. serviceKey param 이 최종 URL 에서 encoded 원본
  // (한 번만) 이 되어야 함.  (Codex P2 PR #316 4회차)
  {
    clearMfdsCache();
    process.env.MFDS_API_KEY = "abc%2Bxyz%3D"; // Encoding key sample
    let requestedUrl = "";
    const mock: typeof fetch = async (input) => {
      requestedUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
      return new Response(
        JSON.stringify({ header: { resultCode: "00" }, body: { items: [] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    await fetchMfdsFood("dummy", { fetchImpl: mock });
    // URLSearchParams re-encode → 최종 URL 에 %2B / %3D (원본 encoded) 형태로 딱 한 번.
    const ok =
      requestedUrl.includes("serviceKey=abc%2Bxyz%3D") &&
      !requestedUrl.includes("%252B") &&
      !requestedUrl.includes("%253D");
    console.log(`${ok ? "✓" : "✗"} Encoding key 자동 decode (double-encoding 방지)`);
    if (!ok) console.log(`   requested: ${requestedUrl}`);
    allPass = allPass && ok;
    process.env.MFDS_API_KEY = "test-key"; // 이후 케이스 원복
  }

  // Case 1: HTTP 500 → 캐시 되면 안 됨.
  {
    clearMfdsCache();
    let calls = 0;
    const mock: typeof fetch = async () => {
      calls++;
      return new Response("Internal Error", { status: 500 });
    };
    await fetchMfdsFood("case1", { fetchImpl: mock });
    await fetchMfdsFood("case1", { fetchImpl: mock });
    const ok = calls === 2;
    console.log(`${ok ? "✓" : "✗"} HTTP 500 → 재시도 (calls=${calls}, expect 2)`);
    allPass = allPass && ok;
  }

  // Case 2: network error (throw) → 캐시 되면 안 됨.
  {
    clearMfdsCache();
    let calls = 0;
    const mock: typeof fetch = async () => {
      calls++;
      throw new Error("ECONNREFUSED");
    };
    await fetchMfdsFood("case2", { fetchImpl: mock });
    await fetchMfdsFood("case2", { fetchImpl: mock });
    const ok = calls === 2;
    console.log(`${ok ? "✓" : "✗"} network error → 재시도 (calls=${calls}, expect 2)`);
    allPass = allPass && ok;
  }

  // Case 3: JSON parse 실패 → 캐시 되면 안 됨.
  {
    clearMfdsCache();
    let calls = 0;
    const mock: typeof fetch = async () => {
      calls++;
      return new Response("not-json-<html>", { status: 200 });
    };
    await fetchMfdsFood("case3", { fetchImpl: mock });
    await fetchMfdsFood("case3", { fetchImpl: mock });
    const ok = calls === 2;
    console.log(`${ok ? "✓" : "✗"} JSON parse 실패 → 재시도 (calls=${calls}, expect 2)`);
    allPass = allPass && ok;
  }

  // Case 4: 정상 응답 no-match (body.items 빈 배열) → 캐시 됨 (반복 miss 방지).
  {
    clearMfdsCache();
    let calls = 0;
    const mock: typeof fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({ header: { resultCode: "00" }, body: { items: [] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    await fetchMfdsFood("case4", { fetchImpl: mock });
    await fetchMfdsFood("case4", { fetchImpl: mock });
    const ok = calls === 1;
    console.log(`${ok ? "✓" : "✗"} 정상 no-match → 캐시 (calls=${calls}, expect 1)`);
    allPass = allPass && ok;
  }

  // Case 4-c: HTTP 200 + structural failure (null / {} / header 없음) → 캐시 X.
  //   (Codex P2 PR #316 6회차)
  {
    clearMfdsCache();
    let calls = 0;
    const mock: typeof fetch = async () => {
      calls++;
      return new Response(JSON.stringify(null), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await fetchMfdsFood("case4c", { fetchImpl: mock });
    await fetchMfdsFood("case4c", { fetchImpl: mock });
    const ok = calls === 2;
    console.log(`${ok ? "✓" : "✗"} structural (null payload) → 재시도 (calls=${calls}, expect 2)`);
    allPass = allPass && ok;
  }

  // Case 4-d: HTTP 200 + {} (envelope 없음) → 캐시 X.
  {
    clearMfdsCache();
    let calls = 0;
    const mock: typeof fetch = async () => {
      calls++;
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    await fetchMfdsFood("case4d", { fetchImpl: mock });
    await fetchMfdsFood("case4d", { fetchImpl: mock });
    const ok = calls === 2;
    console.log(`${ok ? "✓" : "✗"} structural (empty envelope) → 재시도 (calls=${calls}, expect 2)`);
    allPass = allPass && ok;
  }

  // Case 4-b: HTTP 200 + header.resultCode !== "00" (auth/quota 오류) → 캐시 되면 안 됨.
  //   (Codex P2 feat/315-1 2회차)
  {
    clearMfdsCache();
    let calls = 0;
    const mock: typeof fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          header: { resultCode: "22", resultMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    await fetchMfdsFood("case4b", { fetchImpl: mock });
    await fetchMfdsFood("case4b", { fetchImpl: mock });
    const ok = calls === 2;
    console.log(`${ok ? "✓" : "✗"} resultCode!="00" → 재시도 (calls=${calls}, expect 2)`);
    allPass = allPass && ok;
  }

  // Case 5-c: ambiguous tied match — 같은 FOOD_REF_NM + 같은 name.length + 이름 다른 여러
  //   variants 이면 defensible match 없음으로 null 반환 (Codex P2 PR #316 10회차).
  {
    clearMfdsCache();
    let calls = 0;
    const mock: typeof fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          header: { resultCode: "00" },
          body: {
            items: [
              { FOOD_NM_KR: "김치찌개_꽁치", FOOD_REF_NM: "김치찌개", AMT_NUM1: 89, AMT_NUM3: 7.14, AMT_NUM4: 5.18, AMT_NUM6: 3.54 },
              { FOOD_NM_KR: "김치찌개_참치", FOOD_REF_NM: "김치찌개", AMT_NUM1: 95, AMT_NUM3: 8, AMT_NUM4: 6, AMT_NUM6: 4 },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const first = await fetchMfdsFood("김치찌개_ambig_test", { fetchImpl: mock });
    // 두 번째 호출: ambiguous 는 envelopeValid=true 라 negative-caching 됨.
    await fetchMfdsFood("김치찌개_ambig_test", { fetchImpl: mock });
    const ok = calls === 1 && first === null;
    console.log(
      `${ok ? "✓" : "✗"} ambiguous tied → null 반환 + 캐시 (calls=${calls}, first=${first === null ? "null" : first.name})`,
    );
    allPass = allPass && ok;
  }

  // Case 5-b: collapsed single-result — body.items 가 row object 자체.
  //   (Codex P2 PR #316 9회차)
  {
    clearMfdsCache();
    let calls = 0;
    const mock: typeof fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          header: { resultCode: "00" },
          body: {
            items: {
              FOOD_NM_KR: "쌀밥",
              FOOD_REF_NM: "쌀밥",
              AMT_NUM1: 166,
              AMT_NUM3: 3.36,
              AMT_NUM4: 0.32,
              AMT_NUM6: 37.33,
              SERVING_SIZE: "100g",
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const first = await fetchMfdsFood("쌀밥", { fetchImpl: mock });
    await fetchMfdsFood("쌀밥", { fetchImpl: mock });
    const ok = calls === 1 && first?.name === "쌀밥";
    console.log(
      `${ok ? "✓" : "✗"} collapsed single-result (items=object) → hit + 캐시 (calls=${calls}, hit=${first?.name ?? "null"})`,
    );
    allPass = allPass && ok;
  }

  // Case 5: 정상 hit (query 와 이름 일치) → 캐시 됨.
  {
    clearMfdsCache();
    let calls = 0;
    const mock: typeof fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          header: { resultCode: "00" },
          body: {
            items: [
              { FOOD_NM_KR: "김치찌개", FOOD_REF_NM: "김치찌개", AMT_NUM1: 89, AMT_NUM3: 7.14, AMT_NUM4: 5.18, AMT_NUM6: 3.54, SERVING_SIZE: "100g" },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const first = await fetchMfdsFood("김치찌개", { fetchImpl: mock });
    await fetchMfdsFood("김치찌개", { fetchImpl: mock });
    const ok = calls === 1 && first?.name === "김치찌개";
    console.log(`${ok ? "✓" : "✗"} 정상 hit → 캐시 (calls=${calls}, expect 1, hit=${first?.name ?? "null"})`);
    allPass = allPass && ok;
  }

  console.log(allPass ? "ALL PASS" : "FAIL");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("[test-mfds-cache] 예외:", err);
  process.exit(1);
});
