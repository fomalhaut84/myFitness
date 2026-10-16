"use client";

// #532: 결과지 파일 선택 — 이미지 여러 장 또는 PDF 1개 · 드래그 앤 드롭 · 이미지 출처 (캡처 / 종이 사진).
import { useRef, useState } from "react";
import { MAX_IMAGE_FILES, MAX_PDF_PAGES } from "@/lib/checkup/import/client-pages";

export type ImageSource = "capture" | "photo";

interface FilePickerProps {
  imageSource: ImageSource;
  onImageSourceChange: (source: ImageSource) => void;
  onFiles: (files: File[]) => void;
  error: string | null;
  busy: boolean;
}

const SOURCES: { value: ImageSource; label: string }[] = [
  { value: "capture", label: "화면 캡처" },
  { value: "photo", label: "종이 결과지 사진" },
];

export default function FilePicker({ imageSource, onImageSourceChange, onFiles, error, busy }: FilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div className="bg-card border border-border rounded-xl p-4 md:p-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!busy) onFiles([...e.dataTransfer.files]);
        }}
        className={`rounded-xl border-[1.5px] border-dashed px-5 py-9 text-center ${dragging ? "border-accent bg-surface" : "border-border-hover"}`}
      >
        <p className="text-[15px] font-medium text-bright">결과지 캡처 · 사진 · PDF 를 여기에 놓으세요</p>
        <p className="mt-1 text-[13px] text-sub">
          이미지 여러 장 (JPEG · PNG · WebP, {MAX_IMAGE_FILES}장까지) 또는 PDF 1개 ({MAX_PDF_PAGES}쪽까지)
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-3.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-[#04130a] hover:bg-accent-hover disabled:opacity-50"
        >
          {busy ? "여는 중…" : "파일 선택"}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf,.heic,.heif"
          className="hidden"
          onChange={(e) => {
            onFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>
      <div role="radiogroup" aria-label="이미지 출처" className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-sub">이미지 출처</span>
        {SOURCES.map((s) => (
          <label
            key={s.value}
            className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] ${
              imageSource === s.value ? "border-accent text-bright" : "border-border"
            }`}
          >
            <input type="radio" name="image-source" checked={imageSource === s.value} onChange={() => onImageSourceChange(s.value)} />
            {s.label}
          </label>
        ))}
        <span className="text-xs text-dim">PDF 는 자동으로 PDF 로 기록됩니다</span>
      </div>
      <p className="mt-3 text-xs text-dim">이미지는 항목을 읽은 뒤 바로 지웁니다. 읽은 내용은 확인 화면에서 고를 수 있습니다.</p>
      <p className="mt-1 text-xs text-amber-300">
        HEIC 사진은 읽을 수 없습니다 — iPhone 에서 공유할 때 &quot;가장 호환성 높은 형식&quot; 을 고르면 JPEG 로 보내집니다.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
