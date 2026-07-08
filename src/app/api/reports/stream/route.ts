import { NextRequest } from "next/server";
import { getReportJob, subscribeToJob } from "@/lib/report-job";

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

  const job = await getReportJob(jobId);
  if (!job) {
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

      // 초기 상태 즉시 전송 (재방문 시 현재 상태 복원)
      send("status", { status: job.status });

      // 이미 종료 상태면 즉시 close
      if (job.status === "completed") {
        send("completed", { adviceId: job.adviceId });
        controller.close();
        return;
      }
      if (job.status === "failed") {
        send("failed", { errorMessage: job.errorMessage });
        controller.close();
        return;
      }

      // pending/running — subscribe. 이벤트 수신 시 SSE push.
      let closed = false;
      const unsubscribe = subscribeToJob(jobId, (event) => {
        if (closed) return;
        if (event.type === "status") {
          send("status", { status: event.status });
        } else if (event.type === "completed") {
          send("completed", { adviceId: event.adviceId });
          closed = true;
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        } else if (event.type === "failed") {
          send("failed", { errorMessage: event.errorMessage });
          closed = true;
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* ignore */
          }
        }
      });

      // Client disconnect 감지 → subscription cleanup (백엔드 job 은 계속 실행).
      request.signal.addEventListener("abort", () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
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
