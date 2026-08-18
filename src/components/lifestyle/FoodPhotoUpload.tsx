"use client";

// #309 (M14 Phase 2 #5): 웹 음식 사진 등록 버튼.
// 파일 선택 → client-side downscale (max 1600px, JPEG q=0.85) → multipart POST /api/food → refresh.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.85;

type UploadState =
  | { kind: "idle" }
  | { kind: "uploading"; filename: string }
  | { kind: "success"; description: string; kcal: number | null }
  | { kind: "error"; message: string };

export default function FoodPhotoUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  // Codex P2 (PR #310): success state 의 3초 timer 를 새 업로드 시작 시 clear.
  // 이전엔 첫 업로드 timer 가 두 번째 업로드 진행 중에 fire 해서 uploading state 를 idle 로
  // 덮어씀 → 스피너 사라지고 버튼 재활성 → 중복 제출 유도.
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null) {
        clearTimeout(successTimerRef.current);
        successTimerRef.current = null;
      }
    };
  }, []);

  const openPicker = () => {
    if (state.kind === "uploading") return;
    inputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 재선택을 위해 value 초기화 (같은 파일 다시 선택 가능).
    e.target.value = "";
    if (!file) return;
    // 이전 success timer 가 남아있으면 취소 (P2 fix).
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
    setState({ kind: "uploading", filename: file.name });
    try {
      const blob = await downscaleImage(file);
      // Codex P2 (PR #310): downscaleImage 가 HEIC 원본을 리턴한 경우 (.jpg / image/jpeg
      // wrapper 로 감싸면 서버는 JPEG 로 오인해 저장하지만 payload 는 HEIC → Vision 디코딩
      // 불가). blob 이 original file 과 동일 참조면 원본 filename/type 유지.
      const uploadFile =
        blob === file
          ? file
          : new File([blob], stripExt(file.name) + ".jpg", { type: "image/jpeg" });
      const form = new FormData();
      form.append("image", uploadFile);
      const res = await fetch("/api/food", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `요청 실패 (${res.status})`);
      }
      const payload = (await res.json()) as {
        data: { description: string; estimatedKcal: number | null };
        estimate: unknown | null;
      };
      // Codex P2 (PR #310): estimate=null 은 Vision 실패 (caption 있어서 저장은 됐지만
      // kcal/macros 는 null). success 로 표시하면 사용자가 "분석 완료" 로 오해 → warning.
      if (payload.estimate === null) {
        setState({
          kind: "error",
          message: "Vision 분석 실패 · 저장된 로그의 kcal 편집 or 재시도",
        });
        router.refresh();
        return;
      }
      setState({
        kind: "success",
        description: payload.data.description,
        kcal: payload.data.estimatedKcal,
      });
      router.refresh();
      // 3초 후 idle 로 복귀. ref 로 timer 추적 (재업로드 시 clear).
      successTimerRef.current = setTimeout(() => {
        successTimerRef.current = null;
        // Codex P2 (PR #310): 현재 state 가 여전히 이 success 인 경우에만 idle 로 복귀
        // (그 사이 다른 upload 로 state 가 바뀌었으면 그대로 유지).
        setState((prev) => (prev.kind === "success" ? { kind: "idle" } : prev));
      }, 3000);
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={openPicker}
        disabled={state.kind === "uploading"}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-border bg-surface hover:border-muted hover:bg-card transition-colors ${
          state.kind === "uploading" ? "opacity-55 cursor-not-allowed" : ""
        }`}
      >
        <span className="text-[14px]">📷</span>
        {state.kind === "uploading" ? "업로드 중…" : "사진 등록"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onFile}
      />
      {state.kind === "uploading" && (
        <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.06] text-[12px] text-amber-300">
          <span className="inline-block w-3 h-3 border-2 border-amber-400/25 border-t-amber-400 rounded-full animate-spin"></span>
          <div>
            <div>
              <b>{state.filename}</b>
            </div>
            <div className="text-muted text-[11px] mt-0.5">
              AI 분석 중… (약 20~40초 소요)
            </div>
          </div>
        </div>
      )}
      {state.kind === "success" && (
        <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-green-500/30 bg-green-500/[0.08] text-[12px] text-green-400">
          <span>✓</span>
          <div>
            사진 분석 완료 · <b>{state.description}</b>
            {state.kcal !== null && ` (${state.kcal.toLocaleString("ko-KR")} kcal)`} 저장됨
          </div>
        </div>
      )}
      {state.kind === "error" && (
        <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-red-400/25 bg-red-400/[0.06] text-[12px] text-red-400">
          <span>✗</span>
          <div>
            <div>Vision 분석 실패</div>
            <div className="text-muted text-[11px] mt-0.5">{state.message}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** client-side downscale via canvas. HEIC 등 브라우저 미지원 포맷은 원본 그대로 리턴. */
async function downscaleImage(file: File): Promise<Blob> {
  // HEIC 는 브라우저 <img> 로 못 열음 — 서버로 원본 전달, 서버가 처리 (Claude Vision 은 HEIC 지원 안 함
  // 이므로 실질적으로는 fail 가능). 사용자 경험 개선은 향후 heic2any 라이브러리.
  const isHeic = /^image\/heic$/i.test(file.type) || /\.heic$/i.test(file.name);
  if (isHeic) return file;

  const dataUrl = await readAsDataURL(file);
  const img = await loadImage(dataUrl);
  const { width, height } = img;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
  if (scale >= 1 && file.type === "image/jpeg") {
    // 이미 작은 JPEG — 그대로 사용.
    return file;
  }
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d 컨텍스트 확보 실패");
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("canvas 인코딩 실패"));
        resolve(blob);
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("파일 읽기 실패"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지 로드 실패"));
    img.src = src;
  });
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
