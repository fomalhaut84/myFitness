"use client";

// #532: 결과지 가져오기 — 파일 선택 → 쪽별 읽기 (동시 2) → 확인 → 저장 → 완료.
// 쪽 이미지는 업로드 직전에 만들고 (client-pages) 서버는 읽은 뒤 바로 지운다. 저장 전에는 아무것도 DB 에 쓰지 않는다.
import { useEffect, useRef, useState } from "react";
import { prepareFiles, type PendingPage } from "@/lib/checkup/import/client-pages";
import type { ExtractedPage } from "@/lib/checkup/import/extract-schema";
import { mergePages } from "@/lib/checkup/import/merge";
import { buildDraftRounds, type DraftRound } from "@/lib/checkup/import/draft";
import { applyExistingDefaults, type ExistingRound } from "@/lib/checkup/import/status";
import { assembleImport, roundDate, type ImportFinding, type ImportHeader } from "@/lib/checkup/import/assemble";
import type { ImportRoundOutcome } from "@/lib/checkup/import/write";
import FilePicker, { type ImageSource } from "./FilePicker";
import ReadProgress, { type PageProgress } from "./ReadProgress";
import ImportReview from "./ImportReview";
import ImportDone from "./ImportDone";
import type { RowPatch } from "./ReviewRows";

const CONCURRENCY = 2;

type Step = "select" | "reading" | "review" | "done";

interface ReviewState {
  header: ImportHeader;
  rounds: DraftRound[];
  findings: ImportFinding[];
  examDateConflict: boolean;
  /** 회차 key → 기본값 (같은 값 제외 등) 을 적용한 날짜. 날짜가 바뀌면 다시 적용 */
  applied: Record<string, string>;
}

interface Upload {
  source: "pdf" | "image";
  pages: PendingPage[];
  dispose: () => void;
}

/** 불러온 기존 회차의 기본값을 아직 적용하지 않은 회차에 적용 (순수 — 같은 입력이면 같은 결과) */
function applyLoaded(review: ReviewState, loaded: ReadonlyMap<string, ExistingRound | null>): ReviewState {
  let applied = review.applied;
  const rounds = review.rounds.map((round) => {
    const date = roundDate(round, review.header.date);
    if (!date || !loaded.has(date) || applied[round.key] === date) return round;
    applied = { ...applied, [round.key]: date };
    return applyExistingDefaults(round, loaded.get(date) ?? null);
  });
  return applied === review.applied ? review : { ...review, rounds, applied };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `요청 실패 (${res.status})`);
  return body as T;
}

export default function CheckupImport({ today }: { today: string }) {
  const [step, setStep] = useState<Step>("select");
  const [imageSource, setImageSource] = useState<ImageSource>("capture");
  const [pickError, setPickError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [progress, setProgress] = useState<PageProgress[]>([]);
  const [running, setRunning] = useState(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [existing, setExisting] = useState<ReadonlyMap<string, ExistingRound | null>>(new Map());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ImportRoundOutcome[]>([]);

  const uploadRef = useRef<Upload | null>(null);
  const resultsRef = useRef<Map<string, ExtractedPage>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const indexRef = useRef<Promise<Map<string, string>> | null>(null);
  const requestedRef = useRef<Set<string>>(new Set());

  // 읽는 중 · 확인 중에는 실수로 떠나지 않게
  useEffect(() => {
    if (step !== "reading" && step !== "review") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [step]);

  // 떠나면 남은 쪽 읽기를 멈춘다 — 클라이언트 이동 (Link) 은 beforeunload 를 거치지 않는다 (PR 전 리뷰 info 3)
  useEffect(
    () => () => {
      abortRef.current?.abort();
      uploadRef.current?.dispose();
    },
    [],
  );

  function patchPage(id: string, patch: Partial<PageProgress>) {
    setProgress((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  async function readOne(page: PendingPage, signal: AbortSignal): Promise<boolean> {
    patchPage(page.id, { status: "working", error: null });
    try {
      const form = new FormData();
      form.append("image", await page.render(), "page.jpg");
      const body = await fetchJson<{ page: ExtractedPage }>("/api/checkups/extract", { method: "POST", body: form, signal });
      resultsRef.current.set(page.id, body.page);
      patchPage(page.id, { status: "done", items: body.page.items.length });
      return true;
    } catch (err) {
      if (signal.aborted) {
        patchPage(page.id, { status: "waiting" });
        return false;
      }
      patchPage(page.id, { status: "error", error: err instanceof Error ? err.message : "읽지 못함" });
      return false;
    }
  }

  /** 끝까지 실패 없이 읽었으면 true */
  async function run(pages: PendingPage[]): Promise<boolean> {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    const queue = [...pages];
    let ok = true;
    const worker = async () => {
      while (queue.length > 0 && !controller.signal.aborted) {
        const page = queue.shift() as PendingPage;
        if (!(await readOne(page, controller.signal))) ok = false;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (controller.signal.aborted) {
      // 취소된 쪽은 실패로 — "남은 쪽 다시 읽기" · 확인 버튼의 "N쪽 빼고" 에 잡히게 (PR 전 리뷰 major 2)
      const ids = new Set(pages.map((p) => p.id));
      setProgress((ps) => ps.map((p) => (ids.has(p.id) && p.status !== "done" ? { ...p, status: "error", error: "취소됨" } : p)));
    }
    setRunning(false);
    return ok && !controller.signal.aborted;
  }

  async function onFiles(files: File[]) {
    setPickError(null);
    setOpening(true);
    const prepared = await prepareFiles(files).catch(() => ({ ok: false as const, error: "파일을 열지 못했습니다" }));
    setOpening(false);
    if (!prepared.ok) {
      setPickError(prepared.error);
      return;
    }
    uploadRef.current?.dispose();
    uploadRef.current = prepared;
    resultsRef.current = new Map();
    setProgress(prepared.pages.map((p) => ({ id: p.id, label: p.label, status: "waiting", items: 0, error: null })));
    setStep("reading");
    if (await run(prepared.pages)) startReview();
  }

  function loadIndex(): Promise<Map<string, string>> {
    indexRef.current ??= fetchJson<{ checkups: { id: string; date: string }[] }>("/api/checkups").then(
      (b) => new Map(b.checkups.map((c) => [c.date, c.id])),
    );
    return indexRef.current;
  }

  /** 같은 날짜 기존 회차 — 날짜마다 한 번. 불러오면 그 날짜 회차에 기본값 적용 */
  function ensureExisting(dates: readonly (string | null)[]) {
    for (const date of dates) {
      if (!date || requestedRef.current.has(date)) continue;
      requestedRef.current.add(date);
      loadIndex()
        .then(async (index): Promise<ExistingRound | null> => {
          const id = index.get(date);
          if (!id) return null;
          const body = await fetchJson<{ checkup: { results: ExistingRound["results"] } }>(`/api/checkups/${id}`);
          return { id, date, results: body.checkup.results.map(({ itemCode, valueNum, valueText, unit }) => ({ itemCode, valueNum, valueText, unit })) };
        })
        .then((found) => {
          setExisting((m) => new Map(m).set(date, found));
          setReview((r) => (r ? applyLoaded(r, new Map([[date, found]])) : r));
        })
        .catch(() => {
          requestedRef.current.delete(date);
          indexRef.current = null;
          setSaveError("같은 날짜의 기존 기록을 불러오지 못했습니다 — 날짜를 다시 고르거나 새로고침하세요");
        });
    }
  }

  function startReview() {
    const upload = uploadRef.current;
    if (!upload) return;
    const pages = upload.pages.flatMap((p) => resultsRef.current.get(p.id) ?? []);
    const merged = mergePages(pages);
    const rounds = buildDraftRounds(merged, today);
    const header: ImportHeader = { date: merged.examDate && merged.examDate <= today ? merged.examDate : "", institution: merged.institution ?? "", kind: "comprehensive" };
    const findings = merged.sections.flatMap((s, i) => s.findings.map((text, j) => ({ key: `${i}:${j}`, category: s.category, text, include: true })));
    setReview(applyLoaded({ header, rounds, findings, examDateConflict: merged.examDateConflict, applied: {} }, existing));
    setSaveError(null);
    setStep("review");
    ensureExisting(rounds.map((r) => roundDate(r, header.date)));
  }

  function updateReview(fn: (r: ReviewState) => ReviewState, dates: readonly (string | null)[] = []) {
    setReview((r) => (r ? applyLoaded(fn(r), existing) : r));
    ensureExisting(dates);
  }

  async function save() {
    if (!review || !uploadRef.current) return;
    const upload = uploadRef.current;
    const assembled = assembleImport({
      today,
      source: upload.source === "pdf" ? "pdf" : imageSource,
      header: review.header,
      rounds: review.rounds,
      findings: review.findings,
      pages: upload.pages.flatMap((p) => resultsRef.current.get(p.id) ?? []),
    });
    if (!assembled.ok) {
      setSaveError(assembled.reasons.join(" · "));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const body = await fetchJson<{ rounds: ImportRoundOutcome[] }>("/api/checkups/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assembled.body),
      });
      setOutcomes(body.rounds);
      setStep("done");
      upload.dispose();
      uploadRef.current = null;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "저장하지 못했습니다");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    abortRef.current?.abort();
    uploadRef.current?.dispose();
    uploadRef.current = null;
    resultsRef.current = new Map();
    indexRef.current = null;
    requestedRef.current = new Set();
    setExisting(new Map());
    setReview(null);
    setProgress([]);
    setOutcomes([]);
    setSaveError(null);
    setStep("select");
  }

  if (step === "done") return <ImportDone outcomes={outcomes} onAgain={reset} />;

  if (step === "review" && review) {
    return (
      <>
        <button type="button" onClick={reset} className="mb-3 text-[13px] text-sub hover:text-bright">
          ← 다른 파일로 다시
        </button>
        <ImportReview
          header={review.header}
          rounds={review.rounds}
          findings={review.findings}
          existing={existing}
          examDateConflict={review.examDateConflict}
          maxDate={today}
          saving={saving}
          error={saveError}
          onHeaderChange={(patch) => updateReview((r) => ({ ...r, header: { ...r.header, ...patch } }), patch.date ? [patch.date] : [])}
          onRoundDateChange={(key, date) =>
            updateReview((r) => ({ ...r, rounds: r.rounds.map((x) => (x.key === key ? { ...x, date } : x)) }), [date])
          }
          onRowChange={(roundKey, rowKey, patch: RowPatch) =>
            updateReview((r) => ({
              ...r,
              rounds: r.rounds.map((x) => (x.key === roundKey ? { ...x, rows: x.rows.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)) } : x)),
            }))
          }
          onFindingToggle={(key) => updateReview((r) => ({ ...r, findings: r.findings.map((f) => (f.key === key ? { ...f, include: !f.include } : f)) }))}
          onSave={save}
        />
      </>
    );
  }

  if (step === "reading") {
    return (
      <ReadProgress
        pages={progress}
        running={running}
        onCancel={() => abortRef.current?.abort()}
        onRetry={(ids) => {
          const pages = uploadRef.current?.pages.filter((p) => ids.includes(p.id)) ?? [];
          if (pages.length > 0) void run(pages);
        }}
        onReset={reset}
        onContinue={startReview}
      />
    );
  }

  return <FilePicker imageSource={imageSource} onImageSourceChange={setImageSource} onFiles={onFiles} error={pickError} busy={opening} />;
}
