// #552: `{{name}}` 변수 치환 — 순수. 한 번만 훑으므로 치환된 값 (활동 이름 등) 안의 `{{…}}` 는 다시 해석하지 않는다.

/** `{{…}}` 한 덩어리. 이름 검사는 validate / render 가 각각 한다 */
export const VARIABLE_PATTERN = /\{\{([^{}]*)\}\}/g;

export function renderPrompt(body: string, vars: Readonly<Record<string, string>>): string {
  return body.replace(VARIABLE_PATTERN, (_match, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      throw new Error(`프롬프트 변수 {{${name}}} 에 넣을 값이 없습니다`);
    }
    return value;
  });
}
