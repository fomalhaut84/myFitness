// #532: 업로드 바이트의 실제 이미지 형식 (magic bytes). MIME · 확장자는 클라이언트가 정한다 — 이미지가 아닌 파일을
// `@path` 로 넘기면 CLI 가 텍스트로 프롬프트에 넣는다. 순수.

export type ImageType = "jpeg" | "png" | "webp";

export const IMAGE_EXT: Record<ImageType, string> = { jpeg: ".jpg", png: ".png", webp: ".webp" };

export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
