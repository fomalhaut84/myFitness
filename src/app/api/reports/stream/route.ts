import { NextRequest } from "next/server";
import { getReportJob, subscribeToJob } from "@/lib/report-job";
import type { JobEvent } from "@/lib/report-job";

/**
 * M#191: SSE endpoint. jobId 로 job 상태 push.
 *
 * 응답 형식:
 *   event: status
 *   data: {"status":"running"}
 *
 *   event: completed
 *   data: {"adviceId":"cuid..."}
 *
 *   event: failed
 *   data: {"errorMessage":"..."}
 *
 * 완료/실패 시 서버측에서 stream close. 프론트는 EventSource close 처리.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return new Response(JSON.stringify({ error: "jobId 필요" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 존재 여부만 pre-check. 상태 snapshot 은 subscribe 이후 조회 (P1: lost-event race 방어).
  const preCheck = await getReportJob(jobId);
  if (!preCheck) {
    return new Response(JSON.stringify({ error: "job not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // stream 이 이미 close 된 경우 (client disconnect) — 조용히 무시
        }
      };

      let closed = false;
      const closeStream = (unsubscribe: () => void) => {
        if (closed) return;
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      };

      // P1 fix: subscribe 먼저 → 그 다음 DB snapshot. Node EventEmitter 는 동기적 emit
      // 이므로 subscribe 등록 후 발생한 이벤트는 handler 에 도달.
      //
      // P2 fix (cross-process): EventEmitter 는 process-local. web (myfitness) 과
      // bot (myfitness-bot) 은 별도 pm2 앱 → cron 이 bot 에서 emit 해도 web SSE 는 못 받음.
      // DB poll 병행 → same-process 는 EventEmitter (즉시), cross-process 는 poll (2s).
      let terminated = false;
      let lastPolledStatus: string | null = null;
      const handleEvent = (event: JobEvent) => {
        if (closed) return;
        if (event.type === "status") {
          send("status", { status: event.status });
        } else if (event.type === "completed") {
          send("completed", { adviceId: event.adviceId });
          terminated = true;
          stopEverything();
        } else if (event.type === "failed") {
          send("failed", { errorMessage: event.errorMessage });
          terminated = true;
          stopEverything();
        }
      };
      const unsubscribe = subscribeToJob(jobId, handleEvent);

      // DB poll (cross-process fallback). Same-process 케이스에도 즉시성 영향 없음.
      // unref 로 shutdown blocker 방지.
      const pollTimer: NodeJS.Timeout = setInterval(async () => {
        if (closed || terminated) return;
        try {
          const j = await getReportJob(jobId);
          if (!j) return;
          if (j.status !== lastPolledStatus) {
            send("status", { status: j.status });
            lastPolledStatus = j.status;
          }
          if (j.status === "completed") {
            send("completed", { adviceId: j.adviceId });
            terminated = true;
            stopEverything();
          } else if (j.status === "failed") {
            send("failed", { errorMessage: j.errorMessage });
            terminated = true;
            stopEverything();
          }
        } catch (err) {
          console.error(`[reports/stream] poll error jobId=${jobId}:`, err);
        }
      }, 2000);
      pollTimer.unref?.();

      const stopEverything = () => {
        clearInterval(pollTimer);
        closeStream(unsubscribe);
      };

      // Client disconnect 감지 → subscription cleanup (백엔드 job 은 계속 실행).
      request.signal.addEventListener("abort", () => {
        stopEverything();
      });

      // Subscribe/poll 등록 후 snapshot 조회 → 초기 상태 send.
      const snapshot = await getReportJob(jobId);
      if (closed || terminated) return;
      if (!snapshot) {
        stopEverything();
        return;
      }
      lastPolledStatus = snapshot.status;
      send("status", { status: snapshot.status });
      if (snapshot.status === "completed") {
        send("completed", { adviceId: snapshot.adviceId });
        stopEverything();
      } else if (snapshot.status === "failed") {
        send("failed", { errorMessage: snapshot.errorMessage });
        stopEverything();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx buffering off — 프로덕션 nginx 설정에서도 확인 필요.
      "X-Accel-Buffering": "no",
    },
  });
}
