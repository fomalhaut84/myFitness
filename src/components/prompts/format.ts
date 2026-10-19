// #552: 버전 시각 표기 — KST "MM-DD" / "MM-DD HH:mm" (서버 · 클라이언트 동일 결과)

const KST = "Asia/Seoul";

function parts(iso: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: KST, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

export function formatPromptDate(iso: string): string {
  const p = parts(iso);
  return `${p.month}-${p.day}`;
}

export function formatPromptDateTime(iso: string): string {
  const p = parts(iso);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
